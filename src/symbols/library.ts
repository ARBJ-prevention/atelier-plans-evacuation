/**
 * Bibliothèque de pictogrammes.
 *
 * 1. Signaux ISO 7010 officiels (src/symbols/iso7010/) — fichiers SVG issus de
 *    Wikimedia Commons, tous en domaine public ou CC0 (licence vérifiée par
 *    scripts/fetch-iso7010.mjs, source et auteur dans manifest.json).
 * 2. Pictogrammes complémentaires sans équivalent ISO 7010 (« Vous êtes ici »,
 *    nord, vannes, désenfumage…) et symboles de plan (mobilier, sanitaires,
 *    ascenseur) : dessins originaux, licence CC0.
 */
import manifest from './iso7010/manifest.json';

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

const RED = '#e30613';
const W = '#ffffff';
const INK = '#4b5866';
const bg = (c: string) => `<rect x="0" y="0" width="100" height="100" rx="3" fill="${c}"/>`;

const own = (id: string, name: string, category: string, svg: string, extra: Partial<SymbolDef> = {}): SymbolDef =>
  ({ id, name, category, kind: 'svg', svg, license: 'CC0 (dessin original)', ...extra });

const plan = (id: string, name: string, svg: string) =>
  own(id, name, 'Mobilier et équipements', `<g fill="#fff" stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${svg}</g>`, { planSymbol: true });

