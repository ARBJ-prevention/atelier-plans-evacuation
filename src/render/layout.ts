import { floorContentBounds, type Rect } from '../model/geometry';
import type { Floor, PageSetup, PageTheme } from '../model/types';

export const PAPER_MM: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420], A2: [420, 594] };

export function pageSizeMm(page: PageSetup): { w: number; h: number } {
  const [a, b] = PAPER_MM[page.paper] ?? PAPER_MM.A4;
  return page.orientation === 'portrait' ? { w: a, h: b } : { w: b, h: a };
}

/** Jetons graphiques de chaque thème de mise en page. */
export interface ThemeTokens {
  name: string;
  description: string;
  headerH: number;
  fullBleedHeader: boolean;
  footerH: number;
  gap: number;
  headerBg: string;       // '' = transparent
  headerFg: string;
  headerSub: string;
  titleFont: string;
  titleWeight: number;
  titleUpper: boolean;
  cardBg: string;
  cardBorder: string;
  cardRadius: number;
  planRadius: number;
  frame: 'none' | 'single' | 'double';
  footer: 'cells' | 'line' | 'table' | 'band';
  ink: string;
  muted: string;
}

export const THEMES: Record<PageTheme, ThemeTokens> = {
  moderne: {
    name: 'Moderne', description: 'Bandeau sombre, cartes arrondies, accent couleur',
    headerH: 21, fullBleedHeader: true, footerH: 11, gap: 4,
    headerBg: '#0f1b2a', headerFg: '#ffffff', headerSub: '#9fb1c4', titleFont: 'Bahnschrift', titleWeight: 600, titleUpper: false,
    cardBg: '#f4f6f8', cardBorder: '#e1e6eb', cardRadius: 2.2, planRadius: 2.2, frame: 'none', footer: 'cells', ink: '#0f1b2a', muted: '#6b7a89',
  },
  epure: {
    name: 'Épuré', description: 'Blanc, filets fins, typographie légère',
    headerH: 17, fullBleedHeader: false, footerH: 8, gap: 5,
    headerBg: '', headerFg: '#1c2530', headerSub: '#7a8794', titleFont: 'Segoe UI Light', titleWeight: 300, titleUpper: false,
    cardBg: '#ffffff', cardBorder: '', cardRadius: 0, planRadius: 0, frame: 'none', footer: 'line', ink: '#1c2530', muted: '#8a96a2',
  },
  institutionnel: {
    name: 'Institutionnel', description: 'Cadre double, cartouche normalisé, titre centré',
    headerH: 18, fullBleedHeader: false, footerH: 17, gap: 3,
    headerBg: '', headerFg: '#111111', headerSub: '#444444', titleFont: 'Segoe UI', titleWeight: 700, titleUpper: true,
    cardBg: '#ffffff', cardBorder: '#222222', cardRadius: 0, planRadius: 0, frame: 'double', footer: 'table', ink: '#111111', muted: '#555555',
  },
  signaletique: {
    name: 'Signalétique', description: 'Haute visibilité, bandeau couleur de sécurité',
    headerH: 22, fullBleedHeader: true, footerH: 10, gap: 4,
    headerBg: 'accent', headerFg: '#ffffff', headerSub: '#e3f5ea', titleFont: 'Bahnschrift', titleWeight: 700, titleUpper: true,
    cardBg: '#ffffff', cardBorder: '#0f1b2a', cardRadius: 1.5, planRadius: 1.5, frame: 'none', footer: 'band', ink: '#0f1b2a', muted: '#5b6874',
  },
};

export interface PageLayout {
  w: number; h: number;              // page (mm)
  theme: ThemeTokens;
  header: Rect | null;
  footer: Rect | null;
  side: Rect | null;                 // légende + consignes
  drawing: Rect;                     // zone du plan (mm)
  world: Rect;                       // zone du plan (unités plan)
  k: number;                         // mm par unité plan
  tx: number; ty: number;            // translation (mm)
  scaleDenominator: number | null;   // 1:N réel si étalonné
}

