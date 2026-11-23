import React from 'react';
import { boxOf, corridorWidthAt, DEFAULT_SYMBOL_WALL_GAP, snapSymbolToWalls, dimensionGeometry, doorDimensions, formatLength, isVisibleInVariant, legendSize, openingHostFit, polygonArea, symbolFuseSides, fuseSidesLocal, textSize, usedSymbolIds, windowFrameWidth, type FuseSides } from '../model/geometry';
import { hereCallout, type HereCallout } from '../model/hereCallout';
import type {
  ArrowStyle, CustomSymbol, DashStyle, DimensionElement, Element, FillPattern, Floor, Pt, RouteElement, ShapeElement, SymbolElement, WallElement,
} from '../model/types';
import { getBuiltinSymbol } from '../symbols/library';

export interface RenderCtx {
  floor: Floor;
  variantId: string;
  customSymbols: CustomSymbol[];
  interactive?: boolean;
  idPrefix?: string;
  /** Impression selon la norme ISO 23601 : mm imprimés par unité plan. */
  norm?: { mmPerUnit: number };
  /** Segments des itinéraires d'évacuation (escaliers à colorer en vert foncé). */
  routes?: [Pt, Pt][];
  /** Taille commune des pictogrammes de sécurité à l'impression (unités plan). */
  symbolSize?: number;
}

/** Murs porteurs ≥ 1,6 mm, autres parois ≥ 0,6 mm (noirs) ; pictogrammes ≥ 7 mm. */
const NORM_LOAD_WALL_MM = 1.6, NORM_WALL_MM = 0.6, NORM_SYMBOL_MM = 7, NORM_OBSTACLE_MM = 0.15;
/** Catégories de symboles de plan traitées comme obstacles à demeure (gris clair). */
const NORM_OBSTACLE_CATS = new Set(['Mobilier', 'Sanitaires et cuisine', 'Équipements techniques']);
const NORM_STAIRS = '#00663a';
/** Taille maximale des pictogrammes harmonisés (mm imprimés) : au-delà, ils cachent portes et pièces. */
const NORM_SYMBOL_MAX_MM = 12;

/**
 * Harmonisation des pictogrammes à l'impression : tous les pictogrammes de sécurité de l'affiche prennent la même
 * taille, la taille la plus courante sur le dessin (médiane), ramenée entre 7 mm (minimum de la norme) et 12 mm.
 * Le repère « Vous êtes ici » et les symboles d'obstacles (mobilier…) gardent leur propre taille.
 */
export function harmonizedSymbolSize(floor: Floor, variantId: string, mmPerUnit: number): number {
  const visible = new Set(floor.layers.filter((l) => l.visible).map((l) => l.id));
  const sizes = floor.elements
    .filter((e): e is SymbolElement => e.type === 'symbol' && visible.has(e.layer) && isVisibleInVariant(e, variantId)
      && !e.symbolId.startsWith('you-are-here') && !NORM_OBSTACLE_CATS.has(getBuiltinSymbol(e.symbolId)?.category ?? ''))
    .map((e) => e.size * mmPerUnit).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor((sizes.length - 1) / 2)] : NORM_SYMBOL_MM;
  return Math.min(NORM_SYMBOL_MAX_MM, Math.max(NORM_SYMBOL_MM, median)) / mmPerUnit;
}

/** Mur porteur : style « hachuré » (mur porteur) ou épaisseur réelle d'au moins 20 cm. */
export function isLoadBearing(el: { wallStyle: string; thickness: number }, unitsPerMeter: number): boolean {
  return el.wallStyle === 'hatch' || (unitsPerMeter > 0 && el.thickness / unitsPerMeter >= 0.2 - 1e-6);
}

/** Segments des itinéraires visibles sur la page. */
export function routeSegments(floor: Floor, variantId: string): [Pt, Pt][] {
  const visible = new Set(floor.layers.filter((l) => l.visible).map((l) => l.id));
  return floor.elements.flatMap((e) => e.type === 'route' && visible.has(e.layer) && e.points.length > 1 && (e.opacity ?? 1) > 0
    && (!e.variantId || e.variantId === variantId) && !e.excludedVariantIds?.includes(variantId)
    ? e.points.slice(1).map((p, i) => [e.points[i], p] as [Pt, Pt]) : []);
}

