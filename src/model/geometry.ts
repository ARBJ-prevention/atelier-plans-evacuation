import { getBuiltinSymbol } from '../symbols/library';
import type { DoorElement, Element, Floor, Pt, SymbolElement, WindowElement } from './types';

export interface Rect { x: number; y: number; w: number; h: number }

export const emptyRect = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 });

export function rectFromPoints(pts: Pt[]): Rect {
  if (!pts.length) return emptyRect();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const pts: Pt[] = [];
  for (const r of rects) { pts.push([r.x, r.y], [r.x + r.w, r.y + r.h]); }
  return rectFromPoints(pts);
}

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function rotatePoint([x, y]: Pt, [cx, cy]: Pt, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

function boxCorners(cx: number, cy: number, w: number, h: number, rot: number): Pt[] {
  const c: Pt[] = [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
  return rot ? c.map((p) => rotatePoint(p, [cx, cy], rot)) : c;
}

/** Estimation de la largeur d'un texte (police sans empattement). */
export function textSize(text: string, fontSize: number, lineHeight = 1.25, letterSpacing = 0): { w: number; h: number } {
  const lines = text.split('\n');
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return { w: longest * (fontSize * 0.56 + letterSpacing), h: fontSize * 1.2 + (lines.length - 1) * fontSize * lineHeight };
}

export function polygonArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; a += x0 * y1 - x1 * y0; }
  return Math.abs(a / 2);
}

export function legendSize(fontSize: number, count: number, columns = 1): { w: number; h: number } {
  const row = fontSize * 2;
  const cols = Math.max(1, columns);
  const rows = Math.max(1, Math.ceil(count / cols));
  return { w: fontSize * 18 * cols, h: fontSize * 2.2 + rows * row + fontSize * 0.6 };
}

export function doorDimensions(width: number) {
  return { gap: Math.max(6, width * 0.16), stroke: Math.max(2, width * 0.035) };
}

function doorBox(el: DoorElement, wallDepth?: number) {
  const w = el.width;
  const { gap: defaultGap, stroke } = doorDimensions(w);
  const gap = wallDepth ?? defaultGap;
  let halfWidth = w / 2;
  let top = -gap / 2;
  let bottom = gap / 2;
  switch (el.doorType) {
    case 'single':
    case 'double':
      halfWidth += stroke / 2;
      top = Math.min(top, -(el.doorType === 'single' ? w : w / 2) - stroke / 2);
      break;
    case 'sliding':
      halfWidth += stroke * 0.3;
      top = Math.min(top, -stroke * 2.5);
      bottom = Math.max(bottom, stroke * 2.5);
      break;
    case 'revolving':
      halfWidth += stroke * 0.3;
      top = Math.min(top, -halfWidth);
      bottom = Math.max(bottom, halfWidth);
      break;
  }
  return {
    cx: el.x,
    cy: el.y + (top + bottom) / 2 * (el.flipY ? -1 : 1),
    w: halfWidth * 2,
    h: bottom - top,
  };
}

/** Taille locale (non pivotée) d'un élément « boîte » et son centre. */
export function boxOf(el: Element, legendCount = 6, wallDepth?: number): { cx: number; cy: number; w: number; h: number } | null {
  switch (el.type) {
    case 'symbol': return { cx: el.x, cy: el.y, w: el.size * (el.stretchX ?? 1), h: el.size * (el.stretchY ?? 1) };
    case 'door': return doorBox(el, wallDepth);
    case 'window': return { cx: el.x, cy: el.y, w: el.width, h: el.depth };
    case 'shape': return { cx: el.x, cy: el.y, w: el.w, h: el.shape === 'line' ? Math.max(el.strokeWidth * 3, 6) : el.h };
    case 'stairs': return { cx: el.x, cy: el.y, w: el.w, h: el.h };
    case 'image': return { cx: el.x, cy: el.y, w: el.w, h: el.h };
    case 'text': {
      const s = textSize(el.uppercase ? el.text.toUpperCase() : el.text, el.fontSize, el.lineHeight, el.letterSpacing);
      const pad = el.background || el.border ? el.fontSize * el.padding : 0;
      const left = el.align === 'start' ? el.x : el.align === 'middle' ? el.x - s.w / 2 : el.x - s.w;
      return { cx: left + s.w / 2, cy: el.y + s.h / 2, w: s.w + 2 * pad, h: s.h + 2 * pad };
    }
    case 'legend': {
      const s = legendSize(el.fontSize, legendCount, el.columns);
      return { cx: el.x + s.w / 2, cy: el.y + s.h / 2, w: s.w, h: s.h };
    }
    default: return null;
  }
}

