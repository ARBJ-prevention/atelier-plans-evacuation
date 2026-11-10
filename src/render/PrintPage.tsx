import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { usedSymbolIds } from '../model/geometry';
import type { Building, CustomSymbol, Floor, PageSetup, RouteElement, ValidationStatus } from '../model/types';
import { FONT, symbolName, SymbolGraphic } from './ElementView';
import { FloorDrawing } from './FloorDrawing';
import { computeLayout, niceScaleBarMeters, wrapText, type PageLayout } from './layout';

export const STATUS_LABEL: Record<ValidationStatus, string> = {
  draft: 'Brouillon',
  to_validate: 'À valider',
  validated: 'Validé',
};
const STATUS_COLOR: Record<ValidationStatus, string> = { draft: '#6b7a89', to_validate: '#c27400', validated: '#00843d' };
const FIRE = '#d52b1e';

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
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
  const subtitle = [building.name, floor.name, floor.variants.length > 1 ? variant?.name : '', tb.subtitle || building.address].filter(Boolean).join('  ·  ');
  const numbersInHeader = page.showEmergencyNumbers && !!tb.emergencyNumbers && (page.theme === 'moderne' || page.theme === 'signaletique' || page.theme === 'epure');

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={`${L.w}mm`} height={`${L.h}mm`} viewBox={`0 0 ${L.w} ${L.h}`}>
      <rect x={0} y={0} width={L.w} height={L.h} fill="#ffffff" />
      <defs>
        <clipPath id={clipId}><rect x={L.drawing.x} y={L.drawing.y} width={L.drawing.w} height={L.drawing.h} rx={T.planRadius} /></clipPath>
      </defs>
      {T.frame !== 'none' && page.showFrame && <Frame L={L} m={page.marginMm} double={T.frame === 'double'} />}
      {L.header && <Header L={L} page={page} accent={accent} title={tb.title || 'Plan d’évacuation'} subtitle={subtitle} logo={tb.logo}
        numbers={numbersInHeader ? tb.emergencyNumbers : ''} version={tb.version} />}

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
      {page.theme !== 'epure' && (
        <rect x={L.drawing.x} y={L.drawing.y} width={L.drawing.w} height={L.drawing.h} rx={T.planRadius} fill="none"
          stroke={page.theme === 'moderne' ? T.cardBorder : T.ink} strokeWidth={page.theme === 'moderne' ? 0.3 : page.theme === 'institutionnel' ? 0.35 : 0.5} />
      )}
      {page.showScaleBar && floor.unitsPerMeter > 0 && <ScaleBar L={L} floor={floor} page={page} />}
      {page.showNorth && <North L={L} angle={page.northAngle} ink={T.ink} />}

      {L.side && <Side L={L} page={page} floor={floor} variantId={variantId} customSymbols={customSymbols} accent={accent} numbersInHeader={numbersInHeader} />}
      {L.footer && <Footer L={L} page={page} floor={floor} building={building} accent={accent} />}
    </svg>
  );
}

