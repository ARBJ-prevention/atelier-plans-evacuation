import { describe, expect, it } from 'vitest';
import { makeElement, newProject } from '../src/model/defaults';
import { snapPointToWalls, wallJoints } from '../src/model/geometry';
import type { WallElement } from '../src/model/types';

function floorWithWalls() {
  const floor = newProject().buildings[0].floors[0];
  const facade = makeElement('wall', { points: [[0, 0], [500, 0]], thickness: 14 }) as WallElement;
  const side = makeElement('wall', { points: [[500, 0], [500, 300]], thickness: 14 }) as WallElement;
  const stem = makeElement('wall', { points: [[200, 0], [200, 150]], thickness: 7 }) as WallElement;
  floor.elements = [facade, side, stem];
  return { floor, variantId: floor.variants[0].id, facade, side, stem };
}

describe('aimantation des murs entre eux', () => {
  it('accroche un point à l’extrémité ou à l’angle le plus proche, en priorité sur l’axe', () => {
    const { floor, variantId } = floorWithWalls();
    expect(snapPointToWalls(floor, variantId, [494, 6], 10)).toMatchObject({ point: [500, 0], kind: 'end' });
  });

  it('accroche un point sur l’axe d’un mur (jonction en T)', () => {
    const { floor, variantId } = floorWithWalls();
    expect(snapPointToWalls(floor, variantId, [320, 7], 10)).toMatchObject({ point: [320, 0], kind: 'axis' });
  });

  it('n’accroche rien au-delà de la tolérance ni sur le mur exclu', () => {
    const { floor, variantId, facade } = floorWithWalls();
    expect(snapPointToWalls(floor, variantId, [320, 40], 10)).toBeNull();
    expect(snapPointToWalls(floor, variantId, [320, 7], 10, new Set([facade.id]))).toBeNull();
  });

  it('accroche deux murs épais dont les bords se touchent (axes éloignés de l’épaisseur)', () => {
    const { floor, variantId } = floorWithWalls();
    // extrémité d'un mur de 14 posée bord à bord contre l'angle (500, 0) : axes à 14 u l'un de l'autre
    const hit = snapPointToWalls(floor, variantId, [514, 3], 0.3, new Set(), 14);
    expect(hit).toMatchObject({ point: [500, 0], kind: 'end' });
    // repères : faces des deux segments de l'angle (y = ±7 pour la façade, x = 493 / 507 pour le côté)
    expect(hit!.faces).toHaveLength(4);
    expect(hit!.faces.some(([a, b]) => Math.abs(a[1] + 7) < 1e-6 && Math.abs(b[1] + 7) < 1e-6)).toBe(true);
    expect(snapPointToWalls(floor, variantId, [514, 3], 0.3)).toBeNull();
  });

  it('retrouve les murs raccordés : angle commun et jonction en T sur le mur déplacé', () => {
    const { floor, variantId, facade, side, stem } = floorWithWalls();
    // angle à l'extrémité (500, 0)
    expect(wallJoints(floor, variantId, facade.id, [500, 0])).toEqual([{ id: side.id, index: 0, orig: [500, 0] }]);
    // la cloison posée sur la façade suit la façade quand on la déplace
    const joints = wallJoints(floor, variantId, facade.id, [0, 0], [[0, 0], [500, 0]]);
    expect(joints).toEqual(expect.arrayContaining([
      { id: side.id, index: 0, orig: [500, 0] },
      { id: stem.id, index: 0, orig: [200, 0] },
    ]));
    expect(joints.some((j) => j.id === stem.id && j.index === 1)).toBe(false);
  });
});

describe('équerrage des murs à l’import', () => {
  it('redresse, aligne les morceaux et prolonge jusqu’au mur voisin', async () => {
    const { squareWalls } = await import('../src/services/recognize');
    const m = 50;
    const walls: { a: [number, number]; b: [number, number]; t: number }[] = [
      { a: [0, 0], b: [500, 2], t: 10 },          // façade légèrement en biais
      { a: [0, 100], b: [200, 101], t: 10 },      // deux morceaux d'un même mur, décalés de 2 cm
      { a: [200, 99], b: [500, 99.5], t: 10 },
      { a: [250, 105], b: [251, 300], t: 7 },     // cloison qui s'arrête 5 cm avant le mur
    ];
    squareWalls(walls, m);
    for (const w of walls) expect(Math.abs(w.a[0] - w.b[0]) < 1e-6 || Math.abs(w.a[1] - w.b[1]) < 1e-6).toBe(true);
    expect(walls[1].a[1]).toBeCloseTo(walls[2].a[1], 6);
    expect(Math.min(walls[3].a[1], walls[3].b[1])).toBeCloseTo(walls[1].a[1], 6);
  });
});
