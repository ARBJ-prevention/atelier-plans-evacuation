/**
 * Pictogrammes dessinés pour ce logiciel (dessins originaux, licence CC0 1.0).
 *
 * Chaque fragment SVG est dessiné dans une boîte 0 0 100 100.
 * - Signaux complémentaires (fond coloré) : éléments sans équivalent ISO 7010
 *   (BAES, colonnes sèches, coupures, désenfumage…). Ils apparaissent dans la légende.
 * - Symboles de plan (trait gris sur fond blanc) : structure du bâtiment, mobilier,
 *   sanitaires et équipements. Ils ne sont pas listés dans la légende par défaut.
 */
import type { SymbolDef } from './library';

export const CAT = {
  evac: 'Évacuation',
  fire: 'Lutte contre l’incendie',
  aid: 'Premiers secours',
  ban: 'Interdictions',
  danger: 'Dangers',
  must: 'Obligations',
  marks: 'Repères',
  cutoffs: 'Coupures et commandes',
  structure: 'Structure du bâtiment',
  furniture: 'Mobilier',
  sanitary: 'Sanitaires et cuisine',
  technical: 'Équipements techniques',
} as const;

const RED = '#e30613';
const GREEN = '#009a44';
const ORANGE = '#ef7d00';
const W = '#ffffff';
const INK = '#4b5866';
const FONT = 'font-family="Segoe UI, Arial" font-weight="700" text-anchor="middle"';
const bg = (c: string) => `<rect x="0" y="0" width="100" height="100" rx="3" fill="${c}"/>`;
const label = (t: string, y: number, size: number, fill = W) => `<text x="50" y="${y}" ${FONT} font-size="${size}" fill="${fill}">${t}</text>`;
/** Texte dans un symbole de plan (annule le trait hérité du groupe). */
const planText = (t: string, x: number, y: number, size: number, fill = INK) =>
  `<text x="${x}" y="${y}" ${FONT} font-size="${size}" fill="${fill}" stroke="none">${t}</text>`;

const own = (id: string, name: string, category: string, svg: string, extra: Partial<SymbolDef> = {}): SymbolDef =>
  ({ id, name, category, kind: 'svg', svg, license: 'CC0 (dessin original)', ...extra });

const plan = (id: string, name: string, category: string, svg: string) =>
  own(id, name, category, `<g fill="#fff" stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${svg}</g>`, { planSymbol: true });

/** Silhouette d'extincteur (blanc) pour les variantes par agent extincteur. */
const extinguisher = `
  <rect x="38" y="24" width="24" height="46" rx="9" fill="${W}"/>
  <rect x="44" y="14" width="12" height="11" rx="2" fill="${W}"/>
  <path d="M56 17 H68 L72 24 M44 18 C30 18 28 32 30 44" fill="none" stroke="${W}" stroke-width="4" stroke-linecap="round"/>`;
const valve = (stroke: string) =>
  `<circle cx="50" cy="38" r="17" fill="none" stroke="${stroke}" stroke-width="6"/><path d="M50 21 V55 M33 38 H67" stroke="${stroke}" stroke-width="6"/>`;
const doorLeaf = (extra = '') => `
  <path d="M4 85 H15 M85 85 H96" stroke-width="7"/>
  <path d="M15 85 V15" stroke-width="5"/>
  <path d="M15 15 A70 70 0 0 1 85 85" fill="none" stroke-width="2" stroke-dasharray="5 4"/>${extra}`;
const doubleDoor = (extra = '') => `
  <path d="M2 85 H10 M90 85 H98" stroke-width="7"/>
  <path d="M10 85 V45 M90 85 V45" stroke-width="5"/>
  <path d="M10 45 A40 40 0 0 1 50 85 M90 45 A40 40 0 0 0 50 85" fill="none" stroke-width="2" stroke-dasharray="5 4"/>${extra}`;