export const RESIZE_DIRECTIONS: readonly Pt[] = [
  [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0],
];

/** Redimensionne dans les axes de l'objet et conserve le point opposé dans le plan. */
export function resizeBoxElement(
  el: Element, direction: Pt, delta: Pt, proportional: boolean, legendCount = 6, wallDepth?: number,
): Element {
  const box = boxOf(el, legendCount, wallDepth);
  if (!box || !('x' in el)) return el;
  const [sx, sy] = direction;
  const angle = el.type === 'legend' ? 0 : el.rotation;
  const [dx, dy] = rotatePoint(delta, [0, 0], -angle);
  const dw = sx * dx, dh = sy * dy;
  const width = box.w + dw, height = box.h + dh;
  const corner = !!(sx && sy);
  const scale = corner
    ? 1 + (dw * box.w + dh * box.h) / (box.w ** 2 + box.h ** 2)
    : sx ? width / Math.max(1, box.w) : height / Math.max(1, box.h);
  let resized: typeof el;
  switch (el.type) {
    case 'symbol':
      resized = corner
        ? { ...el, size: Math.max(8, el.size * scale) }
        : sx ? { ...el, stretchX: Math.max(0.15, Math.min(12, width / el.size)) }
          : { ...el, stretchY: Math.max(0.15, Math.min(12, height / el.size)) };
      break;
    case 'image':
    case 'stairs':
    case 'shape': {
      const min = el.type === 'stairs' ? 20 : el.type === 'image' ? 10 : 6;
      if (el.type === 'shape' && el.shape === 'line') {
        resized = { ...el, w: Math.max(min, width) };
      } else if (corner && proportional) {
        const k = Math.max(scale, min / Math.min(el.w, el.h));
        resized = { ...el, w: el.w * k, h: el.h * k };
      } else {
        resized = { ...el, w: sx ? Math.max(min, width) : el.w, h: sy ? Math.max(min, height) : el.h };
      }
      break;
    }
    case 'window': {
      const k = Math.max(scale, 30 / el.width, 4 / el.depth);
      resized = corner && proportional
        ? { ...el, width: el.width * k, depth: el.depth * k }
        : { ...el, width: sx ? Math.max(30, width) : el.width, depth: sy ? Math.max(4, height) : el.depth };
      break;
    }
    case 'door':
      resized = { ...el, width: Math.max(30, el.width + dw) };
      break;
    case 'text': {
      const fontSize = Math.max(4, el.fontSize * scale);
      resized = { ...el, fontSize, letterSpacing: el.letterSpacing * fontSize / el.fontSize };
      break;
    }
    case 'legend':
      resized = { ...el, fontSize: Math.max(4, el.fontSize * scale) };
      break;
  }
  const nextBox = boxOf(resized, legendCount, wallDepth)!;
  const fixed = (item: typeof el, b: typeof box): Pt => {
    const pivot: Pt = item.type === 'text' || item.type === 'door' ? [item.x, item.y] : [b.cx, b.cy];
    const anchor: Pt = item.type === 'door'
      ? [item.x - sx * item.width / 2, item.y]
      : [b.cx - sx * b.w / 2, b.cy - sy * b.h / 2];
    return rotatePoint(anchor, pivot, angle);
  };
  const [x, y] = fixed(el, box);
  const [nextX, nextY] = fixed(resized, nextBox);
  return { ...resized, x: resized.x + x - nextX, y: resized.y + y - nextY };
}

