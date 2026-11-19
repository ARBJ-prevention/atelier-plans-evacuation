/**
 * Placement du cartouche « Vous êtes ici » et de sa flèche.
 *
 * En position « auto », le cartouche est déplacé autour du repère jusqu'à trouver l'endroit
 * le moins encombré du dessin : on rastérise l'étage en une grille de coûts (pictogrammes, textes,
 * murs, itinéraires = cher ; intérieur des pièces = un peu cher ; vide = gratuit ; hors du dessin =
 * un peu cher car cela réduit l'échelle du plan), puis on essaie des centaines de positions
 * (directions × distances) et l'on garde celle dont le cartouche ET la flèche gênent le moins.
 */
import type { Floor, Pt, SymbolElement } from './types';
import { distToSegment, elementBounds, inflate, isVisibleInVariant, unionRects, type Rect } from './geometry';

export interface HereCallout {
  /** Cartouche (coordonnées plan, toujours horizontal). */
  x: number; y: number; w: number; h: number;
  fontSize: number;
  /** Flèche : du bord du cartouche (`from`) vers le repère (`to`, pointe). */
  from: Pt; to: Pt;
}

export function isHereMarker(el: { type: string; symbolId?: string }): el is SymbolElement {
  return el.type === 'symbol' && (el.symbolId === 'you-are-here' || el.symbolId === 'you-are-here-pin');
}

/** Dimensions du cartouche et de la flèche pour un repère. */
function metrics(el: SymbolElement, drawingDiag = 0) {
  // Taille « auto » : proportionnelle au repère ET au dessin, pour rester lisible une fois l'affiche imprimée.
  const fontSize = el.labelSize > 0 ? el.labelSize : Math.max(10, el.size * 0.36, drawingDiag / 85);
  // Pastille : icône à gauche (≈ 0,86 h), texte, marge droite (≈ 0,42 h).
  const h = fontSize * 1.9;
  const w = h * 1.28 + Math.max(fontSize, Array.from(el.label).length * fontSize * 0.6);
  const sx = el.stretchX ?? 1, sy = el.stretchY ?? 1;
  const radius = (el.size * Math.max(sx, sy)) / 2;
  /** Longueur minimale de la flèche visible (corps + pointe). */
  const minArrow = Math.max(fontSize * 3, el.size * 0.8);
  return { fontSize, w, h, radius, minArrow };
}

/** Point du cartouche (centre c, demi-tailles hw/hh) où sort la flèche dirigée vers `to`. */
function boxExit(c: Pt, hw: number, hh: number, to: Pt): Pt {
  const dx = to[0] - c[0], dy = to[1] - c[1];
  if (!dx && !dy) return c;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [c[0] + dx * t, c[1] + dy * t];
}

/** Construit le cartouche centré en c et la flèche correspondante. */
function build(el: SymbolElement, m: ReturnType<typeof metrics>, c: Pt): HereCallout {
  const from = boxExit(c, m.w / 2 + m.fontSize * 0.12, m.h / 2 + m.fontSize * 0.12, [el.x, el.y]);
  const dx = from[0] - el.x, dy = from[1] - el.y;
  const len = Math.hypot(dx, dy) || 1;
  const gap = m.radius * (el.symbolId === 'you-are-here-pin' ? 0.55 : 1) + m.fontSize * 0.18;
  const to: Pt = [el.x + (dx / len) * gap, el.y + (dy / len) * gap];
  return { x: c[0] - m.w / 2, y: c[1] - m.h / 2, w: m.w, h: m.h, fontSize: m.fontSize, from, to };
}

/** Direction d'une position manuelle. */
const MANUAL_DIR: Record<string, Pt> = { right: [1, 0], left: [-1, 0], above: [0, -1], below: [0, 1] };

/** Cartouche à une distance fixe dans une direction (positions manuelles, repli sans étage). */
function placeAlong(el: SymbolElement, m: ReturnType<typeof metrics>, dir: Pt): HereCallout {
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / len, uy = dir[1] / len;
  // Distance centre-à-bord du cartouche dans cette direction.
  const edge = Math.min(ux ? (m.w / 2) / Math.abs(ux) : Infinity, uy ? (m.h / 2) / Math.abs(uy) : Infinity);
  const d = m.radius + m.minArrow + edge + m.fontSize * 0.3;
  return build(el, m, [el.x + ux * d, el.y + uy * d]);
}

