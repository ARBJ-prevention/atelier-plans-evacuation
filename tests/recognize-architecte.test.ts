/**
 * Plans d'architecte « réels » : conventions de calques numérotées (« 913_AR_RE_Mur coupé »…),
 * fichier déclaré en millimètres mais dessiné en centimètres, portes dessinées ouvertes à 45°,
 * numéros de locaux posés sur les portes et surfaces au centre des pièces, salles séparées
 * seulement par des amorces de murs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  arcPoints, checkUnitByDoors, decodeDxfBytes, flattenDxf, parseDxf, renderDxfSvg, unitMeters, type DxfPrim, type FlatDxf, type Vec,
} from '../src/services/dxf';
import { guessLayerRole, recognizePlan, type LayerRole } from '../src/services/recognize';
import { getBuiltinSymbol } from '../src/symbols/library';

const UPM = 50;
const WALL = '913_AR_RE_Mur coupé';
const DOORS = '159_AR_INT_Menuiseries int.';

const base = (layer: string) => ({ layer, chain: [layer], color: '#000000', lw: 0 });
const line = (layer: string, pts: Vec[], closed = false): DxfPrim => ({ ...base(layer), kind: 'line', pts, closed });
const rect = (layer: string, x0: number, y0: number, x1: number, y1: number) => line(layer, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true);
const text = (layer: string, at: Vec, ...lines: string[]): DxfPrim => ({
  ...base(layer), kind: 'text', at, height: 20, rotation: 0, lines, hAlign: 'middle', vAlign: 'middle',
});
/** Battant ouvert à 45° (rayon r, charnière h), avec le trait du vantail ouvert. */
function door45(h: Vec, r: number, startDeg: number, group: number): DxfPrim[] {
  const start = (startDeg * Math.PI) / 180, sweep = Math.PI / 4;
  const pts = arcPoints(h[0], h[1], r, start, sweep);
  const p0 = pts[0], p1 = pts[pts.length - 1];
  return [
    { ...base(DOORS), group, kind: 'line', pts, closed: false, arc: { c: h, r, p0, p1, sweep: 45 } },
    { ...base(DOORS), group, kind: 'line', pts: [h, p1], closed: false },
  ];
}

/**
 * Deux salles de 5,8 m × 4,6 m (dessin en cm, fichier déclaré en mm) :
 * murs de 20 cm, une porte de 90 cm ouverte à 45° dans le mur du haut,
 * cloison centrale réduite à deux amorces (l'ouverture du milieu n'est pas dessinée).
 */
function architectPlan(): FlatDxf {
  const prims: DxfPrim[] = [
    // façade : contour extérieur et intérieur, interrompu par la porte (x 300 → 390)
    line(WALL, [[300, 500], [0, 500], [0, 0], [1200, 0], [1200, 500], [390, 500]]),
    line(WALL, [[300, 480], [20, 480], [20, 20], [1180, 20], [1180, 480], [390, 480]]),
    line(WALL, [[300, 480], [300, 500]]), line(WALL, [[390, 480], [390, 500]]),
    // amorces de la séparation centrale (le milieu reste ouvert dans le dessin)
    rect(WALL, 590, 20, 610, 140), rect(WALL, 590, 360, 610, 480),
    // poteau de 40 × 20 cm contre la façade (détail à exclure du plan d'évacuation)
    rect(WALL, 1100, 20, 1140, 40),
    // gaine dessinée en simple trait sur le calque des murs
    line(WALL, [[100, 300], [100, 480]]),
    ...door45([300, 490], 90, 0, 1),
    line('Seuil', [[300, 490], [390, 490]]),
    // cadre de la porte sur le calque des menuiseries extérieures : ce n'est pas une fenêtre
    line('154_AR_EXT_Menuiserie_ext', [[305, 485], [385, 485]]), line('154_AR_EXT_Menuiserie_ext', [[305, 495], [385, 495]]),
    // réduit fermé de 2 m × 1,8 m sans nom ni surface (dégagement) dans la salle de droite
    line(WALL, [[700, 20], [700, 200], [900, 200], [900, 20]]),
    text('TEXTES COTES', [300, 250], '30,00 m²'),
    text('TEXTES COTES', [900, 250], '30,00 m²'),
    text('TEXTES COTES', [900, 380], 'NIV. 10.00'),
    text('TEXTES COTES', [345, 530], "E.i. 30'"),
    text('N° LOCAL', [345, 495], 'A 101'), // posé sur la porte
    text('N° LOCAL', [900, 10], 'A 102'), // posé dans le mur
  ];
  const layers = [...new Set(prims.map((p) => p.layer))].map((name) => ({
    name, count: prims.filter((p) => p.layer === name).length, color: '#000000', defaultVisible: true,
  }));
  return { prims, layers, insUnits: 4, skipped: {} };
}

