import { describe, expect, it } from 'vitest';
import { fuseSidesLocal, symbolFuseSides } from '../src/model/geometry';
import { makeElement } from '../src/model/defaults';

describe('Fusion des panneaux tournés d’un quart de tour', () => {
  it('fusionne une flèche tournée vers le bas collée à droite d’une sortie de secours', () => {
    const a = makeElement('symbol', { symbolId: 'iso-E002', x: 0, y: 0, size: 60, layer: 'symbols' }) as any;
    const b = makeElement('symbol', { symbolId: 'iso-arrow', x: 60, y: 0, size: 60, rotation: 90, layer: 'symbols' }) as any;
    const floor: any = { elements: [a, b] };
    expect(symbolFuseSides(a, floor, 'v').r).toBe(true);
    const near = symbolFuseSides(b, floor, 'v');
    expect(near.l).toBe(true);
    // tournée de 90°, le côté gauche du plan correspond au bas du dessin de la flèche
    expect(fuseSidesLocal(near, 90)).toEqual({ l: false, r: false, t: false, b: true });
    expect(fuseSidesLocal({ l: true, r: false, t: false, b: false }, 0, true)).toEqual({ l: false, r: true, t: false, b: false });
  });
});
