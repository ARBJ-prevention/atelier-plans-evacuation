/**
 * Assistant d'import d'un plan : fichier → étage de destination → page (PDF) → préparation du fond → échelle.
 * Une seule fenêtre à étapes numérotées ; les plans DXF / DWG poursuivent ensuite avec leurs propres fenêtres
 * (calques, unités, reconnaissance), déjà existantes.
 */
import { useEffect, useState } from 'react';
import type { PickedFile } from '../services/api';
import { renderPdfPage } from '../services/imports';
import { ask } from '../ui/dialogs';
import { Icon } from '../ui/icons';

export interface ImportFloorOption { buildingId: string; buildingName: string; floorId: string; floorName: string; hasBackground: boolean; empty: boolean }

export interface ImportChoice {
  target: { kind: 'current'; floorName: string } | { kind: 'new'; buildingId: string; floorName: string };
  page: number;
  opacity: number;
  grayscale: boolean;
  calibrate: boolean;
}

const KIND_LABEL: Record<string, string> = {
  pdf: 'PDF', dxf: 'DXF (AutoCAD, vectoriel)', dwg: 'DWG (AutoCAD, converti par ODA File Converter)',
  png: 'image PNG', jpg: 'image JPEG', jpeg: 'image JPEG', gif: 'image GIF', webp: 'image WebP', bmp: 'image BMP', svg: 'image SVG',
};

/** Nombre maximal de vignettes de pages affichées. */
const MAX_THUMBS = 30;

export async function askImportPlan(file: PickedFile, pageCount: number, current: ImportFloorOption, buildings: { id: string; name: string; floors: number }[]): Promise<ImportChoice | null> {
  const vector = file.ext === 'dxf' || file.ext === 'dwg';
  const startNew = current.hasBackground || !current.empty;
  const curBuilding = buildings.find((b) => b.id === current.buildingId) ?? buildings[0];
  const r = await ask({
    title: 'Importer un plan',
    wide: true,
    large: pageCount > 1,
    initial: {
      target: startNew ? 'new' : 'current',
      currentName: current.floorName,
      newName: `Niveau ${curBuilding?.floors ?? 1}`,
      buildingId: current.buildingId,
      page: 1,
      opacity: 0.45,
      grayscale: true,
      calibrate: true,
    },
    invalid: (v) => (String(v.target === 'new' ? v.newName : v.currentName).trim() ? null : 'Nom d’étage manquant'),
    render: (v, set) => <WizardBody file={file} vector={vector} pageCount={pageCount} current={current} buildings={buildings} v={v} set={set} />,
    buttons: [{ label: 'Annuler', value: 'cancel' }, { label: vector ? 'Continuer' : 'Importer', value: 'ok', primary: true }],
  });
  if (r.button !== 'ok') return null;
  const v = r.values;
  return {
    target: v.target === 'new'
      ? { kind: 'new', buildingId: v.buildingId, floorName: String(v.newName).trim() }
      : { kind: 'current', floorName: String(v.currentName).trim() },
    page: Math.min(pageCount, Math.max(1, Number(v.page) || 1)),
    opacity: Number(v.opacity),
    grayscale: !!v.grayscale,
    calibrate: !!v.calibrate,
  };
}

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className="wiz-step">
      <div className={done ? 'wiz-num done' : 'wiz-num'}>{done ? <Icon name="check" size={13} /> : n}</div>
      <div className="wiz-body">
        <h3>{title}</h3>
        {children}
      </div>
    </section>
  );
}

