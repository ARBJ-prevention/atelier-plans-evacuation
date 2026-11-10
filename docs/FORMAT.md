# Format de fichier `.planevac` (version 2)

Un projet est un **fichier texte JSON unique, encodé en UTF-8**. Il contient tous les objets sous forme modifiable ainsi que les images (plan de fond, logos, pictogrammes importés) encodées en *data URL* base64. Il peut être lu par n'importe quel outil JSON. La définition TypeScript de référence est dans [`src/model/types.ts`](../src/model/types.ts).

Enregistrement : écriture dans un fichier temporaire, synchronisation disque, copie de l'ancienne version en `.planevac.bak`, puis renommage atomique et relecture de contrôle.

## Compatibilité
- Les fichiers de la **version 1** s'ouvrent automatiquement : les champs nouveaux reçoivent leurs valeurs par défaut, `dashed` devient `dash`, `double` (porte) devient `doorType`, et les anciens pictogrammes sont remplacés par leurs équivalents ISO 7010 (`extinguisher` → `iso-F001`, `exit` → `iso-E002`, etc. ; voir `LEGACY_SYMBOLS` dans `src/model/serialize.ts`).
- Un fichier d'une version plus récente que le logiciel est refusé avec un message explicite.
- Les champs absents sont complétés à l'ouverture ; les types d'éléments inconnus sont ignorés.

## Racine : `Project`

