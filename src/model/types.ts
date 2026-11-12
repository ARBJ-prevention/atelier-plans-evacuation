/**
 * Modèle de données d'un projet « Atelier Plans d'Évacuation ».
 * Ce modèle est sérialisé tel quel (JSON) dans les fichiers .planevac.
 * Voir docs/FORMAT.md pour la documentation complète du format.
 *
 * Unités : les coordonnées sont exprimées en « unités plan » (u).
 * La correspondance avec la réalité est donnée par Floor.unitsPerMeter
 * (réglée par l'outil d'étalonnage).
 */

export type Pt = [number, number];

export type LayerId = 'background' | 'building' | 'symbols' | 'routes' | 'annotations';

export interface Layer {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
}

/** Style de trait. */
export type DashStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot' | 'longdash';
/** Motif de remplissage. */
export type FillPattern = 'solid' | 'none' | 'hatch' | 'crosshatch' | 'dots' | 'vertical';
export type ArrowStyle = 'triangle' | 'open' | 'stealth' | 'circle' | 'square' | 'chevrons';

export interface Shadow {
  enabled: boolean;
  color: string;
  opacity: number;
  blur: number;
  dx: number;
  dy: number;
}

export interface BaseElement {
  id: string;
  type: string;
  layer: LayerId;
  /** Rotation en degrés (sens horaire) autour du centre / point d'ancrage. */
  rotation: number;
  locked?: boolean;
  groupId?: string;
  /** Si défini, l'élément n'apparaît que dans cette version du plan. */
  variantId?: string;
  excludedVariantIds?: string[];
  /** Opacité globale (0 à 1, défaut 1). */
  opacity?: number;
  shadow?: Shadow;
  flipX?: boolean;
  flipY?: boolean;
}

export interface WallElement extends BaseElement {
  type: 'wall';
  points: Pt[];
  thickness: number;
  color: string;
  /** plein, hachuré (mur porteur), contour seul */
  wallStyle: 'solid' | 'hatch' | 'outline';
  closed: boolean;
}

export interface AreaElement extends BaseElement {
  type: 'area';
  kind: 'room' | 'zone';
  points: Pt[];
  fill: string;
  fillOpacity: number;
  pattern: FillPattern;
  patternColor: string;
  stroke: string;
  strokeWidth: number;
  dash: DashStyle;
  label: string;
  labelSize: number;
  labelColor: string;
  labelBold: boolean;
  /** Affiche la surface (m²) sous le nom si l'échelle est étalonnée. */
  showArea: boolean;
  /** Décalage du nom par rapport au centre de la pièce. */
  labelDx: number;
  labelDy: number;
}

export interface DoorElement extends BaseElement {
  type: 'door';
  x: number;
  y: number;
  width: number;
  swing: 'left' | 'right';
  doorType: 'single' | 'double' | 'sliding' | 'revolving' | 'opening';
  /** Issue de secours : marquage vert sur le seuil. */
  emergency: boolean;
  /** Porte coupe-feu : marquage rouge sur le seuil et libellé. */
  fireRated: boolean;
  /** Libellé affiché à côté d'une porte coupe-feu (« CF », « EI 30 »…) ; vide = aucun libellé. */
  fireRating: string;
  color: string;
}

export interface WindowElement extends BaseElement {
  type: 'window';
  x: number;
  y: number;
  width: number;
  depth: number;
  panes: number;
  color: string;
  /** Volet côté extérieur (côté A ; flipY : côté B). Absent = aucun volet. */
  shutter?: 'none' | 'rolling' | 'hinged';
}

export interface StairsElement extends BaseElement {
  type: 'stairs';
  x: number;
  y: number;
  w: number;
  h: number;
  steps: number;
  color: string;
  fill: string;
  arrow: boolean;
  /** Séparation centrale dans le sens de la longueur (escalier à deux côtés). */
  split?: boolean;
  stairType: 'straight' | 'landing' | 'escalator';
  label: string;
}

export interface SymbolElement extends BaseElement {
  type: 'symbol';
  x: number;
  y: number;
  size: number;
  symbolId: string;
  label: string;
  labelPosition: 'below' | 'above' | 'right' | 'left';
  labelSize: number;
  labelColor: string;
  /** Pastille blanche derrière le pictogramme (lisibilité sur fond chargé). */
  halo: boolean;
  /** Étirement horizontal / vertical (1 = proportions d'origine). */
  stretchX?: number;
  stretchY?: number;
  /** Fusion avec les panneaux collés (pas de liseré ni de coin arrondi du côté commun). Par défaut : oui. */
  fuse?: boolean;
}

export interface RouteElement extends BaseElement {
  type: 'route';
  points: Pt[];
  color: string;
  width: number;
  dash: DashStyle;
  arrowEnd: boolean;
  arrowStart: boolean;
  arrowStyle: ArrowStyle;
  arrowSize: number;
  /** Flèches répétées le long du tracé (espacement en u, 0 = aucune). */
  arrowRepeat: number;
  corner: 'round' | 'miter' | 'bevel';
  /** Rayon des virages (u) : segments droits raccordés par des arcs, 0 = angles nets. */
  cornerRadius: number;
  /** Liseré autour du tracé (lisibilité), '' = aucun. */
  outline: string;
  smooth: boolean;
  kind: 'principal' | 'secondaire';
}

