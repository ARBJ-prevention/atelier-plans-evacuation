import { floorContentBounds, isVisibleInVariant, usedSymbolIds, type Rect } from '../model/geometry';
import type { Building, FrameKey, Floor, PageSetup, PageTheme, PrintBlock, PrintBlockPosition, PrintBlockPositions } from '../model/types';
import { getBuiltinSymbol } from '../symbols/library';

export const PAPER_MM: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };

/**
 * Agrandissement de toute la mise en page (textes, légende, consignes, cartouche, pictogrammes…) selon le papier.
 * La page est composée sur une « page virtuelle » de taille papier / facteur, puis agrandie à la taille réelle :
 * un A3 garde ainsi la même lisibilité qu'un A4 (√2 ≈ 1,41 = A4 agrandi à l'identique), tout en laissant
 * un peu plus de place au plan.
 */
export const PAPER_SCALE: Record<string, number> = { A4: 1, A3: 1.35, A2: 1.8, A1: 2.45, A0: 3.4 };

/* ───────────── Fiche pratique « Réalisation d'un plan d'évacuation » (NBN ISO 23601:2021) ───────────── */

/** Hauteur minimale des lettres du titre « Plan d'évacuation » (mm) selon le format. */
export const ISO_TITLE_LETTER_MM: Record<string, number> = { A4: 13, A3: 13, A2: 18, A1: 26, A0: 36 };
/** Hauteur des capitales rapportée au corps du texte (Bahnschrift / Segoe UI ≈ 0,7). */
const CAP_RATIO = 0.7;
/** Épaisseurs minimales imprimées (mm) : murs porteurs, autres parois, obstacles. */
export const ISO_LOAD_WALL_MM = 1.6;
export const ISO_WALL_MM = 0.6;
export const ISO_OBSTACLE_MM = 0.15;
/** Taille minimale imprimée des pictogrammes (mm). */
export const ISO_SYMBOL_MM = 7;
/** Échelles admises : 1:100 (petits et moyens bâtiments), 1:250 (grands bâtiments). */
export const ISO_SCALES = [100, 250] as const;
const PAPER_ORDER = ['A4', 'A3', 'A2', 'A1', 'A0'] as const;

/** La norme est-elle appliquée à cette page ? (absent = oui) */
export const normOn = (page: PageSetup) => page.norm !== false;

/** Réglages imposés par la fiche, hors échelle (titre, fond blanc, A3 minimum, blocs obligatoires). */
function normBase(floor: Floor, page: PageSetup): PageSetup {
  const paper = page.paper === 'A4' && !page.smallRoom ? 'A3' : page.paper;
  return {
    ...page, paper, planBackground: '#ffffff',
    showTitleBlock: true, showFooter: true, showLegend: true,
    showInstructions: page.showInstructions || !!floor.titleBlock.instructions.trim(),
  };
}

/** Le plan entier tient-il dans sa zone à l'échelle fixée ? */
function fitsAtScale(floor: Floor, variantId: string, page: PageSetup): boolean {
  const L = layoutOnce(floor, variantId, page);
  const sb = page.showScaleBar ? 10 : 0;
  return L.world.w * L.k <= L.drawing.w - 2 + 0.01 && L.world.h * L.k <= L.drawing.h - 2 - sb + 0.01;
}

/**
 * Page effectivement imprimée. Avec la norme : A3 minimum (A4 pour une chambre individuelle), fond blanc,
 * en-tête, légende, consignes et cartouche toujours présents ; si l'échelle est « ajustée » et l'étage étalonné,
 * choix automatique de 1:100 puis 1:250 et du plus petit format où le plan tient en entier, en gardant la même
 * échelle et le même format pour tous les étages du bâtiment (cohérence entre étages).
 */