/** Silhouette « personne courant vers une porte » des signaux ISO 7010 E002 (domaine public, MaxxL / Wikimedia Commons), coordonnées d’origine (boîte ≈ x 78–150, y 80–173). */
const EXIT_MAN_E002 = "m 88.897663,80.709657 v 60.715533 c -6.316373,0.48241 -10.5308,5.63536 -10.5308,10.31517 v 2.4687 l 2.468698,-0.006 8.062102,-0.0182 v 12.73893 l -6.082136,5.9854 h 40.129013 l 7.43227,-7.11934 h 9.2387 l -7.43284,7.11934 h 11.45592 l 6.08214,-5.98542 V 125.1738 h -10.66451 c -0.0833,5.9e-4 -0.16247,0.004 -0.24579,0.004 -0.0556,0 -0.0832,-0.007 -0.13598,-0.008 -0.0349,-5.8e-4 -0.0686,-0.002 -0.10294,-0.004 -1.43847,-0.0274 -1.75019,-0.28172 -2.77878,-1.31031 l -6.24145,-7.37766 c -1.73064,3.78552 -3.36138,7.00437 -5.08475,10.65995 -0.19459,0.37374 -0.65441,1.21334 -0.30951,1.86731 l 17.15286,34.63575 -6.29263,-0.021 c -3.29001,0.0726 -4.66137,-2.19803 -5.81814,-4.23075 -4.63991,-9.35178 -9.30161,-18.69659 -13.94909,-28.04895 l -0.87733,16.64253 c -0.22955,2.88042 -2.17565,3.61243 -4.72575,3.69137 l -28.817027,0.0659 c 0,-3.31243 3.281927,-7.68712 8.626505,-7.89482 0,0 10.292026,0.11556 15.673012,0.13711 0.68225,0 0.86922,-0.38098 0.94846,-0.94845 0.24993,-4.28189 0.48763,-8.59103 0.7533,-12.87205 0.16632,-2.12536 0.3528,-3.59821 0.96949,-5.20708 2.0106,-4.31016 4.02228,-8.59953 6.03491,-12.89424 l -7.36399,-0.0859 c -0.19342,-0.007 -0.34356,0.0358 -0.44435,0.20823 l -5.32998,9.33771 c -2.198192,4.00865 -8.138332,1.08508 -6.148138,-3.16681 l 6.536168,-10.93249 c 1.14949,-1.70937 1.6747,-2.29896 4.66145,-2.39188 0,0 13.95626,-0.0222 20.94497,-0.0222 v -5.8e-4 c 2.27014,-0.0504 2.52919,0.66163 3.61401,1.81782 2.91625,3.5982 6.10478,7.43502 8.94966,10.7891 0.3953,0.47396 0.61745,0.67583 1.55836,0.66796 1.74231,-0.0292 3.27034,0.002 4.6188,0.0808 h 4.28821 V 80.709277 Z m 38.649157,8.33748 c 4.00109,0 7.06757,3.07482 7.06757,7.09658 0,4.029633 -3.06678,7.103983 -7.06757,7.103983 -4.00049,0 -7.07496,-3.07435 -7.07496,-7.103983 0,-4.02205 3.07447,-7.09658 7.07496,-7.09658 z";
/** Luminaire d’éclairage de sécurité (bloc + panneau vert + flèche + halo), d’après le pictogramme fourni. */
const exitLuminaire = `
    <rect x="9" y="17" width="82" height="7" rx="2.5" fill="#34414c"/>
    <rect x="12" y="18.6" width="76" height="2.6" rx="1.3" fill="#8b98a3"/>
    <rect x="12" y="23" width="76" height="47" rx="4" fill="#34414c"/>
    <rect x="15" y="26" width="70" height="41" rx="2" fill="#e9eef1"/>
    <rect x="16.5" y="27.5" width="67" height="34" rx="1.5" fill="#0b7d3e"/>
    <rect x="16.5" y="61.5" width="67" height="4" rx="1" fill="#fff1bf"/>
    <path d="${EXIT_MAN_E002}" fill="${W}" transform="translate(19.5 30.5) scale(0.31) translate(-78.4 -80.7)"/>
    <path d="M50 41 H68 V34.5 L80.5 44.5 L68 54.5 V48 H50 Z" fill="${W}"/>
    <path d="M30 75 L27 82 M50 75 V83 M70 75 L73 82" stroke="#d4a017" stroke-width="2.6" stroke-linecap="round"/>`;

