# Vérifications — version 2.0.0 (10 novembre 2026)

## 1. Autotest de bout en bout dans l'application empaquetée

Lancé sur l'exécutable contenu dans l'installateur (`Atelier Plans Evacuation.exe --selftest`) : processus principal réel, écriture disque réelle, moteur PDF de Chromium. **16/16 vérifications réussies.**

| # | Vérification | Ce qui est contrôlé |
|---|---|---|
| 1 | Création d'un projet | plan d'exemple « Bureaux », 2 versions « Vous êtes ici », pictogramme importé |
| 2 | Export PDF A4 paysage | 2 pages (une par version), 842×595 pt, titre / légende / consignes / statut en **texte vectoriel**, et **aucune image matricielle** : les pictogrammes ISO restent vectoriels |
| 3 | Bibliothèque ISO 7010 | 42 signaux chargés et décodés, licences domaine public / CC0 |
| 4 | Plans d'exemple | export PDF et PNG des 4 thèmes (Moderne 2 p., Signalétique 2 p., Épuré 3 p., Institutionnel A3 1 p.), aucun pictogramme inconnu |
| 5 | Mises à jour | dossier de test : une version 99.0.0 est proposée, une version 0.0.1 est ignorée |
| 6 | Migration v1 → v2 | anciens pictogrammes convertis en ISO 7010, styles et portes convertis |
| 7 | Import PDF en plan de fond | rastérisation 4000×2827 px |
| 8 | Annuler / rétablir | ajout → annulation → rétablissement |
| 9 | Copier-coller, grouper, aligner | nouveaux identifiants, groupe, alignement, suppression |
| 10 | Enregistrement | écriture atomique, copie `.bak`, relecture de contrôle |
| 11 | **Réouverture** | projet relu identique (comparaison canonique complète), éléments modifiables |
| 12 | **Sauvegarde automatique / récupération** | écriture, relecture du contenu modifié, nettoyage |
| 13 | **Export PNG 300 ppp** | 3508×2480 px exactement (A4), contenu non vide |
| 14 | Export PDF A3 portrait 1:200 | 842×1191 pt, mention de l'échelle |
| 15 | Statut de validation | brouillon par défaut ; validé → mention dans le PDF sans filigrane ; modification → « À valider » |
| 16 | Fichier invalide | messages explicites |

Relancer :

```bash
npm run selftest
```

## 2. Tests unitaires (vitest) — 12/12
Format de fichier (aller-retour, refus, complétion), duplication, géométrie, versions « Vous êtes ici », mise en page et échelle.

## 3. Contrôles visuels
- **Planche contact des 42 pictogrammes ISO** : chaque dessin comparé à son nom ; E016 et E017 renommés (échelle d'évacuation, fenêtre de sauvetage) et retirés des cages d'escalier des exemples.
- **Rendus des 4 plans d'exemple** (`docs/exemples/`) vérifiés à l'œil. Corrigé au passage : libellés de légende tronqués, numéros d'urgence coupés, noms de zones masqués, flèche du nord et barre d'échelle qui chevauchaient le plan.
- **Flèches d'évacuation** (demi-tour, virages, chicane, double sens) rendues et comparées au modèle demandé.
- Captures de l'accueil et de l'éditeur (`docs/capture-*.png`).

## 4. Non vérifié automatiquement
- Exécution de l'installateur lui-même (installation, raccourcis, désinstallation) et installation d'une mise à jour réelle de bout en bout : non lancées sur ce poste pour ne pas modifier votre environnement.
- Recherche de mise à jour sur GitHub : le code est en place, mais aucune version plus récente que 2.0.0 n'est encore publiée pour la tester réellement.
- Impression sur une imprimante physique.
- Gestes à la souris (tracé, poignées, glisser-déposer) : vérifiés par les captures, pas par un test automatisé.
