import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildSampleDxf } from '../src/app/sampleDxf';
import { buildSampleProject } from '../src/app/sample';
import { DxfPanel } from '../src/dialogs/DxfImport';
import { RecognizePanel } from '../src/dialogs/Recognize';
import { flattenDxf, parseDxf, renderDxfSvg, unitMeters } from '../src/services/dxf';
import { guessLayerRole, recognizePlan, RECOGNIZED_KINDS, type LayerRole } from '../src/services/recognize';
import type { Background } from '../src/model/types';

const flat = flattenDxf(parseDxf(buildSampleDxf()));
const visible = flat.layers.filter((l) => l.defaultVisible).map((l) => l.name);

describe('fenêtres d’import (rendu)', () => {
  it('fenêtre DXF : aperçu, dimensions, calques, option « Redessiner »', () => {
    const render = (v: Record<string, any>) => renderDxfSvg(flat, { visibleLayers: new Set(v.visible), metersPerUnit: unitMeters(v.unit), unitsPerMeter: 50, monochrome: !!v.mono });
    const html = renderToStaticMarkup(<DxfPanel flat={flat} values={{ unit: 'mm', visible, mono: true, recognize: true }} set={() => {}} declared="mm" render={render} skipped={[]} />);
    expect(html).toContain('Aperçu du plan importé');
    expect(html).toMatch(/\d+(,\d+)? m × \d+(,\d+)? m/);
    expect(html).toContain('(indiquée dans le fichier)');
    expect(html).toContain('Redessiner le plan');
    expect(html).toContain('CARTOUCHE');
  });

  it('fenêtre de reconnaissance : aperçu redessiné, compteurs, rôles des calques', () => {
    const roles: Record<string, LayerRole> = Object.fromEntries(visible.map((l) => [l, guessLayerRole(l)]));
    const res = renderDxfSvg(flat, { visibleLayers: new Set(visible), metersPerUnit: 0.001, unitsPerMeter: 50, monochrome: true });
    const floor = buildSampleProject().buildings[0].floors[0];
    const bg: Background = { src: 'data:image/svg+xml;base64,', sourceName: 'x.dxf', naturalWidth: res.width, naturalHeight: res.height, x: 0, y: 0, scale: 1, opacity: 0.6, locked: true, grayscale: false };
    const run = (v: Record<string, any>) => recognizePlan(flat, { roles: Object.fromEntries(flat.layers.map((l) => [l.name, v.roles[l.name] ?? 'ignore'])), origin: res.origin, unitsPerMeter: 50 });
    const html = renderToStaticMarkup(<RecognizePanel values={{ roles, kinds: RECOGNIZED_KINDS.map((k) => k.key) }} set={() => {}}
      layers={visible} counts={new Map(flat.layers.map((l) => [l.name, l.count]))} run={run} floor={floor} background={bg} upm={50} />);
    expect(html).toContain('Pièces <span class="muted">(5)</span>');
    expect(html).toContain('Portes <span class="muted">(5)</span>');
    expect(html).toContain('Salle de réunion'); // nom de pièce dessiné dans l'aperçu
    expect(html).toMatch(/<option value="walls" selected="">Murs<\/option>/);
  });
});
