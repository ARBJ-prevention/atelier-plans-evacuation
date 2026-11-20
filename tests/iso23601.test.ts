import { describe, expect, it } from 'vitest';
import { sampleOffices } from '../src/app/sample';
import { makeElement, newFloor } from '../src/model/defaults';
import { computeRoomNumbers } from '../src/model/roomNumbers';
import { computeLayout, normalizePage } from '../src/render/layout';
import { isoRoomNumberOk, printIssues, renderPageSvg } from '../src/render/PrintPage';
import type { AreaElement } from '../src/model/types';

function offices() {
  const project = sampleOffices();
  const building = project.buildings[0];
  const floor = building.floors[0];
  return { project, building, floor, variantId: floor.variants[0].id };
}

describe('fiche pratique ISO 23601 appliquée automatiquement', () => {
  it('A3 minimum, A4 seulement pour une chambre individuelle', () => {
    const { floor } = offices();
    const page = { ...floor.page, paper: 'A4' as const, scaleMode: 'fixed' as const, scale: 100 };
    expect(normalizePage(floor, page).paper).toBe('A3');
    expect(normalizePage(floor, { ...page, smallRoom: true }).paper).toBe('A4');
    expect(normalizePage(floor, { ...page, norm: false }).paper).toBe('A4');
  });

  it('choisit 1:100 ou 1:250 et le format où le plan tient en entier', () => {
    const { floor, variantId, building } = offices();
    const p = normalizePage(floor, floor.page, building, variantId);
    expect(p.scaleMode).toBe('fixed');
    expect([100, 250]).toContain(p.scale);
    expect(printIssues(floor, variantId, floor.page, building)).not.toContain('plan-clipped');
    expect(printIssues(floor, variantId, floor.page, building)).not.toContain('iso-scale');
  });

  it('même échelle et même format pour tous les étages du bâtiment', () => {
    const { project, building, floor } = offices();
    const big = newFloor('Niveau 1', 1, project.country);
    big.unitsPerMeter = floor.unitsPerMeter;
    big.elements.push(makeElement('wall', { points: [[0, 0], [floor.unitsPerMeter * 60, 0], [floor.unitsPerMeter * 60, floor.unitsPerMeter * 30]] }));
    building.floors.push(big);
    const a = normalizePage(floor, floor.page, building);
    const b = normalizePage(big, big.page, building);
    expect([a.paper, a.scale]).toEqual([b.paper, b.scale]);
  });

  it('titre « Plan d’évacuation » à la hauteur de lettre minimale du format', () => {
    const { floor, variantId } = offices();
    for (const [paper, min] of [['A3', 13], ['A2', 18], ['A1', 26], ['A0', 36]] as const) {
      const L = computeLayout(floor, variantId, { ...floor.page, paper, scaleMode: 'fixed', scale: 250 });
      expect(11 * L.hs * L.s * 0.7).toBeGreaterThanOrEqual(min - 1e-6);
    }
  });

  it('murs noirs et épaissis au minimum, numéro du plan en bas', () => {
    const { project, building, floor, variantId } = offices();
    floor.titleBlock.planNumber = 'EV-0-01';
    const svg = renderPageSvg({ building, floor, variantId, customSymbols: project.customSymbols });
    expect(svg).toContain('EV-0-01');
    expect(svg).toContain('stroke="#000000"');
  });

  it('numérote les locaux depuis la rue principale, de gauche à droite', () => {
    const f = newFloor('Niveau 1', 1, 'BE');
    const room = (x: number, y: number) => makeElement('area', { kind: 'room', points: [[x, y], [x + 100, y], [x + 100, y + 100], [x, y + 100]] }) as AreaElement;
    const [a, b, c, d] = [room(0, 100), room(100, 100), room(0, 0), room(100, 0)];
    f.elements.push(c, d, a, b);
    const nums = Object.fromEntries(computeRoomNumbers(f, 'bottom').map((n) => [n.id, n.number]));
    expect([nums[a.id], nums[b.id], nums[c.id], nums[d.id]]).toEqual(['101', '102', '103', '104']);
    const top = Object.fromEntries(computeRoomNumbers(f, 'top').map((n) => [n.id, n.number]));
    expect(top[d.id]).toBe('101');
    expect(isoRoomNumberOk('012', 0)).toBe(true);
    expect(isoRoomNumberOk('12', 1)).toBe(false);
    expect(isoRoomNumberOk('-103', -1)).toBe(true);
  });
});

describe('fiche pratique : orientation, voies, obstacles, vue d’ensemble', () => {
  it('tourne le plan pour mettre le mur le plus proche du repère en haut', async () => {
    const { autoRotation, orientFloor } = await import('../src/render/orient');
    const f = newFloor('Niveau 0', 0, 'BE');
    f.elements.push(makeElement('wall', { points: [[100, 0], [100, 200]] }));   // mur à droite du repère
    f.elements.push(makeElement('symbol', { symbolId: 'you-are-here', x: 90, y: 100 }));
    expect(autoRotation(f, f.variants[0].id)).toBe(270);
    const o = orientFloor(f, f.variants[0].id, f.page);
    const wall = o.elements[0] as { points: [number, number][] };
    const here = o.elements[1] as { x: number; y: number };
    expect(wall.points[0][1]).toBeCloseTo(wall.points[1][1]);
    expect(wall.points[0][1]).toBeLessThan(here.y);   // le mur est au-dessus du repère
    expect(orientFloor(f, f.variants[0].id, { ...f.page, norm: false }).orient).toBeUndefined();
  });

  it('voies en zone verte, bâtiment coloré sur la vue d’ensemble', () => {
    const { project, building, floor, variantId } = offices();
    const svg = renderPageSvg({ building, floor, variantId, customSymbols: project.customSymbols });
    expect(svg).toContain('stroke="#2fae66"');
    expect(svg).toContain('#2f6fd6');
  });
});

describe('harmonisation des pictogrammes', () => {
  it('même taille pour tous, entre 7 et 12 mm imprimés ; repère et obstacles à part', async () => {
    const { harmonizedSymbolSize } = await import('../src/render/ElementView');
    const f = newFloor('RDC', 0);
    const v = f.variants[0].id;
    const sym = (symbolId: string, size: number) => makeElement('symbol', { x: 100, y: 100, symbolId, size });
    const mmPerUnit = 0.1; // 10 unités plan = 1 mm
    f.elements.push(sym('iso-E002', 60), sym('iso-F001', 90), sym('iso-E001', 400), sym('you-are-here', 300));
    // médiane 90 → 9 mm
    expect(harmonizedSymbolSize(f, v, mmPerUnit) * mmPerUnit).toBeCloseTo(9);
    // tous minuscules → 7 mm
    f.elements = [sym('iso-E002', 10), sym('iso-F001', 20)];
    expect(harmonizedSymbolSize(f, v, mmPerUnit) * mmPerUnit).toBeCloseTo(7);
    // tous énormes → 12 mm
    f.elements = [sym('iso-E002', 500), sym('iso-F001', 800)];
    expect(harmonizedSymbolSize(f, v, mmPerUnit) * mmPerUnit).toBeCloseTo(12);
  });
});