// ── Grille d'encombrement ───────────────────────────────────────────────────

const C_HARD = 10;   // pictogrammes, textes, légende, noms de pièces, autres repères
const C_LINE = 8;    // murs, portes, fenêtres, itinéraires
const C_SOFT = 4;    // escaliers, images, formes
const C_ROOM = 1.8;  // intérieur d'une pièce
const C_OUT = 0.45;  // hors de l'emprise du dessin (agrandit un peu la page, mais la flèche « sort » du plan)

interface Grid {
  x0: number; y0: number; cell: number; nx: number; ny: number;
  cost: Float32Array;
  /** Tableau des sommes cumulées (somme d'un rectangle en temps constant). */
  sat: Float64Array;
  drawing: Rect;
}

const gridCache = new WeakMap<Floor, Map<string, Grid | null>>();
const calloutCache = new WeakMap<Floor, Map<string, HereCallout>>();

function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonCenter(p: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const n = p.length || 1;
    return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function buildGrid(floor: Floor, variantId: string): Grid | null {
  const visibleLayers = new Set(floor.layers.filter((l) => l.visible).map((l) => l.id));
  const els = floor.elements.filter((e) => visibleLayers.has(e.layer) && isVisibleInVariant(e, variantId) && (e.opacity ?? 1) > 0);
  const rects: Rect[] = els.filter((e) => !isHereMarker(e)).map((e) => elementBounds(e));
  const bg = floor.background;
  if (bg) rects.push({ x: bg.x, y: bg.y, w: bg.naturalWidth * bg.scale, h: bg.naturalHeight * bg.scale });
  const drawing = unionRects(rects);
  if (!drawing || !(drawing.w > 0 && drawing.h > 0)) return null;
  const diag = Math.hypot(drawing.w, drawing.h);
  const ext = inflate(drawing, diag * 0.22);
  const cell = Math.max(ext.w, ext.h) / 480;
  const nx = Math.ceil(ext.w / cell), ny = Math.ceil(ext.h / cell);
  const cost = new Float32Array(nx * ny);
  const g: Grid = { x0: ext.x, y0: ext.y, cell, nx, ny, cost, sat: new Float64Array((nx + 1) * (ny + 1)), drawing };

  const ix = (x: number) => Math.floor((x - g.x0) / cell);
  const iy = (y: number) => Math.floor((y - g.y0) / cell);
  const span = (r: Rect) => ({
    a: Math.max(0, ix(r.x)), b: Math.min(nx - 1, ix(r.x + r.w)),
    c: Math.max(0, iy(r.y)), d: Math.min(ny - 1, iy(r.y + r.h)),
  });
  const put = (i: number, j: number, v: number) => { const k = j * nx + i; if (cost[k] < v) cost[k] = v; };
  const stampRect = (r: Rect, v: number) => {
    const s = span(r);
    for (let j = s.c; j <= s.d; j++) for (let i = s.a; i <= s.b; i++) put(i, j, v);
  };
  const stampSegment = (p: Pt, q: Pt, hw: number, v: number) => {
    const r = inflate({ x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]), w: Math.abs(p[0] - q[0]), h: Math.abs(p[1] - q[1]) }, hw + cell);
    const s = span(r);
    const lim = hw + cell * 0.71;
    for (let j = s.c; j <= s.d; j++) {
      for (let i = s.a; i <= s.b; i++) {
        if (distToSegment([g.x0 + (i + 0.5) * cell, g.y0 + (j + 0.5) * cell], p, q) <= lim) put(i, j, v);
      }
    }
  };
  const stampPolyline = (pts: Pt[], closed: boolean, hw: number, v: number) => {
    for (let k = 0; k < pts.length - 1; k++) stampSegment(pts[k], pts[k + 1], hw, v);
    if (closed && pts.length > 2) stampSegment(pts[pts.length - 1], pts[0], hw, v);
  };
  const fillPolygon = (pts: Pt[], v: number) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const s = span({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    for (let j = s.c; j <= s.d; j++) {
      for (let i = s.a; i <= s.b; i++) {
        if (pointInPolygon(g.x0 + (i + 0.5) * cell, g.y0 + (j + 0.5) * cell, pts)) put(i, j, v);
      }
    }
  };

  // Hors de l'emprise du dessin : légèrement pénalisé (l'affiche serait imprimée plus petite).
  for (let j = 0; j < ny; j++) {
    const y = g.y0 + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) {
      const x = g.x0 + (i + 0.5) * cell;
      if (x < drawing.x || x > drawing.x + drawing.w || y < drawing.y || y > drawing.y + drawing.h) cost[j * nx + i] = C_OUT;
    }
  }
  if (bg) stampRect({ x: bg.x, y: bg.y, w: bg.naturalWidth * bg.scale, h: bg.naturalHeight * bg.scale }, C_ROOM);

  for (const e of els) {
    switch (e.type) {
      case 'area': {
        if (e.points.length < 3) break;
        fillPolygon(e.points, C_ROOM);
        if (e.label.trim()) {
          const fs = e.labelSize > 0 ? e.labelSize : 16;
          const lines = e.label.split('\n');
          const w = Math.max(...lines.map((l) => l.length)) * fs * 0.6;
          const h = fs * 1.3 * (lines.length + (e.showArea ? 1 : 0));
          const [cx, cy] = polygonCenter(e.points);
          stampRect(inflate({ x: cx + e.labelDx - w / 2, y: cy + e.labelDy - h / 2, w, h }, fs * 0.3), C_HARD);
        }
        break;
      }
      case 'wall':
        stampPolyline(e.points, e.closed, e.thickness / 2, C_LINE);
        break;
      case 'route':
        stampPolyline(e.points, false, e.width * 1.2, C_LINE);
        break;
      case 'door': case 'window':
        stampRect(elementBounds(e), C_LINE);
        break;
      case 'stairs': case 'image': case 'shape':
        stampRect(elementBounds(e), C_SOFT);
        break;
      case 'symbol': {
        if (e.symbolId === 'you-are-here' || e.symbolId === 'you-are-here-pin') break; // ajoutés au moment du calcul (le repère traité ne se gêne pas lui-même)
        const b = elementBounds(e);
        stampRect(inflate(b, e.size * 0.12), C_HARD);
        if (e.label.trim()) {
          const ls = e.labelSize > 0 ? e.labelSize : Math.max(8, e.size * 0.26);
          const w = e.label.length * ls * 0.6, h = ls * 1.3;
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          const r = e.labelPosition === 'right' ? { x: b.x + b.w, y: cy - h / 2, w, h }
            : e.labelPosition === 'left' ? { x: b.x - w, y: cy - h / 2, w, h }
              : e.labelPosition === 'above' ? { x: cx - w / 2, y: b.y - h, w, h }
                : { x: cx - w / 2, y: b.y + b.h, w, h };
          stampRect(r, C_HARD);
        }
        break;
      }
      default:
        stampRect(elementBounds(e), C_HARD);
    }
  }

  // Sommes cumulées
  const W = nx + 1;
  for (let j = 0; j < ny; j++) {
    let row = 0;
    for (let i = 0; i < nx; i++) {
      row += cost[j * nx + i];
      g.sat[(j + 1) * W + (i + 1)] = g.sat[j * W + (i + 1)] + row;
    }
  }
  return g;
}

