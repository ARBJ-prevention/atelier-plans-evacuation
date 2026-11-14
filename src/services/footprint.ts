import { isVisibleInVariant } from '../model/geometry';
import type { AreaElement, Element, Floor, Pt, ShapeElement } from '../model/types';
import { polygonAreaAbs, simplify, traceRegion } from './recognize';

type P = [number, number];

/** Contour (coordonnées plan) d'une forme ou d'une zone, pour la découpe. */
export function outlineOf(el: Element): P[] | null {
  if (el.type === 'area') return el.points.map((p) => [p[0], p[1]] as P);
  if (el.type !== 'shape') return null;
  const s = el as ShapeElement;
  if (s.shape === 'line' || s.shape === 'arrow') return null;
  const a = ((s.rotation || 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const tr = (dx: number, dy: number): P => [s.x + dx * c - dy * sn, s.y + dx * sn + dy * c];
  const hw = s.w / 2, hh = s.h / 2;
  if (s.shape === 'ellipse') return Array.from({ length: 64 }, (_, i) => { const t = (i / 64) * Math.PI * 2; return tr(Math.cos(t) * hw, Math.sin(t) * hh); });
  return [tr(-hw, -hh), tr(hw, -hh), tr(hw, hh), tr(-hw, hh)];
}

function pointInPolygon(x: number, y: number, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Dilatation carrée de `k` cellules (passes séparables 3×3). */
function dilate(src: Uint8Array, W: number, H: number, k: number): Uint8Array {
  let cur = src;
  for (let it = 0; it < k; it++) {
    const h = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) h[r + x] = cur[r + x] | (x > 0 ? cur[r + x - 1] : 0) | (x < W - 1 ? cur[r + x + 1] : 0);
    }
    const v = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) v[r + x] = h[r + x] | (y > 0 ? h[r + x - W] : 0) | (y < H - 1 ? h[r + x + W] : 0);
    }
    cur = v;
  }
  return cur;
}

interface Mask {
  m: number; res: number; x0: number; y0: number; W: number; H: number;
  /** murs, contours de pièces et menuiseries tels que dessinés */
  grid: Uint8Array;
  /** murs seuls (sans les contours de pièces ni les traits de fermeture des baies) */
  walls: Uint8Array;
  /** extérieur du bâtiment (baies refermées), regonflé jusqu'au milieu des façades */
  out: Uint8Array;
}

