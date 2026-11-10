import { defaultLayers, defaultPage, defaultTitleBlock, elementDefaults, newVariant, uid } from './defaults';
import type { Building, Element, Floor, Project } from './types';
import { FORMAT_ID, FORMAT_VERSION } from './types';

export class ProjectFormatError extends Error {}

export function serializeProject(p: Project): string {
  return JSON.stringify({ ...p, format: FORMAT_ID, formatVersion: FORMAT_VERSION }, null, 1);
}

/**
 * Lit un fichier projet, vérifie sa structure et complète les champs
 * manquants (compatibilité ascendante). Lève ProjectFormatError si le
 * contenu n'est pas un projet valide.
 */
export function parseProject(text: string): Project {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('Le fichier n’est pas un JSON valide (fichier endommagé ?).');
  }
  if (!raw || typeof raw !== 'object' || raw.format !== FORMAT_ID) {
    throw new ProjectFormatError('Ce fichier n’est pas un projet Atelier Plans d’Évacuation.');
  }
  if (typeof raw.formatVersion !== 'number' || raw.formatVersion > FORMAT_VERSION) {
    throw new ProjectFormatError(
      `Ce projet a été créé avec une version plus récente du logiciel (format ${raw.formatVersion}). Mettez le logiciel à jour.`,
    );
  }
  if (!Array.isArray(raw.buildings)) throw new ProjectFormatError('Structure invalide : liste des bâtiments absente.');
  return migrate(raw);
}

const KNOWN_TYPES = new Set(['wall', 'area', 'door', 'window', 'stairs', 'symbol', 'route', 'text', 'image', 'legend', 'shape']);

/** Correspondance des pictogrammes de la version 1 vers les pictogrammes ISO 7010 officiels. */
export const LEGACY_SYMBOLS: Record<string, string> = {
  exit: 'iso-E002', 'exit-left': 'iso-E001', arrow: 'iso-arrow', 'emergency-stairs': 'iso-E002', assembly: 'iso-E007',
  extinguisher: 'iso-F001', 'hose-reel': 'iso-F002', 'alarm-button': 'iso-F005', 'fire-phone': 'iso-F006',
  'first-aid': 'iso-E003', aed: 'iso-E010', 'eye-wash': 'iso-E011', 'safety-shower': 'iso-E012', 'no-elevator': 'iso-P020',
  'alarm-bell': 'alarm-sounder', 'fire-blanket': 'fire-blanket',
};

/** Complète un élément avec les valeurs par défaut de son type (anciens fichiers). */
function migrateElement(e: any): Element {
  const out: any = { ...elementDefaults(e.type), ...e };
  if (typeof e.dashed === 'boolean' && !e.dash) out.dash = e.dashed ? 'dashed' : 'solid';
  delete out.dashed;
  if (e.type === 'door' && typeof e.double === 'boolean' && !e.doorType) out.doorType = e.double ? 'double' : 'single';
  delete out.double;
  if (e.type === 'symbol' && LEGACY_SYMBOLS[e.symbolId]) out.symbolId = LEGACY_SYMBOLS[e.symbolId];
  return out as Element;
}

function migrate(raw: any): Project {
  const country = typeof raw.country === 'string' ? raw.country : 'BE';
  const p: Project = {
    format: FORMAT_ID,
    formatVersion: FORMAT_VERSION,
    id: String(raw.id || uid('prj')),
    name: String(raw.name ?? 'Projet'),
    country,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
    customSymbols: Array.isArray(raw.customSymbols) ? raw.customSymbols : [],
    buildings: raw.buildings.map((b: any): Building => ({
      id: String(b.id || uid('bld')),
      name: String(b.name ?? 'Bâtiment'),
      address: String(b.address ?? ''),
      floors: (Array.isArray(b.floors) ? b.floors : []).map((f: any): Floor => {
        const layersById = new Map((Array.isArray(f.layers) ? f.layers : []).map((l: any) => [l.id, l]));
        const variants = Array.isArray(f.variants) && f.variants.length ? f.variants : [newVariant()];
        return {
          id: String(f.id || uid('flr')),
          name: String(f.name ?? 'Étage'),
          level: Number(f.level ?? 0),
          unitsPerMeter: Number(f.unitsPerMeter ?? 0),
          background: f.background ? { grayscale: false, ...f.background } : null,
          layers: defaultLayers().map((l) => ({ ...l, ...(layersById.get(l.id) as object | undefined), name: l.name })),
          elements: Array.isArray(f.elements) ? f.elements.filter((e: any) => e && e.id && KNOWN_TYPES.has(e.type)).map(migrateElement) : [],
          variants,
          titleBlock: { ...defaultTitleBlock(country), ...(f.titleBlock ?? {}) },
          page: { ...defaultPage(), ...(f.page ?? {}) },
        };
      }),
    })),
  };
  return p;
}

/** Copie profonde avec de nouveaux identifiants (duplication de projet). */
export function cloneProjectWithNewIds(p: Project, newName: string): Project {
  const copy: Project = JSON.parse(JSON.stringify(p));
  copy.id = uid('prj');
  copy.name = newName;
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  return copy;
}

/** Copie profonde d'un étage avec de nouveaux identifiants. */
export function cloneFloorWithNewIds(f: Floor, newName: string): Floor {
  const copy: Floor = JSON.parse(JSON.stringify(f));
  copy.id = uid('flr');
  copy.name = newName;
  const varMap = new Map<string, string>();
  copy.variants = copy.variants.map((v) => { const id = uid('var'); varMap.set(v.id, id); return { ...v, id }; });
  const grpMap = new Map<string, string>();
  copy.elements = copy.elements.map((e) => {
    const n = { ...e, id: uid('el') };
    if (n.variantId) n.variantId = varMap.get(n.variantId);
    if (n.groupId) { if (!grpMap.has(n.groupId)) grpMap.set(n.groupId, uid('grp')); n.groupId = grpMap.get(n.groupId); }
    return n;
  });
  copy.titleBlock.status = 'draft';
  copy.titleBlock.validatedAt = '';
  copy.titleBlock.validatedBy = '';
  return copy;
}

/** Forme canonique (clés triées) pour comparer deux projets indépendamment de l'ordre des champs. */
export function canonicalJson(value: unknown): string {
  const sort = (v: any): any =>
    Array.isArray(v) ? v.map(sort)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sort(v[k])]))
    : v;
  return JSON.stringify(sort(value));
}