function getGrid(floor: Floor, variantId: string): Grid | null {
  let m = gridCache.get(floor);
  if (!m) gridCache.set(floor, (m = new Map()));
  if (!m.has(variantId)) m.set(variantId, buildGrid(floor, variantId));
  return m.get(variantId) ?? null;
}

/** Coût moyen d'un rectangle ; null s'il sort de la grille. */
function rectCost(g: Grid, r: Rect): number | null {
  const a = Math.floor((r.x - g.x0) / g.cell), b = Math.ceil((r.x + r.w - g.x0) / g.cell);
  const c = Math.floor((r.y - g.y0) / g.cell), d = Math.ceil((r.y + r.h - g.y0) / g.cell);
  if (a < 0 || c < 0 || b > g.nx || d > g.ny || b <= a || d <= c) return null;
  const W = g.nx + 1, s = g.sat;
  const sum = s[d * W + b] - s[c * W + b] - s[d * W + a] + s[c * W + a];
  return sum / ((b - a) * (d - c));
}

/** Coût cumulé le long d'un segment (une mesure par maille). */
function segmentCost(g: Grid, p: Pt, q: Pt): number {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n = Math.max(1, Math.ceil(len / (g.cell * 0.8)));
  let sum = 0;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const i = Math.floor((p[0] + (q[0] - p[0]) * t - g.x0) / g.cell);
    const j = Math.floor((p[1] + (q[1] - p[1]) * t - g.y0) / g.cell);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) { sum += C_HARD; continue; }
    sum += g.cost[j * g.nx + i];
  }
  return (sum * len) / (n + 1);
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function autoPlace(el: SymbolElement, m: ReturnType<typeof metrics>, floor: Floor, variantId: string): HereCallout | null {
  const g = getGrid(floor, variantId);
  if (!g) return null;
  const visibleLayers = new Set(floor.layers.filter((l) => l.visible).map((l) => l.id));
  // Les autres repères de la même affiche sont des obstacles.
  const others = floor.elements.filter((e): e is SymbolElement => e.id !== el.id && isHereMarker(e)
    && visibleLayers.has(e.layer) && isVisibleInVariant(e, variantId)).map((e) => inflate(elementBounds(e), e.size * 0.2));

  const fs = m.fontSize;
  const pad = fs * 0.45;
  const markerBox = inflate({ x: el.x - m.radius, y: el.y - m.radius, w: m.radius * 2, h: m.radius * 2 }, fs * 0.3);
  const dMax = Math.hypot(g.drawing.w, g.drawing.h) * 0.45 + m.w;
  let best: { cost: number; c: Pt } | null = null;
  const DIRS = 36;
  for (let a = 0; a < DIRS; a++) {
    const ang = (a / DIRS) * Math.PI * 2;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const edge = Math.min(ux ? (m.w / 2) / Math.abs(ux) : Infinity, uy ? (m.h / 2) / Math.abs(uy) : Infinity);
    const d0 = m.radius + m.minArrow + edge + fs * 0.3;
    for (let d = d0; d <= dMax; d += Math.max(fs * 0.6, (d - d0) * 0.12)) {
      const c: Pt = [el.x + ux * d, el.y + uy * d];
      const box: Rect = { x: c[0] - m.w / 2 - pad, y: c[1] - m.h / 2 - pad, w: m.w + pad * 2, h: m.h + pad * 2 };
      const boxCost = rectCost(g, box);
      if (boxCost === null) continue;
      if (overlapArea(box, markerBox) > 0) continue;
      let cost = boxCost * 60;
      for (const o of others) cost += (overlapArea(box, o) / (box.w * box.h)) * C_HARD * 60;
      const arrow = build(el, m, c);
      const arrowLen = Math.hypot(arrow.from[0] - arrow.to[0], arrow.from[1] - arrow.to[1]);
      cost += (segmentCost(g, arrow.to, arrow.from) / fs) * 2.4;
      cost += (arrowLen / fs) * 0.9;
      // Légère préférence pour les flèches obliques (lecture plus naturelle qu'à l'horizontale pure).
      cost += Math.abs(Math.cos(2 * ang)) * 0.8;
      if (!best || cost < best.cost) best = { cost, c };
    }
  }
  return best ? build(el, m, best.c) : null;
}

