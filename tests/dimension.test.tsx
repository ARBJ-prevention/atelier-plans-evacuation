import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ElementView } from '../src/render/ElementView';
import { makeElement, newFloor } from '../src/model/defaults';
import { dimensionOffsetAt, elementBounds, formatLength } from '../src/model/geometry';

describe('cotes', () => {
  it('formate en mètres une fois étalonné', () => {
    expect(formatLength(425, 100)).toBe('4,25 m');
    expect(formatLength(1234, 100)).toBe('12,3 m');
    expect(formatLength(42.4, 0)).toBe('42 u');
  });
  it('rend la mesure et suit le décalage', () => {
    const floor = { ...newFloor('N0', 0, 'BE'), unitsPerMeter: 100 };
    const el = makeElement('dimension', { points: [[0, 0], [350, 0]], offset: dimensionOffsetAt([0, 0], [350, 0], [100, 40]) });
    expect((el as any).offset).toBeCloseTo(40);
    const svg = renderToStaticMarkup(<ElementView el={el} ctx={{ floor, variantId: floor.variants[0].id, customSymbols: [] }} />);
    expect(svg).toContain('3,50 m');
    expect(elementBounds(el).h).toBeGreaterThan(40);
  });
});