export function elementBounds(el: Element, legendCount = 6): Rect {
  if ('points' in el) {
    const r = rectFromPoints(el.points);
    const pad = el.type === 'wall' ? el.thickness / 2 : el.type === 'route' ? el.width * 1.5 : 0;
    return inflate(r, pad);
  }
  const b = boxOf(el, legendCount)!;
  const rotPivot: Pt = el.type === 'text' || el.type === 'door' ? [el.x, el.y] : [b.cx, b.cy];
  const corners = boxCorners(b.cx, b.cy, b.w, b.h, 0).map((p) => (el.rotation ? rotatePoint(p, rotPivot, el.rotation) : p));
  return rectFromPoints(corners);
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** Déplace un élément (retourne une copie). */
export function translateElement<T extends Element>(el: T, dx: number, dy: number): T {
  if ('points' in el) return { ...el, points: el.points.map(([x, y]) => [x + dx, y + dy] as Pt) };
  return { ...el, x: (el as any).x + dx, y: (el as any).y + dy };
}

/** Fait pivoter un élément autour d'un point (retourne une copie). */
export function rotateElementAround<T extends Element>(el: T, pivot: Pt, deg: number): T {
  if ('points' in el) return { ...el, points: el.points.map((p) => rotatePoint(p, pivot, deg)) };
  const [nx, ny] = rotatePoint([(el as any).x, (el as any).y], pivot, deg);
  return { ...el, x: nx, y: ny, rotation: normAngle(el.rotation + deg) };
}

export function normAngle(a: number): number {
  let r = a % 360;
  if (r < 0) r += 360;
  return Math.round(r * 100) / 100;
}

export function rectCenter(r: Rect): Pt { return [r.x + r.w / 2, r.y + r.h / 2]; }

export function distance(a: Pt, b: Pt): number { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (!l2) return distance(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** Contrainte à 45° (touche Maj pendant le dessin). */
export function constrain45(from: Pt, to: Pt): Pt {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [from[0] + Math.cos(ang) * len, from[1] + Math.sin(ang) * len];
}

export function snapToGrid(p: Pt, size: number): Pt {
  return [Math.round(p[0] / size) * size, Math.round(p[1] / size) * size];
}

export interface FuseSides { l: boolean; r: boolean; t: boolean; b: boolean }

/** Panneau pouvant être fusionné (signal carré non tourné, hors symboles de plan). */
function fusable(el: SymbolElement): boolean {
  if (el.fuse === false || el.halo) return false;
  if (((el.rotation || 0) % 360 + 360) % 360 !== 0) return false;
  return !getBuiltinSymbol(el.symbolId)?.planSymbol && !el.symbolId.startsWith('you-are-here') && el.symbolId !== 'north';
}

/**
 * Côtés d'un panneau collés à un autre panneau (écart ≤ 8 % de la taille, recouvrement ≥ 50 % sur l'autre axe).
 * Sur ces côtés, le rendu supprime le liseré blanc pour que les deux panneaux paraissent n'en former qu'un.
 */
export function symbolFuseSides(el: SymbolElement, floor: Floor | null | undefined, variantId: string): FuseSides {
  const out: FuseSides = { l: false, r: false, t: false, b: false };
  if (!floor || !fusable(el)) return out;
  const w = el.size * (el.stretchX ?? 1), h = el.size * (el.stretchY ?? 1);
  const a = { x0: el.x - w / 2, x1: el.x + w / 2, y0: el.y - h / 2, y1: el.y + h / 2 };
  for (const o of floor.elements) {
    if (o.type !== 'symbol' || o.id === el.id || o.layer !== el.layer || !isVisibleInVariant(o, variantId) || !fusable(o)) continue;
    const ow = o.size * (o.stretchX ?? 1), oh = o.size * (o.stretchY ?? 1);
    const b = { x0: o.x - ow / 2, x1: o.x + ow / 2, y0: o.y - oh / 2, y1: o.y + oh / 2 };
    const tol = 0.08 * Math.min(el.size, o.size);
    const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const minH = Math.min(h, oh), minW = Math.min(w, ow);
    if (overlapY >= 0.5 * minH) {
      if (Math.abs(b.x0 - a.x1) <= tol) out.r = true;
      if (Math.abs(a.x0 - b.x1) <= tol) out.l = true;
    }
    if (overlapX >= 0.5 * minW) {
      if (Math.abs(b.y0 - a.y1) <= tol) out.b = true;
      if (Math.abs(a.y0 - b.y1) <= tol) out.t = true;
    }
  }
  return out;
}

export function isVisibleInVariant(el: Element, variantId: string): boolean {
  return el.variantId ? el.variantId === variantId : !el.excludedVariantIds?.includes(variantId);
}

function* visibleWalls(floor: Floor, variantId: string, exclude: Set<string>) {
  for (const el of floor.elements) {
    if (el.type === 'wall' && el.points.length >= 2 && !exclude.has(el.id) && isVisibleInVariant(el, variantId)) yield el;
  }
}

/** Lignes des deux faces d'un segment de mur (décalées de ± épaisseur/2), prolongées loin de part et d'autre. */
function wallFaceLines(a: Pt, b: Pt, thickness: number): [Pt, Pt][] {
  const L = distance(a, b);
  if (!L) return [];
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, h = thickness / 2, far = 1e5;
  return [h, -h].map((o): [Pt, Pt] => {
    const ox = -uy * o, oy = ux * o;
    return [[a[0] + ox - ux * far, a[1] + oy - uy * far], [b[0] + ox + ux * far, b[1] + oy + uy * far]];
  });
}

/**
 * Aimantation d'un point de mur sur les autres murs : une extrémité ou un angle proche en priorité,
 * sinon le point le plus proche de l'axe d'un mur (jonction en T). `tolerance` en unités plan.
 * La portée tient compte des épaisseurs (celle du mur visé et `ownThickness`, celle du mur manipulé) :
 * deux murs épais dont les bords se touchent s'accrochent même si leurs axes restent éloignés.
 * `faces` : lignes des faces du mur visé, à afficher comme repères d'alignement.
 */
export function snapPointToWalls(
  floor: Floor, variantId: string, p: Pt, tolerance: number, exclude: Set<string> = new Set(), ownThickness = 0,
): { point: Pt; kind: 'end' | 'axis'; faces: [Pt, Pt][] } | null {
  let end: Pt | null = null, bestEnd = Infinity;
  for (const w of visibleWalls(floor, variantId, exclude)) {
    const reach = tolerance + 0.75 * ((w.thickness || 0) + ownThickness);
    for (const v of w.points) {
      const d = distance(p, v);
      if (d <= reach && d < bestEnd) { bestEnd = d; end = v; }
    }
  }
  if (end) {
    const at = end as Pt, faces: [Pt, Pt][] = [];
    // repères : faces de tous les segments qui partent de ce sommet (angle partagé par plusieurs murs)
    for (const w of visibleWalls(floor, variantId, exclude)) {
      const n = w.points.length;
      w.points.forEach((v, i) => {
        if (distance(v, at) > 1e-6) return;
        const prev = i > 0 ? w.points[i - 1] : w.closed ? w.points[n - 1] : undefined;
        const next = i < n - 1 ? w.points[i + 1] : w.closed ? w.points[0] : undefined;
        if (prev) faces.push(...wallFaceLines(prev, v, w.thickness || 0));
        if (next) faces.push(...wallFaceLines(v, next, w.thickness || 0));
      });
    }
    return { point: [at[0], at[1]], kind: 'end', faces };
  }
  let axis: { q: Pt; faces: [Pt, Pt][] } | null = null, bestAxis = Infinity;
  for (const w of visibleWalls(floor, variantId, exclude)) {
    const reach = tolerance + ((w.thickness || 0) + ownThickness) / 2;
    const n = w.points.length, segs = w.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = w.points[i], b = w.points[(i + 1) % n];
      const abx = b[0] - a[0], aby = b[1] - a[1], L2 = abx * abx + aby * aby;
      if (!L2) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / L2));
      const q: Pt = [a[0] + abx * t, a[1] + aby * t];
      const d = distance(p, q);
      if (d <= reach && d < bestAxis) { bestAxis = d; axis = { q, faces: wallFaceLines(a, b, w.thickness || 0) }; }
    }
  }
  if (!axis) return null;
  const { q, faces } = axis as { q: Pt; faces: [Pt, Pt][] };
  return { point: q, kind: 'axis', faces };
}