function Frame({ L, m, double }: { L: PageLayout; m: number; double: boolean }) {
  return (
    <g fill="none" stroke="#111">
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

function Header({ L, page, accent, title, subtitle, logo, numbers, version }: {
  L: PageLayout; page: PageSetup; accent: string; title: string; subtitle: string; logo: string; numbers: string; version: string;
}) {
  const H = L.header!;
  const T = L.theme;
  const m = page.marginMm;
  const bg = T.headerBg === 'accent' ? accent : T.headerBg;
  const inner = T.fullBleedHeader ? { x: m, w: L.w - 2 * m, top: m * 0.6 } : { x: H.x, w: H.w, top: 0 };
  const logoW = logo ? 30 : 0;
  const tx = inner.x + (logo ? logoW + 4 : 0);
  const titleText = T.titleUpper ? title.toUpperCase() : title;
  const numW = numbers ? Math.min(inner.w * 0.55, numbers.length * 2 + 16) : 0;

  if (page.theme === 'institutionnel') {
    return (
      <g>
        {logo && <image href={logo} x={H.x + 2} y={H.y + 2} width={logoW} height={H.h - 4} preserveAspectRatio="xMinYMid meet" />}
        <text x={H.x + H.w / 2} y={H.y + 8} textAnchor="middle" fontFamily={tf(T.titleFont)} fontWeight={T.titleWeight} fontSize={6.4} fill={T.headerFg} letterSpacing={0.6}>{titleText}</text>
        <text x={H.x + H.w / 2} y={H.y + 13.5} textAnchor="middle" fontFamily={FONT} fontSize={3.3} fill={T.headerSub}>{fit(subtitle, H.w - 70, 3.3)}</text>
        <rect x={H.x + H.w - 30} y={H.y + 1.5} width={30} height={H.h - 3} fill="none" stroke="#111" strokeWidth={0.3} />
        <text x={H.x + H.w - 15} y={H.y + 6.5} textAnchor="middle" fontFamily={FONT} fontSize={2.3} fill="#555">VERSION</text>
        <text x={H.x + H.w - 15} y={H.y + 12.5} textAnchor="middle" fontFamily={FONT} fontSize={5} fontWeight={700} fill="#111">{version || '—'}</text>
        <line x1={H.x} y1={H.y + H.h} x2={H.x + H.w} y2={H.y + H.h} stroke="#111" strokeWidth={0.5} />
      </g>
    );
  }
  if (page.theme === 'epure') {
    return (
      <g>
        {logo && <image href={logo} x={inner.x} y={H.y + 1} width={logoW} height={H.h - 4} preserveAspectRatio="xMinYMid meet" />}
        <text x={tx} y={H.y + 4} fontFamily={FONT} fontSize={2.4} fontWeight={700} fill={accent} letterSpacing={0.9}>PLAN D’ÉVACUATION</text>
        <text x={tx} y={H.y + 11.2} fontFamily={tf(T.titleFont)} fontWeight={T.titleWeight} fontSize={7.6} fill={T.headerFg}>{fit(titleText, inner.w - numW - logoW - 8, 6.2)}</text>
        <text x={tx} y={H.y + 15.6} fontFamily={FONT} fontSize={3} fill={T.headerSub}>{fit(subtitle, inner.w - numW - logoW - 8, 3)}</text>
        {numbers && (
          <g>
            <PhoneGlyph x={inner.x + inner.w - numW} y={H.y + 7.8} s={4.4} color={FIRE} />
            <text x={inner.x + inner.w} y={H.y + 11.2} textAnchor="end" fontFamily={tf('Bahnschrift')} fontWeight={600} fontSize={3.6} fill={FIRE}>{fit(numbers, numW - 6, 3.6)}</text>
          </g>
        )}
        <line x1={inner.x} y1={H.y + H.h} x2={inner.x + inner.w} y2={H.y + H.h} stroke="#d4dae0" strokeWidth={0.25} />
      </g>
    );
  }
  // Moderne & Signalétique : bandeau pleine largeur
  const sig = page.theme === 'signaletique';
  const cy = inner.top + (H.h - inner.top) / 2;
  return (
    <g>
      <rect x={0} y={0} width={L.w} height={H.h} fill={bg} />
      <rect x={0} y={H.h - 1.3} width={L.w} height={1.3} fill={sig ? '#0f1b2a' : accent} />
      {logo && <rect x={inner.x} y={cy - 7} width={logoW} height={14} rx={1.5} fill="#ffffff" />}
      {logo && <image href={logo} x={inner.x + 1.5} y={cy - 5.8} width={logoW - 3} height={11.6} preserveAspectRatio="xMidYMid meet" />}
      {sig && (
        <g>
          <rect x={tx} y={cy - 7.4} width={13} height={13} rx={1.2} fill="#ffffff" />
          <g transform={`translate(${tx + 6.5} ${cy - 0.9})`}><SymbolGraphic symbolId="iso-E002" size={11} custom={[]} /></g>
        </g>
      )}
      <text x={tx + (sig ? 16 : 0)} y={cy + 0.6} fontFamily={tf(T.titleFont)} fontWeight={T.titleWeight} fontSize={sig ? 7.6 : 7.4} fill={T.headerFg} letterSpacing={sig ? 0.5 : 0}>
        {fit(titleText, inner.w - numW - logoW - 26, 6)}
      </text>
      <text x={tx + (sig ? 16 : 0)} y={cy + 5.6} fontFamily={FONT} fontSize={3.1} fill={T.headerSub}>{fit(subtitle, inner.w - numW - logoW - 26, 3.1)}</text>
      {numbers && (
        <g>
          <rect x={inner.x + inner.w - numW} y={cy - 5} width={numW} height={10} rx={5} fill={sig ? '#ffffff' : FIRE} />
          <PhoneGlyph x={inner.x + inner.w - numW + 3.2} y={cy - 2.6} s={5.2} color={sig ? FIRE : '#ffffff'} />
          <text x={inner.x + inner.w - numW + 10} y={cy + 1.3} fontFamily={tf('Bahnschrift')} fontWeight={600} fontSize={3.4} fill={sig ? FIRE : '#ffffff'}>{fit(numbers, numW - 13, 3.4)}</text>
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

function Card({ x, y, w, h, T, title, accent, children }: { x: number; y: number; w: number; h: number; T: PageLayout['theme']; title: string; accent: string; children?: React.ReactNode }) {
  const epure = !T.cardBorder && T.cardBg === '#ffffff';
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={T.cardRadius} fill={T.cardBg} stroke={T.cardBorder || 'none'} strokeWidth={T.cardBorder === '#222222' ? 0.3 : T.cardBorder === '#0f1b2a' ? 0.45 : 0.25} />
      {epure
        ? <line x1={x} y1={y + 7.6} x2={x + w} y2={y + 7.6} stroke="#d4dae0" strokeWidth={0.25} />
        : <rect x={x + 3} y={y + 3} width={1.1} height={4.2} rx={0.5} fill={accent} />}
      <text x={x + (epure ? 0 : 5.6)} y={y + 6.3} fontFamily={tf('Bahnschrift')} fontSize={3.7} fontWeight={600} fill={T.ink} letterSpacing={0.2}>
        {T.titleUpper ? title.toUpperCase() : title}
      </text>
      {children}
    </g>
  );
}

function Side({ L, page, floor, variantId, customSymbols, accent, numbersInHeader }: {
  L: PageLayout; page: PageSetup; floor: Floor; variantId: string; customSymbols: CustomSymbol[]; accent: string; numbersInHeader: boolean;
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
  const numsH = showNums ? 19 : 0;
  const nodes: React.ReactNode[] = [];
  const items = ids.length + kinds.length;
  // Une colonne si la légende tient (libellés complets) ; sinon deux colonnes, libellés sur deux lignes.
  let rowH = 6.6;
  let legendCols = 1;

  let rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
  if (vertical) {
    const avail = S.h - numsH - (showNums ? G : 0);
    const maxLegend = avail * (cards.length === 2 ? 0.6 : 1);
    if (11 + items * rowH > maxLegend) { legendCols = 2; rowH = 7.6; }
    const legendNeed = 11 + Math.ceil(items / legendCols) * rowH + 1;
    if (cards.length === 2) {
      const lh = Math.min(legendNeed, maxLegend);
      rects = { legend: { x: S.x, y: S.y, w: S.w, h: lh }, instr: { x: S.x, y: S.y + lh + G, w: S.w, h: avail - lh - G } };
    } else if (cards[0]) rects[cards[0].key] = { x: S.x, y: S.y, w: S.w, h: avail };
    if (showNums) rects.nums = { x: S.x, y: S.y + S.h - numsH, w: S.w, h: numsH };
  } else {
    const n = cards.length + (showNums ? 1 : 0);
    const numsW = showNums ? Math.min(60, S.w * 0.22) : 0;
    const rest = S.w - numsW - (showNums ? G : 0);
    let x = S.x;
    cards.forEach((c, i) => {
      const w = cards.length === 2 ? (i === 0 ? rest * 0.5 - G / 2 : rest * 0.5 - G / 2) : rest;
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
      <Card key="legend" {...r} T={T} title="Légende" accent={accent}>
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
        const c = /INCENDIE|FEU/.test(ln) ? FIRE : /ÉVACU|EVACU/.test(ln) ? accent : T.ink;
        out.push(
          <g key={i++}>
            <rect x={r.x + 3} y={y - fs * 0.95} width={Math.min(r.w - 6, ln.length * fs * 0.62 + 5)} height={fs * 1.55} rx={T.cardRadius ? fs * 0.75 : 0} fill={c} />
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
    nodes.push(<Card key="instr" {...r} T={T} title="Consignes" accent={accent}>{out}</Card>);
  }

  if (rects.nums) {
    const r = rects.nums;
    const parts = tb.emergencyNumbers.split(/\s*[·|]\s*/).filter(Boolean);
    nodes.push(
      <g key="nums">
        <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={T.cardRadius} fill={FIRE} />
        <PhoneGlyph x={r.x + 3} y={r.y + 3} s={5} color="#fff" />
        <text x={r.x + 10} y={r.y + 6.6} fontFamily={tf('Bahnschrift')} fontSize={3.2} fontWeight={600} fill="#fff">{T.titleUpper ? 'NUMÉROS D’URGENCE' : 'Numéros d’urgence'}</text>
        {wrapText(parts.join(' · '), r.w - 6, 3).slice(0, 2).map((ln, i) => (
          <text key={i} x={r.x + 3} y={r.y + 11.6 + i * 3.9} fontFamily={tf('Bahnschrift')} fontSize={3} fill="#fff">{ln}</text>
        ))}
      </g>,
    );
  }
  return <g>{nodes}</g>;
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
        <rect x={F.x} y={F.y} width={F.w} height={F.h - 3} fill="#fff" stroke="#111" strokeWidth={0.35} />
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
