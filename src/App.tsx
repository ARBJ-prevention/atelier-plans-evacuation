import { useEffect, useMemo, useState } from 'react';
import * as A from './app/actions';
import { buildReviewDemo, SAMPLES } from './app/sample';
import { PrintDialog } from './dialogs/PrintDialog';
import { Canvas } from './editor/Canvas';
import { isVisibleInVariant } from './model/geometry';
import { LayersPanel } from './panels/LayersPanel';
import { LibraryPanel } from './panels/LibraryPanel';
import { ProjectPanel } from './panels/ProjectPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { Ribbon, TOOL_KEYS } from './panels/Ribbon';
import type { ReviewReturn } from './dialogs/PrintReview';
import { PRINT_ISSUE_LABEL, PrintPage, STATUS_LABEL, type PrintIssue } from './render/PrintPage';
import { api } from './services/api';
import { currentBuilding, currentFloor, currentVariantId, useStore } from './store/store';
import { alertDialog, ask, DialogHost } from './ui/dialogs';

/** Fenêtre « quitter sans enregistrer ? » déjà affichée (clics répétés sur la croix). */
let closeAsked = false;
import { Icon } from './ui/icons';

const AUTOSAVE_MS = 30_000;
const PANELS_KEY = 'evac.panels';

/** Panneaux gauche et droit repliés ou non (préférence du poste ; repli sans stockage disponible). */
function loadPanels(): { left: boolean; right: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}');
    return { left: v.left !== false, right: v.right !== false };
  } catch { return { left: true, right: true }; }
}

