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
    expect(snapPointToWalls(floor, variantId, [494, 6], 10)).toEqual({ point: [500, 0], kind: 'end' });
  });

  it('accroche un point sur l’axe d’un mur (jonction en T)', () => {
    const { floor, variantId } = floorWithWalls();
    expect(snapPointToWalls(floor, variantId, [320, 7], 10)).toEqual({ point: [320, 0], kind: 'axis' });
  });

  it('n’accroche rien au-delà de la tolérance ni sur le mur exclu', () => {
    const { floor, variantId, facade } = floorWithWalls();
    expect(snapPointToWalls(floor, variantId, [320, 40], 10)).toBeNull();
    expect(snapPointToWalls(floor, variantId, [320, 7], 10, new Set([facade.id]))).toBeNull();
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
