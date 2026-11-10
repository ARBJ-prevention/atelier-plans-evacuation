import { useEffect, useMemo, useState } from 'react';
import * as A from './app/actions';
import { SAMPLES } from './app/sample';
import { PrintDialog } from './dialogs/PrintDialog';
import { Canvas } from './editor/Canvas';
import { LayersPanel } from './panels/LayersPanel';
import { LibraryPanel } from './panels/LibraryPanel';
import { ProjectPanel } from './panels/ProjectPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { Ribbon, TOOL_KEYS } from './panels/Ribbon';
import { PrintPage, STATUS_LABEL } from './render/PrintPage';
import { api } from './services/api';
import { currentBuilding, currentFloor, currentVariantId, useStore } from './store/store';
import { alertDialog, DialogHost } from './ui/dialogs';
import { Icon } from './ui/icons';

const AUTOSAVE_MS = 30_000;

export function App() {
  const project = useStore((s) => s.project);
  const [leftTab, setLeftTab] = useState<'project' | 'library' | 'layers'>('library');
  const [printOpen, setPrintOpen] = useState(false);
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
    const h = () => setLeftTab('library');
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

  const runCommand = async (action: string, arg?: string) => {
    const s = useStore.getState();
    const has = !!s.project;
    switch (action) {
      case 'new': return A.newProjectAction();
      case 'open': return A.openProjectAction();
      case 'open-recent': return A.openProjectAction(arg);
      case 'save': return has && A.saveProject(false);
      case 'save-as': return has && A.saveProject(true);
      case 'duplicate-project': return has && A.duplicateProjectAction();
      case 'import-background': return has && A.importBackgroundAction();
      case 'import-symbol': return has && A.importSymbolAction();
      case 'print-preview': return has && setPrintOpen(true);
      case 'export-pdf': return has && A.exportPdfAction();
      case 'export-png': return has && A.exportPngAction();
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
        return s.select(f.elements.filter((e) => !locked.has(e.layer) && (!e.variantId || e.variantId === vid)).map((e) => e.id));
      }
      case 'group': return s.groupSelection();
      case 'ungroup': return s.ungroupSelection();
      case 'zoom-in': case 'zoom-out': {
        const k = action === 'zoom-in' ? 1.25 : 0.8;
        const el = document.querySelector('.canvas-wrap');
        const cx = (el?.clientWidth ?? 800) / 2, cy = (el?.clientHeight ?? 600) / 2;
        const z = Math.min(40, Math.max(0.02, s.view.zoom * k)), f = z / s.view.zoom;
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

  // ——— Raccourcis clavier ———
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (document.querySelector('.modal-backdrop') && !e.ctrlKey) return;
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
        if (editMap[k] && !typing) { e.preventDefault(); runCommand(editMap[k]); return; }
        return;
      }
      if (typing || !useStore.getState().project) return;
      const s = useStore.getState();
      if (e.key === 'Delete' || (e.key === 'Backspace' && s.tool === 'select')) { e.preventDefault(); s.deleteSelection(); return; }
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
        <Welcome version={version} onHelp={() => setHelp('guide')} />
        {help && <HelpDialog kind={help} onClose={() => setHelp('')} version={version} />}
        <DialogHost />
        <Toasts />
      </>
    );
  }

  return (
    <div className="app">
      <Ribbon onPrintPreview={() => setPrintOpen(true)} />
      <div className="main">
        <nav className="left">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={leftTab === 'project'} className={leftTab === 'project' ? 'on' : ''} onClick={() => setLeftTab('project')}><Icon name="building" size={16} /> Projet</button>
            <button role="tab" aria-selected={leftTab === 'library'} className={leftTab === 'library' ? 'on' : ''} onClick={() => setLeftTab('library')}><Icon name="symbol" size={16} /> Symboles</button>
            <button role="tab" aria-selected={leftTab === 'layers'} className={leftTab === 'layers' ? 'on' : ''} onClick={() => setLeftTab('layers')}><Icon name="layers" size={16} /> Calques</button>
          </div>
          {leftTab === 'project' && <ProjectPanel />}
          {leftTab === 'library' && <LibraryPanel />}
          {leftTab === 'layers' && <LayersPanel />}
        </nav>
        <main className="center">
          <FloorBar />
          <Canvas onCalibrate={(d) => A.calibrateAction(d)} />
        </main>
        <PropertiesPanel />
      </div>
      <StatusBar />
      {printOpen && <PrintDialog onClose={() => setPrintOpen(false)} />}
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
      {floor.variants.length > 1 && (
        <>
          <span className="sep">›</span>
          <label className="crumb">Version :
            <select value={variantId} onChange={(e) => useStore.getState().setVariant(e.target.value)}>
              {floor.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
        </>
      )}
      <span className={`badge status-${floor.titleBlock.status}`}>{STATUS_LABEL[floor.titleBlock.status]}</span>
    </div>
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
        <button onClick={() => setZoom(Math.max(0.02, zoom / 1.25))} title="Zoom arrière">−</button>
        <input type="range" min={-4} max={3} step={0.01} value={Math.log2(zoom)} onChange={(e) => setZoom(2 ** Number(e.target.value))} aria-label="Zoom" />
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

function Welcome({ version, onHelp }: { version: string; onHelp(): void }) {
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
          <button className="w-btn primary" onClick={() => A.newProjectAction()}><Icon name="new" size={20} /><span><b>Nouveau projet</b><small>Bâtiments, étages, versions</small></span></button>
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
              <li><b>Créer un projet</b> (Accueil › Nouveau) ou partir d’un <b>plan d’exemple</b>, puis organiser bâtiments et étages dans l’onglet <i>Projet</i>.</li>
              <li><b>Importer un plan de fond</b> : ruban <i>Insérer › PDF / image</i>. Opacité, niveaux de gris et taille dans l’onglet <i>Fond</i> des propriétés.</li>
              <li><b>Étalonner l’échelle</b> (K) : cliquez deux points d’une cote connue et saisissez la distance réelle.</li>
              <li><b>Dessiner</b> depuis le ruban <i>Bâtiment</i> : murs (M), portes (P), fenêtres (F), escaliers (E), pièces (R), zones (Z).</li>
              <li><b>Placer les pictogrammes ISO 7010</b> depuis l’onglet <i>Symboles</i> (recherche par nom ou code, clic puis clic, ou glisser-déposer).</li>
              <li><b>Tracer les itinéraires</b> (I) ou poser une <b>flèche d’évacuation</b> verte (<i>Insérer › Flèches d’évacuation</i> : demi-tour, virages, chicane…).</li>
              <li><b>Créer des versions</b> (onglet Projet) pour chaque emplacement « Vous êtes ici » d’un même étage.</li>
              <li><b>Choisir un thème</b> de mise en page (<i>Mise en page</i>), compléter cartouche, numéros d’urgence et consignes, puis <b>valider</b> explicitement le plan.</li>
              <li><b>Exporter</b> en PDF / PNG ou imprimer depuis l’aperçu (Ctrl+P).</li>
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
                ['Ctrl+C / X / V / D', 'Copier / couper / coller / dupliquer'], ['Suppr', 'Supprimer'], ['Ctrl+G / Ctrl+Maj+G', 'Grouper / dégrouper'],
                ['Flèches (Maj : ×5, Alt : fin)', 'Déplacer la sélection'], ['Maj pendant le tracé', 'Angles à 45°'], ['Alt pendant un déplacement', 'Sans magnétisme'],
                ['Entrée / Échap / Retour arrière', 'Terminer / abandonner / retirer le dernier point'], ['Ctrl+S / Ctrl+Maj+S', 'Enregistrer / enregistrer sous'],
                ['Ctrl+P / Ctrl+E', 'Aperçu et impression / export PDF'], ['Ctrl+0', 'Ajuster à la fenêtre'],
              ].map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}
            </tbody></table>
          </>
        )}
        {kind === 'about' && (
          <>
            <h2>À propos</h2>
            <p><b>Atelier Plans d’Évacuation</b>{version ? ` — version ${version}` : ''}</p>
            <p>Logiciel de bureau hors ligne : aucune connexion ni compte n’est nécessaire. Vos projets sont enregistrés localement au format ouvert <code>.planevac</code> (JSON documenté).</p>
            <p>Les pictogrammes intégrés sont des dessins originaux sous licence CC0, inspirés des conventions ISO 7010 ; ils ne sont pas des reproductions officielles.</p>
            <p className="warn small">Ce logiciel ne certifie pas la conformité des plans. Le statut « Validé » reflète uniquement la décision explicite de l’utilisateur. Vérifiez les exigences applicables (réglementation, service d’incendie, assureur).</p>
          </>
        )}
        <div className="modal-actions"><button className="btn primary" onClick={onClose}>Fermer</button></div>
      </div>
    </div>
  );
}

export { alertDialog };
