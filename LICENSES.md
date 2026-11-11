# Licences

## Code source
Code de l'application : licence MIT (voir `package.json`).

## Pictogrammes ISO 7010 (`src/symbols/iso7010/`)
97 signaux de sécurité ISO 7010 (évacuation, lutte contre l'incendie, premiers secours, interdictions, dangers et obligations) sous forme de fichiers SVG issus de **Wikimedia Commons**.

- Seuls les fichiers dont la licence est **domaine public** ou **CC0 1.0** sont retenus ; la licence est vérifiée automatiquement par `scripts/fetch-iso7010.mjs` au moment de la récupération (champ `LicenseShortName` de l'API Commons). Ces deux régimes autorisent l'utilisation, la modification et la redistribution, y compris commerciales, sans obligation d'attribution.
- Les fichiers sous une autre licence (par exemple CC BY-SA, qui imposerait attribution et partage à l'identique) sont écartés : c'est le cas de W035 et M002, absents de la bibliothèque.
- Le fichier `src/symbols/iso7010/manifest.json` indique pour chaque signal : code ISO, licence, auteur du fichier SVG et page source sur Commons.
- Les fichiers ont été nettoyés (suppression des métadonnées d'éditeur, de tout script et de tout lien externe) sans modification du dessin.
- La norme ISO 7010 elle-même (le document) est protégée par l'ISO ; les fichiers utilisés ici sont des tracés publiés par leurs auteurs en domaine public ou CC0.

Les signaux sont affichés dans le logiciel avec leur code (ex. F001) et un nom français.

## Pictogrammes complémentaires et symboles de plan (`src/symbols/drawn.ts`)
Tous les pictogrammes sans code ISO sont des **dessins originaux** créés pour ce logiciel et publiés sous **CC0 1.0**. Aucun n'est repris, décalqué ou adapté d'une bibliothèque de symboles d'un autre logiciel (Visio, EdrawMax, etc.) :
- signaux complémentaires sans équivalent ISO 7010 : BAES, escaliers d'évacuation, extincteurs par agent (eau, CO₂, poudre, mousse), colonnes sèches et humides, poteau d'incendie, sprinkleurs, désenfumage, exutoire, clapet coupe-feu, détecteurs, diffuseurs, trousse de secours, SST, « Vous êtes ici », nord, accès des secours, boîte à clés ;
- coupures et commandes : électricité, TGBT, gaz, eau, fioul, photovoltaïque, ventilation, chauffage, arrêt d'urgence ;
- symboles de plan : structure du bâtiment (portes, fenêtres, escaliers, rampe, ascenseur, monte-charge, gaine, poteaux), mobilier, sanitaires et cuisine, équipements techniques ;
- icônes d'interface (`src/ui/icons.tsx`).

Les formes de base de ces symboles (porte avec arc d'ouverture, escalier à marches, couleurs vert/rouge/jaune de la signalisation) sont des conventions de dessin technique communes, non protégeables en elles-mêmes ; leur tracé est propre à ce logiciel.

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

## ODA File Converter (facultatif, non fourni)
Pour lire les fichiers DWG, le logiciel peut appeler « ODA File Converter » de l'Open Design Alliance (https://www.opendesign.com/guestfiles/oda_file_converter). Cet outil gratuit n'est **pas inclus** : l'utilisateur le télécharge et l'installe lui-même, en acceptant les conditions d'utilisation de l'ODA. Le logiciel se contente de l'exécuter pour convertir un DWG en DXF.
