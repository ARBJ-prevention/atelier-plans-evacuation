import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/app/sample';
import { makeElement, newProject } from '../src/model/defaults';
import { elementBounds, floorContentBounds } from '../src/model/geometry';
import { currentFloor, currentVariantId, useStore } from '../src/store/store';

const floorOf = () => currentFloor(useStore.getState())!;

describe('Limiter au bâtiment', () => {
  it('ne garde que l’intérieur des façades, en refermant une baie de 1 m', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    // carré 10 m × 10 m (100 u/m), mur bas interrompu par une baie de 1 m
    const t = 20;
    const walls = [
      makeElement('wall', { points: [[0, 0], [1000, 0], [1000, 1000], [550, 1000]], thickness: t }),
      makeElement('wall', { points: [[450, 1000], [0, 1000], [0, 0]], thickness: t }),
    ];
    const shape = makeElement('shape', { x: 500, y: 500, w: 3000, h: 3000, fill: '#123456' });
    useStore.getState().mutateFloor((f) => { f.unitsPerMeter = 100; f.elements = [...walls, shape] as any; });
    useStore.getState().select([shape.id]);
    useStore.getState().clipSelectionToBuilding();
    const el = floorOf().elements.find((e) => e.id === shape.id)!;
    expect(el.type).toBe('area');
    expect((el as any).fill).toBe('#123456');
    expect(el.layer).toBe('building');
    const b = elementBounds(el);
    expect(b.x).toBeGreaterThan(-30); expect(b.x).toBeLessThan(5);
    expect(b.y).toBeGreaterThan(-30); expect(b.y).toBeLessThan(5);
    expect(b.x + b.w).toBeGreaterThan(995); expect(b.x + b.w).toBeLessThan(1030);
    expect(b.y + b.h).toBeGreaterThan(995); expect(b.y + b.h).toBeLessThan(1030);
  });

  it('découpe aussi un rectangle qui ne couvre qu’une partie du bâtiment', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    const wall = makeElement('wall', { points: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], closed: true, thickness: 20 });
    const shape = makeElement('shape', { x: 0, y: 500, w: 600, h: 400 }); // de -300 à 300 en x
    useStore.getState().mutateFloor((f) => { f.unitsPerMeter = 100; f.elements = [wall, shape] as any; });
    useStore.getState().select([shape.id]);
    useStore.getState().clipSelectionToBuilding();
    const b = elementBounds(floorOf().elements.find((e) => e.id === shape.id)!);
    expect(b.x).toBeGreaterThan(-30);
    expect(b.x + b.w).toBeGreaterThan(290); expect(b.x + b.w).toBeLessThan(310);
    expect(b.h).toBeGreaterThan(390); expect(b.h).toBeLessThan(410);
  });

  it('suit l’emprise du plan d’exemple', () => {
    useStore.getState().loadProject(buildSampleProject(), null);
    const f = floorOf();
    const content = floorContentBounds(f as any, currentVariantId(useStore.getState()))!;
    const big = makeElement('shape', { x: content.x + content.w / 2, y: content.y + content.h / 2, w: content.w * 2, h: content.h * 2 });
    useStore.getState().mutateFloor((fd) => { fd.elements.push(big as any); });
    useStore.getState().select([big.id]);
    useStore.getState().clipSelectionToBuilding();
    const el = floorOf().elements.find((e) => e.id === big.id)!;
    expect(el.type).toBe('area');
    const b = elementBounds(el);
    // façade du plan d'exemple : murs de 0 à 1500 × 0 à 900, 22 u d'épaisseur
    expect(b.x).toBeGreaterThan(-15); expect(b.y).toBeGreaterThan(-15);
    expect(b.x + b.w).toBeLessThan(1515); expect(b.y + b.h).toBeLessThan(915);
    expect(b.w).toBeGreaterThan(1490); expect(b.h).toBeGreaterThan(890);
  });
});
