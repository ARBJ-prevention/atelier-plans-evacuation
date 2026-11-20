import { describe, expect, it } from 'vitest';
import { detectStraightenAngle, rotateFlat, type FlatDxf, type Vec } from '../src/services/dxf';

/** Bâtiment rectangulaire 30 × 12 avec une cloison, tourné de `deg` degrés. */
function building(deg: number): FlatDxf {
  const r = (deg * Math.PI) / 180;
  const R = ([x, y]: Vec): Vec => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
  const base = { layer: 'MURS', chain: ['MURS'], color: '#000', lw: 0 };
  return {
    insUnits: 6, skipped: {},
    layers: [{ name: 'MURS', count: 2, color: '#000', defaultVisible: true }],
    prims: [
      { ...base, kind: 'line', closed: true, pts: ([[0, 0], [30, 0], [30, 12], [0, 12]] as Vec[]).map(R) },
      { ...base, kind: 'line', closed: false, pts: ([[10, 0], [10, 12]] as Vec[]).map(R) },
    ],
  };
}

describe('redresser un plan dessiné de travers', () => {
  it('détecte l’angle et le corrige', () => {
    for (const deg of [-27.3, -12, 8.5, 33, 61]) {
      const flat = building(deg);
      const rot = detectStraightenAngle(flat, new Set(['MURS']));
      const straight = rotateFlat(flat, rot);
      expect(detectStraightenAngle(straight, new Set(['MURS']))).toBe(0);
      expect(Math.abs(rot)).toBeLessThanOrEqual(45);
    }
  });
  it('ne touche pas un plan droit', () => {
    const flat = building(0);
    expect(detectStraightenAngle(flat, new Set(['MURS']))).toBe(0);
    expect(rotateFlat(flat, 0)).toBe(flat);
  });
});
