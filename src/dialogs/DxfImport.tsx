import { useMemo, useState } from 'react';
import {
  declaredUnit, DXF_UNITS, dxfMaxDim, guessUnit, renderDxfSvg, unitMeters, type DxfRenderResult, type FlatDxf,
} from '../services/dxf';
import { ask } from '../ui/dialogs';

export interface DxfImportChoice {
  result: DxfRenderResult;
  unit: string;
  unitDeclared: boolean;
  visibleLayers: string[];
  monochrome: boolean;
  /** Lancer la reconnaissance (murs, portes, fenêtres, escaliers, pièces) après l'import. */
  recognize: boolean;
}

const fmtM = (v: number) => v.toLocaleString('fr-BE', { maximumFractionDigits: v < 10 ? 2 : 1 });

function svgPreviewUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Fenêtre d'import DXF : unités, calques à importer, aperçu en direct. */
export async function askDxfImport(flat: FlatDxf, fileName: string, unitsPerMeter: number, dwgVersion?: string): Promise<DxfImportChoice | null> {
  const declared = declaredUnit(flat.insUnits);
  const defaultVisible = flat.layers.filter((l) => l.defaultVisible).map((l) => l.name);
  const unit = declared ?? guessUnit(dxfMaxDim(flat, new Set(defaultVisible)));
  const render = (v: Record<string, any>): DxfRenderResult | string => {
    try {
      return renderDxfSvg(flat, { visibleLayers: new Set(v.visible as string[]), metersPerUnit: unitMeters(v.unit), unitsPerMeter, monochrome: !!v.mono });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  const skippedTypes = Object.entries(flat.skipped);
  const r = await ask({
    title: `Importer un plan ${dwgVersion ? 'DWG' : 'DXF'} — ${fileName}`,
    message: dwgVersion ? `Fichier ${dwgVersion} lu grâce à ODA File Converter.` : undefined,
    wide: true,
    initial: { unit, visible: defaultVisible, mono: true, recognize: true },
    invalid: (v) => ((v.visible as string[]).length ? null : 'Aucun calque'),
    render: (v, set) => <DxfPanel flat={flat} values={v} set={set} declared={declared} render={render} skipped={skippedTypes} />,
    buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Continuer', value: 'ok', primary: true }],
  });
  if (r.button !== 'ok') return null;
  const res = render(r.values);
  if (typeof res === 'string') throw new Error(res);
  return { result: res, unit: r.values.unit, unitDeclared: declared === r.values.unit, visibleLayers: r.values.visible, monochrome: !!r.values.mono, recognize: !!r.values.recognize };
}

export function DxfPanel({ flat, values, set, declared, render, skipped }: {
  flat: FlatDxf; values: Record<string, any>; set(p: Record<string, any>): void; declared: string | null;
  render(v: Record<string, any>): DxfRenderResult | string; skipped: [string, number][];
}) {
  const [filter, setFilter] = useState('');
  const visible = new Set(values.visible as string[]);
  const preview = useMemo(() => render(values), [values.unit, values.mono, values.visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = flat.layers.filter((l) => l.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (name: string, on: boolean) => {
    const next = new Set(visible);
    if (on) next.add(name); else next.delete(name);
    set({ visible: flat.layers.map((l) => l.name).filter((n) => next.has(n)) });
  };
  const setAll = (on: boolean) => {
    const names = new Set(shown.map((l) => l.name));
    set({ visible: flat.layers.map((l) => l.name).filter((n) => (names.has(n) ? on : visible.has(n))) });
  };

  return (
    <div className="dxf-import">
      <div className="dxf-preview">
        {typeof preview === 'string'
          ? <p className="muted small">{preview}</p>
          : <img src={svgPreviewUrl(preview.svg)} alt="Aperçu du plan importé" />}
      </div>
      <div className="dxf-side">
        <label className="field">
          <span>Unité du dessin</span>
          <select value={values.unit} onChange={(e) => set({ unit: e.target.value })}>
            {DXF_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}{u.key === declared ? ' (indiquée dans le fichier)' : ''}</option>)}
          </select>
          <small>{declared ? 'Unité lue dans le fichier.' : 'Le fichier n’indique pas d’unité : vérifiez que les dimensions ci-dessous sont correctes.'}</small>
        </label>
        {typeof preview !== 'string' && (
          <p className="dxf-dims">
            <b>{fmtM(preview.widthM)} m × {fmtM(preview.heightM)} m</b>
            <span className="muted small">{preview.count.toLocaleString('fr-BE')} objets
              {preview.outliers > 0 && <> · {preview.outliers} objet(s) très éloigné(s) ignoré(s)</>}</span>
          </p>
        )}
        <label className="field check">
          <input type="checkbox" checked={!!values.mono} onChange={(e) => set({ mono: e.target.checked })} /> <span>Tout dessiner en noir</span>
        </label>
        <label className="field check">
          <input type="checkbox" checked={!!values.recognize} onChange={(e) => set({ recognize: e.target.checked })} /> <span><b>Redessiner le plan</b> : reconnaître murs, portes, fenêtres, escaliers et pièces</span>
        </label>
      </div>
      <div className="dxf-layers">
        <div className="row gap">
          <b className="small">Calques ({visible.size}/{flat.layers.length})</b>
          <input className="dxf-filter" placeholder="Filtrer…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button type="button" className="btn small" onClick={() => setAll(true)}>Tout cocher</button>
          <button type="button" className="btn small" onClick={() => setAll(false)}>Tout décocher</button>
        </div>
        <ul>
          {shown.map((l) => (
            <li key={l.name}>
              <label>
                <input type="checkbox" checked={visible.has(l.name)} onChange={(e) => toggle(l.name, e.target.checked)} />
                <i className="swatch" style={{ background: l.color === '#ffffff' ? '#000000' : l.color }} />
                <span className="name" title={l.name}>{l.name}</span>
                <span className="muted tiny">{l.count.toLocaleString('fr-BE')}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="muted tiny">Décochez les calques inutiles pour un plan d’évacuation (cotes, mobilier, points topographiques, cartouche…).
          {skipped.length > 0 && <> Objets non pris en charge, ignorés : {skipped.map(([t, n]) => `${t} (${n})`).join(', ')}.</>}</p>
      </div>
    </div>
  );
}