/** Un segment traverse-t-il (ou touche-t-il) le rectangle ? */
function segmentHitsRect([a, b]: [Pt, Pt], x0: number, y0: number, x1: number, y1: number): boolean {
  const inside = (p: Pt) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  for (let t = 0; t <= 1.0001; t += 0.025) if (inside([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return true;
  return false;
}

export const FONT = "'Segoe UI Variable Text', 'Segoe UI', Arial, Helvetica, sans-serif";
/** Rouge sécurité incendie (portes coupe-feu). */
const FIRE_RED = '#e30613';
const font = (f?: string) => (f ? `'${f}', ${FONT}` : FONT);

export function symbolName(id: string, custom: CustomSymbol[]): string {
  return getBuiltinSymbol(id)?.name ?? custom.find((c) => c.id === id)?.name ?? 'Pictogramme';
}

/** Pictogramme dans une boîte de `size` centrée sur (0,0). */
/**
 * Dessin SVG (data URL) d'un panneau collé : on rogne sa boîte (viewBox) de 3,5 % sur les côtés collés,
 * ce qui retire le liseré blanc (≈ 2,5 %) à la source, et on force preserveAspectRatio « none » (les
 * fichiers ISO déclarent « meet », qui garderait des marges vides dans une image étirée).
 * Renvoie null si le dessin n'est pas un SVG lisible avec une viewBox.
 */
const cropCache = new Map<string, string | null>();
function croppedSvg(src: string, f: FuseSides): string | null {
  if (!src.startsWith('data:image/svg+xml')) return null;
  const key = `${f.l ? 1 : 0}${f.r ? 1 : 0}${f.t ? 1 : 0}${f.b ? 1 : 0}|${src}`;
  if (cropCache.has(key)) return cropCache.get(key)!;
  let out: string | null = null;
  try {
    const comma = src.indexOf(','), b64 = src.slice(0, comma).includes(';base64');
    const body = b64 ? atob(src.slice(comma + 1)) : decodeURIComponent(src.slice(comma + 1));
    const m = body.match(/<svg(\s[^>]*)?>/);
    const vb = m?.[1]?.match(/\sviewBox\s*=\s*"([^"]*)"/);
    const n = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : [];
    if (m && n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0) {
      const k = 0.035;
      const x = n[0] + (f.l ? n[2] * k : 0), y = n[1] + (f.t ? n[3] * k : 0);
      const w = n[2] * (1 - (f.l ? k : 0) - (f.r ? k : 0)), h = n[3] * (1 - (f.t ? k : 0) - (f.b ? k : 0));
      const attrs = (m[1] ?? '').replace(/\s(viewBox|preserveAspectRatio)\s*=\s*"[^"]*"/g, '');
      const fixed = body.replace(m[0], `<svg${attrs} viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="none">`);
      out = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fixed);
    }
  } catch { out = null; }
  cropCache.set(key, out);
  return out;
}

/** Couleur de fond d'un panneau : première couleur non blanche de son dessin (data URL déjà décodable). */
const bgCache = new Map<string, string | null>();
function panelBackground(src: string): string | null {
  if (bgCache.has(src)) return bgCache.get(src)!;
  let bg: string | null = null;
  try {
    const body = decodeURIComponent(src.slice(src.indexOf(',') + 1));
    bg = (body.match(/#[0-9a-fA-F]{6}(?![0-9a-fA-F])/g) ?? []).find((x) => !/^#f{6}$/i.test(x)) ?? null;
  } catch { bg = null; }
  bgCache.set(src, bg);
  return bg;
}

export function SymbolGraphic({ symbolId, size, custom, fuse, clipId }: {
  symbolId: string; size: number; custom: CustomSymbol[];
  /** Côtés collés à un autre panneau : le liseré blanc y est retiré (dessin rogné, ou prolongé puis recadré) pour former un seul panneau. */
  fuse?: FuseSides; clipId?: string;
}) {
  const def = getBuiltinSymbol(symbolId);
  const c = def ? null : custom.find((x) => x.id === symbolId);
  if (def || c) {
    const bl = size * 0.04;
    const f = fuse && clipId && (fuse.l || fuse.r || fuse.t || fuse.b) ? fuse : null;
    const x0 = -size / 2 - (f?.l ? bl : 0), y0 = -size / 2 - (f?.t ? bl : 0);
    const w = size + (f?.l ? bl : 0) + (f?.r ? bl : 0), h = size + (f?.t ? bl : 0) + (f?.b ? bl : 0);
    // SVG en data URL : rogné à la source et posé à cheval (1 %) sur le voisin, sans découpe :
    // un bord découpé (clipPath) laisse un fil clair à l'écran, même entre deux verts identiques.
    const ov = size * 0.01;
    const cropped = f ? croppedSvg(def ? def.svg : c!.src, f) : null;
    if (f && cropped) {
      const cx0 = -size / 2 - (f.l ? ov : 0), cy0 = -size / 2 - (f.t ? ov : 0);
      const bg = panelBackground(cropped);
      const half = size / 2, e = size * 0.02, edge = size * 0.035, reach = 2 * ov;
      return (
        <g>
          <image href={cropped} x={cx0} y={cy0} width={size + (f.l ? ov : 0) + (f.r ? ov : 0)} height={size + (f.t ? ov : 0) + (f.b ? ov : 0)} preserveAspectRatio="none" />
          {/* bande pleine sur le joint, par-dessus le bord de l'image : le lissage d'une image laisse un liseré clair */}
          {bg && (['l', 'r', 't', 'b'] as const).filter((k) => f[k]).map((k) => {
            const vert = k === 'l' || k === 'r';
            const a0 = -half + ((vert ? f.t : f.l) ? -ov : edge), a1 = half - ((vert ? f.b : f.r) ? -ov : edge);
            const c0 = k === 'l' || k === 't' ? -half - reach : half - e;
            return vert
              ? <rect key={k} x={c0} y={a0} width={e + reach} height={a1 - a0} fill={bg} />
              : <rect key={k} x={a0} y={c0} width={a1 - a0} height={e + reach} fill={bg} />;
          })}
        </g>
      );
    }
    const art = def && def.kind === 'svg'
      ? <g transform={`translate(${x0} ${y0}) scale(${w / 100} ${h / 100})`} dangerouslySetInnerHTML={{ __html: def.svg }} />
      : <image href={def ? def.svg : c!.src} x={x0} y={y0} width={w} height={h} preserveAspectRatio={c && !f ? 'xMidYMid meet' : 'none'} />;
    if (!f) return art;
    return (
      <g>
        {/* côtés collés : léger chevauchement (1 %) sur le voisin, sinon l'anticrénelage des deux bords laisse un fil blanc */}
        <defs><clipPath id={clipId}><rect x={-size / 2 - (f.l ? ov : 0)} y={-size / 2 - (f.t ? ov : 0)}
          width={size + (f.l ? ov : 0) + (f.r ? ov : 0)} height={size + (f.t ? ov : 0) + (f.b ? ov : 0)} /></clipPath></defs>
        <g clipPath={`url(#${clipId})`}>{art}</g>
      </g>
    );
  }
  return (
    <g>
      <rect x={-size / 2} y={-size / 2} width={size} height={size} fill="#eee" stroke="#c00" strokeDasharray="4 3" />
      <text x={0} y={size * 0.1} textAnchor="middle" fontSize={size / 3} fill="#c00" fontFamily={FONT}>?</text>
    </g>
  );
}

// ——— Outils de style ———
export function dashArray(dash: DashStyle | undefined, w: number): string | undefined {
  switch (dash) {
    case 'dashed': return `${w * 3} ${w * 2}`;
    case 'dotted': return `0.01 ${w * 2}`;
    case 'dashdot': return `${w * 4} ${w * 1.6} 0.01 ${w * 1.6}`;
    case 'longdash': return `${w * 7} ${w * 3}`;
    default: return undefined;
  }
}
const dashCap = (dash: DashStyle | undefined, fallback: 'round' | 'butt' | 'square' = 'butt') =>
  dash === 'dotted' || dash === 'dashdot' ? 'round' : fallback;

function PatternDef({ id, pattern, color, size }: { id: string; pattern: FillPattern; color: string; size: number }) {
  if (pattern === 'solid' || pattern === 'none') return null;
  const s = size;
  const sw = Math.max(0.6, s * 0.09);
  return (
    <pattern id={id} width={s} height={s} patternUnits="userSpaceOnUse">
      {pattern === 'hatch' && <path d={`M ${-s / 4} ${s / 4} L ${s / 4} ${-s / 4} M 0 ${s} L ${s} 0 M ${s * 0.75} ${s * 1.25} L ${s * 1.25} ${s * 0.75}`} stroke={color} strokeWidth={sw} />}
      {pattern === 'crosshatch' && <path d={`M 0 ${s} L ${s} 0 M 0 0 L ${s} ${s}`} stroke={color} strokeWidth={sw} />}
      {pattern === 'vertical' && <path d={`M ${s / 2} 0 V ${s}`} stroke={color} strokeWidth={sw} />}
      {pattern === 'dots' && <circle cx={s / 2} cy={s / 2} r={s * 0.12} fill={color} />}
    </pattern>
  );
}

const pts = (p: Pt[]) => p.map(([x, y]) => `${x},${y}`).join(' ');

/** Chemin lissé (Catmull-Rom → Bézier) ou polyligne. */
function pathD(p: Pt[], smooth: boolean, closed = false): string {
  if (p.length < 2) return '';
  if (!smooth || p.length < 3) return `M ${p.map(([x, y]) => `${x} ${y}`).join(' L ')}${closed ? ' Z' : ''}`;
  const P = closed ? [p[p.length - 1], ...p, p[0], p[1]] : [p[0], ...p, p[p.length - 1]];
  let d = `M ${P[1][0]} ${P[1][1]}`;
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** Polyligne aux virages arrondis : segments droits raccordés par des arcs (Bézier cubiques). */
export function filletPath(p: Pt[], radius: number): string {
  if (p.length < 3 || radius <= 0) return pathD(p, false);
  let d = `M ${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [a, c, b] = [p[i - 1], p[i], p[i + 1]];
    const la = Math.hypot(a[0] - c[0], a[1] - c[1]) || 1;
    const lb = Math.hypot(b[0] - c[0], b[1] - c[1]) || 1;
    // Un segment intérieur est partagé par deux virages : chacun en prend au plus la moitié.
    const ra = Math.min(radius, i === 1 ? la : la / 2);
    const rb = Math.min(radius, i === p.length - 2 ? lb : lb / 2);
    const r = Math.min(ra, rb);
    const p1: Pt = [c[0] + ((a[0] - c[0]) / la) * r, c[1] + ((a[1] - c[1]) / la) * r];
    const p2: Pt = [c[0] + ((b[0] - c[0]) / lb) * r, c[1] + ((b[1] - c[1]) / lb) * r];
    const k = 0.5523; // approximation d'un quart de cercle
    const c1: Pt = [p1[0] + (c[0] - p1[0]) * k, p1[1] + (c[1] - p1[1]) * k];
    const c2: Pt = [p2[0] + (c[0] - p2[0]) * k, p2[1] + (c[1] - p2[1]) * k];
    d += ` L ${p1[0]} ${p1[1]} C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`;
  }
  const last = p[p.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

/** Échantillonne en polyligne fine le tracé tel que dessiné par filletPath / pathD. */
export function sampleRoute(p: Pt[], radius: number, smooth: boolean): Pt[] {
  const bez = (out: Pt[], a: Pt, c1: Pt, c2: Pt, b: Pt) => {
    for (let k = 1; k <= 16; k++) {
      const t = k / 16, u = 1 - t;
      out.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
        u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
    }
  };
  if (smooth && p.length >= 3) {
    const P = [p[0], ...p, p[p.length - 1]];
    const out: Pt[] = [P[1]];
    for (let i = 1; i < P.length - 2; i++) {
      const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
      bez(out, p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2);
    }
    return out;
  }
  if (radius <= 0 || p.length < 3) return p;
  const out: Pt[] = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const [a, c, b] = [p[i - 1], p[i], p[i + 1]];
    const la = Math.hypot(a[0] - c[0], a[1] - c[1]) || 1;
    const lb = Math.hypot(b[0] - c[0], b[1] - c[1]) || 1;
    const r = Math.min(Math.min(radius, i === 1 ? la : la / 2), Math.min(radius, i === p.length - 2 ? lb : lb / 2));
    const p1: Pt = [c[0] + ((a[0] - c[0]) / la) * r, c[1] + ((a[1] - c[1]) / la) * r];
    const p2: Pt = [c[0] + ((b[0] - c[0]) / lb) * r, c[1] + ((b[1] - c[1]) / lb) * r];
    const k = 0.5523;
    out.push(p1);
    bez(out, p1, [p1[0] + (c[0] - p1[0]) * k, p1[1] + (c[1] - p1[1]) * k], [p2[0] + (c[0] - p2[0]) * k, p2[1] + (c[1] - p2[1]) * k], p2);
  }
  out.push(p[p.length - 1]);
  return out;
}

function arrowHead(tip: Pt, from: Pt, w: number, scale: number, style: ArrowStyle, color: string, key: string): React.ReactNode {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const len = w * 3.2 * scale, half = w * 2 * scale;
  const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
  const at = (a: number, b: number) => `${tip[0] - ux * a + nx * b},${tip[1] - uy * a + ny * b}`;
  switch (style) {
    case 'open':
      return <polyline key={key} points={`${at(len * 0.95, half * 1.15)} ${at(0, 0)} ${at(len * 0.95, -half * 1.15)}`} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;
    case 'stealth':
      return <polygon key={key} points={`${at(0, 0)} ${at(len * 1.1, half)} ${at(len * 0.7, 0)} ${at(len * 1.1, -half)}`} fill={color} />;
    case 'circle':
      return <circle key={key} cx={tip[0] - ux * half * 0.6} cy={tip[1] - uy * half * 0.6} r={half * 0.65} fill={color} />;
    case 'square':
      return <polygon key={key} points={`${at(0, half * 0.6)} ${at(0, -half * 0.6)} ${at(half * 1.2, -half * 0.6)} ${at(half * 1.2, half * 0.6)}`} fill={color} />;
    case 'chevrons':
      return (
        <g key={key} fill="none" stroke={color} strokeWidth={w * 0.75} strokeLinecap="round" strokeLinejoin="round">
          <polyline points={`${at(len * 0.8, half)} ${at(0, 0)} ${at(len * 0.8, -half)}`} />
          <polyline points={`${at(len * 1.6, half)} ${at(len * 0.8, 0)} ${at(len * 1.6, -half)}`} />
        </g>
      );
    default:
      return <polygon key={key} points={`${at(0, 0)} ${at(len, half)} ${at(len, -half)}`} fill={color} />;
  }
}

const shorten = (a: Pt, b: Pt, d: number): Pt => {
  const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  const k = Math.min(d, l * 0.9);
  return [a[0] + ((b[0] - a[0]) / l) * k, a[1] + ((b[1] - a[1]) / l) * k];
};

/**
 * Volet d'une fenêtre, dessiné côté extérieur (y < 0 dans le repère de la fenêtre ; flip : côté opposé).
 * - roulant : coffre le long de la façade, lames en pointillé ;
 * - battants : deux vantaux ouverts vers l'extérieur, avec leur débattement en pointillé.
 */
function ShutterView({ w, d, kind, color, flip }: { w: number; d: number; kind: 'rolling' | 'hinged'; color: string; flip: boolean }) {
  const face = -d / 2;
  const sw = Math.max(0.8, d * 0.1);
  let body: React.ReactNode;
  if (kind === 'rolling') {
    const c = Math.max(4, d * 0.55);
    body = (
      <>
        <rect x={-w / 2} y={face - c} width={w} height={c} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={sw} />
        <line x1={-w / 2 + c * 0.4} y1={face - c / 2} x2={w / 2 - c * 0.4} y2={face - c / 2} stroke={color} strokeWidth={sw * 0.8} strokeDasharray={`${c * 0.5} ${c * 0.35}`} />
      </>
    );
  } else {
    const L = w / 2, a = (110 * Math.PI) / 180;
    const dx = Math.cos(a) * L, dy = -Math.sin(a) * L;
    const lt: Pt = [-w / 2 + dx, face + dy], rt: Pt = [w / 2 - dx, face + dy];
    body = (
      <>
        <path d={`M ${-w / 2} ${face} L ${lt[0]} ${lt[1]} M ${w / 2} ${face} L ${rt[0]} ${rt[1]}`} stroke={color} strokeWidth={Math.max(1.2, d * 0.2)} strokeLinecap="round" fill="none" />
        <path d={`M 0 ${face} A ${L} ${L} 0 0 0 ${lt[0]} ${lt[1]} M 0 ${face} A ${L} ${L} 0 0 1 ${rt[0]} ${rt[1]}`} stroke={color} strokeWidth={sw * 0.6}
          strokeDasharray={`${Math.max(2, w * 0.03)} ${Math.max(1.5, w * 0.025)}`} fill="none" />
      </>
    );
  }
  return <g transform={flip ? 'scale(1 -1)' : undefined}>{body}</g>;
}

function RouteView({ el }: { el: RouteElement }) {
  if (el.points.length < 2) return null;
  const p = el.points;
  const filled = el.arrowStyle !== 'open' && el.arrowStyle !== 'chevrons';
  const d = filled ? el.width * 2.4 * el.arrowSize : 0;
  const line = [...p];
  if (el.arrowEnd && d) line[line.length - 1] = shorten(p[p.length - 1], p[p.length - 2], d);
  if (el.arrowStart && d) line[0] = shorten(p[0], p[1], d);
  const path = el.cornerRadius > 0 && !el.smooth ? filletPath(line, el.cornerRadius) : pathD(line, el.smooth);
  // Flèches répétées le long du tracé
  const repeats: React.ReactNode[] = [];
  if (el.arrowRepeat > 0) {
    const rc = el.repeatColor === 'line' ? el.color : el.repeatColor || el.outline || '#ffffff';
    // On suit le tracé réellement dessiné (virages arrondis compris) : chaque
    // chevron s'oriente selon la corde qui l'entoure, donc tourne avec la flèche.
    const pts = sampleRoute(p, el.cornerRadius > 0 && !el.smooth ? el.cornerRadius : 0, el.smooth);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    const at = (s: number): Pt => {
      s = Math.max(0, Math.min(total, s));
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / seg;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    };
    const half = el.width * 0.55 * 3.2 * 0.5; // demi-longueur du chevron
    const sEnd = el.joinEnd ? total - el.width / 2 - half * 1.2 : total;
    for (let s = el.arrowRepeat / 2; s < sEnd; s += el.arrowRepeat) {
      if (el.joinStart && s < el.width / 2 + half * 2) continue;
      const tip = at(s + half * 0.5), back = at(s - half * 1.5);
      if (tip[0] === back[0] && tip[1] === back[1]) continue;
      repeats.push(arrowHead(tip, back, el.width * 0.55, 1, 'open', rc, `r${s}`));
    }
  }
  // Bout raccordé : coupe nette au bord de la bande rejointe (ni liseré ni arrondi
  // qui débordent dessus) ; les autres bouts gardent leur arrondi, ajouté à part.
  const joined = !!(el.joinEnd || el.joinStart);
  const baseCap = dashCap(el.dash, el.dash === 'solid' ? 'round' : 'butt');
  const cap = joined ? 'butt' : baseCap;
  const ow = el.width + Math.max(3, el.width * 0.6);
  // Le liseré s'arrête au bord de la bande rejointe (le trait, lui, va jusqu'à son axe).
  const oLine = [...line];
  if (el.joinEnd && oLine.length >= 2) oLine[oLine.length - 1] = shorten(oLine[oLine.length - 1], oLine[oLine.length - 2], el.width / 2);
  if (el.joinStart && oLine.length >= 2) oLine[0] = shorten(oLine[0], oLine[1], el.width / 2);
  const oPath = joined ? (el.cornerRadius > 0 && !el.smooth ? filletPath(oLine, el.cornerRadius) : pathD(oLine, el.smooth)) : path;
  const roundEnds = joined ? [!el.joinStart && line[0], !el.joinEnd && line[line.length - 1]].filter(Boolean) as Pt[] : [];
  return (
    <g>
      {el.outline && (
        <>
          <path d={oPath} fill="none" stroke={el.outline} strokeWidth={ow} strokeLinejoin={el.corner} strokeLinecap={joined ? 'butt' : 'round'} />
          {roundEnds.map((q, i) => <circle key={`oc${i}`} cx={q[0]} cy={q[1]} r={ow / 2} fill={el.outline} />)}
        </>
      )}
      <path d={path} fill="none" stroke={el.color} strokeWidth={el.width} strokeLinejoin={el.corner} strokeLinecap={cap}
        strokeDasharray={dashArray(el.dash, el.width)} />
      {baseCap === 'round' && roundEnds.map((q, i) => <circle key={`lc${i}`} cx={q[0]} cy={q[1]} r={el.width / 2} fill={el.color} />)}
      {repeats.length > 0 && (
        // Chevrons découpés à la largeur du trait : rien ne dépasse de la bande verte.
        <>
          <mask id={`rm-${el.id}`} maskUnits="userSpaceOnUse"
            x={Math.min(...p.map((q) => q[0])) - el.width * 4} y={Math.min(...p.map((q) => q[1])) - el.width * 4}
            width={Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0])) + el.width * 8}
            height={Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1])) + el.width * 8}>
            <path d={path} fill="none" stroke="#fff" strokeWidth={el.width} strokeLinejoin={el.corner} strokeLinecap={cap} />
          </mask>
          <g mask={`url(#rm-${el.id})`}>{repeats}</g>
        </>
      )}
      {el.arrowEnd && arrowHead(p[p.length - 1], p[p.length - 2], el.width, el.arrowSize, el.arrowStyle, el.color, 'e')}
      {el.arrowStart && arrowHead(p[0], p[1], el.width, el.arrowSize, el.arrowStyle, el.color, 's')}
    </g>
  );
}

/** Cote : lignes d'attache, ligne de cote avec extrémités et mesure au milieu. */
function DimensionView({ el, ctx }: { el: DimensionElement; ctx: RenderCtx }) {
  if (el.points.length < 2) return null;
  const [a, b] = el.points;
  const g = dimensionGeometry(a, b, el.offset);
  if (g.len < 0.5) return null;
  const sw = el.strokeWidth, fs = el.fontSize;
  const side = el.offset < 0 ? -1 : 1;
  const gap = Math.min(Math.abs(el.offset), fs * 0.25), over = fs * 0.35;
  const ext = (p: Pt, q: Pt) => Math.abs(el.offset) > 0.5 && (
    <line x1={p[0] + g.n[0] * gap * side} y1={p[1] + g.n[1] * gap * side} x2={q[0] + g.n[0] * over * side} y2={q[1] + g.n[1] * over * side} />
  );
  const t = fs * 0.45;
  const end = (p: Pt, dir: number, k: string) => {
    if (el.ends === 'dot') return <circle key={k} cx={p[0]} cy={p[1]} r={sw * 1.8 + 1} fill={el.color} stroke="none" />;
    if (el.ends === 'arrow') {
      const bx = p[0] - g.u[0] * dir * t * 1.6, by = p[1] - g.u[1] * dir * t * 1.6;
      return <polygon key={k} points={`${p[0]},${p[1]} ${bx + g.n[0] * t * 0.5},${by + g.n[1] * t * 0.5} ${bx - g.n[0] * t * 0.5},${by - g.n[1] * t * 0.5}`} fill={el.color} stroke="none" />;
    }
    const dx = (g.u[0] + g.n[0]) * t * 0.7, dy = (g.u[1] + g.n[1]) * t * 0.7;
    return <line key={k} x1={p[0] - dx} y1={p[1] - dy} x2={p[0] + dx} y2={p[1] + dy} strokeWidth={sw * 1.8} />;
  };
  const label = el.text.trim() || formatLength(g.len, ctx.floor.unitsPerMeter);
  // texte posé au-dessus de la ligne (côté lisible)
  const th = g.angle * Math.PI / 180;
  const tx = g.mid[0] + Math.sin(th) * fs * 0.35, ty = g.mid[1] - Math.cos(th) * fs * 0.35;
  const bg = ctx.floor.page.planBackground || '#ffffff';
  return (
    <g stroke={el.color} strokeWidth={sw} fill="none" strokeLinecap="round">
      {ctx.interactive && <line x1={g.a2[0]} y1={g.a2[1]} x2={g.b2[0]} y2={g.b2[1]} stroke="transparent" strokeWidth={Math.max(sw, fs * 0.9)} />}
      {ext(a, g.a2)}
      {ext(b, g.b2)}
      <line x1={g.a2[0]} y1={g.a2[1]} x2={g.b2[0]} y2={g.b2[1]} />
      {end(g.a2, -1, 'a')}
      {end(g.b2, 1, 'b')}
      <text x={tx} y={ty} transform={`rotate(${g.angle} ${tx} ${ty})`} textAnchor="middle" fontFamily={FONT} fontSize={fs} fontWeight={600}
        fill={el.color} stroke={bg} strokeWidth={fs * 0.28} paintOrder="stroke" strokeLinejoin="round">{label}</text>
    </g>
  );
}

export function polygonCentroid(p: Pt[]): Pt {
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

/** Dessins de fenêtres : à battants (vantaux et arcs côté intérieur), coulissante, fixe, à soufflet. */
function WindowStyleView({ w, d, style, panes, color, flip }: { w: number; d: number; style: string; panes: number; color: string; flip: boolean }) {
  const t = Math.min(d, Math.max(0.6, d * 0.07)), side = flip ? -1 : 1;
  const thin = Math.max(0.6, w * 0.008), dash = `${w * 0.04} ${w * 0.03}`;
  switch (style) {
    case 'fixed':
      // fixe : un seul vitrage épais, sans ouvrant
      return <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={color} strokeWidth={t * 1.8} />;
    case 'sliding': {
      // coulissante : deux vitrages décalés qui se chevauchent
      const o = d * 0.16, half = w * 0.55;
      return (
        <g>
          <line x1={-w / 2} y1={-o} x2={-w / 2 + half} y2={-o} stroke={color} strokeWidth={t * 1.3} />
          <line x1={w / 2 - half} y1={o} x2={w / 2} y2={o} stroke={color} strokeWidth={t * 1.3} />
        </g>
      );
    }
    case 'tilt':
      // à soufflet : l'ouvrant bascule vers l'intérieur (trait en biais)
      return (
        <g>
          <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={color} strokeWidth={t} />
          <line x1={-w / 2} y1={side * d / 2} x2={w / 2} y2={side * (d / 2 + Math.max(d, w * 0.22))} stroke={color} strokeWidth={thin * 1.5} strokeDasharray={dash} />
        </g>
      );
    default: {
      // à battants : 1 ou 2 vantaux qui s'ouvrent côté intérieur, avec leur arc
      const n = panes >= 2 ? 2 : 1, lw = w / n, y0 = (side * d) / 2;
      const leaves: [number, 1 | -1][] = n === 2 ? [[-w / 2, 1], [w / 2, -1]] : [[-w / 2, 1]];
      return (
        <g>
          <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={color} strokeWidth={t} />
          {leaves.map(([hx, dir], i) => (
            <g key={i}>
              <line x1={hx} y1={y0} x2={hx} y2={y0 + side * lw} stroke={color} strokeWidth={thin * 1.5} />
              <path d={`M ${hx} ${y0 + side * lw} A ${lw} ${lw} 0 0 ${(dir === 1) === (side === 1) ? 0 : 1} ${hx + dir * lw} ${y0}`} fill="none" stroke={color} strokeWidth={thin} strokeDasharray={dash} />
            </g>
          ))}
        </g>
      );
    }
  }
}

/** Centre d'un groupe de pictogrammes accolés (ou groupés) contenant `el`, ou null s'il est seul. */
function comboMembers(el: SymbolElement, floor: Floor, variantId: string): SymbolElement[] {
  const syms = floor.elements.filter((e): e is SymbolElement => e.type === 'symbol' && isVisibleInVariant(e, variantId) && !e.symbolId.startsWith('you-are-here'));
  const box = (s: SymbolElement) => {
    const hw = s.size * (s.stretchX ?? 1) / 2, hh = s.size * (s.stretchY ?? 1) / 2;
    const q = ((Math.round(s.rotation) % 180) + 180) % 180 === 90;
    return q ? { x0: s.x - hh, x1: s.x + hh, y0: s.y - hw, y1: s.y + hw } : { x0: s.x - hw, x1: s.x + hw, y0: s.y - hh, y1: s.y + hh };
  };
  const touch = (a: SymbolElement, b: SymbolElement) => {
    if (a.groupId && a.groupId === b.groupId) return true;
    const A = box(a), B = box(b), tol = Math.min(a.size, b.size) * 0.06;
    return A.x0 <= B.x1 + tol && B.x0 <= A.x1 + tol && A.y0 <= B.y1 + tol && B.y0 <= A.y1 + tol;
  };
  const members = [el];
  for (let i = 0; i < members.length && members.length < 8; i++) {
    for (const s of syms) if (!members.some((m) => m.id === s.id) && touch(members[i], s)) members.push(s);
  }
  return members;
}

function comboCenterOf(members: SymbolElement[]): Pt {
  const box = (s: SymbolElement) => {
    const hw = s.size * (s.stretchX ?? 1) / 2, hh = s.size * (s.stretchY ?? 1) / 2;
    const q = ((Math.round(s.rotation) % 180) + 180) % 180 === 90;
    return q ? { x0: s.x - hh, x1: s.x + hh, y0: s.y - hw, y1: s.y + hw } : { x0: s.x - hw, x1: s.x + hw, y0: s.y - hh, y1: s.y + hh };
  };
  const bs = members.map(box);
  return [(Math.min(...bs.map((b) => b.x0)) + Math.max(...bs.map((b) => b.x1))) / 2, (Math.min(...bs.map((b) => b.y0)) + Math.max(...bs.map((b) => b.y1))) / 2];
}

/**
 * Taille d'un pictogramme imprimé selon la norme (7 mm minimum), plafonnée à la place
 * disponible entre les murs pour ne jamais déborder. « small » : la norme n'est pas tenue faute de place.
 */
export function normSymbolSize(el0: SymbolElement, floor: Floor, variantId: string, mmPerUnit: number, symbolSize?: number): { size: number; small: boolean } {
  const isHere = el0.symbolId.startsWith('you-are-here');
  if (NORM_OBSTACLE_CATS.has(getBuiltinSymbol(el0.symbolId)?.category ?? '')) return { size: el0.size, small: false };
  const wanted = symbolSize && !isHere ? symbolSize : Math.max(el0.size, NORM_SYMBOL_MM / mmPerUnit);
  if (wanted <= el0.size || getBuiltinSymbol(el0.symbolId)?.planSymbol) return { size: wanted, small: wanted * mmPerUnit < NORM_SYMBOL_MM - 0.05 };
  const upm = floor.unitsPerMeter > 0 ? floor.unitsPerMeter : 100;
  let limit = Infinity;
  for (const m of comboMembers(el0, floor, variantId)) {
    const clear = corridorWidthAt(floor, variantId, [m.x, m.y], upm * 4);
    if (clear) limit = Math.min(limit, ((clear - 2 * DEFAULT_SYMBOL_WALL_GAP) / (m.halo ? 1.26 : 1)) * (el0.size / m.size));
  }
  const size = Math.max(el0.size, Math.min(wanted, limit));
  return { size, small: size * mmPerUnit < NORM_SYMBOL_MM - 0.05 };
}

function SymbolView({ el: el0, ctx }: { el: SymbolElement; ctx: RenderCtx }) {
  // Norme : pictogrammes d'au moins 7 mm sur le papier.
  const obstacle = !!ctx.norm && NORM_OBSTACLE_CATS.has(getBuiltinSymbol(el0.symbolId)?.category ?? '');
  const isHere = el0.symbolId.startsWith('you-are-here');
  const normSize = !ctx.norm || obstacle ? el0.size : normSymbolSize(el0, ctx.floor, ctx.variantId, ctx.norm.mmPerUnit, ctx.symbolSize).size;
  let el = normSize !== el0.size ? { ...el0, size: normSize } : el0;
  if (el !== el0) {
    // Taille imposée par la norme : le pictogramme (ou le groupe accolé) reste collé
    // au mur contre lequel il était posé au lieu de déborder sur le dessin.
    const members = comboMembers(el0, ctx.floor, ctx.variantId);
    const k = normSize / el0.size;
    const c = members.length > 1 ? comboCenterOf(members) : null;
    const grow = (s: SymbolElement): SymbolElement => c
      ? { ...s, size: s.size * k, x: c[0] + (s.x - c[0]) * k, y: c[1] + (s.y - c[1]) * k }
      : { ...s, size: s.size * k };
    let shift: Pt = [0, 0];
    for (const m of members) {
      const g = grow(m);
      const sn = snapSymbolToWalls(ctx.floor, ctx.variantId, g, { at: [m.x, m.y], gap: DEFAULT_SYMBOL_WALL_GAP });
      const d: Pt = [sn.x - g.x, sn.y - g.y];
      if (Math.hypot(d[0], d[1]) > Math.hypot(shift[0], shift[1])) shift = d;
    }
    const g0 = grow(el0);
    el = { ...el, x: g0.x + shift[0], y: g0.y + shift[1] };
  }
  if (obstacle) {
    // Norme : mobilier et équipements fixes dessinés en gris clair.
    return <g style={{ filter: 'grayscale(1)' }} opacity={0.45}><SymbolView el={el0} ctx={{ ...ctx, norm: undefined }} /></g>;
  }
  const here = hereCallout(el, ctx.floor, ctx.variantId);
  const ls = el.labelSize > 0 ? el.labelSize : Math.max(8, el.size * 0.26);
  const pos = el.labelPosition === 'auto' ? 'below' : el.labelPosition;
  const sx = el.stretchX ?? 1, sy = el.stretchY ?? 1;
  const offX = (el.size * sx) / 2 + ls * 0.4, offY = (el.size * sy) / 2 + ls * 0.4;
  const lx = pos === 'right' ? offX : pos === 'left' ? -offX : 0;
  const ly = pos === 'below' ? offY + ls * 0.8 : pos === 'above' ? -offY : ls * 0.35;
  const stretch = sx !== 1 || sy !== 1 ? `scale(${sx} ${sy})` : '';
  const near = symbolFuseSides(el, ctx.floor, ctx.variantId);
  // Les côtés suivent le miroir et le quart de tour du panneau.
  const fuse = fuseSidesLocal(near, el.rotation, el.flipX, el.flipY);
  const anchor = pos === 'right' ? 'start' : pos === 'left' ? 'end' : 'middle';
  return (
    <g transform={`translate(${el.x} ${el.y})`}>
      {here && <HereLabel el={el} box={here} uid={`${ctx.idPrefix ?? ''}yah-${el.id}`} />}
      <g transform={`${el.rotation ? `rotate(${el.rotation})` : ''} ${stretch} ${el.flipX || el.flipY ? `scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1})` : ''}`}>
        {el.halo && <rect x={-el.size * 0.62} y={-el.size * 0.62} width={el.size * 1.24} height={el.size * 1.24} rx={el.size * 0.18} fill="#ffffff" stroke="rgba(0,0,0,.12)" strokeWidth={el.size * 0.02} />}
        <SymbolGraphic symbolId={el.symbolId} size={el.size} custom={ctx.customSymbols} fuse={fuse} clipId={`${ctx.idPrefix ?? ''}fuse-${el.id}`} />
      </g>
      {el.label && !here && (
        <text x={lx} y={ly} textAnchor={anchor} fontFamily={FONT} fontWeight={700}
          fontSize={ls} fill={el.labelColor} stroke="#fff" strokeWidth={Math.max(2, ls * 0.28)}
          paintOrder="stroke" strokeLinejoin="round">{el.label}</text>
      )}
    </g>
  );
}

/**
 * Cartouche « Vous êtes ici » relié au repère par une flèche cernée de blanc.
 * Quatre styles : pastille (dégradé rouge), sombre (bleu nuit), contour (blanc liseré rouge), étiquette (bloc rouge + texte).
 */
function HereLabel({ el, box, uid }: { el: SymbolElement; box: HereCallout; uid: string }) {
  const style = el.hereStyle ?? 'pill';
  const x = box.x - el.x, y = box.y - el.y;
  const { w, h, fontSize: fs } = box;
  const top = '#f0243f', bottom = '#b8102b', ink = '#a30e26', navy = '#16212c';
  const custom = el.labelColor !== '#111111';
  const curved = style === 'pill' || style === 'dark';
  const arrowColor = style === 'dark' ? '#e30613' : bottom;
  // Flèche (coordonnées relatives au repère)
  const F: Pt = [box.from[0] - el.x, box.from[1] - el.y];
  const T: Pt = [box.to[0] - el.x, box.to[1] - el.y];
  const len = Math.hypot(T[0] - F[0], T[1] - F[1]) || 1;
  let nx = -(T[1] - F[1]) / len, ny = (T[0] - F[0]) / len;
  if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; } // toujours bombée vers le haut
  const bend = curved ? Math.min(len * 0.16, fs * 2.2) : 0;
  const C: Pt = [(F[0] + T[0]) / 2 + nx * bend, (F[1] + T[1]) / 2 + ny * bend];
  const tl = Math.hypot(T[0] - C[0], T[1] - C[1]) || 1;
  const ux = (T[0] - C[0]) / tl, uy = (T[1] - C[1]) / tl;
  const head = Math.min(len * 0.45, fs * 1.35), headW = fs * 0.78;
  const B: Pt = [T[0] - ux * head, T[1] - uy * head];
  const f2 = (v: number) => v.toFixed(2);
  const curve = `M${f2(F[0])} ${f2(F[1])} Q${f2(C[0])} ${f2(C[1])} ${f2(B[0] + ux * fs * 0.2)} ${f2(B[1] + uy * fs * 0.2)}`;
  const tip = `M${f2(T[0])} ${f2(T[1])} L${f2(B[0] - uy * headW)} ${f2(B[1] + ux * headW)} L${f2(B[0] + uy * headW)} ${f2(B[1] - ux * headW)} Z`;
  const shaft = fs * (style === 'outline' ? 0.26 : 0.34), halo = fs * 0.3;
  const r = h / 2, cy = y + r;
  const iconX = x + r, textX = x + h * 0.86 + (w - h * 0.86 - h * 0.42) / 2;
  const textY = cy + fs * 0.35;
  const arrow = (
    <>
      <path d={curve} fill="none" stroke="#fff" strokeWidth={shaft + halo * 2} strokeLinecap="round" />
      <path d={tip} fill="#fff" stroke="#fff" strokeWidth={halo * 2} strokeLinejoin="round" />
      {!curved && <circle cx={F[0]} cy={F[1]} r={shaft * 1.25 + halo} fill="#fff" />}
      <path d={curve} fill="none" stroke={arrowColor} strokeWidth={shaft} strokeLinecap="round" />
      <path d={tip} fill={arrowColor} stroke={arrowColor} strokeWidth={fs * 0.12} strokeLinejoin="round" />
      {!curved && <circle cx={F[0]} cy={F[1]} r={shaft * 1.25} fill={arrowColor} />}
    </>
  );
  const target = (cx: number, ring: string, core: string, rad = h * 0.31) => (
    <>
      <circle cx={cx} cy={cy} r={rad} fill={core} />
      <circle cx={cx} cy={cy} r={rad * 0.61} fill="none" stroke={ring} strokeWidth={rad * 0.19} />
      <circle cx={cx} cy={cy} r={rad * 0.24} fill={ring} />
    </>
  );
  const shadow = (rx: number) => <rect x={x + fs * 0.05} y={y + fs * 0.22} width={w} height={h} rx={rx} fill="#1d2630" opacity={0.16} />;

  if (style === 'dark') {
    return (
      <g className="here-callout" data-here-label={el.id}>
        {arrow}
        {shadow(r)}
        <rect x={x} y={y} width={w} height={h} rx={r} fill={navy} stroke="#fff" strokeWidth={fs * 0.16} />
        <circle cx={iconX} cy={cy} r={h * 0.36} fill="#e30613" opacity={0.25} />
        {target(iconX, '#fff', '#e30613', h * 0.27)}
        <text x={textX} y={textY} textAnchor="middle" fontFamily={FONT} fontWeight={700} letterSpacing={fs * 0.02}
          fontSize={fs} fill={custom ? el.labelColor : '#fff'}>{el.label}</text>
      </g>
    );
  }
  if (style === 'outline') {
    const rx = h * 0.28;
    return (
      <g className="here-callout" data-here-label={el.id}>
        {arrow}
        <rect x={x} y={y} width={w} height={h} rx={rx} fill="#fff" stroke="#fff" strokeWidth={fs * 0.4} />
        <rect x={x} y={y} width={w} height={h} rx={rx} fill="#fff" stroke={ink} strokeWidth={fs * 0.14} />
        {target(iconX, '#fff', ink, h * 0.27)}
        <text x={textX} y={textY} textAnchor="middle" fontFamily={FONT} fontWeight={800}
          fontSize={fs} fill={custom ? el.labelColor : ink}>{el.label}</text>
      </g>
    );
  }
  if (style === 'tag') {
    const rx = h * 0.22, block = h * 0.95;
    const tx = x + block + (w - block) / 2;
    return (
      <g className="here-callout" data-here-label={el.id}>
        {arrow}
        {shadow(rx)}
        <defs><clipPath id={`${uid}-c`}><rect x={x} y={y} width={w} height={h} rx={rx} /></clipPath></defs>
        <rect x={x} y={y} width={w} height={h} rx={rx} fill="#fff" stroke="#fff" strokeWidth={fs * 0.32} />
        <g clipPath={`url(#${uid}-c)`}>
          <rect x={x} y={y} width={w} height={h} fill="#fff" />
          <rect x={x} y={y} width={block} height={h} fill={bottom} />
        </g>
        <rect x={x} y={y} width={w} height={h} rx={rx} fill="none" stroke={bottom} strokeWidth={fs * 0.1} />
        {target(x + block / 2, bottom, '#fff', h * 0.29)}
        <text x={tx} y={textY} textAnchor="middle" fontFamily={FONT} fontWeight={700}
          fontSize={fs} fill={custom ? el.labelColor : navy}>{el.label}</text>
      </g>
    );
  }
  return (
    <g className="here-callout" data-here-label={el.id}>
      <defs>
        <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} /><stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      {arrow}
      {shadow(r)}
      <rect x={x} y={y} width={w} height={h} rx={r} fill={custom ? '#fff' : `url(#${uid}-g)`} stroke="#fff" strokeWidth={fs * 0.16} />
      {custom && <rect x={x} y={y} width={w} height={h} rx={r} fill="none" stroke={ink} strokeWidth={fs * 0.1} />}
      {!custom && <rect x={x + r * 0.5} y={y + h * 0.1} width={w - r} height={h * 0.32} rx={h * 0.16} fill="#fff" opacity={0.13} />}
      {target(iconX, custom ? '#fff' : ink, custom ? ink : '#fff')}
      <text x={textX} y={textY} textAnchor="middle" fontFamily={FONT} fontWeight={700} letterSpacing={fs * 0.02}
        fontSize={fs} fill={custom ? el.labelColor : '#fff'}>{el.label}</text>
    </g>
  );
}

