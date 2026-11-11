import { describe, expect, it } from 'vitest';
import { buildReviewDemo, buildSampleProject } from '../src/app/sample';
import { makeElement, newFloor, newProject, newVariant } from '../src/model/defaults';
import {
  boxOf, constrain45, elementBounds, floorContentBounds, isVisibleInVariant, openingWallFit, resizeBoxElement, rotateElementAround, rotatePoint, snapSymbolToWalls, translateElement, usedSymbolIds, windowFrameWidth, windowGlassWallFit, windowResizeWallFit,
} from '../src/model/geometry';
import { canonicalJson, cloneFloorWithNewIds, cloneProjectWithNewIds, parseProject, ProjectFormatError, serializeProject } from '../src/model/serialize';
import { computeLayout, niceScaleBarMeters, wrapText } from '../src/render/layout';
import { FORMAT_VERSION } from '../src/model/types';
import { PRINT_ISSUE_LABEL, printIssues, renderPageSvg } from '../src/render/PrintPage';
import { buildBatchPrintHtml } from '../src/services/exporter';
import { applyOrganizationTemplate, templateFromFloor } from '../src/app/organizationTemplates';
import { currentFloor, useStore } from '../src/store/store';

describe('redimensionnement des objets', () => {
  it('étire un pictogramme tourné dans un seul axe en conservant son côté opposé', () => {
    const symbol = makeElement('symbol', { x: 100, y: 100, size: 40, rotation: 90 });
    const resized = resizeBoxElement(symbol, [1, 0], [0, -10], false);
    expect(boxOf(resized)).toMatchObject({ w: 30, h: 40 });
    expect(elementBounds(resized)).toEqual({ x: 80, y: 80, w: 40, h: 30 });
  });

  it('redimensionne le pictogramme entier par un coin en conservant ses proportions', () => {
    const symbol = makeElement('symbol', { x: 100, y: 100, size: 40, stretchX: 1.5 });
    const resized = resizeBoxElement(symbol, [1, 1], [-15, -10], false);
    expect(elementBounds(resized)).toEqual({ x: 70, y: 80, w: 45, h: 30 });
  });

  it('réduit une porte verticale sans déplacer le jambage opposé', () => {
    const door = makeElement('door', { x: 100, y: 100, width: 90, rotation: 90 });
    const resized = resizeBoxElement(door, [1, 0], [0, -20], false, 6, 22);
    expect(resized).toMatchObject({ x: 100, y: 90, width: 70, rotation: 90 });
  });

  it('redimensionne le texte depuis un coin en conservant le point opposé', () => {
    const text = makeElement('text', { x: 100, y: 100, align: 'end', letterSpacing: 2 });
    const original = elementBounds(text);
    const resized = resizeBoxElement(text, [-1, 1], [-original.w / 2, original.h / 2], false);
    const bounds = elementBounds(resized);
    expect(bounds.x + bounds.w).toBeCloseTo(original.x + original.w);
    expect(bounds.y).toBeCloseTo(original.y);
    expect(bounds.w).toBeCloseTo(original.w * 1.5);
  });
});

it('centre et oriente une porte sur le mur sans dépasser son extrémité', () => {
  const floor = newProject('Site', 'BE').buildings[0].floors[0];
  const variantId = floor.variants[0].id;
  floor.elements.push(makeElement('wall', { points: [[100, 200], [100, 0]], thickness: 22 }));
  const door = { x: 112, y: 15, width: 90, rotation: 90 };
  const fit = openingWallFit(floor, variantId, door, 5);
  expect(fit).toEqual({ x: 100, y: 45, rotation: 90, depth: 22 });
  expect(openingWallFit(floor, variantId, { ...door, ...fit })).toEqual(fit);
  expect(openingWallFit(floor, variantId, { ...door, x: 120 }, 5)).toBeUndefined();
  floor.layers.find((layer) => layer.id === floor.elements[0].layer)!.visible = false;
  expect(openingWallFit(floor, variantId, door, 5)).toBeUndefined();
});

