import { describe, expect, it } from 'vitest';
import { buildSampleDxf } from '../src/app/sampleDxf';
import { flattenDxf, parseDxf, renderDxfSvg, unitMeters } from '../src/services/dxf';
import { guessLayerRole, recognizedElements, recognizePlan, type LayerRole } from '../src/services/recognize';

const UPM = 50;

function recognizeSample() {
  const flat = flattenDxf(parseDxf(buildSampleDxf()));
  const roles: Record<string, LayerRole> = Object.fromEntries(flat.layers.map((l) => [l.name, l.defaultVisible ? guessLayerRole(l.name) : 'ignore']));
  const visible = new Set(flat.layers.filter((l) => roles[l.name] !== 'ignore').map((l) => l.name));
  const res = renderDxfSvg(flat, { visibleLayers: visible, metersPerUnit: unitMeters('mm'), unitsPerMeter: UPM, monochrome: true });
  return { roles, rec: recognizePlan(flat, { roles, origin: res.origin, unitsPerMeter: UPM }), res };
}

describe('rôles des calques', () => {
  it('devine le rôle d’après le nom', () => {
    expect(guessLayerRole('MURS')).toBe('walls');
    expect(guessLayerRole('A-WALL-FULL')).toBe('walls');
    expect(guessLayerRole('Cloisons_placo')).toBe('partitions');
    expect(guessLayerRole('A-DOOR')).toBe('doors');
    expect(guessLayerRole('Menuiseries portes')).toBe('doors');
    expect(guessLayerRole('FENÊTRES')).toBe('windows');
    expect(guessLayerRole('A-GLAZ')).toBe('windows');
    expect(guessLayerRole('Escaliers')).toBe('stairs');
    expect(guessLayerRole('A-AREA-IDEN')).toBe('rooms');
    expect(guessLayerRole('Noms locaux')).toBe('rooms');
    expect(guessLayerRole('TEXTES')).toBe('labels');
    expect(guessLayerRole('COTATIONS')).toBe('ignore');
    expect(guessLayerRole('Mobilier')).toBe('ignore');
    expect(guessLayerRole('SUPPORT')).toBe('other');
    expect(guessLayerRole('0')).toBe('other');
  });
});