/**
 * Murs raccordés à un point : sommets d'autres murs confondus avec lui, et (avec `segment`) extrémités
 * d'autres murs posées sur ce segment (jonctions en T). Sert à les faire suivre quand on déplace un mur.
 */
export function wallJoints(
  floor: Floor, variantId: string, owner: string, at: Pt, segment?: [Pt, Pt], tolerance = 0.75,
): { id: string; index: number; orig: Pt }[] {
  const out: { id: string; index: number; orig: Pt }[] = [];
  for (const w of visibleWalls(floor, variantId, new Set([owner]))) {
    w.points.forEach((v, index) => {
      const isEnd = !w.closed && (index === 0 || index === w.points.length - 1);
      let joined = distance(v, at) <= tolerance;
      if (!joined && segment && isEnd) {
        const [a, b] = segment, abx = b[0] - a[0], aby = b[1] - a[1], L2 = abx * abx + aby * aby;
        const t = L2 ? ((v[0] - a[0]) * abx + (v[1] - a[1]) * aby) / L2 : -1;
        joined = t >= 0 && t <= 1 && distance(v, [a[0] + abx * t, a[1] + aby * t]) <= tolerance;
      }
      if (joined) out.push({ id: w.id, index, orig: [v[0], v[1]] });
    });
  }
  return out;
}