export function normalizePage(floor: Floor, page: PageSetup = floor.page, building?: Building, variantId?: string): PageSetup {
  if (!normOn(page)) return page;
  const base = normBase(floor, page);
  if (floor.unitsPerMeter <= 0 || base.scaleMode !== 'fit' || base.area !== 'auto') return base;
  const vid = variantId ?? floor.variants[0]?.id ?? '';
  const others = (building?.floors ?? []).filter((f) => f.id !== floor.id && f.unitsPerMeter > 0 && normOn(f.page)
    && f.page.scaleMode === 'fit' && f.page.area === 'auto' && f.elements.length);
  const start = Math.max(1, PAPER_ORDER.indexOf(base.paper as typeof PAPER_ORDER[number]));
  const papers = PAPER_ORDER.slice(base.smallRoom ? PAPER_ORDER.indexOf(base.paper as typeof PAPER_ORDER[number]) : start);
  // 1:100 sur A3 / A2, puis 1:250 du plus petit au plus grand format.
  const tries: [string, number][] = [
    ...papers.filter((p) => p === 'A4' || p === 'A3' || p === 'A2').map((p) => [p, 100] as [string, number]),
    ...papers.map((p) => [p, 250] as [string, number]),
  ];
  for (const [paper, scale] of tries) {
    const fits = (f: Floor, v: string) => fitsAtScale(f, v, { ...normBase(f, f === floor ? page : f.page), paper: paper as PageSetup['paper'], scaleMode: 'fixed', scale });
    if (fits(floor, vid) && others.every((f) => f.variants.every((v) => fits(f, v.id)))) {
      return { ...base, paper: paper as PageSetup['paper'], scaleMode: 'fixed', scale };
    }
  }
  return base;   // trop grand même au 1:250 sur A0 : plan ajusté (n'afficher qu'une partie du bâtiment)
}

export function pageSizeMm(page: PageSetup): { w: number; h: number } {
  const [a, b] = PAPER_MM[page.paper] ?? PAPER_MM.A4;
  return page.orientation === 'portrait' ? { w: a, h: b } : { w: b, h: a };
}

