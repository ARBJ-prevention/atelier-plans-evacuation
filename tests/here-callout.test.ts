import { describe, expect, it } from 'vitest';
import { SAMPLES } from '../src/app/sample';
import { elementBounds, isVisibleInVariant, floorContentBounds } from '../src/model/geometry';
import { hereCallout, isHereMarker } from '../src/model/hereCallout';
import { makeElement } from '../src/model/defaults';
import { parseProject, serializeProject } from '../src/model/serialize';
import type { SymbolElement } from '../src/model/types';

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('« Vous êtes ici » : cartouche et flèche placés automatiquement', () => {
  for (const s of SAMPLES) {
    it(`${s.id} : le cartouche ne recouvre aucun pictogramme et la flèche vise le repère`, () => {
      const p = s.build();
      for (const f of p.buildings.flatMap((b) => b.floors)) {
        for (const v of f.variants) {
          const markers = f.elements.filter((e): e is SymbolElement => isHereMarker(e) && isVisibleInVariant(e, v.id));
          for (const m of markers) {
            expect(m.labelPosition).toBe('auto');
            const t0 = performance.now();
            const c = hereCallout(m, f, v.id)!;
            expect(performance.now() - t0).toBeLessThan(400);
            expect(c).toBeTruthy();
            const symbols = f.elements.filter((e) => e.type === 'symbol' && e.id !== m.id && isVisibleInVariant(e, v.id));
            for (const sym of symbols) expect(overlap(c, elementBounds(sym)), `${v.name} / ${(sym as SymbolElement).symbolId}`).toBe(false);
            // pointe près du repère, flèche bien visible
            expect(Math.hypot(c.to[0] - m.x, c.to[1] - m.y)).toBeLessThan(m.size);
            expect(Math.hypot(c.from[0] - c.to[0], c.from[1] - c.to[1])).toBeGreaterThan(c.fontSize * 2.5);
            // l'emprise imprimée englobe le cartouche
            const b = floorContentBounds(f, v.id);
            expect(b.x <= c.x && b.y <= c.y && b.x + b.w >= c.x + c.w && b.y + b.h >= c.y + c.h).toBe(true);
          }
        }
      }
    });
  }

  it('position manuelle : le cartouche reste du côté demandé', () => {
    const el = makeElement('symbol', { symbolId: 'you-are-here', x: 0, y: 0, size: 50, label: 'Vous êtes ici', labelPosition: 'left' }) as SymbolElement;
    const c = hereCallout(el)!;
    expect(c.x + c.w).toBeLessThan(-25);
  });

  it('nouveau repère en « auto » ; anciens fichiers (« Dessous ») passés en « auto »', () => {
    const el = makeElement('symbol', { symbolId: 'you-are-here', label: 'Vous êtes ici' }) as SymbolElement;
    expect(el.labelPosition).toBe('auto');
    const p = SAMPLES[0].build();
    const f = p.buildings[0].floors[0];
    const m = f.elements.find(isHereMarker)!;
    m.labelPosition = 'below';
    const back = parseProject(serializeProject(p));
    expect((back.buildings[0].floors[0].elements.find((e) => e.id === m.id) as SymbolElement).labelPosition).toBe('auto');
  });
});

describe('« Vous êtes ici » : position libre', () => {
  it('le cartouche suit le décalage choisi, même loin hors du dessin, et la flèche vise toujours le repère', () => {
    const p = SAMPLES[0].build();
    const f = p.buildings[0].floors[0];
    const m = f.elements.find(isHereMarker)!;
    m.hereOffset = [-900, 400];
    const c = hereCallout(m, f, f.variants[0].id)!;
    expect(c.x + c.w / 2).toBeCloseTo(m.x - 900);
    expect(c.y + c.h / 2).toBeCloseTo(m.y + 400);
    expect(Math.hypot(c.to[0] - m.x, c.to[1] - m.y)).toBeLessThan(m.size);
    const b = floorContentBounds(f, f.variants[0].id);
    expect(b.x).toBeLessThanOrEqual(c.x);
  });
});
