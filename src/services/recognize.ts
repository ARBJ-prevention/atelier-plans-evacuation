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
  if (has(/DEFPOINTS|VIEWPORT|COTE|COTATION|\bDIM|DIMENS|HACH|HATCH|MOBIL|FURN|MEUBL|TOPO|ALTI|NIVEL|POINTS?\b|CARTOUCHE|TITLE|TITRE|\bAXE|AXIS|GRID|TRAME|SANIT|PLOMB|ELEC|ECLAIR|HVAC|CVC|CHAUFF|VENTIL|VEGET|ARBRE|TREE|PARKING|VOIRIE|CADASTRE|PARCEL|LIMITE|CLOTURE|FENCE/)) return 'ignore';
  if (has(/CLOIS|PARTITION|DOUBLAGE|PLACO|SCHEIDINGS|ZWISCHENW/)) return 'partitions';
  if (has(/ESCAL|STAIR|TRAP|TREPP|MARCHE|EMMARCH|RAMPE|STEP/)) return 'stairs';
  if (has(/FENET|WINDOW|WIND|GLAZ|VITR|RAAM|FENST|CHASSIS|\bBAIE/)) return 'windows';
  if (has(/(^|[^A-Z])PORTE|DOOR|DEUR|TUER|TUR\b|TUREN/)) return 'doors';
  if (has(/MUR|WALL|MAUER|MUUR|WAND|VOILE|MACONN|BETON|PAROI|FACADE|GEVEL|STRUCT|POTEAU|COLUMN|PILIER|PORTEUR/)) return 'walls';
  if (has(/LOCAU|ROOM|PIECE|SURFACE|AREA|ESPACE|RUIMTE|RAUM|LOKAAL/)) return 'rooms';
  if (has(/TEXT|TXT|\bNOM|LABEL|ANNO|IDEN|DESIGN|LIBELLE|NAAM|BESCHRIFT/)) return 'labels';
  return 'other';
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