/** Rastérise les murs de l'étage et calcule l'extérieur du bâtiment. */
function buildingMask(floor: Floor, variantId: string, ignoreId: string | undefined, gapMeters: number): Mask | null {
  const m = floor.unitsPerMeter > 0 ? floor.unitsPerMeter : 100;
  const segs: { a: P; b: P; r: number; wall?: boolean }[] = [];
  for (const e of floor.elements) {
    if (e.id === ignoreId || !isVisibleInVariant(e, variantId)) continue;
    if (e.type === 'wall') {
      const pts = e.points as P[];
      for (let i = 0; i + 1 < pts.length; i++) segs.push({ a: pts[i], b: pts[i + 1], r: e.thickness / 2, wall: true });
      if (e.closed && pts.length > 2) segs.push({ a: pts[pts.length - 1], b: pts[0], r: e.thickness / 2, wall: true });
    } else if (e.type === 'area' && (e as AreaElement).kind === 'room') {
      const pts = e.points as P[];
      for (let i = 0; i < pts.length; i++) segs.push({ a: pts[i], b: pts[(i + 1) % pts.length], r: 0 });
    } else if (e.type === 'door' || e.type === 'window') {
      // referme l'ouverture sur sa largeur
      const a = (e.rotation * Math.PI) / 180, u: P = [Math.cos(a), Math.sin(a)], hw = e.width / 2;
      segs.push({ a: [e.x - u[0] * hw, e.y - u[1] * hw], b: [e.x + u[0] * hw, e.y + u[1] * hw], r: 0.05 * m });
    }
  }
  if (!segs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs) for (const p of [s.a, s.b]) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const res = Math.max(0.05 * m, Math.max(x1 - x0, y1 - y0) / 1200);
  const k = Math.max(1, Math.round((gapMeters / 2) * m / res));
  // l'extérieur doit entourer les murs même épaissis : marge = demi-épaisseur + fermeture + 3 cellules
  const margin = Math.max(...segs.map((s) => s.r)) + (k + 3) * res;
  x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;
  const W = Math.ceil((x1 - x0) / res), H = Math.ceil((y1 - y0) / res);
  const N = W * H;
  const grid = new Uint8Array(N);
  const walls = new Uint8Array(N);
  for (const { a, b, r, wall } of segs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / (res * 0.5)));
    const rc = Math.max(0.75, r / res), ri = Math.ceil(rc);
    for (let s = 0; s <= n; s++) {
      const px = (a[0] + ((b[0] - a[0]) * s) / n - x0) / res, py = (a[1] + ((b[1] - a[1]) * s) / n - y0) / res;
      const cx = Math.floor(px), cy = Math.floor(py);
      for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
        const gx = cx + dx, gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
        if ((gx + 0.5 - px) ** 2 + (gy + 0.5 - py) ** 2 <= rc * rc) { grid[gy * W + gx] = 1; if (wall) walls[gy * W + gx] = 1; }
      }
    }
  }
  // fermeture : on épaissit les murs pour boucher les baies, l'extérieur remplit jusqu'à eux,
  // puis on le regonfle d'autant pour retrouver le nu extérieur de la façade
  const thick = dilate(grid, W, H, k);
  const outside = new Uint8Array(N);
  const stack: number[] = [];
  const seed = (c: number) => { if (!thick[c] && !outside[c]) { outside[c] = 1; stack.push(c); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (stack.length) {
    const c = stack.pop()!, cx = c % W;
    if (cx > 0) seed(c - 1);
    if (cx < W - 1) seed(c + 1);
    if (c >= W) seed(c - W);
    if (c < N - W) seed(c + W);
  }
  // on regonfle jusqu'au nu extérieur de la façade, puis encore d'une demi-épaisseur du mur le plus
  // épais : la zone s'arrête au milieu de la façade, sous le mur, et son contour ne déborde pas du plan
  const half = Math.max(0, ...segs.filter((s) => s.wall).map((s) => s.r));
  const inset = Math.max(1, Math.round(half / res));
  return { m, res, x0, y0, W, H, grid, walls, out: dilate(outside, W, H, k + inset) };
}

/** Cellules de l'intérieur du bâtiment situées dans le contour dessiné. */
function insideOutline(mk: Mask, outline: P[]): { region: Uint8Array; count: number } {
  const { res, x0, y0, W, H, out } = mk;
  let ox0 = Infinity, oy0 = Infinity, ox1 = -Infinity, oy1 = -Infinity;
  for (const p of outline) { ox0 = Math.min(ox0, p[0]); oy0 = Math.min(oy0, p[1]); ox1 = Math.max(ox1, p[0]); oy1 = Math.max(oy1, p[1]); }
  const gx0 = Math.max(0, Math.floor((ox0 - x0) / res)), gx1 = Math.min(W - 1, Math.ceil((ox1 - x0) / res));
  const gy0 = Math.max(0, Math.floor((oy0 - y0) / res)), gy1 = Math.min(H - 1, Math.ceil((oy1 - y0) / res));
  const region = new Uint8Array(W * H);
  let count = 0;
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
    const c = gy * W + gx;
    if (out[c]) continue;
    if (pointInPolygon(x0 + (gx + 0.5) * res, y0 + (gy + 0.5) * res, outline)) { region[c] = 1; count++; }
  }
  return { region, count };
}

function toPolygon(mk: Mask, region: Uint8Array, minM2: number, tol = 1.2): Pt[] | null {
  const { res, x0, y0, W, H, m } = mk;
  const poly = traceRegion(region, W, H).map(([gx, gy]) => [x0 + gx * res, y0 + gy * res] as P);
  const simp = simplify(poly, res * tol);
  if (simp.length < 3 || polygonAreaAbs(simp) < minM2 * m * m) return null;
  const rd = (v: number) => Math.round(v * 100) / 100;
  return simp.map((p) => [rd(p[0]), rd(p[1])] as Pt);
}

/**
 * Découpe un contour selon l'emprise du bâtiment : on ne garde que la partie située à l'intérieur
 * de la façade (nu extérieur des murs). Les portes, fenêtres et trous de façade plus étroits que
 * `gapMeters` sont refermés. Renvoie null si l'étage n'a pas de murs ou si rien ne reste.
 */
