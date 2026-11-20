import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/app/sample';
import { buildSampleDxf } from '../src/app/sampleDxf';
import { binaryDxfToText, flattenDxf, parseDxf, renderDxfSvg, unitMeters } from '../src/services/dxf';
import { floorToDxf } from '../src/services/cadExport';
import { pathToPolylines, svgToDxf } from '../src/services/svgToDxf';
import { normalizePlanFile, sniffPlanType } from '../src/services/planFormats';
import { guessLayerRole, recognizePlan, type LayerRole } from '../src/services/recognize';

function recognize(text: string, unit: string) {
  const flat = flattenDxf(parseDxf(text));
  const roles: Record<string, LayerRole> = Object.fromEntries(flat.layers.map((l) => [l.name, guessLayerRole(l.name)]));
  const visible = new Set(flat.layers.filter((l) => roles[l.name] !== 'ignore').map((l) => l.name));
  const res = renderDxfSvg(flat, { visibleLayers: visible, metersPerUnit: unitMeters(unit), unitsPerMeter: 50, monochrome: true });
  return { flat, rec: recognizePlan(flat, { roles, origin: res.origin, unitsPerMeter: 50 }) };
}

/** Encode un DXF texte en DXF binaire (R13+), pour tester la lecture binaire. */
function toBinary(text: string): Uint8Array {
  const lines = text.split(/\r?\n/);
  const parts: number[] = [...new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\0')];
  const f64 = (c: number) => (c >= 10 && c <= 59) || (c >= 110 && c <= 149) || (c >= 210 && c <= 239);
  const i16 = (c: number) => (c >= 60 && c <= 79) || (c >= 170 && c <= 179) || (c >= 270 && c <= 289) || (c >= 370 && c <= 389);
  const i32 = (c: number) => c >= 90 && c <= 99;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = parseInt(lines[i], 10), v = lines[i + 1].trim();
    parts.push(c & 0xff, c >> 8);
    const buf = new ArrayBuffer(8), dv = new DataView(buf);
    if (f64(c)) { dv.setFloat64(0, parseFloat(v), true); parts.push(...new Uint8Array(buf)); }
    else if (i16(c)) { dv.setInt16(0, parseInt(v, 10) || 0, true); parts.push(...new Uint8Array(buf, 0, 2)); }
    else if (i32(c)) { dv.setInt32(0, parseInt(v, 10) || 0, true); parts.push(...new Uint8Array(buf, 0, 4)); }
    else parts.push(...new TextEncoder().encode(v), 0);
  }
  return new Uint8Array(parts);
}

describe('export DXF', () => {
  it('exporte le plan d’exemple en DXF relisible et reconnu (murs, portes, fenêtres)', () => {
    const p = buildSampleProject();
    // Le plan d'exemple dessine des portes de 90 unités : 100 unités par mètre = portes de 90 cm.
    const floor = { ...p.buildings[0].floors[0], unitsPerMeter: 100 };
    const dxf = floorToDxf(floor, floor.variants[0].id);
    expect(dxf).toContain('AC1015');
    expect(dxf).toContain('$INSUNITS');
    const { flat, rec } = recognize(dxf, 'mm');
    const names = flat.layers.map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(['MURS', 'PORTES', 'FENETRES']));
    const walls = floor.elements.filter((e) => e.type === 'wall').length;
    expect(walls).toBeGreaterThan(0);
    expect(rec.walls.length).toBeGreaterThan(0);
    expect(rec.doors.length).toBeGreaterThan(0);
  });
});

