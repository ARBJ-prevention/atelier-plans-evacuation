/**
 * Circulations probables : aide à la vérification affichée dans l'éditeur seulement (jamais imprimée).
 *
 * Le plan est découpé en une grille fine. Les murs bloquent le passage, les portes l'ouvrent. L'intérieur du
 * bâtiment est ce qui n'est pas atteignable depuis le bord de la grille quand toutes les portes sont fermées.
 * On cherche ensuite, depuis les sorties (portes « issue de secours » et pictogrammes de sortie), le chemin le
 * plus court vers chaque repère « Vous êtes ici », et les parties de l'intérieur d'où aucune sortie n'est
 * atteignable. Le résultat est indicatif : il ne remplace pas la lecture du plan par une personne compétente.
 */
import { isVisibleInVariant } from '../model/geometry';
import type { DoorElement, Floor, Pt, SymbolElement, WallElement } from '../model/types';

/** Pictogrammes qui signalent une sortie de secours. */
const EXIT_SYMBOLS = new Set(['iso-E001', 'iso-E002', 'iso-E026', 'iso-E030', 'exit-text']);

export interface Circulation {
  /** Chemins probables, un par repère « Vous êtes ici » relié à une sortie (coordonnées plan). */
  paths: { from: Pt; points: Pt[]; meters: number | null }[];
  /** Repères sans chemin vers une sortie. */
  stranded: Pt[];
  /** Zones intérieures sans accès à une sortie : chemin SVG (rectangles fusionnés par ligne). */
  unreachable: string;
  /** Part de l'intérieur sans accès à une sortie (0 à 1). */
  unreachableShare: number;
  exits: number;
  /** false si la façade n'est pas fermée : l'intérieur n'a pas pu être distingué de l'extérieur. */
  closedOutline: boolean;
  cell: number;
}

const MAX_CELLS_SIDE = 420;