/** Jetons graphiques de chaque thème de mise en page. */
export interface ThemeTokens {
  name: string;
  printStyle?: 'indigo' | 'sienne' | 'petrole';
  blockPosition?: PrintBlockPosition;
  paperBg?: string;
  accent?: string;
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
  /**
   * Cadres activés à la sélection du thème : true = vue aérienne + croquis de situation ;
   * 'sketch' = croquis de situation seul (la vue aérienne est retirée).
   */
  extras?: boolean | 'sketch';
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
    cardStyle: 'pill', cardStrokeW: 0.5, planStroke: 'soft', planStrokeW: 0.55, numbersInHeader: true, gradients: true, extras: 'sketch',
  },
  editorial: {
    name: 'Éditorial', description: 'Style magazine : grand titre noir, filets épais, rubriques numérotées, beaucoup de blanc',
    headerH: 31, fullBleedHeader: false, footerH: 12, gap: 5,
    headerBg: '', headerFg: '#0b0b0c', headerSub: '#5c6066', titleFont: 'Segoe UI Variable Display', titleWeight: 800, titleUpper: false,
    cardBg: '#ffffff', cardBorder: '', cardRadius: 0, planRadius: 0, frame: 'none', footer: 'rule', ink: '#0b0b0c', muted: '#6e737a',
    cardStyle: 'index', planStroke: '#0b0b0c', planStrokeW: 0.25, numbersInHeader: true,
  },
  indigo: {
    name: 'Indigo', description: 'Bandeau indigo, cartes lavande et colonne à droite',
    printStyle: 'indigo', blockPosition: 'right', accent: '#303566',
    headerH: 32, fullBleedHeader: false, footerH: 12, gap: 4,
    headerBg: '#303566', headerFg: '#ffffff', headerSub: '#e4e2ff', titleFont: 'Segoe UI', titleWeight: 750, titleUpper: false,
    cardBg: '#eeedfa', cardBorder: '', cardRadius: 2.6, planRadius: 3, frame: 'none', footer: 'cells',
    ink: '#23284d', muted: '#51577b', planStroke: '#c6c8e1', numbersInHeader: true,
  },
  sienne: {
    name: 'Sienne', description: 'Papier ivoire, titre à empattements et rubriques sous le plan',
    printStyle: 'sienne', blockPosition: 'bottom', paperBg: '#fffdf9', accent: '#a35a4f',
    headerH: 31, fullBleedHeader: false, footerH: 12, gap: 3.5,
    headerBg: '#fffdf9', headerFg: '#4e2c35', headerSub: '#663b40', titleFont: 'Georgia', titleWeight: 700, titleUpper: false,
    cardBg: '#f5eae0', cardBorder: '', cardRadius: 0, planRadius: 0, frame: 'none', footer: 'cells',
    ink: '#4e2c35', muted: '#6e4a47', planStroke: '#e6d8cf', numbersInHeader: true,
  },
  petrole: {
    name: 'Pétrole', description: 'Bandeau bleu grisé, cartouche bleu pétrole et colonne à gauche',
    printStyle: 'petrole', blockPosition: 'left', accent: '#1b626b',
    headerH: 30, fullBleedHeader: false, footerH: 12, gap: 3.5,
    headerBg: '#e8f3f3', headerFg: '#153e45', headerSub: '#23545a', titleFont: 'Segoe UI', titleWeight: 800, titleUpper: false,
    cardBg: '#e8f3f3', cardBorder: '', cardRadius: 1.2, planRadius: 1.4, frame: 'none', footer: 'cells',
    ink: '#153e45', muted: '#3a6167', planStroke: '#a4c6c7', numbersInHeader: true,
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

/** Couleur claire ? (luminance perçue) */
export function isLightHex(c: string): boolean {
  const s = c.replace('#', '');
  const f = s.length === 3 ? s.split('').map((x) => x + x).join('') : s.padEnd(6, '0').slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

/**
 * Couleurs de l'en-tête : celles du thème, ou, si l'utilisateur a choisi une couleur d'en-tête,
 * ce fond avec un texte blanc ou foncé selon sa clarté (le titre reste toujours lisible).
 */
export function headerColors(T: ThemeTokens, page: PageSetup, accent: string): { custom: boolean; bg: string; fg: string; sub: string } {
  const c = page.headerColor;
  if (!c) return { custom: false, bg: T.headerBg === 'accent' ? accent : T.headerBg, fg: T.headerFg, sub: T.headerSub };
  const fg = isLightHex(c) ? '#111a24' : '#ffffff';
  return { custom: true, bg: c, fg, sub: mixHex(c, fg, 0.8) };
}

/** Couleur d'en-tête affichée dans le sélecteur : celle choisie, sinon celle du thème (blanc si l'en-tête est sans fond). */
export function headerColorValue(page: PageSetup): string {
  if (page.headerColor) return page.headerColor;
  const bg = (THEMES[page.theme] ?? THEMES.moderne).headerBg;
  if (bg === 'accent' || bg === 'gradient') return page.accentColor || '#00843d';
  return /^#[0-9a-f]{6}$/i.test(bg) ? bg : '#ffffff';
}

/**
 * Changement de thème : les thèmes « à cadres » activent aussi la vue aérienne et le croquis ;
 * Horizon active le croquis de situation seul (dès le premier choix, quel que soit le thème précédent).
 */
export function themePatch(theme: PageTheme): Partial<PageSetup> {
  const tokens = THEMES[theme];
  if (tokens.accent) return { theme, accentColor: tokens.accent };
  const extras = tokens.extras;
  if (extras === 'sketch') return { theme, showAerial: false, showSketch: true };
  return extras ? { theme, showAerial: true, showSketch: true } : { theme };
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
  blocks?: Partial<Record<PrintBlock, Rect>>;
  drawing: Rect;                     // zone du plan (mm)
  world: Rect;                       // zone du plan (unités plan)
  k: number;                         // mm par unité plan
  tx: number; ty: number;            // translation (mm)
  scaleDenominator: number | null;   // 1:N réel si étalonné
  /** Facteur d'agrandissement propre à l'en-tête (1 : l'agrandissement global `s` suffit). */
  hs: number;
  /** Numéros d'urgence affichés dans l'en-tête (sinon dans le cadre rouge latéral). */
  numbersInHeader: boolean;
  /** Blocs déplacés automatiquement dans l'espace libre pour agrandir le plan. */
  relocated?: PrintBlock[];
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

/**
 * Largeur de colonne dont le contenu a besoin pour que chaque consigne et chaque libellé de légende
 * tienne sur une ligne (mêmes estimations que `wrapText` et que le rendu de la légende).
 */
function sideContentWidth(floor: Floor, variantId: string, page: PageSetup): number {
  let need = 0;
  if (page.showInstructions) {
    const longest = Math.max(0, ...floor.titleBlock.instructions.split('\n').map((line) => line.trim().length));
    need = Math.max(need, (longest + 2) * INSTRUCTION_FONT * 0.5 + 12);
  }
  if (page.showLegend) {
    const labels = usedSymbolIds(floor, variantId).map((id) => getBuiltinSymbol(id)?.name ?? 'Pictogramme personnalisé');
    if (floor.elements.some((e) => e.type === 'route' && isVisibleInVariant(e, variantId))) labels.push('Itinéraire d’évacuation');
    const longest = Math.max(0, ...labels.map((label) => label.length));
    need = Math.max(need, (longest + 1) * 2.9 * 0.5 + 18);
  }
  return need;
}

export const PRINT_BLOCKS = [
  ['legend', 'Légende', 'showLegend'],
  ['instructions', 'Consignes', 'showInstructions'],
  ['aerial', 'Vue aérienne', 'showAerial'],
  ['sketch', 'Croquis de situation', 'showSketch'],
  ['numbers', "Numéros d’urgence", 'showEmergencyNumbers'],
] as const;

export const PRINT_POSITIONS = [
  ['left', 'À gauche'], ['right', 'À droite'], ['top', 'En haut'], ['bottom', 'En bas'],
] as const;

export function preferredBlockPosition(page: PageSetup): PrintBlockPosition {
  return THEMES[page.theme]?.blockPosition ?? page.sidePosition;
}

export function instructionColumns(text: string, width: number, horizontal: boolean): string[] {
  const sections = text.trim().split(/\n\s*\n(?=\S)/);
  return horizontal && width >= 132 && sections.length === 2
    && sections.every((section) => instructionLines(section, width / 2)[0]?.startsSection)
    ? sections : [text];
}

export function legendColumnLimit(width: number): number {
  return Math.max(1, Math.min(3, Math.floor((width - 6) / 29)));
}

function positionedBlocks(
  floor: Floor, variantId: string, page: PageSetup, area: Rect, gap: number, numbersInHeader: boolean,
) {
  const positions = page.blockPositions?.[page.theme];
  const groups = { left: [], right: [], top: [], bottom: [] } as Record<PrintBlockPosition, PrintBlock[]>;
  const tb = floor.titleBlock;
  for (const [key, , flag] of PRINT_BLOCKS) {
    if (!page[flag] || (key === 'instructions' && !tb.instructions.trim())
      || (key === 'numbers' && (numbersInHeader || !tb.emergencyNumbers.trim()))) continue;
    const pos = positions?.[key];
    groups[pos && Object.hasOwn(groups, pos) ? pos : preferredBlockPosition(page)].push(key);
  }

  const visible = new Set(floor.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const items = usedSymbolIds(floor, variantId).length + new Set(floor.elements.flatMap((e) =>
    e.type === 'route' && visible.has(e.layer) && isVisibleInVariant(e, variantId) ? [e.kind] : [])).size;
  const rects: Partial<Record<PrintBlock, Rect>> = {};
  const drawing = { ...area };
  let squeezed = false;
  function height(key: PrintBlock, width: number, row: boolean) {
    switch (key) {
      case 'legend': return 11 + Math.ceil(items / legendColumnLimit(width)) * 7 + 1;
      case 'instructions': {
        const cols = instructionColumns(tb.instructions, width, row);
        return Math.max(...cols.map((col) => instructionsHeight(col, width / cols.length))) + 0.2;
      }
      case 'numbers': return 14 + tb.emergencyNumbers.split(/\s*[·|]\s*/).reduce((n, part) =>
        n + wrapText(part, width - 6, 3).length * 3.9, 0);
      default: return row ? 29 : clamp(width * 0.48, 19, 42);
    }
  }

  for (const edge of ['top', 'bottom'] as const) {
    const keys = groups[edge];
    if (!keys.length) continue;
    const available = area.w - gap * (keys.length - 1);
    const weight = (key: PrintBlock) => key === 'instructions' ? 2.2 : key === 'legend' ? 1.45 : 1;
    const total = keys.reduce((sum, key) => sum + weight(key), 0);
    const widths = keys.map((key) => available * weight(key) / total);
    const need = Math.max(...keys.map((key, i) => height(key, widths[i], true)));
    const h = Math.min(area.h * (groups.top.length && groups.bottom.length ? 0.31 : 0.58), need);
    if (h < need - 0.5) squeezed = true;
    const y = edge === 'top' ? area.y : area.y + area.h - h;
    let x = area.x;
    keys.forEach((key, i) => {
      rects[key] = { x, y, w: widths[i], h };
      x += widths[i] + gap;
    });
    drawing.h -= h + gap;
    if (edge === 'top') drawing.y += h + gap;
  }

  for (const edge of ['left', 'right'] as const) {
    const keys = groups[edge];
    if (!keys.length) continue;
    const limit = Math.min(area.w * (groups.left.length && groups.right.length ? 0.31 : 0.42), 100);
    const width = clamp(Math.max(...keys.map((key) => {
      if (key === 'legend') return items > 7 ? 72 : 48;
      if (key === 'instructions') return Math.min(86, sideContentWidth(floor, variantId, { ...page, showLegend: false }));
      return key === 'numbers' ? 48 : 43;
    })), Math.min(limit, 47), limit);
    const x = edge === 'left' ? area.x : area.x + area.w - width;
    const natural = keys.map((key) => height(key, width, false));
    const available = drawing.h - gap * (keys.length - 1);
    const total = natural.reduce((sum, h) => sum + h, 0);
    const minHeight = (key: PrintBlock) => key === 'legend' || key === 'instructions' ? 17 : key === 'numbers' ? 16 : 14;
    const minimum = keys.reduce((sum, key) => sum + minHeight(key), 0);
    const fit = total <= available ? 1 : clamp((available - minimum) / Math.max(1, total - minimum), 0, 1);
    if (fit < 1) squeezed = true;
    let y = drawing.y;
    keys.forEach((key, i) => {
      const min = minHeight(key);
      const h = Math.max(1, available < minimum ? min * available / minimum : min + (natural[i] - min) * fit);
      rects[key] = { x, y, w: width, h };
      y += h + gap;
    });
    drawing.w -= width + gap;
    if (edge === 'left') drawing.x += width + gap;
  }
  return { rects, drawing, squeezed };
}

type LayoutResult = PageLayout & { squeezed: boolean };

/** Côté où se trouve un bloc par rapport à la zone du plan. */
function blockEdge(r: Rect, d: Rect): PrintBlockPosition {
  if (r.y >= d.y + d.h - 0.5) return 'bottom';
  if (r.y + r.h <= d.y + 0.5) return 'top';
  return r.x >= d.x + d.w - 0.5 ? 'right' : 'left';
}

/** Côté de repli d'un bloc : l'espace qui reste libre à côté du plan quand le bloc est sur son côté d'origine. */
const SPARE_EDGE: Record<PrintBlockPosition, PrintBlockPosition> = { bottom: 'right', top: 'right', left: 'bottom', right: 'bottom' };

/**
 * Mise en page de l'affiche. Quand les blocs laissent de grands vides à côté du plan (plan large au-dessus
 * d'un bandeau, plan en longueur à côté d'une colonne…), certains blocs passent dans cet espace libre si le
 * plan y gagne nettement en taille. Désactivable avec `page.fillSpace = false`.
 */
export function computeLayout(floor: Floor, variantId: string, page: PageSetup = floor.page, building?: Building): PageLayout {
  page = normalizePage(floor, page, building, variantId);
  const base = layoutOnce(floor, variantId, page);
  const fixed = floor.unitsPerMeter > 0 && page.scaleMode === 'fixed' && page.scale > 0;
  if (page.fillSpace === false || fixed || (!base.blocks && !base.side)) return strip(base);

  // Blocs affichés et côté qu'ils occupent dans la mise en page voulue.
  const edges: [PrintBlock, PrintBlockPosition][] = [];
  if (base.blocks) {
    for (const [key, r] of Object.entries(base.blocks) as [PrintBlock, Rect][]) edges.push([key, blockEdge(r, base.drawing)]);
  } else if (base.side) {
    const edge = blockEdge(base.side, base.drawing);
    const tb = floor.titleBlock;
    for (const [key, , flag] of PRINT_BLOCKS) {
      if (!page[flag] || (key === 'instructions' && !tb.instructions.trim())
        || (key === 'numbers' && (base.numbersInHeader || !tb.emergencyNumbers.trim()))) continue;
      edges.push([key, edge]);
    }
  }
  if (!edges.length) return strip(base);

  const area = (L: PageLayout) => L.world.w * L.k * L.world.h * L.k;
  let best: LayoutResult | null = null, bestScore = 0;
  const n = Math.min(edges.length, 5);
  for (let mask = 1; mask < 1 << n; mask++) {
    const map: PrintBlockPositions = {};
    const moved: PrintBlock[] = [];
    edges.forEach(([key, edge], i) => {
      const go = i < n && mask & (1 << i);
      map[key] = go ? SPARE_EDGE[edge] : edge;
      if (go) moved.push(key);
    });
    const L = layoutOnce(floor, variantId, { ...page, blockPositions: { ...page.blockPositions, [page.theme]: map } });
    if (L.squeezed && !base.squeezed) continue;
    // Chaque bloc déplacé doit se justifier : on préfère le moins de déplacements possible.
    const score = area(L) * Math.pow(0.9, moved.length);
    if (score > bestScore) { best = { ...L, relocated: moved }; bestScore = score; }
  }
  // On ne bouleverse la disposition choisie que si le plan y gagne vraiment (≥ 25 % de surface).
  return best && area(best) >= area(base) * 1.25 ? strip(best) : strip(base);
}

function strip({ squeezed: _squeezed, ...layout }: LayoutResult): PageLayout {
  return layout;
}

function layoutOnce(floor: Floor, variantId: string, page: PageSetup): LayoutResult {
  const paper = pageSizeMm(page);
  const s = PAPER_SCALE[page.paper] ?? 1;
  const w = paper.w / s, h = paper.h / s;
  const T = THEMES[page.theme] ?? THEMES.moderne;
  const m = page.marginMm / s;
  const G = T.gap;
  // Norme : le titre « Plan d'évacuation » atteint la hauteur de lettre minimale du format (l'en-tête grandit avec lui).
  const hs = normOn(page) ? Math.max(1, (ISO_TITLE_LETTER_MM[page.paper] ?? 13) / (11 * CAP_RATIO * s)) : 1;
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
  }
  if (page.showFooter ?? page.showTitleBlock) {
    footer = { x: x0, y: y1 - T.footerH, w: x1 - x0, h: T.footerH };
    y1 -= T.footerH + G;
  }
  const positions = page.blockPositions?.[page.theme];
  const hasPlacement = !!T.blockPosition || Object.values(positions ?? {}).some(Boolean);
  const hasSide = page.showLegend || page.showInstructions || page.showAerial || page.showSketch;
  const tb = floor.titleBlock;
  const numbers = page.showEmergencyNumbers ? tb.emergencyNumbers.trim() : '';
  // Numéros dans l'en-tête seulement s'ils y tiennent ; sans cadre latéral pour les accueillir, ils restent dans l'en-tête.
  const numbersInHeader = !!numbers && !!T.numbersInHeader && !!header
    && (hasPlacement ? !positions?.numbers && (T.printStyle
      ? numbers.length <= Math.max(24, Math.floor(header.w * 0.55))
      : numbersFitInHeader(page, T, w, header.w, hs, tb.title, numbers, !!tb.logo))
      : !hasSide || numbersFitInHeader(page, T, w, header.w, hs, tb.title || 'Plan d’évacuation', numbers, !!tb.logo));
  const numsInSide = !!numbers && !numbersInHeader;
  const positioned = hasPlacement || (!hasSide && numsInSide);

  const world = page.area === 'custom' && page.customArea.w > 0 && page.customArea.h > 0
    ? page.customArea
    : floorContentBounds(floor, variantId);
  const pad = T.planRadius ? 3 : 1.5;
  // Place réservée autour du plan : marges intérieures, flèche du nord (à droite), barre d'échelle (en bas).
  const reserveW = 2 * pad + (page.showNorth ? 17 : 0);
  const reserveH = 2 * pad + (page.showScaleBar && floor.unitsPerMeter > 0 ? 10 : 0);
  const kFixed = floor.unitsPerMeter > 0 && page.scaleMode === 'fixed' && page.scale > 0 ? 1000 / page.scale / floor.unitsPerMeter / s : 0;

  if (hasSide && !positioned) {
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
      // Un bandeau peu rempli ne réserve plus une hauteur minimale : la place libérée revient au plan.
      const sh = clamp(Math.min(need, Math.max(leftover, bandBase)), 0, H * 0.5);
      side = { x: x0, y: y1 - sh, w: W, h: sh };
      y1 -= sh + G;
    } else {
      // Même principe en colonne : un plan en hauteur laisse une colonne plus large (lignes plus longues).
      const colMin = page.orientation === 'portrait' ? colPortrait : colBase;
      const planNeed = world.w * (kFixed || (H - reserveH) / world.h) + reserveW;
      const leftover = W - G - planNeed;
      const roomy = clamp(Math.min(extra ? 112 : 100, Math.max(leftover, colMin)), colMin, W * 0.42);
      // La colonne se resserre sur son contenu (consignes et libellés de légende sur une ligne) :
      // la largeur ainsi libérée revient au plan au lieu de rester vide à droite des textes.
      const sw = clamp(sideContentWidth(floor, variantId, page), Math.min(colMin, extra ? 66 : 60), roomy);
      if (pos === 'left') { side = { x: x0, y: y0, w: sw, h: H }; x0 += sw + G; }
      else { side = { x: x1 - sw, y: y0, w: sw, h: H }; x1 -= sw + G; }
    }
  }
  const content = { x: x0, y: y0, w: Math.max(10, x1 - x0), h: Math.max(10, y1 - y0) };
  const placement = positioned ? positionedBlocks(floor, variantId, page, content, G, numbersInHeader) : undefined;
  const drawing = placement?.drawing ?? content;

  // Place réservée à la flèche du nord (coin haut droit) et à la barre d'échelle (coin bas gauche) :
  // chacune prend une bande sur le côté où le plan a de la marge (bande verticale si le plan est limité
  // par la hauteur, horizontale s'il l'est par la largeur), pour ne pas rapetisser le plan inutilement.
  const north = page.showNorth, bar = page.showScaleBar && floor.unitsPerMeter > 0;
  let inner = { x: drawing.x + pad, y: drawing.y + pad, w: drawing.w - 2 * pad, h: drawing.h - 2 * pad };
  let k = -1;
  for (const northTop of north ? [false, true] : [false]) {
    for (const barSide of bar ? [false, true] : [false]) {
      const r = { x: drawing.x + pad, y: drawing.y + pad, w: drawing.w - 2 * pad, h: drawing.h - 2 * pad };
      if (north) { if (northTop) { r.y += 20; r.h -= 20; } else r.w -= 17; }
      if (bar) { if (barSide) { r.x += 66; r.w -= 66; } else r.h -= 10; }
      const kr = Math.min(r.w / world.w, r.h / world.h);
      if (kr > k * 1.005) { k = kr; inner = r; }
    }
  }
  let scaleDenominator: number | null = null;
  if (floor.unitsPerMeter > 0) {
    if (page.scaleMode === 'fixed' && page.scale > 0) {
      k = 1000 / page.scale / floor.unitsPerMeter / s;
      scaleDenominator = page.scale;
    } else {
      scaleDenominator = 1000 / (k * s * floor.unitsPerMeter);
    }
  }
  // Feuille rognée au plan : le blanc inutile (haut/bas ou gauche/droite) est retiré de la page.
  let pw = w, ph = h;
  if (page.cropToPlan && !header && !footer && !side && !placement) {
    const exH = inner.h - world.h * k, exW = inner.w - world.w * k;
    if (exH > 0.5) { ph -= exH; inner = { ...inner, h: inner.h - exH }; }
    if (exW > 0.5) { pw -= exW; inner = { ...inner, w: inner.w - exW }; }
  }
  const dr = { ...drawing, w: drawing.w - (w - pw), h: drawing.h - (h - ph) };
  const tx = inner.x + (inner.w - world.w * k) / 2 - world.x * k;
  const ty = inner.y + (inner.h - world.h * k) / 2 - world.y * k;
  return { w: pw, h: ph, paperW: Math.round(pw * s * 10) / 10, paperH: Math.round(ph * s * 10) / 10, s, m, theme: T, header, footer, side, blocks: placement?.rects, drawing: dr, world, k, tx, ty, scaleDenominator, hs, numbersInHeader, squeezed: !!placement?.squeezed };
}

/** Taille réelle de la feuille (mm), en tenant compte du rognage au plan. */
export function sheetSizeMm(floor: Floor, variantId: string, page: PageSetup, building?: Building): { w: number; h: number } {
  page = normalizePage(floor, page, building, variantId);
  if (!page.cropToPlan) return pageSizeMm(page);
  const L = computeLayout(floor, variantId, page, building);
  return { w: L.paperW, h: L.paperH };
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
