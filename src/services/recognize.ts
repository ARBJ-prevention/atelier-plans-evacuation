/**
 * Reconnaissance d'un plan DXF : transforme les traits du dessin en éléments
 * modifiables du logiciel (murs, portes, fenêtres, escaliers, pièces nommées).
 *
 * Principe :
 *  - chaque calque reçoit un rôle (deviné d'après son nom, modifiable) ;
 *  - escaliers : au moins 4 traits parallèles de même longueur, régulièrement espacés ;
 *  - murs : paires de traits parallèles distants de 4 à 70 cm (double trait), raccordés aux angles ;
 *    cloisons dessinées en simple trait : murs de 7 cm ;
 *  - portes : arcs de 70° à 110° de 50 cm à 1,60 m de rayon (battant), portes doubles regroupées ;
 *  - fenêtres : groupes de traits courts parallèles, recalés dans l'épaisseur du mur ;
 *  - volets : baie de 1,50 m à 8 m fermée par un trait de menuiserie sans battant (rideau, porte sectionnelle,
 *    volet roulant), entre deux murs alignés : fenêtre avec volet roulant, coffre côté extérieur ;
 *  - pièces : contours fermés des calques « pièces », sinon remplissage depuis chaque nom de pièce
 *    jusqu'aux murs (portes refermées).
 * Toutes les coordonnées produites sont en unités plan.
 */
import { makeElement } from '../model/defaults';
import type { AreaElement, DoorElement, Element, Pt, StairsElement, WallElement, WindowElement } from '../model/types';
import type { DxfPrim, FlatDxf, Vec } from './dxf';

export type LayerRole = 'walls' | 'partitions' | 'doors' | 'windows' | 'stairs' | 'rooms' | 'labels' | 'other' | 'ignore';

export const ROLE_LABELS: Record<LayerRole, string> = {
  walls: 'Murs', partitions: 'Cloisons', doors: 'Portes', windows: 'Fenêtres', stairs: 'Escaliers',
  rooms: 'Contours de pièces', labels: 'Noms des pièces', other: 'Autre (à analyser)', ignore: 'Ignorer',
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Devine le rôle d'un calque d'après son nom (conventions françaises, anglaises, néerlandaises, allemandes). */
export function guessLayerRole(name: string): LayerRole {
  const n = norm(name);
  const has = (re: RegExp) => re.test(n);
  // un calque de textes (« TEXTES COTES ») porte souvent les surfaces des pièces ; les cotes chiffrées seules sont écartées ensuite
  if (has(/TEXT|TXT/) && !has(/\bDIM|DIMENS|COTATION|CARTOUCHE|TITLE|TITRE/)) return 'labels';
  if (has(/DEFPOINTS|VIEWPORT|COTE|COTATION|\bDIM|DIMENS|HACH|HATCH|MOBIL|FURN|MEUBL|TOPO|ALTI|NIVEL|POINTS?\b|CARTOUCHE|TITLE|TITRE|\bAXE|AXIS|GRID|TRAME|SANIT|PLOMB|ELEC|ECLAIR|HVAC|CVC|CHAUFF|VENTIL|VEGET|ARBRE|TREE|PARKING|VOIRIE|CADASTRE|PARCEL|LIMITE|CLOTURE|FENCE/)) return 'ignore';
  // conventions numérotées (« 401_SAN_… », « 912_AR_RE_Mur caché ») : sanitaires, seuils et traits cachés
  // (éléments situés au-dessus ou au-dessous du plan de coupe) ne décrivent pas les locaux de l'étage
  if (has(/(^|[^A-Z])SAN([^A-Z]|$)|DIFFUS|SEUIL|THRESH|DREMPEL|SCHWELLE|CACHE|HIDDEN|VERBORGEN|VERDECKT/)) return 'ignore';
  if (has(/CLOIS|PARTITION|DOUBLAGE|PLACO|SCHEIDINGS|ZWISCHENW/)) return 'partitions';
  if (has(/ESCAL|STAIR|TRAP|TREPP|MARCHE|EMMARCH|RAMPE|STEP/)) return 'stairs';
  // volets, rideaux métalliques, portes sectionnelles : menuiseries sans battant, reconnues comme baies à volet
  if (has(/VOLET|RIDEAU|SHUTTER|ROLLUIK|ROLLADEN|ROLLTOR|SECTION+ELLE|SECTIONAL/)) return 'doors';
  if (has(/FENET|WINDOW|WIND|GLAZ|VITR|RAAM|FENST|CHASSIS|\bBAIE/)) return 'windows';
  // menuiseries : intérieures = portes ; extérieures = surtout des fenêtres (les portes sont reconnues par leur battant)
  if (has(/MENUIS|JOINER|SCHRIJNW|TISCHLER/)) return has(/EXT/) ? 'windows' : 'doors';
  if (has(/(^|[^A-Z])PORTE|DOOR|DEUR|TUER|TUR\b|TUREN/)) return 'doors';
  if (has(/MUR|WALL|MAUER|MUUR|WAND|VOILE|MACONN|BETON|PAROI|FACADE|GEVEL|STRUCT|POTEAU|COLUMN|PILIER|PORTEUR/)) return 'walls';
  if (has(/LOCAU|ROOM|PIECE|SURFACE|AREA|ESPACE|RUIMTE|RAUM|LOKAAL/)) return 'rooms';
  if (has(/TEXT|TXT|\bNOM|LABEL|ANNO|IDEN|DESIGN|LIBELLE|NAAM|BESCHRIFT|\bLOCAL\b|N°/)) return 'labels';
  return 'other';
}

/** Ouverture d'un arc de battant de porte (en degrés) : de 30° à 120°. */
export function isDoorSweep(sweep: number): boolean {
  const s = Math.abs(sweep);
  return s >= 30 && s <= 120;
}

export interface RecognizeOptions {
  roles: Record<string, LayerRole>;
  /** Passage des coordonnées du dessin aux unités plan. */
  origin: { minX: number; maxY: number; k: number };
  unitsPerMeter: number;
}

export interface Recognized {
  walls: WallElement[];
  doors: DoorElement[];
  windows: WindowElement[];
  stairs: StairsElement[];
  rooms: AreaElement[];
}

export const RECOGNIZED_KINDS: { key: keyof Recognized; label: string }[] = [
  { key: 'rooms', label: 'Pièces' }, { key: 'walls', label: 'Murs et cloisons' }, { key: 'doors', label: 'Portes' },
  { key: 'windows', label: 'Fenêtres' }, { key: 'stairs', label: 'Escaliers' },
];

/** Éléments à ajouter à l'étage, dans l'ordre de dessin (pièces dessous, ouvertures dessus). */
export function recognizedElements(r: Recognized, kinds: Set<keyof Recognized>): Element[] {
  return (['rooms', 'walls', 'windows', 'stairs', 'doors'] as const).filter((k) => kinds.has(k)).flatMap((k) => r[k] as Element[]);
}

// ---------------------------------------------------------------------------
// Outils géométriques (repère plan : y vers le bas)
// ---------------------------------------------------------------------------

type P = [number, number];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mulv = (a: P, k: number): P => [a[0] * k, a[1] * k];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1];
const cross = (a: P, b: P) => a[0] * b[1] - a[1] * b[0];
const len = (a: P) => Math.hypot(a[0], a[1]);
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: P): P => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a: P): P => [-a[1], a[0]];
const deg = (rad: number) => (rad * 180) / Math.PI;
const round = (v: number) => Math.round(v * 100) / 100;
const rp = (p: P): Pt => [round(p[0]), round(p[1])];

/** Trait du dessin ; `small` : côté d'un petit contour fermé (poteau). */
interface Seg { a: P; b: P; u: P; L: number; layer: string; role: LayerRole; group?: number; free: [number, number][]; id: number; small?: boolean }

/** Angle de direction ramené à [0, 180[ degrés. */
function dirAngle(u: P): number {
  let a = deg(Math.atan2(u[1], u[0]));
  if (a < 0) a += 180;
  if (a >= 180) a -= 180;
  return a;
}
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

/** Intervalles libres moins [a, b]. */
function subtract(free: [number, number][], a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [x, y] of free) {
    if (b <= x || a >= y) { out.push([x, y]); continue; }
    if (a > x) out.push([x, a]);
    if (b < y) out.push([b, y]);
  }
  return out.filter(([x, y]) => y - x > 1e-6);
}
function intersectIntervals(free: [number, number][], a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [x, y] of free) {
    const lo = Math.max(x, a), hi = Math.min(y, b);
    if (hi - lo > 1e-6) out.push([lo, hi]);
  }
  return out;
}

function lineIntersection(p: P, u: P, q: P, v: P): P | null {
  const den = cross(u, v);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(q, p), v) / den;
  return add(p, mulv(u, t));
}

/** Simplification de Douglas-Peucker (polygone fermé). */
export function simplify(pts: P[], tol: number): P[] {
  if (pts.length < 4) return pts;
  const ring = [...pts, pts[0]];
  const rdp = (a: number, b: number, out: P[]) => {
    let best = -1, bi = -1;
    const A = ring[a], B = ring[b], AB = sub(B, A), L = len(AB) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(cross(AB, sub(ring[i], A))) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { rdp(a, bi, out); out.push(ring[bi]); rdp(bi, b, out); }
  };
  // départ au point le plus éloigné du premier pour un polygone fermé
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = dist(pts[0], pts[i]); if (d > fd) { fd = d; far = i; } }
  const out: P[] = [pts[0]];
  rdp(0, far, out);
  out.push(pts[far]);
  rdp(far, ring.length - 1, out);
  return out;
}

