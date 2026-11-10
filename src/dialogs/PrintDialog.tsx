import { useState } from 'react';
import * as A from '../app/actions';
import { floorContentBounds } from '../model/geometry';
import type { PageSetup, PageTheme } from '../model/types';
import { ThemeThumb } from '../panels/Ribbon';
import { PrintPage } from '../render/PrintPage';
import { computeLayout, THEMES } from '../render/layout';
import { currentBuilding, currentFloor, currentVariantId, useStore } from '../store/store';
import { Icon } from '../ui/icons';

export function PrintDialog({ onClose }: { onClose(): void }) {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => currentFloor(s))!;
  const building = useStore((s) => currentBuilding(s))!;
  const activeVariant = useStore((s) => currentVariantId(s));
  const [previewVariant, setPreviewVariant] = useState(activeVariant);
  const [scope, setScope] = useState<'current' | 'all'>(floor.variants.length > 1 ? 'all' : 'current');
  const [dpi, setDpi] = useState(300);
  const [busy, setBusy] = useState('');
  const page = floor.page;

  const set = (patch: Partial<PageSetup>) =>
    useStore.getState().mutateFloor((f) => { Object.assign(f.page, patch); }, { keepValidation: true, coalesce: `page:${Object.keys(patch).join(',')}` });

  const useCurrentView = () => {
    const s = useStore.getState();
    const el = document.querySelector('.canvas-wrap');
    const w = el?.clientWidth ?? 800, h = el?.clientHeight ?? 600;
    set({ area: 'custom', customArea: { x: -s.view.x / s.view.zoom, y: -s.view.y / s.view.zoom, w: w / s.view.zoom, h: h / s.view.zoom } });
  };

  const job = () => {
    const j = A.currentExportJob(scope)!;
    if (scope === 'current') j.variantIds = [previewVariant];
    return j;
  };
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try { await fn(); } finally { setBusy(''); }
  };

  const L = computeLayout(floor, previewVariant, page);
  const calibrated = floor.unitsPerMeter > 0;
  const ca = page.customArea;

  return (
    <div className="modal-backdrop" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="print-dialog" role="dialog" aria-modal="true" aria-label="Aperçu avant impression">
        <div className="print-preview">
          <div className={`preview-page ${page.orientation}`}>
            <PrintPage building={building} floor={floor} variantId={previewVariant} customSymbols={project.customSymbols} uniqueKey="preview" />
          </div>
          <div className="preview-caption muted small">
            {page.paper} {page.orientation === 'landscape' ? 'paysage' : 'portrait'} · {L.w}×{L.h} mm
            {L.scaleDenominator ? ` · échelle ${page.scaleMode === 'fixed' ? '' : '≈ '}1:${Math.round(L.scaleDenominator)}` : ' · échelle : ajustée à la page'}
          </div>
        </div>

        <div className="print-settings">
          <h2>Aperçu et export</h2>

          {floor.variants.length > 1 && (
            <>
              <h3>Version affichée</h3>
              <select value={previewVariant} onChange={(e) => setPreviewVariant(e.target.value)}>
                {floor.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <div className="seg full">
                <button className={scope === 'current' ? 'on' : ''} onClick={() => setScope('current')}>Cette version</button>
                <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Toutes ({floor.variants.length})</button>
              </div>
            </>
          )}

          <h3>Thème</h3>
          <div className="theme-grid">
            {(Object.keys(THEMES) as PageTheme[]).map((t) => <ThemeThumb key={t} theme={t} accent={page.accentColor} active={page.theme === t} onClick={() => set({ theme: t })} />)}
          </div>

          <h3>Papier</h3>
          <div className="seg full">
            {(['A4', 'A3', 'A2'] as const).map((p) => <button key={p} className={page.paper === p ? 'on' : ''} onClick={() => set({ paper: p })}>{p}</button>)}
          </div>
          <div className="seg full">
            <button className={page.orientation === 'portrait' ? 'on' : ''} onClick={() => set({ orientation: 'portrait' })}>Portrait</button>
            <button className={page.orientation === 'landscape' ? 'on' : ''} onClick={() => set({ orientation: 'landscape' })}>Paysage</button>
          </div>
          <label className="field inline"><span>Marges (mm)</span>
            <input type="number" min={0} max={40} value={page.marginMm} onChange={(e) => set({ marginMm: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} />
          </label>

          <h3>Échelle</h3>
          <div className="seg full">
            <button className={page.scaleMode === 'fit' ? 'on' : ''} onClick={() => set({ scaleMode: 'fit' })}>Ajuster à la page</button>
            <button className={page.scaleMode === 'fixed' ? 'on' : ''} disabled={!calibrated} onClick={() => set({ scaleMode: 'fixed' })}
              title={calibrated ? '' : 'Étalonnez d’abord l’échelle du plan'}>Échelle fixe</button>
          </div>
          {page.scaleMode === 'fixed' && calibrated && (
            <label className="field inline"><span>1 :</span>
              <input type="number" min={1} value={page.scale} onChange={(e) => set({ scale: Math.max(1, Number(e.target.value) || 100) })} />
              <select value="" onChange={(e) => e.target.value && set({ scale: Number(e.target.value) })} aria-label="Échelles courantes">
                <option value="">courantes…</option>{[50, 100, 150, 200, 250, 500].map((v) => <option key={v} value={v}>1:{v}</option>)}
              </select>
            </label>
          )}
          {!calibrated && <p className="muted tiny">Échelle fixe et barre d’échelle disponibles après étalonnage.</p>}

          <h3>Zone imprimée</h3>
          <div className="seg full">
            <button className={page.area === 'auto' ? 'on' : ''} onClick={() => set({ area: 'auto' })}>Tout le plan</button>
            <button className={page.area === 'custom' ? 'on' : ''} onClick={() => set({ area: 'custom', customArea: page.area === 'custom' ? ca : floorContentBounds(floor, previewVariant) })}>Personnalisée</button>
          </div>
          {page.area === 'custom' && (
            <>
              <div className="area-grid">
                {(['x', 'y', 'w', 'h'] as const).map((k) => (
                  <label key={k}><span>{{ x: 'X', y: 'Y', w: 'Largeur', h: 'Hauteur' }[k]}</span>
                    <input type="number" value={Math.round(ca[k])} onChange={(e) => set({ customArea: { ...ca, [k]: Number(e.target.value) || 0 } })} />
                  </label>
                ))}
              </div>
              <button className="btn small full" onClick={useCurrentView}>Utiliser la vue actuelle de l’éditeur</button>
            </>
          )}

          <h3>Contenu de la page</h3>
          {([['showTitleBlock', 'En-tête et cartouche'], ['showLegend', 'Légende'], ['showInstructions', 'Consignes'],
            ['showEmergencyNumbers', 'Numéros d’urgence'], ['showScaleBar', 'Barre d’échelle'], ['showNorth', 'Flèche du nord'], ['showWatermark', 'Filigrane « Brouillon / À valider »']] as const).map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={page[k]} onChange={(e) => set({ [k]: e.target.checked } as any)} /> {label}</label>
          ))}

          <div className="print-actions">
            <button className="btn primary" disabled={!!busy} onClick={() => run('print', () => A.printAction(job()))}><Icon name="print" size={16} /> {busy === 'print' ? 'Préparation…' : 'Imprimer…'}</button>
            <button className="btn primary" disabled={!!busy} onClick={() => run('pdf', () => A.exportPdfAction(job()))}><Icon name="pdf" size={16} /> {busy === 'pdf' ? 'Export…' : 'Exporter en PDF'}</button>
            <div className="row gap">
              <button className="btn" disabled={!!busy} onClick={() => run('png', () => A.exportPngAction(job(), dpi))}><Icon name="image" size={16} /> {busy === 'png' ? 'Export…' : 'Exporter en PNG'}</button>
              <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))} aria-label="Résolution PNG">
                <option value={150}>150 ppp</option><option value={300}>300 ppp</option><option value={600}>600 ppp</option>
              </select>
            </div>
            <button className="btn" onClick={onClose}>Fermer</button>
          </div>
        </div>
      </div>
    </div>
  );
}