export function clipToBuilding(floor: Floor, variantId: string, outline: P[], ignoreId?: string, gapMeters = 1.6): Pt[] | null {
  const mk = buildingMask(floor, variantId, ignoreId, gapMeters);
  if (!mk) return null;
  const { region, count } = insideOutline(mk, outline);
  if (!count) return null;
  return toPolygon(mk, region, 0.25);
}

export interface RoomPiece { points: Pt[]; label: string }

/**
 * Contour d'un morceau de « Découper en locaux » : aucun trait visible. Les limites entre deux locaux
 * qui ne passent pas sous un mur (baies, bouts de cloison, escaliers) ne doivent pas se dessiner.
 * Sur un fond plein et opaque, un trait fin de la couleur du fond bouche le jour d'anticrénelage
 * entre deux morceaux voisins ; sinon (fond transparent ou hachuré), pas de trait du tout.
 */
export function seamlessStroke(src: { fill?: string; fillOpacity?: number; pattern?: string; opacity?: number }) {
  const opaque = !!src.fill && src.fill !== 'none' && src.fill !== 'transparent'
    && (src.pattern ?? 'solid') === 'solid' && (src.fillOpacity ?? 1) >= 0.99 && (src.opacity ?? 1) >= 0.99;
  return opaque
    ? { stroke: src.fill as string, strokeWidth: 1, dash: 'solid' as const }
    : { stroke: src.fill || '#000000', strokeWidth: 0, dash: 'solid' as const };
}

/**
 * Dans un local couvert au moins pour moitié par des pièces au fond opaque, le morceau est ramené à
 * l'intérieur de ces pièces, une cellule en retrait : il ne dépasse plus dans le petit jour laissé
 * entre le contour d'une pièce et le mur, et deux bords confondus ne laissent rien filtrer à
 * l'anticrénelage. (Garder la bande sous le mur ferait du jour un trou, qu'un contour ne sait pas
 * représenter.) Renvoie les locaux ainsi ramenés.
 */
function hideUnderRooms(floor: Floor, variantId: string, ignoreId: string | undefined, mk: Mask, region: Uint8Array, label: Int32Array): Set<number> {
  const { res, x0, y0, W, H, grid } = mk;
  const CW = W + 1, CH = H + 1;
  const hidden = new Set<number>();
  const roomCov = new Uint8Array(CW * CH);
  const fillPoly = (pts: P[]) => {
    let py0 = Infinity, py1 = -Infinity;
    for (const p of pts) { py0 = Math.min(py0, p[1]); py1 = Math.max(py1, p[1]); }
    const r0 = Math.max(0, Math.ceil((py0 - y0) / res)), r1 = Math.min(CH - 1, Math.floor((py1 - y0) / res));
    for (let r = r0; r <= r1; r++) {
      const y = y0 + r * res, xs: number[] = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - x0) / res)), c1 = Math.min(CW - 1, Math.floor((xs[k + 1] - x0) / res));
        for (let c = c0; c <= c1; c++) roomCov[r * CW + c] = 1;
      }
    }
  };
  let any = false;
  for (const e of floor.elements) {
    if (e.id === ignoreId || e.type !== 'area' || e.kind !== 'room' || e.points.length < 3 || !isVisibleInVariant(e, variantId)) continue;
    const a = e as AreaElement & { opacity?: number };
    if (!a.fill || a.fill === 'none' || a.fill === 'transparent' || (a.fillOpacity ?? 1) < 0.5 || (a.opacity ?? 1) < 0.5) continue;
    fillPoly(e.points as P[]);
    any = true;
  }
  if (!any) return hidden;
  // part de chaque local sous une pièce (centre des cellules libres approché par leur coin)
  const free = new Map<number, number>(), under = new Map<number, number>();
  for (let c = 0; c < W * H; c++) {
    const id = label[c];
    if (id < 0 || grid[c]) continue;
    free.set(id, (free.get(id) ?? 0) + 1);
    const gx = c % W, gy = (c - gx) / W;
    if (roomCov[(gy + 1) * CW + gx + 1]) under.set(id, (under.get(id) ?? 0) + 1);
  }
  for (const [id, n] of free) if ((under.get(id) ?? 0) >= n * 0.5) hidden.add(id);
  if (!hidden.size) return hidden;
  const safe = new Uint8Array(CW * CH);
  for (let r = 1; r < CH - 1; r++) for (let c = 1; c < CW - 1; c++) {
    const k = r * CW + c;
    safe[k] = roomCov[k] & roomCov[k - 1] & roomCov[k + 1] & roomCov[k - CW] & roomCov[k + CW];
  }
  for (let c = 0; c < W * H; c++) {
    if (!hidden.has(label[c])) continue;
    const gx = c % W, gy = (c - gx) / W, k = gy * CW + gx;
    if (!(safe[k] && safe[k + 1] && safe[k + CW] && safe[k + CW + 1])) { label[c] = -1; region[c] = 0; }
  }
  return hidden;
}

