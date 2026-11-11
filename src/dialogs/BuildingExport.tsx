import { useMemo, useState } from 'react';
import { exportBuildingPdf } from '../app/actions';
import type { Building, CustomSymbol } from '../model/types';
import { printIssues } from '../render/PrintPage';
import type { ExportJob } from '../services/exporter';
import { Icon } from '../ui/icons';
import { PrintPreviewPane, PrintReview, usePrintEscape, type EditPrintIssue } from './PrintReview';

export function BuildingExport({ building, customSymbols, onBack, onClose, onEdit }: {
  building: Building; customSymbols: CustomSymbol[]; onBack(): void; onClose(): void; onEdit: EditPrintIssue;
}) {
  const pages = useMemo(() => building.floors.flatMap((floor) => floor.variants.map((variant) => ({
    key: `${floor.id}:${variant.id}`, floor, variant, label: `${floor.name} · ${variant.name}`,
  }))), [building]);
  const [selected, setSelected] = useState(() => new Set(pages.map((page) => page.key)));
  const [previewKey, setPreviewKey] = useState(pages[0].key);
  const [busy, setBusy] = useState(false);
  const backdrop = usePrintEscape(onClose, busy);
  const preview = pages.find((page) => page.key === previewKey) ?? pages[0];
  const chosen = pages.filter((page) => selected.has(page.key));
  const alerts = chosen.map(({ floor, variant, label }) => ({
    floorId: floor.id, variantId: variant.id, label, issues: printIssues(floor, variant.id),
  }));
  const run = async (separate: boolean) => {
    const jobs = building.floors.flatMap<ExportJob>((floor) => {
      const variantIds = chosen.filter((page) => page.floor.id === floor.id).map((page) => page.variant.id);
      return variantIds.length ? [{ building, floor, variantIds, customSymbols, page: floor.page }] : [];
    });
    setBusy(true);
    try { await exportBuildingPdf(jobs, separate); } finally { setBusy(false); }
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
              </div>
            ))}
          </fieldset>
          <PrintReview alerts={alerts} onEdit={(alert, issue) => { if (!busy) onEdit(alert.floorId, alert.variantId, issue); }} />
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
