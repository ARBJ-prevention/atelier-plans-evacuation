import React from 'react';
import { boxOf, doorDimensions, legendSize, openingWallFit, polygonArea, symbolFuseSides, textSize, usedSymbolIds, windowFrameWidth, type FuseSides } from '../model/geometry';
import type {
  ArrowStyle, CustomSymbol, DashStyle, Element, FillPattern, Floor, Pt, RouteElement, ShapeElement, SymbolElement,
} from '../model/types';
import { getBuiltinSymbol } from '../symbols/library';

export interface RenderCtx {
  floor: Floor;
  variantId: string;
  customSymbols: CustomSymbol[];
  interactive?: boolean;
  idPrefix?: string;
}

export const FONT = "'Segoe UI Variable Text', 'Segoe UI', Arial, Helvetica, sans-serif";
/** Rouge sécurité incendie (portes coupe-feu). */
const FIRE_RED = '#e30613';
const font = (f?: string) => (f ? `'${f}', ${FONT}` : FONT);

export function symbolName(id: string, custom: CustomSymbol[]): string {
  return getBuiltinSymbol(id)?.name ?? custom.find((c) => c.id === id)?.name ?? 'Pictogramme';
}

/** Pictogramme dans une boîte de `size` centrée sur (0,0). */
export function SymbolGraphic({ symbolId, size, custom, fuse, clipId }: {
  symbolId: string; size: number; custom: CustomSymbol[];
  /** Côtés collés à un autre panneau : le dessin y est prolongé de 4 % puis recadré, ce qui retire le liseré blanc et l'arrondi. */
  fuse?: FuseSides; clipId?: string;
}) {
  const def = getBuiltinSymbol(symbolId);
  const c = def ? null : custom.find((x) => x.id === symbolId);
  if (def || c) {
    const bl = size * 0.04;
    const f = fuse && clipId && (fuse.l || fuse.r || fuse.t || fuse.b) ? fuse : null;
    const x0 = -size / 2 - (f?.l ? bl : 0), y0 = -size / 2 - (f?.t ? bl : 0);
    const w = size + (f?.l ? bl : 0) + (f?.r ? bl : 0), h = size + (f?.t ? bl : 0) + (f?.b ? bl : 0);
    const art = def && def.kind === 'svg'
      ? <g transform={`translate(${x0} ${y0}) scale(${w / 100} ${h / 100})`} dangerouslySetInnerHTML={{ __html: def.svg }} />
      : <image href={def ? def.svg : c!.src} x={x0} y={y0} width={w} height={h} preserveAspectRatio={c && !f ? 'xMidYMid meet' : 'none'} />;
    if (!f) return art;
    return (
      <g>
        <defs><clipPath id={clipId}><rect x={-size / 2} y={-size / 2} width={size} height={size} /></clipPath></defs>
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
    let acc = el.arrowRepeat / 2;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc < L) {
        const t = acc / L;
        const c: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const back: Pt = [c[0] - (b[0] - a[0]) / L, c[1] - (b[1] - a[1]) / L];
        repeats.push(arrowHead(c, back, el.width * 0.55, 1, 'open', el.outline || '#ffffff', `r${i}-${acc}`));
        acc += el.arrowRepeat;
      }
      acc -= L;
    }
  }
  const cap = dashCap(el.dash, el.dash === 'solid' ? 'round' : 'butt');
  return (
    <g>
      {el.outline && (
        <path d={path} fill="none" stroke={el.outline} strokeWidth={el.width + Math.max(3, el.width * 0.6)} strokeLinejoin={el.corner} strokeLinecap="round" />
      )}
      <path d={path} fill="none" stroke={el.color} strokeWidth={el.width} strokeLinejoin={el.corner} strokeLinecap={cap}
        strokeDasharray={dashArray(el.dash, el.width)} />
      {repeats}
      {el.arrowEnd && arrowHead(p[p.length - 1], p[p.length - 2], el.width, el.arrowSize, el.arrowStyle, el.color, 'e')}
      {el.arrowStart && arrowHead(p[0], p[1], el.width, el.arrowSize, el.arrowStyle, el.color, 's')}
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

function SymbolView({ el, ctx }: { el: SymbolElement; ctx: RenderCtx }) {
  const ls = el.labelSize > 0 ? el.labelSize : Math.max(8, el.size * 0.26);
  const pos = el.labelPosition;
  const sx = el.stretchX ?? 1, sy = el.stretchY ?? 1;
  const offX = (el.size * sx) / 2 + ls * 0.4, offY = (el.size * sy) / 2 + ls * 0.4;
  const lx = pos === 'right' ? offX : pos === 'left' ? -offX : 0;
  const ly = pos === 'below' ? offY + ls * 0.8 : pos === 'above' ? -offY : ls * 0.35;
  const stretch = sx !== 1 || sy !== 1 ? `scale(${sx} ${sy})` : '';
  const near = symbolFuseSides(el, ctx.floor, ctx.variantId);
  // Les côtés s'inversent avec le miroir horizontal / vertical.
  const fuse = { l: el.flipX ? near.r : near.l, r: el.flipX ? near.l : near.r, t: el.flipY ? near.b : near.t, b: el.flipY ? near.t : near.b };
  const anchor = pos === 'right' ? 'start' : pos === 'left' ? 'end' : 'middle';
  return (
    <g transform={`translate(${el.x} ${el.y})`}>
      <g transform={`${el.rotation ? `rotate(${el.rotation})` : ''} ${stretch} ${el.flipX || el.flipY ? `scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1})` : ''}`}>
        {el.halo && <rect x={-el.size * 0.62} y={-el.size * 0.62} width={el.size * 1.24} height={el.size * 1.24} rx={el.size * 0.18} fill="#ffffff" stroke="rgba(0,0,0,.12)" strokeWidth={el.size * 0.02} />}
        <SymbolGraphic symbolId={el.symbolId} size={el.size} custom={ctx.customSymbols} fuse={fuse} clipId={`${ctx.idPrefix ?? ''}fuse-${el.id}`} />
      </g>
      {el.label && (
        <text x={lx} y={ly} textAnchor={anchor} fontFamily={FONT} fontWeight={700}
          fontSize={ls} fill={el.labelColor} stroke="#fff" strokeWidth={Math.max(2, ls * 0.28)}
          paintOrder="stroke" strokeLinejoin="round">{el.label}</text>
      )}
    </g>
  );
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