interface Seg { a: P; b: P; u: P; L: number; layer: string; role: LayerRole; group?: number; free: [number, number][]; id: number }

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
function simplify(pts: P[], tol: number): P[] {
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

function polygonAreaAbs(p: P[]): number {
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
  const pushSeg = (a: P, b: P, prim: DxfPrim, role: LayerRole) => {
    const L = dist(a, b);
    if (L < 0.02 * m) return;
    const key = keyOf(a, b);
    if (seen.has(key)) return;
    seen.add(key);
    segs.push({ a, b, u: unit(sub(b, a)), L, layer: prim.layer, role, group: prim.group, free: [[0, L]], id: segs.length });
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
      for (let i = 0; i + 1 < pts.length; i++) pushSeg(pts[i], pts[i + 1], p, role);
      if (p.closed && pts.length > 2) pushSeg(pts[pts.length - 1], pts[0], p, role);
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
    // Cloisons en simple trait
    for (const s of wallSegs) {
      if (s.role !== 'partitions') continue;
      for (const [x, y] of s.free) {
        if (y - x >= 0.5 * m) walls.push({ a: add(s.a, mulv(s.u, x)), b: add(s.a, mulv(s.u, y)), t: 0.07 * m });
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
    // Raccord des angles et des jonctions en T
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
          const reach = Math.max(W.t, V.t) * 1.05 + 0.02 * m;
          const dE = dist(X, E);
          if (dE > reach) continue;
          const LV = dist(V.a, V.b), sV = dot(sub(X, V.a), v);
          if (sV < -reach || sV > LV + reach) continue;
          // ne pas raccourcir un mur au-delà de son autre extrémité
          const other = end === 'a' ? W.b : W.a;
          if (dot(sub(X, other), sub(E, other)) <= 0) continue;
          if (!best || dE < best.d) best = { X, d: dE };
        }
        if (best) walls[i] = { ...W, [end]: best.X };
      }
    }
  }
  const wallEls: WallElement[] = walls
    .filter((w) => dist(w.a, w.b) >= 0.1 * m)
    .map((w) => makeElement('wall', { points: [rp(w.a), rp(w.b)], thickness: round(w.t), wallStyle: 'solid' }) as WallElement);

  // 4. Portes
  const doors: DoorElement[] = [];
  {
    const cand = arcs.filter((a) => a.role !== 'stairs' && a.sweep >= 70 && a.sweep <= 110 && a.r >= 0.5 * m && a.r <= 1.6 * m);
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
    const ws = segs.filter((s) => s.role === 'windows');
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

  // 6. Pièces
  const rooms: AreaElement[] = [];
  const labelOf = (lines: string[]) => {
    const isArea = (l: string) => /^\s*(s\s*[:=]\s*)?[\d\s.,]+\s*(m²|m2)?\s*$/i.test(l) || /\d\s*(m²|m2)\s*$/i.test(l);
    const keep = lines.filter((l) => l.trim() && !isArea(l));
    return { label: keep.join('\n').trim(), hadArea: lines.some((l) => /m²|m2/i.test(l)) };
  };
  const labelSize = (h: number) => Math.max(0.18 * m, Math.min(0.6 * m, h * 1.1));
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
  if (closedPolys.length) {
    for (const poly of closedPolys) {
      if (polygonAreaAbs(poly) < 1 * m * m) continue;
      const inside = named.filter((t) => pointInPolygon(t.at, poly)).sort((a, b) => b.height - a.height);
      makeRoom(poly, inside[0] ?? null);
    }
  } else if (named.length && (wallEls.length || segs.some((s) => isWallRole(s.role)))) {
    rooms.push(...floodRooms(named, walls, doors, segs.filter((s) => isWallRole(s.role)), m, labelOf, labelSize));
  }

  return { walls: wallEls, doors, windows, stairs, rooms };
}

/** Pièces par remplissage d'une grille depuis chaque nom, jusqu'aux murs et portes refermées. */
function floodRooms(
  labels: { at: P; lines: string[]; height: number }[], walls: { a: P; b: P; t: number }[], doors: DoorElement[], rawSegs: Seg[], m: number,
  labelOf: (l: string[]) => { label: string; hadArea: boolean }, labelSize: (h: number) => number,
): AreaElement[] {
  // Emprise
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = (p: P) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  walls.forEach((w) => { ext(w.a); ext(w.b); });
  rawSegs.forEach((s) => { ext(s.a); ext(s.b); });
  labels.forEach((l) => ext(l.at));
  if (!Number.isFinite(x0)) return [];
  const res = Math.max(0.05 * m, Math.max(x1 - x0, y1 - y0) / 1500);
  x0 -= res * 3; y0 -= res * 3; x1 += res * 3; y1 += res * 3;
  const W = Math.ceil((x1 - x0) / res), H = Math.ceil((y1 - y0) / res);
  const grid = new Uint8Array(W * H); // 1 = obstacle
  const stamp = (a: P, b: P, radius: number) => {
    const L = dist(a, b), n = Math.max(1, Math.ceil(L / (res * 0.5)));
    const rc = Math.max(0.75, radius / res);
    const ri = Math.ceil(rc);
    for (let s = 0; s <= n; s++) {
      const px = (a[0] + ((b[0] - a[0]) * s) / n - x0) / res, py = (a[1] + ((b[1] - a[1]) * s) / n - y0) / res;
      const cx = Math.floor(px), cy = Math.floor(py);
      for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
        const gx = cx + dx, gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
        if ((gx + 0.5 - px) ** 2 + (gy + 0.5 - py) ** 2 <= rc * rc) grid[gy * W + gx] = 1;
      }
    }
  };
  walls.forEach((w) => stamp(w.a, w.b, w.t / 2));
  rawSegs.forEach((s) => stamp(s.a, s.b, 0));
  for (const d of doors) { // referme l'ouverture
    const th = (d.rotation * Math.PI) / 180, u: P = [Math.cos(th), Math.sin(th)];
    stamp(sub([d.x, d.y], mulv(u, d.width / 2)), add([d.x, d.y], mulv(u, d.width / 2)), 0.03 * m);
  }
  const owner = new Int32Array(W * H).fill(-1);
  const out: AreaElement[] = [];
  const maxCells = W * H * 0.6;
  labels.forEach((lab) => {
    let sx = Math.floor((lab.at[0] - x0) / res), sy = Math.floor((lab.at[1] - y0) / res);
    // décale le point de départ s'il tombe sur un trait
    let found = false;
    for (let r = 0; r <= 4 && !found; r++) for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++) {
      const gx = sx + dx, gy = sy + dy;
      if (gx >= 0 && gy >= 0 && gx < W && gy < H && !grid[gy * W + gx]) { sx = gx; sy = gy; found = true; }
    }
    if (!found || owner[sy * W + sx] >= 0) return; // déjà dans une pièce nommée
    const idx = out.length;
    const cells: number[] = [];
    const stack = [sy * W + sx];
    owner[sy * W + sx] = idx;
    let leaked = false;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const cx = c % W, cy = (c - cx) / W;
      if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1) { leaked = true; break; }
      if (cells.length > maxCells) { leaked = true; break; }
      for (const nb of [c - 1, c + 1, c - W, c + W]) {
        if (!grid[nb] && owner[nb] < 0) { owner[nb] = idx; stack.push(nb); }
      }
    }
    if (leaked) { for (const c of cells) owner[c] = -2; for (const c of stack) owner[c] = -2; return; }
    const region = new Uint8Array(W * H);
    for (const c of cells) region[c] = 1;
    // dilate d'une cellule dans les obstacles : le contour suit le nu des murs
    for (const c of cells) for (const nb of [c - 1, c + 1, c - W, c + W]) if (grid[nb]) region[nb] = 1;
    const poly = traceRegion(region, W, H).map(([gx, gy]) => [x0 + gx * res, y0 + gy * res] as P);
    const simp = simplify(poly, res * 1.2);
    if (simp.length < 3 || polygonAreaAbs(simp) < 0.5 * m * m) return;
    const { label, hadArea } = labelOf(lab.lines);
    out.push(makeElement('area', {
      kind: 'room', points: simp.map(rp), label, showArea: hadArea, labelSize: round(labelSize(lab.height)), strokeWidth: 0,
    }) as AreaElement);
  });
  return out;
}

/** Contour extérieur d'une région de cellules (coins de grille), plus grande boucle. */
function traceRegion(region: Uint8Array, W: number, H: number): P[] {
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
