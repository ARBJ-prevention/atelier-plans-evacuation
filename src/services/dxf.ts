/**
 * Lecture des fichiers DXF (AutoCAD, ASCII) et conversion en dessin vectoriel
 * SVG à l'échelle réelle. Aucune dépendance, fonctionne hors ligne.
 *
 * Étapes :
 *  1. parseDxf()   : lecture du texte (en-tête, calques, blocs, entités) ;
 *  2. flattenDxf() : « aplatit » les entités (blocs insérés, arcs, splines…)
 *                    en primitives simples en coordonnées du dessin ;
 *  3. renderDxfSvg(): choisit les calques, convertit les unités en unités plan
 *                    et produit un SVG (axe Y inversé, origine en haut à gauche).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Pair = [number, string];
interface RawEntity { type: string; pairs: Pair[]; vertices?: RawEntity[]; attribs?: RawEntity[] }
interface DxfLayer { name: string; color: number; trueColor: number | null; off: boolean; frozen: boolean; lineweight: number }
interface DxfBlock { name: string; base: [number, number]; entities: RawEntity[] }

export interface DxfDocument {
  insUnits: number;
  measurement: number | null;
  layers: Map<string, DxfLayer>;
  blocks: Map<string, DxfBlock>;
  entities: RawEntity[];
  /** Types d'entités rencontrés mais non pris en charge, avec leur nombre. */
  skipped: Record<string, number>;
}

export type Vec = [number, number];
interface PrimBase {
  layer: string; chain: string[]; color: string; lw: number;
  /** Numéro de l'insertion de bloc de premier niveau dont provient l'objet (reconnaissance). */
  group?: number;
}
/** Arc d'origine (coordonnées du dessin) : centre, rayon, extrémités de départ et d'arrivée. */
export interface DxfArc { c: Vec; r: number; p0: Vec; p1: Vec; sweep: number }
export type DxfPrim =
  | (PrimBase & { kind: 'line'; pts: Vec[]; closed: boolean; arc?: DxfArc })
  | (PrimBase & { kind: 'fill'; rings: Vec[][]; solid: boolean })
  | (PrimBase & { kind: 'text'; at: Vec; height: number; rotation: number; lines: string[]; hAlign: 'start' | 'middle' | 'end'; vAlign: 'baseline' | 'middle' | 'top' | 'bottom' });

export interface DxfLayerInfo { name: string; count: number; color: string; defaultVisible: boolean }

export interface FlatDxf {
  prims: DxfPrim[];
  layers: DxfLayerInfo[];
  insUnits: number;
  skipped: Record<string, number>;
}

export class DxfError extends Error {}

// ---------------------------------------------------------------------------
// Unités
// ---------------------------------------------------------------------------

export const DXF_UNITS: { code: number; key: string; label: string; meters: number }[] = [
  { code: 4, key: 'mm', label: 'Millimètres', meters: 0.001 },
  { code: 5, key: 'cm', label: 'Centimètres', meters: 0.01 },
  { code: 14, key: 'dm', label: 'Décimètres', meters: 0.1 },
  { code: 6, key: 'm', label: 'Mètres', meters: 1 },
  { code: 1, key: 'in', label: 'Pouces', meters: 0.0254 },
  { code: 2, key: 'ft', label: 'Pieds', meters: 0.3048 },
];

/** Unité déclarée dans le fichier ($INSUNITS), ou null si absente / « sans unité ». */
export function declaredUnit(insUnits: number): string | null {
  return DXF_UNITS.find((u) => u.code === insUnits)?.key ?? null;
}

/** Devine l'unité d'un dessin sans unité déclarée à partir de sa plus grande dimension. */
export function guessUnit(maxDim: number): string {
  if (maxDim > 20000) return 'mm';
  if (maxDim > 2000) return 'cm';
  return 'm';
}

export function unitMeters(key: string): number {
  return DXF_UNITS.find((u) => u.key === key)?.meters ?? 1;
}

// ---------------------------------------------------------------------------
// Couleurs AutoCAD (ACI)
// ---------------------------------------------------------------------------

const ACI_BASE: Record<number, string> = {
  1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#000000', 8: '#808080', 9: '#c0c0c0',
  250: '#333333', 251: '#505050', 252: '#696969', 253: '#828282', 254: '#bebebe', 255: '#ffffff',
};

function hex(n: number): string { return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'); }

/** Couleur d'index AutoCAD → #rrggbb (7 = noir sur fond blanc). */
export function aciColor(i: number): string {
  i = Math.abs(i);
  if (ACI_BASE[i]) return ACI_BASE[i];
  if (i < 10 || i > 249) return '#000000';
  const hue = Math.floor((i - 10) / 10) * 15;
  const k = (i - 10) % 10;
  const value = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][k];
  const sat = k % 2 === 0 ? 1 : 0.5;
  // HSV → RGB
  const c = value * sat, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = value - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return `#${hex((r + m) * 255)}${hex((g + m) * 255)}${hex((b + m) * 255)}`;
}