export function computeCirculation(floor: Floor, variantId: string): Circulation | null {
  const visible = floor.elements.filter((e) => isVisibleInVariant(e, variantId)
    && floor.layers.some((l) => l.id === e.layer && l.visible));
  const walls = visible.filter((e): e is WallElement => e.type === 'wall' && e.points.length > 1);
  if (!walls.length) return null;
  const doors = visible.filter((e): e is DoorElement => e.type === 'door');
  const exitSymbols = visible.filter((e): e is SymbolElement => e.type === 'symbol' && EXIT_SYMBOLS.has(e.symbolId));
  const markers = visible.filter((e): e is SymbolElement => e.type === 'symbol' && e.symbolId === 'you-are-here');

  // Grille autour des murs
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of walls) for (const [x, y] of w.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const upm = floor.unitsPerMeter > 0 ? floor.unitsPerMeter : 0;
  const pad = Math.max(upm || 40, (x1 - x0) * 0.04);
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const cell = Math.max((x1 - x0), (y1 - y0)) / MAX_CELLS_SIDE;
  const cols = Math.ceil((x1 - x0) / cell), rows = Math.ceil((y1 - y0) / cell);
  const N = cols * rows;
  const cx = (i: number) => x0 + (i + 0.5) * cell, cy = (j: number) => y0 + (j + 0.5) * cell;
  const idx = (i: number, j: number) => j * cols + i;
  const toCell = ([x, y]: Pt): [number, number] => [Math.floor((x - x0) / cell), Math.floor((y - y0) / cell)];

  // 1. Murs (élargis d'une demi-cellule pour ne pas laisser de fuite en diagonale)
  const wall = new Uint8Array(N);
  for (const w of walls) {
    const r = w.thickness / 2 + cell * 0.75;
    for (let k = 0; k + 1 < w.points.length; k++) paintSegment(wall, w.points[k], w.points[k + 1], r, 1);
    if (w.closed && w.points.length > 2) paintSegment(wall, w.points[w.points.length - 1], w.points[0], r, 1);
  }
  function paintSegment(grid: Uint8Array, a: Pt, b: Pt, r: number, value: number) {
    const [i0, j0] = toCell([Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r]);
    const [i1, j1] = toCell([Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r]);
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    for (let j = Math.max(0, j0); j <= Math.min(rows - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(cols - 1, i1); i++) {
        const px = cx(i), py = cy(j);
        const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
        const qx = a[0] + t * dx - px, qy = a[1] + t * dy - py;
        if (qx * qx + qy * qy <= r * r) grid[idx(i, j)] = value;
      }
    }
  }

  // 2. Extérieur : ce qui est atteignable depuis le bord, portes fermées
  const outside = new Uint8Array(N);
  flood(outside, (k) => !wall[k], borderCells());
  function borderCells(): number[] {
    const out: number[] = [];
    for (let i = 0; i < cols; i++) out.push(idx(i, 0), idx(i, rows - 1));
    for (let j = 0; j < rows; j++) out.push(idx(0, j), idx(cols - 1, j));
    return out;
  }
  const interiorCount = countWhere((k) => !wall[k] && !outside[k]);
  const closedOutline = interiorCount > 0;

  // 3. Portes : l'ouverture devient franchissable (largeur de passage un peu réduite, épaisseur du mur traversée)
  const doorCell = new Uint8Array(N);
  for (const d of doors) {
    const a = (d.rotation * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    const half = Math.max(cell, d.width / 2 - cell * 0.5);
    const depth = Math.max(...walls.map((w) => w.thickness), cell * 2) / 2 + cell * 2;
    paintRect(doorCell, d.x, d.y, ux, uy, half, depth);
  }
  function paintRect(grid: Uint8Array, ox: number, oy: number, ux: number, uy: number, hu: number, hv: number) {
    const R = Math.hypot(hu, hv);
    const [i0, j0] = toCell([ox - R, oy - R]), [i1, j1] = toCell([ox + R, oy + R]);
    for (let j = Math.max(0, j0); j <= Math.min(rows - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(cols - 1, i1); i++) {
        const px = cx(i) - ox, py = cy(j) - oy;
        if (Math.abs(px * ux + py * uy) <= hu && Math.abs(-px * uy + py * ux) <= hv) grid[idx(i, j)] = 1;
      }
    }
  }
  const inside = (k: number) => !closedOutline || !outside[k];
  const passable = (k: number) => (!wall[k] && inside(k)) || (doorCell[k] === 1);

  // 4. Sorties : seuils des portes « issue de secours », pictogrammes de sortie (ramenés à la cellule libre la plus proche)
  const seeds: number[] = [];
  for (const d of doors.filter((x) => x.emergency)) {
    const [i, j] = toCell([d.x, d.y]);
    const k = nearestFree(i, j, passable, 6);
    if (k >= 0) seeds.push(k);
  }
  // les pictogrammes ne servent de sortie que si aucune porte n'est marquée « issue de secours » (souvent des panneaux directionnels)
  if (!seeds.length) for (const s of exitSymbols) {
    const [i, j] = toCell([s.x, s.y]);
    const k = nearestFree(i, j, passable, Math.ceil((upm || 50) * 1.5 / cell));
    if (k >= 0) seeds.push(k);
  }
  function nearestFree(i: number, j: number, ok: (k: number) => boolean, radius: number): number {
    for (let r = 0; r <= radius; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
        if (ok(idx(ii, jj))) return idx(ii, jj);
      }
    }
    return -1;
  }

  // 5. Distances depuis les sorties (8 voisins, coûts 1 et √2)
  const dist = new Float64Array(N).fill(Infinity);
  dijkstra(dist, passable, seeds);

  // 6. Chemin de chaque repère vers la sortie la plus proche : descente de la distance
  const paths: Circulation['paths'] = [];
  const stranded: Pt[] = [];
  for (const m of markers) {
    const [i, j] = toCell([m.x, m.y]);
    let k = nearestFree(i, j, (q) => passable(q) && Number.isFinite(dist[q]), Math.ceil((upm || 50) / cell));
    if (k < 0) { stranded.push([m.x, m.y]); continue; }
    const pts: Pt[] = [[m.x, m.y]];
    let guard = N;
    while (dist[k] > 0 && guard-- > 0) {
      const ki = k % cols, kj = (k - ki) / cols;
      let best = k;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = ki + di, jj = kj + dj;
        if ((di || dj) && ii >= 0 && jj >= 0 && ii < cols && jj < rows && dist[idx(ii, jj)] < dist[best]) best = idx(ii, jj);
      }
      if (best === k) break;
      k = best;
      pts.push([cx(k % cols), cy(Math.floor(k / cols))]);
    }
    const simple = simplifyPath(pts, cell * 1.5);
    let len = 0;
    for (let q = 1; q < simple.length; q++) len += Math.hypot(simple[q][0] - simple[q - 1][0], simple[q][1] - simple[q - 1][1]);
    paths.push({ from: [m.x, m.y], points: simple, meters: upm ? len / upm : null });
  }

  // 7. Intérieur sans accès à une sortie
  let unreachable = '';
  let lost = 0;
  if (closedOutline && seeds.length) {
    for (let j = 0; j < rows; j++) {
      let start = -1;
      for (let i = 0; i <= cols; i++) {
        const k = idx(i, j);
        const bad = i < cols && !wall[k] && !outside[k] && !Number.isFinite(dist[k]);
        if (bad) lost++;
        if (bad && start < 0) start = i;
        if (!bad && start >= 0) {
          unreachable += `M${(x0 + start * cell).toFixed(1)} ${(y0 + j * cell).toFixed(1)}h${((i - start) * cell).toFixed(1)}v${cell.toFixed(1)}h${(-(i - start) * cell).toFixed(1)}z`;
          start = -1;
        }
      }
    }
  }

  return {
    paths, stranded, unreachable, unreachableShare: interiorCount ? lost / interiorCount : 0,
    exits: seeds.length, closedOutline, cell,
  };

  function countWhere(f: (k: number) => boolean) { let n = 0; for (let k = 0; k < N; k++) if (f(k)) n++; return n; }
  function flood(mark: Uint8Array, ok: (k: number) => boolean, start: number[]) {
    const stack = start.filter(ok);
    for (const k of stack) mark[k] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % cols, j = (k - i) / cols;
      const nb = [i > 0 ? k - 1 : -1, i < cols - 1 ? k + 1 : -1, j > 0 ? k - cols : -1, j < rows - 1 ? k + cols : -1];
      for (const q of nb) if (q >= 0 && !mark[q] && ok(q)) { mark[q] = 1; stack.push(q); }
    }
  }
  function dijkstra(d: Float64Array, ok: (k: number) => boolean, start: number[]) {
    // file de priorité simple (tas binaire)
    const heap: [number, number][] = [];
    const push = (c: number, k: number) => {
      heap.push([c, k]);
      let n = heap.length - 1;
      while (n > 0) { const p = (n - 1) >> 1; if (heap[p][0] <= heap[n][0]) break; [heap[p], heap[n]] = [heap[n], heap[p]]; n = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let n = 0;
        for (;;) {
          const l = 2 * n + 1, r = l + 1;
          let m = n;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === n) break;
          [heap[m], heap[n]] = [heap[n], heap[m]]; n = m;
        }
      }
      return top;
    };
    for (const k of start) { d[k] = 0; push(0, k); }
    while (heap.length) {
      const [c, k] = pop();
      if (c > d[k]) continue;
      const i = k % cols, j = (k - i) / cols;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
        const q = idx(ii, jj);
        if (!ok(q)) continue;
        // pas de coupe en diagonale entre deux cellules bloquées
        if (di && dj && (!ok(idx(i + di, j)) || !ok(idx(i, j + dj)))) continue;
        const nc = c + (di && dj ? Math.SQRT2 : 1);
        if (nc < d[q]) { d[q] = nc; push(nc, q); }
      }
    }
  }
}

/** Simplification de Douglas-Peucker. */
function simplifyPath(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bestD = tol;
    for (let k = a + 1; k < b; k++) {
      const [x, y] = pts[k], [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
      const dd = Math.abs((x - ax) * dy - (y - ay) * dx) / l;
      if (dd > bestD) { bestD = dd; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, k) => keep[k]);
}
