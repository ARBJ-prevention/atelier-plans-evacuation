import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { floorContentBounds, isVisibleInVariant, usedSymbolIds } from '../model/geometry';
import type { AreaElement, Building, CustomSymbol, Floor, PageSetup, RouteElement, SymbolElement, ValidationStatus, WallElement } from '../model/types';
import { FONT, symbolName, SymbolGraphic } from './ElementView';
import { FloorDrawing } from './FloorDrawing';
import { computeLayout, frameOn, frameStroke, horizonNight, mixHex, niceScaleBarMeters, themeColor, wrapText, type PageLayout } from './layout';

export const STATUS_LABEL: Record<ValidationStatus, string> = {
  draft: 'Brouillon',
  to_validate: 'À valider',
  validated: 'Validé',
};
const STATUS_COLOR: Record<ValidationStatus, string> = { draft: '#6b7a89', to_validate: '#c27400', validated: '#00843d' };
const FIRE = '#d52b1e';
const SAFE = '#00843d';   // vert sécurité (évacuation)

/** Dégradés du thème Horizon : identifiants propres à la page (plusieurs pages dans un même PDF). */
type GradKind = 'fire' | 'evac' | 'accent' | 'ink';
interface Grads { uid: string; n: number }
function gradStops(kind: GradKind, accent: string): [string, string, string] {
  if (kind === 'fire') return ['#7f1610', FIRE, '#ee5b3f'];
  if (kind === 'evac') return ['#063f22', SAFE, '#34ad6c'];
  if (kind === 'ink') return ['#0c1622', '#25364a', '#4a5d73'];
  return [mixHex(accent, '#0c1622', 0.5), accent, mixHex(accent, '#ffffff', 0.25)];
}
function GradDefs({ g, accent }: { g: Grads; accent: string }) {
  return (
    <>
      {(['fire', 'evac', 'accent', 'ink'] as GradKind[]).map((kind) => {
        const [a, b, c] = gradStops(kind, accent);
        return (
          <linearGradient key={kind} id={`${g.uid}-g-${kind}`} x1="0" y1="0" x2="1" y2="0.6">
            <stop offset="0" stopColor={a} /><stop offset="0.55" stopColor={b} /><stop offset="1" stopColor={c} />
          </linearGradient>
        );
      })}
    </>
  );
}
/** Forme en dégradé avec deux reflets ronds plus clairs, comme le bandeau d'en-tête. */
function GradShape({ g, kind, x, y, w, h, rx }: { g: Grads; kind: GradKind; x: number; y: number; w: number; h: number; rx: number }) {
  const cid = `${g.uid}-gc${g.n++}`;
  const m = Math.min(w, h);
  return (
    <g>
      <defs><clipPath id={cid}><rect x={x} y={y} width={w} height={h} rx={rx} /></clipPath></defs>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#${g.uid}-g-${kind})`} />
      <g clipPath={`url(#${cid})`} fill="#ffffff">
        <circle cx={x + w - m * 0.35} cy={y - h * 0.15} r={Math.min(h * 1.05, w * 0.7)} fillOpacity={0.16} />
        <circle cx={x + w - m * 0.1} cy={y + h * 0.95} r={Math.min(h * 0.6, w * 0.4)} fillOpacity={0.1} />
      </g>
    </g>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
/** Taille de police réduite (jusqu'à 70 %) pour qu'un texte tienne dans la largeur, avant troncature. */
const fitSize = (s: string, widthMm: number, fontMm: number) => Math.max(fontMm * 0.7, Math.min(fontMm, widthMm / Math.max(1, s.length * 0.48)));
const fit = (s: string, widthMm: number, fontMm: number) => {
  const max = Math.max(4, Math.floor(widthMm / (fontMm * 0.52)));
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};
const tf = (f: string) => `'${f}', ${FONT}`;

export interface PrintPageProps {
  building: Building;
  floor: Floor;
  variantId: string;
  customSymbols: CustomSymbol[];
  page?: PageSetup;
  uniqueKey?: string;
}

/** Page complète (SVG en millimètres) selon le thème choisi. */
export function PrintPage({ building, floor, variantId, customSymbols, page = floor.page, uniqueKey = 'p' }: PrintPageProps) {
  const L = computeLayout(floor, variantId, page);
  const T = L.theme;
  const tb = floor.titleBlock;
  const accent = page.accentColor || '#00843d';
  const variant = floor.variants.find((v) => v.id === variantId);
  const clipId = `clip-${uniqueKey}`;
  const status = tb.status;
  // Un sous-titre saisi dans le cartouche remplace entièrement le sous-titre automatique.
  // Avec plusieurs versions, le nom de la version reste toujours affiché pour distinguer les pages.
  const variantName = floor.variants.length > 1 ? variant?.name ?? '' : '';
  const subtitle = tb.subtitle.trim()
    ? [tb.subtitle.trim(), variantName].filter(Boolean).join('  ·  ')
    : [building.name, floor.name, variantName, building.address].filter(Boolean).join('  ·  ');
  const numbersInHeader = L.numbersInHeader;
  const planFrame = frameOn(page, 'plan') ? frameStroke(T, accent, 'plan') : null;
  const grads: Grads | null = T.gradients ? { uid: `hz-${uniqueKey}`, n: 0 } : null;

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={`${L.paperW}mm`} height={`${L.paperH}mm`} viewBox={`0 0 ${L.w} ${L.h}`}>
      <rect x={0} y={0} width={L.w} height={L.h} fill="#ffffff" />
      <defs>
        <clipPath id={clipId}><rect x={L.drawing.x} y={L.drawing.y} width={L.drawing.w} height={L.drawing.h} rx={T.planRadius} /></clipPath>
        {grads && <GradDefs g={grads} accent={accent} />}
      </defs>
      {T.frame !== 'none' && page.showFrame && <Frame L={L} m={L.m} double={T.frame === 'double'} ink={T.ink} />}
      {L.header && <Header L={L} page={page} accent={accent} title={tb.title || 'Plan d’évacuation'} subtitle={subtitle} logo={tb.logo}
        numbers={numbersInHeader ? tb.emergencyNumbers : ''} version={tb.version} uid={uniqueKey} />}

      {/* Plan */}
      <rect x={L.drawing.x} y={L.drawing.y} width={L.drawing.w} height={L.drawing.h} rx={T.planRadius} fill={page.planBackground || '#ffffff'} />
      <g clipPath={`url(#${clipId})`}>
        <g transform={`translate(${L.tx} ${L.ty}) scale(${L.k})`}>
          <FloorDrawing floor={floor} variantId={variantId} customSymbols={customSymbols} />
        </g>
        {page.showWatermark && status !== 'validated' && (
          <text x={L.drawing.x + L.drawing.w / 2} y={L.drawing.y + L.drawing.h / 2} textAnchor="middle"
            transform={`rotate(-24 ${L.drawing.x + L.drawing.w / 2} ${L.drawing.y + L.drawing.h / 2})`}
            fontFamily={tf('Bahnschrift')} fontWeight={700} fontSize={Math.min(L.drawing.w / 7, 30)} fill={FIRE} fillOpacity={0.1} letterSpacing={2}>
            {status === 'draft' ? 'BROUILLON' : 'À VALIDER'}
          </text>
        )}
      </g>
      {planFrame && (
        <rect x={L.drawing.x} y={L.drawing.y} width={L.drawing.w} height={L.drawing.h} rx={T.planRadius} fill="none"
          stroke={planFrame.color} strokeWidth={planFrame.w} />
      )}
      {page.showScaleBar && floor.unitsPerMeter > 0 && <ScaleBar L={L} floor={floor} page={page} />}
      {page.showNorth && <North L={L} angle={page.northAngle} ink={T.ink} />}

      {L.side && <Side L={L} page={page} floor={floor} variantId={variantId} customSymbols={customSymbols} accent={accent} numbersInHeader={numbersInHeader} grads={grads} />}
      {L.footer && <Footer L={L} page={page} floor={floor} building={building} accent={accent} />}
      {L.footer && frameOn(page, 'footer') && T.footer !== 'capsule' && T.footer !== 'table' && (
        // Cartouche sans cadre dans le thème, encadré à la demande
        // (pied « ligne » plus bas : le cadre englobe aussi la mention finale pour ne couper aucun texte)
        <rect x={L.footer.x - 1.5} y={L.footer.y - 1.2} width={L.footer.w + 3} height={T.footer === 'line' ? L.footer.h + 2.2 : L.footer.h - 1.6} rx={T.cardRadius}
          fill="none" stroke={frameStroke(T, accent, 'footer').color} strokeWidth={frameStroke(T, accent, 'footer').w} />
      )}
    </svg>
  );
}

function Frame({ L, m, double, ink }: { L: PageLayout; m: number; double: boolean; ink: string }) {
  return (
    <g fill="none" stroke={ink}>
      <rect x={m} y={m} width={L.w - 2 * m} height={L.h - 2 * m} strokeWidth={0.6} />
      {double && <rect x={m + 1.2} y={m + 1.2} width={L.w - 2 * m - 2.4} height={L.h - 2 * m - 2.4} strokeWidth={0.2} />}
    </g>
  );
}

function PhoneGlyph({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  return (
    <path transform={`translate(${x} ${y}) scale(${s / 24})`} fill={color}
      d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" />
  );
}

function Header({ L, page, accent, title, subtitle, logo, numbers, version, uid }: {
  L: PageLayout; page: PageSetup; accent: string; title: string; subtitle: string; logo: string; numbers: string; version: string; uid: string;
}) {
  const H = L.header!;
  const T = L.theme;
  const m = L.m;
  const k = L.hs;                       // agrandissement selon le papier
  const titleFs = 11 * k;               // titre principal : grand et lisible de loin
  const subFs = 7 * k;                  // lieu : légèrement plus petit que le titre
  const bg = T.headerBg === 'accent' ? accent : T.headerBg;
  const inner = T.fullBleedHeader ? { x: m, w: L.w - 2 * m, top: m * 0.6 } : { x: H.x, w: H.w, top: 0 };
  const logoW = logo ? 30 * k : 0;
  const titleText = T.titleUpper ? title.toUpperCase() : title;
  const numFs = 3.6 * k;
  const numW = numbers ? Math.min(inner.w * 0.5, numbers.length * numFs * 0.52 + 14 * k) : 0;

  if (page.theme === 'editorial') {
    // Éditorial : grand titre noir aligné à gauche, pavé d'accent, filet épais de clôture
    const tx = H.x + (logo ? logoW + 5 : 0);
    const bigFs = titleFs * 1.32;
    const nFs = numFs * 1.1;
    const nW = numbers ? Math.min(H.w * 0.5, numbers.length * nFs * 0.5 + nFs * 2) : 0;
    const nText = numbers ? fit(numbers, nW - nFs * 1.8, nFs * 0.92) : '';
    const right = H.x + H.w;
    const verText = version ? `Version ${version}` : '';
    const verW = verText.length * 2.6 * k * 0.62;
    const textW = H.w - (tx - H.x) - nW - 6;         // ligne du titre (à côté des numéros)
    const subW = H.w - (tx - H.x) - verW - 8;        // ligne du lieu (à côté de la version)
    return (
      <g>
        <rect x={H.x} y={H.y} width={H.w} height={0.3} fill={T.ink} />
        <rect x={H.x} y={H.y} width={16 * k} height={2.2 * k} fill={accent} />
        {logo && <image href={logo} x={H.x} y={H.y + 5 * k} width={logoW} height={H.h - 8 * k} preserveAspectRatio="xMinYMid meet" />}
        <text x={tx} y={H.y + H.h * 0.6} fontFamily={tf(T.titleFont)} fontWeight={T.titleWeight} fontSize={bigFs} fill={T.headerFg} letterSpacing={-0.25 * k}>
          {fit(titleText, textW, bigFs * 0.98)}
        </text>
        <rect x={tx} y={H.y + H.h * 0.83 - subFs * 0.55} width={subFs * 0.5} height={subFs * 0.5} fill={accent} />
        <text x={tx + subFs * 0.9} y={H.y + H.h * 0.83} fontFamily={tf(T.titleFont)} fontWeight={500} fontSize={fitSize(subtitle, subW - subFs, subFs * 0.9)} fill={T.headerSub}>
          {fit(subtitle, subW - subFs, fitSize(subtitle, subW - subFs, subFs * 0.9) * 0.92)}
        </text>
        {numbers && (
          <g>
            <text x={right} y={H.y + H.h * 0.52} textAnchor="end" fontFamily={tf('Bahnschrift')} fontWeight={700} fontSize={nFs} fill={FIRE}>{nText}</text>
            <PhoneGlyph x={right - nText.length * nFs * 0.43 - nFs * 1.5} y={H.y + H.h * 0.52 - nFs * 1.02} s={nFs * 1.2} color={FIRE} />
          </g>
        )}
        {verText && <text x={right} y={H.y + H.h * 0.83} textAnchor="end" fontFamily={FONT} fontSize={2.6 * k} fontWeight={600} fill={T.muted} letterSpacing={0.3}>{verText.toUpperCase()}</text>}
        <rect x={H.x} y={H.y + H.h - 1.1} width={H.w} height={1.1} fill={T.ink} />
      </g>
    );
  }
  if (!T.fullBleedHeader && page.theme !== 'epure') {
    // Institutionnel, Encadré, Technique : titre centré et case « Version »
    const line = page.theme === 'encadre' ? accent : T.ink;
    const vw = 30 * k;
    const icon = page.theme === 'encadre' ? 15 * k : 0;
    const side = Math.max(logoW + icon + (logoW || icon ? 6 : 0), vw) + 4;
    const cx = H.x + H.w / 2;
    return (
      <g>
        {logo && <image href={logo} x={H.x + 2} y={H.y + 2} width={logoW} height={H.h - 4} preserveAspectRatio="xMinYMid meet" />}
        {icon > 0 && (
          <g transform={`translate(${H.x + (logo ? logoW + 4 : 0) + icon / 2 + 2} ${H.y + H.h / 2})`}><SymbolGraphic symbolId="iso-E002" size={icon} custom={[]} /></g>
        )}
        <text x={cx} y={H.y + H.h * 0.47} textAnchor="middle" fontFamily={tf(T.titleFont)} fontWeight={T.titleWeight} fontSize={titleFs} fill={T.headerFg} letterSpacing={0.4 * k}>
          {fit(titleText, H.w - 2 * side, titleFs * (T.titleUpper ? 1.12 : 1))}
        </text>
        <text x={cx} y={H.y + H.h * 0.82} textAnchor="middle" fontFamily={tf(T.titleFont)} fontWeight={600} fontSize={fitSize(subtitle, H.w - 2 * side, subFs)} fill={T.headerSub}>
          {fit(subtitle, H.w - 2 * side, fitSize(subtitle, H.w - 2 * side, subFs) * 0.92)}
        </text>
        <rect x={H.x + H.w - vw} y={H.y + 1.5} width={vw} height={H.h - 3} rx={T.cardRadius} fill="none" stroke={line} strokeWidth={0.3} />
        <text x={H.x + H.w - vw / 2} y={H.y + H.h * 0.36} textAnchor="middle" fontFamily={FONT} fontSize={2.5 * k} fill={T.muted}>VERSION</text>
        <text x={H.x + H.w - vw / 2} y={H.y + H.h * 0.74} textAnchor="middle" fontFamily={FONT} fontSize={6.5 * k} fontWeight={700} fill={T.ink}>{version || '—'}</text>
        <line x1={H.x} y1={H.y + H.h} x2={H.x + H.w} y2={H.y + H.h} stroke={line} strokeWidth={page.theme === 'encadre' ? 0.8 : 0.5} />
      </g>
    );
  }
  if (page.theme === 'epure') {
    const tx = inner.x + (logo ? logoW + 4 : 0);
    const avail = inner.w - numW - (logo ? logoW + 4 : 0) - 6;
    return (
      <g>
        {logo && <image href={logo} x={inner.x} y={H.y + 1} width={logoW} height={H.h - 4} preserveAspectRatio="xMinYMid meet" />}
        <text x={tx} y={H.y + H.h * 0.5} fontFamily={tf(T.titleFont)} fontWeight={T.titleWeight} fontSize={titleFs * 1.05} fill={T.headerFg}>{fit(titleText, avail, titleFs * 1.05)}</text>
        <text x={tx} y={H.y + H.h * 0.86} fontFamily={FONT} fontWeight={600} fontSize={fitSize(subtitle, inner.w - (logo ? logoW + 4 : 0), subFs)} fill={accent}>{fit(subtitle, inner.w - (logo ? logoW + 4 : 0), fitSize(subtitle, inner.w - (logo ? logoW + 4 : 0), subFs) * 0.92)}</text>
        {numbers && (
          <g>
            <PhoneGlyph x={inner.x + inner.w - Math.min(numW - numFs * 1.6, numbers.length * numFs * 0.47) - numFs * 1.6} y={H.y + H.h * 0.5 - numFs * 1.15} s={numFs * 1.25} color={FIRE} />
            <text x={inner.x + inner.w} y={H.y + H.h * 0.5 - numFs * 0.1} textAnchor="end" fontFamily={tf('Bahnschrift')} fontWeight={600} fontSize={numFs} fill={FIRE}>{fit(numbers, numW - numFs * 1.6, numFs)}</text>
          </g>
        )}
        <line x1={inner.x} y1={H.y + H.h} x2={inner.x + inner.w} y2={H.y + H.h} stroke="#d4dae0" strokeWidth={0.25} />
      </g>
    );
  }
  // Moderne, Signalétique, Bandeaux, Horizon : bandeau pleine largeur
  const sig = page.theme === 'signaletique';
  const hz = T.headerBg === 'gradient';
  const gid = `hz-${uid}`;
  const night = horizonNight(accent);
  const light = sig || hz;          // pastille d'urgence blanche, texte rouge
  const top = inner.top, bottom = H.h - 1.3;
  const cy = top + (bottom - top) / 2;
  const tx = inner.x + (logo ? logoW + 4 : 0);
  const iconS = sig ? 17 * k : 0;
  const textX = tx + (sig ? iconS + 4 : 0);
  const titleY = cy + titleFs * 0.05;
  const subY = cy + titleFs * 0.05 + subFs * 1.2;
  const pillH = numFs * 2.8;
  const pillY = titleY - titleFs * 0.36 - pillH / 2;
  return (
    <g>
      {hz && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0.6">
            <stop offset="0" stopColor={night} />
            <stop offset="0.45" stopColor={mixHex(night, accent, 0.35)} />
            <stop offset="1" stopColor={accent} />
          </linearGradient>
        </defs>
      )}
      <rect x={0} y={0} width={L.w} height={H.h} fill={hz ? `url(#${gid})` : bg} />
      {hz ? (
        <g fill="#ffffff">
          <circle cx={L.w - 22 * k} cy={-H.h * 0.15} r={H.h * 1.05} fillOpacity={0.07} />
          <circle cx={L.w - 6 * k} cy={H.h * 0.95} r={H.h * 0.6} fillOpacity={0.06} />
          <rect x={inner.x} y={H.h - 2.2} width={22 * k} height={0.7} rx={0.35} fillOpacity={0.75} />
        </g>
      ) : (
        <rect x={0} y={H.h - 1.3} width={L.w} height={1.3} fill={sig ? '#0f1b2a' : accent} />
      )}
      {logo && <rect x={inner.x} y={cy - 9 * k} width={logoW} height={18 * k} rx={1.5} fill="#ffffff" />}
      {logo && <image href={logo} x={inner.x + 1.5} y={cy - 7.8 * k} width={logoW - 3} height={15.6 * k} preserveAspectRatio="xMidYMid meet" />}
      {sig && (
        <g>
          <rect x={tx} y={cy - iconS / 2} width={iconS} height={iconS} rx={1.4} fill="#ffffff" />
          <g transform={`translate(${tx + iconS / 2} ${cy})`}><SymbolGraphic symbolId="iso-E002" size={iconS * 0.85} custom={[]} /></g>
        </g>
      )}
      <text x={textX} y={titleY} fontFamily={tf(T.titleFont)} fontWeight={T.titleWeight} fontSize={titleFs} fill={T.headerFg} letterSpacing={sig ? 0.4 : 0}>
        {fit(titleText, inner.x + inner.w - textX - numW - 6, titleFs * (T.titleUpper ? 1.12 : 1))}
      </text>
      <text x={textX} y={subY} fontFamily={tf('Bahnschrift')} fontWeight={600} fontSize={fitSize(subtitle, inner.x + inner.w - textX, subFs)} fill={T.headerSub}>{fit(subtitle, inner.x + inner.w - textX, fitSize(subtitle, inner.x + inner.w - textX, subFs) * 0.92)}</text>
      {numbers && (
        <g>
          <rect x={inner.x + inner.w - numW} y={pillY} width={numW} height={pillH} rx={pillH / 2} fill={light ? '#ffffff' : FIRE} />
          <PhoneGlyph x={inner.x + inner.w - numW + pillH * 0.32} y={pillY + pillH * 0.22} s={pillH * 0.56} color={light ? FIRE : '#ffffff'} />
          <text x={inner.x + inner.w - numW + pillH * 1.05} y={pillY + pillH / 2 + numFs * 0.36} fontFamily={tf('Bahnschrift')} fontWeight={600} fontSize={numFs} fill={light ? FIRE : '#ffffff'}>{fit(numbers, numW - pillH * 1.3, numFs * 0.92)}</text>
        </g>
      )}
    </g>
  );
}

function ScaleBar({ L, floor, page }: { L: PageLayout; floor: Floor; page: PageSetup }) {
  const mmPerMeter = L.k * floor.unitsPerMeter;
  const meters = niceScaleBarMeters(mmPerMeter);
  const len = meters * mmPerMeter;
  const bx = L.drawing.x + 4, by = L.drawing.y + L.drawing.h - 5;
  const ink = L.theme.ink;
  return (
    <g>
      <rect x={bx - 2} y={by - 6.2} width={len + 30} height={9.4} rx={1.2} fill="#fff" fillOpacity={0.9} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={bx + (len / 4) * i} y={by - 1.1} width={len / 4} height={1.5} fill={i % 2 ? '#fff' : ink} stroke={ink} strokeWidth={0.2} />
      ))}
      <text x={bx} y={by - 2.4} textAnchor="middle" fontFamily={FONT} fontSize={2.3} fill={ink}>0</text>
      <text x={bx + len} y={by - 2.4} textAnchor="middle" fontFamily={FONT} fontSize={2.3} fill={ink}>{meters} m</text>
      {L.scaleDenominator && (
        <text x={bx + len + 4} y={by + 0.7} fontFamily={tf('Bahnschrift')} fontSize={2.6} fill={ink}>
          {page.scaleMode === 'fixed' ? '' : '≈ '}1:{Math.round(L.scaleDenominator)}
        </text>
      )}
    </g>
  );
}