export const DEFAULT_SYMBOL_WALL_GAP = 6;
const SYMBOL_WALL_SNAP_RANGE = 50;

/** Aimante le pictogramme à la distance de retrait, du côté indiqué par le pointeur. */
export function snapSymbolToWalls(
  floor: Floor, variantId: string, symbol: SymbolElement,
  { at = [symbol.x, symbol.y], gap }: { at?: Pt; gap: number },
): SymbolElement {
  if (getBuiltinSymbol(symbol.symbolId)?.planSymbol) return symbol;
  const halfSize = symbol.size * (symbol.halo ? 0.63 : 0.5);
  const halfW = halfSize * (symbol.stretchX ?? 1);
  const halfH = halfSize * (symbol.stretchY ?? 1);
  const radius = Math.hypot(halfW, halfH) + DEFAULT_SYMBOL_WALL_GAP;
  const targets = [];
  for (const { a, b, length, depth: thickness } of visibleWallSegments(floor, variantId)) {
    const depth = thickness / 2;
    const nearby = 2 * (radius + Math.SQRT2 * depth + SYMBOL_WALL_SNAP_RANGE);
    if (distToSegment(at, a, b) > nearby) continue;
    const [ax, ay] = a;
    const ux = (b[0] - ax) / length, uy = (b[1] - ay) / length;
    const [sx, sy] = rotatePoint([ux, uy], [0, 0], -symbol.rotation);
    const face = halfW * Math.abs(sy) + halfH * Math.abs(sx) + depth;
    const endReach = halfW * Math.abs(sx) + halfH * Math.abs(sy) + depth + DEFAULT_SYMBOL_WALL_GAP;
    const across = (at[1] - ay) * ux - (at[0] - ax) * uy;
    const along = (at[0] - ax) * ux + (at[1] - ay) * uy;
    // La détection du mur est indépendante du retrait choisi.
    const offset = Math.abs(Math.abs(across) - (face + DEFAULT_SYMBOL_WALL_GAP));
    if (offset > SYMBOL_WALL_SNAP_RANGE || along <= -endReach || along >= length + endReach) continue;
    const side = Math.sign(across) || 1;
    targets.push({ ax, ay, ux, uy, side, reach: face + gap, offset });
  }

  targets.sort((a, b) => a.offset - b.offset);
  const primary = targets[0];
  if (!primary) return symbol;
  const push = primary.reach * primary.side - ((symbol.y - primary.ay) * primary.ux - (symbol.x - primary.ax) * primary.uy);
  let x = symbol.x - push * primary.uy;
  let y = symbol.y + push * primary.ux;
  // Longer le premier mur pour rejoindre le second et conserver les deux retraits.
  const secondary = targets.find((s) => Math.abs(s.ux * primary.uy - s.uy * primary.ux) >= 0.5);
  if (secondary) {
    const push = secondary.reach * secondary.side - ((y - secondary.ay) * secondary.ux - (x - secondary.ax) * secondary.uy);
    const along = push / (secondary.ux * primary.uy - secondary.uy * primary.ux);
    x += along * primary.ux;
    y += along * primary.uy;
  }
  return x === symbol.x && y === symbol.y ? symbol : { ...symbol, x, y };
}