export const DRAWN_SYMBOLS: SymbolDef[] = [
  // ── Évacuation ─────────────────────────────────────────────────────────────
  own('baes', 'Bloc d’éclairage de sécurité / de secours (BAES)', CAT.evac, exitLuminaire),
  own('baes-ambiance', 'Éclairage d’ambiance (anti-panique)', CAT.evac, `
    <rect x="6" y="28" width="88" height="44" rx="6" fill="${W}" stroke="${GREEN}" stroke-width="6"/>
    <circle cx="50" cy="50" r="10" fill="${GREEN}"/>
    <path d="M28 50 H34 M66 50 H72 M50 34 V36 M50 64 V66" stroke="${GREEN}" stroke-width="5" stroke-linecap="round"/>`),
  own('escape-stairs', 'Escalier d’évacuation', CAT.evac, `${bg(GREEN)}
    <path d="M14 82 H32 V66 H48 V50 H64 V34 H86" fill="none" stroke="${W}" stroke-width="8" stroke-linejoin="round"/>
    <path d="M66 18 H86 V38" fill="none" stroke="${W}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`),
  own('escape-stairs-down', 'Escalier d’évacuation (descendre)', CAT.evac, `${bg(GREEN)}
    <path d="M14 34 H36 V50 H52 V66 H68 V82 H86" fill="none" stroke="${W}" stroke-width="8" stroke-linejoin="round"/>
    <path d="M14 14 L32 28 M32 16 V28 H20" fill="none" stroke="${W}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`),
  own('exit-text', 'Issue de secours (texte)', CAT.evac, `${bg(GREEN)}${label('SORTIE', 47, 22)}${label('DE SECOURS', 72, 15)}`),
  own('evac-guide', 'Guide-file / serre-file', CAT.evac, `${bg(GREEN)}
    <circle cx="50" cy="50" r="34" fill="none" stroke="${W}" stroke-width="6"/>${label('GF', 60, 28)}`),


  // ── Lutte contre l'incendie ────────────────────────────────────────────────
  own('alarm-sounder', 'Diffuseur d’alarme sonore', CAT.fire, `${bg(RED)}
    <path d="M50 20 C35 20 31 34 31 49 L25 66 H75 L69 49 C69 34 65 20 50 20 Z" fill="${W}"/>
    <circle cx="50" cy="75" r="7" fill="${W}"/>
    <path d="M17 32 Q11 43 17 54 M83 32 Q89 43 83 54" fill="none" stroke="${W}" stroke-width="4" stroke-linecap="round"/>`),
  own('flash-beacon', 'Diffuseur lumineux (flash)', CAT.fire, `${bg(RED)}
    <path d="M30 70 V48 A20 20 0 0 1 70 48 V70 Z" fill="${W}"/><rect x="24" y="70" width="52" height="10" rx="2" fill="${W}"/>
    <path d="M50 12 V22 M20 24 L27 31 M80 24 L73 31 M10 50 H18 M82 50 H90" stroke="${W}" stroke-width="5" stroke-linecap="round"/>`),
  own('smoke-detector', 'Détecteur automatique', CAT.fire, `${bg(RED)}
    <circle cx="50" cy="50" r="28" fill="none" stroke="${W}" stroke-width="7"/>
    <circle cx="50" cy="50" r="9" fill="${W}"/>`),
  own('heat-detector', 'Détecteur de chaleur', CAT.fire, `${bg(RED)}
    <circle cx="50" cy="50" r="28" fill="none" stroke="${W}" stroke-width="7"/>${label('T°', 60, 26)}`),
  own('fire-panel', 'Centrale de détection incendie', CAT.fire, `${bg(RED)}
    <rect x="18" y="22" width="64" height="56" rx="4" fill="none" stroke="${W}" stroke-width="6"/>
    <circle cx="34" cy="40" r="5" fill="${W}"/><circle cx="50" cy="40" r="5" fill="${W}"/><circle cx="66" cy="40" r="5" fill="${W}"/>
    <path d="M30 62 H70" stroke="${W}" stroke-width="6" stroke-linecap="round"/>`),
  own('fire-blanket', 'Couverture anti-feu', CAT.fire, `${bg(RED)}
    <rect x="27" y="16" width="46" height="24" rx="3" fill="${W}"/>
    <path d="M32 40 L28 86 H72 L68 40 Z" fill="${W}" opacity="0.88"/>
    <path d="M44 40 V52 M56 40 V52" stroke="${RED}" stroke-width="4"/>`),
  own('ext-water', 'Extincteur à eau pulvérisée', CAT.fire, `${bg(RED)}${extinguisher}${label('EAU', 92, 19)}`),
  own('ext-co2', 'Extincteur CO₂', CAT.fire, `${bg(RED)}${extinguisher}${label('CO₂', 92, 19)}`),
  own('ext-powder', 'Extincteur à poudre', CAT.fire, `${bg(RED)}${extinguisher}${label('POUDRE', 91, 15)}`),
  own('ext-foam', 'Extincteur à mousse', CAT.fire, `${bg(RED)}${extinguisher}${label('MOUSSE', 91, 15)}`),
  own('dry-riser', 'Colonne sèche', CAT.fire, `${bg(RED)}
    <rect x="20" y="16" width="60" height="44" rx="4" fill="none" stroke="${W}" stroke-width="5"/>
    <circle cx="38" cy="38" r="9" fill="${W}"/><circle cx="62" cy="38" r="9" fill="${W}"/>${label('CS', 88, 24)}`),
  own('wet-riser', 'Colonne humide', CAT.fire, `${bg(RED)}
    <rect x="20" y="16" width="60" height="44" rx="4" fill="none" stroke="${W}" stroke-width="5"/>
    <circle cx="38" cy="38" r="9" fill="${W}"/><circle cx="62" cy="38" r="9" fill="${W}"/>${label('CH', 88, 24)}`),
  own('hydrant', 'Poteau / bouche d’incendie', CAT.fire, `${bg(RED)}
    <circle cx="50" cy="15" r="5" fill="${W}"/><rect x="34" y="20" width="32" height="9" rx="3" fill="${W}"/>
    <path d="M38 29 H62 V40 H71 V52 H62 V84 H38 V52 H29 V40 H38 Z" fill="${W}"/>
    <rect x="28" y="84" width="44" height="6" rx="2" fill="${W}"/>`),
  own('sprinkler', 'Tête de sprinkleur', CAT.fire, `${bg(RED)}
    <path d="M50 12 V40" stroke="${W}" stroke-width="7"/><path d="M40 40 H60 L50 50 Z" fill="${W}"/><path d="M28 54 H72" stroke="${W}" stroke-width="5" stroke-linecap="round"/>
    <path d="M30 66 L24 80 M42 66 L39 84 M58 66 L61 84 M70 66 L76 80" stroke="${W}" stroke-width="4" stroke-linecap="round"/>`),
  own('sprinkler-valve', 'Poste de contrôle sprinkleurs', CAT.fire, `${bg(RED)}${valve(W)}${label('SPK', 87, 22)}`),
  own('smoke-vent', 'Commande de désenfumage', CAT.fire, `${bg(ORANGE)}
    <path d="M30 82 C20 68 40 62 32 48 C26 36 40 28 36 18 M52 82 C42 68 62 62 54 48 C48 36 62 28 58 18 M74 82 C64 68 84 62 76 48 C70 36 84 28 80 18" fill="none" stroke="${W}" stroke-width="6" stroke-linecap="round"/>`),
  own('smoke-outlet', 'Exutoire de fumée', CAT.fire, `${bg(ORANGE)}
    <rect x="16" y="56" width="68" height="28" fill="none" stroke="${W}" stroke-width="6"/>
    <path d="M50 52 V14 M36 28 L50 14 L64 28" fill="none" stroke="${W}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`),
  own('fire-damper', 'Clapet coupe-feu', CAT.fire, `${bg(RED)}
    <rect x="16" y="30" width="68" height="40" fill="none" stroke="${W}" stroke-width="6"/><path d="M16 70 L84 30" stroke="${W}" stroke-width="6"/>${label('CF', 94, 16)}`),

  // ── Premiers secours ───────────────────────────────────────────────────────
  own('first-aid-kit', 'Trousse de secours', CAT.aid, `${bg(GREEN)}
    <rect x="16" y="32" width="68" height="50" rx="6" fill="${W}"/><path d="M38 32 V24 H62 V32" fill="none" stroke="${W}" stroke-width="6"/>
    <path d="M50 44 V70 M37 57 H63" stroke="${GREEN}" stroke-width="9"/>`),
  own('first-aid-room', 'Infirmerie / local de soins', CAT.aid, `${bg(GREEN)}
    <path d="M50 18 V56 M31 37 H69" stroke="${W}" stroke-width="12"/>
    <path d="M14 82 H86 M18 70 H82 V82 M18 82 V64" fill="none" stroke="${W}" stroke-width="5" stroke-linecap="round"/>`),
  own('first-aider', 'Sauveteur secouriste (SST)', CAT.aid, `${bg(GREEN)}
    <circle cx="50" cy="50" r="34" fill="none" stroke="${W}" stroke-width="6"/>${label('SST', 60, 26)}`),

  // ── Repères ────────────────────────────────────────────────────────────────
  own('you-are-here', 'Vous êtes ici', CAT.marks, `
    <circle cx="50" cy="50" r="46" fill="${RED}" opacity="0.18"/>
    <circle cx="50" cy="50" r="33" fill="${RED}" stroke="${W}" stroke-width="7"/>
    <circle cx="50" cy="50" r="11" fill="${W}"/>`, { defaultLabel: 'Vous êtes ici' }),
  own('you-are-here-pin', 'Vous êtes ici (repère)', CAT.marks, `
    <path d="M50 97 C50 97 19 61 19 39 A31 31 0 0 1 81 39 C81 61 50 97 50 97 Z" fill="${RED}" stroke="${W}" stroke-width="4"/>
    <circle cx="50" cy="39" r="12" fill="${W}"/>`, { defaultLabel: 'Vous êtes ici' }),
  own('north', 'Nord', CAT.marks, `
    <circle cx="50" cy="54" r="34" fill="${W}" stroke="#1d2630" stroke-width="3"/>
    <path d="M50 22 L63 74 L50 64 L37 74 Z" fill="#1d2630"/>
    <path d="M50 22 L50 64 L37 74 Z" fill="#5d6b78"/>
    <text x="50" y="16" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="17" fill="#1d2630">N</text>`),
  own('firefighter-key', 'Boîte à clés pompiers', CAT.marks, `${bg(RED)}
    <circle cx="36" cy="40" r="16" fill="none" stroke="${W}" stroke-width="7"/>
    <path d="M48 52 L80 84 M66 70 L74 62 M74 78 L82 70" stroke="${W}" stroke-width="7" stroke-linecap="round"/>`),
  own('firefighter-access', 'Accès des secours', CAT.marks, `${bg(RED)}
    <path d="M18 34 H66 M54 20 L68 34 L54 48" fill="none" stroke="${W}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>${label('SECOURS', 80, 17)}`),
  own('risk-room', 'Local à risques', CAT.marks, `<rect width="100" height="100" rx="3" fill="#ffd400"/>
    <path d="M50 14 L88 82 H12 Z" fill="none" stroke="#111" stroke-width="7" stroke-linejoin="round"/>
    <path d="M50 38 V60" stroke="#111" stroke-width="8" stroke-linecap="round"/><circle cx="50" cy="71" r="4.5" fill="#111"/>`),

  // ── Coupures et commandes ──────────────────────────────────────────────────
  own('electric-cutoff', 'Coupure électrique générale', CAT.cutoffs, `${bg(RED)}<path d="M57 12 L27 54 H48 L39 88 L73 42 H52 Z" fill="${W}"/>`),
  own('electric-panel', 'Tableau électrique (TGBT)', CAT.cutoffs, `<rect width="100" height="100" rx="3" fill="#ffd400"/>
    <path d="M56 10 L32 46 H48 L41 72 L68 36 H52 Z" fill="#111"/>${label('TGBT', 92, 18, '#111')}`),
  own('gas-cutoff', 'Vanne de coupure gaz', CAT.cutoffs, `<rect width="100" height="100" rx="3" fill="#ffd400"/>${valve('#111')}${label('GAZ', 87, 22, '#111')}`),
  own('water-cutoff', 'Vanne de coupure eau', CAT.cutoffs, `<rect width="100" height="100" rx="3" fill="#0069b4"/>${valve(W)}${label('EAU', 87, 22)}`),
  own('fuel-cutoff', 'Vanne de coupure fioul', CAT.cutoffs, `<rect width="100" height="100" rx="3" fill="#8b5a2b"/>${valve(W)}${label('FIOUL', 87, 20)}`),
  own('pv-cutoff', 'Coupure photovoltaïque', CAT.cutoffs, `<rect width="100" height="100" rx="3" fill="#ffd400"/>
    <path d="M20 58 L30 22 H78 L70 58 Z M26 40 H74 M46 22 L42 58 M62 22 L58 58" fill="none" stroke="#111" stroke-width="4" stroke-linejoin="round"/>${label('PV', 88, 22, '#111')}`),
  own('ventilation-stop', 'Arrêt ventilation (VMC)', CAT.cutoffs, `<rect width="100" height="100" rx="3" fill="#0069b4"/>
    <circle cx="50" cy="40" r="25" fill="none" stroke="${W}" stroke-width="5"/>
    <path d="M50 40 C44 26 54 18 58 22 C62 28 54 36 50 40 Z M50 40 C64 36 70 46 66 50 C60 54 54 46 50 40 Z M50 40 C42 52 32 50 32 44 C34 38 44 38 50 40 Z" fill="${W}"/>${label('VMC', 90, 18)}`),
  own('heating-stop', 'Arrêt chauffage / chaufferie', CAT.cutoffs, `${bg(RED)}
    <path d="M50 14 C64 30 70 42 64 58 C60 70 40 70 36 58 C32 46 40 40 44 30 C48 40 56 40 50 14 Z" fill="${W}"/>${label('CHAUFF.', 90, 15)}`),
  own('emergency-stop-mark', 'Arrêt d’urgence machine', CAT.cutoffs, `<rect width="100" height="100" rx="3" fill="#ffd400"/>
    <circle cx="50" cy="50" r="34" fill="${RED}" stroke="#111" stroke-width="4"/>${label('STOP', 58, 20)}`),

  // ── Structure du bâtiment ──────────────────────────────────────────────────
  plan('door', 'Porte simple', CAT.structure, doorLeaf()),
  plan('door-fire', 'Porte coupe-feu', CAT.structure, doorLeaf(`<rect x="15" y="80" width="70" height="6" fill="${RED}" stroke="none"/>${planText('CF', 58, 58, 20, RED)}`)),
  plan('door-double', 'Porte double', CAT.structure, doubleDoor()),
  plan('door-double-fire', 'Porte double coupe-feu', CAT.structure, doubleDoor(`<rect x="10" y="82" width="80" height="6" fill="${RED}" stroke="none"/>${planText('CF', 50, 47, 20, RED)}`)),
  plan('door-sliding', 'Porte coulissante', CAT.structure, `
    <path d="M4 58 H28 M72 58 H96" stroke-width="7"/>
    <rect x="22" y="46" width="44" height="7"/>
    <path d="M38 34 H70 M63 28 L70 34 L63 40" fill="none" stroke-width="3"/>`),
  plan('window', 'Fenêtre', CAT.structure, `<rect x="4" y="40" width="92" height="20"/><path d="M4 50 H96" stroke-width="2"/>`),
  plan('wall-opening', 'Baie libre / passage', CAT.structure, `<path d="M4 50 H24 M76 50 H96" stroke-width="10"/><path d="M24 36 V64 M76 36 V64" stroke-width="2"/>`),
  plan('stairs', 'Escalier droit', CAT.structure, `
    <rect x="26" y="4" width="48" height="92"/>
    <path d="M26 18 H74 M26 30 H74 M26 42 H74 M26 54 H74 M26 66 H74 M26 78 H74" stroke-width="2"/>
    <path d="M50 90 V12 M42 22 L50 12 L58 22" fill="none" stroke-width="3"/>`),
  plan('stairs-l', 'Escalier quart tournant', CAT.structure, `
    <path d="M8 92 V8 H92 V40 H40 V92 Z"/>
    <path d="M8 52 H40 M8 64 H40 M8 76 H40 M52 8 V40 M64 8 V40 M76 8 V40 M8 40 L40 8" stroke-width="2"/>
    <path d="M24 88 V24 H86 M78 17 L86 24 L78 31" fill="none" stroke-width="3"/>`),
  plan('stairs-spiral', 'Escalier hélicoïdal', CAT.structure, `
    <circle cx="50" cy="50" r="44"/><circle cx="50" cy="50" r="6"/>
    ${[0, 36, 72, 108, 144, 180, 216, 252, 288, 324].map((a) => `<path d="M50 44 V6" stroke-width="2" transform="rotate(${a} 50 50)"/>`).join('')}
    <path d="M50 74 A24 24 0 1 1 74 50 M68 42 L74 50 L80 42" fill="none" stroke-width="3"/>`),
  plan('ramp', 'Rampe', CAT.structure, `
    <rect x="24" y="4" width="52" height="92"/>
    <path d="M38 88 V14 M28 26 L38 14 L48 26" fill="none" stroke-width="3"/>${planText('5 %', 61, 60, 14)}`),
  plan('elevator', 'Ascenseur', CAT.structure, `<rect x="14" y="14" width="72" height="72"/><path d="M14 14 L86 86 M86 14 L14 86" stroke-width="2"/>`),
  plan('goods-lift', 'Monte-charge', CAT.structure, `<rect x="14" y="14" width="72" height="72"/><path d="M14 14 L86 86 M86 14 L14 86" stroke-width="2"/><rect x="34" y="40" width="32" height="20" stroke="none"/>${planText('MC', 50, 57, 16)}`),
  plan('shaft', 'Gaine technique', CAT.structure, `<rect x="16" y="16" width="68" height="68"/><path d="M16 40 L40 16 M16 64 L64 16 M16 84 L84 16 M36 84 L84 36 M60 84 L84 60" stroke-width="2"/>`),
  plan('column', 'Poteau', CAT.structure, `<rect x="30" y="30" width="40" height="40" fill="${INK}"/>`),
  plan('column-round', 'Poteau rond', CAT.structure, `<circle cx="50" cy="50" r="20" fill="${INK}"/>`),

  // ── Mobilier ───────────────────────────────────────────────────────────────
  plan('desk', 'Bureau', CAT.furniture, `<rect x="10" y="22" width="80" height="40" rx="2"/><path d="M38 70 h24 a6 6 0 0 1 6 6 v8 h-36 v-8 a6 6 0 0 1 6 -6z"/>`),
  plan('desk-l', 'Bureau d’angle', CAT.furniture, `<path d="M8 12 H92 V42 H44 V90 H8 Z"/><path d="M58 54 h20 a6 6 0 0 1 6 6 v8 h-32 v-8 a6 6 0 0 1 6 -6z"/>`),
  plan('school-desk', 'Table d’élève', CAT.furniture, `<rect x="12" y="20" width="76" height="30" rx="2"/><rect x="20" y="58" width="22" height="20" rx="4"/><rect x="58" y="58" width="22" height="20" rx="4"/>`),
  plan('reception', 'Banque d’accueil', CAT.furniture, `<path d="M8 26 H92 V44 Q50 92 8 44 Z"/><path d="M40 72 h20" stroke-width="2"/>`),
  plan('meeting-table', 'Table de réunion', CAT.furniture, `<rect x="22" y="30" width="56" height="40" rx="6"/>
    ${[30, 50, 70].map((x) => `<rect x="${x - 6}" y="14" width="12" height="11" rx="3"/><rect x="${x - 6}" y="75" width="12" height="11" rx="3"/>`).join('')}`),
  plan('round-table', 'Table ronde', CAT.furniture, `<circle cx="50" cy="50" r="22"/>${[0, 72, 144, 216, 288].map((a) => `<rect x="44" y="9" width="12" height="11" rx="3" transform="rotate(${a} 50 50)"/>`).join('')}`),
  plan('coffee-table', 'Table basse', CAT.furniture, `<rect x="22" y="34" width="56" height="32" rx="4"/>`),
  plan('chair', 'Chaise', CAT.furniture, `<rect x="28" y="30" width="44" height="44" rx="6"/><path d="M28 28 h44" stroke-width="7"/>`),
  plan('armchair', 'Fauteuil', CAT.furniture, `<rect x="18" y="22" width="64" height="58" rx="10"/><rect x="30" y="36" width="40" height="38" rx="5"/>`),
  plan('sofa', 'Canapé', CAT.furniture, `<rect x="8" y="28" width="84" height="48" rx="8"/><rect x="18" y="40" width="64" height="30" rx="4"/>`),
  plan('cabinet', 'Armoire', CAT.furniture, `<rect x="10" y="30" width="80" height="40"/><path d="M50 30 V70 M10 30 L50 70 M90 30 L50 70" stroke-width="2"/>`),
  plan('shelf', 'Étagère', CAT.furniture, `<rect x="6" y="38" width="88" height="24"/><path d="M28 38 V62 M50 38 V62 M72 38 V62" stroke-width="2"/>`),
  plan('lockers', 'Vestiaires / casiers', CAT.furniture, `<rect x="6" y="32" width="88" height="36"/>${[28, 50, 72].map((x) => `<path d="M${x} 32 V68" stroke-width="2"/>`).join('')}${[17, 39, 61, 83].map((x) => `<circle cx="${x}" cy="56" r="2" fill="${INK}"/>`).join('')}`),
  plan('bed', 'Lit simple', CAT.furniture, `<rect x="20" y="8" width="60" height="84" rx="3"/><rect x="28" y="14" width="44" height="16" rx="5"/><path d="M20 38 H80"/>`),
  plan('bed-double', 'Lit double', CAT.furniture, `<rect x="8" y="8" width="84" height="84" rx="3"/><rect x="14" y="14" width="32" height="16" rx="5"/><rect x="54" y="14" width="32" height="16" rx="5"/><path d="M8 38 H92"/>`),
  plan('plant', 'Plante', CAT.furniture, `<circle cx="50" cy="50" r="30"/><path d="M50 20 V80 M20 50 H80 M29 29 L71 71 M71 29 L29 71" stroke-width="2"/>`),
  plan('pallet-rack', 'Rayonnage d’entrepôt', CAT.furniture, `<rect x="4" y="14" width="92" height="24"/><rect x="4" y="62" width="92" height="24"/><path d="M4 14 L96 38 M4 38 L96 14 M4 62 L96 86 M4 86 L96 62" stroke-width="1.5"/>`),
  plan('pallet', 'Palette', CAT.furniture, `<rect x="16" y="16" width="68" height="68"/><path d="M16 34 H84 M16 50 H84 M16 66 H84" stroke-width="2"/>`),

  // ── Sanitaires et cuisine ──────────────────────────────────────────────────
  plan('wc', 'WC', CAT.sanitary, `<rect x="30" y="8" width="40" height="18" rx="3"/><ellipse cx="50" cy="56" rx="20" ry="28"/>`),
  plan('wc-pmr', 'WC accessible (PMR)', CAT.sanitary, `<rect x="22" y="8" width="40" height="18" rx="3"/><ellipse cx="42" cy="56" rx="20" ry="28"/><path d="M78 20 V84" stroke-width="5"/>${planText('PMR', 42, 62, 12)}`),
  plan('urinal', 'Urinoir', CAT.sanitary, `<path d="M28 14 H72 V44 Q72 78 50 78 Q28 78 28 44 Z"/><circle cx="50" cy="56" r="4"/>`),
  plan('sink', 'Lavabo', CAT.sanitary, `<rect x="18" y="26" width="64" height="48" rx="10"/><ellipse cx="50" cy="52" rx="20" ry="14"/><circle cx="50" cy="34" r="3"/>`),
  plan('shower', 'Douche', CAT.sanitary, `<rect x="12" y="12" width="76" height="76"/><path d="M12 12 L88 88 M88 12 L12 88" stroke-width="1.5"/><circle cx="50" cy="50" r="6"/>`),
  plan('bathtub', 'Baignoire', CAT.sanitary, `<rect x="6" y="24" width="88" height="52" rx="6"/><rect x="14" y="32" width="72" height="36" rx="14"/><circle cx="76" cy="50" r="3"/>`),
  plan('kitchen', 'Plan de travail / évier', CAT.sanitary, `<rect x="6" y="30" width="88" height="40"/><rect x="54" y="36" width="32" height="28" rx="4"/><circle cx="24" cy="42" r="7"/><circle cx="24" cy="60" r="7"/><circle cx="40" cy="42" r="5"/><circle cx="40" cy="60" r="5"/>`),
  plan('cooker', 'Cuisinière / plaque', CAT.sanitary, `<rect x="16" y="16" width="68" height="68" rx="3"/><circle cx="34" cy="34" r="9"/><circle cx="66" cy="34" r="9"/><circle cx="34" cy="66" r="9"/><circle cx="66" cy="66" r="9"/>`),
  plan('fridge', 'Réfrigérateur', CAT.sanitary, `<rect x="20" y="16" width="60" height="68" rx="3"/><path d="M20 30 H80" stroke-width="2"/>${planText('FR', 50, 64, 18)}`),

  // ── Équipements techniques ─────────────────────────────────────────────────
  plan('printer', 'Imprimante / copieur', CAT.technical, `<rect x="14" y="24" width="72" height="52" rx="4"/><rect x="28" y="34" width="44" height="18"/><path d="M28 64 H72"/>`),
  plan('server-rack', 'Baie informatique', CAT.technical, `<rect x="24" y="10" width="52" height="80" rx="2"/><path d="M32 24 H68 M32 36 H68 M32 48 H68 M32 60 H68" stroke-width="2"/><circle cx="62" cy="76" r="3" fill="${INK}"/>`),
  plan('boiler', 'Chaudière', CAT.technical, `<rect x="20" y="10" width="60" height="80" rx="4"/><path d="M50 30 C60 42 62 52 56 62 C52 70 44 68 42 60 C40 52 46 48 48 40 C50 46 54 46 50 30 Z"/>`),
  plan('hvac', 'Climatisation', CAT.technical, `<rect x="10" y="22" width="80" height="56" rx="4"/><circle cx="50" cy="50" r="18"/><path d="M50 32 V68 M32 50 H68 M37 37 L63 63 M63 37 L37 63" stroke-width="1.5"/>`),
  plan('meter', 'Compteur', CAT.technical, `<rect x="22" y="18" width="56" height="64" rx="4"/><rect x="32" y="30" width="36" height="16"/><circle cx="50" cy="64" r="6"/>`),
  plan('vending', 'Distributeur automatique', CAT.technical, `<rect x="18" y="12" width="64" height="76" rx="3"/><rect x="26" y="20" width="32" height="44"/><path d="M66 24 V40 M26 76 H58" stroke-width="3"/>`),
  plan('ev-charger', 'Borne de recharge', CAT.technical, `<rect x="30" y="12" width="40" height="76" rx="6"/><path d="M54 26 L42 48 H52 L46 70 L60 44 H50 Z" fill="${INK}" stroke-width="1"/>`),
  plan('water-heater', 'Ballon d’eau chaude', CAT.technical, `<circle cx="50" cy="50" r="34"/><circle cx="50" cy="50" r="22" stroke-width="2"/>${planText('ECS', 50, 56, 15)}`),
];
