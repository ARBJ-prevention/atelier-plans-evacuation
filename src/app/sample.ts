/**
 * Plans d'exemple : quatre bâtiments fictifs illustrant les thèmes de mise
 * en page et les possibilités du logiciel. 50 unités plan = 1 mètre.
 */
import { makeElement, newProject, newVariant } from '../model/defaults';
import { cloneFloorWithNewIds } from '../model/serialize';
import type { Element, Floor, PageTheme, Project, Pt } from '../model/types';

const GREEN = '#00843d';
const C = {
  office: '#edf3fa', meeting: '#f2eefa', wet: '#e8f5f4', circ: '#fafaf7', tech: '#f5f0e8', kitchen: '#fdf2e4',
  stair: '#eef0f2', rest: '#eef6ee', store: '#f6f6f3', lobby: '#fbf4ec',
};

/** Petit constructeur de plan. */
class Plan {
  els: Element[] = [];
  room(x: number, y: number, w: number, h: number, label: string, fill: string, extra: Record<string, unknown> = {}) {
    this.els.push(makeElement('area', {
      points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], label, fill, stroke: 'none', strokeWidth: 0, labelSize: 17, labelColor: '#4a5866', ...extra,
    }));
  }
  zone(points: Pt[], label: string, color = '#d52b1e') {
    this.els.push(makeElement('area', {
      points, label, kind: 'zone', fill: color, fillOpacity: 0.08, pattern: 'hatch', patternColor: color, stroke: color, strokeWidth: 2.5, dash: 'dashed',
      labelColor: color, labelBold: true, labelSize: 15,
    }));
  }
  wall(points: Pt[], t = 12, extra: Record<string, unknown> = {}) { this.els.push(makeElement('wall', { points, thickness: t, ...extra })); }
  box(x: number, y: number, w: number, h: number, t = 22) { this.wall([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], t, { closed: true }); }
  door(x: number, y: number, rotation: number, width = 90, extra: Record<string, unknown> = {}) { this.els.push(makeElement('door', { x, y, rotation, width, ...extra })); }
  win(x: number, y: number, rotation = 0, width = 140, depth = 22) { this.els.push(makeElement('window', { x, y, rotation, width, depth })); }
  sym(symbolId: string, x: number, y: number, size = 40, extra: Record<string, unknown> = {}) { this.els.push(makeElement('symbol', { x, y, size, symbolId, ...extra })); }
  furn(symbolId: string, x: number, y: number, size = 60, rotation = 0) { this.els.push(makeElement('symbol', { x, y, size, symbolId, rotation, layer: 'building' })); }
  stairs(x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) { this.els.push(makeElement('stairs', { x, y, w, h, ...extra })); }
  route(points: Pt[], extra: Record<string, unknown> = {}) {
    this.els.push(makeElement('route', { points, color: GREEN, width: 9, outline: '#ffffff', arrowStyle: 'stealth', arrowSize: 1.15, arrowRepeat: 120, ...extra }));
  }
  alt(points: Pt[]) { this.route(points, { kind: 'secondaire', dash: 'dashed', width: 6, arrowRepeat: 0, arrowStyle: 'triangle' }); }
  text(x: number, y: number, text: string, extra: Record<string, unknown> = {}) { this.els.push(makeElement('text', { x, y, text, ...extra })); }
  shape(extra: Record<string, unknown>) { this.els.push(makeElement('shape', extra)); }
}

function setupFloor(f: Floor, theme: PageTheme, accent: string, author: string, extra: Partial<Floor['page']> = {}) {
  f.unitsPerMeter = 50;
  f.page = { ...f.page, theme, accentColor: accent, showWatermark: false, ...extra };
  f.titleBlock.author = author;
  f.titleBlock.organization = 'Exemple fictif';
}

