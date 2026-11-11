import { floorContentBounds, isVisibleInVariant, usedSymbolIds, type Rect } from '../model/geometry';
import type { FrameKey, Floor, PageSetup, PageTheme } from '../model/types';

export const PAPER_MM: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420], A2: [420, 594] };

/**
 * Agrandissement de toute la mise en page (textes, légende, consignes, cartouche, pictogrammes…) selon le papier.
 * La page est composée sur une « page virtuelle » de taille papier / facteur, puis agrandie à la taille réelle :
 * un A3 garde ainsi la même lisibilité qu'un A4 (√2 ≈ 1,41 = A4 agrandi à l'identique), tout en laissant
 * un peu plus de place au plan.
 */
export const PAPER_SCALE: Record<string, number> = { A4: 1, A3: 1.35, A2: 1.8 };

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
  footer: 'cells' | 'line' | 'table' | 'band' | 'capsule' | 'rule';
  ink: string;
  muted: string;
  /**
   * Style des titres de cadres : filet d'accent, simple ligne, bandeau plein, onglet posé sur le cadre,
   * pastille d'accent, rubrique numérotée sous un filet épais.
   */
  cardStyle?: 'bar' | 'line' | 'header' | 'tab' | 'pill' | 'index';
  /** Couleur du bandeau de titre (cardStyle 'header') ; 'accent' = couleur d'accent. */
  cardHead?: string;
  cardHeadFg?: string;
  cardStrokeW?: number;
  /** Contour du plan ('' = aucun ; 'accent' = couleur d'accent). */
  planStroke?: string;
  planStrokeW?: number;
  /**
   * Numéros d'urgence dans l'en-tête plutôt que dans un cadre. S'ils ne tiennent pas à côté du titre
   * (page en portrait, numéros longs, logo…), ils passent automatiquement dans le cadre rouge latéral.
   */
  numbersInHeader?: boolean;
  /** Titres des cartes et cadre d'urgence en dégradé avec reflets (thème Horizon). */
  gradients?: boolean;
  /** Thème pensé avec vue aérienne + croquis de situation (activés à la sélection). */
  extras?: boolean;
}