const EXTRA: SymbolDef[] = [
  own('you-are-here', 'Vous êtes ici', 'Repères', `
    <circle cx="50" cy="50" r="46" fill="${RED}" opacity="0.18"/>
    <circle cx="50" cy="50" r="33" fill="${RED}" stroke="${W}" stroke-width="7"/>
    <circle cx="50" cy="50" r="11" fill="${W}"/>`, { defaultLabel: 'Vous êtes ici' }),
  own('you-are-here-pin', 'Vous êtes ici (repère)', 'Repères', `
    <path d="M50 97 C50 97 19 61 19 39 A31 31 0 0 1 81 39 C81 61 50 97 50 97 Z" fill="${RED}" stroke="${W}" stroke-width="4"/>
    <circle cx="50" cy="39" r="12" fill="${W}"/>`, { defaultLabel: 'Vous êtes ici' }),
  own('north', 'Nord', 'Repères', `
    <circle cx="50" cy="54" r="34" fill="${W}" stroke="#1d2630" stroke-width="3"/>
    <path d="M50 22 L63 74 L50 64 L37 74 Z" fill="#1d2630"/>
    <path d="M50 22 L50 64 L37 74 Z" fill="#5d6b78"/>
    <text x="50" y="16" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="17" fill="#1d2630">N</text>`),
  own('alarm-sounder', 'Diffuseur d’alarme sonore', 'Lutte contre l’incendie', `${bg(RED)}
    <path d="M50 20 C35 20 31 34 31 49 L25 66 H75 L69 49 C69 34 65 20 50 20 Z" fill="${W}"/>
    <circle cx="50" cy="75" r="7" fill="${W}"/>
    <path d="M17 32 Q11 43 17 54 M83 32 Q89 43 83 54" fill="none" stroke="${W}" stroke-width="4" stroke-linecap="round"/>`),
  own('fire-blanket', 'Couverture anti-feu', 'Lutte contre l’incendie', `${bg(RED)}
    <rect x="27" y="16" width="46" height="24" rx="3" fill="${W}"/>
    <path d="M32 40 L28 86 H72 L68 40 Z" fill="${W}" opacity="0.88"/>
    <path d="M44 40 V52 M56 40 V52" stroke="${RED}" stroke-width="4"/>`),
  own('smoke-detector', 'Détecteur automatique', 'Lutte contre l’incendie', `${bg(RED)}
    <circle cx="50" cy="50" r="28" fill="none" stroke="${W}" stroke-width="7"/>
    <circle cx="50" cy="50" r="9" fill="${W}"/>`),
  own('smoke-vent', 'Commande de désenfumage', 'Repères', `<rect width="100" height="100" rx="3" fill="#ef7d00"/>
    <path d="M30 82 C20 68 40 62 32 48 C26 36 40 28 36 18 M52 82 C42 68 62 62 54 48 C48 36 62 28 58 18 M74 82 C64 68 84 62 76 48 C70 36 84 28 80 18" fill="none" stroke="${W}" stroke-width="6" stroke-linecap="round"/>`),
  own('electric-cutoff', 'Coupure électrique générale', 'Repères', `${bg(RED)}<path d="M57 12 L27 54 H48 L39 88 L73 42 H52 Z" fill="${W}"/>`),
  own('gas-cutoff', 'Vanne de coupure gaz', 'Repères', `<rect width="100" height="100" rx="3" fill="#ffd400"/>
    <circle cx="50" cy="38" r="17" fill="none" stroke="#111" stroke-width="6"/><path d="M50 21 V55 M33 38 H67" stroke="#111" stroke-width="6"/>
    <text x="50" y="87" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="22" fill="#111">GAZ</text>`),
  own('water-cutoff', 'Vanne de coupure eau', 'Repères', `<rect width="100" height="100" rx="3" fill="#0069b4"/>
    <circle cx="50" cy="38" r="17" fill="none" stroke="#fff" stroke-width="6"/><path d="M50 21 V55 M33 38 H67" stroke="#fff" stroke-width="6"/>
    <text x="50" y="87" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="22" fill="#fff">EAU</text>`),
  own('firefighter-key', 'Boîte à clés pompiers', 'Repères', `${bg(RED)}
    <circle cx="36" cy="40" r="16" fill="none" stroke="${W}" stroke-width="7"/>
    <path d="M48 52 L80 84 M66 70 L74 62 M74 78 L82 70" stroke="${W}" stroke-width="7" stroke-linecap="round"/>`),
  own('fire-panel', 'Centrale de détection incendie', 'Repères', `${bg(RED)}
    <rect x="18" y="22" width="64" height="56" rx="4" fill="none" stroke="${W}" stroke-width="6"/>
    <circle cx="34" cy="40" r="5" fill="${W}"/><circle cx="50" cy="40" r="5" fill="${W}"/><circle cx="66" cy="40" r="5" fill="${W}"/>
    <path d="M30 62 H70" stroke="${W}" stroke-width="6" stroke-linecap="round"/>`),

  plan('desk', 'Bureau', `<rect x="10" y="22" width="80" height="40" rx="2"/><path d="M38 70 h24 a6 6 0 0 1 6 6 v8 h-36 v-8 a6 6 0 0 1 6 -6z"/>`),
  plan('meeting-table', 'Table de réunion', `<rect x="22" y="30" width="56" height="40" rx="6"/>
    ${[30, 50, 70].map((x) => `<rect x="${x - 6}" y="14" width="12" height="11" rx="3"/><rect x="${x - 6}" y="75" width="12" height="11" rx="3"/>`).join('')}`),
  plan('round-table', 'Table ronde', `<circle cx="50" cy="50" r="22"/>${[0, 72, 144, 216, 288].map((a) => `<rect x="44" y="9" width="12" height="11" rx="3" transform="rotate(${a} 50 50)"/>`).join('')}`),
  plan('chair', 'Chaise', `<rect x="28" y="30" width="44" height="44" rx="6"/><path d="M28 28 h44" stroke-width="7"/>`),
  plan('sofa', 'Canapé', `<rect x="8" y="28" width="84" height="48" rx="8"/><rect x="18" y="40" width="64" height="30" rx="4"/>`),
  plan('cabinet', 'Armoire', `<rect x="10" y="30" width="80" height="40"/><path d="M50 30 V70 M10 30 L50 70 M90 30 L50 70" stroke-width="2"/>`),
  plan('bed', 'Lit', `<rect x="20" y="8" width="60" height="84" rx="3"/><rect x="28" y="14" width="44" height="16" rx="5"/><path d="M20 38 H80"/>`),
  plan('wc', 'WC', `<rect x="30" y="8" width="40" height="18" rx="3"/><ellipse cx="50" cy="56" rx="20" ry="28"/>`),
  plan('sink', 'Lavabo', `<rect x="18" y="26" width="64" height="48" rx="10"/><ellipse cx="50" cy="52" rx="20" ry="14"/><circle cx="50" cy="34" r="3"/>`),
  plan('shower', 'Douche', `<rect x="12" y="12" width="76" height="76"/><path d="M12 12 L88 88 M88 12 L12 88" stroke-width="1.5"/><circle cx="50" cy="50" r="6"/>`),
  plan('kitchen', 'Plan de travail / évier', `<rect x="6" y="30" width="88" height="40"/><rect x="54" y="36" width="32" height="28" rx="4"/><circle cx="24" cy="42" r="7"/><circle cx="24" cy="60" r="7"/><circle cx="40" cy="42" r="5"/><circle cx="40" cy="60" r="5"/>`),
  plan('elevator', 'Ascenseur', `<rect x="14" y="14" width="72" height="72"/><path d="M14 14 L86 86 M86 14 L14 86" stroke-width="2"/>`),
  plan('plant', 'Plante', `<circle cx="50" cy="50" r="30"/><path d="M50 20 V80 M20 50 H80 M29 29 L71 71 M71 29 L29 71" stroke-width="2"/>`),
  plan('printer', 'Imprimante / copieur', `<rect x="14" y="24" width="72" height="52" rx="4"/><rect x="28" y="34" width="44" height="18"/><path d="M28 64 H72"/>`),
];

export const BUILTIN_SYMBOLS: SymbolDef[] = [...ISO, ...EXTRA];

const BY_ID = new Map(BUILTIN_SYMBOLS.map((s) => [s.id, s]));

export function getBuiltinSymbol(id: string): SymbolDef | undefined {
  return BY_ID.get(id);
}

export const SYMBOL_CATEGORIES = [
  'Évacuation', 'Lutte contre l’incendie', 'Premiers secours', 'Interdictions et dangers', 'Repères', 'Mobilier et équipements',
].filter((c) => BUILTIN_SYMBOLS.some((s) => s.category === c));