function recognizeArchitect(flat: FlatDxf, unit: string) {
  const roles: Record<string, LayerRole> = Object.fromEntries(flat.layers.map((l) => [l.name, l.defaultVisible ? guessLayerRole(l.name) : 'ignore']));
  const visible = new Set(flat.layers.filter((l) => l.defaultVisible).map((l) => l.name));
  const res = renderDxfSvg(flat, { visibleLayers: visible, metersPerUnit: unitMeters(unit), unitsPerMeter: UPM, monochrome: true });
  return recognizePlan(flat, { roles, origin: res.origin, unitsPerMeter: UPM });
}

describe('calques d’architecte à numéros', () => {
  it('reconnaît menuiseries, numéros de locaux, textes et écarte seuils, sanitaires et traits cachés', () => {
    expect(guessLayerRole('159_AR_INT_Menuiseries int.')).toBe('doors');
    expect(guessLayerRole('154_AR_EXT_Menuiserie_ext')).toBe('windows');
    expect(guessLayerRole('N° LOCAL')).toBe('labels');
    expect(guessLayerRole('TEXTES COTES')).toBe('labels');
    expect(guessLayerRole('913_AR_RE_Mur coupé')).toBe('walls');
    expect(guessLayerRole('157_AR_INT_Cloison coupée')).toBe('partitions');
    expect(guessLayerRole('912_AR_RE_Mur caché')).toBe('ignore');
    expect(guessLayerRole('156_AR_INT_Cloison cachée')).toBe('ignore');
    expect(guessLayerRole('Seuil')).toBe('ignore');
    expect(guessLayerRole('401_SAN_Equipements')).toBe('ignore');
    expect(guessLayerRole('406_SAN_Diffusion')).toBe('ignore');
    expect(guessLayerRole('COTATIONS')).toBe('ignore');
  });
});

describe('contrôle de l’unité par la largeur des portes', () => {
  const flat: FlatDxf = {
    prims: [0, 1, 2, 3, 4, 5].flatMap((i) => door45([i * 200, 0], i % 2 ? 83 : 93, 0, i)),
    layers: [{ name: DOORS, count: 12, color: '#000000', defaultVisible: true }], insUnits: 4, skipped: {},
  };
  const visible = new Set([DOORS]);

  it('propose les centimètres quand un fichier « mm » donnerait des portes de 9 cm', () => {
    const fix = checkUnitByDoors(flat, visible, 'mm');
    expect(fix?.unit).toBe('cm');
    expect(fix!.doorM).toBeCloseTo(0.093, 3);
  });

  it('ne change rien quand l’unité est plausible ou qu’il y a trop peu de portes', () => {
    expect(checkUnitByDoors(flat, visible, 'cm')).toBeNull();
    expect(checkUnitByDoors({ ...flat, prims: flat.prims.slice(0, 4) }, visible, 'mm')).toBeNull();
  });
});

