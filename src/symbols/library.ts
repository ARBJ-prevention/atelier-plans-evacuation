/**
 * Bibliothèque de pictogrammes.
 *
 * 1. Signaux ISO 7010 officiels (src/symbols/iso7010/) — fichiers SVG issus de
 *    Wikimedia Commons, tous en domaine public ou CC0 (licence vérifiée par
 *    scripts/fetch-iso7010.mjs, source et auteur dans manifest.json).
 * 2. Pictogrammes complémentaires et symboles de plan (src/symbols/drawn.ts) :
 *    dessins originaux pour les éléments sans équivalent ISO 7010 (BAES, colonnes
 *    sèches, coupures…), structure, mobilier, sanitaires, équipements. Licence CC0.
 */
import manifest from './iso7010/manifest.json';
import { CAT, DRAWN_SYMBOLS } from './drawn';

export interface SymbolDef {
  id: string;
  name: string;
  category: string;
  /** 'iso' = fichier SVG officiel ; 'svg' = fragment dessiné dans une boîte 0 0 100 100. */
  kind: 'iso' | 'svg';
  /** Data URL (iso) ou fragment SVG (svg). */
  svg: string;
  code?: string;
  license: string;
  author?: string;
  source?: string;
  defaultLabel?: string;
  /** Symbole de plan (mobilier…) : non listé dans la légende par défaut. */
  planSymbol?: boolean;
}

const files = import.meta.glob('./iso7010/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const svgToDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const ISO: SymbolDef[] = (manifest as any[])
  .filter((m) => files[`./iso7010/${m.id}.svg`])
  .map((m) => ({
    id: m.id, name: m.name, category: m.category, kind: 'iso' as const, code: /^[A-Z]\d{3}$/.test(m.code) ? m.code : undefined,
    svg: svgToDataUrl(files[`./iso7010/${m.id}.svg`]), license: m.license, author: m.author, source: m.source,
  }));


export const BUILTIN_SYMBOLS: SymbolDef[] = [...ISO, ...DRAWN_SYMBOLS];

const BY_ID = new Map(BUILTIN_SYMBOLS.map((s) => [s.id, s]));

export function getBuiltinSymbol(id: string): SymbolDef | undefined {
  return BY_ID.get(id);
}

/** Ordre d'affichage des catégories : signalisation de sécurité d'abord, puis repères, puis symboles de plan. */
export const SYMBOL_CATEGORIES: string[] = [
  CAT.evac, CAT.fire, CAT.aid, CAT.ban, CAT.danger, CAT.must,
  CAT.marks, CAT.cutoffs, CAT.structure, CAT.furniture, CAT.sanitary, CAT.technical,
].filter((c) => BUILTIN_SYMBOLS.some((s) => s.category === c));

/** Symboles classés selon SYMBOL_CATEGORIES (pour les listes déroulantes). */
export const SYMBOLS_BY_CATEGORY: [string, SymbolDef[]][] =
  SYMBOL_CATEGORIES.map((c) => [c, BUILTIN_SYMBOLS.filter((s) => s.category === c)]);
