import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/app/sample';
import { makeElement, newProject } from '../src/model/defaults';
import { elementBounds, floorContentBounds, openingWallFit } from '../src/model/geometry';
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

  it('découpe en une zone par local, en couvrant toute la zone', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    // carré 10 m × 10 m, cloison verticale à x = 400 avec une porte, deux textes de nom
    const facade = makeElement('wall', { points: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], closed: true, thickness: 20 });
    const cloison = makeElement('wall', { points: [[400, 0], [400, 1000]], thickness: 10 });
    const door = makeElement('door', { x: 400, y: 500, width: 90, rotation: 90 });
    const t1 = makeElement('text', { x: 200, y: 300, text: 'Bureau' });
    const t2 = makeElement('text', { x: 700, y: 300, text: 'Atelier' });
    const shape = makeElement('shape', { x: 500, y: 500, w: 3000, h: 3000, fill: '#123456' });
    useStore.getState().mutateFloor((f) => { f.unitsPerMeter = 100; f.elements = [facade, cloison, door, t1, t2, shape] as any; });
    useStore.getState().select([shape.id]);
    // par défaut : zones sans nom, les textes restent des éléments indépendants
    useStore.getState().splitSelectionIntoRooms();
    const plain = floorOf().elements.filter((e) => e.type === 'area') as any[];
    expect(plain).toHaveLength(2);
    expect(plain.every((z) => z.label === '')).toBe(true);
    expect(floorOf().elements.filter((e) => e.type === 'text')).toHaveLength(2);
    useStore.getState().undo();
    useStore.getState().select([shape.id]);
    // « avec les noms » : chaque zone reprend le texte qu'elle contient
    useStore.getState().splitSelectionIntoRooms(true);
    const zones = floorOf().elements.filter((e) => e.type === 'area') as any[];
    expect(zones).toHaveLength(2);
    expect(zones.some((z) => z.id === shape.id)).toBe(true);
    expect(zones.every((z) => z.fill === '#123456' && z.layer === 'building')).toBe(true);
    expect(zones.map((z) => z.label).sort()).toEqual(['Atelier', 'Bureau']);
    const bureau = elementBounds(zones.find((z) => z.label === 'Bureau'));
    const atelier = elementBounds(zones.find((z) => z.label === 'Atelier'));
    // les deux locaux se rejoignent dans l'épaisseur de la cloison
    expect(Math.abs(bureau.x + bureau.w - atelier.x)).toBeLessThan(6);
    expect(bureau.x).toBeLessThan(5); expect(atelier.x + atelier.w).toBeGreaterThan(995);
    expect(useStore.getState().selection).toHaveLength(2);
  });

  it('sous des pièces qui ne touchent pas tout à fait les murs, les locaux ne dépassent pas en liseré', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    const facade = makeElement('wall', { points: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], closed: true, thickness: 20 });
    const cloison = makeElement('wall', { points: [[400, 0], [400, 1000]], thickness: 10 });
    // pièces redessinées à l'import : 4 cm de jour contre la façade du haut et la cloison
    const r1 = makeElement('area', { kind: 'room', points: [[10, 14], [391, 14], [391, 990], [10, 990]] });
    const r2 = makeElement('area', { kind: 'room', points: [[409, 14], [990, 14], [990, 990], [409, 990]] });
    const shape = makeElement('shape', { x: 500, y: 500, w: 3000, h: 3000, fill: '#3cb44b' });
    useStore.getState().mutateFloor((f) => { f.unitsPerMeter = 100; f.elements = [facade, cloison, r1, r2, shape] as any; });
    useStore.getState().select([shape.id]);
    useStore.getState().splitSelectionIntoRooms();
    const zones = floorOf().elements.filter((e) => e.type === 'area' && (e as any).kind === 'zone');
    expect(zones).toHaveLength(2);
    for (const z of zones) {
      const b = elementBounds(z);
      // chaque morceau reste sous le fond d'une pièce, en retrait : rien ne dépasse dans le jour
      const inR1 = b.x >= 10 && b.x + b.w <= 391, inR2 = b.x >= 409 && b.x + b.w <= 990;
      expect(inR1 || inR2).toBe(true);
      expect(b.y).toBeGreaterThanOrEqual(14);
      expect(b.y + b.h).toBeLessThanOrEqual(990);
      expect(b.w * b.h).toBeGreaterThan(0.9 * (inR1 ? 381 : 581) * 976);
    }
  });

  it('une bande étroite le long d’un mur reste au local de son côté du mur', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    const facade = makeElement('wall', { points: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], closed: true, thickness: 20 });
    // couloir en haut, grande salle en bas, séparés par un mur de 15 cm à y = 300
    const mur = makeElement('wall', { points: [[0, 300], [1000, 300]], thickness: 15 });
    const door = makeElement('door', { x: 150, y: 300, width: 90, rotation: 0 });
    // contour de pièce importé qui laisse une bande de 20 cm côté couloir, contre le mur
    const bande = makeElement('area', { kind: 'room', points: [[300, 272], [700, 272], [700, 292], [300, 292]], fill: 'none' });
    const t1 = makeElement('text', { x: 500, y: 150, text: 'Couloir' });
    const t2 = makeElement('text', { x: 500, y: 650, text: 'Salle' });
    const shape = makeElement('shape', { x: 500, y: 500, w: 3000, h: 3000, fill: '#e3f3ea' });
    useStore.getState().mutateFloor((f) => { f.unitsPerMeter = 100; f.elements = [facade, mur, door, bande, t1, t2, shape] as any; });
    useStore.getState().select([shape.id]);
    useStore.getState().splitSelectionIntoRooms(true);
    const zones = floorOf().elements.filter((e) => e.type === 'area' && (e as any).kind === 'zone') as any[];
    const salle = zones.find((z) => z.label === 'Salle');
    expect(salle).toBeTruthy();
    // la salle ne remonte pas dans le couloir : son bord haut reste dans l'épaisseur du mur (y 292,5 à 307,5)
    expect(elementBounds(salle).y).toBeGreaterThan(295);
    // et le couloir couvre la bande (aucun jour entre les morceaux)
    const couloir = zones.find((z) => z.label === 'Couloir');
    expect(elementBounds(couloir).y + elementBounds(couloir).h).toBeGreaterThan(292);
  });

  it('les contours des locaux voisins suivent la même frontière, même en biais', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    const facade = makeElement('wall', { points: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], closed: true, thickness: 20 });
    // contour de pièce en biais, sans mur dessous : la frontière des deux locaux reste visible
    const biais = makeElement('area', { kind: 'room', points: [[300, 0], [700, 1000], [1000, 1000], [1000, 0]], fill: 'none' });
    const shape = makeElement('shape', { x: 500, y: 500, w: 3000, h: 3000, fill: '#e3f3ea' });
    useStore.getState().mutateFloor((f) => { f.unitsPerMeter = 100; f.elements = [facade, biais, shape] as any; });
    useStore.getState().select([shape.id]);
    useStore.getState().splitSelectionIntoRooms();
    const zones = floorOf().elements.filter((e) => e.type === 'area' && (e as any).kind === 'zone') as any[];
    expect(zones).toHaveLength(2);
    const inside = (x: number, y: number, pts: number[][]) => {
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    // tout point à plus de 4 cm de la frontière est couvert par exactement un morceau
    let bad = 0;
    for (let y = 30; y < 970; y += 3) for (let x = 30; x < 970; x += 3) {
      const t = (y / 1000) * 400 + 300; // abscisse du contour en biais à cette hauteur
      if (Math.abs(x - t) * (1000 / Math.hypot(1000, 400)) < 4) continue;
      const n = zones.filter((z) => inside(x, y, z.points)).length;
      if (n !== 1) bad++;
    }
    expect(bad).toBe(0);
  });

  it('retourner une porte la garde dans son mur', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    // mur légèrement de travers (≈ -0,5°), comme sur un plan importé
    const wall = makeElement('wall', { points: [[0, 504.36], [1000, 495.64]], thickness: 15 });
    const fit0 = openingWallFit({ ...floorOf(), elements: [wall] } as any, currentVariantId(useStore.getState()), { x: 400, y: 500.87, width: 93, rotation: 0 }, 5)!;
    const door = makeElement('door', { x: fit0.x, y: fit0.y, width: 93, rotation: fit0.rotation, doorType: 'double', fireRated: true });
    useStore.getState().mutateFloor((f) => { f.unitsPerMeter = 50; f.elements = [wall, door] as any; });
    const onWall = (d: any) => openingWallFit(floorOf(), currentVariantId(useStore.getState()), d);
    expect(onWall(door)).toBeTruthy();
    useStore.getState().select([door.id]);
    useStore.getState().flipSelection('v');
    let d = floorOf().elements.find((e) => e.id === door.id) as any;
    expect(d.x).toBeCloseTo(fit0.x, 6); expect(d.y).toBeCloseTo(fit0.y, 6);
    expect(d.flipY).toBe(true);
    // toujours reconnue dans son mur (épaisseur et angle du mur), donc bien ajustée
    expect(onWall(d)?.depth).toBe(15);
    useStore.getState().flipSelection('h');
    d = floorOf().elements.find((e) => e.id === door.id) as any;
    expect(d.x).toBeCloseTo(fit0.x, 6); expect(d.y).toBeCloseTo(fit0.y, 6);
    expect(onWall(d)?.depth).toBe(15);
    // une porte déjà décrochée (angle inversé par l'ancienne version) est recalée en la retournant
    useStore.getState().mutateFloor((f) => { const x = f.elements.find((e) => e.id === door.id) as any; x.rotation = (360 - x.rotation) % 360; });
    expect(onWall(floorOf().elements.find((e) => e.id === door.id))).toBeFalsy();
    useStore.getState().flipSelection('v');
    expect(onWall(floorOf().elements.find((e) => e.id === door.id))?.depth).toBe(15);
    // avec le mur, l'ensemble est retourné autour de son centre : la porte suit son mur
    useStore.getState().select([door.id, wall.id]);
    useStore.getState().flipSelection('v');
    d = floorOf().elements.find((e) => e.id === door.id) as any;
    expect(onWall(d)?.depth).toBe(15);
  });

  it('sélectionne d’un coup les semblables, les zones, les textes ou les pictogrammes', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    const z1 = makeElement('area', { kind: 'zone', points: [[0, 0], [10, 0], [10, 10]] });
    const z2 = makeElement('area', { kind: 'zone', points: [[20, 0], [30, 0], [30, 10]] });
    const r1 = makeElement('area', { kind: 'room', points: [[40, 0], [50, 0], [50, 10]] });
    const t1 = makeElement('text', { x: 0, y: 0, text: '0.12' });
    const t2 = makeElement('text', { x: 5, y: 5, text: '0.13' });
    const s1 = makeElement('symbol', { symbolId: 'fire-extinguisher', x: 0, y: 0 });
    const locked = makeElement('text', { x: 9, y: 9, text: 'figé', locked: true });
    useStore.getState().mutateFloor((f) => { f.elements = [z1, z2, r1, t1, t2, s1, locked] as any; });
    const sel = () => [...useStore.getState().selection].sort();
    useStore.getState().select([z1.id]);
    useStore.getState().selectWhere('similar');
    expect(sel()).toEqual([z1.id, z2.id].sort()); // zones seulement, pas la pièce
    useStore.getState().selectWhere('areas');
    expect(sel()).toEqual([z1.id, z2.id, r1.id].sort());
    useStore.getState().selectWhere('texts');
    expect(sel()).toEqual([t1.id, t2.id].sort()); // le texte verrouillé n'est pas pris
    useStore.getState().selectWhere('symbols');
    expect(sel()).toEqual([s1.id]);
  });

  it('changer l’épaisseur d’un mur retravaille les murs raccordés et les fenêtres', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    // façade horizontale de 30 cm (15 u à 50 u/m), axe y = 0
    const facade = makeElement('wall', { points: [[0, 0], [1000, 0]], thickness: 15 });
    // cloison arrêtée contre la face intérieure (y = 7,5) ; cloison raccordée sur l'axe (y = 0)
    const auRas = makeElement('wall', { points: [[300, 300], [300, 7.5]], thickness: 5 });
    const axe = makeElement('wall', { points: [[600, 300], [600, 0]], thickness: 5 });
    // cloison dont le bout carré (2,5 u) affleure la face intérieure : bout à y = 10
    const bout = makeElement('wall', { points: [[800, 300], [800, 10]], thickness: 5 });
    const win = makeElement('window', { x: 450, y: 0, width: 100, depth: 14, rotation: 0 });
    const door = makeElement('door', { x: 700, y: 0, width: 90, rotation: 0 });
    useStore.getState().mutateFloor((f) => { f.unitsPerMeter = 50; f.elements = [facade, auRas, axe, bout, win, door] as any; });
    const get = (id: string) => floorOf().elements.find((e) => e.id === id) as any;
    useStore.getState().setWallThickness([facade.id], 20); // 30 → 40 cm
    expect(get(facade.id).thickness).toBe(20);
    expect(get(auRas.id).points[1][1]).toBeCloseTo(10, 6); // suit la face (y = 10)
    expect(get(axe.id).points[1][1]).toBeCloseTo(0, 6); // reste sur l'axe
    expect(get(bout.id).points[1][1]).toBeCloseTo(12.5, 6); // bout carré toujours contre la face
    expect(get(win.id).depth).toBe(20); // fenêtre à l'épaisseur du mur
    // la porte est toujours reconnue dans le mur, à sa nouvelle épaisseur
    expect(openingWallFit(floorOf(), currentVariantId(useStore.getState()), get(door.id))?.depth).toBe(20);
    // revenir aussitôt à 30 cm (même saisie) : le plan d'origine est retrouvé tel quel
    useStore.getState().setWallThickness([facade.id], 15);
    expect(get(auRas.id).points[1][1]).toBeCloseTo(7.5, 6);
    expect(get(bout.id).points[1][1]).toBeCloseTo(10, 6);
    expect(get(win.id).depth).toBe(14);
  });

  it('une ouverture légèrement décalée de l’axe est recalée et ajustée avec son mur', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    // mur un peu de travers ; fenêtre et porte à 2 mm de l'axe, angle décalé de 0,01°
    const facade = makeElement('wall', { points: [[2000, 0], [0, 2]], thickness: 20 });
    const win = makeElement('window', { x: 1000, y: 1.1, width: 100, depth: 14, rotation: -0.05 });
    const door = makeElement('door', { x: 500, y: 1.6, width: 90, rotation: -0.05 });
    useStore.getState().mutateFloor((f) => { f.unitsPerMeter = 50; f.elements = [facade, win, door] as any; });
    const v = currentVariantId(useStore.getState());
    const get = (id: string) => floorOf().elements.find((e) => e.id === id) as any;
    expect(openingWallFit(floorOf(), v, get(win.id))).toBeFalsy(); // pas exactement dans l'axe
    useStore.getState().setWallThickness([facade.id], 14);
    expect(openingWallFit(floorOf(), v, get(win.id))?.depth).toBe(14);
    expect(openingWallFit(floorOf(), v, get(door.id))?.depth).toBe(14);
    expect(get(win.id).depth).toBe(14);
  });

  it('épaisseur tapée chiffre par chiffre : même résultat qu’en une fois', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    const facade = makeElement('wall', { points: [[0, 0], [1000, 0]], thickness: 15 });
    const auRas = makeElement('wall', { points: [[300, 300], [300, 7.5]], thickness: 5 });
    useStore.getState().mutateFloor((f) => { f.unitsPerMeter = 50; f.elements = [facade, auRas] as any; });
    // « 2 » puis « 20 » : la valeur intermédiaire ne doit pas décrocher la cloison
    useStore.getState().setWallThickness([facade.id], 2);
    useStore.getState().setWallThickness([facade.id], 20);
    const w = floorOf().elements.find((e) => e.id === auRas.id) as any;
    expect(w.points[1][1]).toBeCloseTo(10, 6);
    // une seule étape d'annulation
    useStore.getState().undo();
    expect((floorOf().elements.find((e) => e.id === auRas.id) as any).points[1][1]).toBeCloseTo(7.5, 6);
  });

  it('semblables d’un mur : seulement les murs de même épaisseur (au centimètre près)', () => {
    const p = newProject();
    useStore.getState().loadProject(p, null);
    const a = makeElement('wall', { points: [[0, 0], [100, 0]], thickness: 15 });
    const b = makeElement('wall', { points: [[0, 50], [100, 50]], thickness: 15.2 }); // 30,4 cm → 30 cm à 50 u/m
    const c = makeElement('wall', { points: [[0, 90], [100, 90]], thickness: 7.5 });
    useStore.getState().mutateFloor((f) => { f.unitsPerMeter = 50; f.elements = [a, b, c] as any; });
    useStore.getState().select([a.id]);
    useStore.getState().selectWhere('similar');
    expect([...useStore.getState().selection].sort()).toEqual([a.id, b.id].sort());
    useStore.getState().select([c.id]);
    useStore.getState().selectWhere('similar');
    expect(useStore.getState().selection).toEqual([c.id]);
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
    // façade du plan d'exemple : murs de 0 à 1500 × 0 à 900, 22 u d'épaisseur ; la zone s'arrête
    // vers le milieu du mur, cachée dessous, sans déborder du nu extérieur (±11 u)
    expect(b.x).toBeGreaterThan(-6); expect(b.y).toBeGreaterThan(-6);
    expect(b.x + b.w).toBeLessThan(1506); expect(b.y + b.h).toBeLessThan(906);
    expect(b.w).toBeGreaterThan(1490); expect(b.h).toBeGreaterThan(890);
  });
});