function* visibleWallSegments(floor: Floor, variantId: string) {
  const visibleLayers = new Set(floor.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  for (const wall of floor.elements) {
    if (wall.type !== 'wall' || !visibleLayers.has(wall.layer) || !isVisibleInVariant(wall, variantId)) continue;
    const segmentCount = wall.closed ? wall.points.length : wall.points.length - 1;
    for (let i = 0; i < segmentCount; i++) {
      const a = wall.points[i], b = wall.points[(i + 1) % wall.points.length];
      const length = distance(a, b);
      if (length) yield { a, b, length, depth: wall.thickness };
    }
  }
}

function openingTurn(angle: number, rotation: number): number {
  // Les deux sens d'un même mur sont équivalents.
  return angle - rotation - 180 * Math.round((angle - rotation) / 180);
}

/**
 * Une porte ou fenêtre posée sur un mur doit être dessinée au-dessus des murs (sinon le mur la recouvre).
 * Si un mur du même calque vient après elle dans l'ordre de dessin, elle passe juste après le dernier.
 * Modifie le tableau ; renvoie vrai si l'ordre a changé.
 */
export function raiseOpeningAboveWalls(elements: Element[], id: string): boolean {
  const from = elements.findIndex((el) => el.id === id);
  if (from === -1) return false;
  const opening = elements[from];
  let lastWall = -1;
  elements.forEach((el, i) => { if (el.type === 'wall' && el.layer === opening.layer) lastWall = i; });
  if (lastWall < from) return false;
  elements.splice(from, 1);
  elements.splice(lastWall, 0, opening); // lastWall a reculé d'une place : insertion juste après lui
  return true;
}

/** Avec une tolérance, cherche un point de pose. Sans tolérance, retrouve le mur d'une ouverture déjà alignée. */
export function openingWallFit(
  floor: Floor, variantId: string, opening: Pick<DoorElement | WindowElement, 'x' | 'y' | 'width' | 'rotation'>, snapDistance?: number,
) {
  const halfWidth = opening.width / 2;
  let best: { x: number; y: number; rotation: number; depth: number } | undefined;
  let bestDistance = Infinity;
  let bestTurn = Infinity;
  for (const { a: [ax, ay], b: [bx, by], length, depth } of visibleWallSegments(floor, variantId)) {
    if (length < opening.width) continue;
    const ux = (bx - ax) / length, uy = (by - ay) / length;
    const along = (opening.x - ax) * ux + (opening.y - ay) * uy;
    const nearest = Math.max(0, Math.min(length, along));
    const dist = Math.hypot(opening.x - ax - nearest * ux, opening.y - ay - nearest * uy);
    const turn = openingTurn(Math.atan2(uy, ux) * 180 / Math.PI, opening.rotation);
    if (snapDistance === undefined) {
      if (dist > 0.01 || Math.abs(turn) > 0.01 || along < halfWidth - 0.01 || along > length - halfWidth + 0.01) continue;
    } else if (dist > depth / 2 + snapDistance) continue;
    if (dist > bestDistance || (dist === bestDistance && Math.abs(turn) >= bestTurn)) continue;
    const center = Math.max(halfWidth, Math.min(length - halfWidth, along));
    best = { x: ax + center * ux, y: ay + center * uy, rotation: opening.rotation + turn, depth };
    bestDistance = dist;
    bestTurn = Math.abs(turn);
  }
  return best;
}

/** Accroche le bord déplacé, ou les deux bords lors d'un changement de largeur seul. */
export function windowResizeWallFit(floor: Floor, variantId: string, opening: WindowElement, side: number, tolerance: number) {
  const halfWidth = opening.width / 2;
  const [faceX, faceY] = rotatePoint([0, side || 1], [0, 0], opening.rotation);
  let best: { window: WindowElement; guides: [Pt, Pt][] } | undefined;
  let bestEdge = Infinity, bestOpposite = Infinity;
  for (const { a: [ax, ay], b: [bx, by], length, depth } of visibleWallSegments(floor, variantId)) {
    const ux = (bx - ax) / length, uy = (by - ay) / length;
    const turn = openingTurn(Math.atan2(uy, ux) * 180 / Math.PI, opening.rotation);
    if (Math.abs(turn) > 5) continue;
    const along = (opening.x - ax) * ux + (opening.y - ay) * uy;
    if (along < halfWidth - 0.001 || along > length - halfWidth + 0.001) continue;
    const across = (opening.y - ay) * ux - (opening.x - ax) * uy;
    const halfDepth = depth / 2;
    if (Math.abs(across) > halfDepth) continue;

    const faceProjection = faceY * ux - faceX * uy;
    const faceOffset = faceProjection * opening.depth / 2;
    const target = Math.sign(faceProjection) * halfDepth;
    const tilt = Math.abs(faceX * ux + faceY * uy) * halfWidth;
    const movedEdge = Math.abs(across + faceOffset - target);
    const opposite = Math.abs(across - faceOffset + target);
    const edge = (side ? movedEdge : Math.max(movedEdge, opposite)) + tilt;
    if (edge > Math.min(tolerance, halfDepth) || edge > bestEdge || (edge === bestEdge && opposite >= bestOpposite)) continue;

    best = {
      window: { ...opening, x: ax + along * ux, y: ay + along * uy, rotation: opening.rotation + turn, depth },
      guides: [-halfDepth, halfDepth].map((offset): [Pt, Pt] => [
        [ax - uy * offset, ay + ux * offset], [bx - uy * offset, by + ux * offset],
      ]),
    };
    bestEdge = edge;
    bestOpposite = opposite;
  }
  return best;
}

export function windowFrameWidth(width: number, depth: number): number {
  return Math.min(width / 2, depth / 2, Math.max(1, depth * 0.12));
}

/** Aligne le bord intérieur du jambage sur la face d'un mur transversal. */
export function windowGlassWallFit(floor: Floor, variantId: string, opening: WindowElement, side: number, tolerance: number) {
  const [ux, uy] = rotatePoint([1, 0], [0, 0], opening.rotation);
  const frame = windowFrameWidth(opening.width, opening.depth);
  const glassEdge = side * (opening.width / 2 - frame);
  let best: { window: WindowElement; guide: [Pt, Pt] } | undefined;
  let closest = tolerance;
  for (const { a, b, length, depth } of visibleWallSegments(floor, variantId)) {
    const vx = (b[0] - a[0]) / length, vy = (b[1] - a[1]) / length;
    if (Math.abs(vx * ux + vy * uy) > 1e-6) continue;
    const along = (opening.x - a[0]) * vx + (opening.y - a[1]) * vy;
    if (along + opening.depth / 2 <= 0 || along - opening.depth / 2 >= length) continue;
    for (const offset of [-depth / 2, depth / 2]) {
      const edge = (a[0] - opening.x) * ux + (a[1] - opening.y) * uy + offset;
      const delta = edge - glassEdge;
      const width = opening.width + side * delta;
      if (Math.abs(delta) > closest || width < 30 || windowFrameWidth(width, opening.depth) !== frame) continue;
      const dx = ux * offset, dy = uy * offset;
      // Traverser le vitrage et prolonger le repère jusqu'au bout de la face du mur.
      const start = Math.min(0, along - opening.depth / 2), end = Math.max(length, along + opening.depth / 2);
      const point = (t: number): Pt => [a[0] + dx + vx * t, a[1] + dy + vy * t];
      best = {
        window: { ...opening, width, x: opening.x + ux * delta / 2, y: opening.y + uy * delta / 2 },
        guide: [point(start), point(end)],
      };
      closest = Math.abs(delta);
    }
  }
  return best;
}

/** Emprise totale de l'étage (fond + éléments visibles de la version). */
export function floorContentBounds(floor: Floor, variantId: string): Rect {
  const rects: Rect[] = [];
  if (floor.background) {
    const b = floor.background;
    rects.push({ x: b.x, y: b.y, w: b.naturalWidth * b.scale, h: b.naturalHeight * b.scale });
  }
  const visibleLayers = new Set(floor.layers.filter((l) => l.visible).map((l) => l.id));
  let legendItems: number | undefined;
  for (const el of floor.elements) {
    if (!visibleLayers.has(el.layer) || !isVisibleInVariant(el, variantId)) continue;
    if (el.type === 'legend') legendItems ??= usedSymbolIds(floor, variantId).length;
    rects.push(elementBounds(el, legendItems));
  }
  const u = unionRects(rects);
  return u && u.w > 0 && u.h > 0 ? inflate(u, Math.max(u.w, u.h) * 0.02) : { x: 0, y: 0, w: 1000, h: 700 };
}

/** Pictogrammes utilisés dans une version (pour la légende), dans l'ordre d'apparition. */
export function usedSymbolIds(floor: Floor, variantId: string): string[] {
  const visibleLayers = new Set(floor.layers.filter((l) => l.visible).map((l) => l.id));
  const ids: string[] = [];
  for (const el of floor.elements) {
    if (el.type === 'symbol' && visibleLayers.has(el.layer) && isVisibleInVariant(el, variantId) && !ids.includes(el.symbolId) && !getBuiltinSymbol(el.symbolId)?.planSymbol) {
      ids.push(el.symbolId);
    }
    // Les portes coupe-feu ont leur propre entrée de légende.
    if (el.type === 'door' && el.fireRated && visibleLayers.has(el.layer) && isVisibleInVariant(el, variantId)) {
      const symbolId = el.doorType === 'double' ? 'door-double-fire' : 'door-fire';
      if (!ids.includes(symbolId)) ids.push(symbolId);
    }
  }
  return ids;
}

export function polylineLength(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += distance(pts[i - 1], pts[i]);
  return l;
}