/**
 * Découpe un contour, limité au bâtiment, en un morceau par local : les murs, cloisons, contours de
 * pièces et portes séparent les locaux, et l'épaisseur des murs est partagée entre les locaux voisins
 * pour que les morceaux couvrent toute la zone. Les recoins de moins de 1 m² rejoignent le local voisin.
 * Chaque morceau reprend le nom de la pièce ou du texte qu'il contient.
 */
export function splitIntoRooms(floor: Floor, variantId: string, outline: P[], ignoreId?: string, gapMeters = 1.6): RoomPiece[] | null {
  const mk = buildingMask(floor, variantId, ignoreId, gapMeters);
  if (!mk) return null;
  const { region, count } = insideOutline(mk, outline);
  if (!count) return null;
  const { res, x0, y0, W, H, grid, m } = mk;
  const N = W * H;
  const nbs = (c: number) => { const cx = c % W; return [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c < N - W ? c + W : -1]; };
  // 1. locaux : composantes de l'intérieur hors murs
  const label = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  for (let c0 = 0; c0 < N; c0++) {
    if (!region[c0] || grid[c0] || label[c0] >= 0) continue;
    const id = sizes.length, st = [c0];
    label[c0] = id;
    let n = 0;
    while (st.length) {
      const c = st.pop()!;
      n++;
      for (const nb of nbs(c)) if (nb >= 0 && region[nb] && !grid[nb] && label[nb] < 0) { label[nb] = id; st.push(nb); }
    }
    sizes.push(n);
  }
  if (!sizes.length) return null;
  // 2. les recoins trop petits (vides entre deux traits, gaines) sont rendus au remplissage
  const minCells = (m * m) / (res * res);
  // les bandes de moins de 50 cm de large (jour entre un contour de pièce et un mur) ne sont pas des locaux
  const blocked = new Uint8Array(N);
  for (let c = 0; c < N; c++) blocked[c] = region[c] && !grid[c] ? 0 : 1;
  const core = dilate(blocked, W, H, Math.max(1, Math.round((0.25 * m) / res)));
  const wide = new Set<number>();
  for (let c = 0; c < N; c++) if (!core[c] && label[c] >= 0) wide.add(label[c]);
  const keep = sizes.map((n, id) => n >= minCells && wide.has(id));
  if (!keep.some(Boolean)) keep[sizes.indexOf(Math.max(...sizes))] = true;
  for (let c = 0; c < N; c++) if (label[c] >= 0 && !keep[label[c]]) label[c] = -1;
  // 3. remplissage par proximité : murs et recoins vont au local le plus proche.
  // D'abord sans traverser de mur : une bande isolée par un simple contour de pièce ou un trait de baie
  // revient au local de son côté du mur, jamais à celui d'en face. Puis l'épaisseur des murs, partagée.
  const grow = (passable: (c: number) => boolean) => {
    let front: number[] = [];
    for (let c = 0; c < N; c++) if (label[c] >= 0) front.push(c);
    while (front.length) {
      const nextF: number[] = [];
      for (const c of front) for (const nb of nbs(c)) if (nb >= 0 && region[nb] && label[nb] < 0 && passable(nb)) { label[nb] = label[c]; nextF.push(nb); }
      front = nextF;
    }
  };
  grow((c) => !mk.walls[c]);
  grow(() => true);
  // 3 bis. sous une pièce opaque, le morceau suit le fond de la pièce (pas de liseré vert le long des murs)
  const hidden = hideUnderRooms(floor, variantId, ignoreId, mk, region, label);
  // 3 ter. un morceau d'un seul tenant : un contour ne dessine qu'une partie connexe, le reste ferait un trou.
  // Les parties détachées assez grandes deviennent un local à part ; les autres rejoignent le local voisin
  // avec lequel elles ont la plus longue frontière.
  {
    const comp = new Int32Array(N).fill(-1);
    const parts: { id: number; cells: number[] }[] = [];
    for (let c0 = 0; c0 < N; c0++) {
      if (label[c0] < 0 || comp[c0] >= 0) continue;
      const id = label[c0], cells = [c0], st = [c0];
      comp[c0] = parts.length;
      while (st.length) {
        const c = st.pop()!;
        for (const nb of nbs(c)) if (nb >= 0 && label[nb] === id && comp[nb] < 0) { comp[nb] = parts.length; cells.push(nb); st.push(nb); }
      }
      parts.push({ id, cells });
    }
    const largest = new Map<number, number>();
    parts.forEach((p, i) => { const j = largest.get(p.id); if (j === undefined || parts[j].cells.length < p.cells.length) largest.set(p.id, i); });
    let nextId = sizes.length;
    const detached = parts.map((p, i) => i).filter((i) => largest.get(parts[i].id) !== i).sort((a, b) => parts[b].cells.length - parts[a].cells.length);
    for (const i of detached) {
      const p = parts[i];
      if (p.cells.length >= minCells) {
        const id = nextId++;
        for (const c of p.cells) label[c] = id;
        if (hidden.has(p.id)) hidden.add(id);
        continue;
      }
      const contact = new Map<number, number>();
      for (const c of p.cells) for (const nb of nbs(c)) {
        if (nb < 0) continue;
        const l = label[nb];
        if (l >= 0 && l !== p.id) contact.set(l, (contact.get(l) ?? 0) + 1);
      }
      let best = -1, bestN = 0;
      for (const [l, n] of contact) if (n > bestN) { best = l; bestN = n; }
      if (best >= 0) for (const c of p.cells) label[c] = best;
      else { const id = nextId++; for (const c of p.cells) label[c] = id; }
    }
  }
  // 4. noms : pièces existantes et textes posés dans le local
  const names = new Map<number, string>();
  const idAt = (x: number, y: number) => {
    const gx = Math.floor((x - x0) / res), gy = Math.floor((y - y0) / res);
    return gx >= 0 && gy >= 0 && gx < W && gy < H ? label[gy * W + gx] : -1;
  };
  for (const e of floor.elements) {
    if (e.id === ignoreId || !isVisibleInVariant(e, variantId)) continue;
    let name = '', at: P | null = null;
    if (e.type === 'area' && e.kind === 'room' && e.label.trim() && e.points.length > 2) {
      name = e.label.trim();
      const pts = e.points as P[];
      const c: P = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
      at = pointInPolygon(c[0], c[1], pts) ? [c[0] + e.labelDx, c[1] + e.labelDy] : null;
    } else if (e.type === 'text' && e.text.trim()) {
      name = e.text.trim().split('\n')[0];
      at = [e.x, e.y];
    }
    if (!at) continue;
    const id = idAt(at[0], at[1]);
    if (id >= 0 && !names.has(id)) names.set(id, name);
  }
  // 5. contours
  const cells = new Map<number, number[]>();
  for (let c = 0; c < N; c++) {
    const id = label[c];
    if (id >= 0) (cells.get(id) ?? cells.set(id, []).get(id)!).push(c);
  }
  const reg = new Uint8Array(N);
  const pieces: RoomPiece[] = [];
  for (const [id, list] of [...cells].sort((a, b) => a[0] - b[0])) {
    for (const c of list) reg[c] = 1;
    // contour serré (au plus une demi-cellule d'écart) : chaque morceau est simplifié seul, une tolérance
    // plus large écarterait deux voisins de part et d'autre de leur frontière commune (jours, chevauchements)
    const pts = toPolygon(mk, reg, 0.25, 0.5);
    for (const c of list) reg[c] = 0;
    if (pts) pieces.push({ points: pts, label: names.get(id) ?? '' });
  }
  return pieces.length ? pieces : null;
}
