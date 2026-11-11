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

/**
 * Découpe un contour selon l'emprise du bâtiment : on ne garde que la partie située à l'intérieur
 * de la façade (nu extérieur des murs). Les portes, fenêtres et trous de façade plus étroits que
 * `gapMeters` sont refermés. Renvoie null si l'étage n'a pas de murs ou si rien ne reste.
 */
export function clipToBuilding(floor: Floor, variantId: string, outline: P[], ignoreId?: string, gapMeters = 1.6): Pt[] | null {
  const m = floor.unitsPerMeter > 0 ? floor.unitsPerMeter : 100;
  const segs: { a: P; b: P; r: number }[] = [];
  for (const e of floor.elements) {
    if (e.id === ignoreId || !isVisibleInVariant(e, variantId)) continue;
    if (e.type === 'wall') {
      const pts = e.points as P[];
      for (let i = 0; i + 1 < pts.length; i++) segs.push({ a: pts[i], b: pts[i + 1], r: e.thickness / 2 });
      if (e.closed && pts.length > 2) segs.push({ a: pts[pts.length - 1], b: pts[0], r: e.thickness / 2 });
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
  for (const { a, b, r } of segs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / (res * 0.5)));
    const rc = Math.max(0.75, r / res), ri = Math.ceil(rc);
    for (let s = 0; s <= n; s++) {
      const px = (a[0] + ((b[0] - a[0]) * s) / n - x0) / res, py = (a[1] + ((b[1] - a[1]) * s) / n - y0) / res;
      const cx = Math.floor(px), cy = Math.floor(py);
      for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
        const gx = cx + dx, gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
        if ((gx + 0.5 - px) ** 2 + (gy + 0.5 - py) ** 2 <= rc * rc) grid[gy * W + gx] = 1;
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
  const out = dilate(outside, W, H, k);
  // intérieur ∩ forme dessinée
  let ox0 = Infinity, oy0 = Infinity, ox1 = -Infinity, oy1 = -Infinity;
  for (const p of outline) { ox0 = Math.min(ox0, p[0]); oy0 = Math.min(oy0, p[1]); ox1 = Math.max(ox1, p[0]); oy1 = Math.max(oy1, p[1]); }
  const gx0 = Math.max(0, Math.floor((ox0 - x0) / res)), gx1 = Math.min(W - 1, Math.ceil((ox1 - x0) / res));
  const gy0 = Math.max(0, Math.floor((oy0 - y0) / res)), gy1 = Math.min(H - 1, Math.ceil((oy1 - y0) / res));
  const region = new Uint8Array(N);
  let count = 0;
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
    const c = gy * W + gx;
    if (out[c]) continue;
    if (pointInPolygon(x0 + (gx + 0.5) * res, y0 + (gy + 0.5) * res, outline)) { region[c] = 1; count++; }
  }
  if (!count) return null;
  const poly = traceRegion(region, W, H).map(([gx, gy]) => [x0 + gx * res, y0 + gy * res] as P);
  const simp = simplify(poly, res * 1.2);
  if (simp.length < 3 || polygonAreaAbs(simp) < 0.25 * m * m) return null;
  const rd = (v: number) => Math.round(v * 100) / 100;
  return simp.map((p) => [rd(p[0]), rd(p[1])] as Pt);
}