export function App() {
  const project = useStore((s) => s.project);
  const [leftTab, setLeftTab] = useState<'project' | 'library' | 'layers'>('library');
  const [panels, setPanels] = useState(loadPanels);
  useEffect(() => { try { localStorage.setItem(PANELS_KEY, JSON.stringify(panels)); } catch { /* stockage indisponible */ } }, [panels]);
  const showLeft = (tab?: 'project' | 'library' | 'layers') => { setPanels((p) => ({ ...p, left: true })); if (tab) setLeftTab(tab); };
  const [printOpen, setPrintOpen] = useState<'' | 'preview' | 'current' | 'scale'>('');
  const [focusInstructions, setFocusInstructions] = useState(0);
  /** Correction d'alerte en cours : de quoi rouvrir la vérification là où on l'a quittée. */
  const [review, setReview] = useState<{ back: ReviewReturn; issue: PrintIssue; label: string } | null>(null);
  const [reviewBack, setReviewBack] = useState<ReviewReturn | null>(null);
  const [help, setHelp] = useState<'' | 'guide' | 'shortcuts' | 'about'>('');
  const [version, setVersion] = useState('');

  // ——— Démarrage : récupération, fichier passé en argument ———
  useEffect(() => {
    (async () => {
      const info = await api().info();
      setVersion(info.version);
      if (info.selftest) {
        const { runSelfTest } = await import('./selftest');
        await runSelfTest(info.selftestOut);
        return;
      }
      await A.checkRecovery();
      await A.checkForUpdates(false);
      if (info.pendingOpenFile && !useStore.getState().project) await A.openProjectAction(info.pendingOpenFile);
    })();
    return api().onOpenFile((p) => A.openProjectAction(p));
  }, []);

  useEffect(() => {
    const h = () => showLeft('library');
    window.addEventListener('evac:show-library', h);
    return () => window.removeEventListener('evac:show-library', h);
  }, []);

  // ——— Sauvegarde automatique ———
  useEffect(() => {
    const t = setInterval(() => { A.autosaveNow().catch(() => useStore.getState().toast('Sauvegarde automatique impossible.', 'error')); }, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, []);

  // ——— Titre de fenêtre et état « modifié » ———
  const dirty = useStore((s) => s.dirty);
  const filePath = useStore((s) => s.filePath);
  useEffect(() => {
    const name = project ? `${project.name}${dirty ? ' •' : ''} — ` : '';
    api().setTitle(`${name}Atelier Plans d'Évacuation`);
    api().setDirty(!!project && dirty);
  }, [project?.name, dirty, filePath, project]);

  // ——— Menu de l'application ———
  useEffect(() => api().onMenu((action, arg) => runCommand(action, arg)), []);
  useEffect(() => {
    const h = (e: Event) => { const { action, arg } = (e as CustomEvent<{ action: string; arg?: string }>).detail; runCommand(action, arg); };
    window.addEventListener('evac:command', h);
    return () => window.removeEventListener('evac:command', h);
  }, []);

  const runCommand = async (action: string, arg?: string) => {
    const s = useStore.getState();
    const has = !!s.project;
    if (document.querySelector('.modal-backdrop') && action !== 'save-and-close' && action !== 'discard-and-close' && action !== 'confirm-close') return;
    switch (action) {
      case 'new': return A.newProjectAction();
      case 'new-from-plan': {
        // Créer un bâtiment depuis un plan : nouveau projet, puis assistant d'import sur son premier étage
        const prev = s.project;
        await A.newProjectAction();
        const now = useStore.getState().project;
        if (now && now !== prev) await A.importBackgroundAction();
        return;
      }
      case 'layout-settings': {
        if (!has) return;
        setPrintOpen('preview');
        setTimeout(() => document.getElementById('layout-settings')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250);
        return;
      }
      case 'open': return A.openProjectAction();
      case 'open-recent': return A.openProjectAction(arg);
      case 'save': return has && A.saveProject(false);
      case 'save-as': return has && A.saveProject(true);
      case 'duplicate-project': return has && A.duplicateProjectAction();
      case 'import-background': return has && A.importBackgroundAction();
      case 'import-symbol': return has && A.importSymbolAction();
      case 'print-preview': return has && setPrintOpen('preview');
      case 'export-pdf': case 'export-png': return has && setPrintOpen('current');
      case 'export-dxf': return has && A.exportCadAction('dxf');
      case 'export-dwg': return has && A.exportCadAction('dwg');
      case 'export-svg': return has && A.exportCadAction('svg');
      case 'export-building': {
        const b = currentBuilding(s);
        if (!b) return;
        const keys = b.floors.flatMap((f) => f.variants.map((v) => `${f.id}:${v.id}`));
        setReviewBack({ mode: 'building', selected: keys, previewKey: `${s.floorId}:${currentVariantId(s)}` });
        return setPrintOpen('preview');
      }
      case 'undo': return s.undo();
      case 'redo': return s.redo();
      case 'cut': return s.cutSelection();
      case 'copy': return s.copySelection();
      case 'paste': return s.paste();
      case 'duplicate': return s.duplicateSelection();
      case 'delete': return s.deleteSelection();
      case 'select-all': {
        const f = currentFloor(s);
        if (!f) return;
        const vid = currentVariantId(s);
        const locked = new Set(f.layers.filter((l) => l.locked || !l.visible).map((l) => l.id));
        return s.select(f.elements.filter((e) => !locked.has(e.layer) && isVisibleInVariant(e, vid)).map((e) => e.id));
      }
      case 'group': return s.groupSelection();
      case 'ungroup': return s.ungroupSelection();
      case 'zoom-in': case 'zoom-out': {
        const k = action === 'zoom-in' ? 1.25 : 0.8;
        const el = document.querySelector('.canvas-wrap');
        const cx = (el?.clientWidth ?? 800) / 2, cy = (el?.clientHeight ?? 600) / 2;
        const z = Math.min(40, Math.max(0.002, s.view.zoom * k)), f = z / s.view.zoom;
        return s.setView({ zoom: z, x: cx - (cx - s.view.x) * f, y: cy - (cy - s.view.y) * f });
      }
      case 'zoom-fit': return s.requestFit();
      case 'toggle-grid': return s.setGrid({ show: !s.grid.show });
      case 'toggle-snap': return s.setGrid({ snap: !s.grid.snap });
      case 'toggle-guides': return s.toggleGuides();
      case 'help': return setHelp('guide');
      case 'shortcuts': return setHelp('shortcuts');
      case 'about': return setHelp('about');
      case 'check-updates': return A.checkForUpdates(true);
      case 'update-dir': return A.chooseUpdateDirAction();
      case 'confirm-close': {
        if (closeAsked) return;
        closeAsked = true;
        try {
          const name = s.project?.name || 'Projet sans nom';
          const r = await ask({
            title: 'Quitter Atelier Plans d’Évacuation ?',
            message: (
              <div className="close-confirm">
                <div className="close-confirm-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 3h11l3 3v15H5z" /><path d="M8 3v5h7V3" /><rect x="8" y="13" width="8" height="5" rx="1" />
                  </svg>
                </div>
                <div>
                  <p><strong>« {name} »</strong> contient des modifications non enregistrées.</p>
                  <p className="close-confirm-sub">Enregistrez-les pour ne rien perdre, ou quittez sans les garder.</p>
                </div>
              </div>
            ),
            buttons: [
              { label: 'Annuler', value: 'cancel', back: true },
              { label: 'Ne pas enregistrer', value: 'discard', danger: true },
              { label: 'Enregistrer et quitter', value: 'save', primary: true },
            ],
          });
          if (r.button === 'save') return runCommand('save-and-close');
          if (r.button === 'discard') return runCommand('discard-and-close');
        } finally { closeAsked = false; }
        return;
      }
      case 'save-and-close': {
        if (await A.saveProject(false)) api().forceClose();
        return;
      }
      case 'discard-and-close': {
        if (s.project) await api().autosaveClear(s.project.id);
        api().forceClose();
        return;
      }
    }
  };

  const editPrintIssue = (floorId: string, variantId: string, issue: PrintIssue, back?: ReviewReturn) => {
    const s = useStore.getState();
    const building = s.project?.buildings.find((b) => b.floors.some((f) => f.id === floorId));
    const floor = building?.floors.find((f) => f.id === floorId);
    if (!building || !floor) return;
    if (issue !== 'plan-clipped' && back) {
      const v = floor.variants.find((x) => x.id === variantId);
      setReview({ back, issue, label: `${floor.name} · ${v?.name ?? ''}` });
    }
    if (s.floorId !== floorId) s.setFloor(building.id, floorId);
    s.setVariant(variantId);
    s.setTool('select');
    setPrintOpen(issue === 'plan-clipped' ? 'scale' : '');
    if (issue === 'route-missing') {
      s.select([]);
      s.setTool('route');
      s.toast('Cliquez les points de passage de l’itinéraire ; double-clic pour terminer.', 'info');
    } else if (issue === 'exit-missing') {
      s.select([]);
      showLeft('library');
      s.toast('Posez un pictogramme « Sortie de secours » (E001, E002…) ou cochez « Issue de secours » sur une porte.', 'info');
    } else if (issue === 'numbers-missing' || issue === 'not-validated') {
      s.select([]);
      setFocusField(issue === 'numbers-missing' ? 'floor-numbers' : 'floor-status');
    } else if (issue === 'instructions-clipped') {
      setFocusInstructions((value) => value + 1);
    } else if (issue.startsWith('iso-')) {
      // Consignes de la fiche pratique (ISO 23601) : indication de ce qu'il reste à faire.
      s.select([]);
      if (issue === 'iso-scale' || issue === 'iso-uncalibrated') setPrintOpen('scale');
      s.toast(PRINT_ISSUE_LABEL[issue] + (issue === 'iso-rooms' || issue === 'iso-plan-number' ? ' (panneau Propriétés, sans sélection).' : '.'), 'info');
    } else if (issue !== 'plan-clipped') {
      const markers = floor.elements.filter((e) => e.type === 'symbol' && e.symbolId === 'you-are-here' && isVisibleInVariant(e, variantId));
      if (!markers.length) s.setTool('symbol', 'you-are-here');
      else {
        s.select(markers.map((e) => e.id));
        s.requestFit();
        if (issue === 'marker-missing') {
          showLeft('layers');
          s.toast('Vérifiez la visibilité du calque, l’opacité du repère et la zone imprimée.', 'info');
        }
      }
    }
  };
  const [focusField, setFocusField] = useState('');
  useEffect(() => {
    if (!focusField) return;
    const t = setTimeout(() => {
      const el = document.getElementById(focusField);
      el?.scrollIntoView({ block: 'center' });
      (el?.querySelector('input, button, textarea') as HTMLElement | null ?? el)?.focus();
      setFocusField('');
    }, 60);
    return () => clearTimeout(t);
  }, [focusField]);
  useEffect(() => {
    if (!focusInstructions) return;
    const input = document.getElementById('floor-instructions');
    input?.scrollIntoView({ block: 'nearest' });
    input?.focus();
  }, [focusInstructions]);

  // ——— Raccourcis clavier ———
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (document.querySelector('.modal-backdrop')) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey) {
        const map: Record<string, string> = {
          n: 'new', o: 'open', s: e.shiftKey ? 'save-as' : 'save', p: 'print-preview', e: 'export-pdf', '0': 'zoom-fit',
          '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out',
        };
        const editMap: Record<string, string> = {
          z: e.shiftKey ? 'redo' : 'undo', y: 'redo', c: 'copy', x: 'cut', v: 'paste', d: 'duplicate', a: 'select-all', g: e.shiftKey ? 'ungroup' : 'group',
        };
        if (map[k]) { e.preventDefault(); runCommand(map[k]); return; }
        if (k === 'b' && useStore.getState().project) {
          // Ctrl+B : replier / déplier le panneau gauche ; Ctrl+Maj+B : le panneau des propriétés
          e.preventDefault();
          setPanels((p) => (e.shiftKey ? { ...p, right: !p.right } : { ...p, left: !p.left }));
          return;
        }
        if (editMap[k] && !typing) { e.preventDefault(); runCommand(editMap[k]); return; }
        const st = useStore.getState();
        if (!typing && st.project && st.selection.length) {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); st.rotateSelection(e.key === 'ArrowLeft' ? -90 : 90); return; }
          if (k === 'l') { e.preventDefault(); st.toggleLockSelection(); return; }
        }
        return;
      }
      if (typing || !useStore.getState().project) return;
      const s = useStore.getState();
      if (e.key === 'Delete' || (e.key === 'Backspace' && s.tool === 'select')) { e.preventDefault(); s.deleteSelection(); return; }
      if ((e.key === 'F2' || (e.key === 'Enter' && s.tool === 'select')) && s.selection.length === 1) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('evac:inline-edit', { detail: s.selection[0] }));
        return;
      }
      if ((e.key === 'PageUp' || e.key === 'PageDown') && s.selection.length) {
        e.preventDefault();
        const up = e.key === 'PageUp';
        s.reorderSelection(e.ctrlKey || e.metaKey ? (up ? 'forward' : 'backward') : (up ? 'front' : 'back'));
        return;
      }
      if (e.key.startsWith('Arrow') && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? s.grid.size * 5 : s.grid.size / (e.altKey ? 10 : 1);
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]!;
        s.nudgeSelection(d[0], d[1]);
        return;
      }
      if (!e.altKey && TOOL_KEYS[k] && e.key.length === 1) s.setTool(TOOL_KEYS[k]);
      if (k === 'f1') { e.preventDefault(); setHelp('guide'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!project) {
    return (
      <>
        <Welcome version={version} onHelp={() => setHelp('guide')} onDemo={() => {
          useStore.getState().loadProject(buildReviewDemo(), null);
          setPrintOpen('preview');
        }} />
        {help && <HelpDialog kind={help} onClose={() => setHelp('')} version={version} />}
        <DialogHost />
        <Toasts />
      </>
    );
  }

  return (
    <div className="app">
      <Ribbon onPrintPreview={() => setPrintOpen('preview')} onQuickExport={() => setPrintOpen('current')} />
      <div className={`main${panels.left ? '' : ' no-left'}${panels.right ? '' : ' no-right'}`}>
        {!panels.left && (
          <nav className="rail left-rail" aria-label="Panneau gauche replié">
            <button title="Déplier le panneau (Ctrl+B)" aria-label="Déplier le panneau gauche" onClick={() => showLeft()}><Icon name="panelLeft" size={17} /></button>
            <button title="Projet" onClick={() => showLeft('project')}><Icon name="building" size={17} /></button>
            <button title="Symboles" onClick={() => showLeft('library')}><Icon name="symbol" size={17} /></button>
            <button title="Calques" onClick={() => showLeft('layers')}><Icon name="layers" size={17} /></button>
          </nav>
        )}
        {panels.left && <nav className="left">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={leftTab === 'project'} className={leftTab === 'project' ? 'on' : ''} onClick={() => setLeftTab('project')}><Icon name="building" size={16} /> Projet</button>
            <button role="tab" aria-selected={leftTab === 'library'} className={leftTab === 'library' ? 'on' : ''} onClick={() => setLeftTab('library')}><Icon name="symbol" size={16} /> Symboles</button>
            <button role="tab" aria-selected={leftTab === 'layers'} className={leftTab === 'layers' ? 'on' : ''} onClick={() => setLeftTab('layers')}><Icon name="layers" size={16} /> Calques</button>
            <button className="panel-fold" title="Replier le panneau (Ctrl+B)" aria-label="Replier le panneau gauche" onClick={() => setPanels((p) => ({ ...p, left: false }))}><Icon name="panelLeft" size={15} /></button>
          </div>
          {leftTab === 'project' && <ProjectPanel />}
          {leftTab === 'library' && <LibraryPanel />}
          {leftTab === 'layers' && <LayersPanel />}
        </nav>}
        <main className="center">
          <FloorBar />
          {review && (
            <div className="review-return" role="status">
              <Icon name="print" size={15} />
              <span>Correction en cours · <b>{review.label}</b> : {PRINT_ISSUE_LABEL[review.issue]}</span>
              <button className="btn small primary" onClick={() => { setReviewBack(review.back); setReview(null); setPrintOpen('preview'); }}>
                ← Revenir à la vérification
              </button>
              <button className="icon-btn" title="Masquer" aria-label="Masquer" onClick={() => setReview(null)}><Icon name="close" size={14} /></button>
            </div>
          )}
          <Canvas onCalibrate={(d) => A.calibrateAction(d)} />
        </main>
        {panels.right
          ? <div className="props-wrap">
              <button className="panel-fold right" title="Replier les propriétés (Ctrl+Maj+B)" aria-label="Replier le panneau des propriétés" onClick={() => setPanels((p) => ({ ...p, right: false }))}><Icon name="panelRight" size={15} /></button>
              <PropertiesPanel key={focusInstructions} />
            </div>
          : <nav className="rail right-rail" aria-label="Propriétés repliées">
              <button title="Déplier les propriétés (Ctrl+Maj+B)" aria-label="Déplier le panneau des propriétés" onClick={() => setPanels((p) => ({ ...p, right: true }))}><Icon name="panelRight" size={17} /></button>
            </nav>}
      </div>
      <StatusBar />
      {printOpen && <PrintDialog key={`${printOpen}:${project.id}`} currentOnly={printOpen !== 'preview'} focusScale={printOpen === 'scale'}
        back={reviewBack} onEdit={editPrintIssue} onClose={() => { setPrintOpen(''); setReviewBack(null); }} />}
      {help && <HelpDialog kind={help} onClose={() => setHelp('')} version={version} />}
      <DialogHost />
      <Toasts />
    </div>
  );
}