function Inner({ el, ctx }: { el: Element; ctx: RenderCtx }): React.ReactElement | null {
  switch (el.type) {
    case 'wall': {
      if (el.points.length < 2) return null;
      const d = pathD(el.points, false, el.closed);
      if (el.wallStyle === 'outline') {
        return (
          <g>
            <path d={d} fill="none" stroke={el.color} strokeWidth={el.thickness} strokeLinejoin="miter" strokeLinecap="square" />
            <path d={d} fill="none" stroke="#ffffff" strokeWidth={Math.max(0.5, el.thickness - Math.max(2, el.thickness * 0.25))} strokeLinejoin="miter" strokeLinecap="square" />
          </g>
        );
      }
      if (el.wallStyle === 'hatch') {
        const pid = `${ctx.idPrefix ?? ''}pw-${el.id}`;
        return (
          <g>
            <defs><PatternDef id={pid} pattern="hatch" color="#ffffff" size={Math.max(4, el.thickness * 0.7)} /></defs>
            <path d={d} fill="none" stroke={el.color} strokeWidth={el.thickness} strokeLinejoin="miter" strokeLinecap="square" />
            <path d={d} fill="none" stroke={`url(#${pid})`} strokeWidth={el.thickness * 0.75} strokeLinejoin="miter" strokeLinecap="square" opacity={0.6} />
          </g>
        );
      }
      return <path d={d} fill="none" stroke={el.color} strokeWidth={el.thickness} strokeLinejoin="miter" strokeLinecap="square" />;
    }

    case 'area': {
      if (el.points.length < 3) return null;
      const [c0, c1] = polygonCentroid(el.points);
      const cx = c0 + (el.labelDx || 0), cy = c1 + (el.labelDy || 0);
      const pid = `${ctx.idPrefix ?? ''}pa-${el.id}`;
      const upm = ctx.floor.unitsPerMeter;
      const lines = el.label ? el.label.split('\n') : [];
      if (el.showArea && upm > 0) lines.push(`${(polygonArea(el.points) / (upm * upm)).toFixed(1).replace('.', ',')} m²`);
      return (
        <g>
          <defs><PatternDef id={pid} pattern={el.pattern} color={el.patternColor} size={Math.max(6, el.labelSize * 0.7)} /></defs>
          <polygon points={pts(el.points)} fill={fillOf(pid, el.pattern, el.fill)} fillOpacity={el.fillOpacity} stroke="none" />
          {el.pattern !== 'solid' && el.pattern !== 'none' && <polygon points={pts(el.points)} fill={`url(#${pid})`} stroke="none" />}
          <polygon points={pts(el.points)} fill="none" stroke={el.strokeWidth > 0 ? el.stroke : 'none'} strokeWidth={el.strokeWidth}
            strokeDasharray={dashArray(el.dash, el.strokeWidth)} strokeLinecap={dashCap(el.dash)} />
          {lines.map((line, i, arr) => (
            <text key={i} x={cx} y={cy + (i - (arr.length - 1) / 2) * el.labelSize * 1.2 + el.labelSize * 0.35}
              textAnchor="middle" fontFamily={FONT} fontSize={i === arr.length - 1 && el.showArea && upm > 0 && i > 0 ? el.labelSize * 0.75 : el.labelSize}
              fontWeight={el.labelBold ? 700 : 500} fill={el.labelColor} letterSpacing={el.labelSize * 0.01}
              stroke={el.fill && el.pattern === 'solid' && el.fillOpacity > 0.6 ? el.fill : '#ffffff'} strokeWidth={el.labelSize * 0.3} paintOrder="stroke" strokeLinejoin="round">{line}</text>
          ))}
        </g>
      );
    }

    case 'door': {
      const w = el.width;
      const { gap: defaultGap, stroke: sw } = doorDimensions(w);
      const gap = openingWallFit(ctx.floor, ctx.variantId, el)?.depth ?? defaultGap;
      const parts: React.ReactNode[] = [];
      const leaf = (hx: number, dir: 1 | -1, lw: number, k: string) => {
        parts.push(
          <g key={k}>
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
        case 'revolving':
          parts.push(<circle key="r" cx={0} cy={0} r={w / 2} fill="#fff" stroke={el.color} strokeWidth={sw * 0.6} strokeDasharray={`${w * 0.05} ${w * 0.035}`} />);
          parts.push(<path key="x" d={`M ${-w * 0.45} 0 H ${w * 0.45} M 0 ${-w * 0.45} V ${w * 0.45}`} stroke={el.color} strokeWidth={sw} />);
          break;
        case 'opening': break;
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
          <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={el.color} strokeWidth={Math.min(d, Math.max(0.6, d * 0.07))} />
          {lines}
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