function North({ L, angle, ink }: { L: PageLayout; angle: number; ink: string }) {
  const cx = L.drawing.x + L.drawing.w - 10, cy = L.drawing.y + 11;
  return (
    <g transform={`rotate(${angle} ${cx} ${cy})`}>
      <circle cx={cx} cy={cy} r={6.2} fill="#fff" stroke={ink} strokeWidth={0.3} />
      <path d={`M ${cx} ${cy - 5} L ${cx + 2.4} ${cy + 3.4} L ${cx} ${cy + 2} L ${cx - 2.4} ${cy + 3.4} Z`} fill={ink} />
      <text x={cx} y={cy - 6.8} textAnchor="middle" fontFamily={tf('Bahnschrift')} fontWeight={700} fontSize={2.8} fill={ink}>N</text>
    </g>
  );
}

function Card({ x, y, w, h, T, title, accent, index, framed, grads, children }: {
  x: number; y: number; w: number; h: number; T: PageLayout['theme']; title: string; accent: string; index?: number;
  framed: boolean; grads: Grads | null; children?: React.ReactNode;
}) {
  const style = T.cardStyle ?? 'bar';
  const stroke = frameStroke(T, accent, 'legend');
  const border = framed ? stroke.color : '';
  const sw = stroke.w;
  const label = T.titleUpper ? title.toUpperCase() : title;
  const frame = <rect x={x} y={y} width={w} height={h} rx={T.cardRadius} fill={themeColor(T.cardBg, accent) || '#ffffff'} stroke={border || 'none'} strokeWidth={sw} />;
  if (style === 'pill') {
    // Horizon : carte teintée, titre dans une pastille d'accent
    const tw = Math.min(w - 6, label.length * 1.85 + 7.5);
    return (
      <g>
        {frame}
        {grads
          ? <GradShape g={grads} kind="accent" x={x + 3} y={y + 2.5} w={tw} h={5.4} rx={2.7} />
          : <rect x={x + 3} y={y + 2.5} width={tw} height={5.4} rx={2.7} fill={accent} />}
        <circle cx={x + 5.9} cy={y + 5.2} r={0.75} fill="#fff" />
        <text x={x + 7.6} y={y + 6.25} fontFamily={tf('Bahnschrift')} fontSize={3.1} fontWeight={600} fill="#fff" letterSpacing={0.15}>{fit(label, tw - 6.5, 3.1)}</text>
        {children}
      </g>
    );
  }
  if (style === 'index') {
    // Éditorial : filet épais, numéro de rubrique en accent, titre espacé en capitales
    const num = String(index ?? 1).padStart(2, '0');
    return (
      <g>
        {frame}
        <rect x={x} y={y} width={w} height={0.9} fill={T.ink} />
        <text x={x} y={y + 6.6} fontFamily={tf('Bahnschrift')} fontSize={3.6} fontWeight={700} fill={accent}>{num}</text>
        <text x={x + 7.4} y={y + 6.6} fontFamily={tf('Bahnschrift')} fontSize={3} fontWeight={700} fill={T.ink} letterSpacing={0.55}>{fit(label.toUpperCase(), w - 8, 3.3)}</text>
        {children}
      </g>
    );
  }
  if (style === 'header') {
    // Bandeau de titre plein en haut du cadre
    const head = themeColor(T.cardHead, accent) || accent;
    const r = T.cardRadius;
    return (
      <g>
        {frame}
        <path d={`M ${x} ${y + 7.8} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + 7.8} Z`} fill={head} />
        <line x1={x} y1={y + 7.8} x2={x + w} y2={y + 7.8} stroke={border || head} strokeWidth={sw} />
        <rect x={x} y={y} width={w} height={h} rx={r} fill="none" stroke={border || 'none'} strokeWidth={sw} />
        <text x={x + 3} y={y + 5.4} fontFamily={tf('Bahnschrift')} fontSize={3.4} fontWeight={600} fill={T.cardHeadFg || '#fff'} letterSpacing={0.3}>{fit(label, w - 6, 3.4)}</text>
        {children}
      </g>
    );
  }
  if (style === 'tab') {
    // Onglet posé à cheval sur le cadre
    const tw = Math.min(w - 6, label.length * 2.05 + 6);
    return (
      <g>
        {frame}
        <rect x={x + 3} y={y - 2.3} width={tw} height={5.2} rx={1} fill={border || accent} />
        <text x={x + 6} y={y + 1.35} fontFamily={tf('Bahnschrift')} fontSize={3.2} fontWeight={700} fill="#fff" letterSpacing={0.3}>{fit(label, tw - 5, 3.2)}</text>
        {children}
      </g>
    );
  }
  const epure = style === 'line';
  const inset = epure && framed ? 3 : 0;   // titre décollé du cadre quand l'utilisateur en ajoute un
  return (
    <g>
      {frame}
      {epure
        ? <line x1={x + inset} y1={y + 7.6} x2={x + w - inset} y2={y + 7.6} stroke="#d4dae0" strokeWidth={0.25} />
        : <rect x={x + 3} y={y + 3} width={1.1} height={4.2} rx={0.5} fill={accent} />}
      <text x={x + (epure ? inset : 5.6)} y={y + 6.3} fontFamily={tf('Bahnschrift')} fontSize={3.7} fontWeight={600} fill={T.ink} letterSpacing={0.2}>
        {label}
      </text>
      {children}
    </g>
  );
}

