import { useMemo, useRef, useState } from 'react';
import { exportBuildingPdf, type BatchExportControl, type BatchExportResult } from '../app/actions';
import { api } from '../services/api';
import type { Building, CustomSymbol } from '../model/types';
import { PRINT_ISSUE_LEVEL, printIssues, STATUS_LABEL } from '../render/PrintPage';
import type { ExportJob } from '../services/exporter';
import { Icon } from '../ui/icons';
import { PrintPreviewPane, PrintReview, usePrintEscape, type EditPrintIssue, type ReviewReturn } from './PrintReview';

export function BuildingExport({ building, customSymbols, onBack, onClose, onEdit, initial }: {
  building: Building; customSymbols: CustomSymbol[]; onBack(): void; onClose(): void; onEdit: EditPrintIssue;
  initial?: Extract<ReviewReturn, { mode: 'building' }>;
}) {
  const pages = useMemo(() => building.floors.flatMap((floor) => floor.variants.map((variant) => ({
    key: `${floor.id}:${variant.id}`, floor, variant, label: `${floor.name} · ${variant.name}`,
  }))), [building]);
  const [selected, setSelected] = useState(() => new Set(initial ? initial.selected.filter((k) => pages.some((p) => p.key === k)) : pages.map((page) => page.key)));
  const [previewKey, setPreviewKey] = useState(initial && pages.some((p) => p.key === initial.previewKey) ? initial.previewKey : pages[0].key);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string; separate: boolean } | null>(null);
  const [result, setResult] = useState<BatchExportResult | null>(null);
  const control = useRef<BatchExportControl>({});
  const backdrop = usePrintEscape(onClose, busy);
  const preview = pages.find((page) => page.key === previewKey) ?? pages[0];
  const chosen = pages.filter((page) => selected.has(page.key));
  const alerts = chosen.map(({ floor, variant, label }) => ({
    floorId: floor.id, variantId: variant.id, label, issues: printIssues(floor, variant.id, floor.page, building),
  }));
  const run = async (separate: boolean) => {
    const jobs = building.floors.flatMap<ExportJob>((floor) => {
      const variantIds = chosen.filter((page) => page.floor.id === floor.id).map((page) => page.variant.id);
      return variantIds.length ? [{ building, floor, variantIds, customSymbols, page: floor.page }] : [];
    });
    setBusy(true);
    setResult(null);
    control.current = { onProgress: (done, total, label) => setProgress({ done, total, label, separate }) };
    try { setResult(await exportBuildingPdf(jobs, separate, control.current)); } finally { setBusy(false); setProgress(null); }
  };

  return (
    <div className="modal-backdrop" ref={backdrop}>
      <div className="print-dialog" role="dialog" aria-modal="true" aria-label="Exporter le bâtiment">
        <PrintPreviewPane building={building} floor={preview.floor} variantId={preview.variant.id} customSymbols={customSymbols} uniqueKey="batch-preview" />
        <div className="print-settings">
          <button className="btn small" autoFocus disabled={busy} onClick={onBack}>← Aperçu de l’étage</button>
          <h2>Exporter le bâtiment</h2>
          <p className="muted small">{building.name} · {chosen.length} page(s) sélectionnée(s)</p>
          <fieldset className="export-pages" disabled={busy}>
            <legend>Pages à inclure</legend>
            <div className="row gap">
              <button className="btn small" onClick={() => setSelected(new Set(pages.map((page) => page.key)))}>Tout sélectionner</button>
              <button className="btn small" onClick={() => setSelected(new Set())}>Tout désélectionner</button>
            </div>
            {pages.map((page) => (
              <div className={preview.key === page.key ? 'export-page active' : 'export-page'} key={page.key}>
                <input type="checkbox" checked={selected.has(page.key)} aria-label={`Inclure ${page.label}`}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) { next.add(page.key); setPreviewKey(page.key); }
                    else next.delete(page.key);
                    setSelected(next);
                  }} />
                <button className="export-page-name" aria-pressed={preview.key === page.key} onClick={() => setPreviewKey(page.key)}>
                  {page.label}<small>{page.floor.page.paper} · {page.floor.page.orientation === 'portrait' ? 'Portrait' : 'Paysage'}</small>
                </button>
                {(() => {
                  const n = printIssues(page.floor, page.variant.id, page.floor.page, building).filter((i) => PRINT_ISSUE_LEVEL[i] === 'check').length;
                  return (
                    <span className="export-page-state">
                      <span className={`badge status-${page.floor.titleBlock.status}`}>{STATUS_LABEL[page.floor.titleBlock.status]}</span>
                      <span className={n ? 'export-page-checks warn' : 'export-page-checks ok'} title={n ? `${n} point(s) à vérifier` : 'Rien à signaler'}>{n ? `${n} à vérifier` : 'OK'}</span>
                    </span>
                  );
                })()}
              </div>
            ))}
          </fieldset>
          <PrintReview alerts={alerts} onEdit={(alert, issue) => {
            if (!busy) onEdit(alert.floorId, alert.variantId, issue, { mode: 'building', selected: [...selected], previewKey: `${alert.floorId}:${alert.variantId}` });
          }} />
          {progress && (
            <div className="export-progress" role="status" aria-live="polite">
              <div className="export-progress-head">
                <b>{progress.separate ? `Fichier ${Math.min(progress.done + 1, progress.total)} sur ${progress.total}` : `PDF de ${progress.total} page(s)`}</b>
                {progress.separate && <button className="btn small" onClick={() => { control.current.cancelled = true; }}>Annuler</button>}
              </div>
              <div className={progress.separate ? 'bar' : 'bar indeterminate'}><span style={{ width: `${progress.separate ? Math.round((progress.done / progress.total) * 100) : 100}%` }} /></div>
              <small className="muted">{progress.label}</small>
            </div>
          )}
          {result && !busy && (
            <div className={result.cancelled ? 'export-result warn' : 'export-result'} role="status">
              <span>{result.cancelled ? `Export arrêté : ${result.completed} sur ${result.total}` : `Export terminé : ${result.total} page(s)`} · {(result.ms / 1000).toFixed(1).replace('.', ',')} s</span>
              {result.showPath && <button className="btn small" onClick={() => api().showInFolder(result.showPath!)}><Icon name="folder" size={14} /> Ouvrir le dossier</button>}
            </div>
          )}
          <div className="print-actions">
            <button className="btn primary" disabled={busy || !chosen.length} onClick={() => run(false)}><Icon name="pdf" size={16} />
              {busy ? 'Export en cours…' : `Exporter un PDF · ${chosen.length} page(s)`}
            </button>
            <button className="btn" disabled={busy || !chosen.length} onClick={() => run(true)}>Exporter un PDF par page</button>
            <button className="btn" disabled={busy} onClick={onClose}>Fermer</button>
          </div>
        </div>
      </div>
    </div>
  );
}