| Champ | Type | Description |
|---|---|---|
| `format` | `"atelier-evac"` | Identifiant obligatoire du format. |
| `formatVersion` | entier | Version du format (`2`). |
| `id` | texte | Identifiant unique du projet (sert aussi à la sauvegarde automatique). |
| `name` | texte | Nom du projet. |
| `country` | `BE` `FR` `CH` `LU` `INT` | Profil pays (consignes et numéros d'urgence par défaut, rappel des référentiels). |
| `createdAt`, `updatedAt` | ISO 8601 | Dates de création et de modification. |
| `buildings` | `Building[]` | Bâtiments. |
| `customSymbols` | `CustomSymbol[]` | Pictogrammes importés : `{ id, name, category, src }`. |

## `Building`
`{ id, name, address, floors: Floor[] }`

## `Floor` (un étage = un plan)

| Champ | Description |
|---|---|
| `id`, `name`, `level` | Identité de l'étage. |
| `unitsPerMeter` | Nombre d'unités plan par mètre (0 = non étalonné). |
| `background` | `null` ou `{ src, sourceName, naturalWidth, naturalHeight, x, y, scale, opacity, locked, grayscale }` — `scale` = unités plan par pixel. |
| `layers` | 5 calques `{ id, name, visible, locked }` : `background`, `building`, `routes`, `symbols`, `annotations`. |
| `elements` | Éléments dessinés (ordre = ordre de dessin dans un calque). |
| `variants` | Versions du plan `{ id, name }` (au moins une). |
| `titleBlock` | `{ title, subtitle, author, organization, date (AAAA-MM-JJ), version, status, validatedBy, validatedAt, instructions, emergencyNumbers, logo }` — `status` ∈ `draft`, `to_validate`, `validated`. |
| `page` | Mise en page (ci-dessous). |

### `page`
| Champ | Valeurs |
|---|---|
| `paper`, `orientation` | `A4` `A3` `A2` · `portrait` `landscape` |
| `marginMm` | marge en mm |
| `scaleMode`, `scale` | `fit` (ajusté) ou `fixed` avec `scale` = N de l'échelle 1:N |
| `area`, `customArea` | `auto` (tout le plan) ou `custom` avec `{ x, y, w, h }` en unités plan |
| `theme` | `moderne` `epure` `institutionnel` `signaletique` |
| `accentColor`, `planBackground` | couleurs `#rrggbb` |
| `sidePosition` | position de la légende et des consignes : `right` `left` `bottom` |
| `showTitleBlock`, `showLegend`, `showInstructions`, `showEmergencyNumbers`, `showWatermark`, `showScaleBar`, `showNorth`, `showFrame` | booléens |
| `northAngle` | angle de la flèche du nord (°) |

## Éléments

Champs communs : `id`, `type`, `layer`, `rotation` (degrés, sens horaire), `locked?`, `groupId?` (éléments groupés), `variantId?` (élément visible uniquement dans cette version), `opacity?` (0–1), `shadow?` (`{ enabled, color, opacity, blur, dx, dy }`), `flipX?`, `flipY?`.

Valeurs partagées : `dash` ∈ `solid` `dashed` `dotted` `dashdot` `longdash` ; `pattern` ∈ `solid` `none` `hatch` `crosshatch` `vertical` `dots`.

| `type` | Champs propres | Position |
|---|---|---|
| `wall` | `points`, `thickness`, `color`, `wallStyle: solid|hatch|outline`, `closed` | polyligne |
| `area` | `kind: room|zone`, `points`, `fill`, `fillOpacity`, `pattern`, `patternColor`, `stroke`, `strokeWidth`, `dash`, `label`, `labelSize`, `labelColor`, `labelBold`, `showArea`, `labelDx`, `labelDy` | polygone |
| `door` | `x`, `y`, `width`, `swing: left|right`, `doorType: single|double|sliding|revolving|opening`, `emergency`, `color` | milieu de l'ouverture |
| `window` | `x`, `y`, `width`, `depth`, `panes`, `color` | centre |
| `stairs` | `x`, `y`, `w`, `h`, `steps`, `color`, `fill`, `arrow`, `stairType: straight|landing|escalator`, `label` | centre |
| `symbol` | `x`, `y`, `size`, `symbolId`, `label`, `labelPosition: below|above|right|left`, `labelSize` (0 = auto), `labelColor`, `halo` | centre |
| `route` | `points`, `color`, `width`, `dash`, `arrowEnd`, `arrowStart`, `arrowStyle: triangle|stealth|open|chevrons|circle|square`, `arrowSize`, `arrowRepeat` (u, 0 = aucun), `corner: round|miter|bevel`, `outline` (couleur du liseré, '' = aucun), `smooth`, `kind: principal|secondaire` | polyligne |
| `text` | `x`, `y`, `text` (`\n`), `fontFamily`, `fontSize`, `color`, `bold`, `italic`, `underline`, `uppercase`, `align: start|middle|end`, `lineHeight`, `letterSpacing`, `background`, `border`, `borderColor`, `radius`, `padding` | ancre haut |
| `image` | `x`, `y`, `w`, `h`, `src`, `radius`, `border` | centre |
| `legend` | `x`, `y`, `fontSize`, `title`, `columns`, `background`, `border` | coin haut gauche |
| `shape` | `shape: rect|ellipse|triangle|diamond|hexagon|line|arrow|star`, `x`, `y`, `w`, `h`, `fill`, `fillOpacity`, `pattern`, `patternColor`, `stroke`, `strokeWidth`, `dash`, `radius`, `text`, `textSize`, `textColor` | centre |

### Identifiants de pictogrammes (`symbolId`)
- Signaux ISO 7010 : `iso-` suivi du code, par ex. `iso-E001`, `iso-E002`, `iso-E007`, `iso-F001`, `iso-F005`, `iso-E003`, `iso-E010`, `iso-P020`, ainsi que `iso-arrow` et `iso-arrow-45` (flèches de direction). Liste complète : `src/symbols/iso7010/manifest.json`.
- Compléments : `you-are-here`, `you-are-here-pin`, `north`, `alarm-sounder`, `fire-blanket`, `smoke-detector`, `smoke-vent`, `electric-cutoff`, `gas-cutoff`, `water-cutoff`, `firefighter-key`, `fire-panel`.
- Mobilier et équipements : `desk`, `meeting-table`, `round-table`, `chair`, `sofa`, `cabinet`, `bed`, `wc`, `sink`, `shower`, `kitchen`, `elevator`, `plant`, `printer`.
- Tout autre identifiant renvoie à `customSymbols`.

## Exemple minimal

```json
{
  "format": "atelier-evac",
  "formatVersion": 2,
  "id": "prj_1",
  "name": "Mairie",
  "country": "BE",
  "buildings": [{
    "id": "bld_1", "name": "Bâtiment A", "address": "",
    "floors": [{
      "id": "flr_1", "name": "Rez", "level": 0, "unitsPerMeter": 50,
      "variants": [{ "id": "var_1", "name": "Accueil" }],
      "elements": [
        { "id": "el_1", "type": "wall", "layer": "building", "rotation": 0, "points": [[0,0],[500,0]], "thickness": 12, "color": "#1d2630" },
        { "id": "el_2", "type": "symbol", "layer": "symbols", "rotation": 0, "x": 250, "y": 60, "size": 44, "symbolId": "iso-F001" }
      ]
    }]
  }]
}
```

## Fichiers annexes

- Sauvegardes automatiques : `%APPDATA%\Atelier Plans Evacuation\autosave\<id-projet>.json` (`{ id, name, filePath, savedAt, content }`, `content` = projet sérialisé). Supprimées à l'enregistrement ou à la fermeture volontaire sans enregistrer.
- Projets récents : `%APPDATA%\Atelier Plans Evacuation\recent.json`.
- Préférences d'affichage (grille, règles, repères) : stockage local de l'application.