function WizardBody({ file, vector, pageCount, current, buildings, v, set }: {
  file: PickedFile; vector: boolean; pageCount: number; current: ImportFloorOption;
  buildings: { id: string; name: string; floors: number }[]; v: Record<string, any>; set(p: Record<string, any>): void;
}) {
  const thumbs = usePdfThumbs(file, pageCount);
  const preview = file.ext === 'pdf' ? thumbs[v.page - 1] : rasterPreview(file);
  let n = 1;
  return (
    <div className="wizard">
      <Step n={n++} title="Fichier" done>
        <p className="small"><b>{file.name}</b> · {KIND_LABEL[file.ext] ?? file.ext.toUpperCase()}{pageCount > 1 ? ` · ${pageCount} pages` : ''}</p>
      </Step>

      <Step n={n++} title="Étage de destination">
        <label className="wiz-choice">
          <input type="radio" name="wiz-target" checked={v.target === 'current'} onChange={() => set({ target: 'current' })} />
          <span>Étage actif <b>« {current.floorName} »</b> ({current.buildingName})
            {current.hasBackground && <em className="wiz-warn"> · son plan de fond actuel sera remplacé</em>}</span>
        </label>
        {v.target === 'current' && (
          <label className="field inline wiz-indent"><span>Nom de l’étage</span>
            <input type="text" value={v.currentName} onChange={(e) => set({ currentName: e.target.value })} />
          </label>
        )}
        <label className="wiz-choice">
          <input type="radio" name="wiz-target" checked={v.target === 'new'} onChange={() => set({ target: 'new' })} />
          <span>Nouvel étage</span>
        </label>
        {v.target === 'new' && (
          <div className="row gap wiz-indent">
            <label className="field inline"><span>Nom</span>
              <input type="text" value={v.newName} onChange={(e) => set({ newName: e.target.value })} list="wiz-floor-names" />
              <datalist id="wiz-floor-names">
                {['Sous-sol', 'Rez-de-chaussée', '1er étage', '2e étage', 'Niveau -1', 'Niveau 0', 'Niveau 1', 'Niveau 2'].map((x) => <option key={x} value={x} />)}
              </datalist>
            </label>
            {buildings.length > 1 && (
              <label className="field inline"><span>Bâtiment</span>
                <select value={v.buildingId} onChange={(e) => set({ buildingId: e.target.value })}>
                  {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
      </Step>

      {pageCount > 1 && (
        <Step n={n++} title={`Page du PDF (${v.page} sur ${pageCount})`}>
          <div className="wiz-pages" role="listbox" aria-label="Pages du PDF">
            {Array.from({ length: Math.min(pageCount, MAX_THUMBS) }, (_, i) => (
              <button type="button" key={i} role="option" aria-selected={v.page === i + 1} className={v.page === i + 1 ? 'wiz-page on' : 'wiz-page'} onClick={() => set({ page: i + 1 })}>
                {thumbs[i] ? <img src={thumbs[i]} alt="" /> : <span className="wiz-loading">…</span>}
                <small>Page {i + 1}</small>
              </button>
            ))}
          </div>
          {pageCount > MAX_THUMBS && (
            <label className="field inline"><span>Autre page</span>
              <input type="number" min={1} max={pageCount} value={v.page} onChange={(e) => set({ page: Math.min(pageCount, Math.max(1, Number(e.target.value) || 1)) })} />
            </label>
          )}
        </Step>
      )}

      {vector ? (
        <Step n={n++} title="Calques, unité et reconnaissance">
          <p className="small">La fenêtre suivante permet de choisir les calques à garder et l’unité du dessin. Le plan est importé <b>à l’échelle réelle</b> : aucun étalonnage n’est nécessaire. Le logiciel peut ensuite redessiner murs, portes, fenêtres, escaliers et pièces.</p>
        </Step>
      ) : (
        <>
          <Step n={n++} title="Préparer le fond">
            <div className="wiz-prep">
              <div className="wiz-preview">
                {preview
                  ? <img src={preview} alt="Aperçu du fond" style={{ opacity: v.opacity, filter: v.grayscale ? 'grayscale(1) contrast(1.05)' : 'none' }} />
                  : <span className="muted small">Aperçu en préparation…</span>}
              </div>
              <div className="wiz-prep-ctl">
                <label className="check"><input type="checkbox" checked={v.grayscale} onChange={(e) => set({ grayscale: e.target.checked })} /> Niveaux de gris</label>
                <label className="field"><span>Opacité · {Math.round(v.opacity * 100)} %</span>
                  <input type="range" min={0.1} max={1} step={0.05} value={v.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
                </label>
                <p className="muted tiny">Un fond gris et atténué laisse ressortir les itinéraires et les pictogrammes. Ces réglages restent modifiables dans <i>Propriétés › Fond</i>.</p>
              </div>
            </div>
          </Step>
          <Step n={n++} title="Échelle">
            <label className="check"><input type="checkbox" checked={v.calibrate} onChange={(e) => set({ calibrate: e.target.checked })} /> Étalonner juste après l’import</label>
            <p className="muted tiny">Cliquez deux points d’une cote connue (largeur d’une porte, longueur d’un mur coté) et saisissez la distance réelle : règles, surfaces, échelle fixe et largeurs en cm deviennent disponibles.</p>
          </Step>
        </>
      )}
    </div>
  );
}

/** Vignettes des pages d'un PDF, rendues une à une (les premières s'affichent sans attendre les suivantes). */
function usePdfThumbs(file: PickedFile, pageCount: number): string[] {
  const [thumbs, setThumbs] = useState<string[]>([]);
  useEffect(() => {
    if (file.ext !== 'pdf') return;
    let alive = true;
    (async () => {
      for (let i = 1; i <= Math.min(pageCount, MAX_THUMBS) && alive; i++) {
        try {
          const img = await renderPdfPage(file.data, i, 420);
          if (alive) setThumbs((t) => { const n = [...t]; n[i - 1] = img.src; return n; });
        } catch { /* page illisible : vignette vide */ }
      }
    })();
    return () => { alive = false; };
  }, [file, pageCount]);
  return thumbs;
}

const rasterCache = new WeakMap<PickedFile, string>();
function rasterPreview(file: PickedFile): string {
  let src = rasterCache.get(file);
  if (!src) {
    const mime = file.ext === 'svg' ? 'image/svg+xml' : file.ext === 'jpg' ? 'image/jpeg' : `image/${file.ext}`;
    src = URL.createObjectURL(new Blob([file.data as BlobPart], { type: mime }));
    rasterCache.set(file, src);
  }
  return src;
}
