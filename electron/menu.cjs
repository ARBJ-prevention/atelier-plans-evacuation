/* Menu principal en français. Les raccourcis sont gérés par l'interface
 * (registerAccelerator: false) afin de ne pas gêner la saisie de texte. */
const { Menu } = require('electron');
const path = require('node:path');

function buildMenu({ send, recent }) {
  const item = (label, action, accelerator) => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => send(action),
  });
  const template = [
    {
      label: '&Fichier',
      submenu: [
        item('Nouveau projet', 'new', 'Ctrl+N'),
        item('Ouvrir…', 'open', 'Ctrl+O'),
        {
          label: 'Ouvrir un projet récent',
          submenu: recent.length
            ? recent.map((p) => ({ label: path.basename(p), sublabel: p, click: () => send('open-recent', p) }))
            : [{ label: '(aucun)', enabled: false }],
        },
        { type: 'separator' },
        item('Enregistrer', 'save', 'Ctrl+S'),
        item('Enregistrer sous…', 'save-as', 'Ctrl+Shift+S'),
        item('Dupliquer le projet…', 'duplicate-project'),
        { type: 'separator' },
        item('Importer un plan de fond (DXF, PDF, image)…', 'import-background'),
        item('Importer un pictogramme…', 'import-symbol'),
        { type: 'separator' },
        item('Aperçu avant impression et export…', 'print-preview', 'Ctrl+P'),
        item('Exporter en PDF…', 'export-pdf', 'Ctrl+E'),
        item('Exporter en PNG haute résolution…', 'export-png'),
        { type: 'separator' },
        { label: 'Quitter', role: 'quit' },
      ],
    },
    {
      label: '&Édition',
      submenu: [
        item('Annuler', 'undo', 'Ctrl+Z'),
        item('Rétablir', 'redo', 'Ctrl+Y'),
        { type: 'separator' },
        item('Couper', 'cut', 'Ctrl+X'),
        item('Copier', 'copy', 'Ctrl+C'),
        item('Coller', 'paste', 'Ctrl+V'),
        item('Dupliquer', 'duplicate', 'Ctrl+D'),
        item('Supprimer', 'delete', 'Delete'),
        item('Tout sélectionner', 'select-all', 'Ctrl+A'),
        { type: 'separator' },
        item('Grouper', 'group', 'Ctrl+G'),
        item('Dégrouper', 'ungroup', 'Ctrl+Shift+G'),
      ],
    },
    {
      label: '&Affichage',
      submenu: [
        item('Zoom avant', 'zoom-in', 'Ctrl+Plus'),
        item('Zoom arrière', 'zoom-out', 'Ctrl+-'),
        item('Ajuster à la fenêtre', 'zoom-fit', 'Ctrl+0'),
        { type: 'separator' },
        item('Afficher / masquer la grille', 'toggle-grid'),
        item('Magnétisme de la grille', 'toggle-snap'),
        item('Repères d’alignement', 'toggle-guides'),
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen' },
        { label: 'Outils de développement', role: 'toggleDevTools', accelerator: 'Ctrl+Shift+I' },
      ],
    },
    {
      label: '&Aide',
      submenu: [
        item('Guide d’utilisation', 'help'),
        item('Raccourcis clavier', 'shortcuts'),
        { type: 'separator' },
        item('Rechercher des mises à jour…', 'check-updates'),
        item('Réglages des mises à jour…', 'update-dir'),
        { type: 'separator' },
        item('À propos', 'about'),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