// ——— 1. Bureaux « Le Quartz » — thème Moderne ———
export function sampleOffices(): Project {
  const p = newProject('Exemple — Bureaux Le Quartz', 'BE');
  const b = p.buildings[0];
  b.name = 'Le Quartz'; b.address = 'Avenue des Exemples 12, 5620 Florennes';
  const f = b.floors[0];
  f.name = 'Rez-de-chaussée';
  setupFloor(f, 'moderne', GREEN, 'Service prévention', { showNorth: true, northAngle: 0 });
  f.titleBlock.subtitle = 'Avenue des Exemples 12';
  const v1 = f.variants[0]; v1.name = 'Accueil';
  const v2 = newVariant('Couloir est'); f.variants.push(v2);
  const P = new Plan();

  P.room(0, 0, 700, 400, 'Open space', C.office);
  P.room(700, 0, 300, 400, 'Salle de réunion A', C.meeting);
  P.room(1000, 0, 250, 400, 'Réunion B', C.meeting);
  P.room(1250, 0, 250, 400, 'Direction', C.office);
  P.room(0, 400, 1500, 100, '', C.circ);
  P.room(0, 500, 350, 400, 'Accueil', C.lobby, { labelDx: 85, labelDy: 40 });
  P.room(350, 500, 400, 400, 'Cafétéria', C.kitchen);
  P.room(750, 500, 200, 400, 'Sanitaires', C.wet, { labelDy: -95, labelSize: 15 });
  P.room(950, 500, 200, 400, 'Local technique', C.tech);
  P.room(1150, 500, 350, 400, 'Escalier', C.stair, { labelDx: 110, labelDy: 170 });

  P.box(0, 0, 1500, 900, 22);
  P.wall([[0, 400], [1500, 400]]); P.wall([[0, 500], [1500, 500]]);
  [700, 1000, 1250].forEach((x) => P.wall([[x, 0], [x, 400]]));
  [350, 750, 950, 1150].forEach((x) => P.wall([[x, 500], [x, 900]]));
  P.wall([[750, 700], [950, 700]], 10);

  [[200, 0], [550, 0], [850, 0], [1125, 0], [1375, 0]].forEach(([x]) => P.door(x, 400, 0));
  P.door(175, 500, 180, 200, { doorType: 'opening' });
  P.door(550, 500, 180, 100, { fireRated: true }); P.door(850, 500, 180); P.door(1050, 500, 180);
  P.door(1325, 500, 180, 100, { emergency: true });
  P.door(175, 900, 180, 170, { doorType: 'double', emergency: true });
  P.door(1500, 450, 90, 100, { emergency: true, swing: 'right' });

  [120, 330, 560, 850, 1125, 1375].forEach((x) => P.win(x, 0));
  [480, 640].forEach((x) => P.win(x, 900));
  P.win(0, 200, 90); P.win(1500, 200, 90); P.win(0, 700, 90);

  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    P.furn('desk', 90 + c * 150, [55, 125, 320][r], 72, 0);
  }
  P.furn('meeting-table', 850, 285, 150);
  P.furn('meeting-table', 1125, 285, 120, 90);
  P.furn('desk', 1375, 120, 90); P.furn('sofa', 1375, 300, 120);
  P.furn('kitchen', 550, 860, 160); P.furn('round-table', 470, 650, 110); P.furn('round-table', 640, 700, 110);
  P.furn('wc', 790, 860, 60, 180); P.furn('wc', 870, 860, 60, 180); P.furn('sink', 850, 560, 70, 180);
  P.furn('plant', 40, 860, 50); P.furn('sofa', 90, 600, 110, 90);
  P.stairs(1260, 700, 150, 320, { stairType: 'landing', steps: 18 });
  P.furn('elevator', 1430, 600, 90);

  P.route([[620, 260], [620, 450], [175, 450], [175, 985]]);
  P.route([[850, 300], [850, 450], [1575, 450]]);
  P.alt([[1375, 330], [1375, 450], [1325, 450], [1325, 590]]);

  P.sym('iso-E001', 250, 850, 44); P.sym('iso-E002', 1445, 400, 44);
  P.sym('iso-F001', 60, 450, 40); P.sym('iso-F001', 1080, 450, 40); P.sym('iso-F001', 700, 560, 40);
  P.sym('iso-F002', 980, 450, 40); P.sym('iso-F005', 290, 860, 40); P.sym('iso-F005', 1445, 520, 40);
  P.sym('iso-E003', 60, 560, 40); P.sym('iso-E010', 110, 560, 40);
  P.sym('iso-E002', 1210, 560, 40); P.sym('iso-P020', 1430, 680, 40);
  P.sym('electric-cutoff', 1110, 860, 40);
  P.sym('iso-E007', 175, 1080, 64, { label: 'Parking visiteurs', labelSize: 15 });
  P.sym('you-are-here', 260, 640, 52, { label: 'Vous êtes ici', variantId: v1.id, labelSize: 15 });
  P.sym('you-are-here', 1180, 450, 52, { label: 'Vous êtes ici', variantId: v2.id, labelSize: 15 });
  f.elements = P.els;
  return p;
}

