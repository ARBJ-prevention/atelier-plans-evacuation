# Licences

## Code source
Code de l'application : licence MIT (voir `package.json`).

## Pictogrammes ISO 7010 (`src/symbols/iso7010/`)
42 signaux de sécurité ISO 7010 (évacuation, lutte contre l'incendie, premiers secours, interdictions et dangers) sous forme de fichiers SVG issus de **Wikimedia Commons**.

- Seuls les fichiers dont la licence est **domaine public** ou **CC0 1.0** sont retenus ; la licence est vérifiée automatiquement par `scripts/fetch-iso7010.mjs` au moment de la récupération (champ `LicenseShortName` de l'API Commons). Ces deux régimes autorisent l'utilisation, la modification et la redistribution, y compris commerciales, sans obligation d'attribution.
- Le fichier `src/symbols/iso7010/manifest.json` indique pour chaque signal : code ISO, licence, auteur du fichier SVG et page source sur Commons.
- Les fichiers ont été nettoyés (suppression des métadonnées d'éditeur, de tout script et de tout lien externe) sans modification du dessin.
- La norme ISO 7010 elle-même (le document) est protégée par l'ISO ; les fichiers utilisés ici sont des tracés publiés par leurs auteurs en domaine public ou CC0.

Les signaux sont affichés dans le logiciel avec leur code (ex. F001) et un nom français.

## Pictogrammes complémentaires et symboles de plan
Les éléments sans équivalent ISO 7010 (« Vous êtes ici », nord, vannes gaz/eau, coupure électrique, désenfumage, boîte à clés, centrale incendie, détecteur, diffuseur sonore, couverture anti-feu) ainsi que les symboles de mobilier et d'équipement (bureaux, tables, sanitaires, ascenseur…) et les icônes d'interface (`src/ui/icons.tsx`) sont des **dessins originaux** créés pour ce logiciel, publiés sous **CC0 1.0**.

## Avertissement
La présence de signaux ISO 7010 ne rend pas un plan conforme : les exigences (signaux imposés, ISO 23601, NF S 60-303 en France, prescriptions des services d'incendie…) varient selon le pays et l'établissement. Il est possible d'importer d'autres pictogrammes (Fichier › Importer un pictogramme) dont vous détenez les droits.

## Dépendances embarquées dans l'application
| Composant | Licence |
|---|---|
| Electron (Chromium, Node.js) | MIT (+ licences tierces de Chromium, fournies dans `LICENSES.chromium.html` du dossier d'installation) |
| React, React DOM | MIT |
| zustand | MIT |
| immer | MIT |
| pdf.js (`pdfjs-dist`) | Apache 2.0 |

Outils de construction (non redistribués) : Vite, TypeScript, Vitest, electron-builder (MIT / Apache 2.0).
