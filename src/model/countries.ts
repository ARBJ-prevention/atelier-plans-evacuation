/**
 * Profils de pays : textes par défaut et rappels de référentiels.
 * Ces profils sont des MODÈLES DE DÉPART. Ils ne garantissent aucune
 * conformité : l'utilisateur doit vérifier les exigences applicables
 * (réglementation locale, assureur, service d'incendie, etc.).
 */
export interface CountryProfile {
  code: string;
  name: string;
  references: string;
  routeColor: string;
  instructions: string;
}

const COMMON_INSTRUCTIONS = `EN CAS D'INCENDIE
1. Gardez votre calme.
2. Donnez l'alarme (bouton d'alarme le plus proche).
3. Appelez les secours : 112.
4. Si possible sans danger, utilisez un extincteur.

EN CAS D'ÉVACUATION
1. Quittez les lieux par l'itinéraire indiqué.
2. Fermez les portes derrière vous.
3. N'utilisez pas les ascenseurs.
4. Rejoignez le point de rassemblement.
5. Ne revenez pas en arrière sans autorisation.`;

export const COUNTRIES: CountryProfile[] = [
  {
    code: 'BE',
    name: 'Belgique',
    references: 'Référentiels à vérifier : ISO 23601 (plans d’évacuation), ISO 7010 (signaux de sécurité), réglementation fédérale, régionale et prescriptions des services d’incendie.',
    routeColor: '#00843d',
    instructions: COMMON_INSTRUCTIONS,
  },
  {
    code: 'FR',
    name: 'France',
    references: 'Référentiels à vérifier : NF S 60-303, ISO 23601, ISO 7010, Code du travail / règlement ERP selon l’établissement.',
    routeColor: '#00843d',
    instructions: COMMON_INSTRUCTIONS.replace('112', '18 ou 112'),
  },
  {
    code: 'CH',
    name: 'Suisse',
    references: 'Référentiels à vérifier : directives AEAI, ISO 23601, ISO 7010, prescriptions cantonales.',
    routeColor: '#00843d',
    instructions: COMMON_INSTRUCTIONS.replace('112', '118'),
  },
  {
    code: 'LU',
    name: 'Luxembourg',
    references: 'Référentiels à vérifier : prescriptions ITM / CGDIS, ISO 23601, ISO 7010.',
    routeColor: '#00843d',
    instructions: COMMON_INSTRUCTIONS,
  },
  {
    code: 'INT',
    name: 'Générique (ISO)',
    references: 'Référentiels à vérifier : ISO 23601, ISO 7010 et réglementation du pays concerné.',
    routeColor: '#00843d',
    instructions: COMMON_INSTRUCTIONS,
  },
];

export function getCountry(code: string): CountryProfile {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[COUNTRIES.length - 1];
}