export function polygonAreaAbs(p: P[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return Math.abs(a / 2);
}

function pointInPolygon(pt: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Reconnaissance
// ---------------------------------------------------------------------------

export function recognizePlan(flat: FlatDxf, opt: RecognizeOptions): Recognized {
  const m = opt.unitsPerMeter;
  const { minX, maxY, k } = opt.origin;
  const T = (v: Vec): P => [(v[0] - minX) * k, (maxY - v[1]) * k];
  const roleOf = (p: DxfPrim): LayerRole => {
    // un objet est ignoré si l'un des calques de sa chaîne est décoché / ignoré
    if (p.chain.some((l) => (opt.roles[l] ?? 'ignore') === 'ignore')) return 'ignore';
    return opt.roles[p.layer] ?? 'ignore';
  };

  // 1. Segments (dédoublonnés) et objets utiles
  const segs: Seg[] = [];
  const seen = new Set<string>();
  const arcs: { c: P; r: number; p0: P; p1: P; sweep: number; group?: number; role: LayerRole }[] = [];
  const texts: { at: P; lines: string[]; height: number }[] = [];
  const closedPolys: P[][] = [];
  const keyOf = (a: P, b: P) => {
    const ka = `${Math.round(a[0] * 10)},${Math.round(a[1] * 10)}`, kb = `${Math.round(b[0] * 10)},${Math.round(b[1] * 10)}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const pushSeg = (a: P, b: P, prim: DxfPrim, role: LayerRole, small = false) => {
    const L = dist(a, b);
    if (L < 0.02 * m) return;
    const key = keyOf(a, b);
    if (seen.has(key)) return;
    seen.add(key);
    segs.push({ a, b, u: unit(sub(b, a)), L, layer: prim.layer, role, group: prim.group, free: [[0, L]], id: segs.length, ...(small ? { small } : {}) });
  };
  for (const p of flat.prims) {
    const role = roleOf(p);
    if (role === 'ignore') continue;
    if (p.kind === 'text') {
      if (role === 'labels' || role === 'rooms') texts.push({ at: T(p.at), lines: p.lines, height: p.height * k });
      continue;
    }
    if (p.kind === 'line') {
      const pts = p.pts.map(T);
      if (p.arc) {
        arcs.push({ c: T(p.arc.c), r: p.arc.r * k, p0: T(p.arc.p0), p1: T(p.arc.p1), sweep: p.arc.sweep, group: p.group, role });
      }
      if (role === 'rooms' && p.closed && pts.length >= 3) closedPolys.push(pts);
      if (p.arc && role !== 'walls' && role !== 'partitions') continue; // battants de porte : pas des murs
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const small = p.closed && Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 0.6 * m;
      for (let i = 0; i + 1 < pts.length; i++) pushSeg(pts[i], pts[i + 1], p, role, small);
      if (p.closed && pts.length > 2) pushSeg(pts[pts.length - 1], pts[0], p, role, small);
    } else if (p.kind === 'fill' && (role === 'walls' || role === 'partitions')) {
      for (const ring of p.rings) {
        const pts = ring.map(T);
        for (let i = 0; i < pts.length; i++) pushSeg(pts[i], pts[(i + 1) % pts.length], p, role);
      }
    }
  }
  const hasWallLayer = Object.values(opt.roles).includes('walls');
  const isWallRole = (r: LayerRole) => r === 'walls' || r === 'partitions' || (!hasWallLayer && r === 'other');

  // 2. Escaliers
  const stairs: StairsElement[] = [];
  const used = new Set<number>();
  {
    const cand = segs.filter((s) => (s.role === 'stairs' || isWallRole(s.role) || s.role === 'other') && s.L >= 0.6 * m && s.L <= 4 * m);
    const buckets = new Map<number, Seg[]>();
    for (const s of cand) {
      const b = Math.round(dirAngle(s.u)) % 180;
      (buckets.get(b) ?? buckets.set(b, []).get(b)!).push(s);
    }
    for (const group of buckets.values()) {
      if (group.length < 4) continue;
      const u = group[0].u, n = perp(u);
      // regroupe par longueur et position le long des marches
      const sorted = group.filter((s) => !used.has(s.id)).sort((a, b) => dot(a.a, n) + dot(a.b, n) - dot(b.a, n) - dot(b.b, n));
      let i = 0;
      while (i < sorted.length) {
        const run = [sorted[i]];
        let spacing = 0;
        for (let j = i + 1; j < sorted.length; j++) {
          const last = run[run.length - 1], s = sorted[j];
          if (Math.abs(s.L - last.L) > Math.max(0.03 * m, last.L * 0.05)) continue;
          const mid = (x: Seg) => mulv(add(x.a, x.b), 0.5);
          const along = Math.abs(dot(sub(mid(s), mid(last)), u));
          if (along > 0.1 * m) continue;
          const gap = Math.abs(dot(sub(mid(s), mid(last)), n));
          if (gap < 0.005 * m) continue;
          if (!spacing) {
            if (gap >= 0.2 * m && gap <= 0.4 * m) { spacing = gap; run.push(s); } else if (gap > 0.4 * m) break;
          } else if (Math.abs(gap - spacing) <= spacing * 0.15) run.push(s);
          else if (gap > spacing * 1.15) break;
        }
        if (run.length >= 4 && spacing) {
          const mids = run.map((x) => mulv(add(x.a, x.b), 0.5));
          const first = mids[0], last = mids[mids.length - 1];
          const c = mulv(add(first, last), 0.5);
          const w = run.reduce((acc, x) => acc + x.L, 0) / run.length;
          const steps = run.length + 1;
          const h = spacing * steps;
          const rot = deg(Math.atan2(u[1], u[0]));
          stairs.push(makeElement('stairs', {
            x: round(c[0]), y: round(c[1]), w: round(w), h: round(h), steps, rotation: round(rot), arrow: false,
          }) as StairsElement);
          run.forEach((x) => used.add(x.id));
          i = sorted.indexOf(run[run.length - 1]) + 1;
        } else i++;
      }
    }
  }

  // 3. Murs : paires de traits parallèles
  const walls: { a: P; b: P; t: number }[] = [];
  {
    const wallSegs = segs.filter((s) => isWallRole(s.role) && !used.has(s.id));
    const tMin = 0.04 * m, tMax = 0.7 * m;
    const buckets = new Map<number, Seg[]>();
    for (const s of wallSegs) {
      const b = Math.round(dirAngle(s.u) / 2) % 90;
      (buckets.get(b) ?? buckets.set(b, []).get(b)!).push(s);
    }
    const pairs: { A: Seg; B: Seg; d: number }[] = [];
    const keys = [...buckets.keys()];
    for (const key of keys) {
      const list = [...(buckets.get(key) ?? []), ...(buckets.get((key + 1) % 90) ?? [])];
      const own = buckets.get(key)!;
      for (const A of own) {
        const nA = perp(A.u);
        for (const B of list) {
          if (B === A || (own.includes(B) && B.id < A.id)) continue;
          if (angleDiff(dirAngle(A.u), dirAngle(B.u)) > 3) continue;
          const d1 = dot(sub(B.a, A.a), nA), d2 = dot(sub(B.b, A.a), nA);
          if (Math.sign(d1) !== Math.sign(d2) || Math.abs(d1 - d2) > 0.03 * m) continue;
          const d = (Math.abs(d1) + Math.abs(d2)) / 2;
          if (d < tMin || d > tMax) continue;
          const t1 = dot(sub(B.a, A.a), A.u), t2 = dot(sub(B.b, A.a), A.u);
          const ov = Math.min(A.L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
          if (ov < Math.max(0.1 * m, d * 0.5)) continue;
          pairs.push({ A, B, d });
        }
      }
    }
    pairs.sort((x, y) => x.d - y.d);
    for (const { A, B, d } of pairs) {
      const nA = perp(A.u);
      const side = Math.sign(dot(sub(B.a, A.a), nA)) || 1;
      const t1 = dot(sub(B.a, A.a), A.u), t2 = dot(sub(B.b, A.a), A.u);
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(A.L, Math.max(t1, t2));
      // passage des paramètres A ↔ B (projection orthogonale)
      const toB = (t: number) => dot(sub(add(A.a, mulv(A.u, t)), B.a), B.u);
      const toA = (t: number) => dot(sub(add(B.a, mulv(B.u, t)), A.a), A.u);
      for (const [x, y] of intersectIntervals(A.free, lo, hi)) {
        const bx = toB(x), by = toB(y);
        for (const [p, q] of intersectIntervals(B.free, Math.min(bx, by), Math.max(bx, by))) {
          const ap = toA(p), aq = toA(q);
          const a0 = Math.max(x, Math.min(ap, aq)), a1 = Math.min(y, Math.max(ap, aq));
          if (a1 - a0 < Math.max(0.1 * m, d * 0.5)) continue;
          const off = mulv(nA, (side * d) / 2);
          walls.push({ a: add(add(A.a, mulv(A.u, a0)), off), b: add(add(A.a, mulv(A.u, a1)), off), t: d });
          A.free = subtract(A.free, a0, a1);
          const b0 = toB(a0), b1 = toB(a1);
          B.free = subtract(B.free, Math.min(b0, b1), Math.max(b0, b1));
        }
      }
    }
    // Cloisons et murs dessinés en simple trait (gaines, cages d'escalier, annexes…) ;
    // un trait resté seul le long d'un mur déjà reconnu en est une face, pas un mur de plus
    const paired = walls.slice();
    const nearPaired = (p: P) => paired.some((w) => distToSeg(p, w.a, w.b) <= w.t / 2 + 0.08 * m);
    for (const s of wallSegs) {
      if (s.role !== 'partitions' && s.role !== 'walls') continue;
      for (const [x, y] of s.free) {
        if (y - x < 0.5 * m) continue;
        const a = add(s.a, mulv(s.u, x)), b = add(s.a, mulv(s.u, y));
        if (s.role === 'walls' && nearPaired(mulv(add(a, b), 0.5))) continue;
        walls.push({ a, b, t: (s.role === 'walls' ? 0.1 : 0.07) * m });
      }
    }
    // Fusion des murs colinéaires qui se touchent
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < walls.length; i++) {
        for (let j = i + 1; j < walls.length; j++) {
          const W1 = walls[i], W2 = walls[j];
          if (Math.abs(W1.t - W2.t) > Math.max(W1.t, W2.t) * 0.15) continue;
          const u = unit(sub(W1.b, W1.a)), v = unit(sub(W2.b, W2.a));
          if (angleDiff(dirAngle(u), dirAngle(v)) > 2) continue;
          if (Math.abs(dot(sub(W2.a, W1.a), perp(u))) > W1.t * 0.25 || Math.abs(dot(sub(W2.b, W1.a), perp(u))) > W1.t * 0.25) continue;
          const L1 = dist(W1.a, W1.b);
          const s0 = dot(sub(W2.a, W1.a), u), s1 = dot(sub(W2.b, W1.a), u);
          const lo2 = Math.min(s0, s1), hi2 = Math.max(s0, s1);
          if (lo2 > L1 + 0.03 * m || hi2 < -0.03 * m) continue;
          const lo = Math.min(0, lo2), hi = Math.max(L1, hi2);
          walls[i] = { a: add(W1.a, mulv(u, lo)), b: add(W1.a, mulv(u, hi)), t: Math.max(W1.t, W2.t) };
          walls.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
    joinCorners(walls, m);
  }

  // 4. Portes
  const doors: DoorElement[] = [];
  const doorGroups = new Set<number>();
  {
    // battants dessinés ouverts de 30° (souvent 45°) jusqu'à 120°
    const cand = arcs.filter((a) => a.role !== 'stairs' && isDoorSweep(a.sweep) && a.r >= 0.5 * m && a.r <= 1.6 * m);
    for (const a of cand) if (a.group != null) doorGroups.add(a.group);
    const leaves: { H: P; C: P; O: P; r: number }[] = [];
    const tol = 0.06 * m;
    const lineSegs = segs.filter((s) => s.role !== 'ignore');
    for (const a of cand) {
      const H = a.c;
      // l'extrémité reliée à la charnière par un trait (le battant ouvert) est O ; l'autre, dans le mur, est C
      const hasLeaf = (P0: P) => lineSegs.some((s) => (a.group == null || s.group === a.group || s.role === 'doors')
        && ((dist(s.a, H) < tol && dist(s.b, P0) < tol) || (dist(s.b, H) < tol && dist(s.a, P0) < tol)));
      let O = a.p0, C = a.p1;
      if (hasLeaf(a.p1) && !hasLeaf(a.p0)) { O = a.p1; C = a.p0; }
      else if (!hasLeaf(a.p0) && !hasLeaf(a.p1)) {
        // sans battant dessiné : l'extrémité alignée avec le mur le plus proche est la position fermée
        const align = (P0: P) => {
          const d = unit(sub(P0, H));
          let best = 0;
          for (const w of walls) {
            const wu = unit(sub(w.b, w.a));
            const near = Math.abs(dot(sub(H, w.a), perp(wu))) < w.t + tol;
            if (near) best = Math.max(best, Math.abs(dot(d, wu)));
          }
          return best;
        };
        if (align(a.p0) > align(a.p1)) { C = a.p0; O = a.p1; }
      }
      if (leaves.some((l) => dist(l.H, H) < tol && Math.abs(l.r - a.r) < tol)) continue; // doublon
      leaves.push({ H, C, O, r: a.r });
    }
    const usedLeaf = new Set<number>();
    for (let i = 0; i < leaves.length; i++) {
      if (usedLeaf.has(i)) continue;
      const L1 = leaves[i];
      // porte double : deux battants dont les positions fermées se rejoignent
      let j = -1;
      for (let q = i + 1; q < leaves.length; q++) {
        if (usedLeaf.has(q)) continue;
        const L2 = leaves[q];
        if (dist(L1.C, L2.C) < tol * 2 && Math.abs(dist(L1.H, L2.H) - (L1.r + L2.r)) < tol * 2) { j = q; break; }
      }
      let H1 = L1.H, H2: P, width: number, doorType: 'single' | 'double' = 'single';
      if (j >= 0) { usedLeaf.add(j); H2 = leaves[j].H; width = dist(H1, H2); doorType = 'double'; }
      else { H2 = L1.C; width = L1.r; }
      const u = unit(sub(H2, H1));
      const theta = Math.atan2(u[1], u[0]);
      const openDir: P = [Math.sin(theta), -Math.cos(theta)]; // -y local
      const flipY = dot(sub(L1.O, L1.H), openDir) < 0;
      const c = mulv(add(H1, H2), 0.5);
      doors.push(makeElement('door', {
        x: round(c[0]), y: round(c[1]), width: round(width), rotation: round(deg(theta)), swing: 'left', doorType, ...(flipY ? { flipY: true } : {}),
      }) as DoorElement);
      usedLeaf.add(i);
    }
  }

  // 5. Fenêtres
  const windows: WindowElement[] = [];
  {
    // un bloc qui contient un battant de porte (porte extérieure sur le calque des menuiseries) n'est pas une fenêtre
    const ws = segs.filter((s) => s.role === 'windows' && (s.group == null || !doorGroups.has(s.group)));
    const parent = ws.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const join = (i: number, j: number) => { parent[find(i)] = find(j); };
    const tol = 0.05 * m;
    for (let i = 0; i < ws.length; i++) {
      for (let j = i + 1; j < ws.length; j++) {
        const A = ws[i], B = ws[j];
        if (A.group != null && A.group === B.group) { join(i, j); continue; }
        const touch = Math.min(dist(A.a, B.a), dist(A.a, B.b), dist(A.b, B.a), dist(A.b, B.b)) < tol;
        let parallel = false;
        if (angleDiff(dirAngle(A.u), dirAngle(B.u)) < 3) {
          const d = Math.abs(dot(sub(B.a, A.a), perp(A.u)));
          const t1 = dot(sub(B.a, A.a), A.u), t2 = dot(sub(B.b, A.a), A.u);
          const ov = Math.min(A.L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
          parallel = d < 0.45 * m && ov > Math.min(A.L, B.L) * 0.6;
        }
        if (touch || parallel) join(i, j);
      }
    }
    const clusters = new Map<number, Seg[]>();
    ws.forEach((s, i) => { const r = find(i); (clusters.get(r) ?? clusters.set(r, []).get(r)!).push(s); });
    for (const cl of clusters.values()) {
      const main = cl.reduce((a, b) => (b.L > a.L ? b : a));
      const u = main.u, n = perp(u);
      const pts = cl.flatMap((s) => [s.a, s.b]);
      const us = pts.map((p) => dot(p, u)), ns = pts.map((p) => dot(p, n));
      const u0 = Math.min(...us), u1 = Math.max(...us), n0 = Math.min(...ns), n1 = Math.max(...ns);
      const width = u1 - u0;
      let depth = n1 - n0;
      if (width < 0.3 * m || width > 8 * m || depth > 0.8 * m) continue;
      let c: P = add(mulv(u, (u0 + u1) / 2), mulv(n, (n0 + n1) / 2));
      // recalage dans le mur parallèle qui la contient
      for (const w of walls) {
        const wu = unit(sub(w.b, w.a));
        if (angleDiff(dirAngle(wu), dirAngle(u)) > 5) continue;
        const off = dot(sub(c, w.a), perp(wu));
        const s = dot(sub(c, w.a), wu);
        if (Math.abs(off) <= w.t / 2 + 0.05 * m && s >= -0.05 * m && s <= dist(w.a, w.b) + 0.05 * m) {
          c = sub(c, mulv(perp(wu), off));
          depth = w.t;
          break;
        }
      }
      if (depth < 0.03 * m) depth = 0.2 * m;
      windows.push(makeElement('window', {
        x: round(c[0]), y: round(c[1]), width: round(width), depth: round(depth), panes: width > 1.2 * m ? 2 : 1, rotation: round(deg(Math.atan2(u[1], u[0]))),
      }) as WindowElement);
    }
  }

  // 5 bis. Mise au propre pour un plan d'évacuation : murs continus au droit des portes et fenêtres,
  // poteaux et petits retours supprimés, murs extérieurs plus épais que les murs intérieurs,
  // ouvertures calées dans leur mur (comme si elles avaient été posées à la main).
  pruneWindows(windows, doors, m);
  const freeSegs = segs.filter((s) => !used.has(s.id) && (s.group == null || !doorGroups.has(s.group)));
  // 5 ter. Entrées vitrées (sas) : façade en menuiserie avec des vantaux au milieu → mur de façade et grande porte
  const entrances = glazedEntrances(freeSegs, walls, [...doors, ...windows], m);
  for (const e of entrances) { walls.push(e.wall); doors.push(e.door); }
  // 5 quater. Baies fermées par un volet (trait de menuiserie sans battant dans un trou de mur)
  const bays = shutterBays(freeSegs, walls, [...doors, ...windows], m);
  windows.push(...bays);
  const openings: Opening[] = [...doors, ...windows];
  const obstacleSegs = segs.filter((s) => isWallRole(s.role) || s.role === 'windows' || s.role === 'doors');
  wallsUnderWindowRuns(walls, windows, m);
  // chaque porte ou fenêtre compte comme un morceau de mur : les murs de part et d'autre se rejoignent à travers elle
  walls.push(...openingWalls(openings, walls, m));
  mergeAcrossOpenings(walls, openings, m);
  for (let i = walls.length - 1; i >= 0; i--) if (dist(walls[i].a, walls[i].b) < 0.5 * m) walls.splice(i, 1);
  extendToOpenings(walls, openings, m);
  joinCorners(walls, m);
  const isOut = normalizeThickness(walls, openings, obstacleSegs, m);
  mergeAcrossOpenings(walls, openings, m); // les morceaux d'une même façade ont maintenant la même épaisseur
  // raccord final : chaque extrémité rejoint l'axe du mur voisin (jusqu'à 60 cm), comme un mur tracé à l'aimant
  joinCorners(walls, m, 0.6 * m, openings);
  touchCollinear(walls, openings, m);
  dropLooseOpeningWalls(walls, m);
  const hosted = snapOpenings(openings, walls, m);
  // une fenêtre qui ne repose sur aucun mur (battant ou appui mal interprété) n'est pas gardée
  for (let i = windows.length - 1; i >= 0; i--) if (!hosted.has(windows[i])) windows.splice(i, 1);
  // la porte d'une entrée vitrée s'ouvre vers l'extérieur (sens de l'évacuation)
  if (isOut) for (const { door: d } of entrances) {
    const u = openingDir(d), sideA: P = [u[1], -u[0]], c: P = [d.x, d.y];
    const count = (side: number) => [-0.3, 0, 0.3].filter((f) => isOut(add(add(c, mulv(u, d.width * f)), mulv(sideA, side * 0.5 * m)))).length;
    if (count(-1) > count(1)) d.flipY = true; else delete d.flipY;
  }
  // le coffre du volet se place du côté extérieur de la façade (côté A, sinon côté B)
  if (isOut) for (const w of bays) {
    const u = openingDir(w), sideA: P = [u[1], -u[0]], c: P = [w.x, w.y];
    const count = (side: number) => [-0.3, 0, 0.3].filter((f) => isOut(add(add(c, mulv(u, w.width * f)), mulv(sideA, side * (w.depth / 2 + 0.3 * m))))).length;
    if (count(-1) > count(1)) w.flipY = true;
  }
  markFireDoors(doors, texts, m);
  flushEnds(walls, m);
  const finalWalls = walls.filter((w) => dist(w.a, w.b) >= 0.5 * m); // pas de petits morceaux dans le plan final
  const wallEls: WallElement[] = finalWalls
    .map((w) => makeElement('wall', { points: [rp(w.a), rp(w.b)], thickness: round(w.t), wallStyle: 'solid' }) as WallElement);

  // 6. Pièces
  const rooms: AreaElement[] = [];
  const labelOf = (lines: string[]) => {
    const isArea = (l: string) => /^\s*(s\s*[:=]\s*)?[\d\s.,]+\s*(m²|m2)?\s*$/i.test(l) || /\d\s*(m²|m2)\s*$/i.test(l);
    // niveaux, degrés coupe-feu, hauteurs : annotations techniques, pas des noms de pièces
    const isTechnical = (l: string) => /^\s*(NIV\b|N\.?G\.?F|R?E\.?I\.?\s*\d|[CP]F\s*\d|H\s*=|HSP\b|Ø)/i.test(l);
    const keep = lines.filter((l) => l.trim() && !isArea(l) && !isTechnical(l));
    return { label: keep.join('\n').trim(), hadArea: lines.some((l) => /m²|m2/i.test(l)) };
  };
  // taille des noms : celle du dessin, mais lisible à l'échelle de l'affiche (au moins 35 cm, ~1 % de la taille du bâtiment)
  const xs = segs.flatMap((s) => [s.a[0], s.b[0]]), ys = segs.flatMap((s) => [s.a[1], s.b[1]]);
  const span = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0;
  const minLabel = Math.min(1 * m, Math.max(0.35 * m, span / 110));
  const labelSize = (h: number) => Math.max(minLabel, Math.min(1 * m, h * 1.1));
  const makeRoom = (poly: P[], txt: { lines: string[]; height: number } | null) => {
    const { label, hadArea } = txt ? labelOf(txt.lines) : { label: '', hadArea: false };
    rooms.push(makeElement('area', {
      kind: 'room', points: poly.map(rp), label, showArea: hadArea, labelSize: round(txt ? labelSize(txt.height) : 0.3 * m), strokeWidth: 0,
    }) as AreaElement);
  };
  // les textes posés dans un escalier reconnu (« Escalier », « Montée »…) ne sont pas des noms de pièces
  const inStairs = (p: P) => stairs.some((s) => {
    const th = (s.rotation * Math.PI) / 180, u: P = [Math.cos(th), Math.sin(th)];
    const d = sub(p, [s.x, s.y]);
    return Math.abs(dot(d, u)) <= s.w / 2 + 0.1 * m && Math.abs(dot(d, perp(u))) <= s.h / 2 + 0.1 * m;
  });
  const named = texts.filter((t) => labelOf(t.lines).label.length > 0 && !inStairs(t.at));
  // surfaces seules (« 62,30 m² ») : souvent au centre de la pièce, alors que le numéro peut être posé sur la porte
  const surfaces = texts.filter((t) => !labelOf(t.lines).label && labelOf(t.lines).hadArea && !inStairs(t.at));
  if (closedPolys.length) {
    for (const poly of closedPolys) {
      if (polygonAreaAbs(poly) < 1 * m * m) continue;
      const inside = named.filter((t) => pointInPolygon(t.at, poly)).sort((a, b) => b.height - a.height);
      makeRoom(poly, inside[0] ?? null);
    }
  } else if ((named.length || surfaces.length) && (wallEls.length || segs.some((s) => isWallRole(s.role)))) {
    // les traits des menuiseries referment aussi les murs (baies, grandes portes sans battant dessiné)
    // les pièces vont jusqu'aux murs redessinés ; les traits d'origine ne servent que si une pièce s'ouvre sur l'extérieur
    const seeds = [...surfaces, ...named];
    // limites : murs redessinés et traits des murs et fenêtres du dessin, sans les menuiseries (vantaux, casiers, cadres)
    // (les contours des poteaux supprimés ne découpent pas les pièces)
    const wallLines = segs.filter((s) => (isWallRole(s.role) || s.role === 'windows') && !s.small);
    // menuiseries (portails, baies vitrées sans fenêtre reconnue) et escaliers referment le bâtiment pour la complétion
    // (sans les vantaux et cadres des portes reconnues : ils enfermeraient un coin d'extérieur devant les portes de façade)
    const inDoor = (p: P) => doors.some((d) => dist(p, [d.x, d.y]) <= d.width * 1.05 + 0.1 * m);
    const closers = segs.filter((s) => (s.role === 'doors' || s.role === 'stairs') && !(inDoor(s.a) && inDoor(s.b)));
    const clean = floodRooms(seeds, finalWalls, [...doors, ...windows], wallLines, m, labelOf, labelSize, true, closers, stairs);
    rooms.push(...clean.rooms);
    if (clean.unplaced.length) {
      const fallback = floodRooms(clean.unplaced, finalWalls, [...doors, ...windows], obstacleSegs, m, labelOf, labelSize, false);
      rooms.push(...fallback.rooms.filter((r) => !clean.rooms.some((c) => pointInPolygon(centroidOf(r.points as P[]), c.points as P[]))));
    }
  }

  return { walls: wallEls, doors, windows, stairs, rooms };
}

/** Mur en cours de mise au propre ; `v` : morceau né d'une porte ou d'une fenêtre (sans mur dessiné). */
type RawWall = { a: P; b: P; t: number; v?: boolean };
type Opening = DoorElement | WindowElement;

function distToSeg(p: P, a: P, b: P): number {
  const ab = sub(b, a), L2 = dot(ab, ab);
  const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)) : 0;
  return dist(p, add(a, mulv(ab, t)));
}

/**
 * Raccord des angles et des jonctions en T : chaque extrémité est prolongée (ou recoupée) jusqu'à l'axe
 * du mur qu'elle rejoint. `extra` élargit la portée ; un prolongement ne traverse jamais une porte ou une fenêtre.
 */
function joinCorners(walls: RawWall[], m: number, extra = 0, openings: Opening[] = []) {
  for (let i = 0; i < walls.length; i++) {
    for (const end of ['a', 'b'] as const) {
      const W = walls[i];
      const E = W[end];
      const u = unit(sub(W.b, W.a));
      let best: { X: P; d: number } | null = null;
      for (let j = 0; j < walls.length; j++) {
        if (j === i) continue;
        const V = walls[j];
        const v = unit(sub(V.b, V.a));
        if (angleDiff(dirAngle(u), dirAngle(v)) < 20) continue;
        const X = lineIntersection(E, u, V.a, v);
        if (!X) continue;
        const reach = Math.max(W.t, V.t) * 1.05 + 0.02 * m + extra;
        const dE = dist(X, E);
        if (dE > reach) continue;
        const LV = dist(V.a, V.b), sV = dot(sub(X, V.a), v);
        if (sV < -Math.max(W.t, V.t) || sV > LV + Math.max(W.t, V.t)) continue;
        // ne pas raccourcir un mur au-delà de son autre extrémité
        const other = end === 'a' ? W.b : W.a;
        if (dot(sub(X, other), sub(E, other)) <= 0) continue;
        if (extra && dot(sub(X, E), sub(E, other)) > 0 && openings.some((o) => distToSeg([o.x, o.y], E, X) <= W.t / 2 + 0.1 * m)) continue;
        if (!best || dE < best.d) best = { X, d: dE };
      }
      if (best) walls[i] = { ...W, [end]: best.X };
    }
  }
}

/**
 * Murs alignés d'épaisseurs différentes (façade puis mur intérieur dans le prolongement) séparés de moins
 * de 60 cm sans ouverture entre eux : l'extrémité la plus proche rejoint l'autre mur, pour qu'ils se touchent.
 */
function touchCollinear(walls: RawWall[], openings: Opening[], m: number) {
  for (let i = 0; i < walls.length; i++) {
    for (const end of ['a', 'b'] as const) {
      const W = walls[i], E = W[end], other = end === 'a' ? W.b : W.a;
      const out = unit(sub(E, other));
      let best: { F: P; d: number } | null = null;
      for (let j = 0; j < walls.length; j++) {
        if (j === i) continue;
        const V = walls[j], v = unit(sub(V.b, V.a));
        if (angleDiff(dirAngle(out), dirAngle(v)) > 3) continue;
        if (Math.abs(dot(sub(V.a, E), perp(out))) > Math.max(W.t, V.t) / 2 + 0.02 * m) continue;
        for (const F of [V.a, V.b]) {
          const ahead = dot(sub(F, E), out), d = dist(F, E);
          if (ahead <= 0.005 * m || d > 0.6 * m) continue;
          if (openings.some((o) => distToSeg([o.x, o.y], E, F) <= W.t / 2 + 0.1 * m)) continue;
          if (!best || d < best.d) best = { F, d };
        }
      }
      if (best) walls[i] = { ...W, [end]: add(E, mulv(out, dot(sub(best.F, E), out))) };
    }
  }
}

function centroidOf(pts: P[]): P {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

/** Fenêtres parasites : trop petites (< 50 cm) ou posées sur une porte (cadre d'une porte extérieure). */
function pruneWindows(windows: WindowElement[], doors: DoorElement[], m: number) {
  for (let i = windows.length - 1; i >= 0; i--) {
    const w = windows[i];
    if (w.width < 0.5 * m) { windows.splice(i, 1); continue; }
    const u = openingDir(w);
    const onDoor = doors.some((d) => {
      if (angleDiff(dirAngle(openingDir(d)), dirAngle(u)) > 15) return false;
      const rel = sub([d.x, d.y], [w.x, w.y]);
      if (Math.abs(dot(rel, perp(u))) > 0.4 * m) return false;
      const along = dot(rel, u);
      const overlap = Math.min(w.width / 2, along + d.width / 2) - Math.max(-w.width / 2, along - d.width / 2);
      return overlap > 0.3 * Math.min(w.width, d.width);
    });
    if (onDoor) windows.splice(i, 1);
  }
}

/**
 * Baies fermées par un volet : un trait de menuiserie de 1,50 m à 8 m, sans battant de porte, tendu dans un trou
 * de mur (ses deux bouts rejoignent un mur, une porte ou une fenêtre alignés) : rideau métallique, porte
 * sectionnelle, volet roulant. Chaque baie devient une fenêtre avec volet roulant.
 */
function shutterBays(segs: Seg[], walls: RawWall[], openings: Opening[], m: number): WindowElement[] {
  const bays: WindowElement[] = [];
  const cand = segs.filter((s) => s.role === 'doors' && s.L >= 1.5 * m && s.L <= 8 * m).sort((a, b) => b.L - a.L);
  if (!cand.length) return bays;
  // appuis possibles : murs, portes et fenêtres déjà reconnues
  const supports: RawWall[] = [
    ...walls.filter((w) => dist(w.a, w.b) >= 0.2 * m),
    ...openings.map((o) => {
      const u = openingDir(o), c: P = [o.x, o.y];
      return { a: sub(c, mulv(u, o.width / 2)), b: add(c, mulv(u, o.width / 2)), t: o.type === 'window' ? o.depth : 0.15 * m };
    }),
  ];
  for (const s of cand) {
    const mid = mulv(add(s.a, s.b), 0.5), n = perp(s.u);
    // déjà une porte, une fenêtre ou une baie à cet endroit
    const taken = [...openings, ...bays].some((o) => {
      if (angleDiff(dirAngle(openingDir(o)), dirAngle(s.u)) > 15) return false;
      const rel = sub([o.x, o.y], mid);
      if (Math.abs(dot(rel, n)) > 0.5 * m) return false;
      const along = dot(rel, s.u);
      return Math.min(s.L / 2, along + o.width / 2) - Math.max(-s.L / 2, along - o.width / 2) > 0.3 * Math.min(s.L, o.width);
    });
    if (taken) continue;
    // un trait posé le long d'un mur plein (cadre, doublage) n'est pas une baie
    const k = Math.max(4, Math.round(s.L / (0.25 * m)));
    let covered = 0;
    for (let i = 1; i < k; i++) {
      const p = add(s.a, mulv(s.u, (s.L * i) / k));
      if (walls.some((w) => dist(w.a, w.b) >= 0.5 * m && distToSeg(p, w.a, w.b) <= w.t / 2 + 0.05 * m)) covered++;
    }
    if (covered / (k - 1) > 0.25) continue;
    // chaque bout rejoint un appui aligné qui se poursuit au-delà (à 80 cm près : poteau, tableau de la baie)
    const anchor = (E: P, out: P): RawWall | null => {
      let best: RawWall | null = null, bestD = Infinity;
      for (const w of supports) {
        const wu = unit(sub(w.b, w.a)), L = dist(w.a, w.b);
        if (angleDiff(dirAngle(wu), dirAngle(s.u)) > 5) continue;
        const rel = sub(E, w.a), sE = dot(rel, wu);
        if (Math.abs(dot(rel, perp(wu))) > w.t / 2 + 0.15 * m) continue;
        const beyond = sE < 0 ? -sE : sE > L ? sE - L : 0;
        if (beyond > 0.8 * m) continue;
        if (Math.max(dot(sub(w.a, E), out), dot(sub(w.b, E), out)) < 0.1 * m) continue;
        if (beyond < bestD) { best = w; bestD = beyond; }
      }
      return best;
    };
    const A = anchor(s.a, mulv(s.u, -1)), B = anchor(s.b, s.u);
    if (!A || !B) continue;
    // axe et épaisseur : ceux de l'appui le plus long
    const host = dist(A.a, A.b) >= dist(B.a, B.b) ? A : B;
    const hn = perp(unit(sub(host.b, host.a)));
    const c = sub(mid, mulv(hn, dot(sub(mid, host.a), hn)));
    bays.push(makeElement('window', {
      x: round(c[0]), y: round(c[1]), width: round(s.L), depth: round(Math.max(0.1 * m, host.t)), panes: 1,
      rotation: round(deg(Math.atan2(s.u[1], s.u[0]))), shutter: 'rolling',
    }) as WindowElement);
  }
  return bays;
}

/**
 * Entrée vitrée (sas) : une façade dessinée en menuiserie (traits parallèles de 1,50 m à 8 m, sans battant),
 * dont les deux bouts reposent sur des murs et dont une partie est en retrait (les vantaux de la porte).
 * Elle devient un mur de façade sur toute sa largeur, avec une porte coulissante double à la place des vantaux.
 */
function glazedEntrances(segs: Seg[], walls: RawWall[], openings: Opening[], m: number): { wall: RawWall; door: DoorElement }[] {
  const out: { wall: RawWall; door: DoorElement }[] = [];
  const cand = segs.filter((s) => s.role === 'doors' && s.L >= 0.3 * m);
  const consumed = new Set<Seg>();
  for (const seed of [...cand].sort((a, b) => b.L - a.L)) {
    if (consumed.has(seed) || seed.L < 0.8 * m) continue;
    const u = seed.u, n = perp(u), off = (p: P) => dot(sub(p, seed.a), n), at = (p: P) => dot(sub(p, seed.a), u);
    // traits parallèles proches qui se suivent le long de la façade
    const cl = [seed];
    let lo = Math.min(at(seed.a), at(seed.b)), hi = Math.max(at(seed.a), at(seed.b));
    for (let grown = true; grown;) {
      grown = false;
      for (const s of cand) {
        if (cl.includes(s) || consumed.has(s) || angleDiff(dirAngle(s.u), dirAngle(u)) > 5) continue;
        if (Math.abs(off(s.a)) > 0.35 * m || Math.abs(off(s.b)) > 0.35 * m) continue;
        const a = Math.min(at(s.a), at(s.b)), b = Math.max(at(s.a), at(s.b));
        if (a > hi + 0.1 * m || b < lo - 0.1 * m) continue;
        cl.push(s); lo = Math.min(lo, a); hi = Math.max(hi, b); grown = true;
      }
    }
    const span = hi - lo;
    if (span < 1.5 * m || span > 8 * m) continue;
    // vantaux : un trait dessiné seulement au milieu de la façade (en retrait ou en saillie des châssis fixes)
    const byOff = new Map<number, [number, number][]>();
    for (const s of cl) {
      const k = Math.round(off(mulv(add(s.a, s.b), 0.5)) / (0.02 * m));
      (byOff.get(k) ?? byOff.set(k, []).get(k)!).push([Math.min(at(s.a), at(s.b)), Math.max(at(s.a), at(s.b))]);
    }
    let d0 = 0, d1 = 0;
    for (const list of byOff.values()) {
      list.sort((a, b) => a[0] - b[0]);
      const runs: [number, number][] = [];
      for (const [a, b] of list) {
        const last = runs[runs.length - 1];
        if (last && a <= last[1] + 0.1 * m) last[1] = Math.max(last[1], b); else runs.push([a, b]);
      }
      if (runs.length !== 1) continue;
      const [a, b] = runs[0];
      if (a > lo + 0.2 * m && b < hi - 0.2 * m && b - a > d1 - d0) { d0 = a; d1 = b; }
    }
    if (d1 - d0 < 0.8 * m || d1 - d0 > 4 * m) continue;
    // axe de la façade : milieu de l'ensemble des traits
    const offs = cl.flatMap((s) => [off(s.a), off(s.b)]);
    const axis = (Math.min(...offs) + Math.max(...offs)) / 2;
    const P0 = add(add(seed.a, mulv(u, lo)), mulv(n, axis)), P1 = add(add(seed.a, mulv(u, hi)), mulv(n, axis));
    // les deux bouts reposent sur un mur
    const onWall = (p: P) => walls.some((w) => dist(w.a, w.b) >= 0.5 * m && distToSeg(p, w.a, w.b) <= w.t / 2 + 0.2 * m);
    if (!onWall(P0) || !onWall(P1)) continue;
    // ni porte ni fenêtre déjà reconnue, ni mur plein à cet endroit
    const mid = mulv(add(P0, P1), 0.5);
    const taken = openings.some((o) => angleDiff(dirAngle(openingDir(o)), dirAngle(u)) <= 15
      && Math.abs(dot(sub([o.x, o.y], mid), n)) <= 0.5 * m && Math.abs(dot(sub([o.x, o.y], mid), u)) <= span / 2);
    const k = Math.max(4, Math.round(span / (0.25 * m)));
    let covered = 0;
    for (let i = 1; i < k; i++) {
      const p = add(P0, mulv(u, (span * i) / k));
      if (walls.some((w) => dist(w.a, w.b) >= 0.5 * m && distToSeg(p, w.a, w.b) <= w.t / 2 + 0.05 * m)) covered++;
    }
    if (taken || covered / (k - 1) > 0.25) continue;
    cl.forEach((s) => consumed.add(s));
    const c = add(add(seed.a, mulv(u, (d0 + d1) / 2)), mulv(n, axis));
    out.push({
      wall: { a: P0, b: P1, t: 0.2 * m },
      door: makeElement('door', {
        x: round(c[0]), y: round(c[1]), width: round(d1 - d0), rotation: round(deg(Math.atan2(u[1], u[0]))), swing: 'left', doorType: 'slidingDouble',
      }) as DoorElement,
    });
  }
  return out;
}

/**
 * Bouts de murs au nu : un mur s'arrête sur l'axe du mur qu'il rejoint en équerre, et son bout carré déborde
 * d'une demi-épaisseur. Quand le mur rejoint est plus fin, ce bout dépasserait de l'autre côté : il est
 * raccourci pour s'arrêter exactement sur la face extérieure du mur rejoint.
 */
function flushEnds(walls: RawWall[], m: number) {
  const ends = walls.map((W) => {
    const u = unit(sub(W.b, W.a));
    return (['a', 'b'] as const).map((end) => {
      const E = W[end];
      let thinnest: number | null = null;
      for (const V of walls) {
        if (V === W || angleDiff(dirAngle(u), dirAngle(unit(sub(V.b, V.a)))) < 60) continue;
        if (distToSeg(E, V.a, V.b) > 0.02 * m) continue;
        if (V.t < W.t - 0.005 * m && (thinnest === null || V.t < thinnest)) thinnest = V.t;
      }
      return thinnest;
    });
  });
  walls.forEach((W, i) => {
    const u = unit(sub(W.b, W.a));
    const [ta, tb] = ends[i];
    let { a, b } = W;
    if (ta !== null) a = add(a, mulv(u, (W.t - ta) / 2));
    if (tb !== null) b = sub(b, mulv(u, (W.t - tb) / 2));
    if (dot(sub(b, a), u) > 0.1 * m) walls[i] = { ...W, a, b };
  });
}

/** Morceau de mur sous chaque ouverture, de l'épaisseur du mur aligné voisin (sinon 15 cm ou la profondeur de la fenêtre). */
function openingWalls(openings: Opening[], walls: RawWall[], m: number): RawWall[] {
  return openings.map((o) => {
    const u = openingDir(o), c: P = [o.x, o.y], hw = o.width / 2;
    // épaisseur du mur aligné le plus long à proximité (pas celle d'un poteau)
    let t = o.type === 'window' ? Math.max(0.1 * m, o.depth) : 0.15 * m, longest = 0;
    for (const w of walls) {
      const wu = unit(sub(w.b, w.a)), L = dist(w.a, w.b);
      if (angleDiff(dirAngle(wu), dirAngle(u)) > 15 || L < 0.5 * m) continue;
      const rel = sub(c, w.a);
      if (Math.abs(dot(rel, perp(wu))) > w.t / 2 + 0.3 * m) continue;
      if (distToSeg(c, w.a, w.b) <= hw + 1.5 * m && L > longest) { longest = L; t = w.t; }
    }
    return { a: sub(c, mulv(u, hw)), b: add(c, mulv(u, hw)), t, v: true };
  });
}

/** Morceau « ouverture » resté isolé (aucun mur à ses extrémités) : ce n'était pas une ouverture dans un mur. */
function dropLooseOpeningWalls(walls: RawWall[], m: number) {
  const touches = (p: P, self: RawWall) => walls.some((w) => w !== self && !w.v && distToSeg(p, w.a, w.b) <= w.t / 2 + 0.05 * m);
  for (let i = walls.length - 1; i >= 0; i--) {
    const w = walls[i];
    if (w.v && !touches(w.a, w) && !touches(w.b, w)) walls.splice(i, 1);
  }
  for (const w of walls) delete w.v;
}

const openingDir = (o: Opening): P => [Math.cos((o.rotation * Math.PI) / 180), Math.sin((o.rotation * Math.PI) / 180)];

/**
 * Murs continus : deux murs alignés sont réunis quand l'intervalle qui les sépare est occupé par une porte
 * ou une fenêtre (le dessin laisse un trou à cet endroit), ou quand il ne fait que quelques centimètres.
 */
function mergeAcrossOpenings(walls: RawWall[], openings: Opening[], m: number) {
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        // le mur le plus long sert de base (son axe et son épaisseur sont conservés)
        const [W1, W2] = dist(walls[i].a, walls[i].b) >= dist(walls[j].a, walls[j].b) ? [walls[i], walls[j]] : [walls[j], walls[i]];
        const u = unit(sub(W1.b, W1.a)), v = unit(sub(W2.b, W2.a));
        if (angleDiff(dirAngle(u), dirAngle(v)) > 3) continue;
        const n = perp(u), tol = Math.max(W1.t, W2.t) / 2 + 0.02 * m;
        if (Math.abs(dot(sub(W2.a, W1.a), n)) > tol || Math.abs(dot(sub(W2.b, W1.a), n)) > tol) continue;
        const L1 = dist(W1.a, W1.b);
        const s0 = dot(sub(W2.a, W1.a), u), s1 = dot(sub(W2.b, W1.a), u);
        const lo2 = Math.min(s0, s1), hi2 = Math.max(s0, s1);
        const gap = lo2 > L1 ? lo2 - L1 : hi2 < 0 ? -hi2 : 0;
        const overlap = Math.min(L1, hi2) - Math.max(0, lo2);
        // épaisseurs différentes : seulement un doublon presque entièrement superposé (traits doublés du dessin)
        if (Math.min(W1.t, W2.t) < Math.max(W1.t, W2.t) * 0.75 && overlap < 0.6 * Math.min(L1, hi2 - lo2)) continue;
        let join = gap <= 0.6 * m; // trou laissé par un poteau supprimé
        if (!join && gap <= 4 * m) {
          const g0 = lo2 > L1 ? L1 : hi2, g1 = lo2 > L1 ? lo2 : 0;
          join = openings.some((o) => {
            if (angleDiff(dirAngle(openingDir(o)), dirAngle(u)) > 15) return false;
            const rel = sub([o.x, o.y], W1.a), along = dot(rel, u);
            return Math.abs(dot(rel, n)) <= Math.max(W1.t, W2.t) / 2 + 0.25 * m && along >= g0 - 0.1 * m && along <= g1 + 0.1 * m;
          });
        }
        if (!join) continue;
        const lo = Math.min(0, lo2), hi = Math.max(L1, hi2);
        walls[i] = { a: add(W1.a, mulv(u, lo)), b: add(W1.a, mulv(u, hi)), t: W1.t, ...(W1.v && W2.v ? { v: true } : {}) };
        walls.splice(j, 1);
        merged = true;
        j = i; // le mur i a changé : on le recompare à tous les suivants
      }
    }
  }
}

/**
 * Façade vitrée : les fenêtres alignées qui ne reposent sur aucun mur (trumeaux trop courts, poteaux)
 * reçoivent un mur continu sous toute la suite de fenêtres.
 */
function wallsUnderWindowRuns(walls: RawWall[], windows: WindowElement[], m: number) {
  const hosted = (o: WindowElement) => walls.some((w) => {
    const u = unit(sub(w.b, w.a)), rel = sub([o.x, o.y], w.a), along = dot(rel, u), L = dist(w.a, w.b);
    return angleDiff(dirAngle(u), dirAngle(openingDir(o))) <= 15 && Math.abs(dot(rel, perp(u))) <= w.t / 2 + 0.1 * m
      && along >= o.width / 2 - 0.05 * m && along <= L - o.width / 2 + 0.05 * m;
  });
  const free = windows.filter((o) => !hosted(o));
  const used = new Set<WindowElement>();
  for (const first of free) {
    if (used.has(first)) continue;
    used.add(first);
    const u = openingDir(first), n = perp(u), c0: P = [first.x, first.y];
    const run = [first];
    const span = (o: WindowElement) => { const a = dot(sub([o.x, o.y], c0), u); return [a - o.width / 2, a + o.width / 2]; };
    let lo = span(first)[0], hi = span(first)[1];
    for (let grown = true; grown;) {
      grown = false;
      for (const o of free) {
        if (used.has(o) || angleDiff(dirAngle(openingDir(o)), dirAngle(u)) > 3) continue;
        if (Math.abs(dot(sub([o.x, o.y], c0), n)) > 0.3 * m) continue;
        const [a, b] = span(o);
        if (a > hi + 1.2 * m || b < lo - 1.2 * m) continue;
        run.push(o); used.add(o); lo = Math.min(lo, a); hi = Math.max(hi, b); grown = true;
      }
    }
    const off = run.reduce((acc, o) => acc + dot(sub([o.x, o.y], c0), n), 0) / run.length;
    const base = add(c0, mulv(n, off));
    const t = Math.max(0.15 * m, ...run.map((o) => o.depth));
    walls.push({ a: add(base, mulv(u, lo)), b: add(base, mulv(u, hi)), t });
  }
}

/** Ouverture qui ne repose sur aucun mur (porte en bout de mur, contre un angle) : le mur aligné le plus proche est prolongé. */
function extendToOpenings(walls: RawWall[], openings: Opening[], m: number) {
  for (const o of openings) {
    const ou = openingDir(o), c: P = [o.x, o.y], hw = o.width / 2;
    const e0 = sub(c, mulv(ou, hw)), e1 = add(c, mulv(ou, hw));
    let best: { i: number; end: 'a' | 'b'; to: P; d: number } | null = null;
    let hosted = false;
    for (let i = 0; i < walls.length && !hosted; i++) {
      const w = walls[i], u = unit(sub(w.b, w.a));
      if (angleDiff(dirAngle(u), dirAngle(ou)) > 15) continue;
      const L = dist(w.a, w.b), rel = sub(c, w.a), along = dot(rel, u);
      if (Math.abs(dot(rel, perp(u))) > w.t / 2 + 0.25 * m) continue;
      if (along >= hw - 0.05 * m && along <= L - hw + 0.05 * m) { hosted = true; break; } // déjà porté par ce mur
      for (const end of ['a', 'b'] as const) {
        const E = w[end];
        const near = Math.min(dist(E, e0), dist(E, e1));
        if (near > 0.4 * m) continue;
        const far = dist(E, e0) > dist(E, e1) ? e0 : e1;
        const to = add(w.a, mulv(u, dot(sub(far, w.a), u)));
        if (!best || near < best.d) best = { i, end, to, d: near };
      }
    }
    if (best && !hosted) walls[best.i] = { ...walls[best.i], [best.end]: best.to };
  }
}

/**
 * Épaisseurs lisibles : les murs de l'enveloppe (en contact avec l'extérieur) reçoivent tous la même épaisseur,
 * celle de la façade (28 à 45 cm) ; les murs intérieurs passent à 15 cm, les cloisons gardent la leur.
 */
function normalizeThickness(walls: RawWall[], openings: Opening[], rawSegs: Seg[], m: number): ((p: P) => boolean) | null {
  if (!walls.length) return null;
  const g = obstacleGrid(walls, openings, rawSegs, m, []);
  if (!g) return null;
  const { grid, W, H, x0, y0, res } = g;
  const outside = new Uint8Array(W * H);
  const queue: number[] = [];
  const seed = (c: number) => { if (!outside[c] && !grid[c]) { outside[c] = 1; queue.push(c); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi], cx = c % W, cy = (c - cx) / W;
    if (cx > 0) seed(c - 1);
    if (cx < W - 1) seed(c + 1);
    if (cy > 0) seed(c - W);
    if (cy < H - 1) seed(c + W);
  }
  const isOut = (p: P) => {
    const gx = Math.floor((p[0] - x0) / res), gy = Math.floor((p[1] - y0) / res);
    return gx >= 0 && gy >= 0 && gx < W && gy < H && outside[gy * W + gx] === 1;
  };
  const exterior = walls.map((w) => {
    const u = unit(sub(w.b, w.a)), n = perp(u), L = dist(w.a, w.b);
    const k = Math.max(3, Math.round(L / (0.5 * m)));
    return [1, -1].some((side) => {
      let hits = 0;
      for (let i = 1; i <= k; i++) {
        const p = add(add(w.a, mulv(u, (L * i) / (k + 1))), mulv(n, side * (w.t / 2 + 0.2 * m)));
        if (isOut(p)) hits++;
      }
      return hits / k >= 0.4;
    });
  });
  const ext = walls.map((w, i) => ({ t: w.t, L: dist(w.a, w.b), e: exterior[i] })).filter((x) => x.e).sort((a, b) => a.t - b.t);
  const total = ext.reduce((acc, x) => acc + x.L, 0);
  let acc = 0, median = 0.3 * m;
  for (const x of ext) { acc += x.L; if (acc >= total / 2) { median = x.t; break; } }
  const cm = (v: number) => Math.round(v / (0.01 * m)) * 0.01 * m;
  const tExt = cm(Math.max(0.28 * m, Math.min(0.45 * m, median)));
  walls.forEach((w, i) => {
    if (exterior[i]) w.t = tExt;
    else w.t = w.t >= 0.12 * m ? 0.15 * m : cm(w.t);
  });
  // Un court morceau de façade (3 m au plus) dans le prolongement d'un mur intérieur plus long (bout de mur
  // qui ressort à un angle du bâtiment) est traité comme ce mur intérieur : même épaisseur, même ligne.
  walls.forEach((E, i) => {
    if (!exterior[i]) return;
    const u = unit(sub(E.b, E.a)), LE = dist(E.a, E.b);
    if (LE > 3 * m) return;
    for (let j = 0; j < walls.length; j++) {
      const V = walls[j];
      if (exterior[j] || dist(V.a, V.b) <= LE || angleDiff(dirAngle(u), dirAngle(unit(sub(V.b, V.a)))) > 3) continue;
      const v = unit(sub(V.b, V.a)), n = perp(v), LV = dist(V.a, V.b);
      const oa = dot(sub(E.a, V.a), n), ob = dot(sub(E.b, V.a), n);
      if (Math.abs(oa) > 0.35 * m || Math.abs(ob) > 0.35 * m) continue;
      const s0 = dot(sub(E.a, V.a), v), s1 = dot(sub(E.b, V.a), v);
      const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
      const gap = lo > LV ? lo - LV : hi < 0 ? -hi : 0, overlap = Math.min(LV, hi) - Math.max(0, lo);
      if (gap > 0.6 * m || overlap > 0.6 * m) continue;
      walls[i] = { ...E, a: sub(E.a, mulv(n, oa)), b: sub(E.b, mulv(n, ob)), t: V.t };
      exterior[i] = false;
      return;
    }
  });
  // Contour uniforme : un mur posé dans le prolongement d'un mur de façade (cloison sur la ligne de façade,
  // morceau décalé de moins d'une épaisseur) devient un mur de façade, sur le même axe. Les morceaux alignés
  // sont ensuite réunis en un seul mur.
  for (let grown = true; grown;) {
    grown = false;
    for (let i = 0; i < walls.length; i++) {
      if (!exterior[i]) continue;
      const E = walls[i], u = unit(sub(E.b, E.a)), n = perp(u), L1 = dist(E.a, E.b);
      for (let j = 0; j < walls.length; j++) {
        const V = walls[j];
        if (j === i || angleDiff(dirAngle(u), dirAngle(unit(sub(V.b, V.a)))) > 3) continue;
        const LV = dist(V.a, V.b);
        if (exterior[j] ? LV > L1 : LV > 3 * m) continue; // le plus court rejoint le plus long
        const oa = dot(sub(V.a, E.a), n), ob = dot(sub(V.b, E.a), n);
        if (Math.abs(oa) > tExt || Math.abs(ob) > tExt || (Math.abs(oa) < 0.01 * m && Math.abs(ob) < 0.01 * m && exterior[j])) continue;
        const s0 = dot(sub(V.a, E.a), u), s1 = dot(sub(V.b, E.a), u);
        const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
        // bout à bout : à 60 cm près, sans se superposer de plus de 60 cm
        const touches = (lo >= L1 - 0.6 * m && lo <= L1 + 0.6 * m) || (hi <= 0.6 * m && hi >= -0.6 * m);
        if (!touches) continue;
        walls[j] = { ...V, a: sub(V.a, mulv(n, oa)), b: sub(V.b, mulv(n, ob)), t: tExt };
        if (!exterior[j]) { exterior[j] = true; grown = true; }
      }
    }
  }
  alignInteriorRuns(walls, exterior, m);
  return isOut;
}

/**
 * Murs intérieurs d'une même ligne : les morceaux parallèles posés bout à bout mais décalés de moins de 35 cm
 * (parties du mur dessinées plus épaisses, petits retours, doublons) sont ramenés sur un axe commun, celui qui
 * cumule le plus de longueur ; ils sont ensuite réunis en un seul mur.
 */
function alignInteriorRuns(walls: RawWall[], exterior: boolean[], m: number) {
  const ids = walls.map((_, i) => i).filter((i) => !exterior[i]);
  const parent = new Map(ids.map((i) => [i, i]));
  const find = (i: number): number => { const p = parent.get(i)!; if (p === i) return i; const r = find(p); parent.set(i, r); return r; };
  const reach = 0.35 * m;
  for (const i of ids) {
    const A = walls[i], u = unit(sub(A.b, A.a)), n = perp(u), LA = dist(A.a, A.b);
    for (const j of ids) {
      if (j <= i) continue;
      const B = walls[j];
      if (angleDiff(dirAngle(u), dirAngle(unit(sub(B.b, B.a)))) > 3) continue;
      if (Math.abs(dot(sub(B.a, A.a), n)) > reach || Math.abs(dot(sub(B.b, A.a), n)) > reach) continue;
      const s0 = dot(sub(B.a, A.a), u), s1 = dot(sub(B.b, A.a), u);
      const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
      const gap = lo > LA ? lo - LA : hi < 0 ? -hi : 0;
      const overlap = Math.min(LA, hi) - Math.max(0, lo);
      // bout à bout (60 cm d'écart ou de recouvrement au plus) : deux murs parallèles côte à côte restent séparés
      if (gap > 0.6 * m || overlap > 0.6 * m) continue;
      parent.set(find(i), find(j));
    }
  }
  const groups = new Map<number, number[]>();
  for (const i of ids) (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(i);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const ref = g.reduce((a, b) => (dist(walls[b].a, walls[b].b) > dist(walls[a].a, walls[a].b) ? b : a));
    const R = walls[ref], n = perp(unit(sub(R.b, R.a)));
    const offOf = (w: RawWall) => dot(sub(mulv(add(w.a, w.b), 0.5), R.a), n);
    // axe retenu : décalage (à 2 cm près) qui cumule le plus de longueur
    const weight = new Map<number, number>();
    for (const i of g) { const k = Math.round(offOf(walls[i]) / (0.02 * m)); weight.set(k, (weight.get(k) ?? 0) + dist(walls[i].a, walls[i].b)); }
    const bestK = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const axis = (bestK * 0.02 * m + g.filter((i) => Math.round(offOf(walls[i]) / (0.02 * m)) === bestK)
      .reduce((acc, i) => acc + offOf(walls[i]) - bestK * 0.02 * m, 0) / g.filter((i) => Math.round(offOf(walls[i]) / (0.02 * m)) === bestK).length);
    // épaisseur commune : celle qui cumule le plus de longueur dans la ligne
    const byT = new Map<number, number>();
    for (const i of g) byT.set(walls[i].t, (byT.get(walls[i].t) ?? 0) + dist(walls[i].a, walls[i].b));
    const t = [...byT.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const i of g) {
      const w = walls[i];
      const oa = dot(sub(w.a, R.a), n) - axis, ob = dot(sub(w.b, R.a), n) - axis;
      if (Math.abs(oa) > reach || Math.abs(ob) > reach) continue;
      walls[i] = { ...w, a: sub(w.a, mulv(n, oa)), b: sub(w.b, mulv(n, ob)), t };
    }
  }
}

/** Portes et fenêtres calées dans leur mur : centrées sur son axe, orientées comme lui, fenêtre à l'épaisseur du mur. */
function snapOpenings(openings: Opening[], walls: RawWall[], m: number): Set<Opening> {
  const hosted = new Set<Opening>();
  for (const o of openings) {
    const ou = openingDir(o), c: P = [o.x, o.y], hw = o.width / 2;
    let best: { w: RawWall; u: P; along: number; L: number; d: number } | null = null;
    for (const w of walls) {
      const u = unit(sub(w.b, w.a));
      if (angleDiff(dirAngle(u), dirAngle(ou)) > 15) continue;
      const L = dist(w.a, w.b), rel = sub(c, w.a), along = dot(rel, u), across = Math.abs(dot(rel, perp(u)));
      if (across > w.t / 2 + 0.25 * m || along < -0.1 * m || along > L + 0.1 * m) continue;
      if (!best || across < best.d) best = { w, u, along, L, d: across };
    }
    if (!best) continue;
    const { w, u, along, L } = best;
    const center = L >= o.width ? Math.max(hw, Math.min(L - hw, along)) : along;
    const p = add(w.a, mulv(u, center));
    const turn = ((((deg(Math.atan2(u[1], u[0])) - o.rotation) % 180) + 270) % 180) - 90;
    o.x = round(p[0]); o.y = round(p[1]); o.rotation = round(o.rotation + turn);
    if (o.type === 'window') o.depth = round(w.t);
    hosted.add(o);
  }
  return hosted;
}

/** « E.i. 30' », « EI 60 », « CF 30 » posé près d'une porte : porte coupe-feu avec son degré. */
function markFireDoors(doors: DoorElement[], texts: { at: P; lines: string[] }[], m: number) {
  for (const t of texts) {
    const r = /^\s*(?:R?E\.?\s*I\.?|CF)\s*(\d+)/i.exec(t.lines.join(' '));
    if (!r) continue;
    let best: DoorElement | null = null, bestD = 1.5 * m;
    for (const d of doors) { const dd = dist(t.at, [d.x, d.y]); if (dd < bestD) { best = d; bestD = dd; } }
    if (best) { best.fireRated = true; best.fireRating = `EI ${r[1]}`; }
  }
}

/** Grille d'obstacles (murs, traits des murs et menuiseries, ouvertures refermées) pour les remplissages. */
function obstacleGrid(walls: RawWall[], openings: Opening[], rawSegs: Seg[], m: number, extra: P[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = (p: P) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  walls.forEach((w) => { ext(w.a); ext(w.b); });
  rawSegs.forEach((s) => { ext(s.a); ext(s.b); });
  extra.forEach(ext);
  if (!Number.isFinite(x0)) return null;
  const res = Math.max(0.05 * m, Math.max(x1 - x0, y1 - y0) / 1500);
  // marge autour du dessin : l’extérieur doit entourer la façade pour la reconnaître
  const margin = Math.max(res * 3, 0.6 * m);
  x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;
  const W = Math.ceil((x1 - x0) / res), H = Math.ceil((y1 - y0) / res);
  const grid = new Uint8Array(W * H); // 1 = obstacle
  const stamp = (a: P, b: P, radius: number, target = grid) => {
    const L = dist(a, b), n = Math.max(1, Math.ceil(L / (res * 0.5)));
    const rc = Math.max(0.75, radius / res);
    const ri = Math.ceil(rc);
    for (let s = 0; s <= n; s++) {
      const px = (a[0] + ((b[0] - a[0]) * s) / n - x0) / res, py = (a[1] + ((b[1] - a[1]) * s) / n - y0) / res;
      const cx = Math.floor(px), cy = Math.floor(py);
      for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
        const gx = cx + dx, gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
        if ((gx + 0.5 - px) ** 2 + (gy + 0.5 - py) ** 2 <= rc * rc) target[gy * W + gx] = 1;
      }
    }
  };
  walls.forEach((w) => stamp(w.a, w.b, w.t / 2));
  rawSegs.forEach((s) => stamp(s.a, s.b, 0));
  for (const d of openings) { // referme l'ouverture
    const u = openingDir(d);
    stamp(sub([d.x, d.y], mulv(u, d.width / 2)), add([d.x, d.y], mulv(u, d.width / 2)), 0.03 * m);
  }
  return { grid, W, H, x0, y0, res, stamp };
}

/** Pièces par remplissage d'une grille depuis chaque nom, jusqu'aux murs et portes refermées. */
type RoomLabel = { at: P; lines: string[]; height: number };

/**
 * Pièces par remplissage. Renvoie aussi les textes restés sans pièce (zone ouverte vers l'extérieur) ;
 * avec `circulation`, les espaces fermés sans texte (couloirs, dégagements ≥ 2 m²) deviennent des zones sans nom.
 */
function floodRooms(
  labels: RoomLabel[], walls: { a: P; b: P; t: number }[], doors: (DoorElement | WindowElement)[], rawSegs: Seg[], m: number,
  labelOf: (l: string[]) => { label: string; hadArea: boolean }, labelSize: (h: number) => number, circulation = false,
  closers: Seg[] = [], stairsEls: StairsElement[] = [],
): { rooms: AreaElement[]; unplaced: RoomLabel[] } {
  const g = obstacleGrid(walls, doors, rawSegs, m, labels.map((l) => l.at));
  if (!g) return { rooms: [], unplaced: labels };
  const { grid, W, H, x0, y0, res, stamp } = g;
  // 1. Zones fermées : un remplissage depuis chaque texte (surfaces d'abord, puis noms)
  type Seed = { cell: number; name: string; hadArea: boolean; height: number; lab: RoomLabel };
  const unplaced = new Set<RoomLabel>(); // textes tombés dans une zone ouverte vers l'extérieur
  const comp = new Int32Array(W * H).fill(-1); // -2 : zone ouverte vers l'extérieur
  const comps: { seeds: Seed[] }[] = [];
  const loose: Seed[] = []; // noms posés sur un trait ou dans une zone ouverte
  // garde-fou seulement : une fuite est détectée par le contact avec le bord (marge de 3 cellules)
  const maxCells = W * H * 0.9;
  const reach = Math.ceil((1 * m) / res);
  for (const lab of labels) {
    const { label: name, hadArea } = labelOf(lab.lines);
    let sx = Math.min(W - 1, Math.max(0, Math.floor((lab.at[0] - x0) / res)));
    let sy = Math.min(H - 1, Math.max(0, Math.floor((lab.at[1] - y0) / res)));
    const seed: Seed = { cell: sy * W + sx, name, hadArea, height: lab.height, lab };
    // un numéro posé sur une porte ou un mur (et non à l'intérieur d'un local) : rattaché à la zone voisine
    // (≤ 1 m) qui a encore des surfaces sans nom ; sinon le texte nomme le local où il est écrit
    const onDoorOrWall = grid[seed.cell] === 1 || doors.some((o) => {
      if (o.type !== 'door') return false;
      const u = openingDir(o), rel = sub(lab.at, [o.x, o.y]);
      return Math.abs(dot(rel, u)) <= o.width / 2 + 0.3 * m && Math.abs(dot(rel, perp(u))) <= 0.6 * m;
    });
    if (name && onDoorOrWall) {
      let best = -1, bestD = Infinity;
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        const gx = sx + dx, gy = sy + dy;
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
        const o = comp[gy * W + gx], d = dx * dx + dy * dy;
        if (o < 0 || d >= bestD) continue;
        const named = comps[o].seeds.filter((x) => x.name).length, surf = comps[o].seeds.filter((x) => !x.name).length;
        if (named < surf || d <= 4) { best = gy * W + gx; bestD = d; }
      }
      if (best >= 0) { comps[comp[best]].seeds.push({ ...seed, cell: best }); continue; }
    }
    // décale le point de départ s'il tombe sur un trait
    let found = false;
    for (let r = 0; r <= 4 && !found; r++) for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++) {
      const gx = sx + dx, gy = sy + dy;
      if (gx >= 0 && gy >= 0 && gx < W && gy < H && !grid[gy * W + gx]) { sx = gx; sy = gy; found = true; }
    }
    const c0 = sy * W + sx;
    if (!found || comp[c0] === -2) { unplaced.add(lab); if (name) loose.push(seed); continue; }
    seed.cell = c0;
    if (comp[c0] >= 0) { comps[comp[c0]].seeds.push(seed); continue; }
    const id = comps.length;
    const cells: number[] = [];
    const stack = [c0];
    comp[c0] = id;
    let leaked = false;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const cx = c % W, cy = (c - cx) / W;
      if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1 || cells.length > maxCells) { leaked = true; break; }
      for (const nb of [c - 1, c + 1, c - W, c + W]) {
        if (!grid[nb] && comp[nb] === -1) { comp[nb] = id; stack.push(nb); }
      }
    }
    if (leaked) {
      for (const c of cells) comp[c] = -2;
      for (const c of stack) comp[c] = -2;
      comps.push({ seeds: [] });
      unplaced.add(lab);
      if (name) loose.push(seed);
      continue;
    }
    comps.push({ seeds: [seed] });
  }

  // 2. Une zone qui contient plusieurs surfaces (salles séparées par des amorces de murs seulement)
  //    est partagée entre elles : chacune grandit depuis son texte, la frontière tombe à mi-chemin.
  const part = new Int32Array(W * H).fill(-1);
  const parts: { cells: number[]; names: Seed[]; hadArea: boolean; height: number }[] = [];
  comps.forEach((cp, id) => {
    if (!cp.seeds.length) return;
    const surfaces = cp.seeds.filter((x) => !x.name);
    const primaries = surfaces.length ? surfaces : cp.seeds;
    const queue: number[] = [];
    for (const seedP of primaries) {
      if (part[seedP.cell] >= 0) continue;
      part[seedP.cell] = parts.length;
      parts.push({ cells: [], names: seedP.name ? [seedP] : [], hadArea: seedP.hadArea, height: seedP.height });
      queue.push(seedP.cell);
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi];
      parts[part[c]].cells.push(c);
      for (const nb of [c - 1, c + 1, c - W, c + W]) {
        if (comp[nb] === id && part[nb] === -1) { part[nb] = part[c]; queue.push(nb); }
      }
    }
    for (const x of cp.seeds) {
      if (primaries.includes(x) || part[x.cell] < 0) continue;
      const target = parts[part[x.cell]];
      if (x.name) target.names.push(x);
      target.hadArea ||= x.hadArea;
    }
  });

  // 3. Noms restés à l'écart : pièce la plus proche (≤ 1 m) encore sans nom
  for (const x of loose) {
    const sx = x.cell % W, sy = (x.cell - sx) / W;
    let best = -1, bestD = Infinity;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const gx = sx + dx, gy = sy + dy;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
      const o = part[gy * W + gx], d = dx * dx + dy * dy;
      if (o >= 0 && !parts[o].names.length && d < bestD) { best = o; bestD = d; }
    }
    if (best >= 0) { parts[best].names.push(x); parts[best].hadArea ||= x.hadArea; unplaced.delete(x.lab); }
  }

  // 3 bis. Espaces fermés sans texte (couloirs, dégagements, sas) : zones sans nom
  if (circulation) {
    const minCells = (2 * m * m) / (res * res);
    for (let c0 = 0; c0 < W * H; c0++) {
      if (grid[c0] || comp[c0] !== -1) continue;
      const id = comps.length;
      comps.push({ seeds: [] });
      const cells: number[] = [];
      const stack = [c0];
      comp[c0] = id;
      let leaked = false;
      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        const cx = c % W, cy = (c - cx) / W;
        if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1) leaked = true;
        for (const nb of [c - 1, c + 1, c - W, c + W]) {
          if (nb >= 0 && nb < W * H && !grid[nb] && comp[nb] === -1) { comp[nb] = id; stack.push(nb); }
        }
      }
      if (leaked) { for (const c of cells) comp[c] = -2; continue; }
      if (cells.length >= minCells) parts.push({ cells, names: [], hadArea: false, height: 0 });
    }
    completeInterior();
  }

  /**
   * 3 ter. Tout l'intérieur du bâtiment reçoit une zone : les petits locaux fermés (casiers, WC, gaines)
   * rejoignent la pièce voisine, et les espaces qui ne s'ouvraient vers l'extérieur que par une baie
   * fermée par une menuiserie ou un escalier (portail, rampe, sas d'entrée) deviennent des zones.
   */
  function completeInterior() {
    const N = W * H;
    // l'intérieur : tout ce que l'extérieur n'atteint pas quand les menuiseries et escaliers referment les baies
    const closed = grid.slice();
    for (const s of closers) stamp(s.a, s.b, 0, closed);
    const outside = new Uint8Array(N);
    const stack: number[] = [];
    for (let x = 0; x < W; x++) for (const c of [x, (H - 1) * W + x]) if (!closed[c] && !outside[c]) { outside[c] = 1; stack.push(c); }
    for (let y = 0; y < H; y++) for (const c of [y * W, y * W + W - 1]) if (!closed[c] && !outside[c]) { outside[c] = 1; stack.push(c); }
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % W;
      for (const nb of [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (nb >= 0 && nb < N && !closed[nb] && !outside[nb]) { outside[nb] = 1; stack.push(nb); }
      }
    }
    const owner = new Int32Array(N).fill(-1);
    parts.forEach((pr, i) => { for (const c of pr.cells) owner[c] = i; });
    // les murs redessinés seuls séparent les pièces (les traits fins du dessin et les portes ne comptent pas,
    // ni les morceaux de mur nés d'une ouverture)
    const wallMask = new Uint8Array(N);
    for (const w of walls) if (!(w as RawWall).v) stamp(w.a, w.b, w.t / 2, wallMask);
    for (const d of doors) {
      if (d.type !== 'door') continue;
      const u = openingDir(d), n = perp(u), c: P = [d.x, d.y];
      // efface le mur sur la largeur de la porte : on passe d'un local à l'autre par elle
      for (let s = -d.width / 2; s <= d.width / 2; s += res * 0.5) {
        const p = add(c, mulv(u, s));
        for (let o = -0.4 * m; o <= 0.4 * m; o += res * 0.5) {
          const q = add(p, mulv(n, o));
          const gx = Math.floor((q[0] - x0) / res), gy = Math.floor((q[1] - y0) / res);
          if (gx >= 0 && gy >= 0 && gx < W && gy < H) wallMask[gy * W + gx] = 0;
        }
      }
    }
    // l'emprise des escaliers reconnus reste à leur pictogramme
    const inStair = new Uint8Array(N);
    for (const st of stairsEls) {
      const th = (st.rotation * Math.PI) / 180, u: P = [Math.cos(th), Math.sin(th)], n = perp(u), c: P = [st.x, st.y];
      const hw = st.w / 2 + 0.1 * m, hh = st.h / 2 + 0.1 * m;
      for (let a = -hw; a <= hw; a += res * 0.5) for (let b = -hh; b <= hh; b += res * 0.5) {
        const q = add(c, add(mulv(u, a), mulv(n, b)));
        const gx = Math.floor((q[0] - x0) / res), gy = Math.floor((q[1] - y0) / res);
        if (gx >= 0 && gy >= 0 && gx < W && gy < H) inStair[gy * W + gx] = 1;
      }
    }
    const isLeft = (c: number) => !grid[c] && !outside[c] && owner[c] < 0 && !inStair[c];
    const reachN = Math.max(2, Math.ceil((0.35 * m) / res));
    const mergeMax = (4 * m * m) / (res * res), keepMin = (0.5 * m * m) / (res * res);
    const seen = new Uint8Array(N);
    const labelCells = new Map<number, RoomLabel[]>();
    for (const lab of unplaced) {
      const c = Math.floor((lab.at[1] - y0) / res) * W + Math.floor((lab.at[0] - x0) / res);
      if (c >= 0 && c < N) (labelCells.get(c) ?? labelCells.set(c, []).get(c)!).push(lab);
    }
    const groups: number[][] = [];
    for (let c0 = 0; c0 < N; c0++) {
      if (seen[c0] || !isLeft(c0)) continue;
      const cells: number[] = [];
      const st = [c0];
      seen[c0] = 1;
      while (st.length) {
        const c = st.pop()!;
        cells.push(c);
        const cx = c % W;
        for (const nb of [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c - W, c + W]) {
          if (nb >= 0 && nb < N && !seen[nb] && isLeft(nb)) { seen[nb] = 1; st.push(nb); }
        }
      }
      groups.push(cells);
    }
    // les grands espaces d'abord : un petit local peut ensuite rejoindre une zone retrouvée
    groups.sort((a, b) => b.length - a.length);
    for (const cells of groups) {
      // textes restés sans pièce (zone qui fuyait par la baie) : ils nomment l'espace retrouvé
      const labs = cells.flatMap((c) => labelCells.get(c) ?? []);
      if (labs.length) {
        const sorted = labs.map((l) => ({ l, ...labelOf(l.lines) })).sort((a, b) => Number(!!b.label) - Number(!!a.label) || b.l.height - a.l.height);
        const names: Seed[] = sorted.filter((x) => x.label).map((x) => ({ cell: cells[0], name: x.label, hadArea: x.hadArea, height: x.l.height, lab: x.l }));
        parts.push({ cells, names, hadArea: sorted.some((x) => x.hadArea), height: sorted[0].l.height });
        for (const x of labs) unplaced.delete(x);
        for (const c of cells) owner[c] = parts.length - 1;
        continue;
      }
      // pièce voisine la plus en contact, à travers les traits fins et les portes, jamais à travers un mur
      if (cells.length < mergeMax) {
        const hits = new Map<number, number>();
        const depth = new Map<number, number>();
        const q = cells.slice();
        for (const c of q) depth.set(c, 0);
        for (let qi = 0; qi < q.length; qi++) {
          const c = q[qi], d = depth.get(c)!;
          if (d >= reachN) continue;
          const cx = c % W;
          for (const nb of [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c - W, c + W]) {
            if (nb < 0 || nb >= N || depth.has(nb) || wallMask[nb] || outside[nb]) continue;
            depth.set(nb, d + 1);
            if (owner[nb] >= 0) hits.set(owner[nb], (hits.get(owner[nb]) ?? 0) + 1);
            else q.push(nb);
          }
        }
        let best = -1, bestN = 0;
        for (const [p, n] of hits) if (n > bestN) { best = p; bestN = n; }
        if (best >= 0) {
          parts[best].cells.push(...cells);
          for (const c of cells) owner[c] = best;
          continue;
        }
      }
      if (cells.length >= keepMin) {
        parts.push({ cells, names: [], hadArea: false, height: 0 });
        for (const c of cells) owner[c] = parts.length - 1;
      }
    }
  }

  // 4. Contours
  const out: AreaElement[] = [];
  for (const pr of parts) {
    if (!pr.cells.length) continue;
    const region = new Uint8Array(W * H);
    for (const c of pr.cells) region[c] = 1;
    // dilate d'une cellule dans les obstacles : le contour suit le nu des murs
    for (const c of pr.cells) for (const nb of [c - 1, c + 1, c - W, c + W]) if (grid[nb]) region[nb] = 1;
    // comble les encoches étroites (< 60 cm) laissées par les poteaux et les petits traits du dessin
    closeRegion(region, pr.cells, W, H, Math.max(1, Math.round((0.3 * m) / res)));
    const poly = traceRegion(region, W, H).map(([gx, gy]) => [x0 + gx * res, y0 + gy * res] as P);
    const simp = simplify(poly, res * 1.2);
    if (simp.length < 3 || polygonAreaAbs(simp) < 0.5 * m * m) continue;
    const [first] = pr.names;
    out.push(makeElement('area', {
      kind: 'room', points: simp.map(rp), label: first?.name ?? '', showArea: pr.hadArea,
      labelSize: round(labelSize(first?.height ?? pr.height)), strokeWidth: 0,
    }) as AreaElement);
  }
  return { rooms: out, unplaced: [...unplaced] };
}

/**
 * Fermeture morphologique (dilatation puis érosion de `k` cellules) limitée à l'emprise de la région :
 * les creux plus étroits que 2·k cellules sont comblés, le contour général ne bouge pas.
 */
function closeRegion(region: Uint8Array, cells: number[], W: number, H: number, k: number) {
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const c of cells) { const x = c % W, y = (c - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 = Math.max(0, x0 - k - 2); y0 = Math.max(0, y0 - k - 2); x1 = Math.min(W - 1, x1 + k + 2); y1 = Math.min(H - 1, y1 + k + 2);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  let cur = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) cur[y * bw + x] = region[(y + y0) * W + x + x0];
  // dilatation / érosion séparables (croix horizontale puis verticale = carré), sans allocation par cellule
  const pass = (src: Uint8Array, grow: boolean, dx: number, dy: number) => {
    const dst = new Uint8Array(bw * bh);
    const off = dy * bw + dx;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      const hasA = dx ? x > 0 : y > 0, hasB = dx ? x < bw - 1 : y < bh - 1;
      const a = hasA ? src[i - off] : 0, b = hasB ? src[i + off] : 0;
      dst[i] = grow ? (src[i] | a | b) : (src[i] & a & b);
    }
    return dst;
  };
  for (let i = 0; i < k; i++) cur = pass(pass(cur, true, 1, 0), true, 0, 1);
  for (let i = 0; i < k; i++) cur = pass(pass(cur, false, 1, 0), false, 0, 1);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (cur[y * bw + x]) region[(y + y0) * W + x + x0] = 1;
}

/** Contour extérieur d'une région de cellules (coins de grille), plus grande boucle. */
export function traceRegion(region: Uint8Array, W: number, H: number): P[] {
  const next = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (W + 1) + x;
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    (next.get(k) ?? next.set(k, []).get(k)!).push(key(bx, by));
  };
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && region[y * W + x] === 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) edge(x, y, x + 1, y);
    if (!at(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) edge(x, y + 1, x, y);
  }
  let best: P[] = [];
  while (next.size) {
    const start = next.keys().next().value as number;
    const loop: P[] = [];
    let cur = start;
    for (let guard = 0; guard < W * H * 4; guard++) {
      const outs = next.get(cur);
      if (!outs || !outs.length) break;
      const nx = outs.pop()!;
      if (!outs.length) next.delete(cur);
      loop.push([cur % (W + 1), Math.floor(cur / (W + 1))]);
      cur = nx;
      if (cur === start) break;
    }
    if (loop.length > best.length) best = loop;
  }
  // retire les points alignés
  return best.filter((p, i) => {
    const a = best[(i - 1 + best.length) % best.length], b = best[(i + 1) % best.length];
    return cross(sub(p, a), sub(b, p)) !== 0;
  });
}