// ——— 2. École — thème Signalétique ———
export function sampleSchool(): Project {
  const p = newProject('Exemple — École communale des Tilleuls', 'BE');
  const b = p.buildings[0];
  b.name = 'École des Tilleuls'; b.address = 'Rue des Tilleuls 4';
  const f = b.floors[0];
  setupFloor(f, 'signaletique', GREEN, 'Conseiller en prévention');
  f.titleBlock.title = 'Plan d’évacuation';
  const v1 = f.variants[0]; v1.name = 'Hall d’entrée';
  const v2 = newVariant('Réfectoire'); f.variants.push(v2);
  const P = new Plan();
  const W = 1800, H = 1000;

  ['Classe 1', 'Classe 2', 'Classe 3', 'Classe 4'].forEach((n, i) => P.room(i * 400, 0, 400, 450, n, i % 2 ? '#eef4fb' : '#f4f8ee', { labelDy: -60 }));
  P.room(1600, 0, 200, 450, 'Sanitaires', C.wet);
  P.room(0, 450, W, 100, 'Couloir', C.circ, { labelSize: 13, labelColor: '#9aa5b0' });
  P.room(0, 550, 600, 450, 'Réfectoire', C.kitchen, { labelDx: -150 });
  P.room(600, 550, 250, 450, 'Direction', C.office);
  P.room(850, 550, 300, 450, 'Salle des\nprofesseurs', C.meeting, { labelDy: -150 });
  P.room(1150, 550, 200, 450, 'Entretien', C.tech);
  P.room(1350, 550, 250, 450, 'Hall', C.lobby, { labelDy: -150, labelDx: -40 });
  P.room(1600, 550, 200, 450, 'Infirmerie', C.rest, { labelDy: -130 });
  P.zone([[0, 1060], [700, 1060], [700, 1400], [0, 1400]], 'Cour de récréation', '#00843d');

  P.box(0, 0, W, H, 24);
  P.wall([[0, 450], [W, 450]]); P.wall([[0, 550], [W, 550]]);
  [400, 800, 1200, 1600].forEach((x) => P.wall([[x, 0], [x, 450]]));
  [600, 850, 1150, 1350, 1600].forEach((x) => P.wall([[x, 550], [x, H]]));
  [200, 600, 1000, 1400].forEach((x) => P.door(x - 120, 450, 0, 100, { emergency: true }));
  P.door(1700, 450, 0, 80);
  P.door(300, 550, 180, 160, { doorType: 'double' }); P.door(725, 550, 180); P.door(1000, 550, 180);
  P.door(1250, 550, 180); P.door(1475, 550, 180, 200, { doorType: 'opening' }); P.door(1700, 550, 180);
  P.door(0, 500, 270, 140, { doorType: 'double', emergency: true });
  P.door(W, 500, 90, 140, { doorType: 'double', emergency: true });
  P.door(300, H, 180, 180, { doorType: 'double', emergency: true });
  P.door(1475, H, 180, 180, { doorType: 'double', emergency: true });
  for (let i = 0; i < 4; i++) { P.win(i * 400 + 130, 0, 0, 150, 24); P.win(i * 400 + 290, 0, 0, 120, 24); }
  [150, 450].forEach((x) => P.win(x, H, 0, 140, 24));

  for (let i = 0; i < 4; i++) {
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) P.furn('desk', i * 400 + 90 + c * 110, 255 + r * 95, 62, 0);
    P.furn('desk', i * 400 + 200, 60, 80, 180);
  }
  [[120, 700], [300, 700], [480, 700], [120, 880], [300, 860], [480, 880]].forEach(([x, y]) => P.furn('round-table', x, y, 105));
  P.furn('desk', 725, 700, 90); P.furn('meeting-table', 1000, 760, 180, 90);
  P.furn('wc', 1650, 60, 55, 180); P.furn('wc', 1720, 60, 55, 180); P.furn('sink', 1700, 380, 70);
  P.furn('bed', 1700, 820, 90);

  P.route([[1000, 330], [1000, 500], [-70, 500]]);
  P.route([[200, 330], [200, 500], [-70, 500]], { arrowEnd: false });
  P.route([[1400, 330], [1400, 500], [1870, 500]]);
  P.route([[300, 760], [300, 1100]]);
  P.route([[1475, 750], [1475, 1080]]);

  P.sym('iso-E001', 60, 560, 46); P.sym('iso-E002', 1740, 560, 46);
  P.sym('iso-E002', 380, 960, 46); P.sym('iso-E002', 1555, 960, 46);
  [[300, 500], [900, 500], [1500, 500]].forEach(([x, y]) => P.sym('iso-F001', x, y, 40));
  P.sym('iso-F005', 60, 440, 40); P.sym('iso-F005', 1740, 440, 40);
  P.sym('alarm-sounder', 1100, 500, 40);
  P.sym('iso-E003', 1650, 960, 40); P.sym('iso-E010', 1390, 960, 40);
  P.sym('fire-blanket', 560, 600, 40); P.sym('gas-cutoff', 1190, 960, 40); P.sym('electric-cutoff', 1300, 960, 40);
  P.sym('iso-E007', 545, 1300, 72, { label: 'Point de rassemblement', labelSize: 16 });
  P.sym('you-are-here', 1475, 820, 54, { label: 'Vous êtes ici', variantId: v1.id, labelSize: 16 });
  P.sym('you-are-here', 300, 650, 54, { label: 'Vous êtes ici', variantId: v2.id, labelSize: 16 });
  f.elements = P.els;
  f.titleBlock.instructions = `EN CAS D'INCENDIE
1. Donnez l'alarme (bouton rouge).
2. Prévenez la direction.
3. Appelez le 112.

EN CAS D'ÉVACUATION
1. L'enseignant ferme les fenêtres et prend la liste de présence.
2. Les élèves sortent en rang, sans courir.
3. Fermez les portes derrière vous.
4. Rejoignez le point de rassemblement dans la cour.
5. L'enseignant fait l'appel et signale tout absent.`;
  return p;
}

