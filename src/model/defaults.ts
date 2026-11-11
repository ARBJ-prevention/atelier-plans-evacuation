import { getCountry } from './countries';
import type {
  Building, Element, Floor, Layer, LayerId, PageSetup, Project, Shadow, TitleBlock, Variant,
} from './types';
import { BASE_FORMAT_VERSION, FORMAT_ID } from './types';

export function uid(prefix = ''): string {
  const r = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36))
    .replace(/-/g, '')
    .slice(0, 12);
  return prefix ? `${prefix}_${r}` : r;
}

export const LAYER_NAMES: Record<LayerId, string> = {
  background: 'Plan de fond',
  building: 'Bâtiment',
  symbols: 'Pictogrammes',
  routes: 'Itinéraires',
  annotations: 'Textes et annotations',
};

/** Ordre de dessin (du dessous vers le dessus). */
export const LAYER_ORDER: LayerId[] = ['background', 'building', 'routes', 'symbols', 'annotations'];

export function defaultLayers(): Layer[] {
  return LAYER_ORDER.map((id) => ({ id, name: LAYER_NAMES[id], visible: true, locked: false }));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const EMERGENCY_NUMBERS: Record<string, string> = {
  BE: 'Urgences 112 · Police 101 · Centre Antipoisons 070 245 245',
  FR: 'Urgences 112 · Pompiers 18 · SAMU 15 · Police 17',
  CH: 'Pompiers 118 · Ambulance 144 · Police 117',
  LU: 'Urgences 112 · Police 113',
  INT: 'Urgences 112',
};

export function defaultTitleBlock(country: string): TitleBlock {
  return {
    title: "Plan d'évacuation",
    subtitle: '',
    author: '',
    organization: '',
    date: today(),
    version: '1.0',
    status: 'draft',
    validatedBy: '',
    validatedAt: '',
    instructions: getCountry(country).instructions,
    emergencyNumbers: EMERGENCY_NUMBERS[country] ?? EMERGENCY_NUMBERS.INT,
    logo: '',
    aerialImage: '',
  };
}

export function defaultPage(): PageSetup {
  return {
    paper: 'A4',
    orientation: 'landscape',
    marginMm: 8,
    scaleMode: 'fit',
    scale: 100,
    area: 'auto',
    customArea: { x: 0, y: 0, w: 1000, h: 700 },
    theme: 'moderne',
    accentColor: '#00843d',
    planBackground: '#ffffff',
    sidePosition: 'right',
    showTitleBlock: true,
    showLegend: true,
    showInstructions: true,
    showEmergencyNumbers: true,
    showWatermark: true,
    showScaleBar: true,
    showNorth: false,
    northAngle: 0,
    showFrame: true,
    showAerial: false,
    showSketch: false,
  };
}

export function defaultShadow(): Shadow {
  return { enabled: false, color: '#000000', opacity: 0.25, blur: 6, dx: 3, dy: 3 };
}

export function newVariant(name = 'Version 1'): Variant {
  return { id: uid('var'), name };
}

export function newFloor(name: string, level: number, country: string): Floor {
  return {
    id: uid('flr'),
    name,
    level,
    unitsPerMeter: 0,
    background: null,
    layers: defaultLayers(),
    elements: [],
    variants: [newVariant()],
    titleBlock: defaultTitleBlock(country),
    page: defaultPage(),
  };
}

export function newBuilding(name: string, country: string): Building {
  return { id: uid('bld'), name, address: '', floors: [newFloor('Niveau 0', 0, country)] };
}

export function newProject(name = 'Nouveau projet', country = 'BE'): Project {
  const now = new Date().toISOString();
  return {
    format: FORMAT_ID,
    formatVersion: BASE_FORMAT_VERSION,
    id: uid('prj'),
    name,
    country,
    createdAt: now,
    updatedAt: now,
    buildings: [newBuilding('Bâtiment principal', country)],
    customSymbols: [],
  };
}

export const FONTS = [
  'Segoe UI', 'Segoe UI Semibold', 'Arial', 'Arial Narrow', 'Calibri', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Bahnschrift', 'Georgia', 'Consolas',
];

/** Valeurs par défaut de chaque type d'élément (utilisées aussi pour compléter les anciens fichiers). */
export function elementDefaults(type: Element['type'], routeColor = '#00843d'): Record<string, unknown> {
  const common = { rotation: 0, opacity: 1 };
  switch (type) {
    case 'wall':
      return { ...common, layer: 'building', points: [], thickness: 12, color: '#1d2630', wallStyle: 'solid', closed: false };
    case 'area':
      return {
        ...common, layer: 'building', kind: 'room', points: [], fill: '#eef2f6', fillOpacity: 1, pattern: 'solid', patternColor: '#9aa7b4',
        stroke: '#8795a3', strokeWidth: 1.5, dash: 'solid', label: '', labelSize: 16, labelColor: '#3b4754', labelBold: false, showArea: false, labelDx: 0, labelDy: 0,
      };
    case 'door':
      return { ...common, layer: 'building', x: 0, y: 0, width: 90, swing: 'left', doorType: 'single', emergency: false, fireRated: false, fireRating: 'CF', color: '#1d2630' };
    case 'window':
      return { ...common, layer: 'building', x: 0, y: 0, width: 120, depth: 12, panes: 2, color: '#1d2630' };
    case 'stairs':
      return { ...common, layer: 'building', x: 0, y: 0, w: 120, h: 240, steps: 10, color: '#3b4754', fill: '#ffffff', arrow: true, split: false, stairType: 'straight', label: '' };
    case 'symbol':
      return { ...common, layer: 'symbols', x: 0, y: 0, size: 44, symbolId: 'iso-E002', label: '', labelPosition: 'below', labelSize: 0, labelColor: '#111111', halo: false };
    case 'route':
      return {
        ...common, layer: 'routes', points: [], color: routeColor, width: 8, dash: 'solid', arrowEnd: true, arrowStart: false,
        arrowStyle: 'triangle', arrowSize: 1, arrowRepeat: 0, corner: 'round', cornerRadius: 0, outline: '', smooth: false, kind: 'principal',
      };
    case 'text':
      return {
        ...common, layer: 'annotations', x: 0, y: 0, text: 'Texte', fontFamily: 'Segoe UI', fontSize: 20, color: '#111111',
        bold: false, italic: false, underline: false, uppercase: false, align: 'start', lineHeight: 1.25, letterSpacing: 0,
        background: '', border: false, borderColor: '#111111', radius: 4, padding: 0.4,
      };
    case 'image':
      return { ...common, layer: 'annotations', x: 0, y: 0, w: 160, h: 100, src: '', radius: 0, border: '' };
    case 'legend':
      return { ...common, layer: 'annotations', x: 0, y: 0, fontSize: 14, title: 'Légende', columns: 1, background: '#ffffff', border: '#333333' };
    case 'shape':
      return {
        ...common, layer: 'annotations', shape: 'rect', x: 0, y: 0, w: 160, h: 100, fill: '#e3f3ea', fillOpacity: 1, pattern: 'solid',
        patternColor: '#00843d', stroke: '#00843d', strokeWidth: 2, dash: 'solid', radius: 0, text: '', textSize: 16, textColor: '#111111',
      };
  }
}

/** Nouvel élément créé par les outils. */
export function makeElement(type: Element['type'], props: Record<string, unknown>, routeColor = '#00843d'): Element {
  return { id: uid('el'), type, ...elementDefaults(type, routeColor), ...props } as Element;
}