function FloorBar() {
  const building = useStore((s) => currentBuilding(s));
  const floor = useStore((s) => currentFloor(s));
  const variantId = useStore((s) => currentVariantId(s));
  if (!building || !floor) return null;
  return (
    <div className="floorbar">
      <span className="crumb"><Icon name="building" size={15} /> {building.name}</span>
      <span className="sep">›</span>
      <span className="crumb"><Icon name="floor" size={15} /> {floor.name}</span>
      <span className="sep">›</span>
      <label className="crumb">Affiche
        <select value={variantId} onChange={(e) => useStore.getState().setVariant(e.target.value)}>
          {floor.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <button className="btn small" onClick={() => A.createDisplayLocation()} title="Nouvelle affiche (emplacement « Vous êtes ici »)"><Icon name="plus" size={14} /> Affiche</button>
      {floor.variants.length > 1 && <NewScopePicker />}
      <span className={`badge status-${floor.titleBlock.status}`}>{STATUS_LABEL[floor.titleBlock.status]}</span>
    </div>
  );
}

/** Portée des éléments que l'on crée : toutes les affiches de l'étage, ou seulement l'affiche active. */
function NewScopePicker() {
  const scope = useStore((s) => s.newScope);
  const floor = useStore((s) => currentFloor(s));
  const n = floor?.variants.length ?? 0;
  return (
    <label className={scope === 'variant' ? 'crumb new-scope own' : 'crumb new-scope'} title="Où apparaissent les éléments que vous dessinez ou posez">
      Nouveaux éléments
      <select value={scope} onChange={(e) => useStore.getState().setNewScope(e.target.value as 'all' | 'variant')}>
        <option value="all">Toutes les affiches ({n})</option>
        <option value="variant">Cette affiche uniquement</option>
      </select>
    </label>
  );
}

function StatusBar() {
  const dirty = useStore((s) => s.dirty);
  const filePath = useStore((s) => s.filePath);
  const lastSaved = useStore((s) => s.lastSavedAt);
  const lastAuto = useStore((s) => s.lastAutosaveAt);
  const grid = useStore((s) => s.grid);
  const guides = useStore((s) => s.guides);
  const rulers = useStore((s) => s.rulers);
  const sel = useStore((s) => s.selection.length);
  const zoom = useStore((s) => s.view.zoom);
  const S = useStore.getState;
  const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '');
  const setZoom = (z: number) => {
    const s = S();
    const el = document.querySelector('.canvas-wrap');
    const cx = (el?.clientWidth ?? 800) / 2, cy = (el?.clientHeight ?? 600) / 2;
    const f = z / s.view.zoom;
    s.setView({ zoom: z, x: cx - (cx - s.view.x) * f, y: cy - (cy - s.view.y) * f });
  };
  return (
    <footer className="statusbar">
      <span className={`save-dot ${!filePath ? 'warn' : dirty ? 'warn' : 'ok'}`} />
      <span title={filePath ?? ''} className="sb-file">{filePath ? filePath.split(/[\\/]/).pop() : 'Projet non enregistré'}</span>
      {filePath
        ? <span className="muted">{dirty ? 'Modifications non enregistrées' : `Enregistré à ${t(lastSaved)}`}</span>
        : <span className="muted">Pensez à enregistrer (Ctrl+S)</span>}
      {lastAuto && <span className="muted">· Sauvegarde auto {t(lastAuto)}</span>}
      <span className="spacer" />
      {sel > 0 && <span className="muted">{sel} sélectionné(s)</span>}
      <button className={grid.show ? 'sb-toggle on' : 'sb-toggle'} onClick={() => S().setGrid({ show: !grid.show })}>Grille</button>
      <button className={grid.snap ? 'sb-toggle on' : 'sb-toggle'} onClick={() => S().setGrid({ snap: !grid.snap })}>Magnétisme</button>
      <button className={guides ? 'sb-toggle on' : 'sb-toggle'} onClick={() => S().toggleGuides()}>Repères</button>
      <button className={rulers ? 'sb-toggle on' : 'sb-toggle'} onClick={() => S().toggleRulers()}>Règles</button>
      <span className="sb-zoom">
        <button onClick={() => setZoom(Math.max(0.002, zoom / 1.25))} title="Zoom arrière">−</button>
        <input type="range" min={-9} max={3} step={0.01} value={Math.log2(zoom)} onChange={(e) => setZoom(2 ** Number(e.target.value))} aria-label="Zoom" />
        <button onClick={() => setZoom(Math.min(40, zoom * 1.25))} title="Zoom avant">+</button>
        <button className="sb-zoomval" onClick={() => S().requestFit()} title="Ajuster à la fenêtre">{Math.round(zoom * 100)} %</button>
      </span>
    </footer>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => useStore.getState().dismissToast(t.id)}>{t.msg}</div>
      ))}
    </div>
  );
}

