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