/**
 * Points du tracé d'un mur ouvert, dessiné avec des bouts plats : chaque bout libre ou formant un angle
 * est prolongé d'une demi-épaisseur (comme un bout carré, pour remplir les angles), mais un bout posé
 * au milieu d'un autre mur (jonction en T) s'arrête sur son axe : il ne ressort pas de l'autre côté,
 * même si le mur traversé est plus fin.
 */
function wallEndPoints(el: WallElement, floor: Floor | undefined, variantId: string): Pt[] {
  const pts = el.points;
  if (el.closed || pts.length < 2) return pts;
  const half = el.thickness / 2;
  const onOtherWall = (p: Pt) => {
    for (const o of floor?.elements ?? []) {
      if (o.type !== 'wall' || o.id === el.id || o.points.length < 2 || !isVisibleInVariant(o, variantId)) continue;
      const n = o.points.length, segs = o.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const a = o.points[i], b = o.points[(i + 1) % n];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!L) continue;
        const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L;
        const dist = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L;
        // sur l'axe, et loin des extrémités de ce segment (sinon c'est un angle : on garde le bout carré)
        if (dist <= Math.max(0.5, o.thickness * 0.1) && t > half && t < L - half) return true;
      }
    }
    return false;
  };
  const extend = (p: Pt, q: Pt): Pt => {
    const L = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!L || onOtherWall(p)) return p;
    return [p[0] + ((p[0] - q[0]) / L) * half, p[1] + ((p[1] - q[1]) / L) * half];
  };
  const out = pts.slice();
  out[0] = extend(pts[0], pts[1]);
  out[out.length - 1] = extend(pts[pts.length - 1], pts[pts.length - 2]);
  return out;
}