function Side({ L, page, floor, variantId, customSymbols, accent, numbersInHeader, grads }: {
  L: PageLayout; page: PageSetup; floor: Floor; variantId: string; customSymbols: CustomSymbol[]; accent: string; numbersInHeader: boolean; grads: Grads | null;
}) {
  const S = L.side!;
  const T = L.theme;
  const G = T.gap;
  const vertical = S.h > S.w;
  const tb = floor.titleBlock;
  const ids = usedSymbolIds(floor, variantId);
  const routes = floor.elements.filter((e): e is RouteElement => e.type === 'route' && (!e.variantId || e.variantId === variantId));
  const kinds = Array.from(new Set(routes.map((r) => r.kind)));
  const showNums = page.showEmergencyNumbers && !numbersInHeader && !!tb.emergencyNumbers;

  // Répartition des cartes
  const cards: { key: string; weight: number }[] = [];
  if (page.showLegend) cards.push({ key: 'legend', weight: 1 });
  if (page.showInstructions && tb.instructions.trim()) cards.push({ key: 'instr', weight: 1 });
  // Hauteur du cadre des numéros d'urgence en colonne : assez pour toutes les lignes (jamais de numéro coupé).
  const numsH = showNums ? Math.max(19, 13.1 + emergencyLines(tb.emergencyNumbers, S.w - 6, Infinity).lines.length * 3.9) : 0;
  const extras: string[] = [];
  if (page.showAerial) extras.push('aerial');
  if (page.showSketch) extras.push('sketch');
  const nodes: React.ReactNode[] = [];
  let cardNo = 0;                       // numéro de rubrique (thème Éditorial)
  const items = ids.length + kinds.length;
  // Une colonne si la légende tient (libellés complets) ; sinon deux colonnes, libellés sur deux lignes.
  let rowH = 6.6;
  let legendCols = 1;

  const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
  if (vertical) {
    // Cadres de hauteur fixe (vue aérienne, croquis) en bas de colonne, au-dessus des numéros d'urgence.
    // Vue aérienne et croquis côte à côte (une seule rangée) pour laisser la place à la légende et aux consignes.
    const ew = extras.length === 2 ? (S.w - G) / 2 : S.w;
    const extraH = extras.length ? Math.min(ew * (extras.length === 2 ? 0.95 : 0.62), (S.h - numsH) * (cards.length ? 0.26 : 0.45)) : 0;
    const ey = S.y + S.h - numsH - (showNums ? G : 0) - extraH;
    extras.forEach((k, i) => { rects[k] = { x: S.x + i * (ew + G), y: ey, w: ew, h: extraH }; });
    const avail = S.h - numsH - (showNums ? G : 0) - (extras.length ? extraH + G : 0);
    const maxLegend = avail * (cards.length === 2 ? 0.6 : 1);
    if (11 + items * rowH > maxLegend) { legendCols = 2; rowH = 7.6; }
    const legendNeed = 11 + Math.ceil(items / legendCols) * rowH + 1;
    if (cards.length === 2) {
      const lh = Math.min(legendNeed, maxLegend);
      Object.assign(rects, { legend: { x: S.x, y: S.y, w: S.w, h: lh }, instr: { x: S.x, y: S.y + lh + G, w: S.w, h: avail - lh - G } });
    } else if (cards[0]) rects[cards[0].key] = { x: S.x, y: S.y, w: S.w, h: avail };
    if (showNums) rects.nums = { x: S.x, y: S.y + S.h - numsH, w: S.w, h: numsH };
  } else {
    const n = cards.length + (showNums ? 1 : 0);
    const numsW = showNums ? Math.min(60, S.w * 0.22) : 0;
    // Vue aérienne et croquis empilés dans une seule colonne.
    const extraW = extras.length ? Math.min(S.h * (extras.length === 2 ? 0.75 : 1.4), S.w * (cards.length ? 0.2 : 0.45)) : 0;
    const rest = S.w - numsW - (showNums ? G : 0) - (extras.length ? extraW + G : 0);
    let x = S.x;
    const eh = extras.length === 2 ? (S.h - G) / 2 : S.h;
    extras.forEach((k, i) => { rects[k] = { x: S.x + rest + G, y: S.y + i * (eh + G), w: extraW, h: eh }; });
    cards.forEach((c, i) => {
      // Légende un peu plus large (libellés sur deux colonnes) ; les consignes ont la hauteur pour passer à la ligne.
      const w = cards.length === 2 ? (i === 0 ? rest * 0.56 - G / 2 : rest * 0.44 - G / 2) : rest;
      rects[c.key] = { x, y: S.y, w, h: S.h };
      x += w + G;
    });
    if (showNums) rects.nums = { x: S.x + S.w - numsW, y: S.y, w: numsW, h: S.h };
    void n;
  }

  if (rects.legend) {
    const r = rects.legend;
    if (!vertical) {
      // Bandeau du bas : autant de colonnes que nécessaire pour tout afficher.
      rowH = 7;
      const perColH = Math.max(1, Math.floor((r.h - 11) / rowH));
      legendCols = Math.max(1, Math.min(3, Math.ceil(items / perColH)));
    }
    const cols = legendCols;
    const perCol = Math.max(1, Math.floor((r.h - 11) / rowH));
    const colW = (r.w - 6) / cols;
    const fs = cols === 1 ? 2.9 : 2.6;
    const label = (text: string) => {
      const maxW = colW - 12;
      const lines = wrapText(text, maxW, fs);
      if (lines.length <= 1) return <text x={11} y={1.05} fontFamily={FONT} fontSize={fs} fill={T.ink}>{text}</text>;
      return (
        <text x={11} y={-0.35} fontFamily={FONT} fontSize={fs} fill={T.ink}>
          <tspan x={11}>{lines[0]}</tspan>
          <tspan x={11} dy={fs * 1.15}>{fit(lines.slice(1).join(' '), maxW, fs)}</tspan>
        </text>
      );
    };
    const entries: React.ReactNode[] = [];
    kinds.forEach((k) => {
      const s = routes.find((x) => x.kind === k)!;
      entries.push(
        <g key={`r-${k}`}>
          <line x1={0} y1={0} x2={6.6} y2={0} stroke={s.color} strokeWidth={1.4} strokeDasharray={s.dash !== 'solid' ? '1.6 1' : undefined} />
          <polygon points="8.4,0 6,-1.7 6,1.7" fill={s.color} />
          {label(k === 'principal' ? 'Itinéraire d’évacuation' : 'Itinéraire secondaire')}
        </g>,
      );
    });
    ids.forEach((id) => entries.push(
      <g key={id}>
        <g transform="translate(3.6 0)"><SymbolGraphic symbolId={id} size={6.2} custom={customSymbols} /></g>
        {label(symbolName(id, customSymbols))}
      </g>,
    ));
    nodes.push(
      <Card key="legend" {...r} T={T} index={++cardNo} framed={frameOn(page, 'legend')} grads={grads} title="Légende" accent={accent}>
        {entries.slice(0, perCol * cols).map((node, i) => {
          const c = Math.floor(i / perCol), row = i % perCol;
          return <g key={i} transform={`translate(${r.x + 3 + c * colW} ${r.y + 11.5 + row * rowH + rowH / 2 - 1})`}>{node}</g>;
        })}
        {entries.length > perCol * cols && (
          <text x={r.x + r.w - 2} y={r.y + r.h - 1.6} textAnchor="end" fontFamily={FONT} fontSize={2.1} fill={FIRE}>(+{entries.length - perCol * cols} non affichés)</text>
        )}
      </Card>,
    );
  }

  if (rects.instr) {
    const r = rects.instr;
    const fs = 2.75;
    const lh = fs * 1.38;
    const lines = wrapText(tb.instructions, r.w - 12, fs);
    let y = r.y + 12;
    const out: React.ReactNode[] = [];
    let i = 0;
    for (const ln of lines) {
      if (y > r.y + r.h - 2.5) { out.push(<text key="more" x={r.x + r.w - 2} y={r.y + r.h - 1.4} textAnchor="end" fontFamily={FONT} fontSize={2.1} fill={FIRE}>(texte tronqué)</text>); break; }
      const heading = ln.length > 3 && ln === ln.toUpperCase() && /[A-ZÀ-Ý]/.test(ln);
      const num = ln.match(/^(\d+)[.)]\s+(.*)$/);
      if (!ln.trim()) { y += lh * 0.5; continue; }
      if (heading) {
        const fire = /INCENDIE|FEU/.test(ln), evac = /ÉVACU|EVACU/.test(ln);
        const c = fire ? FIRE : evac ? accent : T.ink;
        const hw = Math.min(r.w - 6, ln.length * fs * 0.62 + 5), hh = fs * 1.55, hr = T.cardRadius ? fs * 0.75 : 0;
        out.push(
          <g key={i++}>
            {grads
              // Horizon : rouge incendie et vert évacuation en dégradé, avec reflets ronds
              ? <GradShape g={grads} kind={fire ? 'fire' : evac ? 'evac' : 'ink'} x={r.x + 3} y={y - fs * 0.95} w={hw} h={hh} rx={hr} />
              : <rect x={r.x + 3} y={y - fs * 0.95} width={hw} height={hh} rx={hr} fill={c} />}
            <text x={r.x + 5.3} y={y + fs * 0.12} fontFamily={tf('Bahnschrift')} fontSize={fs * 0.92} fontWeight={600} fill="#fff" letterSpacing={0.25}>{ln}</text>
          </g>,
        );
        y += lh * 1.5;
      } else if (num) {
        out.push(
          <g key={i++}>
            <circle cx={r.x + 5} cy={y - fs * 0.33} r={fs * 0.62} fill="none" stroke={T.muted} strokeWidth={0.22} />
            <text x={r.x + 5} y={y - fs * 0.06} textAnchor="middle" fontFamily={FONT} fontSize={fs * 0.72} fontWeight={700} fill={T.ink}>{num[1]}</text>
            <text x={r.x + 7.6} y={y} fontFamily={FONT} fontSize={fs} fill={T.ink}>{num[2]}</text>
          </g>,
        );
        y += lh;
      } else {
        out.push(<text key={i++} x={r.x + 7.6} y={y} fontFamily={FONT} fontSize={fs} fill={T.ink}>{ln}</text>);
        y += lh;
      }
    }
    nodes.push(<Card key="instr" {...r} T={T} index={++cardNo} framed={frameOn(page, 'instructions')} grads={grads} title="Consignes" accent={accent}>{out}</Card>);
  }

  if (rects.aerial) {
    const r = rects.aerial;
    const ix = r.x + 2, iy = r.y + 10, iw = r.w - 4, ih = r.h - 12;
    const cid = `aerial-${Math.round(r.x * 10)}-${Math.round(r.y * 10)}`;
    nodes.push(
      <Card key="aerial" {...r} T={T} index={++cardNo} framed={frameOn(page, 'aerial')} grads={grads} title={r.w < 60 ? "Vue aérienne" : "Vue aérienne du site"} accent={accent}>
        {tb.aerialImage ? (
          <g>
            <defs><clipPath id={cid}><rect x={ix} y={iy} width={iw} height={ih} rx={Math.min(1, T.cardRadius)} /></clipPath></defs>
            <image href={tb.aerialImage} x={ix} y={iy} width={iw} height={ih} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${cid})`} />
          </g>
        ) : (
          <g>
            <rect x={ix} y={iy} width={iw} height={ih} rx={1} fill="#f4f6f8" stroke={T.muted} strokeWidth={0.25} strokeDasharray="1.2 0.9" />
            <text x={ix + iw / 2} y={iy + ih / 2 - 0.6} textAnchor="middle" fontFamily={FONT} fontSize={2.5} fill={T.muted}>Insérez une vue du ciel</text>
            <text x={ix + iw / 2} y={iy + ih / 2 + 2.8} textAnchor="middle" fontFamily={FONT} fontSize={2} fill={T.muted}>(Propriétés › Cartouche)</text>
          </g>
        )}
      </Card>,
    );
  }

  if (rects.sketch) {
    const r = rects.sketch;
    nodes.push(
      <Card key="sketch" {...r} T={T} index={++cardNo} framed={frameOn(page, 'sketch')} grads={grads} title={r.w < 60 ? "Situation" : "Plan de situation"} accent={accent}>
        <SiteSketch floor={floor} variantId={variantId} page={page} x={r.x + 2} y={r.y + 10} w={r.w - 4} h={r.h - 12} accent={accent} ink={T.ink} />
      </Card>,
    );
  }

  if (rects.nums) {
    const r = rects.nums;
    const E = emergencyLines(tb.emergencyNumbers, r.w - 6, r.h - 13.1);
    nodes.push(
      <g key="nums">
        {grads
          ? <GradShape g={grads} kind="fire" x={r.x} y={r.y} w={r.w} h={r.h} rx={T.cardRadius} />
          : <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={T.cardRadius} fill={FIRE} />}
        <PhoneGlyph x={r.x + 3} y={r.y + 3} s={5} color="#fff" />
        <text x={r.x + 10} y={r.y + 6.6} fontFamily={tf('Bahnschrift')} fontSize={3.2} fontWeight={600} fill="#fff">{T.titleUpper ? 'NUMÉROS D’URGENCE' : 'Numéros d’urgence'}</text>
        {E.lines.map((ln, i) => (
          <text key={i} x={r.x + 3} y={r.y + 11.6 + i * E.lh} fontFamily={tf('Bahnschrift')} fontSize={E.fs} fontWeight={E.perEntry ? 600 : 400} fill="#fff">{ln}</text>
        ))}
      </g>,
    );
  }
  return <g>{nodes}</g>;
}

/**
 * Lignes du cadre « Numéros d'urgence » : un numéro par ligne si la place le permet, sinon à la suite,
 * en réduisant la police au besoin. Aucune ligne n'est jamais supprimée (un numéro manquant serait dangereux).
 */
function emergencyLines(text: string, widthMm: number, maxH: number): { lines: string[]; fs: number; lh: number; perEntry: boolean } {
  const parts = text.split(/\s*[·|]\s*/).filter(Boolean);
  const fits = (n: number, lh: number) => (n - 1) * lh <= maxH;
  for (const fs of [3, 2.7, 2.4]) {
    const lh = fs * 1.3;
    const each = parts.flatMap((p) => wrapText(p, widthMm, fs));
    if (fits(each.length, lh)) return { lines: each, fs, lh, perEntry: true };
    const joined = wrapText(parts.join(' · '), widthMm, fs);
    if (fits(joined.length, lh)) return { lines: joined, fs, lh, perEntry: false };
  }
  return { lines: wrapText(parts.join(' · '), widthMm, 2.4), fs: 2.4, lh: 3.1, perEntry: false };
}

/**
 * Croquis de situation : miniature simplifiée de tout l'étage (murs, pièces, itinéraires)
 * avec le repère « Vous êtes ici » et, si la page n'imprime qu'une partie du plan, la zone imprimée.
 */
export function SiteSketch({ floor, variantId, page, x, y, w, h, accent, ink }: {
  floor: Floor; variantId: string; page: PageSetup; x: number; y: number; w: number; h: number; accent: string; ink: string;
}) {
  const visible = new Set(floor.layers.filter((l) => l.visible).map((l) => l.id));
  const els = floor.elements.filter((e) => visible.has(e.layer) && isVisibleInVariant(e, variantId));
  const walls = els.filter((e): e is WallElement => e.type === 'wall' && e.points.length > 1);
  const areas = els.filter((e): e is AreaElement => e.type === 'area' && e.points.length > 2);
  const routes = els.filter((e): e is RouteElement => e.type === 'route' && e.points.length > 1);
  const here = els.filter((e): e is SymbolElement => e.type === 'symbol' && e.symbolId.startsWith('you-are-here'));
  const b = floorContentBounds({ ...floor, background: null }, variantId);
  if (!(b.w > 0 && b.h > 0) || (!walls.length && !areas.length)) {
    return <text x={x + w / 2} y={y + h / 2} textAnchor="middle" fontFamily={FONT} fontSize={2.3} fill="#8a96a2">Dessinez murs et pièces pour obtenir le croquis</text>;
  }
  const k = Math.min(w / b.w, h / b.h) * 0.94;
  const ox = x + (w - b.w * k) / 2 - b.x * k, oy = y + (h - b.h * k) / 2 - b.y * k;
  const P = (pts: [number, number][]) => pts.map((p) => `${(ox + p[0] * k).toFixed(2)},${(oy + p[1] * k).toFixed(2)}`).join(' ');
  const area = page.area === 'custom' && page.customArea.w > 0 ? page.customArea : null;
  return (
    <g>
      {areas.map((a) => <polygon key={a.id} points={P(a.points)} fill={a.kind === 'zone' ? '#fde7e4' : '#eef1f4'} stroke="#c3cbd3" strokeWidth={0.12} />)}
      {walls.map((wl) => (
        <polyline key={wl.id} points={P(wl.closed ? [...wl.points, wl.points[0]] : wl.points)} fill="none" stroke={ink}
          strokeWidth={Math.max(0.25, Math.min(0.9, wl.thickness * k))} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {routes.map((rt) => <polyline key={rt.id} points={P(rt.points)} fill="none" stroke={rt.color || accent} strokeWidth={0.45} strokeLinejoin="round" strokeLinecap="round" />)}
      {area && (
        <rect x={ox + area.x * k} y={oy + area.y * k} width={area.w * k} height={area.h * k} fill="none" stroke={accent} strokeWidth={0.35} strokeDasharray="1 0.6" />
      )}
      {here.map((s) => (
        <g key={s.id}>
          <circle cx={ox + s.x * k} cy={oy + s.y * k} r={2.2} fill={FIRE} fillOpacity={0.2} />
          <circle cx={ox + s.x * k} cy={oy + s.y * k} r={1.1} fill={FIRE} stroke="#fff" strokeWidth={0.3} />
        </g>
      ))}
      {here.length > 0 && <text x={x + w} y={y + h - 0.4} textAnchor="end" fontFamily={FONT} fontSize={2} fill={FIRE}>● Vous êtes ici</text>}
    </g>
  );
}

function Footer({ L, page, floor, building, accent }: { L: PageLayout; page: PageSetup; floor: Floor; building: Building; accent: string }) {
  const F = L.footer!;
  const T = L.theme;
  const tb = floor.titleBlock;
  const status = tb.status;
  const statusText = status === 'validated' ? `Validé par ${tb.validatedBy} le ${formatDate(tb.validatedAt)}` : STATUS_LABEL[status];
  const author = [tb.author, tb.organization].filter(Boolean).join(' — ') || '—';
  const disclaimer = 'La validation est une décision interne de l’auteur ou du responsable ; elle ne constitue pas une certification de conformité.';
  const cells: [string, string, number][] = [
    ['Établi par', author, 0.27], ['Date', formatDate(tb.date) || '—', 0.11], ['Version', tb.version || '—', 0.08],
    ['Statut', statusText, 0.3], ['Bâtiment / étage', `${building.name} — ${floor.name}`, 0.24],
  ];

  if (T.footer === 'line') {
    const txt = [author, formatDate(tb.date), tb.version ? `v${tb.version}` : '', `${building.name} — ${floor.name}`].filter(Boolean).join('   ·   ');
    return (
      <g>
        <line x1={F.x} y1={F.y} x2={F.x + F.w} y2={F.y} stroke="#d4dae0" strokeWidth={0.25} />
        <circle cx={F.x + 1.2} cy={F.y + 4.3} r={1.1} fill={STATUS_COLOR[status]} />
        <text x={F.x + 3.6} y={F.y + 5.2} fontFamily={FONT} fontSize={2.8} fontWeight={600} fill={STATUS_COLOR[status]}>{fit(statusText, 60, 2.8)}</text>
        <text x={F.x + 64} y={F.y + 5.2} fontFamily={FONT} fontSize={2.6} fill={T.muted}>{fit(txt, F.w - 64, 2.6)}</text>
        <text x={F.x + F.w} y={F.y + F.h - 0.3} textAnchor="end" fontFamily={FONT} fontSize={1.8} fill="#a3adb7">{disclaimer}</text>
      </g>
    );
  }

  if (T.footer === 'capsule') {
    // Horizon : capsule teintée, cellules séparées par des filets blancs
    const ch = F.h - 3.4;
    const pad = ch / 2;
    let x = F.x + pad;
    return (
      <g>
        <rect x={F.x} y={F.y} width={F.w} height={ch} rx={ch / 2} fill={themeColor('tint', accent)}
          stroke={frameOn(page, 'footer') ? frameStroke(T, accent, 'footer').color : 'none'} strokeWidth={frameStroke(T, accent, 'footer').w} />
        {cells.map(([label, value, frac], i) => {
          const w = (F.w - 2 * pad) * frac;
          const isStatus = label === 'Statut';
          const cx = x + (i ? 3 : 0);
          const node = (
            <g key={i}>
              {i > 0 && <line x1={x} y1={F.y + 1.8} x2={x} y2={F.y + ch - 1.8} stroke="#ffffff" strokeWidth={0.6} />}
              <text x={cx} y={F.y + 3.7} fontFamily={FONT} fontSize={1.9} fill={T.muted} letterSpacing={0.3}>{label.toUpperCase()}</text>
              {isStatus ? (
                <g>
                  <circle cx={cx + 1} cy={F.y + 6.6} r={0.95} fill={STATUS_COLOR[status]} />
                  <text x={cx + 2.9} y={F.y + 7.6} fontFamily={tf('Bahnschrift')} fontSize={2.8} fontWeight={600} fill={STATUS_COLOR[status]}>{fit(statusText, w - 7, 2.8)}</text>
                </g>
              ) : (
                <text x={cx} y={F.y + 7.6} fontFamily={tf('Bahnschrift')} fontSize={2.9} fontWeight={600} fill={T.ink}>{fit(value, w - 4, 2.9)}</text>
              )}
            </g>
          );
          x += w;
          return node;
        })}
        <text x={F.x + pad} y={F.y + F.h - 0.3} fontFamily={FONT} fontSize={1.8} fill="#9aa6b3">{disclaimer}</text>
      </g>
    );
  }

  if (T.footer === 'rule') {
    // Éditorial : filet épais, intitulés en accent, valeurs noires
    let x = F.x;
    return (
      <g>
        <rect x={F.x} y={F.y} width={F.w} height={0.9} fill={T.ink} />
        {cells.map(([label, value, frac], i) => {
          const w = F.w * frac;
          const isStatus = label === 'Statut';
          const node = (
            <g key={i}>
              <text x={x} y={F.y + 4.3} fontFamily={tf('Bahnschrift')} fontSize={1.95} fontWeight={700} fill={accent} letterSpacing={0.4}>{label.toUpperCase()}</text>
              <text x={x} y={F.y + 8.1} fontFamily={tf('Bahnschrift')} fontSize={3} fontWeight={600} fill={isStatus ? STATUS_COLOR[status] : T.ink}>
                {fit((isStatus ? '● ' + statusText : value), w - 3, 3)}
              </text>
            </g>
          );
          x += w;
          return node;
        })}
        <text x={F.x} y={F.y + F.h - 0.3} fontFamily={FONT} fontSize={1.8} fill={T.muted}>{disclaimer}</text>
      </g>
    );
  }

  if (T.footer === 'band') {
    let x = F.x + 4;
    return (
      <g>
        <rect x={F.x} y={F.y} width={F.w} height={F.h - 2.4} rx={T.cardRadius} fill="#0f1b2a" />
        {cells.map(([label, value, frac], i) => {
          const w = (F.w - 8) * frac;
          const node = (
            <g key={i}>
              <text x={x} y={F.y + 3.1} fontFamily={FONT} fontSize={1.9} fill="#8fa2b6" letterSpacing={0.2}>{label.toUpperCase()}</text>
              <text x={x} y={F.y + 6.3} fontFamily={tf('Bahnschrift')} fontSize={2.9} fontWeight={600} fill={label === 'Statut' ? (status === 'validated' ? '#5fd58f' : '#ffb547') : '#fff'}>{fit(value, w - 2, 2.9)}</text>
            </g>
          );
          x += w;
          return node;
        })}
        <text x={F.x} y={F.y + F.h - 0.2} fontFamily={FONT} fontSize={1.8} fill="#8a96a2">{disclaimer}</text>
      </g>
    );
  }

  if (T.footer === 'table') {
    let x = F.x;
    return (
      <g>
        <rect x={F.x} y={F.y} width={F.w} height={F.h - 3} fill="#fff" stroke={frameOn(page, 'footer') ? '#111' : 'none'} strokeWidth={0.35} />
        {cells.map(([label, value, frac], i) => {
          const w = F.w * frac;
          const node = (
            <g key={i}>
              {i > 0 && <line x1={x} y1={F.y} x2={x} y2={F.y + F.h - 3} stroke="#111" strokeWidth={0.25} />}
              <line x1={x} y1={F.y + 4.6} x2={x + w} y2={F.y + 4.6} stroke="#111" strokeWidth={0.15} />
              <text x={x + 1.6} y={F.y + 3.3} fontFamily={FONT} fontSize={2.1} fill="#444" letterSpacing={0.2}>{label.toUpperCase()}</text>
              <text x={x + 1.6} y={F.y + 10} fontFamily={FONT} fontSize={3.1} fontWeight={600} fill={label === 'Statut' && status !== 'validated' ? FIRE : '#111'}>{fit(value, w - 3, 3.1)}</text>
            </g>
          );
          x += w;
          return node;
        })}
        <text x={F.x} y={F.y + F.h - 0.4} fontFamily={FONT} fontSize={1.9} fill="#666">{disclaimer}</text>
      </g>
    );
  }

  // Moderne : cellules légères séparées par des filets
  let x = F.x;
  return (
    <g>
      {cells.map(([label, value, frac], i) => {
        const w = F.w * frac;
        const isStatus = label === 'Statut';
        const node = (
          <g key={i}>
            {i > 0 && <line x1={x} y1={F.y + 0.6} x2={x} y2={F.y + 7.4} stroke={T.cardBorder} strokeWidth={0.3} />}
            <text x={x + (i ? 3 : 0)} y={F.y + 2.7} fontFamily={FONT} fontSize={1.95} fill={T.muted} letterSpacing={0.25}>{label.toUpperCase()}</text>
            {isStatus ? (
              <g>
                <rect x={x + 3} y={F.y + 3.6} width={Math.min(w - 5, statusText.length * 1.5 + 6)} height={4.2} rx={2.1} fill={STATUS_COLOR[status]} fillOpacity={0.14} />
                <circle cx={x + 5.2} cy={F.y + 5.7} r={0.9} fill={STATUS_COLOR[status]} />
                <text x={x + 7} y={F.y + 6.75} fontFamily={FONT} fontSize={2.7} fontWeight={600} fill={STATUS_COLOR[status]}>{fit(statusText, w - 10, 2.7)}</text>
              </g>
            ) : (
              <text x={x + (i ? 3 : 0)} y={F.y + 6.8} fontFamily={tf('Bahnschrift')} fontSize={3} fontWeight={600} fill={T.ink}>{fit(value, w - 4, 3)}</text>
            )}
          </g>
        );
        x += w;
        return node;
      })}
      <text x={F.x} y={F.y + F.h - 0.3} fontFamily={FONT} fontSize={1.8} fill="#a3adb7">{disclaimer}</text>
      <rect x={F.x + F.w - 14} y={F.y + F.h - 2} width={14} height={0.8} rx={0.4} fill={accent} />
    </g>
  );
}

export function renderPageSvg(props: PrintPageProps): string {
  return renderToStaticMarkup(<PrintPage {...props} />);
}