describe('DXF binaire et multilignes', () => {
  it('lit un DXF binaire comme le même DXF en texte', () => {
    const text = buildSampleDxf();
    const fromBin = flattenDxf(parseDxf(binaryDxfToText(toBinary(text))));
    const fromText = flattenDxf(parseDxf(text));
    expect(fromBin.prims.length).toBe(fromText.prims.length);
  });

  it('dessine les murs tracés en multiligne (MLINE)', () => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'MLINE', '8', 'MURS', '40', '1', '70', '0', '71', '1', '72', '2', '73', '2',
      '10', '0', '20', '0', '30', '0',
      '11', '0', '21', '0', '31', '0', '12', '1', '22', '0', '32', '0', '13', '0', '23', '1', '33', '0', '74', '2', '41', '100', '41', '0', '75', '0', '74', '2', '41', '-100', '41', '0', '75', '0',
      '11', '5000', '21', '0', '31', '0', '12', '1', '22', '0', '32', '0', '13', '0', '23', '1', '33', '0', '74', '2', '41', '100', '41', '0', '75', '0', '74', '2', '41', '-100', '41', '0', '75', '0',
      '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const flat = flattenDxf(parseDxf(dxf));
    expect(flat.skipped.MLINE).toBeUndefined();
    const lines = flat.prims.filter((p) => p.kind === 'line');
    expect(lines.length).toBe(4); // deux faces + deux extrémités
    const ys = lines.slice(0, 2).map((l) => (l.kind === 'line' ? l.pts[0][1] : 0)).sort((a, b) => a - b);
    expect(ys).toEqual([-100, 100]);
  });
});

describe('import SVG', () => {
  it('lit les chemins (relatifs, courbes, arcs)', () => {
    const subs = pathToPolylines('M10 10 h 100 v 50 H10 Z m 200 0 c 10 0 20 10 20 20 a 10 10 0 0 1 20 0');
    expect(subs.length).toBe(2);
    expect(subs[0].closed).toBe(true);
    expect(subs[0].pts[2]).toEqual([110, 60]);
    expect(subs[1].pts[subs[1].pts.length - 1][0]).toBeCloseTo(250);
  });

  it('convertit un plan SVG (calques Inkscape, transformations) en DXF exploitable', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600">
      <defs><rect id="cache" width="5" height="5"/></defs>
      <g inkscape:label="Murs" transform="translate(10,20)">
        <rect x="0" y="0" width="800" height="20"/><polygon points="0,0 20,0 20,500 0,500"/>
        <path d="M 0 480 L 800 480 L 800 500 L 0 500 Z"/>
      </g>
      <g id="Portes"><line x1="100" y1="0" x2="190" y2="0"/></g>
      <text x="300" y="250" font-size="24">Bureau &amp; accueil</text>
      <g style="display:none"><rect width="9" height="9"/></g>
    </svg>`;
    const { dxf, count } = svgToDxf(svg);
    expect(count).toBe(5);
    const flat = flattenDxf(parseDxf(dxf));
    expect(flat.layers.map((l) => l.name).sort()).toEqual(['Murs', 'Portes', 'SVG']);
    const text = flat.prims.find((p) => p.kind === 'text');
    expect(text && text.kind === 'text' ? text.lines[0] : '').toBe('Bureau & accueil');
    const rect = flat.prims.find((p) => p.kind === 'line' && p.layer === 'Murs');
    expect(rect && rect.kind === 'line' ? rect.pts[0] : null).toEqual([10, -20]);
  });
});

describe('reconnaissance du type de fichier', () => {
  it('reconnaît le contenu même avec une mauvaise extension', async () => {
    expect(sniffPlanType(new TextEncoder().encode('AC1032\0\0'))).toBe('dwg');
    expect(sniffPlanType(new TextEncoder().encode('  0\r\nSECTION\r\n'))).toBe('dxf');
    expect(sniffPlanType(new TextEncoder().encode('<svg xmlns="x"></svg>'))).toBe('svg');
    expect(sniffPlanType(new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    const f = await normalizePlanFile({ name: 'plan.txt', ext: 'txt', data: new TextEncoder().encode(buildSampleDxf()) });
    expect(f.ext).toBe('dxf');
  });

  it('explique comment convertir un fichier EdrawMax ou Visio', async () => {
    await expect(normalizePlanFile({ name: 'plan.eddx', ext: 'eddx', data: new Uint8Array([0x50, 0x4b, 3, 4]) })).rejects.toThrow(/EdrawMax/);
    await expect(normalizePlanFile({ name: 'plan.vsdx', ext: 'vsdx', data: new Uint8Array([0x50, 0x4b, 3, 4]) })).rejects.toThrow(/Visio/);
  });
});