function shapePath(el: ShapeElement): React.ReactNode {
  const { w, h } = el;
  const x0 = -w / 2, y0 = -h / 2;
  switch (el.shape) {
    case 'ellipse': return <ellipse cx={0} cy={0} rx={w / 2} ry={h / 2} />;
    case 'triangle': return <polygon points={`0,${y0} ${w / 2},${h / 2} ${x0},${h / 2}`} />;
    case 'diamond': return <polygon points={`0,${y0} ${w / 2},0 0,${h / 2} ${x0},0`} />;
    case 'hexagon': return <polygon points={`${x0 + w * 0.25},${y0} ${w / 2 - w * 0.25},${y0} ${w / 2},0 ${w / 2 - w * 0.25},${h / 2} ${x0 + w * 0.25},${h / 2} ${x0},0`} />;
    case 'line': return <line x1={x0} y1={0} x2={w / 2} y2={0} />;
    case 'arrow': return <polygon points={`${x0},${-h * 0.2} ${w / 2 - h / 2},${-h * 0.2} ${w / 2 - h / 2},${y0} ${w / 2},0 ${w / 2 - h / 2},${h / 2} ${w / 2 - h / 2},${h * 0.2} ${x0},${h * 0.2}`} />;
    case 'star': {
      const r = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 ? 0.45 : 1;
        r.push(`${Math.cos(a) * (w / 2) * k},${Math.sin(a) * (h / 2) * k}`);
      }
      return <polygon points={r.join(' ')} />;
    }
    default: return <rect x={x0} y={y0} width={w} height={h} rx={el.radius} />;
  }
}

