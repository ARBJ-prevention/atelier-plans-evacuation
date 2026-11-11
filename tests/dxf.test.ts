import { describe, expect, it } from 'vitest';
import {
  aciColor, bulgePoints, cleanDxfText, declaredUnit, decodeDxfBytes, DxfError, flattenDxf, guessUnit, parseDxf, renderDxfSvg, splinePoints, unitMeters,
} from '../src/services/dxf';

/** Construit un DXF ASCII à partir de paires [code, valeur]. */
function dxf(sections: (string | number)[][]): string {
  return sections.flat().map(String).join('\n') + '\n';
}

const header = (insunits: number) => [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, insunits, 0, 'ENDSEC'];
const tables = [
  0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER',
  0, 'LAYER', 2, 'MURS', 70, 0, 62, 1,
  0, 'LAYER', 2, 'PORTES', 70, 0, 62, 3,
  0, 'LAYER', 2, 'COTES', 70, 0, 62, -5,
  0, 'LAYER', 2, 'GELE', 70, 1, 62, 7,
  0, 'ENDTAB', 0, 'ENDSEC',
];
const blocks = [
  0, 'SECTION', 2, 'BLOCKS',
  0, 'BLOCK', 8, '0', 2, 'PORTE90', 70, 0, 10, 0, 20, 0,
  0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 900, 21, 0,
  0, 'ARC', 8, '0', 10, 0, 20, 0, 40, 900, 50, 0, 51, 90,
  0, 'ENDBLK', 8, '0',
  0, 'ENDSEC',
];
// Rectangle 10 m × 5 m en millimètres, une porte insérée tournée de 90°, un texte
const entities = [
  0, 'SECTION', 2, 'ENTITIES',
  0, 'LWPOLYLINE', 8, 'MURS', 90, 4, 70, 1, 10, 0, 20, 0, 10, 10000, 20, 0, 10, 10000, 20, 5000, 10, 0, 20, 5000,
  0, 'INSERT', 8, 'PORTES', 2, 'PORTE90', 10, 2000, 20, 0, 50, 90,
  0, 'TEXT', 8, 'MURS', 10, 5000, 20, 2500, 40, 300, 1, 'Salle %%c 1', 72, 1, 11, 5000, 21, 2500,
  0, 'LINE', 8, 'COTES', 10, 0, 20, -1000, 11, 10000, 21, -1000,
  0, 'LINE', 8, 'GELE', 10, 0, 20, 0, 11, 1, 21, 1,
  0, 'ENDSEC', 0, 'EOF',
];

const sample = () => dxf([header(4), tables, blocks, entities]);

