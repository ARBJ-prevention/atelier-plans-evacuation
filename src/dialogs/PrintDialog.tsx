import { useState } from 'react';
import * as A from '../app/actions';
import { floorContentBounds } from '../model/geometry';
import type { PageSetup, PageTheme, PrintBlockPosition } from '../model/types';
import { PageScopeNote } from '../panels/PropertiesPanel';
import { ThemeThumb } from '../panels/Ribbon';
import { printIssues } from '../render/PrintPage';
import { planRotation } from '../render/orient';
import { FRAME_ZONES, frameOn, headerColorValue, normalizePage, normOn, preferredBlockPosition, PRINT_BLOCKS, PRINT_POSITIONS, THEMES, themePatch } from '../render/layout';
import { currentBuilding, currentFloor, currentVariantId, useStore } from '../store/store';
import { Icon } from '../ui/icons';
import { BuildingExport } from './BuildingExport';
import { PrintPreviewPane, PrintReview, usePrintEscape, type EditPrintIssue, type ReviewReturn } from './PrintReview';

export function PrintDialog({ onClose, onEdit, currentOnly = false, focusScale = false, back }: {
  onClose(): void; onEdit: EditPrintIssue; currentOnly?: boolean; focusScale?: boolean; back?: ReviewReturn | null;
}) {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => currentFloor(s))!;
  const building = useStore((s) => currentBuilding(s))!;
  const activeVariant = useStore((s) => currentVariantId(s));
  const [previewVariant, setPreviewVariant] = useState(activeVariant);
  /** Affiche montrée à côté pour comparer (vide : aperçu simple). */
  const [compareWith, setCompareWith] = useState('');
  const [scope, setScope] = useState<'current' | 'all'>(!currentOnly && floor.variants.length > 1 ? 'all' : 'current');
  const [dpi, setDpi] = useState(300);
  const [busy, setBusy] = useState('');
  const [batch, setBatch] = useState(back?.mode === 'building');
  const backdrop = usePrintEscape(onClose, !!busy);
  const page = floor.page;
  const positions = page.blockPositions?.[page.theme];

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

  const calibrated = floor.unitsPerMeter > 0;
  const ca = page.customArea;
  const selected = scope === 'all' ? floor.variants : floor.variants.filter((v) => v.id === previewVariant);
  const destination = selected.length === 1 ? selected[0].name : `${selected.length} affiches`;
  const alerts = selected.map((v) => ({ floorId: floor.id, variantId: v.id, label: v.name, issues: printIssues(floor, v.id, floor.page, building) }));
  const eff = normalizePage(floor, page, building);
  if (batch) return <BuildingExport building={building} customSymbols={project.customSymbols} onBack={() => setBatch(false)} onClose={onClose}
    initial={back?.mode === 'building' ? back : undefined}
    onEdit={(floorId, variantId, issue, ret) => { setBatch(false); onEdit(floorId, variantId, issue, ret); }} />;

  return (
    <div className="modal-backdrop" ref={backdrop}>
      <div className="print-dialog" role="dialog" aria-modal="true" aria-label="Aperçu avant impression">
        {compareWith && compareWith !== previewVariant && floor.variants.some((v) => v.id === compareWith) ? (
          <div className="compare-panes">
            <div className="compare-pane"><div className="compare-name">{floor.variants.find((v) => v.id === previewVariant)?.name}</div>
              <PrintPreviewPane building={building} floor={floor} variantId={previewVariant} customSymbols={project.customSymbols} uniqueKey="preview" /></div>
            <div className="compare-pane"><div className="compare-name">{floor.variants.find((v) => v.id === compareWith)?.name}</div>
              <PrintPreviewPane building={building} floor={floor} variantId={compareWith} customSymbols={project.customSymbols} uniqueKey="compare" /></div>
          </div>
        ) : (
          <PrintPreviewPane building={building} floor={floor} variantId={previewVariant} customSymbols={project.customSymbols} uniqueKey="preview" />
        )}

        <div className="print-settings">
          <h2>Aperçu et export</h2>
          <button className="btn small full" autoFocus={!focusScale} disabled={!!busy} onClick={() => setBatch(true)}><Icon name="building" size={15} /> Exporter le bâtiment</button>

          {floor.variants.length > 1 && (
            <>
              <h3>Affiche affichée</h3>
              <select aria-label="Affiche affichée" value={previewVariant} onChange={(e) => setPreviewVariant(e.target.value)}>
                {floor.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <div className="seg full">
                <button className={scope === 'current' ? 'on' : ''} onClick={() => setScope('current')}>Cette affiche</button>
                <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Toutes ({floor.variants.length})</button>
              </div>
              <label className="field inline compare-pick"><span>Comparer avec</span>
                <select value={compareWith} onChange={(e) => setCompareWith(e.target.value)} aria-label="Comparer avec une autre affiche">
                  <option value="">—</option>
                  {floor.variants.filter((v) => v.id !== previewVariant).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
              {compareWith && compareWith !== previewVariant && (() => {
                const ownA = floor.elements.filter((e) => e.variantId === previewVariant).length;
                const ownB = floor.elements.filter((e) => e.variantId === compareWith).length;
                const common = floor.elements.filter((e) => !e.variantId && !e.excludedVariantIds?.length).length;
                return <p className="muted tiny">{common} élément(s) communs · {ownA} propre(s) à gauche · {ownB} propre(s) à droite. Le reste est identique.</p>;
              })()}
            </>
          )}

          <PrintReview alerts={alerts} onEdit={(alert, issue) => {
            if (busy) return;
            if (issue === 'plan-clipped') {
              setPreviewVariant(alert.variantId);
              document.getElementById('print-scale-fit')?.focus();
            } else onEdit(alert.floorId, alert.variantId, issue, { mode: 'preview' });
          }} />
          <div className="print-actions">
            <button className="btn primary" disabled={!!busy} onClick={() => run('print', () => A.printAction(job()))}><Icon name="print" size={16} /> {busy === 'print' ? 'Préparation…' : 'Imprimer…'}</button>
            <button className="btn primary" disabled={!!busy} onClick={() => run('pdf', () => A.exportPdfAction(job()))}><Icon name="pdf" size={16} /> {busy === 'pdf' ? 'Export…' : `Exporter en PDF · ${destination}`}</button>
            <div className="row gap">
              <button className="btn" disabled={!!busy} onClick={() => run('png', () => A.exportPngAction(job(), dpi))}><Icon name="image" size={16} /> {busy === 'png' ? 'Export…' : 'Exporter en PNG'}</button>
              <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))} aria-label="Résolution PNG">
                <option value={150}>150 ppp</option><option value={300}>300 ppp</option><option value={600}>600 ppp</option>
              </select>
            </div>
            <button className="btn" disabled={!!busy} onClick={onClose}>Fermer</button>
          </div>

          <h2 className="layout-title" id="layout-settings">Mise en page</h2>
          <PageScopeNote />
          <h3>Thème</h3>
          <div className="theme-grid">
            {(Object.keys(THEMES) as PageTheme[]).map((t) => <ThemeThumb key={t} theme={t} accent={page.accentColor} active={page.theme === t} onClick={() => set(themePatch(t))} />)}
          </div>
          <div className="row gap layout-colors">
            <label className="field inline"><span>Accent</span><input type="color" value={page.accentColor} onChange={(e) => set({ accentColor: e.target.value })} /></label>
            <label className="field inline"><span>En-tête</span><input type="color" value={headerColorValue(page)} onChange={(e) => set({ headerColor: e.target.value })} title="Couleur de fond de l’en-tête" /></label>
            <button className="btn small" disabled={!page.headerColor} onClick={() => set({ headerColor: undefined })} title="Revenir à la couleur d’en-tête prévue par le thème">Couleur par défaut</button>
            <label className="field inline"><span>Fond du plan</span><input type="color" value={page.planBackground || '#ffffff'} onChange={(e) => set({ planBackground: e.target.value })} /></label>
          </div>

          <h3>Norme</h3>
          <label className="check" title="Applique automatiquement la fiche pratique « Réalisation d’un plan d’évacuation » (NBN ISO 23601:2021)">
            <input type="checkbox" checked={normOn(page)} onChange={(e) => set({ norm: e.target.checked })} /> Appliquer la norme ISO 23601 (fiche pratique)
          </label>
          {normOn(page) && <>
            <label className="check" title="Seuls les plans affichés dans une chambre individuelle peuvent être réduits au format A4">
              <input type="checkbox" checked={!!page.smallRoom} onChange={(e) => set({ smallRoom: e.target.checked })} /> Plan pour une chambre individuelle (A4 admis)
            </label>
            <label className="field inline" title="Le mur sur lequel le plan est fixé doit se trouver en haut du repère « Vous êtes ici »"><span>Orientation du plan</span>
              <select value={String(page.planRotation ?? 'auto')} onChange={(e) => set({ planRotation: e.target.value === 'auto' ? 'auto' : Number(e.target.value) as 0 | 90 | 180 | 270 })}>
                <option value="auto">Auto : mur d’affichage en haut{page.area !== 'custom' ? ` (${planRotation(floor, previewVariant, eff)}°)` : ''}</option>
                <option value="0">Comme le dessin</option><option value="90">Quart de tour à droite</option>
                <option value="180">Demi-tour</option><option value="270">Quart de tour à gauche</option>
              </select>
            </label>
            {page.area === 'custom' && <p className="muted tiny">Zone imprimée personnalisée : le plan n’est pas tourné.</p>}
            <p className="muted tiny">
              Appliqué automatiquement : {eff.paper}{eff.paper !== page.paper ? ` (au lieu de ${page.paper})` : ''}
              {eff.orientation !== page.orientation ? ` ${eff.orientation === 'portrait' ? 'portrait' : 'paysage'}` : ''}
              {eff.scaleMode === 'fixed' && calibrated ? ` · échelle 1:${eff.scale}${page.scaleMode === 'fit' ? ' (choisie pour tout le bâtiment)' : ''}` : ''}
              {' '}· titre ≥ {({ A4: 13, A3: 13, A2: 18, A1: 26, A0: 36 } as Record<string, number>)[eff.paper]} mm · murs porteurs noirs ≥ 1,6 mm, cloisons ≥ 0,6 mm · pictogrammes ≥ 7 mm · fond blanc · voies d’évacuation en zone verte et flèches vert foncé · escaliers des voies en vert foncé · mobilier et obstacles en gris clair · bâtiment en couleur sur la vue d’ensemble · date, n° et version du plan en bas.
            </p>
          </>}
          <h3>Papier</h3>
          <div className="seg full">
            {(['A4', 'A3', 'A2', 'A1', 'A0'] as const).map((p) => <button key={p} className={page.paper === p ? 'on' : ''} onClick={() => set({ paper: p })}>{p}</button>)}
          </div>
          <div className="seg full">
            <button className={page.orientation === 'portrait' ? 'on' : ''} onClick={() => set({ orientation: 'portrait' })}>Portrait</button>
            <button className={page.orientation === 'landscape' ? 'on' : ''} onClick={() => set({ orientation: 'landscape' })}>Paysage</button>
          </div>
          <label className="field inline"><span>Marges (mm)</span>
            <input type="number" min={0} max={40} value={page.marginMm} onChange={(e) => set({ marginMm: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} />
          </label>
          <h3>Placement des blocs</h3>
          <p className="muted tiny">Déplace les blocs autour du plan pour ajuster la place disponible. Les choix sont mémorisés pour ce thème.</p>
          {!THEMES[page.theme]?.blockPosition && (
            <label className="field inline"><span>Disposition générale</span>
              <select value={page.sidePosition} onChange={(e) => set({ sidePosition: e.target.value as PageSetup['sidePosition'] })}>
                <option value="right">À droite</option><option value="left">À gauche</option><option value="bottom">En bas</option>
              </select>
            </label>
          )}
          {PRINT_BLOCKS.filter(([, , flag]) => page[flag]).map(([key, label]) => {
            const fallback = key === 'numbers' ? 'Automatique' : PRINT_POSITIONS.find(([pos]) => pos === preferredBlockPosition(page))?.[1];
            return (
              <label className="field inline" key={key}><span>{label}</span>
                <select value={positions?.[key] ?? ''} onChange={(e) => {
                  const next = { ...positions };
                  const value = e.target.value as PrintBlockPosition | '';
                  if (value) next[key] = value;
                  else delete next[key];
                  set({ blockPositions: { ...page.blockPositions, [page.theme]: next } });
                }}>
                  <option value="">{key === 'numbers' ? fallback : `Par défaut · ${fallback}`}</option>
                  {PRINT_POSITIONS.map(([position, name]) => <option key={position} value={position}>{name}</option>)}
                </select>
              </label>
            );
          })}
          <label className="check" title="Quand le plan laisse de grands vides sur la page, des blocs passent à côté de lui pour qu’il soit dessiné plus grand.">
            <input type="checkbox" checked={page.fillSpace !== false} onChange={(e) => set({ fillSpace: e.target.checked })} /> Agrandir le plan : placer des blocs dans l’espace libre
          </label>
          <label className="check" title="Quand seul le plan est affiché, la feuille est recoupée à sa forme : le blanc en haut et en bas disparaît. Utile pour un export PDF ou image ; à l’impression, le plan garde la même taille.">
            <input type="checkbox" checked={!!page.cropToPlan} onChange={(e) => set({ cropToPlan: e.target.checked })} /> Rogner la feuille au plan (supprimer le blanc)
          </label>
          {Object.values(positions ?? {}).some(Boolean) && (
            <button className="btn small full" onClick={() => set({ blockPositions: { ...page.blockPositions, [page.theme]: {} } })}>
              Rétablir les placements du thème
            </button>
          )}

          <h3>Échelle</h3>
          <div className="seg full">
            <button id="print-scale-fit" autoFocus={focusScale} className={page.scaleMode === 'fit' ? 'on' : ''} onClick={() => set({ scaleMode: 'fit' })}>Ajuster à la page</button>
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
          {([['showTitleBlock', 'En-tête'], ['showFooter', 'Cartouche (auteur, date, version)'], ['showLegend', 'Légende'], ['showInstructions', 'Consignes'],
            ['showEmergencyNumbers', 'Numéros d’urgence'], ['showAerial', 'Vue aérienne du site'], ['showSketch', 'Croquis de situation'], ['showScaleBar', 'Barre d’échelle'],
            ['showNorth', 'Flèche du nord'], ['showWatermark', 'Filigrane « Brouillon / À valider »'], ['showFrame', 'Cadre de page (thèmes encadrés)']] as const).map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={!!page[k]} onChange={(e) => set({ [k]: e.target.checked } as any)} /> {label}</label>
          ))}
          {page.showNorth && (
            <label className="field inline"><span>Angle du nord (°)</span>
              <input type="number" min={-360} max={360} value={page.northAngle} onChange={(e) => set({ northAngle: Number(e.target.value) || 0 })} />
            </label>
          )}

          <h3>Cadres</h3>
          {FRAME_ZONES.map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={frameOn(page, k)} onChange={(e) => set({ frames: { ...page.frames, [k]: e.target.checked } })} /> {label}</label>
          ))}
          {page.frames && Object.keys(page.frames).length > 0 && (
            <button className="btn small" onClick={() => set({ frames: undefined })}>Revenir aux cadres du thème</button>
          )}


        </div>
      </div>
    </div>
  );
}