export interface TextElement extends BaseElement {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  uppercase: boolean;
  align: 'start' | 'middle' | 'end';
  lineHeight: number;
  letterSpacing: number;
  background: string; // '' = transparent
  border: boolean;
  borderColor: string;
  radius: number;
  padding: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  src: string; // data URL
  radius: number;
  border: string; // '' = aucun
}

export interface LegendElement extends BaseElement {
  type: 'legend';
  x: number;
  y: number;
  fontSize: number;
  title: string;
  columns: number;
  background: string;
  border: string;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'line' | 'arrow' | 'star';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  fillOpacity: number;
  pattern: FillPattern;
  patternColor: string;
  stroke: string;
  strokeWidth: number;
  dash: DashStyle;
  radius: number;
  text: string;
  textSize: number;
  textColor: string;
}

export type Element =
  | WallElement
  | AreaElement
  | DoorElement
  | WindowElement
  | StairsElement
  | SymbolElement
  | RouteElement
  | TextElement
  | ImageElement
  | LegendElement
  | ShapeElement;

export type ElementType = Element['type'];

export interface Background {
  src: string; // data URL (PNG / JPEG ; les PDF sont rastérisés à l'import)
  sourceName: string;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
  /** Unités plan par pixel d'image. */
  scale: number;
  opacity: number;
  locked: boolean;
  /** Niveaux de gris (atténue les couleurs du plan source). */
  grayscale: boolean;
  /** Plan vectoriel importé d'un fichier DAO (DXF ou DWG) à l'échelle réelle ; absent pour une image / un PDF. */
  vector?: VectorSource;
}

export interface VectorSource {
  /** Format du fichier importé (un DWG est converti en DXF à l'import). */
  format: 'dxf' | 'dwg';
  /** Unité du dessin source : mm, cm, dm, m, in, ft. */
  unit: string;
  /** L'unité était indiquée dans le fichier (sinon choisie par l'utilisateur). */
  unitDeclared: boolean;
  /** Dimensions réelles en mètres. */
  widthM: number;
  heightM: number;
  /** Calques importés. */
  layers: string[];
}

export interface Variant {
  id: string;
  name: string;
}

export type ValidationStatus = 'draft' | 'to_validate' | 'validated';

export interface TitleBlock {
  title: string;
  subtitle: string;
  author: string;
  organization: string;
  date: string; // AAAA-MM-JJ
  version: string;
  status: ValidationStatus;
  validatedBy: string;
  validatedAt: string; // ISO
  validationReason?: string;
  instructions: string; // consignes (texte multi-lignes)
  emergencyNumbers: string; // ex. « Pompiers 112 · Police 101 »
  logo: string; // data URL ou ''
  /** Vue aérienne (photo satellite / vue du ciel) du site : data URL ou ''. */
  aerialImage: string;
}

export type PaperSize = 'A4' | 'A3' | 'A2';
/** Zones de la page qui peuvent être entourées d'un cadre. */
export type FrameKey = 'plan' | 'legend' | 'instructions' | 'aerial' | 'sketch' | 'footer';

export type PageTheme = 'moderne' | 'epure' | 'institutionnel' | 'signaletique' | 'encadre' | 'bandeaux' | 'technique' | 'horizon' | 'editorial';

export interface PageSetup {
  paper: PaperSize;
  orientation: 'portrait' | 'landscape';
  marginMm: number;
  scaleMode: 'fit' | 'fixed';
  /** Dénominateur d'échelle (1:N) quand scaleMode = 'fixed'. */
  scale: number;
  area: 'auto' | 'custom';
  customArea: { x: number; y: number; w: number; h: number };
  theme: PageTheme;
  accentColor: string;
  planBackground: string;
  sidePosition: 'right' | 'left' | 'bottom';
  showTitleBlock: boolean;
  showLegend: boolean;
  showInstructions: boolean;
  showEmergencyNumbers: boolean;
  showWatermark: boolean;
  showScaleBar: boolean;
  showNorth: boolean;
  northAngle: number;
  showFrame: boolean;
  /** Zones entourées d'un cadre, cochées par l'utilisateur (zone absente = choix du thème). */
  frames?: Partial<Record<FrameKey, boolean>>;
  /** Cadre « Vue aérienne du site » dans le panneau latéral. */
  showAerial: boolean;
  /** Croquis de situation : miniature simplifiée de l'étage avec « Vous êtes ici ». */
  showSketch: boolean;
}

export interface Floor {
  id: string;
  name: string;
  level: number;
  unitsPerMeter: number; // 0 = non étalonné
  background: Background | null;
  layers: Layer[];
  elements: Element[];
  variants: Variant[];
  titleBlock: TitleBlock;
  page: PageSetup;
}

export interface Building {
  id: string;
  name: string;
  address: string;
  floors: Floor[];
}

export interface CustomSymbol {
  id: string;
  name: string;
  category: string;
  src: string; // data URL (image/svg+xml, png, jpeg)
}

export interface Project {
  format: 'atelier-evac';
  formatVersion: number;
  id: string;
  name: string;
  country: string;
  createdAt: string;
  updatedAt: string;
  buildings: Building[];
  customSymbols: CustomSymbol[];
}

export const FORMAT_ID = 'atelier-evac';
export const BASE_FORMAT_VERSION = 2;
export const FORMAT_VERSION = 3;
