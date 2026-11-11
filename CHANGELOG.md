# Journal des versions

## À venir
- **Plan redessiné automatiquement** à l'import d'un DXF ou d'un DWG : murs et cloisons (épaisseurs réelles, angles raccordés), portes simples et doubles (sens d'ouverture repris), fenêtres, escaliers et pièces nommées sont créés comme éléments modifiables du logiciel, aux vraies dimensions. Fenêtre de vérification avec aperçu, nombre d'éléments par catégorie et rôle de chaque calque (deviné d'après son nom en français, anglais, néerlandais ou allemand, modifiable avec mise à jour immédiate). Les noms de pièces et leur surface sont repris des textes du plan.

## 2.0.9 — novembre 2026
- Cadres au choix : Propriétés › Cadres (et fenêtre d'impression) permettent de cocher les zones à entourer — plan, légende, consignes, vue aérienne, croquis de situation, cartouche — sur tous les thèmes. Sans choix, chaque thème garde ses cadres ; bouton « Revenir aux cadres du thème ».
- Thème Horizon : « En cas d'incendie » en dégradé rouge, « En cas d'évacuation » en dégradé vert, titres de cadres et cadre « Numéros d'urgence » en dégradé, avec les mêmes reflets ronds plus clairs que l'en-tête.

## 2.0.8 — novembre 2026
- **Portes coupe-feu** distinguées des portes classiques : seuil rouge et libellé (« CF » par défaut, modifiable : « EI 30 », « EI 60 »…), réglage *Propriétés › Porte › Porte coupe-feu* ou bouton « Coupe-feu » dans *Bâtiment › Portes* pour les poser directement. Elles sont ajoutées automatiquement à la légende. L'option « Issue de secours » (seuil vert) reste indépendante.
- Formats A3 et A2 : toute la mise en page (titre, légende, consignes, cartouche, pictogrammes, flèche du nord) est agrandie avec le papier, pour rester aussi lisible qu'en A4 (×1,35 en A3, ×1,8 en A2). Le plan garde un peu plus de place qu'en A4 ; l'échelle affichée reste l'échelle réelle.
- Thème Horizon : légende, consignes, vue aérienne, croquis de situation, plan et cartouche sont désormais encadrés d'une bordure arrondie dans la couleur d'accent (adoucie).

## 2.0.7 — novembre 2026
- **Import de plans AutoCAD (DXF) à l'échelle réelle** : le plan du géomètre ou de l'architecte est importé en vectoriel (net à tous les zooms et à l'impression), avec ses vraies dimensions. L'unité (mm, cm, m…) est lue dans le fichier et l'étage est étalonné automatiquement. Fenêtre d'import avec aperçu, dimensions réelles, choix de l'unité si elle n'est pas indiquée et sélection des calques (les calques éteints ou gelés dans AutoCAD sont décochés d'office). Pris en charge : lignes, polylignes (avec arcs), cercles, arcs, ellipses, splines, hachures, solides, textes et textes multilignes, blocs (portes, mobilier…) y compris imbriqués et en réseau, cotations, attributs. Les objets isolés très éloignés du plan sont écartés automatiquement. 
- **Import de plans AutoCAD natifs (DWG)**, toutes versions de R12 à 2018 et au-delà : conversion automatique par ODA File Converter (gratuit, à installer une fois ; détecté tout seul dans Program Files\ODA). Si l'outil manque, une fenêtre explique comment l'installer, ouvre la page de téléchargement ou permet d'indiquer son emplacement. La version du DWG est affichée dans la fenêtre d'import ; un fichier qui n'est pas un DWG est refusé avec un message clair.
- Bibliothèque de symboles enrichie et réorganisée en 12 catégories : 97 signaux ISO 7010 (interdictions, dangers et obligations ajoutés) et plus de 90 pictogrammes dessinés pour le logiciel (BAES, extincteurs par agent, colonnes sèches, coupures, portes, escaliers, mobilier, sanitaires, équipements techniques). Catégories secondaires repliées par défaut, bouton « Tout déplier / Tout replier », recherche aussi par catégorie.
- 2 nouveaux thèmes de mise en page :
  - **Horizon** : bandeau en dégradé nuit → couleur d'accent, cartes teintées aux grands arrondis, titres en pastille, cartouche en capsule.
  - **Éditorial** : style magazine, grand titre noir, filets épais, rubriques numérotées (01 Légende, 02 Consignes…), beaucoup de blanc.
- Mise en page qui s'adapte à l'orientation (Portrait / Paysage) et à la forme du plan, sur les 9 thèmes :
  - la place entre le plan et la légende se répartit selon les proportions du plan : un bâtiment tout en longueur en portrait laisse un bandeau de légende plus haut (consignes et libellés complets), un bâtiment en hauteur en paysage élargit la colonne de légende ;
  - en portrait, « Légende à gauche / à droite » place la légende à côté du plan quand il est en hauteur, sinon en bas ;
  - si les numéros d'urgence ne tiennent pas à côté du titre (portrait, numéros longs, logo), ils passent automatiquement dans le cadre rouge : le titre n'est plus coupé ;
  - le cadre « Numéros d'urgence » affiche désormais tous les numéros (un par ligne si possible) ; auparavant, au-delà de deux lignes, la fin était supprimée.

## 2.0.6 — novembre 2026
- Impression : si aucune imprimante n'est accessible (service Windows « Spouleur d'impression » arrêté ou aucune imprimante installée), le logiciel l'explique clairement, indique comment relancer le spouleur et propose d'exporter le plan en PDF, au lieu du message « Failed to enumerate printers ».
- Impression : l'imprimante par défaut est désormais sélectionnée automatiquement.
- Export PDF de plusieurs versions : le nom de la version figure toujours dans l'en-tête, même quand un sous-titre est saisi dans le cartouche (les pages ne sont plus identiques).

## 2.0.5 — novembre 2026
- Renommer directement sur le plan : double-clic sur une pièce, une zone, un pictogramme, un escalier, une forme, un texte ou une légende pour modifier son nom sur place (Entrée : valider, Maj+Entrée : nouvelle ligne, Échap : annuler). F2 ou Entrée fait de même pour l'élément sélectionné.
- Nouveaux raccourcis : Ctrl+← / Ctrl+→ pour pivoter de 90°, Page préc. / Page suiv. pour mettre devant / derrière, Ctrl+L pour verrouiller / déverrouiller.

## 2.0.4 — novembre 2026
- Escaliers sans flèche : bouton « Sans flèche » dans Bâtiment › Escaliers, pour poser ensuite sa propre flèche verte (aussi réglable par escalier : Propriétés › Escalier › Flèche de montée).
- Murs et cloisons en deux clics : un clic pour le début, un clic pour la fin, puis retour automatique à la sélection (Ctrl + clic pour continuer un mur en plusieurs segments).

## 2.0.3 — novembre 2026
- Aperçu avant impression : la page occupe désormais toute la zone d'aperçu (plus de grand cadre blanc autour), fenêtre agrandie.
- En-têtes de page : titre « Plan d'évacuation » nettement plus grand, lieu juste en dessous en un peu plus petit (agrandis automatiquement en A3 et A2), sur les 7 thèmes.
- Étirement par les côtés : pictogrammes, formes, images et escaliers ont des poignées latérales (largeur ou hauteur seule) ; les flèches et itinéraires ont un cadre à 8 poignées pour les étirer (Maj sur un coin : proportions conservées).
- Panneau Propriétés d'un pictogramme : réglage Largeur / Hauteur en % et bouton « Proportions d'origine ».
- Tout ce qu'on ajoute sur le plan revient ensuite à l'outil Sélection, l'élément ajouté étant sélectionné : escaliers, portes, fenêtres, formes, murs, cloisons, pièces, zones et itinéraires (Maj + clic pour poser plusieurs portes, fenêtres, escaliers ou formes d'affilée).
- Tracé des murs, cloisons, itinéraires, pièces et zones : Échap ou clic droit terminent le tracé en conservant les points posés (Échap n'annule plus le mur en cours).
- Fusion des panneaux : deux pictogrammes collés (ex. sortie de secours + flèche) forment un seul panneau, sans liseré blanc entre eux, à l'écran comme à l'impression. Désactivable par pictogramme (Propriétés › Étirement › Fusionner).

## 2.0.2 — novembre 2026
- Pictogrammes : un clic sur le plan pose le pictogramme puis revient automatiquement à l'outil Sélection (Maj + clic pour en poser plusieurs d'affilée).
- 3 nouveaux thèmes de mise en page à cadres : Encadré (cadres à onglet), Bandeaux (titres sur bandeau couleur) et Technique (style bureau d'études).
- Nouveau cadre « Vue aérienne du site » : insérez une vue du ciel ou une photo satellite (Propriétés › Cartouche › Vue aérienne).
- Nouveau « Plan de situation » : croquis miniature de l'étage (murs, pièces, itinéraires) avec le repère « Vous êtes ici ».

## 2.0.1 — novembre 2026
- L'installateur ne propose plus de réinstaller : si le programme est déjà à jour, il s'ouvre directement ; s'il est plus ancien, seule la mise à jour est proposée.
- Mise à jour rapide depuis le logiciel (sans repasser par l'assistant d'installation).

## 2.0.0 — novembre 2026
- 42 pictogrammes ISO 7010 officiels (domaine public / CC0).
- Nouvelle interface : ruban à onglets, panneau Propriétés détaillé (style, texte, disposition), règles en mètres, grille plus visible et réglable.
- 4 thèmes de mise en page (Moderne, Épuré, Institutionnel, Signalétique), A2, numéros d'urgence, flèche du nord.
- 4 plans d'exemple sur l'écran d'accueil.
- Flèches d'évacuation vertes prêtes à poser (demi-tour, virages, chicane, double sens) et virages arrondis sur les itinéraires.
- Fenêtres, formes, 5 types de portes, 3 types d'escaliers, mobilier, surface des pièces.
- Mises à jour proposées au démarrage, depuis le dossier « Atelier Plans Evacuation » (ou un dossier réseau) et depuis GitHub lorsqu'Internet est disponible.
- Les projets de la version 1 s'ouvrent et sont convertis automatiquement.

## 1.0.0 — novembre 2026
- Première version : projets par bâtiment et étage, import PDF/image, dessin, pictogrammes, itinéraires, versions « Vous êtes ici », cartouche et statut de validation, exports PDF/PNG, impression, sauvegarde automatique.