it('aligne une fenêtre horizontale sur une cloison oblique de la version active', () => {
  const floor = newFloor('Étage', 0, 'BE');
  const variantId = floor.variants[0].id;
  floor.elements.push(
    makeElement('wall', { points: [[0, 0], [200, 200]], thickness: 10 }),
    makeElement('wall', { points: [[0, 10], [200, 210]], thickness: 22, variantId: 'autre-version' }),
  );
  const window = makeElement('window', { x: 95, y: 105 });
  if (window.type !== 'window') throw new Error('Fenêtre attendue');
  const fit = openingWallFit(floor, variantId, window, 10)!;
  expect(fit.x).toBeCloseTo(100);
  expect(fit.y).toBeCloseTo(100);
  expect(fit.rotation).toBeCloseTo(45);
  expect(fit.depth).toBe(10);
  expect(openingWallFit(floor, variantId, { ...window, width: 300 }, 10)).toBeUndefined();
});

describe('accrochage des fenêtres pendant le redimensionnement', () => {
  it('aligne le vitrage sur la limite visible du couloir en conservant le jambage opposé', () => {
    const floor = newFloor('Étage', 0, 'BE');
    const variantId = floor.variants[0].id;
    floor.elements.push(makeElement('wall', { points: [[0, 400], [1500, 400]], thickness: 12 }));
    const window = makeElement('window', { x: 0, y: 450, width: 93.23, depth: 22, rotation: 90 });
    if (window.type !== 'window') throw new Error('Fenêtre attendue');
    const fit = windowGlassWallFit(floor, variantId, window, -1, 8 / 40)!;
    const { y, width, depth } = fit.window;
    expect(y - width / 2 + windowFrameWidth(width, depth)).toBeCloseTo(406, 10);
    expect(y + width / 2).toBeCloseTo(window.y + window.width / 2, 10);
    expect(fit.guide[0][0]).toBeCloseTo(-11, 10);
    expect(fit.guide.map((point) => point[1])).toEqual([406, 406]);
    expect(windowGlassWallFit(floor, variantId, { ...window, y: 451 }, -1, 8 / 40)).toBeUndefined();
    expect(windowGlassWallFit(floor, variantId, { ...window, x: -50 }, -1, 8 / 40)).toBeUndefined();
  });

  it('aligne les deux faces sur un mur oblique sans modifier la largeur glissée', () => {
    const floor = newFloor('Étage', 0, 'BE');
    const variantId = floor.variants[0].id;
    floor.elements.push(makeElement('wall', { points: [[200, 200], [0, 0]], thickness: 20 }));
    const window = makeElement('window', { x: 100, y: 100, width: 60, depth: 16, rotation: 45 });
    const resized = resizeBoxElement(window, [1, 1], rotatePoint([10, 1.9], [0, 0], 45), false);
    if (resized.type !== 'window') throw new Error('Fenêtre attendue');

    const fit = windowResizeWallFit(floor, variantId, resized, 1, 0.2);
    expect(fit?.window).toMatchObject({ depth: 20, width: 70, rotation: 45 });
    expect(fit?.window.x).toBeCloseTo(100 + 5 / Math.SQRT2);
    expect(fit?.window.y).toBeCloseTo(100 + 5 / Math.SQRT2);
    expect(fit?.guides.map(([[x, y]]) => (y - x) / Math.SQRT2)).toEqual([10, -10]);

    expect(windowResizeWallFit(floor, variantId, resized, -1, 0.2)).toBeUndefined();
    expect(windowResizeWallFit(floor, variantId, { ...resized, width: 300 }, 1, 0.2)).toBeUndefined();
    expect(windowResizeWallFit(floor, variantId, { ...resized, rotation: 135 }, 1, 8)).toBeUndefined();
    floor.elements[0].variantId = 'autre-version';
    expect(windowResizeWallFit(floor, variantId, resized, 1, 0.2)).toBeUndefined();
  });

  it('garde le trait du cadre dans les limites de la fenêtre imprimée', () => {
    const project = newProject('Site', 'BE');
    const building = project.buildings[0], floor = building.floors[0];
    floor.elements.push(makeElement('window', { x: 100, y: 100, width: 60, depth: 20 }));
    const svg = renderPageSvg({ building, floor, variantId: floor.variants[0].id, customSymbols: [] });
    expect(svg).toMatch(/<rect x="-28\.8" y="-8\.8" width="57\.6" height="17\.6"[^>]*stroke-width="2\.4"/);
  });
});