// ——— 3. Hôtel — thème Épuré — trois versions ———
export function sampleHotel(): Project {
  const p = newProject('Exemple — Hôtel du Parc', 'FR');
  const b = p.buildings[0];
  b.name = 'Hôtel du Parc';
  const f = b.floors[0];
  f.name = '1er étage';
  setupFloor(f, 'epure', '#0f6e5a', 'Responsable sécurité', { showNorth: true, northAngle: 20, sidePosition: 'bottom' });
  const v1 = f.variants[0]; v1.name = 'Palier ascenseurs';
  const v2 = newVariant('Chambres 101–105'); const v3 = newVariant('Chambres 111–115');
  f.variants.push(v2, v3);
  const P = new Plan();
  const W = 2200, H = 760;
  P.room(0, 0, 220, H, 'Escalier A', C.stair);
  P.room(W - 220, 0, 220, H, 'Escalier B', C.stair);
  P.room(220, 330, W - 440, 100, '', C.circ);
  for (let i = 0; i < 5; i++) {
    P.room(220 + i * 240, 0, 240, 330, `${101 + i}`, '#f7f4ee', { labelSize: 20, labelBold: true, labelColor: '#6e675c' });
    P.room(220 + i * 240, 430, 240, 330, `${115 - i}`, '#f7f4ee', { labelSize: 20, labelBold: true, labelColor: '#6e675c' });
  }
  P.room(1420, 0, 560, 330, 'Palier · Ascenseurs', C.lobby, { labelDx: 110, labelDy: 120, labelSize: 15 });
  P.room(1420, 430, 280, 330, 'Office', C.tech);
  P.room(1700, 430, 280, 330, 'Lingerie', C.tech);

  P.box(0, 0, W, H, 22);
  P.wall([[220, 330], [W - 220, 330]]); P.wall([[220, 430], [W - 220, 430]]);
  P.wall([[220, 0], [220, H]], 18); P.wall([[W - 220, 0], [W - 220, H]], 18);
  for (let i = 1; i <= 5; i++) { P.wall([[220 + i * 240, 0], [220 + i * 240, 330]]); P.wall([[220 + i * 240, 430], [220 + i * 240, H]]); }
  P.wall([[1700, 430], [1700, H]]);
  for (let i = 0; i < 5; i++) {
    const x = 220 + i * 240;
    P.wall([[x + 150, 0], [x + 150, 130], [x + 240, 130]], 8);
    P.wall([[x + 150, H], [x + 150, H - 130], [x + 240, H - 130]], 8);
    P.furn('bed', x + 75, 110, 120);
    P.furn('bed', x + 75, H - 110, 120, 180);
    P.furn('wc', x + 215, 40, 42, 180); P.furn('shower', x + 172, 40, 40);
    P.furn('wc', x + 215, H - 40, 42); P.furn('shower', x + 172, H - 40, 40);
    P.door(x + 60, 330, 0, 80); P.door(x + 60, 430, 180, 80);
    P.win(x + 75, 0, 0, 120); P.win(x + 75, H, 0, 120);
  }
  P.door(220, 380, 90, 90, { emergency: true, swing: 'right' });
  P.door(W - 220, 380, 270, 90, { emergency: true, swing: 'right' });
  P.door(1560, 430, 180); P.door(1840, 430, 180);
  P.stairs(110, 380, 160, 600, { stairType: 'landing', steps: 20 });
  P.stairs(W - 110, 380, 160, 600, { stairType: 'landing', steps: 20 });
  P.furn('elevator', 1600, 110, 120); P.furn('elevator', 1740, 110, 120); P.furn('sofa', 1890, 160, 110, 90); P.furn('plant', 1490, 60, 60);

  P.route([[1100, 380], [-20, 380]], { arrowRepeat: 150 });
  P.route([[1100, 380], [W + 20, 380]], { arrowRepeat: 150 });
  P.sym('iso-E001', 110, 70, 44); P.sym('iso-E002', W - 110, 70, 44);
  P.sym('iso-E001', 270, 300, 40); P.sym('iso-E002', W - 270, 300, 40);
  [[600, 380], [1300, 380], [1960, 380]].forEach(([x, y]) => P.sym('iso-F001', x, y - 0, 36));
  P.sym('iso-F005', 270, 460, 36); P.sym('iso-F005', W - 270, 460, 36);
  P.sym('iso-P020', 1670, 250, 40); P.sym('smoke-detector', 900, 380, 30); P.sym('iso-E010', 1460, 290, 38);
  P.sym('you-are-here', 1670, 380, 50, { label: 'Vous êtes ici', variantId: v1.id, labelSize: 15, labelPosition: 'right' });
  P.sym('you-are-here', 700, 380, 50, { label: 'Vous êtes ici', variantId: v2.id, labelSize: 15, labelPosition: 'right' });
  P.sym('you-are-here', 460, 380, 50, { label: 'Vous êtes ici', variantId: v3.id, labelSize: 15, labelPosition: 'right' });
  f.elements = P.els;
  f.titleBlock.instructions = `EN CAS D'INCENDIE DANS VOTRE CHAMBRE
1. Quittez la chambre et fermez la porte.
2. Donnez l'alarme et prévenez la réception (9).

EN CAS D'ÉVACUATION
1. Suivez le balisage vers l'escalier le plus proche.
2. N'utilisez jamais l'ascenseur.
3. Si la fumée bloque le couloir, restez dans la chambre, porte fermée, et signalez-vous à la fenêtre.`;
  return p;
}

