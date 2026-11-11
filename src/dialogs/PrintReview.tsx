import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PRINT_ISSUE_LABEL, PrintPage, type PrintIssue, type PrintPageProps } from '../render/PrintPage';
import { computeLayout } from '../render/layout';

export type EditPrintIssue = (floorId: string, variantId: string, issue: PrintIssue) => void;

export function usePrintEscape(onClose: () => void, busy: boolean) {
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy || !backdrop.current
        || [...document.querySelectorAll('.modal-backdrop')].at(-1) !== backdrop.current) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return backdrop;
}

export interface PageAlert {
  floorId: string;
  variantId: string;
  label: string;
  issues: PrintIssue[];
}

export function PrintReview({ alerts, onEdit }: { alerts: PageAlert[]; onEdit(alert: PageAlert, issue: PrintIssue): void }) {
  const flagged = alerts.filter((alert) => alert.issues.length);
  return (
    <section className="print-review" aria-label="Vérification avant export">
      <h3>Vérification avant export</h3>
      {!alerts.length && <p className="muted small">Sélectionnez les pages à vérifier.</p>}
      {!!alerts.length && !flagged.length && <p className="print-review-ok small">Aucun point à signaler sur les pages sélectionnées.</p>}
      {!!flagged.length && (
        <ul className="print-review-list">
          {flagged.map((alert) => (
            <li key={`${alert.floorId}:${alert.variantId}`}>
              <strong>{alert.label}</strong>
              {alert.issues.map((issue) => (
                <button key={issue} className="print-issue" onClick={() => onEdit(alert, issue)}>{PRINT_ISSUE_LABEL[issue]} <span aria-hidden="true">→</span></button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PrintPreviewPane(props: PrintPageProps) {
  const page = props.page ?? props.floor.page;
  const layout = computeLayout(props.floor, props.variantId, page);
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = areaRef.current!;
    const measure = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const ratio = layout.w / layout.h;
  const width = Math.floor(Math.min(area.w, area.h * ratio));
  const height = Math.floor(width / ratio);
  return (
    <div className="print-preview">
      <div className="preview-area" ref={areaRef}>
        {width > 0 && (
          <div className="preview-page" style={{ width, height }}>
            <PrintPage {...props} />
          </div>
        )}
      </div>
      <div className="preview-caption muted small">
        {page.paper} {page.orientation === 'landscape' ? 'paysage' : 'portrait'} · {layout.paperW}×{layout.paperH} mm
        {layout.scaleDenominator ? ` · échelle ${page.scaleMode === 'fixed' ? '' : '≈ '}1:${Math.round(layout.scaleDenominator)}` : ' · échelle ajustée à la page'}
      </div>
    </div>
  );
}
