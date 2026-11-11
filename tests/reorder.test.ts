import { describe, expect, it } from 'vitest';
import { makeElement, newProject } from '../src/model/defaults';
import { currentFloor, useStore } from '../src/store/store';

function setup() {
  const p = newProject();
  useStore.getState().loadProject(p, null);
  const wallA = makeElement('wall', { points: [[0, 50], [200, 50]] } as any);
  const wallB = makeElement('wall', { points: [[0, 80], [200, 80]] } as any);
  const far = makeElement('wall', { points: [[5000, 0], [5100, 0]] } as any);
  const sym = makeElement('symbol', { x: 100, y: 60 } as any);
  const shape = makeElement('shape', { x: 100, y: 50, w: 200, h: 100 } as any);
  useStore.getState().mutateFloor((f) => { f.elements = [wallA, wallB, far, sym, shape] as any; });
  useStore.getState().select([shape.id]);
  return { wallA, wallB, sym, shape };
}

const order = () => {
  const f = currentFloor(useStore.getState())!;
  const rank = ['background', 'building', 'routes', 'symbols', 'annotations'];
  return f.elements.map((e, i) => ({ e, i })).sort((a, b) => rank.indexOf(a.e.layer) - rank.indexOf(b.e.layer) || a.i - b.i).map((x) => x.e.id);
};

describe('Avancer / Reculer d’un cran', () => {
  it('fait passer une forme progressivement sous les éléments qui la chevauchent, calque par calque', () => {
    const { wallA, wallB, sym, shape } = setup();
    const s = useStore.getState();
    s.reorderSelection('backward');
    expect(order().slice(-2)).toEqual([shape.id, sym.id]);
    s.reorderSelection('backward');
    let ids = order();
    expect(ids.indexOf(shape.id)).toBe(ids.indexOf(wallB.id) - 1);
    expect(currentFloor(useStore.getState())!.elements.find((e) => e.id === shape.id)!.layer).toBe('building');
    s.reorderSelection('backward');
    ids = order();
    expect(ids.indexOf(shape.id)).toBe(ids.indexOf(wallA.id) - 1);
    s.reorderSelection('forward');
    ids = order();
    expect(ids.indexOf(shape.id)).toBe(ids.indexOf(wallA.id) + 1);
  });
});