describe('retrait des pictogrammes près des murs', () => {
  it('garde un espace visible des deux côtés d’un coin dans le dessin imprimé', () => {
    const project = newProject('Site', 'BE');
    const building = project.buildings[0];
    const floor = building.floors[0];
    const variantId = floor.variants[0].id;
    floor.elements.push(
      makeElement('wall', { points: [[0, 0], [0, 200]], thickness: 12 }),
      makeElement('wall', { points: [[0, 0], [200, 0]], thickness: 20 }),
      makeElement('wall', { points: [[25, 0], [25, 200]], thickness: 12, variantId: 'autre-version' }),
    );
    const symbol = makeElement('symbol', { x: 0, y: 0, size: 44 });
    if (symbol.type !== 'symbol') throw new Error('Pictogramme attendu');
    const placed = snapSymbolToWalls(floor, variantId, symbol, { at: [1, 1], gap: 6 });
    expect(elementBounds(placed)).toEqual({ x: 12, y: 16, w: 44, h: 44 });
    expect(snapSymbolToWalls(floor, variantId, { ...symbol, x: 100, y: 100 }, { gap: 50 })).toMatchObject({ x: 100, y: 100 });
    floor.elements.push(placed);
    const svg = renderPageSvg({ building, floor, variantId, customSymbols: [] });
    expect(svg).toContain('transform="translate(34 38)"');
  });

  it('augmente le retrait sur les deux murs d’un coin pour un même point de pose', () => {
    const floor = newFloor('Étage', 0, 'BE');
    const variantId = floor.variants[0].id;
    floor.elements.push(
      makeElement('wall', { points: [[0, 200], [0, 0], [200, 0]], thickness: 12 }),
    );
    const symbol = makeElement('symbol', { x: 50, y: 50, size: 44 });
    if (symbol.type !== 'symbol') throw new Error('Pictogramme attendu');
    for (const gap of [1, 6, 24, 50]) {
      const placed = snapSymbolToWalls(floor, variantId, symbol, { gap });
      expect(elementBounds(placed)).toEqual({ x: 6 + gap, y: 6 + gap, w: 44, h: 44 });
    }
  });

  it('tient compte de la rotation, de l’étirement et de la pastille blanche', () => {
    const floor = newFloor('Étage', 0, 'BE');
    const variantId = floor.variants[0].id;
    floor.elements.push(makeElement('wall', { points: [[0, 0], [200, 0]], thickness: 12 }));
    const symbol = makeElement('symbol', { x: 100, y: 25, size: 40, rotation: 90, stretchX: 1.5, halo: true });
    if (symbol.type !== 'symbol') throw new Error('Pictogramme attendu');
    const placed = snapSymbolToWalls(floor, variantId, symbol, { gap: 10 });
    expect(placed.x).toBeCloseTo(100);
    expect(placed.y).toBeCloseTo(53.8);
  });

  it('applique le retrait au collage et conserve le décalage des collages successifs', () => {
    const savedState = useStore.getState();
    try {
      const project = newProject('Site', 'BE');
      const floor = project.buildings[0].floors[0];
      const symbol = makeElement('symbol', { x: 111, y: 111, size: 44 });
      floor.elements.push(
        makeElement('wall', { points: [[150, 0], [150, 250]], thickness: 20 }),
        makeElement('wall', { points: [[0, 150], [250, 150]], thickness: 20 }),
        symbol,
      );
      savedState.loadProject(project, null);
      useStore.setState({ selection: [symbol.id], grid: { ...savedState.grid, snap: true, symbolSnapEnabled: true, symbolWallGap: 6 } });
      useStore.getState().copySelection();
      useStore.getState().paste();
      expect(currentFloor(useStore.getState())?.elements.at(-1)).toMatchObject({ x: 112, y: 112 });
      useStore.getState().paste();
      expect(currentFloor(useStore.getState())?.elements.at(-1)).toMatchObject({ x: 188, y: 188 });
    } finally {
      useStore.setState(savedState);
    }
  });

  it('respecte l’interrupteur et le retrait au coin de la cafétéria du Quartz, avec la grille libre', () => {
    const savedState = useStore.getState();
    try {
      const project = buildSampleProject();
      const floor = project.buildings[0].floors[0];
      const symbol = makeElement('symbol', { symbolId: 'iso-F001', x: 710, y: 500, size: 40 });
      floor.elements.push(symbol);
      savedState.loadProject(project, null);
      const paste = (symbolSnapEnabled: boolean, symbolWallGap: number) => {
        useStore.setState({ selection: [symbol.id], grid: { ...savedState.grid, snap: false, symbolSnapEnabled, symbolWallGap } });
        useStore.getState().copySelection();
        useStore.getState().paste();
        return currentFloor(useStore.getState())!.elements.at(-1)!;
      };
      expect(paste(false, 50)).toMatchObject({ x: 730, y: 520 });
      expect(elementBounds(paste(true, 6))).toEqual({ x: 698, y: 512, w: 40, h: 40 });
      expect(elementBounds(paste(true, 50))).toEqual({ x: 654, y: 556, w: 40, h: 40 });
    } finally {
      useStore.setState(savedState);
    }
  });
});

