import { getBuiltinSymbol } from '../symbols/library';
import type { Element, Floor, Pt, SymbolElement } from './types';

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

/** Taille locale (non pivotée) d'un élément « boîte » et son centre. */
export function boxOf(el: Element, legendCount = 6): { cx: number; cy: number; w: number; h: number } | null {
  switch (el.type) {
    case 'symbol': return { cx: el.x, cy: el.y, w: el.size * (el.stretchX ?? 1), h: el.size * (el.stretchY ?? 1) };
    case 'door': return { cx: el.x, cy: el.y, w: el.width, h: el.doorType === 'double' ? el.width / 2 : el.width };
    case 'window': return { cx: el.x, cy: el.y, w: el.width, h: Math.max(el.depth, 8) };
    case 'shape': return { cx: el.x, cy: el.y, w: el.w, h: el.shape === 'line' ? Math.max(el.strokeWidth * 3, 6) : el.h };
    case 'stairs': return { cx: el.x, cy: el.y, w: el.w, h: el.h };
    case 'image': return { cx: el.x, cy: el.y, w: el.w, h: el.h };
    case 'text': {
      const s = textSize(el.text, el.fontSize, el.lineHeight, el.letterSpacing);
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

export function elementBounds(el: Element, legendCount = 6): Rect {
  if ('points' in el) {
    const r = rectFromPoints(el.points);
    const pad = el.type === 'wall' ? el.thickness / 2 : el.type === 'route' ? el.width * 1.5 : 0;
    return inflate(r, pad);
  }
  const b = boxOf(el, legendCount)!;
  if (el.type === 'door') {
    const w = el.width;
    const leaf = el.doorType === 'double' ? w / 2 : el.doorType === 'single' ? w : w / 2;
    const ys = el.doorType === 'revolving' ? [-w / 2, w / 2] : [el.flipY ? leaf : -leaf, 6];
    const all: Pt[] = [[-w / 2, ys[0]], [w / 2, ys[0]], [w / 2, ys[1]], [-w / 2, ys[1]]].map(([x, y]) => [el.x + x, el.y + y] as Pt);
    return rectFromPoints(all.map((p) => rotatePoint(p, [el.x, el.y], el.rotation)));
  }
  const rotPivot: Pt = el.type === 'text' ? [el.x, el.y] : [b.cx, b.cy];
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
  return !el.variantId || el.variantId === variantId;
}

/** Emprise totale de l'étage (fond + éléments visibles de la version). */
export function floorContentBounds(floor: Floor, variantId: string): Rect {
  const rects: Rect[] = [];
  if (floor.background) {
    const b = floor.background;
    rects.push({ x: b.x, y: b.y, w: b.naturalWidth * b.scale, h: b.naturalHeight * b.scale });
  }
  const visibleLayers = new Set(floor.layers.filter((l) => l.visible).map((l) => l.id));
  for (const el of floor.elements) {
    if (!visibleLayers.has(el.layer) || !isVisibleInVariant(el, variantId)) continue;
    rects.push(elementBounds(el, usedSymbolIds(floor, variantId).length));
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
    if (el.type === 'door' && el.fireRated && visibleLayers.has(el.layer) && isVisibleInVariant(el, variantId) && !ids.includes('door-fire')) {
      ids.push('door-fire');
    }
  }
  return ids;
}

export function polylineLength(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += distance(pts[i - 1], pts[i]);
  return l;
}