function trueColor(n: number): string { return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`; }

// ---------------------------------------------------------------------------
// 1. Lecture
// ---------------------------------------------------------------------------

/** Décode les octets d'un DXF (UTF-8, ou Windows-1252 pour les anciens fichiers). */
export function decodeDxfBytes(data: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(data.subarray(0, 22));
  if (head.startsWith('AutoCAD Binary DXF')) throw new DxfError('Ce fichier est un DXF binaire. Réenregistrez-le au format DXF ASCII (texte) depuis votre logiciel de DAO.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) {
      if (lines[i].trim() === '' && i + 1 >= lines.length - 1) break;
      throw new DxfError(`Fichier DXF invalide (ligne ${i + 1}).`);
    }
    pairs.push([code, lines[i + 1].trim()]);
  }
  return pairs;
}

export function parseDxf(text: string): DxfDocument {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const pairs = tokenize(text);
  if (!pairs.some(([c, v]) => c === 0 && v === 'SECTION')) throw new DxfError('Ce fichier n’est pas un DXF valide (aucune section trouvée).');
  const doc: DxfDocument = { insUnits: 0, measurement: null, layers: new Map(), blocks: new Map(), entities: [], skipped: {} };
  let i = 0;
  const n = pairs.length;

  /** Lit une entité à partir de pairs[i] (code 0) jusqu'au code 0 suivant. */
  const readEntity = (): RawEntity => {
    const e: RawEntity = { type: pairs[i][1], pairs: [] };
    i++;
    while (i < n && pairs[i][0] !== 0) { e.pairs.push(pairs[i]); i++; }
    return e;
  };

  /** Lit une suite d'entités jusqu'à `endMarker` (ENDSEC ou ENDBLK), regroupe POLYLINE/VERTEX et INSERT/ATTRIB. */
  const readEntities = (endMarker: string): RawEntity[] => {
    const out: RawEntity[] = [];
    let open: RawEntity | null = null;
    while (i < n && !(pairs[i][0] === 0 && (pairs[i][1] === endMarker || pairs[i][1] === 'ENDSEC'))) {
      if (pairs[i][0] !== 0) { i++; continue; }
      const e = readEntity();
      if (e.type === 'SEQEND') { open = null; continue; }
      if (open && e.type === 'VERTEX') { (open.vertices ??= []).push(e); continue; }
      if (open && e.type === 'ATTRIB') { (open.attribs ??= []).push(e); continue; }
      open = null;
      out.push(e);
      if (e.type === 'POLYLINE') open = e;
      else if (e.type === 'INSERT' && gi(e, 66, 0) === 1) open = e;
    }
    return out;
  };

  while (i < n) {
    if (!(pairs[i][0] === 0 && pairs[i][1] === 'SECTION')) { i++; continue; }
    i++;
    const name = pairs[i]?.[0] === 2 ? pairs[i][1] : '';
    i++;
    if (name === 'HEADER') {
      while (i < n && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) {
        if (pairs[i][0] === 9) {
          const v = pairs[i][1];
          const val = pairs[i + 1];
          if (v === '$INSUNITS' && val) doc.insUnits = parseInt(val[1], 10) || 0;
          if (v === '$MEASUREMENT' && val) doc.measurement = parseInt(val[1], 10);
        }
        i++;
      }
    } else if (name === 'TABLES') {
      while (i < n && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) {
        if (pairs[i][0] === 0 && pairs[i][1] === 'LAYER') {
          const e = readEntity();
          const lname = gs(e, 2, '');
          if (!lname) continue;
          const color = gi(e, 62, 7);
          const flags = gi(e, 70, 0);
          const tc = e.pairs.find(([c]) => c === 420);
          doc.layers.set(lname, {
            name: lname, color: Math.abs(color) || 7, trueColor: tc ? parseInt(tc[1], 10) : null,
            off: color < 0, frozen: (flags & 1) === 1, lineweight: gi(e, 370, -3),
          });
        } else i++;
      }
    } else if (name === 'BLOCKS') {
      while (i < n && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) {
        if (pairs[i][0] === 0 && pairs[i][1] === 'BLOCK') {
          const b = readEntity();
          const block: DxfBlock = { name: gs(b, 2, ''), base: [gn(b, 10, 0), gn(b, 20, 0)], entities: [] };
          block.entities = readEntities('ENDBLK');
          if (i < n && pairs[i][1] === 'ENDBLK') readEntity();
          if (block.name) doc.blocks.set(block.name.toUpperCase(), block);
        } else i++;
      }
    } else if (name === 'ENTITIES') {
      doc.entities = readEntities('ENDSEC');
    } else {
      while (i < n && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) i++;
    }
  }
  return doc;
}

// Accès aux codes de groupe
function gs(e: RawEntity, code: number, def: string): string {
  for (const [c, v] of e.pairs) if (c === code) return v;
  return def;
}
function gn(e: RawEntity, code: number, def: number): number {
  for (const [c, v] of e.pairs) if (c === code) { const x = parseFloat(v); return Number.isFinite(x) ? x : def; }
  return def;
}
function gi(e: RawEntity, code: number, def: number): number {
  for (const [c, v] of e.pairs) if (c === code) { const x = parseInt(v, 10); return Number.isFinite(x) ? x : def; }
  return def;
}

// ---------------------------------------------------------------------------
// 2. Aplatissement
// ---------------------------------------------------------------------------

/** Matrice affine 2D : x' = a x + c y + e ; y' = b x + d y + f. */
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
function mul(m: Mat, n: Mat): Mat {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function tx(m: Mat, x: number, y: number): Vec { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
const rotate = (rad: number): Mat => [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
const scale = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0];
const MIRROR_X: Mat = [-1, 0, 0, 1, 0, 0];

const DEG = Math.PI / 180;
const STEP = 5 * DEG;

/** Points d'un arc (angles en radians, sens trigonométrique si sweep > 0). */
export function arcPoints(cx: number, cy: number, r: number, start: number, sweep: number): Vec[] {
  const nSeg = Math.max(2, Math.ceil(Math.abs(sweep) / STEP));
  const pts: Vec[] = [];
  for (let k = 0; k <= nSeg; k++) {
    const a = start + (sweep * k) / nSeg;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Points d'un segment de polyligne avec renflement (bulge), extrémités incluses. */
export function bulgePoints(p1: Vec, p2: Vec, b: number): Vec[] {
  if (Math.abs(b) < 1e-9) return [p1, p2];
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const c = Math.hypot(dx, dy);
  if (c < 1e-12) return [p1, p2];
  const sag = (b * c) / 2;
  const r = (c * c / 4 + sag * sag) / (2 * sag);
  const nx = -dy / c, ny = dx / c;
  const h = r - sag;
  const cx = (p1[0] + p2[0]) / 2 + nx * h, cy = (p1[1] + p2[1]) / 2 + ny * h;
  const start = Math.atan2(p1[1] - cy, p1[0] - cx);
  const pts = arcPoints(cx, cy, Math.abs(r), start, 4 * Math.atan(b));
  pts[0] = p1; pts[pts.length - 1] = p2;
  return pts;
}

function ellipsePoints(c: Vec, major: Vec, ratio: number, t0: number, t1: number, sign = 1): Vec[] {
  if (t1 <= t0) t1 += 2 * Math.PI;
  const minor: Vec = [-major[1] * ratio * sign, major[0] * ratio * sign];
  const nSeg = Math.max(8, Math.ceil((t1 - t0) / STEP));
  const pts: Vec[] = [];
  for (let k = 0; k <= nSeg; k++) {
    const t = t0 + ((t1 - t0) * k) / nSeg;
    pts.push([c[0] + Math.cos(t) * major[0] + Math.sin(t) * minor[0], c[1] + Math.cos(t) * major[1] + Math.sin(t) * minor[1]]);
  }
  return pts;
}

/** Évalue une B-spline (rationnelle si poids) par l'algorithme de De Boor. */
export function splinePoints(degree: number, knots: number[], ctrl: Vec[], weights: number[] = []): Vec[] {
  const n = ctrl.length;
  if (n < 2) return ctrl.slice();
  const p = Math.max(1, Math.min(degree, n - 1));
  if (knots.length !== n + p + 1) return ctrl.slice(); // nœuds incohérents : polygone de contrôle
  const w = weights.length === n ? weights : ctrl.map(() => 1);
  const lo = knots[p], hi = knots[n];
  if (!(hi > lo)) return ctrl.slice();
  const samples = Math.min(2000, Math.max(16, n * 10));
  const out: Vec[] = [];
  for (let s = 0; s <= samples; s++) {
    const u = s === samples ? hi : lo + ((hi - lo) * s) / samples;
    let k = p;
    while (k < n - 1 && knots[k + 1] <= u) k++;
    const dx: number[] = [], dy: number[] = [], dw: number[] = [];
    for (let j = 0; j <= p; j++) {
      const idx = k - p + j;
      dx[j] = ctrl[idx][0] * w[idx]; dy[j] = ctrl[idx][1] * w[idx]; dw[j] = w[idx];
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j;
        const den = knots[i + p - r + 1] - knots[i];
        const a = den === 0 ? 0 : (u - knots[i]) / den;
        dx[j] = (1 - a) * dx[j - 1] + a * dx[j];
        dy[j] = (1 - a) * dy[j - 1] + a * dy[j];
        dw[j] = (1 - a) * dw[j - 1] + a * dw[j];
      }
    }
    out.push([dx[p] / dw[p], dy[p] / dw[p]]);
  }
  return out;
}

/** Nettoie un texte DXF : codes %% et \U+XXXX, mise en forme MTEXT. */
export function cleanDxfText(s: string, mtext: boolean): string {
  s = s.replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%');
  if (!mtext) return s;
  return s
    .replace(/\\\\/g, '\u0000')
    .replace(/\\[Pp]/g, '\n').replace(/\\~/g, ' ')
    .replace(/\\S([^;]*);/g, (_, a: string) => a.replace(/[#^]/, '/'))
    .replace(/\\[ACcFfHhQTWp][^;]*;/g, '')
    .replace(/\\[LlOoKkNX]/g, '')
    .replace(/\\([{}])/g, '\u0001$1')
    .replace(/[{}]/g, '')
    .replace(/\u0001/g, '')
    .replace(/\u0000/g, '\\');
}

interface Ctx { m: Mat; chain: string[]; layer: string | null; color: string | null; lw: number; depth: number; group?: number }

export function flattenDxf(doc: DxfDocument): FlatDxf {
  const prims: DxfPrim[] = [];
  let groupSeq = 0;
  const skipped: Record<string, number> = { ...doc.skipped };
  const skip = (t: string) => { skipped[t] = (skipped[t] ?? 0) + 1; };

  const layerColor = (name: string) => {
    const L = doc.layers.get(name);
    if (!L) return '#000000';
    return L.trueColor != null ? trueColor(L.trueColor) : aciColor(L.color);
  };

  const resolve = (e: RawEntity, ctx: Ctx) => {
    let layer = gs(e, 8, '0');
    if (layer === '0' && ctx.layer) layer = ctx.layer;
    const tc = e.pairs.find(([c]) => c === 420);
    const ci = gi(e, 62, 256);
    let color: string;
    if (tc) color = trueColor(parseInt(tc[1], 10));
    else if (ci === 0) color = ctx.color ?? '#000000';
    else if (ci === 256) color = layerColor(layer);
    else color = aciColor(ci);
    let lw = gi(e, 370, -1);
    if (lw === -2) lw = ctx.lw;
    if (lw === -1) lw = doc.layers.get(layer)?.lineweight ?? -3;
    return { layer, color, lw, chain: [...ctx.chain, layer] };
  };

  /** Matrice OCS → WCS pour une extrusion (0,0,-1) : miroir sur X. */
  const ocs = (e: RawEntity, m: Mat): Mat => (gn(e, 230, 1) < 0 ? mul(m, MIRROR_X) : m);

  const line = (pts: Vec[], closed: boolean, base: PrimBase) => {
    if (pts.length >= 2) prims.push({ kind: 'line', pts, closed, ...base });
  };

  const polyFromVertices = (verts: { x: number; y: number; b: number }[], closed: boolean, m: Mat): Vec[] => {
    const out: Vec[] = [];
    const count = closed ? verts.length : verts.length - 1;
    for (let k = 0; k < count; k++) {
      const v1 = verts[k], v2 = verts[(k + 1) % verts.length];
      const seg = bulgePoints([v1.x, v1.y], [v2.x, v2.y], v1.b);
      if (out.length) seg.shift();
      out.push(...seg);
    }
    if (verts.length === 1) out.push([verts[0].x, verts[0].y]);
    if (closed && out.length > 2) out.pop(); // le dernier point recouvre le premier (fermeture par « Z »)
    return out.map(([x, y]) => tx(m, x, y));
  };

  const textPrim = (e: RawEntity, ctx: Ctx, base: PrimBase, mtext: boolean) => {
    let raw = '';
    if (mtext) { for (const [c, v] of e.pairs) if (c === 3) raw += v; raw += gs(e, 1, ''); }
    else raw = gs(e, 1, '');
    const text = cleanDxfText(raw, mtext);
    if (!text.trim()) return;
    const m = ocs(e, ctx.m);
    let height = gn(e, 40, 1);
    let rot = gn(e, 50, 0) * DEG;
    let at: Vec, hAlign: 'start' | 'middle' | 'end' = 'start', vAlign: 'baseline' | 'middle' | 'top' | 'bottom' = 'baseline';
    if (mtext) {
      at = [gn(e, 10, 0), gn(e, 20, 0)];
      if (e.pairs.some(([c]) => c === 11)) rot = Math.atan2(gn(e, 21, 0), gn(e, 11, 1));
      const ap = gi(e, 71, 1);
      hAlign = ([0, 'start', 'middle', 'end'] as const)[((ap - 1) % 3) + 1] as typeof hAlign;
      vAlign = ap <= 3 ? 'top' : ap <= 6 ? 'middle' : 'bottom';
    } else {
      const h72 = gi(e, 72, 0), v73 = gi(e, 73, 0);
      const useSecond = (h72 !== 0 || v73 !== 0) && e.pairs.some(([c]) => c === 11);
      at = useSecond ? [gn(e, 11, 0), gn(e, 21, 0)] : [gn(e, 10, 0), gn(e, 20, 0)];
      if (h72 === 1 || h72 === 4) hAlign = 'middle';
      else if (h72 === 2) hAlign = 'end';
      else if (h72 === 3 || h72 === 5) { // aligné / ajusté : centré entre les deux points
        const p1: Vec = [gn(e, 10, 0), gn(e, 20, 0)], p2: Vec = [gn(e, 11, 0), gn(e, 21, 0)];
        at = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]; hAlign = 'middle';
      }
      if (h72 === 4) vAlign = 'middle';
      else if (v73 === 1) vAlign = 'bottom';
      else if (v73 === 2) vAlign = 'middle';
      else if (v73 === 3) vAlign = 'top';
    }
    const p = tx(m, at[0], at[1]);
    const dirEnd = tx(m, at[0] + Math.cos(rot), at[1] + Math.sin(rot));
    const sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    height *= sc;
    let rotation = Math.atan2(dirEnd[1] - p[1], dirEnd[0] - p[0]);
    if (m[0] * m[3] - m[1] * m[2] < 0) rotation += Math.PI; // texte en miroir : reste lisible
    prims.push({ kind: 'text', at: p, height, rotation, lines: text.split('\n'), hAlign, vAlign, ...base });
  };

  const hatchPrim = (e: RawEntity, ctx: Ctx, base: PrimBase) => {
    const m = ocs(e, ctx.m);
    const P = e.pairs;
    let k = P.findIndex(([c]) => c === 91);
    if (k < 0) return;
    const nPaths = parseInt(P[k][1], 10) || 0;
    k++;
    const next = (code: number): number => { // valeur du prochain code attendu
      while (k < P.length && P[k][0] !== code) k++;
      const v = k < P.length ? parseFloat(P[k][1]) : 0;
      k++;
      return v;
    };
    const rings: Vec[][] = [];
    for (let pi = 0; pi < nPaths && k < P.length; pi++) {
      const flags = next(92);
      const ring: Vec[] = [];
      if (flags & 2) {
        const hasBulge = next(72);
        next(73);
        const nv = next(93);
        const verts: { x: number; y: number; b: number }[] = [];
        for (let v = 0; v < nv; v++) {
          const x = next(10), y = next(20);
          let b = 0;
          if (hasBulge && P[k]?.[0] === 42) { b = parseFloat(P[k][1]) || 0; k++; }
          verts.push({ x, y, b });
        }
        ring.push(...polyFromVertices(verts, true, IDENTITY));
      } else {
        const ne = next(93);
        for (let ed = 0; ed < ne; ed++) {
          const type = next(72);
          let pts: Vec[] = [];
          if (type === 1) {
            pts = [[next(10), next(20)], [next(11), next(21)]];
          } else if (type === 2) {
            const cx = next(10), cy = next(20), r = next(40), s = next(50), en = next(51), ccw = next(73);
            if (ccw) { let sw = en - s; if (sw <= 0) sw += 360; pts = arcPoints(cx, cy, r, s * DEG, sw * DEG); }
            else { let sw = en - s; if (sw <= 0) sw += 360; pts = arcPoints(cx, cy, r, -s * DEG, -sw * DEG); }
          } else if (type === 3) {
            const cx = next(10), cy = next(20), mx = next(11), my = next(21), ratio = next(40), s = next(50), en = next(51), ccw = next(73);
            pts = ccw ? ellipsePoints([cx, cy], [mx, my], ratio, s * DEG, en * DEG) : ellipsePoints([cx, cy], [mx, my], ratio, -en * DEG, -s * DEG).reverse();
          } else if (type === 4) {
            const deg = next(94); next(73); next(74);
            const nk = next(95), nc = next(96);
            const knots: number[] = [];
            for (let q = 0; q < nk; q++) knots.push(next(40));
            const ctrl: Vec[] = [];
            const w: number[] = [];
            for (let q = 0; q < nc; q++) {
              ctrl.push([next(10), next(20)]);
              if (P[k]?.[0] === 42) { w.push(parseFloat(P[k][1]) || 1); k++; }
            }
            pts = splinePoints(deg, knots, ctrl, w);
          }
          if (ring.length && pts.length) pts.shift();
          ring.push(...pts);
        }
      }
      // objets source de la frontière
      if (P[k]?.[0] === 97) { const ns = parseInt(P[k][1], 10) || 0; k += 1 + ns; }
      if (ring.length >= 3) rings.push(ring.map(([x, y]) => tx(m, x, y)));
    }
    if (rings.length) prims.push({ kind: 'fill', rings, solid: gi(e, 70, 0) === 1, ...base });
  };

  const walk = (entities: RawEntity[], ctx: Ctx) => {
    for (const e of entities) {
      if (gi(e, 67, 0) === 1) continue; // espace papier
      const r = resolve(e, ctx);
      const base: PrimBase = { layer: r.layer, chain: r.chain, color: r.color, lw: r.lw, ...(ctx.group != null ? { group: ctx.group } : {}) };
      const m = ctx.m;
      switch (e.type) {
        case 'LINE':
          line([tx(m, gn(e, 10, 0), gn(e, 20, 0)), tx(m, gn(e, 11, 0), gn(e, 21, 0))], false, base);
          break;
        case 'LWPOLYLINE': {
          const verts: { x: number; y: number; b: number }[] = [];
          for (const [c, v] of e.pairs) {
            if (c === 10) verts.push({ x: parseFloat(v), y: 0, b: 0 });
            else if (c === 20 && verts.length) verts[verts.length - 1].y = parseFloat(v);
            else if (c === 42 && verts.length) verts[verts.length - 1].b = parseFloat(v) || 0;
          }
          const closed = (gi(e, 70, 0) & 1) === 1;
          line(polyFromVertices(verts, closed, ocs(e, m)), closed, base);
          break;
        }
        case 'POLYLINE': {
          const flags = gi(e, 70, 0);
          if (flags & (16 | 64)) { skip('POLYLINE (maillage 3D)'); break; }
          const closed = (flags & 1) === 1;
          const verts = (e.vertices ?? [])
            .filter((v) => !(gi(v, 70, 0) & 16))
            .map((v) => ({ x: gn(v, 10, 0), y: gn(v, 20, 0), b: gn(v, 42, 0) }));
          line(polyFromVertices(verts, closed, flags & 8 ? m : ocs(e, m)), closed, base);
          break;
        }
        case 'CIRCLE': {
          const pts = arcPoints(gn(e, 10, 0), gn(e, 20, 0), gn(e, 40, 0), 0, 2 * Math.PI);
          const mm = ocs(e, m);
          line(pts.map(([x, y]) => tx(mm, x, y)), true, base);
          break;
        }
        case 'ARC': {
          const s = gn(e, 50, 0), en = gn(e, 51, 360);
          let sw = en - s; if (sw <= 0) sw += 360;
          const mm = ocs(e, m);
          const pts = arcPoints(gn(e, 10, 0), gn(e, 20, 0), gn(e, 40, 0), s * DEG, sw * DEG).map(([x, y]) => tx(mm, x, y));
          if (pts.length >= 2) {
            const sc = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2]));
            const arc: DxfArc = { c: tx(mm, gn(e, 10, 0), gn(e, 20, 0)), r: gn(e, 40, 0) * sc, p0: pts[0], p1: pts[pts.length - 1], sweep: sw };
            prims.push({ kind: 'line', pts, closed: false, arc, ...base });
          }
          break;
        }
        case 'ELLIPSE': {
          const t0 = gn(e, 41, 0), t1 = gn(e, 42, 2 * Math.PI);
          const pts = ellipsePoints([gn(e, 10, 0), gn(e, 20, 0)], [gn(e, 11, 1), gn(e, 21, 0)], gn(e, 40, 1), t0, t1, gn(e, 230, 1) < 0 ? -1 : 1);
          const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6 || Math.abs(t1 - t0) < 1e-9;
          line(pts.map(([x, y]) => tx(m, x, y)), full, base);
          break;
        }
        case 'SPLINE': {
          const knots: number[] = [], ctrl: Vec[] = [], fit: Vec[] = [], w: number[] = [];
          for (const [c, v] of e.pairs) {
            if (c === 40) knots.push(parseFloat(v));
            else if (c === 10) ctrl.push([parseFloat(v), 0]);
            else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1][1] = parseFloat(v);
            else if (c === 11) fit.push([parseFloat(v), 0]);
            else if (c === 21 && fit.length) fit[fit.length - 1][1] = parseFloat(v);
            else if (c === 41) w.push(parseFloat(v));
          }
          const pts = ctrl.length >= 2 ? splinePoints(gi(e, 71, 3), knots, ctrl, w) : fit;
          line(pts.map(([x, y]) => tx(m, x, y)), (gi(e, 70, 0) & 1) === 1, base);
          break;
        }
        case 'SOLID': case 'TRACE': case '3DFACE': {
          const c: Vec[] = [[gn(e, 10, 0), gn(e, 20, 0)], [gn(e, 11, 0), gn(e, 21, 0)], [gn(e, 13, gn(e, 12, 0)), gn(e, 23, gn(e, 22, 0))], [gn(e, 12, 0), gn(e, 22, 0)]];
          const mm = e.type === '3DFACE' ? m : ocs(e, m);
          const ring = c.map(([x, y]) => tx(mm, x, y));
          if (e.type === '3DFACE') line([c[0], c[1], c[3], c[2]].map(([x, y]) => tx(m, x, y)), true, base);
          else prims.push({ kind: 'fill', rings: [ring], solid: true, ...base });
          break;
        }
        case 'HATCH':
          hatchPrim(e, ctx, base);
          break;
        case 'TEXT':
          textPrim(e, ctx, base, false);
          break;
        case 'MTEXT':
          textPrim(e, ctx, base, true);
          break;
        case 'ATTRIB':
          if (!(gi(e, 70, 0) & 1)) textPrim(e, ctx, base, false);
          break;
        case 'LEADER': {
          const pts: Vec[] = [];
          for (const [c, v] of e.pairs) {
            if (c === 10) pts.push([parseFloat(v), 0]);
            else if (c === 20 && pts.length) pts[pts.length - 1][1] = parseFloat(v);
          }
          line(pts.map(([x, y]) => tx(m, x, y)), false, base);
          break;
        }
        case 'INSERT': case 'DIMENSION': {
          if (ctx.depth > 16) break;
          const block = doc.blocks.get(gs(e, 2, '').toUpperCase());
          if (!block) { if (e.type === 'INSERT') skip('INSERT (bloc absent)'); break; }
          const child = { chain: r.chain, layer: r.layer, color: r.color, lw: r.lw, depth: ctx.depth + 1, group: ctx.group ?? ++groupSeq };
          if (e.type === 'DIMENSION') {
            walk(block.entities, { ...child, m });
            break;
          }
          const sx = gn(e, 41, 1), sy = gn(e, 42, sx);
          const rot = gn(e, 50, 0) * DEG;
          const cols = Math.max(1, gi(e, 70, 1)), rows = Math.max(1, gi(e, 71, 1));
          const dc = gn(e, 44, 0), dr = gn(e, 45, 0);
          const ins: Vec = [gn(e, 10, 0), gn(e, 20, 0)];
          const ocsM = gn(e, 230, 1) < 0 ? MIRROR_X : IDENTITY;
          for (let ri = 0; ri < Math.min(rows, 100); ri++) {
            for (let ci = 0; ci < Math.min(cols, 100); ci++) {
              const local = mul(translate(ins[0], ins[1]), mul(rotate(rot), mul(translate(ci * dc, ri * dr), mul(scale(sx, sy), translate(-block.base[0], -block.base[1])))));
              walk(block.entities, { ...child, m: mul(m, mul(ocsM, local)) });
            }
          }
          for (const a of e.attribs ?? []) walk([a], ctx);
          break;
        }
        case 'POINT': case 'ATTDEF': case 'VIEWPORT': case 'SEQEND': case 'XLINE': case 'RAY':
          break;
        default:
          skip(e.type);
      }
    }
  };

  walk(doc.entities, { m: IDENTITY, chain: [], layer: null, color: null, lw: -3, depth: 0 });

  // Statistiques par calque
  const counts = new Map<string, number>();
  for (const p of prims) for (const l of new Set(p.chain)) counts.set(l, (counts.get(l) ?? 0) + 1);
  const layers: DxfLayerInfo[] = [...counts.entries()]
    .map(([name, count]) => {
      const L = doc.layers.get(name);
      return { name, count, color: layerColor(name), defaultVisible: !(L && (L.off || L.frozen)) && !/defpoints/i.test(name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));

  return { prims, layers, insUnits: doc.insUnits, skipped };
}

// ---------------------------------------------------------------------------
// 3. Rendu SVG
// ---------------------------------------------------------------------------

interface Box { minX: number; minY: number; maxX: number; maxY: number }

function primBox(p: DxfPrim): Box {
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => { if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x; if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y; };
  if (p.kind === 'line') p.pts.forEach(([x, y]) => add(x, y));
  else if (p.kind === 'fill') p.rings.forEach((r) => r.forEach(([x, y]) => add(x, y)));
  else {
    // Rectangle approximatif du texte dans son repère (x le long du texte, y vers le haut), puis rotation
    const h = p.height, n = p.lines.length, lh = h * 1.45;
    const len = Math.max(...p.lines.map((l) => l.length)) * h * 0.6;
    const [a0, a1] = p.hAlign === 'start' ? [0, len] : p.hAlign === 'middle' ? [-len / 2, len / 2] : [-len, 0];
    const tot = h + (n - 1) * lh;
    const [b0, b1] = p.vAlign === 'top' ? [-tot, 0] : p.vAlign === 'middle' ? [-tot / 2, tot / 2] : p.vAlign === 'bottom' ? [0, tot] : [-(n - 1) * lh - 0.2 * h, h];
    const c = Math.cos(p.rotation), s = Math.sin(p.rotation);
    for (const [u, v] of [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]) add(p.at[0] + u * c - v * s, p.at[1] + u * s + v * c);
  }
  return b;
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

/** Sélection des primitives visibles et emprise du dessin (éléments très éloignés écartés). */
export function dxfExtent(flat: FlatDxf, visible: Set<string>): { prims: DxfPrim[]; box: Box | null; outliers: number } {
  const sel = flat.prims.filter((p) => p.chain.every((l) => visible.has(l)));
  const boxes = sel.map(primBox).map((b, i) => ({ b, p: sel[i] })).filter(({ b }) => Number.isFinite(b.minX));
  if (!boxes.length) return { prims: [], box: null, outliers: 0 };
  let kept = boxes;
  if (boxes.length >= 20) {
    const xs = boxes.map(({ b }) => (b.minX + b.maxX) / 2).sort((a, c) => a - c);
    const ys = boxes.map(({ b }) => (b.minY + b.maxY) / 2).sort((a, c) => a - c);
    const x0 = quantile(xs, 0.02), x1 = quantile(xs, 0.98), y0 = quantile(ys, 0.02), y1 = quantile(ys, 0.98);
    const mx = Math.max(x1 - x0, y1 - y0, 1e-6) * 0.5;
    kept = boxes.filter(({ b }) => b.maxX >= x0 - mx && b.minX <= x1 + mx && b.maxY >= y0 - mx && b.minY <= y1 + mx);
  }
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { b } of kept) {
    box.minX = Math.min(box.minX, b.minX); box.minY = Math.min(box.minY, b.minY);
    box.maxX = Math.max(box.maxX, b.maxX); box.maxY = Math.max(box.maxY, b.maxY);
  }
  return { prims: kept.map(({ p }) => p), box, outliers: boxes.length - kept.length };
}

export interface DxfRenderOptions {
  visibleLayers: Set<string>;
  /** Mètres par unité du dessin. */
  metersPerUnit: number;
  /** Unités plan par mètre (Floor.unitsPerMeter). */
  unitsPerMeter: number;
  /** Tout dessiner en noir (sinon couleurs d'origine). */
  monochrome: boolean;
}

export interface DxfRenderResult {
  svg: string;
  /** Dimensions en unités plan. */
  width: number;
  height: number;
  /** Dimensions réelles en mètres. */
  widthM: number;
  heightM: number;
  count: number;
  outliers: number;
  /** Passage des coordonnées du dessin aux unités plan : X = (x - minX)·k, Y = (maxY - y)·k. */
  origin: { minX: number; maxY: number; k: number };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderDxfSvg(flat: FlatDxf, opt: DxfRenderOptions): DxfRenderResult {
  const { prims, box, outliers } = dxfExtent(flat, opt.visibleLayers);
  if (!box) throw new DxfError('Aucun élément à importer : cochez au moins un calque contenant des objets.');
  const k = opt.metersPerUnit * opt.unitsPerMeter;
  const W = Math.max(1e-3, (box.maxX - box.minX) * k), H = Math.max(1e-3, (box.maxY - box.minY) * k);
  const r = (v: number) => Math.round(v * 100) / 100;
  const X = (x: number) => r((x - box.minX) * k);
  const Y = (y: number) => r((box.maxY - y) * k);
  const pathOf = (pts: Vec[], closed: boolean) => {
    let d = `M${X(pts[0][0])} ${Y(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) d += `L${X(pts[i][0])} ${Y(pts[i][1])}`;
    return closed ? d + 'Z' : d;
  };
  // Épaisseurs : trait fin par défaut (1,2 cm réels) ; épaisseurs DXF (1/100 mm à l'impression au 1:100)
  const strokeW = (lw: number) => r(Math.max(0.006, lw > 0 ? lw / 1000 : 0.012) * opt.unitsPerMeter);
  const col = (c: string) => (opt.monochrome || c.toLowerCase() === '#ffffff' ? '#000000' : c);

  const strokes = new Map<string, string[]>();
  const fills: string[] = [];
  const texts: string[] = [];
  for (const p of prims) {
    if (p.kind === 'line') {
      const key = `${col(p.color)}|${strokeW(p.lw)}`;
      let arr = strokes.get(key);
      if (!arr) strokes.set(key, (arr = []));
      arr.push(pathOf(p.pts, p.closed));
    } else if (p.kind === 'fill') {
      const d = p.rings.map((ring) => pathOf(ring, true)).join('');
      fills.push(`<path d="${d}" fill="${col(p.color)}"${p.solid ? '' : ' fill-opacity="0.18"'} fill-rule="evenodd"/>`);
    } else {
      const h = p.height * k;
      if (h < 0.05) continue;
      const lh = h * 1.45;
      const n = p.lines.length;
      // décalage vertical de la première ligne (repère SVG : y vers le bas)
      const first = p.vAlign === 'top' ? h : p.vAlign === 'middle' ? h * 0.35 - ((n - 1) * lh) / 2 : p.vAlign === 'bottom' ? -(n - 1) * lh - h * 0.2 : 0;
      const rotDeg = r((-p.rotation * 180) / Math.PI);
      const x = X(p.at[0]), y = Y(p.at[1]);
      const spans = p.lines.map((l, i) => `<tspan x="${x}" y="${r(y + first + i * lh)}">${esc(l)}</tspan>`).join('');
      texts.push(`<text font-size="${r(h)}" fill="${col(p.color)}" text-anchor="${p.hAlign}"${rotDeg ? ` transform="rotate(${rotDeg} ${x} ${y})"` : ''}>${spans}</text>`);
    }
  }
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(W)} ${r(H)}" width="${r(W)}" height="${r(H)}">`);
  if (fills.length) parts.push(`<g stroke="none">${fills.join('')}</g>`);
  parts.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  for (const [key, ds] of strokes) {
    const [c, w] = key.split('|');
    parts.push(`<path stroke="${c}" stroke-width="${w}" d="${ds.join('')}"/>`);
  }
  parts.push('</g>');
  if (texts.length) parts.push(`<g font-family="Arial, Helvetica, sans-serif">${texts.join('')}</g>`);
  parts.push('</svg>');
  return {
    svg: parts.join(''), width: W, height: H,
    widthM: (box.maxX - box.minX) * opt.metersPerUnit, heightM: (box.maxY - box.minY) * opt.metersPerUnit,
    count: prims.length, outliers,
    origin: { minX: box.minX, maxY: box.maxY, k },
  };
}

/** Plus grande dimension (en unités du dessin) des calques visibles par défaut. */
export function dxfMaxDim(flat: FlatDxf, visible: Set<string>): number {
  const { box } = dxfExtent(flat, visible);
  return box ? Math.max(box.maxX - box.minX, box.maxY - box.minY) : 0;
}