describe('lecture DXF', () => {
  it('lit les unités, les calques et les entités', () => {
    const doc = parseDxf(sample());
    expect(doc.insUnits).toBe(4);
    expect(declaredUnit(doc.insUnits)).toBe('mm');
    expect(doc.layers.get('COTES')!.off).toBe(true);
    expect(doc.layers.get('GELE')!.frozen).toBe(true);
    expect(doc.blocks.has('PORTE90')).toBe(true);
    expect(doc.entities.map((e) => e.type)).toEqual(['LWPOLYLINE', 'INSERT', 'TEXT', 'LINE', 'LINE']);
  });

  it('calques éteints ou gelés décochés par défaut', () => {
    const flat = flattenDxf(parseDxf(sample()));
    const vis = Object.fromEntries(flat.layers.map((l) => [l.name, l.defaultVisible]));
    expect(vis).toMatchObject({ MURS: true, PORTES: true, COTES: false, GELE: false });
  });

  it('les blocs insérés héritent du calque de l’insertion et sont transformés', () => {
    const flat = flattenDxf(parseDxf(sample()));
    const door = flat.prims.filter((p) => p.layer === 'PORTES');
    expect(door).toHaveLength(2);
    const leaf = door[0];
    expect(leaf.kind).toBe('line');
    if (leaf.kind === 'line') {
      // ligne (0,0)-(900,0) tournée de 90° puis déplacée en (2000,0) → (2000,0)-(2000,900)
      expect(leaf.pts[1][0]).toBeCloseTo(2000, 6);
      expect(leaf.pts[1][1]).toBeCloseTo(900, 6);
    }
  });

  it('convertit à l’échelle réelle : 10 m × 5 m', () => {
    const flat = flattenDxf(parseDxf(sample()));
    const res = renderDxfSvg(flat, { visibleLayers: new Set(['MURS', 'PORTES']), metersPerUnit: unitMeters('mm'), unitsPerMeter: 50, monochrome: true });
    expect(res.widthM).toBeCloseTo(10, 6);
    expect(res.heightM).toBeCloseTo(5, 6);
    expect(res.width).toBeCloseTo(500, 6);
    expect(res.height).toBeCloseTo(250, 6);
    expect(res.svg).toContain('viewBox="0 0 500 250"');
    expect(res.svg).toContain('Salle Ø 1');
    // axe Y inversé : le coin (0,0) du DXF est en bas à gauche du SVG
    expect(res.svg).toContain('M0 250');
  });

  it('les calques décochés ne sont pas importés et ne comptent pas dans l’emprise', () => {
    const flat = flattenDxf(parseDxf(sample()));
    const res = renderDxfSvg(flat, { visibleLayers: new Set(['MURS', 'PORTES', 'COTES']), metersPerUnit: 0.001, unitsPerMeter: 50, monochrome: true });
    expect(res.heightM).toBeCloseTo(6, 6); // la cote à y = -1 m agrandit l'emprise
    expect(() => renderDxfSvg(flat, { visibleLayers: new Set(), metersPerUnit: 1, unitsPerMeter: 50, monochrome: true })).toThrow(DxfError);
  });

  it('écarte les éléments isolés très éloignés', () => {
    const many: (string | number)[] = [0, 'SECTION', 2, 'ENTITIES'];
    for (let i = 0; i < 50; i++) many.push(0, 'LINE', 8, 'A', 10, i * 100, 20, 0, 11, i * 100, 21, 1000);
    many.push(0, 'LINE', 8, 'A', 10, 1e7, 20, 1e7, 11, 1e7 + 1, 21, 1e7, 0, 'ENDSEC', 0, 'EOF');
    const flat = flattenDxf(parseDxf(dxf([header(6), many])));
    const res = renderDxfSvg(flat, { visibleLayers: new Set(['A']), metersPerUnit: 1, unitsPerMeter: 50, monochrome: false });
    expect(res.outliers).toBe(1);
    expect(res.widthM).toBeCloseTo(4900, 6);
  });

  it('polylignes 2D anciennes (POLYLINE/VERTEX) et hachures', () => {
    const ents = [
      0, 'SECTION', 2, 'ENTITIES',
      0, 'POLYLINE', 8, 'P', 66, 1, 70, 1,
      0, 'VERTEX', 8, 'P', 10, 0, 20, 0, 0, 'VERTEX', 8, 'P', 10, 4, 20, 0, 0, 'VERTEX', 8, 'P', 10, 4, 20, 3,
      0, 'SEQEND', 8, 'P',
      0, 'HATCH', 8, 'H', 2, 'SOLID', 70, 1, 91, 1, 92, 2, 72, 0, 73, 1, 93, 3, 10, 0, 20, 0, 10, 2, 20, 0, 10, 2, 20, 2, 97, 0, 75, 0,
      0, 'ENDSEC', 0, 'EOF',
    ];
    const flat = flattenDxf(parseDxf(dxf([header(6), ents])));
    const poly = flat.prims.find((p) => p.layer === 'P');
    const fill = flat.prims.find((p) => p.layer === 'H');
    expect(poly?.kind === 'line' && poly.pts.length === 3 && poly.closed).toBe(true);
    expect(fill?.kind === 'fill' && fill.solid && fill.rings[0].length === 3).toBe(true);
  });
});

describe('géométrie DXF', () => {
  it('renflement (bulge) = 1 : demi-cercle passant sous la corde', () => {
    const pts = bulgePoints([0, 0], [2, 0], 1);
    const mid = pts[Math.floor(pts.length / 2)];
    expect(mid[0]).toBeCloseTo(1, 6);
    expect(mid[1]).toBeCloseTo(-1, 6);
    expect(pts[pts.length - 1]).toEqual([2, 0]);
  });

  it('B-spline de degré 1 = polygone de contrôle', () => {
    const pts = splinePoints(1, [0, 0, 1, 1], [[0, 0], [10, 0]]);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1][0]).toBeCloseTo(10, 9);
  });

  it('textes MTEXT nettoyés', () => {
    expect(cleanDxfText('{\\fArial|b1;Bureau}\\PRDC \\U+00E9', true)).toBe('Bureau\nRDC é');
    expect(cleanDxfText('1\\S2^3;', true)).toBe('12/3');
  });

  it('couleurs AutoCAD et unités', () => {
    expect(aciColor(1)).toBe('#ff0000');
    expect(aciColor(7)).toBe('#000000');
    expect(aciColor(10)).toBe('#ff0000');
    expect(guessUnit(45000)).toBe('mm');
    expect(guessUnit(4500)).toBe('cm');
    expect(guessUnit(45)).toBe('m');
    expect(declaredUnit(0)).toBeNull();
  });

  it('refuse un DXF binaire et un fichier quelconque', () => {
    expect(() => decodeDxfBytes(new TextEncoder().encode('AutoCAD Binary DXF\r\n\u001a\u0000'))).toThrow(/binaire/);
    expect(() => parseDxf('bonjour\nle monde\n')).toThrow(DxfError);
    expect(decodeDxfBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café'); // Windows-1252
  });
});
