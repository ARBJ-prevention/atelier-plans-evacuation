import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleOffices } from '../src/app/sample';
import type { PageTheme } from '../src/model/types';
import { headerColorValue, headerColors, THEMES, themePatch } from '../src/render/layout';
import { renderPageSvg } from '../src/render/PrintPage';

function offices() {
  const project = sampleOffices();
  const building = project.buildings[0];
  const floor = building.floors[0];
  return { project, building, floor, variantId: floor.variants[0].id };
}

describe('couleur de l’en-tête', () => {
  it('sans choix, l’en-tête garde la couleur du thème', () => {
    const { floor } = offices();
    const page = { ...floor.page, ...themePatch('moderne') };
    expect(headerColors(THEMES.moderne, page, page.accentColor)).toMatchObject({ custom: false, bg: '#0f1b2a' });
    expect(headerColorValue(page)).toBe('#0f1b2a');
  });

  it('une couleur claire donne un titre foncé, une couleur sombre un titre blanc', () => {
    const { floor } = offices();
    expect(headerColors(THEMES.moderne, { ...floor.page, headerColor: '#ffe14d' }, '#00843d').fg).toBe('#111a24');
    expect(headerColors(THEMES.moderne, { ...floor.page, headerColor: '#7a1020' }, '#00843d').fg).toBe('#ffffff');
  });

  it.each(Object.keys(THEMES) as PageTheme[])('%s : la couleur choisie apparaît dans l’en-tête, et disparaît une fois remise par défaut', (theme) => {
    const { project, building, floor, variantId } = offices();
    const base = { ...floor.page, ...themePatch(theme) };
    const custom = renderPageSvg({ building, floor, variantId, page: { ...base, headerColor: '#7a1020' }, customSymbols: project.customSymbols });
    expect(custom).toContain('#7a1020');
    const reset = renderPageSvg({ building, floor, variantId, page: { ...base, headerColor: undefined }, customSymbols: project.customSymbols });
    expect(reset).not.toContain('#7a1020');
  });

  // Planche de contrôle visuel : GALLERY=<fichier.html> npx vitest run tests/header-color.test.ts
  it.skipIf(!process.env.GALLERY)('planche de contrôle', () => {
    const { project, building, floor, variantId } = offices();
    const cells: string[] = [];
    for (const theme of Object.keys(THEMES) as PageTheme[]) {
      for (const headerColor of [undefined, '#7a1020', '#ffe14d']) {
        const page = { ...floor.page, ...themePatch(theme), headerColor };
        const svg = renderPageSvg({ building, floor, variantId, page, customSymbols: project.customSymbols, uniqueKey: `${theme}-${cells.length}` });
        cells.push(`<figure><figcaption>${theme} · ${headerColor ?? 'défaut'}</figcaption>${svg}</figure>`);
      }
    }
    writeFileSync(process.env.GALLERY!, `<!doctype html><meta charset="utf-8"><style>body{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font:12px sans-serif}figure{margin:0}svg{width:100%;height:auto;border:1px solid #ccc}</style>${cells.join('')}`);
  });
});