export function computeLayout(floor: Floor, variantId: string, page: PageSetup = floor.page): PageLayout {
  const { w, h } = pageSizeMm(page);
  const T = THEMES[page.theme] ?? THEMES.moderne;
  const m = page.marginMm;
  const G = T.gap;
  const inset = T.frame === 'double' ? 3 : T.frame === 'single' ? 2 : 0;
  let x0 = m + inset, y0 = m + inset, x1 = w - m - inset, y1 = h - m - inset;
  let header: Rect | null = null, footer: Rect | null = null, side: Rect | null = null;

  if (page.showTitleBlock) {
    if (T.fullBleedHeader) {
      header = { x: 0, y: 0, w, h: T.headerH + m * 0.6 };
      y0 = header.h + G;
    } else {
      header = { x: x0, y: y0, w: x1 - x0, h: T.headerH };
      y0 += T.headerH + G;
    }
    footer = { x: x0, y: y1 - T.footerH, w: x1 - x0, h: T.footerH };
    y1 -= T.footerH + G;
  }
  if (page.showLegend || page.showInstructions) {
    const pos = page.orientation === 'portrait' && page.sidePosition !== 'bottom' ? 'bottom' : page.sidePosition;
    if (pos === 'bottom') {
      const sh = Math.min(82, (y1 - y0) * 0.3);
      side = { x: x0, y: y1 - sh, w: x1 - x0, h: sh };
      y1 -= sh + G;
    } else {
      const sw = Math.min(80, (x1 - x0) * 0.27);
      if (pos === 'left') { side = { x: x0, y: y0, w: sw, h: y1 - y0 }; x0 += sw + G; }
      else { side = { x: x1 - sw, y: y0, w: sw, h: y1 - y0 }; x1 -= sw + G; }
    }
  }
  const drawing: Rect = { x: x0, y: y0, w: Math.max(10, x1 - x0), h: Math.max(10, y1 - y0) };
  const world = page.area === 'custom' && page.customArea.w > 0 && page.customArea.h > 0
    ? page.customArea
    : floorContentBounds(floor, variantId);

  const pad = T.planRadius ? 3 : 1.5;
  const inner = { x: drawing.x + pad, y: drawing.y + pad, w: drawing.w - 2 * pad, h: drawing.h - 2 * pad };
  // Place réservée à la flèche du nord (coin haut droit) et à la barre d'échelle (bas).
  if (page.showNorth) inner.w -= 17;
  if (page.showScaleBar && floor.unitsPerMeter > 0) inner.h -= 10;
  let k = Math.min(inner.w / world.w, inner.h / world.h);
  let scaleDenominator: number | null = null;
  if (floor.unitsPerMeter > 0) {
    if (page.scaleMode === 'fixed' && page.scale > 0) {
      k = 1000 / page.scale / floor.unitsPerMeter;
      scaleDenominator = page.scale;
    } else {
      scaleDenominator = 1000 / (k * floor.unitsPerMeter);
    }
  }
  const tx = inner.x + (inner.w - world.w * k) / 2 - world.x * k;
  const ty = inner.y + (inner.h - world.h * k) / 2 - world.y * k;
  return { w, h, theme: T, header, footer, side, drawing, world, k, tx, ty, scaleDenominator };
}

/** Longueur « ronde » de barre d'échelle (m) pour viser ~30 mm. */
export function niceScaleBarMeters(mmPerMeter: number): number {
  const target = 30 / mmPerMeter;
  const steps = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  return steps.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), steps[0]);
}

/** Découpe un texte en lignes selon une largeur (estimation). */
export function wrapText(text: string, widthMm: number, fontMm: number): string[] {
  const maxChars = Math.max(8, Math.floor(widthMm / (fontMm * 0.5)));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > maxChars && line) { out.push(line); line = word; }
      else line = (line + ' ' + word).trim();
    }
    if (line) out.push(line);
  }
  return out;
}