export const THEMES: Record<PageTheme, ThemeTokens> = {
  moderne: {
    name: 'Moderne', description: 'Bandeau sombre, cartes arrondies, accent couleur',
    headerH: 29, fullBleedHeader: true, footerH: 11, gap: 4,
    headerBg: '#0f1b2a', headerFg: '#ffffff', headerSub: '#9fb1c4', titleFont: 'Bahnschrift', titleWeight: 600, titleUpper: false,
    cardBg: '#f4f6f8', cardBorder: '#e1e6eb', cardRadius: 2.2, planRadius: 2.2, frame: 'none', footer: 'cells', ink: '#0f1b2a', muted: '#6b7a89',
    planStroke: '#e1e6eb', planStrokeW: 0.3, numbersInHeader: true,
  },
  epure: {
    name: 'Épuré', description: 'Blanc, filets fins, typographie légère',
    headerH: 27, fullBleedHeader: false, footerH: 8, gap: 5,
    headerBg: '', headerFg: '#1c2530', headerSub: '#7a8794', titleFont: 'Segoe UI Light', titleWeight: 300, titleUpper: false,
    cardBg: '#ffffff', cardBorder: '', cardRadius: 0, planRadius: 0, frame: 'none', footer: 'line', ink: '#1c2530', muted: '#8a96a2',
    cardStyle: 'line', planStroke: '', numbersInHeader: true,
  },
  institutionnel: {
    name: 'Institutionnel', description: 'Cadre double, cartouche normalisé, titre centré',
    headerH: 27, fullBleedHeader: false, footerH: 17, gap: 3,
    headerBg: '', headerFg: '#111111', headerSub: '#444444', titleFont: 'Segoe UI', titleWeight: 700, titleUpper: true,
    cardBg: '#ffffff', cardBorder: '#222222', cardRadius: 0, planRadius: 0, frame: 'double', footer: 'table', ink: '#111111', muted: '#555555',
    cardStrokeW: 0.3, planStroke: '#111111', planStrokeW: 0.35,
  },
  signaletique: {
    name: 'Signalétique', description: 'Haute visibilité, bandeau couleur de sécurité',
    headerH: 30, fullBleedHeader: true, footerH: 10, gap: 4,
    headerBg: 'accent', headerFg: '#ffffff', headerSub: '#e3f5ea', titleFont: 'Bahnschrift', titleWeight: 700, titleUpper: true,
    cardBg: '#ffffff', cardBorder: '#0f1b2a', cardRadius: 1.5, planRadius: 1.5, frame: 'none', footer: 'band', ink: '#0f1b2a', muted: '#5b6874',
    cardStrokeW: 0.45, planStroke: '#0f1b2a', planStrokeW: 0.5, numbersInHeader: true,
  },
  encadre: {
    name: 'Encadré', description: 'Chaque bloc dans un cadre à onglet : légende, consignes, vue aérienne, croquis de situation',
    headerH: 27, fullBleedHeader: false, footerH: 17, gap: 4,
    headerBg: '', headerFg: '#0f1b2a', headerSub: '#4a5866', titleFont: 'Bahnschrift', titleWeight: 700, titleUpper: true,
    cardBg: '#ffffff', cardBorder: 'accent', cardRadius: 1.2, planRadius: 1.2, frame: 'single', footer: 'table', ink: '#0f1b2a', muted: '#5b6874',
    cardStyle: 'tab', cardStrokeW: 0.6, planStroke: 'accent', planStrokeW: 0.7, extras: true,
  },
  bandeaux: {
    name: 'Bandeaux', description: 'Cadres à bandeau de titre couleur, vue aérienne et croquis de situation',
    headerH: 29, fullBleedHeader: true, footerH: 11, gap: 4,
    headerBg: '#1f2a37', headerFg: '#ffffff', headerSub: '#aab8c6', titleFont: 'Bahnschrift', titleWeight: 600, titleUpper: false,
    cardBg: '#ffffff', cardBorder: 'accent', cardRadius: 1.6, planRadius: 1.6, frame: 'none', footer: 'cells', ink: '#1f2a37', muted: '#6b7a89',
    cardStyle: 'header', cardHead: 'accent', cardHeadFg: '#ffffff', cardStrokeW: 0.45, planStroke: '#1f2a37', planStrokeW: 0.45,
    numbersInHeader: true, extras: true,
  },
  technique: {
    name: 'Technique', description: 'Style bureau d’études : cadres fins, titres sur fond gris, cartouche normalisé',
    headerH: 27, fullBleedHeader: false, footerH: 17, gap: 3,
    headerBg: '', headerFg: '#1d3557', headerSub: '#4a5866', titleFont: 'Segoe UI', titleWeight: 600, titleUpper: true,
    cardBg: '#ffffff', cardBorder: '#1d3557', cardRadius: 0, planRadius: 0, frame: 'single', footer: 'table', ink: '#1d3557', muted: '#5b6874',
    cardStyle: 'header', cardHead: '#e4e9f0', cardHeadFg: '#1d3557', cardStrokeW: 0.3, planStroke: '#1d3557', planStrokeW: 0.35, extras: true,
  },
  horizon: {
    name: 'Horizon', description: 'Contemporain : bandeau en dégradé nuit → accent, cadres teintés et bordés aux grands arrondis, titres en pastille',
    headerH: 31, fullBleedHeader: true, footerH: 13, gap: 4.5,
    headerBg: 'gradient', headerFg: '#ffffff', headerSub: '#d3dde8', titleFont: 'Segoe UI Variable Display', titleWeight: 600, titleUpper: false,
    cardBg: 'tint', cardBorder: 'soft', cardRadius: 3.6, planRadius: 3.6, frame: 'none', footer: 'capsule', ink: '#14202e', muted: '#66768a',
    cardStyle: 'pill', cardStrokeW: 0.5, planStroke: 'soft', planStrokeW: 0.55, numbersInHeader: true, gradients: true,
  },
  editorial: {
    name: 'Éditorial', description: 'Style magazine : grand titre noir, filets épais, rubriques numérotées, beaucoup de blanc',
    headerH: 31, fullBleedHeader: false, footerH: 12, gap: 5,
    headerBg: '', headerFg: '#0b0b0c', headerSub: '#5c6066', titleFont: 'Segoe UI Variable Display', titleWeight: 800, titleUpper: false,
    cardBg: '#ffffff', cardBorder: '', cardRadius: 0, planRadius: 0, frame: 'none', footer: 'rule', ink: '#0b0b0c', muted: '#6e737a',
    cardStyle: 'index', planStroke: '#0b0b0c', planStrokeW: 0.25, numbersInHeader: true,
  },
};

/** Mélange une couleur #rrggbb avec une autre (t = part de la seconde, 0–1). */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const s = h.replace('#', '');
    const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0').slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0);
  };
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** Changement de thème : les thèmes « à cadres » activent aussi la vue aérienne et le croquis. */
export function themePatch(theme: PageTheme): Partial<PageSetup> {
  return THEMES[theme]?.extras ? { theme, showAerial: true, showSketch: true } : { theme };
}

