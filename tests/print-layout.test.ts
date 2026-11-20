import { describe, expect, it } from 'vitest';
import { sampleOffices } from '../src/app/sample';
import { parseProject, serializeProject } from '../src/model/serialize';
import type { PageTheme, PrintBlockPositions } from '../src/model/types';
import { computeLayout, themePatch } from '../src/render/layout';
import { printIssues, renderPageSvg } from '../src/render/PrintPage';

function offices() {
  const project = sampleOffices();
  const building = project.buildings[0];
  const floor = building.floors[0];
  return { project, building, floor, variantId: floor.variants[0].id };
}

describe('placement des blocs imprimés', () => {
  it.each([['indigo', 'right'], ['sienne', 'bottom'], ['petrole', 'left']] as const)(
    '%s applique sa disposition et affiche les consignes et les numéros en entier',
    (theme, edge) => {
      const { project, building, floor, variantId } = offices();
      const page = { ...floor.page, ...themePatch(theme), paper: 'A3' as const, orientation: 'landscape' as const, fillSpace: false, norm: false, showSketch: false };
      const { drawing, blocks } = computeLayout(floor, variantId, page);
      const legend = blocks!.legend!;
      if (edge === 'right') expect(legend.x).toBeGreaterThan(drawing.x + drawing.w);
      if (edge === 'left') expect(legend.x + legend.w).toBeLessThan(drawing.x);
      if (edge === 'bottom') expect(legend.y).toBeGreaterThan(drawing.y + drawing.h);
      expect(printIssues(floor, variantId, page)).not.toContain('instructions-clipped');
      const svg = renderPageSvg({ building, floor, variantId, page, customSymbols: project.customSymbols });
      for (const text of ['112', '101', '070 245 245', 'sans autorisation.']) expect(svg).toContain(text);
    },
  );

  it.each(['moderne', 'petrole'] as const)(
    '%s respecte des positions indépendantes même en portrait',
    (theme) => {
      const { floor, variantId } = offices();
      const page = {
        ...floor.page, theme, orientation: 'portrait' as const, showAerial: true, showSketch: true, fillSpace: false, norm: false,
        blockPositions: { [theme]: { legend: 'left', instructions: 'bottom', aerial: 'top', sketch: 'right', numbers: 'right' } satisfies PrintBlockPositions },
      };
      const { drawing, blocks, numbersInHeader } = computeLayout(floor, variantId, page);
      expect(numbersInHeader).toBe(false);
      expect(blocks!.legend!.x + blocks!.legend!.w).toBeLessThan(drawing.x);
      expect(blocks!.aerial!.y + blocks!.aerial!.h).toBeLessThan(drawing.y);
      expect(blocks!.instructions!.y).toBeGreaterThan(drawing.y + drawing.h);
      expect(blocks!.sketch!.x).toBeGreaterThan(drawing.x + drawing.w);
      expect(blocks!.numbers!.y).toBeGreaterThan(blocks!.sketch!.y + blocks!.sketch!.h);
      expect(printIssues(floor, variantId, page)).not.toContain('instructions-clipped');
    },
  );

  it('conserve les dispositions par thème dans un projet existant', () => {
    const { project, floor, variantId } = offices();
    expect(computeLayout(floor, variantId).blocks).toBeUndefined();
    const theme: PageTheme = 'indigo';
    floor.page = { ...floor.page, ...themePatch(theme), fillSpace: false, blockPositions: {
      indigo: { legend: 'top' }, sienne: { legend: 'right' },
    } };
    const restored = parseProject(serializeProject(project)).buildings[0].floors[0];
    expect(restored.page.blockPositions).toEqual(floor.page.blockPositions);
    const indigo = computeLayout(restored, variantId);
    expect(indigo.blocks!.legend!.y).toBeLessThan(indigo.drawing.y);
    const sienne = computeLayout(restored, variantId, { ...restored.page, ...themePatch('sienne') });
    expect(sienne.blocks!.legend!.x).toBeGreaterThan(sienne.drawing.x + sienne.drawing.w);
  });

  it.each([
    ['sienne', 'landscape'], ['indigo', 'portrait'], ['petrole', 'portrait'], ['moderne', 'landscape'],
  ] as const)('%s en %s : des blocs passent dans l’espace libre pour agrandir le plan', (theme, orientation) => {
    const { building, project, floor, variantId } = offices();
    // « moderne » : légende, consignes et croquis placés à la main en bas, comme sur l'aperçu signalé.
    const blockPositions = theme === 'moderne' ? { moderne: { legend: 'bottom', instructions: 'bottom', sketch: 'bottom' } as const } : undefined;
    const page = { ...floor.page, ...themePatch(theme), orientation, showSketch: true, norm: false, ...(blockPositions && { blockPositions }) };
    const strict = computeLayout(floor, variantId, { ...page, fillSpace: false });
    const filled = computeLayout(floor, variantId, page);
    expect(filled.k).toBeGreaterThan(strict.k * 1.1);
    expect(filled.relocated?.length).toBeGreaterThan(0);
    // Les blocs ne chevauchent ni le plan ni les autres blocs, et restent sur la page.
    const rects = Object.values(filled.blocks!);
    const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      a.x < b.x + b.w - 0.1 && b.x < a.x + a.w - 0.1 && a.y < b.y + b.h - 0.1 && b.y < a.y + a.h - 0.1;
    for (const [i, r] of rects.entries()) {
      expect(overlap(r, filled.drawing)).toBe(false);
      for (const other of rects.slice(i + 1)) expect(overlap(r, other)).toBe(false);
      expect(r.x + r.w).toBeLessThanOrEqual(filled.w);
      expect(r.y + r.h).toBeLessThanOrEqual(filled.h);
    }
    expect(printIssues(floor, variantId, page)).not.toContain('instructions-clipped');
    const svg = renderPageSvg({ building, floor, variantId, page, customSymbols: project.customSymbols });
    expect(svg).toContain('sans autorisation.');
  });
});