// ——— 4. Entrepôt logistique — thème Institutionnel (A3) ———
export function sampleWarehouse(): Project {
  const p = newProject('Exemple — Plateforme logistique Nord', 'BE');
  const b = p.buildings[0];
  b.name = 'Plateforme logistique Nord'; b.address = 'Zoning industriel, Allée 3';
  const f = b.floors[0];
  f.name = 'Hall de stockage';
  setupFloor(f, 'institutionnel', '#1f4e8c', 'Coordinateur HSE', { paper: 'A3', showNorth: true });
  const P = new Plan();
  const W = 2600, H = 1500;
  P.room(0, 0, W, H, '', C.store);
  P.room(0, 1100, 700, 400, 'Bureaux', C.office, { labelDx: 180, labelDy: 130 });
  P.room(700, 1100, 300, 400, 'Vestiaires', C.wet);
  P.room(1000, 1100, 260, 400, 'Réfectoire', C.kitchen, { labelDy: -150 });
  P.zone([[1300, 1150], [1700, 1150], [1700, 1450], [1300, 1450]], 'Charge batteries');
  P.zone([[60, 60], [520, 60], [520, 360], [60, 360]], 'Stockage\nproduits inflammables', '#c27400');
  P.box(0, 0, W, H, 26);
  P.wall([[0, 1100], [1260, 1100], [1260, H]], 16);
  P.wall([[700, 1100], [700, H]]); P.wall([[1000, 1100], [1000, H]]);
  P.wall([[60, 360], [520, 360], [520, 60]], 14, { wallStyle: 'hatch' });

  for (let r = 0; r < 7; r++) {
    const x = 640 + r * 220;
    P.shape({ shape: 'rect', x, y: 520, w: 70, h: 820, fill: '#dfe6ee', pattern: 'crosshatch', patternColor: '#9fb0c2', stroke: '#6f8295', strokeWidth: 2, layer: 'building' });
  }
  P.text(1300, 945, 'Allées de stockage — racks R1 à R7', { fontSize: 18, color: '#6f8295', italic: true, align: 'middle' });
  [300, 600, 900, 1200].forEach((y) => P.door(W, y, 90, 200, { doorType: 'sliding' }));
  P.text(W - 40, 1180, 'Quais\nde\nchargement', { fontSize: 18, color: '#6f8295', align: 'end', bold: true });

  P.door(350, 1100, 0, 100); P.door(850, 1100, 0); P.door(1130, 1100, 0);
  P.door(0, 800, 270, 120, { doorType: 'double', emergency: true });
  P.door(1300, 0, 0, 140, { doorType: 'double', emergency: true });
  P.door(350, H, 180, 140, { doorType: 'double', emergency: true });
  P.door(1900, H, 180, 140, { doorType: 'double', emergency: true });
  [150, 500].forEach((x) => P.win(x, H, 0, 160, 26));
  P.furn('desk', 120, 1250, 90); P.furn('desk', 260, 1250, 90); P.furn('desk', 120, 1400, 90, 180); P.furn('meeting-table', 520, 1300, 180, 90);
  P.furn('round-table', 1130, 1300, 110); P.furn('kitchen', 1130, 1460, 150); P.furn('wc', 760, 1450, 55); P.furn('shower', 940, 1450, 60);

  P.route([[2000, 750], [2000, 1000], [1900, 1000], [1900, 1570]]);
  P.route([[1100, 700], [1100, 980], [350, 980], [350, 1570]], { arrowEnd: true });
  P.route([[600, 800], [-70, 800]]);
  P.route([[1300, 450], [1300, -70]]);
  P.alt([[350, 1250], [350, 1130]]);

  [[560, 250], [1300, 1020], [2300, 150], [2300, 1050], [40, 1000], [620, 1000]].forEach(([x, y]) => P.sym('iso-F001', x, y, 40));
  P.sym('iso-F009', 1760, 1180, 44);
  [[40, 500], [2550, 1400], [1300, 70]].forEach(([x, y]) => P.sym('iso-F002', x, y, 40));
  P.sym('iso-F005', 60, 880, 40); P.sym('iso-F005', 1380, 60, 40); P.sym('iso-F005', 2000, 1440, 40);
  P.sym('iso-F012', 2450, 80, 44); P.sym('fire-panel', 120, 1150, 40);
  P.sym('iso-W021', 255, 125, 52); P.sym('iso-P003', 325, 125, 52); P.sym('iso-W012', 1500, 1200, 52);
  P.sym('iso-E003', 640, 1150, 40); P.sym('iso-E011', 1360, 1200, 40); P.sym('iso-E012', 1640, 1200, 40);
  P.sym('iso-E001', 60, 720, 44); P.sym('iso-E002', 1390, 140, 44); P.sym('iso-E002', 430, 1440, 44); P.sym('iso-E002', 1980, 1440, 44);
  P.sym('iso-E007', 1100, 1660, 72, { label: 'Point de rassemblement — parking poids lourds', labelSize: 16 });
  P.sym('you-are-here', 350, 1180, 56, { label: 'Vous êtes ici', labelSize: 16 });
  f.elements = P.els;
  return p;
}

