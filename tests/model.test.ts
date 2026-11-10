import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/app/sample';
import { makeElement, newProject } from '../src/model/defaults';
import {
  constrain45, elementBounds, floorContentBounds, rotateElementAround, translateElement, usedSymbolIds,
} from '../src/model/geometry';
import { canonicalJson, cloneFloorWithNewIds, cloneProjectWithNewIds, parseProject, ProjectFormatError, serializeProject } from '../src/model/serialize';
import { computeLayout, niceScaleBarMeters, wrapText } from '../src/render/layout';
import { FORMAT_VERSION } from '../src/model/types';

describe('format de fichier .planevac', () => {
  it('aller-retour sans perte (enregistrer → rouvrir)', () => {
    const p = buildSampleProject();
    const text = serializeProject(p);
    const back = parseProject(text);
    expect(canonicalJson(back)).toBe(canonicalJson(p));
    expect(canonicalJson(parseProject(serializeProject(back)))).toBe(canonicalJson(back));
    expect(back.buildings[0].floors[0].elements.length).toBe(p.buildings[0].floors[0].elements.length);
  });

  it('refuse un fichier étranger ou corrompu avec un message clair', () => {
    expect(() => parseProject('pas du json')).toThrow(ProjectFormatError);
    expect(() => parseProject('{"format":"x"}')).toThrow(/n’est pas un projet/);
    expect(() => parseProject(JSON.stringify({ format: 'atelier-evac', formatVersion: FORMAT_VERSION + 1, buildings: [] }))).toThrow(/plus récente/);
  });

  it('complète les champs manquants (compatibilité)', () => {
    const minimal = { format: 'atelier-evac', formatVersion: 1, buildings: [{ name: 'B', floors: [{ name: 'RDC', elements: [] }] }] };
    const p = parseProject(JSON.stringify(minimal));
    const f = p.buildings[0].floors[0];
    expect(f.layers).toHaveLength(5);
    expect(f.variants).toHaveLength(1);
    expect(f.titleBlock.status).toBe('draft');
    expect(f.page.paper).toBe('A4');
  });

  it('duplication de projet et d’étage : nouveaux identifiants, versions remappées', () => {
    const p = buildSampleProject();
    const c = cloneProjectWithNewIds(p, 'Copie');
    expect(c.id).not.toBe(p.id);
    expect(c.name).toBe('Copie');
    const f = p.buildings[0].floors[0];
    f.titleBlock.status = 'validated';
    const fc = cloneFloorWithNewIds(f, 'RDC bis');
    expect(fc.id).not.toBe(f.id);
    expect(fc.titleBlock.status).toBe('draft');
    const vIds = new Set(fc.variants.map((v) => v.id));
    expect(fc.elements.filter((e) => e.variantId).every((e) => vIds.has(e.variantId!))).toBe(true);
    expect(fc.elements.every((e) => !f.elements.some((o) => o.id === e.id))).toBe(true);
  });
});

describe('géométrie', () => {
  it('emprise d’un mur inclut son épaisseur', () => {
    const w = makeElement('wall', { points: [[0, 0], [100, 0]], thickness: 10 });
    expect(elementBounds(w)).toEqual({ x: -5, y: -5, w: 110, h: 10 });
  });
  it('déplacement et rotation d’éléments', () => {
    const s = makeElement('symbol', { x: 10, y: 0 });
    expect(translateElement(s, 5, 5)).toMatchObject({ x: 15, y: 5 });
    const r = rotateElementAround(s, [0, 0], 90) as any;
    expect(r.x).toBeCloseTo(0); expect(r.y).toBeCloseTo(10); expect(r.rotation).toBe(90);
  });
  it('contrainte à 45°', () => {
    const p = constrain45([0, 0], [100, 8]);
    expect(p[1]).toBeCloseTo(0);
  });
  it('« Vous êtes ici » propre à une version', () => {
    const p = buildSampleProject();
    const f = p.buildings[0].floors[0];
    const [v1, v2] = f.variants;
    const yah = (vid: string) => f.elements.filter((e) => e.type === 'symbol' && e.symbolId === 'you-are-here' && (!e.variantId || e.variantId === vid));
    expect(yah(v1.id)).toHaveLength(1);
    expect(yah(v2.id)).toHaveLength(1);
    expect(yah(v1.id)[0].id).not.toBe(yah(v2.id)[0].id);
    expect(usedSymbolIds(f, v1.id)).toContain('you-are-here');
  });
});

describe('mise en page d’impression', () => {
  it('ajuste le plan à la zone de dessin', () => {
    const p = buildSampleProject();
    const f = p.buildings[0].floors[0];
    const L = computeLayout(f, f.variants[0].id);
    expect(L.w).toBe(297); expect(L.h).toBe(210);
    const wb = floorContentBounds(f, f.variants[0].id);
    expect(wb.w * L.k).toBeLessThanOrEqual(L.drawing.w + 1e-6);
    expect(wb.h * L.k).toBeLessThanOrEqual(L.drawing.h + 1e-6);
  });
  it('échelle fixe 1:100 : 1 m = 10 mm', () => {
    const p = newProject();
    const f = p.buildings[0].floors[0];
    f.unitsPerMeter = 50;
    f.page.scaleMode = 'fixed'; f.page.scale = 100;
    const L = computeLayout(f, f.variants[0].id);
    expect(L.k * f.unitsPerMeter).toBeCloseTo(10);
    expect(L.scaleDenominator).toBe(100);
  });
  it('A3 portrait', () => {
    const f = newProject().buildings[0].floors[0];
    f.page.paper = 'A3'; f.page.orientation = 'portrait';
    const L = computeLayout(f, f.variants[0].id);
    expect([L.w, L.h]).toEqual([297, 420]);
    expect(L.side!.y).toBeGreaterThan(L.drawing.y + L.drawing.h);
  });
  it('barre d’échelle « ronde » et coupure du texte', () => {
    expect(niceScaleBarMeters(10)).toBe(2);
    expect(niceScaleBarMeters(1)).toBe(25);
    const lines = wrapText('un deux trois quatre cinq six sept huit neuf dix', 20, 3);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('un deux trois quatre cinq six sept huit neuf dix');
  });
});