/**
 * Résout une couleur de thème : 'accent' = couleur d'accent de la page, 'tint' = accent très éclairci (fonds),
 * 'soft' = accent adouci (bordures de cadres).
 */
export const themeColor = (c: string | undefined, accent: string) =>
  c === 'accent' ? accent : c === 'tint' ? mixHex(accent, '#ffffff', 0.92) : c === 'soft' ? mixHex(accent, '#ffffff', 0.45) : c || '';

/** Zones encadrables, dans l'ordre des réglages. */
export const FRAME_ZONES: [FrameKey, string][] = [
  ['plan', 'Plan'], ['legend', 'Légende'], ['instructions', 'Consignes'],
  ['aerial', 'Vue aérienne'], ['sketch', 'Croquis de situation'], ['footer', 'Cartouche (bas de page)'],
];

/** Cadre prévu par le thème pour une zone (avant tout choix de l'utilisateur). */
export function themeFrameDefault(T: ThemeTokens, key: FrameKey): boolean {
  if (key === 'plan') return !!T.planStroke;
  if (key === 'footer') return T.footer === 'table' || (T.footer === 'capsule' && !!T.cardBorder);
  return !!T.cardBorder;
}

/** La zone est-elle encadrée ? Choix de l'utilisateur s'il existe, sinon celui du thème. */
export function frameOn(page: PageSetup, key: FrameKey): boolean {
  const T = THEMES[page.theme] ?? THEMES.moderne;
  return page.frames?.[key] ?? themeFrameDefault(T, key);
}

/** Couleur et épaisseur d'un cadre ; un thème sans bordure reçoit un filet discret dans sa couleur d'encre. */
export function frameStroke(T: ThemeTokens, accent: string, key: FrameKey): { color: string; w: number } {
  if (key === 'plan') return { color: themeColor(T.planStroke, accent) || mixHex(T.ink, '#ffffff', 0.62), w: T.planStroke ? T.planStrokeW ?? 0.4 : 0.35 };
  return { color: themeColor(T.cardBorder, accent) || mixHex(T.ink, '#ffffff', 0.62), w: T.cardBorder ? T.cardStrokeW ?? 0.25 : 0.35 };
}

/** Couleur sombre du dégradé « Horizon » : nuit teintée de l'accent. */
export const horizonNight = (accent: string) => mixHex('#0c1622', accent, 0.12);

export interface PageLayout {
  w: number; h: number;              // page virtuelle (mm de composition = mm réels / s)
  /** Taille réelle du papier (mm). */
  paperW: number; paperH: number;
  /** Facteur d'agrandissement page virtuelle → papier (A4 = 1). */
  s: number;
  /** Marge en mm de composition. */
  m: number;
  theme: ThemeTokens;
  header: Rect | null;
  footer: Rect | null;
  side: Rect | null;                 // légende + consignes
  drawing: Rect;                     // zone du plan (mm)
  world: Rect;                       // zone du plan (unités plan)
  k: number;                         // mm par unité plan
  tx: number; ty: number;            // translation (mm)
  scaleDenominator: number | null;   // 1:N réel si étalonné
  /** Facteur d'agrandissement propre à l'en-tête (1 : l'agrandissement global `s` suffit). */
  hs: number;
  /** Numéros d'urgence affichés dans l'en-tête (sinon dans le cadre rouge latéral). */
  numbersInHeader: boolean;
}

/**
 * Les numéros d'urgence tiennent-ils dans l'en-tête sans tronquer ni le titre ni les numéros ?
 * Reprend les largeurs utilisées par l'en-tête de chaque thème (estimation, comme `fit`).
 */
function numbersFitInHeader(page: PageSetup, T: ThemeTokens, pageW: number, headerW: number, hs: number, title: string, numbers: string, logo: boolean): boolean {
  const titleFs = 11 * hs, numFs = 3.6 * hs;
  const t = T.titleUpper ? title.toUpperCase() : title;
  const logoW = logo ? 30 * hs + 4 : 0;
  if (page.theme === 'editorial') {
    const nFs = numFs * 1.1;
    const wanted = numbers.length * nFs * 0.5 + nFs * 2;
    const nW = Math.min(headerW * 0.5, wanted);
    return wanted <= headerW * 0.5 && t.length * titleFs * 1.32 * 0.98 * 0.52 <= headerW - (logo ? 30 * hs + 5 : 0) - nW - 6;
  }
  const innerW = T.fullBleedHeader ? pageW - 2 * page.marginMm : headerW;
  const wanted = numbers.length * numFs * 0.52 + 14 * hs;
  const numW = Math.min(innerW * 0.5, wanted);
  if (wanted > innerW * 0.5) return false;
  if (!T.fullBleedHeader) return t.length * titleFs * 1.05 * 0.52 <= innerW - numW - logoW - 6;   // Épuré
  const icon = page.theme === 'signaletique' ? 17 * hs + 4 : 0;
  return t.length * titleFs * (T.titleUpper ? 1.12 : 1) * 0.52 <= innerW - logoW - icon - numW - 6;
}