describe('reconnaissance d’un plan d’architecte (dessin en cm)', () => {
  const rec = recognizeArchitect(architectPlan(), 'cm');

  it('retrouve la porte ouverte à 45°, avec sa largeur réelle', () => {
    expect(rec.doors).toHaveLength(1);
    expect(rec.doors[0].width / UPM).toBeCloseTo(0.9, 2);
  });

  it('sépare les deux salles reliées par une ouverture non dessinée et leur rattache les numéros posés sur la porte et dans le mur', () => {
    const rooms = rec.rooms.filter((r) => r.label).sort((a, b) => a.points[0][0] - b.points[0][0]);
    expect(rooms.map((r) => r.label)).toEqual(['A 101', 'A 102']);
    expect(rooms.every((r) => r.showArea)).toBe(true);
    // la frontière tombe à mi-chemin des surfaces, au droit des amorces de la cloison (x = 6 m)
    const xs = rooms[0].points.map((p) => p[0] / UPM);
    expect(Math.min(...xs)).toBeCloseTo(0.2, 0);
    expect(Math.abs(Math.max(...xs) - 6)).toBeLessThan(0.15);
  });

  const len = (w: { points: number[][] }) => Math.hypot(w.points[1][0] - w.points[0][0], w.points[1][1] - w.points[0][1]) / UPM;

  it('donne aux murs extérieurs une épaisseur unique, plus forte que celle des murs intérieurs', () => {
    const façade = rec.walls.filter((w) => len(w) > 4);
    expect(façade.length).toBeGreaterThanOrEqual(4);
    expect(façade.every((w) => Math.abs(w.thickness / UPM - 0.28) < 0.005)).toBe(true);
    const amorces = rec.walls.filter((w) => Math.abs(w.points[0][0] / UPM - 6) < 0.05 && Math.abs(w.points[1][0] / UPM - 6) < 0.05);
    expect(amorces.length).toBe(2);
    expect(amorces.every((w) => w.thickness / UPM <= 0.15 + 1e-6)).toBe(true);
  });

  it('rend le mur continu au droit de la porte et y cale la porte', () => {
    const d = rec.doors[0];
    const host = rec.walls.find((w) => {
      const [a, b] = w.points, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, along = (d.x - a[0]) * ux + (d.y - a[1]) * uy;
      return Math.abs((d.x - a[0]) * uy - (d.y - a[1]) * ux) < 0.5 && along >= d.width / 2 && along <= L - d.width / 2;
    });
    expect(host).toBeTruthy();
    expect(Math.abs(((d.rotation % 180) + 180) % 180)).toBeLessThan(0.5);
  });

  it('écarte poteaux et petits morceaux, retrace le mur en simple trait', () => {
    expect(rec.walls.every((w) => len(w) >= 0.5)).toBe(true);
    expect(rec.walls.some((w) => Math.abs(w.points[0][0] / UPM - 1) < 0.05 && Math.abs(len(w) - 1.8) < 0.15)).toBe(true);
  });

  it('marque coupe-feu la porte signalée « E.i. 30’ »', () => {
    expect(rec.doors[0].fireRated).toBe(true);
    expect(rec.doors[0].fireRating).toBe('EI 30');
  });

  it('ne garde pas de fenêtre sur une porte', () => {
    expect(rec.windows).toHaveLength(0);
    expect(rec.doors).toHaveLength(1);
  });

  it('donne une zone sans nom aux espaces fermés sans texte (dégagements)', () => {
    const free = rec.rooms.filter((r) => !r.label);
    expect(free).toHaveLength(1);
    const xs = free[0].points.map((q) => q[0] / UPM), ys = free[0].points.map((q) => q[1] / UPM);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 0);
    expect(free[0].showArea).toBe(false);
  });

  it('n’utilise pas les niveaux ou les degrés coupe-feu comme noms de pièces', () => {
    expect(rec.rooms.some((r) => /NIV/.test(r.label))).toBe(false);
  });

  it('ne reconnaît rien d’utile avec l’unité déclarée (mm), d’où le contrôle par les portes', () => {
    const wrong = recognizeArchitect(architectPlan(), 'mm');
    expect(wrong.doors).toHaveLength(0);
    expect(wrong.rooms.filter((r) => r.label)).toHaveLength(0);
  });
});

