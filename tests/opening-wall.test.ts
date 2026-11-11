import { describe, expect, it } from 'vitest';
import { makeElement } from '../src/model/defaults';
import { openingWallFit, raiseOpeningAboveWalls } from '../src/model/geometry';
import { newProject } from '../src/model/defaults';
import type { Element } from '../src/model/types';

describe('porte posée sur un mur', () => {
  it('passe au-dessus des murs dessinés après elle', () => {
    const door = makeElement('door', { x: 100, y: 0, width: 90 });
    const w1 = makeElement('wall', { points: [[0, 0], [500, 0]], thickness: 14 });
    const w2 = makeElement('wall', { points: [[0, 0], [0, 300]], thickness: 14 });
    const sym = makeElement('symbol', { x: 0, y: 0 } as any);
    const els: Element[] = [door, w1, w2, sym];
    expect(raiseOpeningAboveWalls(els, door.id)).toBe(true);
    expect(els.map((e) => e.id)).toEqual([w1.id, w2.id, door.id, sym.id]);
    // déjà au-dessus : rien ne change
    expect(raiseOpeningAboveWalls(els, door.id)).toBe(false);
  });

  it('s’accroche à un mur importé épais à portée', () => {
    const floor = newProject().buildings[0].floors[0];
    floor.elements = [makeElement('wall', { points: [[0, 0], [1000, 0]], thickness: 20 })];
    const fit = openingWallFit(floor, floor.variants[0].id, { x: 400, y: 15, width: 180, rotation: 0 }, 10);
    expect(fit).toMatchObject({ x: 400, y: 0, rotation: 0, depth: 20 });
  });
});