function SampleCard({ sample }: { sample: (typeof SAMPLES)[number] }) {
  const project = useMemo(() => sample.build(), [sample]);
  const b = project.buildings[0], f = b.floors[0];
  return (
    <button className="sample-card" onClick={() => useStore.getState().loadProject(sample.build(), null)}>
      <div className={`sample-thumb ${f.page.orientation}`}>
        <PrintPage building={b} floor={f} variantId={f.variants[0].id} customSymbols={project.customSymbols} uniqueKey={`thumb-${sample.id}`} />
      </div>
      <div className="sample-meta">
        <b>{sample.title}</b>
        <span>{sample.subtitle}</span>
      </div>
    </button>
  );
}

function Welcome({ version, onHelp, onDemo }: { version: string; onHelp(): void; onDemo(): void }) {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { api().recentList().then(setRecent); }, []);
  return (
    <div className="welcome">
      <aside className="welcome-side">
        <div className="welcome-brand">
          <svg viewBox="0 0 100 100" width={44} height={44} aria-hidden="true">
            <rect x="2" y="2" width="96" height="96" rx="22" fill="#00a651" />
            <path d="M24 70 L43 51 L55 61 L76 36 M76 36 H63 M76 36 V49" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <h1>Atelier<br />Plans d’Évacuation</h1>
          </div>
        </div>
        <p className="welcome-tag">Des plans d’évacuation nets et professionnels, conçus et imprimés depuis votre poste — sans connexion, sans abonnement.</p>
        <div className="welcome-actions">
          <button className="w-btn" onClick={() => window.dispatchEvent(new CustomEvent('evac:command', { detail: { action: 'new-from-plan' } }))}><Icon name="import" size={20} /><span><b>Nouveau projet depuis un plan</b><small>PDF, image, DXF ou DWG : étage, page, fond, échelle</small></span></button>
          <button className="w-btn" onClick={() => A.newProjectAction()}><Icon name="new" size={20} /><span><b>Nouveau projet</b><small>Partir d’un étage vide</small></span></button>
          <button className="w-btn" onClick={() => A.openProjectAction()}><Icon name="open" size={20} /><span><b>Ouvrir un projet</b><small>Fichier .planevac</small></span></button>
        </div>
        {recent.length > 0 && (
          <div className="recent">
            <h3>Récents</h3>
            {recent.slice(0, 6).map((p) => (
              <button key={p} className="recent-item" onClick={() => A.openProjectAction(p)} title={p}>
                <Icon name="floor" size={15} /><span><b>{p.split(/[\\/]/).pop()}</b><small>{p}</small></span>
              </button>
            ))}
          </div>
        )}
        <div className="welcome-foot">
          <button className="link-light" onClick={onHelp}>Guide d’utilisation (F1)</button>
          <span>{version ? `v${version}` : ''} · Pictogrammes ISO 7010</span>
        </div>
      </aside>
      <main className="welcome-main">
        <div className="welcome-main-head">
          <h2>Plans d’exemple</h2>
          <p className="muted">Ouvrez un exemple pour découvrir les thèmes de mise en page, puis adaptez-le à votre bâtiment.</p>
          <button className="btn" onClick={onDemo}><Icon name="route" size={16} /> Essayer les nouveautés</button>
        </div>
        <div className="sample-grid">
          {SAMPLES.map((s) => <SampleCard key={s.id} sample={s} />)}
        </div>
      </main>
    </div>
  );
}