it('affiche les deux rubriques colorées dans le plan Le Quartz en Horizon A4 paysage', () => {
  const project = buildSampleProject();
  const building = project.buildings[0];
  const floor = building.floors[0];
  const page = { ...floor.page, theme: 'horizon', paper: 'A4', orientation: 'landscape', sidePosition: 'right', showAerial: true, showSketch: true } as const;
  for (const { id: variantId } of floor.variants) {
    expect(printIssues(floor, variantId, page)).not.toContain('instructions-clipped');
    const svg = renderPageSvg({ building, floor, variantId, customSymbols: project.customSymbols, page });
    expect(svg.includes('fill="#a1261e"') && svg.includes('fill="#00663a"')).toBe(true);
    expect(svg).toContain('ÉVACUATION</text>');
  }
});

describe('parcours de création et d’export des affiches', () => {
  it('conserve les positions originales des repères dans la démonstration à deux étages', () => {
    const building = buildReviewDemo().buildings[0];
    expect(building.floors).toHaveLength(2);
    const [ground, upstairs] = building.floors;
    expect(printIssues(ground, ground.variants[0].id)).not.toContain('marker-missing');
    expect(printIssues(ground, ground.variants[1].id)).not.toContain('marker-missing');
    const markers = (floor: typeof ground) => floor.elements.flatMap((e) =>
      e.type === 'symbol' && e.symbolId === 'you-are-here' ? [[e.x, e.y]] : []);
    expect(markers(ground)).toEqual(markers(buildSampleProject().buildings[0].floors[0]));
    expect(upstairs.page).toMatchObject({ paper: 'A3', orientation: 'portrait' });
  });

  it('conserve les exceptions d’un itinéraire commun à la réouverture et à la duplication', () => {
    const project = newProject('Site', 'BE');
    const floor = project.buildings[0].floors[0];
    const hall = floor.variants[0];
    const corridor = newVariant('Couloir');
    floor.variants.push(corridor);
    floor.elements.push(makeElement('route', { excludedVariantIds: [corridor.id] }));
    const reopenedProject = parseProject(serializeProject(project));
    expect(reopenedProject.formatVersion).toBe(3);
    const reopened = reopenedProject.buildings[0].floors[0];
    expect(isVisibleInVariant(reopened.elements[0], hall.id)).toBe(true);
    expect(isVisibleInVariant(reopened.elements[0], corridor.id)).toBe(false);
    const copy = cloneFloorWithNewIds(reopened, 'Étage copié');
    expect(copy.elements[0].excludedVariantIds).toEqual([copy.variants[1].id]);
    expect(isVisibleInVariant(copy.elements[0], copy.variants[1].id)).toBe(false);
  });

  it('signale par affiche les repères, le rognage et le texte qui dépasse dans le rendu', () => {
    const project = newProject('Site', 'BE');
    const building = project.buildings[0], floor = building.floors[0];
    const hall = floor.variants[0], corridor = newVariant('Couloir');
    floor.variants.push(corridor);
    floor.elements.push(makeElement('wall', { points: [[0, 0], [1000, 400]] }));
    floor.elements.push(makeElement('symbol', { symbolId: 'you-are-here', x: 150, y: 90, variantId: hall.id }));
    floor.elements.push(makeElement('symbol', { symbolId: 'you-are-here', x: 200, y: 90, variantId: hall.id }));
    expect(printIssues(floor, hall.id)).toContain('marker-multiple');
    expect(printIssues(floor, corridor.id)).toContain('marker-missing');
    floor.unitsPerMeter = 50;
    floor.page.scaleMode = 'fixed';
    floor.page.scale = 20;
    floor.titleBlock.instructions = Array.from({ length: 45 }, (_, i) => `${i + 1}. Texte de vérification de l’aperçu.`).join('\n');
    const issues = printIssues(floor, hall.id);
    expect(issues).toContain('plan-clipped');
    expect(issues).toContain('instructions-clipped');
    expect(PRINT_ISSUE_LABEL['instructions-clipped']).toBe('Consignes tronquées');
    expect(renderPageSvg({ building, floor, variantId: hall.id, customSymbols: [] })).toContain('(texte tronqué)');
  });

  it('assemble les pages choisies avec leurs propres formats et sans collisions d’identifiants SVG', () => {
    const project = newProject('Site', 'BE');
    const building = project.buildings[0], floor = building.floors[0];
    const next = newFloor('Étage 1', 1, 'BE');
    floor.variants.push(newVariant('Autre emplacement'));
    floor.titleBlock.title = 'Hall principal';
    next.titleBlock.title = 'Étage supérieur';
    Object.assign(next.page, { paper: 'A3', orientation: 'portrait' });
    const html = buildBatchPrintHtml([floor, next].map((f) => ({
      building, floor: f, variantIds: [f.variants[0].id], customSymbols: [], page: f.page,
    })), 'Bâtiment');
    expect(html).toContain('@page sheet-A4-landscape { size: 297mm 210mm');
    expect(html).toContain('@page sheet-A3-portrait { size: 297mm 420mm');
    expect(html.match(/<div class="page /g)).toHaveLength(2);
    expect(html).toContain('id="clip-p0"');
    expect(html).toContain('id="clip-p1"');
    expect(html.indexOf('Hall principal')).toBeLessThan(html.indexOf('Étage supérieur'));
  });

  it('applique un modèle sans modifier le cadrage ni l’échelle et invalide les consignes remplacées', () => {
    const source = newFloor('Source', 0, 'BE'), target = newFloor('Cible', 1, 'BE');
    source.page.theme = 'horizon';
    source.titleBlock.instructions = 'Consignes de l’organisation';
    Object.assign(target.page, { area: 'custom', scaleMode: 'fixed', scale: 75 });
    Object.assign(target.titleBlock, { status: 'validated', validatedBy: 'Vérificateur' });
    expect(applyOrganizationTemplate(target, templateFromFloor('Organisation', source))).toBe(true);
    expect(target.page).toMatchObject({ theme: 'horizon', area: 'custom', scaleMode: 'fixed', scale: 75 });
    expect(target.titleBlock).toMatchObject({ status: 'to_validate', validatedBy: '', instructions: 'Consignes de l’organisation' });
  });
});

describe('format de fichier .planevac', () => {
  it('aller-retour sans perte (enregistrer → rouvrir)', () => {
    const p = buildSampleProject();
    const text = serializeProject(p);
    const back = parseProject(text);
    expect(canonicalJson(back)).toBe(canonicalJson(p));
    expect(canonicalJson(parseProject(serializeProject(back)))).toBe(canonicalJson(back));
    expect(back.buildings[0].floors[0].elements.length).toBe(p.buildings[0].floors[0].elements.length);
  });

  it('refuse un fichier étranger ou corrompu avec un message clair', () => {
    expect(() => parseProject('pas du json')).toThrow(ProjectFormatError);
    expect(() => parseProject('{"format":"x"}')).toThrow(/n’est pas un projet/);
    expect(() => parseProject(JSON.stringify({ format: 'atelier-evac', formatVersion: FORMAT_VERSION + 1, buildings: [] }))).toThrow(/plus récente/);
  });

  it('complète les champs manquants (compatibilité)', () => {
    const minimal = { format: 'atelier-evac', formatVersion: 1, buildings: [{ name: 'B', floors: [{ name: 'RDC', elements: [] }] }] };
    const p = parseProject(JSON.stringify(minimal));
    const f = p.buildings[0].floors[0];
    expect(f.layers).toHaveLength(5);
    expect(f.variants).toHaveLength(1);
    expect(f.titleBlock.status).toBe('draft');
    expect(f.page.paper).toBe('A4');
  });

  it('duplication de projet et d’étage : nouveaux identifiants, versions remappées', () => {
    const p = buildSampleProject();
    const c = cloneProjectWithNewIds(p, 'Copie');
    expect(c.id).not.toBe(p.id);
    expect(c.name).toBe('Copie');
    const f = p.buildings[0].floors[0];
    f.titleBlock.status = 'validated';
    const fc = cloneFloorWithNewIds(f, 'RDC bis');
    expect(fc.id).not.toBe(f.id);
    expect(fc.titleBlock.status).toBe('draft');
    const vIds = new Set(fc.variants.map((v) => v.id));
    expect(fc.elements.filter((e) => e.variantId).every((e) => vIds.has(e.variantId!))).toBe(true);
    expect(fc.elements.every((e) => !f.elements.some((o) => o.id === e.id))).toBe(true);
  });
});

describe('géométrie', () => {
  it('emprise d’un mur inclut son épaisseur', () => {
    const w = makeElement('wall', { points: [[0, 0], [100, 0]], thickness: 10 });
    expect(elementBounds(w)).toEqual({ x: -5, y: -5, w: 110, h: 10 });
  });
  it('déplacement et rotation d’éléments', () => {
    const s = makeElement('symbol', { x: 10, y: 0 });
    expect(translateElement(s, 5, 5)).toMatchObject({ x: 15, y: 5 });
    const r = rotateElementAround(s, [0, 0], 90) as any;
    expect(r.x).toBeCloseTo(0); expect(r.y).toBeCloseTo(10); expect(r.rotation).toBe(90);
  });
  it('contrainte à 45°', () => {
    const p = constrain45([0, 0], [100, 8]);
    expect(p[1]).toBeCloseTo(0);
  });
  it('« Vous êtes ici » propre à une version', () => {
    const p = buildSampleProject();
    const f = p.buildings[0].floors[0];
    const [v1, v2] = f.variants;
    const yah = (vid: string) => f.elements.filter((e) => e.type === 'symbol' && e.symbolId === 'you-are-here' && (!e.variantId || e.variantId === vid));
    expect(yah(v1.id)).toHaveLength(1);
    expect(yah(v2.id)).toHaveLength(1);
    expect(yah(v1.id)[0].id).not.toBe(yah(v2.id)[0].id);
    expect(usedSymbolIds(f, v1.id)).toContain('you-are-here');
  });
});

describe('mise en page d’impression', () => {
  it('ajuste le plan à la zone de dessin', () => {
    const p = buildSampleProject();
    const f = p.buildings[0].floors[0];
    const L = computeLayout(f, f.variants[0].id);
    expect(L.w).toBe(297); expect(L.h).toBe(210);
    const wb = floorContentBounds(f, f.variants[0].id);
    expect(wb.w * L.k).toBeLessThanOrEqual(L.drawing.w + 1e-6);
    expect(wb.h * L.k).toBeLessThanOrEqual(L.drawing.h + 1e-6);
  });
  it('échelle fixe 1:100 : 1 m = 10 mm', () => {
    const p = newProject();
    const f = p.buildings[0].floors[0];
    f.unitsPerMeter = 50;
    f.page.scaleMode = 'fixed'; f.page.scale = 100;
    const L = computeLayout(f, f.variants[0].id);
    expect(L.k * f.unitsPerMeter).toBeCloseTo(10);
    expect(L.scaleDenominator).toBe(100);
  });
  it('A3 portrait', () => {
    const f = newProject().buildings[0].floors[0];
    f.page.paper = 'A3'; f.page.orientation = 'portrait';
    const L = computeLayout(f, f.variants[0].id);
    expect([L.paperW, L.paperH]).toEqual([297, 420]);
    expect(L.w * L.s).toBeCloseTo(297); expect(L.h * L.s).toBeCloseTo(420);
    expect(L.side!.y).toBeGreaterThan(L.drawing.y + L.drawing.h);
  });
  it('A3 : mise en page agrandie, échelle réelle conservée', () => {
    const f = newProject().buildings[0].floors[0];
    f.unitsPerMeter = 50;
    f.page.paper = 'A3'; f.page.scaleMode = 'fixed'; f.page.scale = 100;
    const L = computeLayout(f, f.variants[0].id);
    expect(L.s).toBeGreaterThan(1);
    expect(L.k * L.s * f.unitsPerMeter).toBeCloseTo(10);   // 1 m = 10 mm sur le papier
    expect(L.scaleDenominator).toBe(100);
  });
  it('barre d’échelle « ronde » et coupure du texte', () => {
    expect(niceScaleBarMeters(10)).toBe(2);
    expect(niceScaleBarMeters(1)).toBe(25);
    const lines = wrapText('un deux trois quatre cinq six sept huit neuf dix', 20, 3);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('un deux trois quatre cinq six sept huit neuf dix');
  });
});

describe('fusion des panneaux collés', () => {
  it('détecte les côtés collés et ignore les panneaux éloignés ou tournés', async () => {
    const { symbolFuseSides } = await import('../src/model/geometry');
    const p = newProject('Test');
    const f = p.buildings[0].floors[0];
    const v = f.variants[0].id;
    const a = makeElement('symbol', { x: 0, y: 0, size: 40, symbolId: 'iso-E001' }) as any;
    const b = makeElement('symbol', { x: 41, y: 2, size: 40, symbolId: 'iso-E002' }) as any;
    const c = makeElement('symbol', { x: 0, y: 120, size: 40, symbolId: 'iso-E002' }) as any;
    f.elements.push(a, b, c);
    expect(symbolFuseSides(a, f, v)).toEqual({ l: false, r: true, t: false, b: false });
    expect(symbolFuseSides(b, f, v)).toEqual({ l: true, r: false, t: false, b: false });
    expect(symbolFuseSides(c, f, v)).toEqual({ l: false, r: false, t: false, b: false });
    b.rotation = 45;
    expect(symbolFuseSides(a, f, v).r).toBe(false);
    b.rotation = 0; a.fuse = false;
    expect(symbolFuseSides(b, f, v).l).toBe(false);
  });
});
