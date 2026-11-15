import { beforeEach, describe, expect, it } from 'vitest';
import { scopeLabel, scopeOf, selectionScope, setScopeAction } from '../src/app/scope';
import { buildSampleProject } from '../src/app/sample';
import { makeElement, newProject, newVariant } from '../src/model/defaults';
import { roundDoorWidth } from '../src/model/geometry';
import { parseProject, serializeProject } from '../src/model/serialize';
import { printIssues } from '../src/render/PrintPage';
import { currentFloor, useStore } from '../src/store/store';

const S = () => useStore.getState();

/** Étage à deux affiches, chargé dans l'éditeur. */
function twoPosters() {
  const project = newProject('Site', 'BE');
  const floor = project.buildings[0].floors[0];
  floor.variants[0].name = 'Accueil';
  floor.variants.push(newVariant('Couloir est'));
  S().loadProject(project, null);
  S().setNewScope('all');
  const [a, b] = currentFloor(S())!.variants;
  return { a, b };
}

describe('vocabulaire « affiche »', () => {
  it('nomme « Affiche 1 » l’affiche d’un nouvel étage', () => {
    expect(newProject('Site', 'BE').buildings[0].floors[0].variants[0].name).toBe('Affiche 1');
  });

  it('ouvre toujours un ancien fichier dont l’affiche s’appelle « Version 1 »', () => {
    const project = newProject('Site', 'BE');
    project.buildings[0].floors[0].variants[0].name = 'Version 1';
    const reopened = parseProject(serializeProject(project));
    expect(reopened.buildings[0].floors[0].variants[0].name).toBe('Version 1');
  });
});

describe('portée des éléments entre affiches', () => {
  beforeEach(() => { S().closeProject(); });

  it('ajoute un nouvel élément à toutes les affiches par défaut', () => {
    const { a, b } = twoPosters();
    const el = makeElement('symbol', { x: 10, y: 10 });
    S().addElements([el]);
    const floor = currentFloor(S())!;
    const placed = floor.elements.find((e) => e.id === el.id)!;
    expect(scopeOf(placed, floor)).toMatchObject({ kind: 'all' });
    expect(scopeOf(placed, floor).on.map((v) => v.id)).toEqual([a.id, b.id]);
    expect(scopeLabel(scopeOf(placed, floor), floor)).toBe('Commun aux 2 affiches de cet étage');
  });

  it('« Nouveaux éléments : cette affiche » rend l’élément propre à l’affiche active', () => {
    const { b } = twoPosters();
    S().setVariant(b.id);
    S().setNewScope('variant');
    const el = makeElement('symbol', { x: 10, y: 10 });
    S().addElements([el]);
    const floor = currentFloor(S())!;
    const placed = floor.elements.find((e) => e.id === el.id)!;
    expect(placed.variantId).toBe(b.id);
    expect(scopeLabel(scopeOf(placed, floor), floor)).toBe('Uniquement sur « Couloir est »');
  });

  it('ne touche pas la portée quand l’étage n’a qu’une affiche', () => {
    S().loadProject(newProject('Site', 'BE'), null);
    S().setNewScope('variant');
    const el = makeElement('symbol', { x: 10, y: 10 });
    S().addElements([el]);
    expect(currentFloor(S())!.elements.find((e) => e.id === el.id)!.variantId).toBeUndefined();
    S().setNewScope('all');
  });

  it('remet un élément propre sur toutes les affiches et efface les exceptions', async () => {
    const { a, b } = twoPosters();
    const own = makeElement('text', { x: 0, y: 0, text: 'propre', variantId: a.id });
    const partial = makeElement('route', { points: [[0, 0], [10, 0]], excludedVariantIds: [b.id] });
    S().addElements([own, partial]);
    expect(selectionScope(currentFloor(S())!.elements, currentFloor(S())!)).toBe('mixed');
    expect(await setScopeAction([own.id, partial.id], 'all')).toBe(true);
    const floor = currentFloor(S())!;
    for (const id of [own.id, partial.id]) {
      const el = floor.elements.find((e) => e.id === id)!;
      expect(el.variantId).toBeUndefined();
      expect(el.excludedVariantIds).toBeUndefined();
    }
  });
});

describe('poignées des portes', () => {
  it('arrondit la largeur au centimètre en gardant le montant opposé fixe', () => {
    // 50 unités par mètre : 147,52 cm = 73,76 u ; montant gauche en x = 100 - 73,76 / 2
    const door = { x: 100, y: 0, width: 73.76, rotation: 0 };
    const left = door.x - door.width / 2;
    const r = roundDoorWidth(door, 1, 50, 1);
    expect(r.width).toBeCloseTo(74, 6);
    expect(r.x - r.width / 2).toBeCloseTo(left, 6);
    const r5 = roundDoorWidth(door, 1, 50, 5);
    expect(r5.width).toBeCloseTo(75, 6); // 150 cm
    expect(r5.x - r5.width / 2).toBeCloseTo(left, 6);
  });

  it('garde le bon montant fixe pour une porte tournée tirée par la gauche', () => {
    const door = { x: 0, y: 0, width: 44.6, rotation: 90 };
    const fixedY = door.y - door.width / 2 * -1; // montant du côté +1 (bas, axe y)
    const r = roundDoorWidth(door, -1, 100, 5);
    expect(r.width).toBeCloseTo(45, 6);
    expect(r.y + r.width / 2).toBeCloseTo(fixedY, 6);
  });
});