describe('reconnaissance du plan d’exemple (24 × 14 m)', () => {
  const { rec } = recognizeSample();

  it('retrouve les 5 pièces avec leur nom', () => {
    const labels = rec.rooms.map((r) => r.label).sort();
    expect(labels).toEqual(['Accueil', 'Atelier', 'Bureau 1', 'Salle de réunion', 'Stockage']);
    const accueil = rec.rooms.find((r) => r.label === 'Accueil')!;
    expect(accueil.showArea).toBe(true); // le texte source contenait la surface
    // Accueil : 8,70 m × 7,70 m entre murs (≈ 67 m²), à la résolution de la grille près
    const xs = accueil.points.map((p) => p[0]), ys = accueil.points.map((p) => p[1]);
    expect((Math.max(...xs) - Math.min(...xs)) / UPM).toBeCloseTo(8.7, 0);
    expect((Math.max(...ys) - Math.min(...ys)) / UPM).toBeCloseTo(7.7, 0);
  });

  it('noms de pièces en évidence : gras, foncés, grands mais contenus dans la pièce', () => {
    for (const r of rec.rooms) {
      expect(r.labelBold).toBe(true);
      expect(r.labelColor).toBe('#1d2630');
      const xs = r.points.map((p) => p[0]);
      const w = Math.max(...xs) - Math.min(...xs);
      const chars = Math.max(...r.label.split('\n').map((l) => l.length));
      expect(chars * r.labelSize * 0.6).toBeLessThanOrEqual(w * 0.85 + 1e-6); // tient dans la largeur
      expect(r.labelSize).toBeGreaterThanOrEqual(0.2 * UPM);
    }
    // plan de 24 m : cible ≈ 53 cm (24/45) ; « Accueil » (8,7 m de large) l'atteint
    expect(rec.rooms.find((r) => r.label === 'Accueil')!.labelSize / UPM).toBeGreaterThan(0.5);
  });

  it('sans remplissage des locaux : pas de pièces, mais leurs noms en textes à leur place', () => {
    const all = new Set(['rooms', 'walls', 'doors', 'windows', 'stairs'] as const);
    const filled = recognizedElements(rec, all);
    const empty = recognizedElements(rec, all, false);
    expect(filled.filter((e) => e.type === 'area')).toHaveLength(5);
    expect(empty.filter((e) => e.type === 'area')).toHaveLength(0);
    const texts = empty.filter((e) => e.type === 'text') as any[];
    expect(texts.map((t) => t.text).sort()).toEqual(['Accueil', 'Atelier', 'Bureau 1', 'Salle de réunion', 'Stockage']);
    // chaque nom reste dans sa pièce
    for (const t of texts) {
      const room = rec.rooms.find((r) => r.label === t.text)!;
      const xs = room.points.map((p) => p[0]), ys = room.points.map((p) => p[1]);
      expect(t.x).toBeGreaterThan(Math.min(...xs)); expect(t.x).toBeLessThan(Math.max(...xs));
      expect(t.y).toBeGreaterThan(Math.min(...ys)); expect(t.y).toBeLessThan(Math.max(...ys));
      expect(t.align).toBe('middle');
      // étiquette foncée, texte blanc : se voit sur des locaux clairs
      expect(t.background).toBe('#1d2630'); expect(t.color).toBe('#ffffff'); expect(t.bold).toBe(true);
    }
    // les autres éléments sont identiques
    expect(empty.filter((e) => e.type !== 'text').length).toBe(filled.length - 5);
  });

  it('murs extérieurs de 30 cm et cloisons de 10 cm, raccordés aux angles', () => {
    const thick = rec.walls.map((w) => Math.round((w.thickness / UPM) * 100));
    expect(thick).toContain(30);
    expect(thick).toContain(10);
    // la cloison en simple trait prolonge une cloison double : elles ne forment plus qu'un mur de 10 cm (9,10 m → 19 m)
    expect(thick).not.toContain(7);
    expect(rec.walls.some((w) => Math.round((w.thickness / UPM) * 100) === 10 && Math.abs(w.points[0][1] - w.points[1][1]) < 1
      && Math.abs(w.points[1][0] - w.points[0][0]) / UPM > 9.5)).toBe(true);
    // le mur du bas (axe à y = 14 - 0,15 m) va d'un angle à l'autre : 23,70 m entre axes
    const bottom = rec.walls.find((w) => Math.abs(w.points[0][1] - (14 - 0.15) * UPM) < 1 && Math.abs(w.points[1][1] - w.points[0][1]) < 1);
    expect(bottom).toBeTruthy();
    expect(Math.abs(bottom!.points[1][0] - bottom!.points[0][0]) / UPM).toBeCloseTo(23.7, 2);
  });

  it('5 portes dont une double, largeurs réelles', () => {
    expect(rec.doors).toHaveLength(5);
    const dbl = rec.doors.filter((d) => d.doorType === 'double');
    expect(dbl).toHaveLength(1);
    expect(dbl[0].width / UPM).toBeCloseTo(1.8, 2);
    expect(rec.doors.filter((d) => d.doorType === 'single').every((d) => Math.abs(d.width / UPM - 0.9) < 0.01)).toBe(true);
  });

  it('4 fenêtres de 1,50 m recalées dans le mur', () => {
    expect(rec.windows).toHaveLength(4);
    for (const w of rec.windows) {
      expect(w.width / UPM).toBeCloseTo(1.5, 2);
      expect(w.depth / UPM).toBeCloseTo(0.3, 2);
      expect(w.y / UPM).toBeCloseTo(14 - 0.15, 2);
    }
  });

  it('un escalier de 10 marches dessinées', () => {
    expect(rec.stairs).toHaveLength(1);
    expect(rec.stairs[0].steps).toBe(11);
    expect(rec.stairs[0].w / UPM).toBeCloseTo(2.7, 2);
  });
});