export interface SampleInfo { id: string; title: string; subtitle: string; theme: string; build(): Project }

export const SAMPLES: SampleInfo[] = [
  { id: 'offices', title: 'Bureaux Le Quartz', subtitle: 'Thème Moderne · 2 versions', theme: 'moderne', build: sampleOffices },
  { id: 'school', title: 'École des Tilleuls', subtitle: 'Thème Signalétique · 2 versions', theme: 'signaletique', build: sampleSchool },
  { id: 'hotel', title: 'Hôtel du Parc', subtitle: 'Thème Épuré · 3 versions', theme: 'epure', build: sampleHotel },
  { id: 'warehouse', title: 'Plateforme logistique', subtitle: 'Thème Institutionnel · A3', theme: 'institutionnel', build: sampleWarehouse },
];

/** Compatibilité : projet d'exemple utilisé par l'autotest. */
export function buildSampleProject(): Project {
  return sampleOffices();
}

export function buildReviewDemo(): Project {
  const project = sampleOffices();
  project.name = 'Démonstration 2.0.11 — Le Quartz';
  const building = project.buildings[0];
  const ground = building.floors[0];
  const upstairs = cloneFloorWithNewIds(ground, 'Premier étage');
  upstairs.level = 1;
  upstairs.variants[0].name = 'Palier';
  upstairs.variants = upstairs.variants.slice(0, 1);
  upstairs.elements = upstairs.elements.filter((e) => !e.variantId || e.variantId === upstairs.variants[0].id);
  Object.assign(upstairs.page, { paper: 'A3', orientation: 'portrait' });
  building.floors.push(upstairs);
  return project;
}