function HelpDialog({ kind, onClose, version }: { kind: 'guide' | 'shortcuts' | 'about'; onClose(): void; version: string }) {
  return (
    <div className="modal-backdrop" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal wide help" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {kind === 'guide' && (
          <>
            <h2>Guide d’utilisation rapide</h2>
            <ol>
              <li><b>Créer un projet</b> (<i>Dossier › Nouveau projet</i>, ou <i>Nouveau projet depuis un plan</i> sur l’accueil) ou partir d’un <b>plan d’exemple</b>, puis organiser bâtiments, étages et affiches dans l’onglet <i>Projet</i>.</li>
              <li><b>Importer un plan de fond</b> : ruban <i>Construire › Importer un plan</i> : l’assistant demande l’étage, la page d’un PDF (vignettes), la préparation du fond et enchaîne l’étalonnage. Un fichier DXF (AutoCAD) est importé en vectoriel à l’échelle réelle, sans étalonnage. Opacité, niveaux de gris et taille dans l’onglet <i>Fond</i> des propriétés.</li>
              <li><b>Étalonner l’échelle</b> (K) : cliquez deux points d’une cote connue et saisissez la distance réelle.</li>
              <li><b>Dessiner</b> depuis le ruban <i>Plan</i> : murs (M), portes (P), fenêtres (F), escaliers (E), pièces (R), zones (Z).</li>
              <li><b>Placer les pictogrammes ISO 7010</b> depuis l’onglet <i>Symboles</i> (recherche par nom ou code, clic puis clic, ou glisser-déposer).</li>
              <li><b>Tracer les itinéraires</b> (I) ou poser une <b>flèche d’évacuation</b> verte (ruban <i>Évacuation › Flèches d’évacuation</i> : demi-tour, virages, chicane…). <i>Évacuation › Circulations</i> montre le chemin probable vers la sortie la plus proche (aide non imprimée).</li>
              <li><b>Créer une affiche</b> (bouton <i>+ Affiche</i> au-dessus du plan), puis placer le repère « Vous êtes ici ». Pour une deuxième affiche, choisissez si les itinéraires doivent être repris ou copiés pour être modifiés indépendamment.</li>
              <li><b>Choisir un thème</b> de mise en page (<i>Mise en page</i>), compléter cartouche, numéros d’urgence et consignes, puis <b>valider</b> explicitement le plan.</li>
              <li><b>Vérifier et exporter</b> depuis l’aperçu (Ctrl+P). Choisissez les affiches de l’étage ou les pages à exporter pour tout le bâtiment. Les alertes indiquent les points à vérifier sur chaque affiche.</li>
            </ol>
            <p className="muted small">Le projet est sauvegardé automatiquement toutes les 30 secondes dans un fichier de secours ; après une fermeture inattendue, il vous sera proposé de le restaurer au prochain démarrage. Pensez à enregistrer (Ctrl+S) votre fichier .planevac.</p>
          </>
        )}
        {kind === 'shortcuts' && (
          <>
            <h2>Raccourcis clavier</h2>
            <table className="shortcuts"><tbody>
              {[
                ['V / H', 'Sélection / déplacer la vue'], ['M, P, F, E', 'Mur, porte, fenêtre, escalier'], ['R, Z, S', 'Pièce, zone, forme'], ['I, T, L, K', 'Itinéraire, texte, légende, étalonnage'],
                ['Molette', 'Zoom'], ['Espace + glisser, clic milieu', 'Déplacer la vue'], ['Ctrl+Z / Ctrl+Y', 'Annuler / rétablir'],
                ['Ctrl+C / X / V / D', 'Copier / couper / coller / dupliquer'], ['Suppr', 'Supprimer'], ['Double-clic, F2 ou Entrée', 'Renommer sur le plan (pièce, pictogramme, texte, forme…)'],
                ['Ctrl+← / Ctrl+→', 'Pivoter de −90° / +90°'], ['Page préc. / Page suiv.', 'Mettre devant / derrière'], ['Ctrl+L', 'Verrouiller / déverrouiller'], ['Ctrl+G / Ctrl+Maj+G', 'Grouper / dégrouper'],
                ['Flèches (Maj : ×5, Alt : fin)', 'Déplacer la sélection'], ['Maj pendant le tracé', 'Angles à 45°'], ['Alt pendant un déplacement', 'Sans magnétisme'],
                ['Entrée / Échap / Retour arrière', 'Terminer / abandonner / retirer le dernier point'], ['Ctrl+S / Ctrl+Maj+S', 'Enregistrer / enregistrer sous'],
                ['Ctrl+P / Ctrl+E', 'Aperçu et impression / export PDF'], ['Ctrl+0', 'Ajuster à la fenêtre'],
                ['Ctrl+B / Ctrl+Maj+B', 'Replier le panneau gauche / les propriétés'],
              ].map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}
            </tbody></table>
          </>
        )}
        {kind === 'about' && (
          <>
            <h2>À propos</h2>
            <p><b>Atelier Plans d’Évacuation</b>{version ? ` — version ${version}` : ''}</p>
            <p>Logiciel de bureau hors ligne : aucune connexion ni compte n’est nécessaire. Vos projets sont enregistrés localement au format ouvert <code>.planevac</code> (JSON documenté).</p>
            <p>Les 97 signaux ISO 7010 intégrés sont des tracés publiés sur Wikimedia Commons en domaine public ou CC0 (licence vérifiée, source de chaque fichier dans le manifeste). Les autres pictogrammes sont des dessins originaux sous licence CC0. Voir LICENSES.md.</p>
            <p className="warn small">Ce logiciel ne certifie pas la conformité des plans. Le statut « Validé » reflète uniquement la décision explicite de l’utilisateur. Vérifiez les exigences applicables (réglementation, service d’incendie, assureur).</p>
          </>
        )}
        <div className="modal-actions"><button className="btn primary" onClick={onClose}>Fermer</button></div>
      </div>
    </div>
  );
}

export { alertDialog };