describe('vérification avant export étendue', () => {
  it('signale un étage vide : itinéraire, sortie, statut', () => {
    const floor = newProject('Site', 'BE').buildings[0].floors[0];
    const issues = printIssues(floor, floor.variants[0].id);
    expect(issues).toContain('route-missing');
    expect(issues).toContain('exit-missing');
    expect(issues).toContain('not-validated');
  });

  it('ne signale ni itinéraire ni sortie sur un plan d’exemple complet', () => {
    const floor = buildSampleProject().buildings[0].floors[0];
    for (const v of floor.variants) {
      const issues = printIssues(floor, v.id);
      expect(issues).not.toContain('route-missing');
      expect(issues).not.toContain('exit-missing');
    }
  });

  it('compte une porte « issue de secours » comme sortie signalée et repère des numéros vides', () => {
    const floor = newProject('Site', 'BE').buildings[0].floors[0];
    floor.elements.push(makeElement('door', { x: 0, y: 0, emergency: true }));
    floor.page.showEmergencyNumbers = true;
    floor.titleBlock.emergencyNumbers = '  ';
    const issues = printIssues(floor, floor.variants[0].id);
    expect(issues).not.toContain('exit-missing');
    expect(issues).toContain('numbers-missing');
  });
});

describe('circulations probables (aide à la vérification)', () => {
  it('relie chaque repère « Vous êtes ici » des plans d’exemple à une sortie', async () => {
    const { SAMPLES } = await import('../src/app/sample');
    const { computeCirculation } = await import('../src/services/circulation');
    for (const sample of SAMPLES) {
      for (const floor of sample.build().buildings[0].floors) {
        for (const v of floor.variants) {
          const c = computeCirculation(floor, v.id)!;
          expect(c.closedOutline).toBe(true);
          expect(c.exits).toBeGreaterThan(0);
          expect(c.stranded).toEqual([]);
          expect(c.paths.length).toBeGreaterThan(0);
          expect(c.paths[0].meters!).toBeGreaterThan(0.5);
        }
      }
    }
  });

  it('signale une pièce fermée sans porte et un repère qui y est enfermé', async () => {
    const { computeCirculation } = await import('../src/services/circulation');
    const floor = newProject('Site', 'BE').buildings[0].floors[0];
    floor.unitsPerMeter = 50;
    // bâtiment 20 m × 10 m avec une issue de secours, et une pièce close de 4 m × 4 m sans porte
    floor.elements.push(makeElement('wall', { points: [[0, 0], [1000, 0], [1000, 500], [0, 500]], closed: true, thickness: 20 }));
    floor.elements.push(makeElement('wall', { points: [[600, 0], [600, 200], [800, 200], [800, 0]], thickness: 10 }));
    floor.elements.push(makeElement('door', { x: 0, y: 250, width: 90, rotation: 90, emergency: true }));
    floor.elements.push(makeElement('symbol', { symbolId: 'you-are-here', x: 700, y: 100, variantId: floor.variants[0].id }));
    const c = computeCirculation(floor, floor.variants[0].id)!;
    expect(c.exits).toBe(1);
    expect(c.stranded).toHaveLength(1);
    expect(c.unreachable).not.toBe('');
    expect(c.unreachableShare).toBeGreaterThan(0.05);
    // une porte dans la pièce : le repère retrouve un chemin
    floor.elements.push(makeElement('door', { x: 700, y: 200, width: 90 }));
    const c2 = computeCirculation(floor, floor.variants[0].id)!;
    expect(c2.stranded).toHaveLength(0);
    expect(c2.paths[0].meters!).toBeGreaterThan(10);
  });
});

describe('export PDF : images lourdes transmises une seule fois', () => {
  it('remplace chaque grande image intégrée par une référence partagée', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('electron/main.cjs', 'utf8');
    const code = src.match(/function splitInlineImages[\s\S]*?\n}\n/)![0];
    const split = new Function(`${code}return splitInlineImages;`)() as (h: string) => { html: string; images: string[] };
    const big = `data:image/png;base64,${'A'.repeat(5000)}`;
    const small = 'data:image/png;base64,AA';
    const r = split(`<svg><image href="${big}"/><image xlink:href="${big}"/><image href="${small}"/></svg>`);
    expect(r.images).toEqual([big]);
    expect(r.html).toBe(`<svg><image data-evac-src="0"/><image data-evac-src="0"/><image href="${small}"/></svg>`);
  });
});