/**
 * Bâtiment de 10 m × 6 m (dessin en cm) : un WC de 1 m × 1,2 m fermé par des cloisons dans un angle,
 * et un sas d'entrée de 3 m × 2 m dont la façade n'est fermée que par le trait d'une menuiserie
 * (portail sans battant dessiné). Tout l'intérieur doit recevoir une zone.
 */
function completionPlan(): FlatDxf {
  const prims: DxfPrim[] = [
    // façade, interrompue en bas entre x = 400 et x = 700 (sas)
    line(WALL, [[400, 600], [0, 600], [0, 0], [1000, 0], [1000, 600], [700, 600]]),
    line(WALL, [[400, 580], [20, 580], [20, 20], [980, 20], [980, 580], [700, 580]]),
    // murs du sas
    line(WALL, [[380, 600], [380, 400], [720, 400], [720, 600]]),
    line(WALL, [[400, 600], [400, 420], [700, 420], [700, 600]]),
    // WC : cloisons de 10 cm dans l'angle en haut à droite
    rect('157_AR_INT_Cloison coupée', 870, 20, 880, 140), rect('157_AR_INT_Cloison coupée', 870, 140, 980, 150),
    // portail du sas : simple trait de menuiserie, sans battant
    line(DOORS, [[400, 590], [700, 590]]),
    text('TEXTES COTES', [200, 200], '50,00 m²'),
  ];
  const layers = [...new Set(prims.map((p) => p.layer))].map((name) => ({
    name, count: prims.filter((p) => p.layer === name).length, color: '#000000', defaultVisible: true,
  }));
  return { prims, layers, insUnits: 5, skipped: {} };
}