/**
 * Cartouche et flèche d'un repère « Vous êtes ici » (null si ce n'est pas un repère ou s'il n'a pas de texte).
 * Sans étage, la position « auto » retombe à droite.
 */
export function hereCallout(el: SymbolElement, floor?: Floor | null, variantId?: string): HereCallout | null {
  if (!isHereMarker(el) || !el.label.trim()) return null;
  const g = floor && variantId !== undefined ? getGrid(floor, variantId) : null;
  const m = metrics(el, g ? Math.hypot(g.drawing.w, g.drawing.h) : 0);
  if (el.hereOffset) return build(el, m, [el.x + el.hereOffset[0], el.y + el.hereOffset[1]]);
  const pos = el.labelPosition;
  if (pos !== 'auto' || !floor || variantId === undefined) return placeAlong(el, m, MANUAL_DIR[pos] ?? [1, -0.6]);
  const key = `${variantId}|${el.id}|${el.x}|${el.y}|${el.size}|${el.label}|${el.labelSize}|${el.stretchX ?? 1}|${el.stretchY ?? 1}`;
  let cache = calloutCache.get(floor);
  if (!cache) calloutCache.set(floor, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const out = autoPlace(el, m, floor, variantId) ?? placeAlong(el, m, [1, -0.6]);
  cache.set(key, out);
  return out;
}