function fillOf(id: string, pattern: FillPattern, fill: string) {
  return pattern === 'none' ? 'none' : fill;
}

function Inner({ el: el0, ctx }: { el: Element; ctx: RenderCtx }): React.ReactElement | null {
  let el = el0;
  const N = ctx.norm;
  if (N && el.type === 'wall') {
    // Norme : murs en noir, porteurs pleins ≥ 1,6 mm, autres parois ≥ 0,6 mm sur le papier.
    const load = isLoadBearing(el, ctx.floor.unitsPerMeter);
    const min = (load ? NORM_LOAD_WALL_MM : NORM_WALL_MM) / N.mmPerUnit;
    el = { ...el, color: '#000000', wallStyle: 'solid', thickness: Math.max(el.thickness, min) };
  }
  if (N && el.type === 'stairs' && ctx.routes?.length) {
    // Norme : escaliers des voies d'évacuation en vert foncé transparent.
    const st = el;
    const r = Math.hypot(st.w, st.h) / 2;
    const hit = ctx.routes.some((s) => segmentHitsRect(s, st.x - r * 0.75, st.y - r * 0.75, st.x + r * 0.75, st.y + r * 0.75));
    if (hit) {
      return (
        <g>
          <Inner el={{ ...st }} ctx={{ ...ctx, routes: undefined }} />
          <rect transform={`translate(${st.x} ${st.y}) rotate(${st.rotation})`} x={-st.w / 2} y={-st.h / 2} width={st.w} height={st.h}
            fill={NORM_STAIRS} fillOpacity={0.38} />
        </g>
      );
    }
  }
  if (N && el.type === 'route' && el.points.length > 1) {
    // Norme : voie d'évacuation en zone verte transparente, chemin marqué par des flèches vert foncé.
    const upm = ctx.floor.unitsPerMeter;
    const band = Math.max(el.width * 3, upm > 0 ? 1.1 * upm : el.width * 5);
    const r = el;
    // Si la voie est déjà couverte par des zones colorées dessinées à la main,
    // on n'ajoute pas la bande verte automatique par-dessus.
    const inside = (q: Pt, poly: Pt[]) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const zones = ctx.floor.elements.filter((e): e is Extract<Element, { type: 'area' }> => e.type === 'area'
      && isVisibleInVariant(e, ctx.variantId) && !!e.fill && !/^#?f{3}(f{3})?$/i.test(e.fill) && e.fill !== 'none');
    const mids = r.points.slice(1).map((p, i): Pt => [(p[0] + r.points[i][0]) / 2, (p[1] + r.points[i][1]) / 2]);
    const covered = zones.length > 0 && mids.filter((m) => zones.some((z) => inside(m, z.points))).length >= mids.length / 2;
    return (
      <g>
        {!covered && <polyline points={r.points.map((p) => p.join(',')).join(' ')} fill="none" stroke="#2fae66" strokeOpacity={0.3}
          strokeWidth={band} strokeLinejoin="round" strokeLinecap="butt" />}
        <RouteView el={{ ...r, color: NORM_STAIRS, outline: '', arrowEnd: !r.joinEnd,
          arrowRepeat: r.arrowRepeat > 0 ? r.arrowRepeat : upm > 0 ? 3 * upm : r.width * 14 }} />
      </g>
    );
  }
  if (N && el.type === 'shape' && el.layer === 'building' && el.shape !== 'arrow') {
    // Norme : obstacles à demeure (chaudière, paillasses, éviers…) en gris clair, trait ≥ 0,15 mm.
    el = { ...el, stroke: '#a9b1b9', fill: '#eceff1', pattern: 'solid', strokeWidth: Math.max(el.strokeWidth, NORM_OBSTACLE_MM / N.mmPerUnit), textColor: '#6b7680' };
  }
  switch (el.type) {
    case 'wall': {
      if (el.points.length < 2) return null;
      const ends = wallEndPoints(el, ctx.floor, ctx.variantId);
      const d = pathD(ends, false, el.closed);
      if (el.wallStyle === 'outline') {
        return (
          <g>
            <path d={d} fill="none" stroke={el.color} strokeWidth={el.thickness} strokeLinejoin="miter" strokeLinecap={el.closed ? "square" : "butt"} />
            <path d={d} fill="none" stroke="#ffffff" strokeWidth={Math.max(0.5, el.thickness - Math.max(2, el.thickness * 0.25))} strokeLinejoin="miter" strokeLinecap={el.closed ? "square" : "butt"} />
          </g>
        );
      }
      if (el.wallStyle === 'hatch') {
        const pid = `${ctx.idPrefix ?? ''}pw-${el.id}`;
        return (
          <g>
            <defs><PatternDef id={pid} pattern="hatch" color="#ffffff" size={Math.max(4, el.thickness * 0.7)} /></defs>
            <path d={d} fill="none" stroke={el.color} strokeWidth={el.thickness} strokeLinejoin="miter" strokeLinecap={el.closed ? "square" : "butt"} />
            <path d={d} fill="none" stroke={`url(#${pid})`} strokeWidth={el.thickness * 0.75} strokeLinejoin="miter" strokeLinecap={el.closed ? "square" : "butt"} opacity={0.6} />
          </g>
        );
      }
      return <path d={d} fill="none" stroke={el.color} strokeWidth={el.thickness} strokeLinejoin="miter" strokeLinecap={el.closed ? "square" : "butt"} />;
    }

    case 'area': {
      if (el.points.length < 3) return null;
      const [c0, c1] = polygonCentroid(el.points);
      const cx = c0 + (el.labelDx || 0), cy = c1 + (el.labelDy || 0);
      const pid = `${ctx.idPrefix ?? ''}pa-${el.id}`;
      const upm = ctx.floor.unitsPerMeter;
      const lines = el.label ? el.label.split('\n') : [];
      if (el.number?.trim()) lines.push(el.number.trim());
      if (el.showArea && upm > 0) lines.push(`${(polygonArea(el.points) / (upm * upm)).toFixed(1).replace('.', ',')} m²`);
      return (
        <g>
          <defs><PatternDef id={pid} pattern={el.pattern} color={el.patternColor} size={Math.max(6, el.labelSize * 0.7)} /></defs>
          <polygon points={pts(el.points)} fill={fillOf(pid, el.pattern, el.fill)} fillOpacity={el.fillOpacity} stroke="none" />
          {el.pattern !== 'solid' && el.pattern !== 'none' && <polygon points={pts(el.points)} fill={`url(#${pid})`} stroke="none" />}
          <polygon points={pts(el.points)} fill="none" stroke={el.strokeWidth > 0 ? el.stroke : 'none'} strokeWidth={el.strokeWidth}
            strokeDasharray={dashArray(el.dash, el.strokeWidth)} strokeLinecap={dashCap(el.dash)} />
          {el.labelBg && lines.length > 0 && (() => {
            // étiquette : rectangle arrondi derrière le nom et le numéro
            const fs0 = el.labelSize, w = Math.max(...lines.map((l) => l.length)) * fs0 * (el.labelBold ? 0.62 : 0.58) + fs0 * 0.9;
            const h = lines.length * fs0 * 1.2 + fs0 * 0.45;
            return <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={fs0 * 0.28} fill={el.labelBg} />;
          })()}
          {lines.map((line, i, arr) => (
            <text key={i} x={cx} y={cy + (i - (arr.length - 1) / 2) * el.labelSize * 1.2 + el.labelSize * 0.35}
              textAnchor="middle" fontFamily={FONT} fontSize={i === arr.length - 1 && el.showArea && upm > 0 && i > 0 ? el.labelSize * 0.75 : el.labelSize}
              fontWeight={el.labelBold ? 700 : 500} fill={el.labelColor} letterSpacing={el.labelSize * 0.01}
              stroke={el.labelBg ? 'none' : el.fill && el.pattern === 'solid' && el.fillOpacity > 0.6 ? el.fill : '#ffffff'} strokeWidth={el.labelSize * 0.3} paintOrder="stroke" strokeLinejoin="round">{line}</text>
          ))}
        </g>
      );
    }

    case 'door': {
      const w = el.width;
      const { gap: defaultGap, stroke: sw } = doorDimensions(w);
      // épaisseur du mur porteur (même légèrement décalée de l'axe, la porte suit son mur)
      const gap = openingHostFit(ctx.floor, ctx.variantId, el)?.depth ?? defaultGap;
      const parts: React.ReactNode[] = [];
      const leaf = (hx: number, dir: 1 | -1, lw: number, k: string) => {
        parts.push(
          <g key={k}>
            {ctx.interactive && (
              // zone de clic : tout le secteur balayé par le vantail (sinon le clic tombe sur la pièce)
              <path d={`M ${hx} 0 L ${hx} ${-lw} A ${lw} ${lw} 0 0 ${dir === 1 ? 1 : 0} ${hx + dir * lw} 0 Z`} fill="transparent" stroke="none" />
            )}
            <line x1={hx} y1={0} x2={hx} y2={-lw} stroke={el.color} strokeWidth={sw} strokeLinecap="round" />
            <path d={`M ${hx} ${-lw} A ${lw} ${lw} 0 0 ${dir === 1 ? 1 : 0} ${hx + dir * lw} 0`} fill="none"
              stroke={el.color} strokeWidth={Math.max(0.8, w * 0.012)} strokeDasharray={`${w * 0.05} ${w * 0.035}`} />
          </g>,
        );
      };
      switch (el.doorType) {
        case 'double': leaf(-w / 2, 1, w / 2, 'a'); leaf(w / 2, -1, w / 2, 'b'); break;
        case 'sliding':
          parts.push(<rect key="s1" x={-w / 2} y={-sw * 2.2} width={w * 0.55} height={sw * 1.4} fill="#fff" stroke={el.color} strokeWidth={sw * 0.6} />);
          parts.push(<rect key="s2" x={-w * 0.05} y={sw * 0.8} width={w * 0.55} height={sw * 1.4} fill="#fff" stroke={el.color} strokeWidth={sw * 0.6} />);
          parts.push(<path key="sa" d={`M ${-w * 0.3} ${-w * 0.2} H ${w * 0.3} M ${w * 0.22} ${-w * 0.26} L ${w * 0.3} ${-w * 0.2} L ${w * 0.22} ${-w * 0.14}`} fill="none" stroke={el.color} strokeWidth={sw * 0.5} />);
          break;
        case 'slidingDouble': {
          // deux vantaux qui se rejoignent au milieu et s'écartent (flèches vers les côtés)
          const pw = w / 2 - w * 0.015, ay = -Math.max(sw * 3.5, w * 0.14), ah = Math.max(sw, w * 0.045);
          parts.push(<rect key="d1" x={-w / 2} y={-sw * 2.2} width={pw} height={sw * 1.4} fill="#fff" stroke={el.color} strokeWidth={sw * 0.6} />);
          parts.push(<rect key="d2" x={w / 2 - pw} y={-sw * 2.2} width={pw} height={sw * 1.4} fill="#fff" stroke={el.color} strokeWidth={sw * 0.6} />);
          parts.push(<path key="da" d={`M ${-w * 0.06} ${ay} H ${-w * 0.36} M ${-w * 0.36 + ah} ${ay - ah} L ${-w * 0.36} ${ay} L ${-w * 0.36 + ah} ${ay + ah} M ${w * 0.06} ${ay} H ${w * 0.36} M ${w * 0.36 - ah} ${ay - ah} L ${w * 0.36} ${ay} L ${w * 0.36 - ah} ${ay + ah}`}
            fill="none" stroke={el.color} strokeWidth={sw * 0.5} />);
          break;
        }
        case 'revolving':
          parts.push(<circle key="r" cx={0} cy={0} r={w / 2} fill="#fff" stroke={el.color} strokeWidth={sw * 0.6} strokeDasharray={`${w * 0.05} ${w * 0.035}`} />);
          parts.push(<path key="x" d={`M ${-w * 0.45} 0 H ${w * 0.45} M 0 ${-w * 0.45} V ${w * 0.45}`} stroke={el.color} strokeWidth={sw} />);
          break;
        case 'opening': break;
        case 'swingBoth': {
          // va-et-vient : vantail fermé dans le mur, débattement dessiné des deux côtés
          const hx = el.swing === 'left' ? -w / 2 : w / 2, dir = el.swing === 'left' ? 1 : -1;
          const dash = `${w * 0.05} ${w * 0.035}`, aw = Math.max(0.8, w * 0.012);
          parts.push(<line key="vl" x1={hx} y1={0} x2={hx + dir * w * 0.98} y2={0} stroke={el.color} strokeWidth={sw} strokeLinecap="round" />);
          parts.push(<path key="v1" d={`M ${hx + dir * w} 0 A ${w} ${w} 0 0 ${dir === 1 ? 0 : 1} ${hx} ${-w}`} fill="none" stroke={el.color} strokeWidth={aw} strokeDasharray={dash} />);
          parts.push(<path key="v2" d={`M ${hx + dir * w} 0 A ${w} ${w} 0 0 ${dir === 1 ? 1 : 0} ${hx} ${w}`} fill="none" stroke={el.color} strokeWidth={aw} strokeDasharray={dash} />);
          break;
        }
        case 'unequal': {
          // tiercée : un grand vantail (2/3) et un petit (1/3)
          const big = (w * 2) / 3, small = w - big;
          if (el.swing === 'left') { leaf(-w / 2, 1, big, 'a'); leaf(w / 2, -1, small, 'b'); }
          else { leaf(-w / 2, 1, small, 'a'); leaf(w / 2, -1, big, 'b'); }
          break;
        }
        case 'folding': case 'foldingDouble': {
          // pliante : vantaux repliés en accordéon (zigzag) contre le tableau, course en pointillés
          const zig = (x0: number, dir: 1 | -1, span: number, k: string) => {
            const f = span / 2, h = f * 0.8;
            parts.push(<path key={k} d={`M ${x0} 0 L ${x0 + dir * f * 0.6} ${-h} L ${x0 + dir * f * 1.2} 0`} fill="none" stroke={el.color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />);
            parts.push(<path key={`${k}a`} d={`M ${x0 + dir * f * 1.25} 0 L ${x0 + dir * span} 0`} fill="none" stroke={el.color} strokeWidth={Math.max(0.8, w * 0.012)} strokeDasharray={`${w * 0.04} ${w * 0.03}`} />);
          };
          if (el.doorType === 'folding') { if (el.swing === 'left') zig(-w / 2, 1, w, 'f'); else zig(w / 2, -1, w, 'f'); }
          else { zig(-w / 2, 1, w / 2, 'f1'); zig(w / 2, -1, w / 2, 'f2'); }
          break;
        }
        case 'pocket': {
          // à galandage : le vantail rentre dans l'épaisseur du mur (partie cachée en pointillés)
          const left = el.swing === 'left';
          parts.push(<rect key="p1" x={left ? -w / 2 : -w / 2 + w * 0.05} y={-sw * 0.7} width={w * 0.95} height={sw * 1.4} fill="#fff" stroke={el.color} strokeWidth={sw * 0.6} />);
          parts.push(<rect key="p2" x={left ? w / 2 : -w / 2 - w * 0.95} y={-sw * 0.7} width={w * 0.95} height={sw * 1.4} fill="#fff" stroke={el.color} strokeWidth={sw * 0.5} strokeDasharray={`${w * 0.04} ${w * 0.03}`} />);
          break;
        }
        case 'garage': {
          // porte de garage sectionnelle : tablier qui remonte vers l'intérieur (pointillés)
          const depth = w * 0.45;
          parts.push(<line key="g0" x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={el.color} strokeWidth={sw} />);
          parts.push(<rect key="g1" x={-w / 2 + sw} y={-depth} width={w - sw * 2} height={depth} fill="none" stroke={el.color} strokeWidth={Math.max(0.8, w * 0.008)} strokeDasharray={`${w * 0.03} ${w * 0.02}`} />);
          break;
        }
        default: el.swing === 'left' ? leaf(-w / 2, 1, w, 'a') : leaf(w / 2, -1, w, 'a');
      }
      return (
        <g transform={`translate(${el.x} ${el.y}) rotate(${el.rotation}) ${el.flipY ? 'scale(1 -1)' : ''}`}>
          <rect x={-w / 2} y={-gap / 2} width={w} height={gap} fill={ctx.floor.page.planBackground || '#ffffff'} />
          {ctx.interactive && (
            <path d={`M ${-w / 2} ${-gap / 2} h ${w} M ${-w / 2} ${gap / 2} h ${w}`}
              fill="none" stroke="#64748b" strokeOpacity={0.55} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          )}
          {el.emergency && <rect x={-w / 2} y={gap / 2 - Math.max(2, gap * 0.25)} width={w} height={Math.max(2, gap * 0.25)} fill="#00843d" />}
          {el.fireRated && <rect x={-w / 2} y={-gap / 2} width={w} height={Math.max(2, gap * (el.emergency ? 0.25 : 0.4))} fill={FIRE_RED} />}
          {parts}
          {el.fireRated && el.fireRating?.trim() && (() => {
            // Libellé du côté opposé au débattement, toujours lisible (ni en miroir ni à l'envers).
            const fs = Math.max(9, Math.min(28, w * 0.2));
            const r = ((el.rotation % 360) + 360) % 360;
            const upside = r > 90 && r < 270;
            return (
              <g transform={`translate(0 ${gap / 2 + fs * 0.8}) ${el.flipY ? 'scale(1 -1)' : ''} ${upside ? 'rotate(180)' : ''}`}>
                <text x={0} y={fs * 0.35} textAnchor="middle" fontFamily={FONT} fontSize={fs} fontWeight={700} fill={FIRE_RED}
                  stroke={ctx.floor.page.planBackground || '#ffffff'} strokeWidth={fs * 0.25} paintOrder="stroke" strokeLinejoin="round">{el.fireRating.trim()}</text>
              </g>
            );
          })()}
        </g>
      );
    }

    case 'window': {
      const { width: w, depth: d } = el;
      const frame = windowFrameWidth(w, d);
      const lines = [];
      for (let i = 1; i < el.panes; i++) lines.push(<line key={i} x1={-w / 2 + (w / el.panes) * i} y1={-d / 2} x2={-w / 2 + (w / el.panes) * i} y2={d / 2} stroke={el.color} strokeWidth={Math.max(0.8, d * 0.08)} />);
      return (
        <g transform={`translate(${el.x} ${el.y}) rotate(${el.rotation})`}>
          <rect x={(frame - w) / 2} y={(frame - d) / 2} width={w - frame} height={d - frame} fill="#ffffff" stroke={el.color} strokeWidth={frame} />
          {(el.windowStyle ?? 'standard') === 'standard' && <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={el.color} strokeWidth={Math.min(d, Math.max(0.6, d * 0.07))} />}
          {(el.windowStyle ?? 'standard') === 'standard' && lines}
          {el.windowStyle && el.windowStyle !== 'standard' && <WindowStyleView w={w} d={d} style={el.windowStyle} panes={el.panes} color={el.color} flip={!!el.flipY} />}
          {el.shutter && el.shutter !== 'none' && <ShutterView w={w} d={d} kind={el.shutter} color={el.color} flip={!!el.flipY} />}
        </g>
      );
    }

    case 'stairs': {
      const { w, h, steps } = el;
      const sw = Math.max(1, Math.min(w, h) * 0.012);
      const nodes: React.ReactNode[] = [];
      if (el.stairType === 'landing') {
        const fw = w / 2, flight = h * 0.72, land = h - flight;
        nodes.push(<rect key="o" x={-w / 2} y={-h / 2} width={w} height={h} fill={el.fill} stroke={el.color} strokeWidth={sw * 2} />);
        nodes.push(<line key="m" x1={0} y1={-h / 2 + land} x2={0} y2={h / 2} stroke={el.color} strokeWidth={sw * 2} />);
        nodes.push(<line key="l" x1={-w / 2} y1={-h / 2 + land} x2={w / 2} y2={-h / 2 + land} stroke={el.color} strokeWidth={sw} />);
        const n = Math.max(2, Math.round(steps / 2));
        for (let i = 1; i < n; i++) {
          const y = -h / 2 + land + (flight / n) * i;
          nodes.push(<line key={`a${i}`} x1={-w / 2} y1={y} x2={0} y2={y} stroke={el.color} strokeWidth={sw} />);
          nodes.push(<line key={`b${i}`} x1={0} y1={y} x2={w / 2} y2={y} stroke={el.color} strokeWidth={sw} />);
        }
        if (el.arrow) {
          nodes.push(<path key="ar" d={`M ${-fw / 2} ${h / 2 - h * 0.06} V ${-h / 2 + land / 2} H ${fw / 2} V ${h / 2 - h * 0.12}`} fill="none" stroke={el.color} strokeWidth={sw * 2} />);
          nodes.push(<polygon key="ah" points={`${fw / 2},${h / 2 - h * 0.04} ${fw / 2 - w * 0.07},${h / 2 - h * 0.13} ${fw / 2 + w * 0.07},${h / 2 - h * 0.13}`} fill={el.color} />);
        }
      } else {
        nodes.push(<rect key="o" x={-w / 2} y={-h / 2} width={w} height={h} fill={el.fill} stroke={el.color} strokeWidth={sw * 2} />);
        for (let i = 1; i < steps; i++) {
          const y = -h / 2 + (h / steps) * i;
          nodes.push(<line key={i} x1={-w / 2} y1={y} x2={w / 2} y2={y} stroke={el.color} strokeWidth={sw} />);
        }
        if (el.stairType === 'escalator') {
          nodes.push(<rect key="r1" x={-w / 2} y={-h / 2} width={w * 0.1} height={h} fill={el.color} opacity={0.35} />);
          nodes.push(<rect key="r2" x={w / 2 - w * 0.1} y={-h / 2} width={w * 0.1} height={h} fill={el.color} opacity={0.35} />);
        }
        if (el.split) {
          // Séparation centrale : deux côtés (montée / descente).
          nodes.push(<line key="sp" x1={0} y1={-h / 2} x2={0} y2={h / 2} stroke={el.color} strokeWidth={sw * 2.5} />);
        }
        const arrowAt = (key: string, ax: number, up: boolean, hw: number) => {
          const tip = up ? -h / 2 + h * 0.04 : h / 2 - h * 0.04;
          const base = up ? -h / 2 + h * 0.14 : h / 2 - h * 0.14;
          const tail = up ? h / 2 - h * 0.08 : -h / 2 + h * 0.08;
          nodes.push(<line key={`${key}l`} x1={ax} y1={tail} x2={ax} y2={base} stroke={el.color} strokeWidth={sw * 2} />);
          nodes.push(<polygon key={`${key}h`} points={`${ax},${tip} ${ax - hw},${base} ${ax + hw},${base}`} fill={el.color} />);
        };
        if (el.arrow) {
          if (el.split) { arrowAt('au', -w / 4, true, w * 0.08); arrowAt('ad', w / 4, false, w * 0.08); }
          else arrowAt('a', 0, true, w * 0.12);
        }
      }
      if (el.label) nodes.push(<text key="t" x={0} y={h / 2 + Math.min(w, h) * 0.22} textAnchor="middle" fontFamily={FONT} fontSize={Math.min(w, h) * 0.16} fill={el.color} fontWeight={600}>{el.label}</text>);
      return <g transform={`translate(${el.x} ${el.y}) rotate(${el.rotation}) ${el.flipX ? 'scale(-1 1)' : ''}`}>{nodes}</g>;
    }

    case 'symbol':
      return <SymbolView el={el} ctx={ctx} />;

    case 'route':
      return <RouteView el={el} />;

    case 'dimension':
      return <DimensionView el={el} ctx={ctx} />;

    case 'text': {
      const raw = el.uppercase ? el.text.toUpperCase() : el.text;
      const lines = raw.split('\n');
      const s = textSize(raw, el.fontSize, el.lineHeight, el.letterSpacing);
      const boxed = !!el.background || el.border;
      const pad = boxed ? el.fontSize * el.padding : 0;
      const left = el.align === 'start' ? el.x : el.align === 'middle' ? el.x - s.w / 2 : el.x - s.w;
      return (
        <g transform={el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : undefined}>
          {boxed && (
            <rect x={left - pad} y={el.y - pad} width={s.w + 2 * pad} height={s.h + 2 * pad} rx={el.radius}
              fill={el.background || 'none'} stroke={el.border ? el.borderColor : 'none'} strokeWidth={Math.max(1, el.fontSize * 0.07)} />
          )}
          <text x={el.x} y={el.y} textAnchor={el.align} fontFamily={font(el.fontFamily)} fontSize={el.fontSize} fill={el.color}
            fontWeight={el.bold ? 700 : 400} fontStyle={el.italic ? 'italic' : 'normal'} letterSpacing={el.letterSpacing || undefined}
            textDecoration={el.underline ? 'underline' : undefined}>
            {lines.map((l, i) => (
              <tspan key={i} x={el.x} dy={i === 0 ? el.fontSize * 0.95 : el.fontSize * el.lineHeight}>{l || ' '}</tspan>
            ))}
          </text>
        </g>
      );
    }

    case 'image': {
      if (!el.src) return null;
      const cid = `${ctx.idPrefix ?? ''}ci-${el.id}`;
      return (
        <g transform={`translate(${el.x} ${el.y}) rotate(${el.rotation}) scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1})`}>
          {el.radius > 0 && <defs><clipPath id={cid}><rect x={-el.w / 2} y={-el.h / 2} width={el.w} height={el.h} rx={el.radius} /></clipPath></defs>}
          <image href={el.src} x={-el.w / 2} y={-el.h / 2} width={el.w} height={el.h} preserveAspectRatio="none" clipPath={el.radius > 0 ? `url(#${cid})` : undefined} />
          {el.border && <rect x={-el.w / 2} y={-el.h / 2} width={el.w} height={el.h} rx={el.radius} fill="none" stroke={el.border} strokeWidth={Math.max(1, el.w * 0.01)} />}
        </g>
      );
    }

    case 'shape': {
      const pid = `${ctx.idPrefix ?? ''}ps-${el.id}`;
      const g = shapePath(el);
      const isLine = el.shape === 'line';
      return (
        <g transform={`translate(${el.x} ${el.y}) rotate(${el.rotation}) scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1})`}>
          <defs><PatternDef id={pid} pattern={el.pattern} color={el.patternColor} size={Math.max(6, Math.min(el.w, el.h) * 0.12)} /></defs>
          {!isLine && <g fill={fillOf(pid, el.pattern, el.fill)} fillOpacity={el.fillOpacity} stroke="none">{g}</g>}
          {!isLine && el.pattern !== 'solid' && el.pattern !== 'none' && <g fill={`url(#${pid})`} stroke="none">{g}</g>}
          <g fill="none" stroke={el.strokeWidth > 0 ? el.stroke : 'none'} strokeWidth={el.strokeWidth}
            strokeDasharray={dashArray(el.dash, el.strokeWidth)} strokeLinecap={dashCap(el.dash, 'round')} strokeLinejoin="round">{g}</g>
          {el.text && el.text.split('\n').map((l, i, a) => (
            <text key={i} x={0} y={(i - (a.length - 1) / 2) * el.textSize * 1.2 + el.textSize * 0.35} textAnchor="middle"
              fontFamily={FONT} fontSize={el.textSize} fill={el.textColor} fontWeight={600}
              transform={el.flipX || el.flipY ? `scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1})` : undefined}>{l}</text>
          ))}
        </g>
      );
    }

    case 'legend': {
      const ids = usedSymbolIds(ctx.floor, ctx.variantId);
      const fs = el.fontSize;
      const size = legendSize(fs, ids.length, el.columns);
      const row = fs * 2;
      const perCol = Math.max(1, Math.ceil(ids.length / el.columns));
      const colW = fs * 18;
      return (
        <g>
          <rect x={el.x} y={el.y} width={size.w} height={size.h} fill={el.background || 'none'} stroke={el.border || 'none'} strokeWidth={Math.max(1, fs * 0.08)} rx={fs * 0.4} />
          <text x={el.x + fs * 0.8} y={el.y + fs * 1.55} fontFamily={FONT} fontWeight={700} fontSize={fs * 1.1} fill="#111">{el.title}</text>
          {ids.length === 0 && (
            <text x={el.x + fs * 0.8} y={el.y + fs * 3.5} fontFamily={FONT} fontSize={fs * 0.9} fill="#777">(aucun pictogramme)</text>
          )}
          {ids.map((id, i) => {
            const c = Math.floor(i / perCol), r = i % perCol;
            const cy = el.y + fs * 2.2 + r * row + row / 2;
            const x = el.x + c * colW;
            return (
              <g key={id}>
                <g transform={`translate(${x + fs * 1.6} ${cy})`}><SymbolGraphic symbolId={id} size={fs * 1.6} custom={ctx.customSymbols} /></g>
                <text x={x + fs * 3.1} y={cy + fs * 0.35} fontFamily={FONT} fontSize={fs} fill="#111">{symbolName(id, ctx.customSymbols)}</text>
              </g>
            );
          })}
        </g>
      );
    }
  }
}

/** Élément avec ses effets communs (opacité, ombre portée). */
export function ElementView({ el, ctx }: { el: Element; ctx: RenderCtx }): React.ReactElement | null {
  const inner = <Inner el={el} ctx={ctx} />;
  const op = el.opacity ?? 1;
  const sh = el.shadow?.enabled ? el.shadow : null;
  if (op >= 1 && !sh) return inner;
  const fid = `${ctx.idPrefix ?? ''}sh-${el.id}`;
  return (
    <g opacity={op < 1 ? op : undefined} filter={sh ? `url(#${fid})` : undefined}>
      {sh && (
        <defs>
          <filter id={fid} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx={sh.dx} dy={sh.dy} stdDeviation={sh.blur / 2} floodColor={sh.color} floodOpacity={sh.opacity} />
          </filter>
        </defs>
      )}
      {inner}
    </g>
  );
}

/** Nombre de lignes de légende (pour le calcul des emprises). */
export function legendCount(floor: Floor, variantId: string): number {
  return usedSymbolIds(floor, variantId).length;
}

export { boxOf };