export const INSTRUCTION_FONT = 2.75;
const INSTRUCTION_LINE_HEIGHT = INSTRUCTION_FONT * 1.38;

export function instructionLines(text: string, widthMm: number) {
  return text.split('\n').flatMap((paragraph) => {
    const label = paragraph.trim();
    const heading = label.length > 3 && label === label.toUpperCase() && /[A-ZÀ-Ý]/.test(label) ? label : '';
    const lines = wrapText(paragraph, widthMm - 12, INSTRUCTION_FONT);
    return lines.map((line, i) => ({
      text: line,
      heading,
      startsSection: Boolean(heading) && i === 0,
      advance: INSTRUCTION_LINE_HEIGHT * (!line ? 0.5 : heading && i === lines.length - 1 ? 1.5 : 1),
    }));
  });
}

/** Hauteur de texte des consignes dans un cadre de largeur donnée. */
export function instructionsHeight(text: string, widthMm: number): number {
  let baseline = 12;
  let height = 0;
  for (const line of instructionLines(text, widthMm)) {
    if (line.text) height = baseline + 2.5;
    baseline += line.advance;
  }
  return height;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function computeLayout(floor: Floor, variantId: string, page: PageSetup = floor.page): PageLayout {
  const paper = pageSizeMm(page);
  const s = PAPER_SCALE[page.paper] ?? 1;
  const w = paper.w / s, h = paper.h / s;
  const T = THEMES[page.theme] ?? THEMES.moderne;
  const m = page.marginMm / s;
  const G = T.gap;
  const hs = 1;
  const headerH = T.headerH * hs;
  const inset = T.frame === 'double' ? 3 : T.frame === 'single' ? 2 : 0;
  let x0 = m + inset, y0 = m + inset, x1 = w - m - inset, y1 = h - m - inset;
  let header: Rect | null = null, footer: Rect | null = null, side: Rect | null = null;

  if (page.showTitleBlock) {
    if (T.fullBleedHeader) {
      header = { x: 0, y: 0, w, h: headerH + m * 0.6 };
      y0 = header.h + G;
    } else {
      header = { x: x0, y: y0, w: x1 - x0, h: headerH };
      y0 += headerH + G;
    }
    footer = { x: x0, y: y1 - T.footerH, w: x1 - x0, h: T.footerH };
    y1 -= T.footerH + G;
  }
  const hasSide = page.showLegend || page.showInstructions || page.showAerial || page.showSketch;
  const tb = floor.titleBlock;
  const numbers = page.showEmergencyNumbers ? tb.emergencyNumbers.trim() : '';
  // Numéros dans l'en-tête seulement s'ils y tiennent ; sans cadre latéral pour les accueillir, ils restent dans l'en-tête.
  const numbersInHeader = !!numbers && !!T.numbersInHeader && !!header
    && (!hasSide || numbersFitInHeader(page, T, w, header.w, hs, tb.title || 'Plan d’évacuation', numbers, !!tb.logo));
  const numsInSide = !!numbers && !numbersInHeader;

  const world = page.area === 'custom' && page.customArea.w > 0 && page.customArea.h > 0
    ? page.customArea
    : floorContentBounds(floor, variantId);
  const pad = T.planRadius ? 3 : 1.5;
  // Place réservée autour du plan : marges intérieures, flèche du nord (à droite), barre d'échelle (en bas).
  const reserveW = 2 * pad + (page.showNorth ? 17 : 0);
  const reserveH = 2 * pad + (page.showScaleBar && floor.unitsPerMeter > 0 ? 10 : 0);
  const kFixed = floor.unitsPerMeter > 0 && page.scaleMode === 'fixed' && page.scale > 0 ? 1000 / page.scale / floor.unitsPerMeter / s : 0;

  if (hasSide) {
    const W = x1 - x0, H = y1 - y0;
    const extra = page.showAerial || page.showSketch;
    const nCards = (page.showLegend ? 1 : 0) + (page.showInstructions && tb.instructions.trim() ? 1 : 0);
    // Échelle du plan obtenue avec un cadre latéral (largeur sw) ou un bandeau en bas (hauteur sh).
    const kWith = (pw: number, ph: number) => kFixed || Math.min((pw - reserveW) / world.w, (ph - reserveH) / world.h);
    const colBase = Math.min(extra ? 92 : 80, W * (extra ? 0.31 : 0.27));
    const colPortrait = Math.min(colBase, W * 0.32);
    const bandBase = Math.min(82, H * 0.3);

    // Position : celle choisie en paysage ; en portrait, « Gauche / Droite » place le cadre à côté du plan
    // seulement si le plan est nettement en hauteur (sinon bandeau en bas, plus lisible sur une page étroite).
    let pos = page.sidePosition;
    if (page.orientation === 'portrait' && pos !== 'bottom') {
      const sideK = kWith(W - colPortrait - G, H), bottomK = kWith(W, H - bandBase - G);
      if (!(sideK > bottomK * 1.1) || kFixed) pos = 'bottom';
    }

    if (pos === 'bottom') {
      // Le plan prend la hauteur dont il a besoin à pleine largeur ; le bandeau récupère le reste,
      // dans la limite de ce que son contenu demande (et de la moitié de la page).
      const planNeed = world.h * (kFixed || (W - reserveW) / world.w) + reserveH;
      const leftover = H - G - planNeed;
      const numsW = numsInSide ? Math.min(60, W * 0.22) + G : 0;
      const rest = W - numsW - (extra ? W * 0.2 + G : 0);
      const legendW = nCards === 2 ? rest * 0.56 - G / 2 : rest;   // même partage que le rendu
      const instrW = nCards === 2 ? rest * 0.44 - G / 2 : rest;
      const items = usedSymbolIds(floor, variantId).length
        + new Set(floor.elements.filter((e) => e.type === 'route' && isVisibleInVariant(e, variantId)).map((e) => (e as { kind: string }).kind)).size;
      const legendCols = legendW >= 105 ? 3 : legendW >= 60 ? 2 : 1;
      const need = Math.max(
        page.showLegend ? 11 + Math.ceil(items / legendCols) * 7 + 2 : 0,
        page.showInstructions && tb.instructions.trim() ? instructionsHeight(tb.instructions, instrW) : 0,
        extra ? 48 : 0,
        numsInSide ? 22 : 0,
      );
      const sh = clamp(Math.min(need, Math.max(leftover, bandBase)), bandBase, H * 0.5);
      side = { x: x0, y: y1 - sh, w: W, h: sh };
      y1 -= sh + G;
    } else {
      // Même principe en colonne : un plan en hauteur laisse une colonne plus large (lignes plus longues).
      const colMin = page.orientation === 'portrait' ? colPortrait : colBase;
      const planNeed = world.w * (kFixed || (H - reserveH) / world.h) + reserveW;
      const leftover = W - G - planNeed;
      const sw = clamp(Math.min(extra ? 112 : 100, Math.max(leftover, colMin)), colMin, W * 0.42);
      if (pos === 'left') { side = { x: x0, y: y0, w: sw, h: H }; x0 += sw + G; }
      else { side = { x: x1 - sw, y: y0, w: sw, h: H }; x1 -= sw + G; }
    }
  }
  const drawing: Rect = { x: x0, y: y0, w: Math.max(10, x1 - x0), h: Math.max(10, y1 - y0) };

  const inner = { x: drawing.x + pad, y: drawing.y + pad, w: drawing.w - 2 * pad, h: drawing.h - 2 * pad };
  // Place réservée à la flèche du nord (coin haut droit) et à la barre d'échelle (bas).
  if (page.showNorth) inner.w -= 17;
  if (page.showScaleBar && floor.unitsPerMeter > 0) inner.h -= 10;
  let k = Math.min(inner.w / world.w, inner.h / world.h);
  let scaleDenominator: number | null = null;
  if (floor.unitsPerMeter > 0) {
    if (page.scaleMode === 'fixed' && page.scale > 0) {
      k = 1000 / page.scale / floor.unitsPerMeter / s;
      scaleDenominator = page.scale;
    } else {
      scaleDenominator = 1000 / (k * s * floor.unitsPerMeter);
    }
  }
  const tx = inner.x + (inner.w - world.w * k) / 2 - world.x * k;
  const ty = inner.y + (inner.h - world.h * k) / 2 - world.y * k;
  return { w, h, paperW: paper.w, paperH: paper.h, s, m, theme: T, header, footer, side, drawing, world, k, tx, ty, scaleDenominator, hs, numbersInHeader };
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