describe('complétion de l’intérieur du bâtiment', () => {
  const flat = completionPlan();
  const rec = recognizeArchitect(flat, 'cm');
  const visible = new Set(flat.layers.map((l) => l.name));
  const { origin } = renderDxfSvg(flat, { visibleLayers: visible, metersPerUnit: 0.01, unitsPerMeter: UPM, monochrome: true });
  const toPlan = (x: number, y: number): [number, number] => [(x - origin.minX) * origin.k, (origin.maxY - y) * origin.k];
  const inPoly = ([px, py]: [number, number], poly: number[][]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const covered = (x: number, y: number) => rec.rooms.some((r) => inPoly(toPlan(x, y), r.points));

  it('couvre le WC fermé et le sas fermé par une menuiserie', () => {
    expect(covered(925, 80)).toBe(true); // WC
    expect(covered(550, 500)).toBe(true); // sas
  });

  it('redessine le portail sans battant comme une baie à volet roulant, coffre côté extérieur', () => {
    expect(guessLayerRole('160_AR_Volets roulants')).toBe('doors');
    expect(rec.doors).toHaveLength(0);
    expect(rec.windows).toHaveLength(1);
    const bay = rec.windows[0];
    expect(bay.shutter).toBe('rolling');
    expect(bay.width / UPM).toBeCloseTo(3, 1);
    // dans l'axe de la façade (y = 590 dans le dessin), qui devient continue sous la baie
    const [cx, cy] = toPlan(550, 590);
    expect(Math.abs(bay.x - cx)).toBeLessThan(2);
    expect(Math.abs(bay.y - cy)).toBeLessThan(2);
    // côté A (y local négatif) tourné vers l'extérieur, sinon flipY
    const th = (bay.rotation * Math.PI) / 180;
    const sideA = [Math.sin(th), -Math.cos(th)];
    const probe = (k: number) => [bay.x + sideA[0] * k, bay.y + sideA[1] * k] as [number, number];
    const out = bay.flipY ? probe(-40) : probe(40);
    expect(rec.rooms.some((r) => inPoly(out, r.points))).toBe(false);
    expect(rec.rooms.some((r) => inPoly(bay.flipY ? probe(40) : probe(-40), r.points))).toBe(true);
  });

  it('ne laisse aucun vide à l’intérieur', () => {
    const holes: string[] = [];
    for (let x = 50; x < 1000; x += 50) for (let y = 50; y < 580; y += 50) {
      const nearWall = [20, 380, 400, 420, 700, 720, 870, 880, 980].some((v) => Math.abs(x - v) < 15) || [20, 140, 150, 400, 420, 580].some((v) => Math.abs(y - v) < 15);
      if (!nearWall && !covered(x, y)) holes.push(`${x},${y}`);
    }
    expect(holes).toEqual([]);
  });

  it('ne déborde pas à l’extérieur', () => {
    expect(covered(550, 650)).toBe(false);
    expect(covered(-50, 300)).toBe(false);
  });
});

/**
 * Plan réel fourni par l'utilisateur (non versionné) : définir PLAN_ARCHITECTE_DXF avec le chemin
 * du DXF converti (ODA File Converter) pour lancer ce contrôle.
 */
const realPlan = process.env.PLAN_ARCHITECTE_DXF;
describe.skipIf(!realPlan || !existsSync(realPlan))('plan d’architecte réel (PLAN_ARCHITECTE_DXF)', () => {
  it('corrige l’unité et redessine pièces, portes, fenêtres et escaliers', () => {
    const flat = flattenDxf(parseDxf(decodeDxfBytes(readFileSync(realPlan!))));
    const visible = new Set(flat.layers.filter((l) => l.defaultVisible).map((l) => l.name));
    const unit = checkUnitByDoors(flat, visible, 'mm')?.unit;
    expect(unit).toBe('cm');
    const rec = recognizeArchitect(flat, unit!);
    expect(rec.doors.length).toBeGreaterThanOrEqual(60);
    expect(rec.windows.length).toBeGreaterThanOrEqual(20);
    expect(rec.stairs.length).toBeGreaterThanOrEqual(2);
    expect(rec.rooms.length).toBeGreaterThanOrEqual(20);
    expect(rec.rooms.filter((r) => /^A \d+/.test(r.label)).length).toBeGreaterThanOrEqual(15);
    const len = (w: { points: number[][] }) => Math.hypot(w.points[1][0] - w.points[0][0], w.points[1][1] - w.points[0][1]) / UPM;
    expect(rec.walls.filter((w) => len(w) < 0.5)).toHaveLength(0);
    // couloirs et dégagements reçoivent aussi une zone
    expect(rec.rooms.length).toBeGreaterThanOrEqual(30);
    expect(rec.rooms.filter((r) => !r.label).length).toBeGreaterThanOrEqual(3);
    // aucune fenêtre posée sur une porte
    const onDoor = rec.windows.filter((w) => rec.doors.some((d) => Math.hypot(d.x - w.x, d.y - w.y) < (d.width + w.width) / 2 - 1
      && Math.abs((((d.rotation - w.rotation) % 180) + 180) % 180 - 90) > 60));
    expect(onDoor).toHaveLength(0);
    const thick = [...new Set(rec.walls.map((w) => Math.round((w.thickness / UPM) * 100)))].sort((a, b) => a - b);
    expect(thick[thick.length - 1]).toBeGreaterThanOrEqual(28); // façade
    expect(thick.filter((t) => t > 15 && t < 28)).toHaveLength(0); // intérieur : 15 cm au plus
    expect(rec.doors.filter((d) => d.fireRated).length).toBeGreaterThanOrEqual(3);
    // les deux grandes baies sans battant (rideau, porte sectionnelle) reçoivent un volet roulant
    expect(rec.windows.filter((w) => w.shutter === 'rolling')).toHaveLength(2);
    // le sas d'entrée vitré reçoit une porte coulissante double de 2,40 m dans un mur de façade
    expect(rec.doors.filter((d) => d.doorType === 'slidingDouble' &&Math.abs(d.width / UPM - 2.4) < 0.05)).toHaveLength(1);
  });
});

/**
 * Bâtiment de 10 m × 6 m (dessin en cm) dont la façade gauche est en double trait sauf ses deux derniers mètres,
 * tracés d'un seul trait sur la face intérieure (annexe accolée), et dont la façade droite fait une marche de 15 cm.
 */
function facadePlan(): FlatDxf {
  const prims: DxfPrim[] = [
    line(WALL, [[0, 400], [0, 0], [1000, 0], [1000, 300]]),
    line(WALL, [[985, 300], [985, 600], [0, 600], [0, 600]]),
    line(WALL, [[20, 400], [20, 20], [980, 20], [980, 300]]),
    line(WALL, [[965, 300], [965, 580], [20, 580], [20, 400]]),
    line(WALL, [[0, 400], [20, 400]]),
    text('TEXTES COTES', [500, 300], '55,00 m²'),
  ];
  const layers = [...new Set(prims.map((p) => p.layer))].map((name) => ({
    name, count: prims.filter((p) => p.layer === name).length, color: '#000000', defaultVisible: true,
  }));
  return { prims, layers, insUnits: 5, skipped: {} };
}

describe('contour uniforme du bâtiment', () => {
  const rec = recognizeArchitect(facadePlan(), 'cm');
  const vertical = (w: { points: number[][] }) => Math.abs(w.points[0][0] - w.points[1][0]) < 1;
  const length = (w: { points: number[][] }) => Math.hypot(w.points[1][0] - w.points[0][0], w.points[1][1] - w.points[0][1]) / UPM;

  it('donne à tout le contour la même épaisseur, sans cloison sur la ligne de façade', () => {
    const left = rec.walls.filter((w) => vertical(w) && w.points[0][0] / UPM < 1);
    expect(left).toHaveLength(1);
    expect(length(left[0])).toBeGreaterThan(5.5);
    const t = left[0].thickness;
    expect(rec.walls.filter((w) => length(w) > 2).every((w) => Math.abs(w.thickness - t) < 0.01)).toBe(true);
  });

  it('réaligne un morceau de façade décalé de moins d’une épaisseur', () => {
    const right = rec.walls.filter((w) => vertical(w) && w.points[0][0] / UPM > 9);
    expect(right).toHaveLength(1);
    expect(length(right[0])).toBeGreaterThan(5.5);
  });
});

/**
 * Bâtiment de 10 m × 6 m (dessin en cm) dont la façade droite s'interrompt entre y = 2 m et y = 4,5 m :
 * entrée vitrée dessinée en menuiserie, châssis fixes sur les côtés et vantaux en retrait au milieu (90 cm).
 */
function entrancePlan(): FlatDxf {
  const prims: DxfPrim[] = [
    line(WALL, [[1000, 200], [1000, 0], [0, 0], [0, 600], [1000, 600], [1000, 450]]),
    line(WALL, [[980, 200], [980, 20], [20, 20], [20, 580], [980, 580], [980, 450]]),
    line(WALL, [[980, 200], [1000, 200]]), line(WALL, [[980, 450], [1000, 450]]),
    line(DOORS, [[990, 200], [990, 450]]),
    line(DOORS, [[998, 200], [998, 280]]), line(DOORS, [[998, 370], [998, 450]]),
    line(DOORS, [[982, 280], [982, 370]]),
    line(DOORS, [[982, 280], [998, 280]]), line(DOORS, [[982, 370], [998, 370]]),
    text('TEXTES COTES', [500, 300], '55,00 m²'),
  ];
  const layers = [...new Set(prims.map((p) => p.layer))].map((name) => ({
    name, count: prims.filter((p) => p.layer === name).length, color: '#000000', defaultVisible: true,
  }));
  return { prims, layers, insUnits: 5, skipped: {} };
}

describe('entrée vitrée (sas)', () => {
  const flat = entrancePlan();
  const rec = recognizeArchitect(flat, 'cm');
  const { origin } = renderDxfSvg(flat, { visibleLayers: new Set(flat.layers.map((l) => l.name)), metersPerUnit: 0.01, unitsPerMeter: UPM, monochrome: true });
  const toPlan = (x: number, y: number): [number, number] => [(x - origin.minX) * origin.k, (origin.maxY - y) * origin.k];

  it('pose une porte coulissante double à la place des vantaux', () => {
    expect(rec.doors).toHaveLength(1);
    const d = rec.doors[0];
    expect(d.doorType).toBe('slidingDouble');
    expect(d.width / UPM).toBeCloseTo(0.9, 1);
    const [cx, cy] = toPlan(990, 325);
    expect(Math.abs(d.x - cx)).toBeLessThan(15);
    expect(Math.abs(d.y - cy)).toBeLessThan(2);
    const th = (d.rotation * Math.PI) / 180, open = d.flipY ? -1 : 1;
    expect(open * Math.sin(th)).toBeGreaterThan(0.9); // côté A (−y local) ou B selon flipY : vers x croissant, l'extérieur
  });

  it('ferme la façade d’un mur continu de la même épaisseur que les autres', () => {
    const right = rec.walls.filter((w) => Math.abs(w.points[0][0] - w.points[1][0]) < 1 && w.points[0][0] > toPlan(900, 0)[0]);
    expect(right).toHaveLength(1);
    expect(Math.abs(right[0].points[1][1] - right[0].points[0][1]) / UPM).toBeGreaterThan(5.5);
    expect(rec.walls.every((w) => Math.abs(w.thickness - right[0].thickness) < 0.01)).toBe(true);
  });
});

/** Même bâtiment, mais le sas est en retrait de 1 m : ses murs latéraux vont jusqu'à la ligne de façade (x = 10 m). */
function recessedEntrancePlan(): FlatDxf {
  const prims: DxfPrim[] = [
    line(WALL, [[1000, 200], [1000, 0], [0, 0], [0, 600], [1000, 600], [1000, 450]]),
    line(WALL, [[980, 190], [980, 20], [20, 20], [20, 580], [980, 580], [980, 460]]),
    // murs latéraux du sas, de la façade jusqu'à l'intérieur (x = 7 m)
    line(WALL, [[1000, 200], [700, 200]]), line(WALL, [[1000, 190], [700, 190]]),
    line(WALL, [[1000, 450], [700, 450]]), line(WALL, [[1000, 460], [700, 460]]),
    line(DOORS, [[890, 200], [890, 450]]),
    line(DOORS, [[898, 200], [898, 280]]), line(DOORS, [[898, 370], [898, 450]]),
    line(DOORS, [[882, 280], [882, 370]]),
    text('TEXTES COTES', [400, 300], '55,00 m²'),
  ];
  const layers = [...new Set(prims.map((p) => p.layer))].map((name) => ({
    name, count: prims.filter((p) => p.layer === name).length, color: '#000000', defaultVisible: true,
  }));
  return { prims, layers, insUnits: 5, skipped: {} };
}

describe('sas en retrait de la façade', () => {
  const flat = recessedEntrancePlan();
  const rec = recognizeArchitect(flat, 'cm');
  const { origin } = renderDxfSvg(flat, { visibleLayers: new Set(flat.layers.map((l) => l.name)), metersPerUnit: 0.01, unitsPerMeter: UPM, monochrome: true });
  const xOf = (x: number) => (x - origin.minX) * origin.k;
  const yOf = (y: number) => (origin.maxY - y) * origin.k;

  it('garde les murs latéraux jusqu’à la façade et arrête le mur de l’entrée au nu de ces murs', () => {
    expect(rec.doors.filter((d) => d.doorType === 'slidingDouble')).toHaveLength(1);
    const sides = rec.walls.filter((w) => Math.abs(w.points[0][1] - w.points[1][1]) < 1
      && w.points[0][1] > yOf(500) && w.points[0][1] < yOf(100) && Math.min(w.points[0][0], w.points[1][0]) < xOf(800));
    expect(sides).toHaveLength(2);
    for (const w of sides) expect(Math.max(w.points[0][0], w.points[1][0])).toBeGreaterThan(xOf(980));
    // mur de l'entrée : bout carré (demi-épaisseur) au ras de la face extérieure de chaque mur latéral
    const entry = rec.walls.find((w) => Math.abs(w.points[0][0] - w.points[1][0]) < 1 && Math.abs(w.points[0][0] - xOf(890)) < 10)!;
    expect(entry).toBeTruthy();
    const ys = entry.points.map((p) => p[1]).sort((p, q) => p - q);
    const sideYs = sides.map((w) => w.points[0][1]).sort((p, q) => p - q);
    expect(ys[0] - entry.thickness / 2).toBeCloseTo(sideYs[0] - sides[0].thickness / 2, 0);
    expect(ys[1] + entry.thickness / 2).toBeCloseTo(sideYs[1] + sides[1].thickness / 2, 0);
  });
});

/**
 * Bâtiment de 12 m × 8 m (dessin en cm) traversé par un mur de couloir à y = 4 m : 15 cm d'épaisseur,
 * sauf entre x = 4 m et x = 8 m où il est dessiné épais (45 cm, côté bas seulement décalé).
 */
function corridorPlan(): FlatDxf {
  const prims: DxfPrim[] = [
    rect(WALL, 0, 0, 1200, 800), rect(WALL, 30, 30, 1170, 770),
    line(WALL, [[30, 392], [400, 392]]), line(WALL, [[30, 408], [400, 408]]),
    line(WALL, [[400, 392], [800, 392]]), line(WALL, [[400, 437], [800, 437]]),
    line(WALL, [[400, 408], [400, 437]]), line(WALL, [[800, 408], [800, 437]]),
    line(WALL, [[800, 392], [1170, 392]]), line(WALL, [[800, 408], [1170, 408]]),
    text('TEXTES COTES', [600, 200], '40,00 m²'), text('TEXTES COTES', [600, 600], '40,00 m²'),
  ];
  const layers = [...new Set(prims.map((p) => p.layer))].map((name) => ({
    name, count: prims.filter((p) => p.layer === name).length, color: '#000000', defaultVisible: true,
  }));
  return { prims, layers, insUnits: 5, skipped: {} };
}

describe('murs intérieurs d’une même ligne', () => {
  const rec = recognizeArchitect(corridorPlan(), 'cm');
  it('réunit les morceaux décalés ou plus épais en un seul mur droit d’épaisseur intérieure', () => {
    const horiz = rec.walls.filter((w) => Math.abs(w.points[0][1] - w.points[1][1]) < 1);
    const inner = horiz.filter((w) => w.thickness < 0.2 * UPM);
    expect(inner).toHaveLength(1);
    const L = Math.abs(inner[0].points[1][0] - inner[0].points[0][0]) / UPM;
    expect(L).toBeGreaterThan(11);
    expect(inner[0].thickness / UPM).toBeCloseTo(0.15, 2);
  });
});

describe('pictogrammes de volets', () => {
  it('propose un volet roulant et des volets battants dans « Structure du bâtiment »', () => {
    const sas = getBuiltinSymbol('door-sliding-double');
    expect(sas?.category).toBe('Structure du bâtiment');
    expect(sas?.name).toBe('Porte coulissante double (sas)');
    for (const id of ['shutter-rolling', 'shutter-hinged']) {
      const sym = getBuiltinSymbol(id);
      expect(sym?.category).toBe('Structure du bâtiment');
      expect(sym?.planSymbol).toBe(true);
      expect(sym?.name.toLowerCase()).toContain('volet');
    }
  });
});
