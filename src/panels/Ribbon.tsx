import React, { useState } from 'react';
import * as A from '../app/actions';
import { ARROW_PRESETS, GREEN_ARROW_STYLE, insertArrowPreset, type ArrowPreset } from '../app/arrowPresets';
import { makeElement } from '../model/defaults';
import { ElementView } from '../render/ElementView';
import type { PageSetup, PageTheme } from '../model/types';
import { STATUS_LABEL } from '../render/PrintPage';
import { THEMES } from '../render/layout';
import { currentFloor, useStore, type Tool, type ToolPresets } from '../store/store';
import { Icon } from '../ui/icons';

type Tab = 'home' | 'insert' | 'building' | 'page' | 'view';
const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Accueil' }, { id: 'insert', label: 'Insérer' }, { id: 'building', label: 'Bâtiment' },
  { id: 'page', label: 'Mise en page' }, { id: 'view', label: 'Affichage' },
];

export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select', h: 'pan', m: 'wall', p: 'door', f: 'window', e: 'stairs', r: 'room', z: 'zone', i: 'route', t: 'text', l: 'legend', k: 'calibrate', s: 'shape',
};

function Big({ icon, label, onClick, active, title, disabled }: { icon: string; label: string; onClick(): void; active?: boolean; title?: string; disabled?: boolean }) {
  return (
    <button className={active ? 'rb-big on' : 'rb-big'} onClick={onClick} title={title ?? label} aria-pressed={active} disabled={disabled}>
      <Icon name={icon} size={22} /><span>{label}</span>
    </button>
  );
}
function Small({ icon, label, onClick, active, title, disabled }: { icon: string; label?: string; onClick(): void; active?: boolean; title?: string; disabled?: boolean }) {
  return (
    <button className={active ? 'rb-small on' : 'rb-small'} onClick={onClick} title={title ?? label} aria-pressed={active} disabled={disabled}>
      <Icon name={icon} size={16} />{label && <span>{label}</span>}
    </button>
  );
}
function Group({ title, children, cols }: { title: string; children: React.ReactNode; cols?: boolean }) {
  return (
    <div className="rb-group">
      <div className={cols ? 'rb-items cols' : 'rb-items'}>{children}</div>
      <div className="rb-title">{title}</div>
    </div>
  );
}

export function Ribbon({ onPrintPreview }: { onPrintPreview(): void }) {
  const [tab, setTab] = useState<Tab>('home');
  const project = useStore((s) => s.project)!;
  const tool = useStore((s) => s.tool);
  const presets = useStore((s) => s.presets);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const dirty = useStore((s) => s.dirty);
  const floor = useStore((s) => currentFloor(s));
  const sel = useStore((s) => s.selection.length);
  const S = useStore.getState;
  const use = (t: Tool, p?: Partial<ToolPresets>) => { if (p) S().setPreset(p); S().setTool(t); };

  return (
    <header className="ribbon">
      <div className="rb-top">
        <div className="rb-brand" title="Atelier Plans d’Évacuation">
          <svg viewBox="0 0 100 100" width={22} height={22} aria-hidden="true">
            <rect x="2" y="2" width="96" height="96" rx="22" fill="#00a651" />
            <path d="M24 70 L43 51 L55 61 L76 36 M76 36 H63 M76 36 V49" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="rb-quick">
          <button title="Enregistrer (Ctrl+S)" onClick={() => A.saveProject(false)}><Icon name="save" size={16} /></button>
          <button title="Annuler (Ctrl+Z)" disabled={!canUndo} onClick={() => S().undo()}><Icon name="undo" size={16} /></button>
          <button title="Rétablir (Ctrl+Y)" disabled={!canRedo} onClick={() => S().redo()}><Icon name="redo" size={16} /></button>
        </div>
        <nav className="rb-tabs" role="tablist">
          <button className="rb-file" onClick={() => A.openProjectAction()} title="Ouvrir un projet">Fichier</button>
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="rb-doc">
          <span className="rb-docname">{project.name}{dirty ? ' •' : ''}</span>
          {floor && <span className={`chip status-${floor.titleBlock.status}`}>{STATUS_LABEL[floor.titleBlock.status]}</span>}
        </div>
        <div className="rb-actions">
          <button className="rb-cta ghost" onClick={onPrintPreview}><Icon name="print" size={16} /> Aperçu</button>
          <button className="rb-cta" onClick={() => A.exportPdfAction()}><Icon name="pdf" size={16} /> Exporter PDF</button>
        </div>
      </div>

      <div className="rb-panel">
        {tab === 'home' && (
          <>
            <Group title="Fichier">
              <Big icon="new" label="Nouveau" onClick={() => A.newProjectAction()} />
              <Big icon="open" label="Ouvrir" onClick={() => A.openProjectAction()} />
              <Big icon="save" label="Enregistrer" onClick={() => A.saveProject(false)} />
            </Group>
            <Group title="Presse-papiers" cols>
              <Small icon="paste" label="Coller" onClick={() => S().paste()} />
              <Small icon="cut" label="Couper" onClick={() => S().cutSelection()} disabled={!sel} />
              <Small icon="copy" label="Copier" onClick={() => S().copySelection()} disabled={!sel} />
              <Small icon="copy" label="Dupliquer" onClick={() => S().duplicateSelection()} disabled={!sel} />
            </Group>
            <Group title="Outils">
              <Big icon="select" label="Sélection" active={tool === 'select'} onClick={() => use('select')} title="Sélection (V)" />
              <Big icon="pan" label="Main" active={tool === 'pan'} onClick={() => use('pan')} title="Déplacer la vue (H)" />
              <Big icon="route" label="Itinéraire" active={tool === 'route'} onClick={() => use('route', { routeKind: 'principal' })} title="Itinéraire d’évacuation (I)" />
            </Group>
            <Group title="Organiser" cols>
              <Small icon="group" label="Grouper" onClick={() => S().groupSelection()} disabled={sel < 2} />
              <Small icon="group" label="Dégrouper" onClick={() => S().ungroupSelection()} disabled={!sel} />
              <Small icon="front" label="Premier plan" onClick={() => S().reorderSelection('front')} disabled={!sel} />
              <Small icon="back" label="Arrière-plan" onClick={() => S().reorderSelection('back')} disabled={!sel} />
              <Small icon="rotate" label="Pivoter 90°" onClick={() => S().rotateSelection(90)} disabled={!sel} />
              <Small icon="flipH" label="Retourner ↔" onClick={() => S().flipSelection('h')} disabled={!sel} />
              <Small icon="flipV" label="Retourner ↕" onClick={() => S().flipSelection('v')} disabled={!sel} />
              <Small icon="lockOn" label="Verrouiller" onClick={() => S().toggleLockSelection()} disabled={!sel} />
            </Group>
            <Group title="Aligner et répartir">
              <div className="rb-grid4">
                {([['left', 'alignLeft', 'Aligner à gauche'], ['hcenter', 'alignHCenter', 'Centrer horizontalement'], ['right', 'alignRight', 'Aligner à droite'], ['hdist', 'distH', 'Répartir horizontalement'],
                  ['top', 'alignTop', 'Aligner en haut'], ['vcenter', 'alignVCenter', 'Centrer verticalement'], ['bottom', 'alignBottom', 'Aligner en bas'], ['vdist', 'distV', 'Répartir verticalement']] as const)
                  .map(([k, icon, label]) => <Small key={k} icon={icon} title={label} onClick={() => S().alignSelection(k)} disabled={sel < 2} />)}
              </div>
            </Group>
            <Group title="Édition">
              <Big icon="trash" label="Supprimer" onClick={() => S().deleteSelection()} disabled={!sel} />
            </Group>
          </>
        )}

        {tab === 'insert' && (
          <>
            <Group title="Plan de fond">
              <Big icon="import" label="PDF / image" onClick={() => A.importBackgroundAction()} title="Importer un plan existant" />
            </Group>
            <Group title="Évacuation">
              <Big icon="route" label="Itinéraire" active={tool === 'route' && presets.routeKind === 'principal'} onClick={() => use('route', { routeKind: 'principal' })} />
              <Big icon="stroke" label="Secondaire" active={tool === 'route' && presets.routeKind === 'secondaire'} onClick={() => use('route', { routeKind: 'secondaire' })} />
              <Big icon="symbol" label="Pictogramme" onClick={() => window.dispatchEvent(new CustomEvent('evac:show-library'))} />
            </Group>
            <Group title="Flèches d’évacuation">
              <div className="arrow-presets">
                {ARROW_PRESETS.map((p) => <ArrowPresetButton key={p.id} preset={p} />)}
              </div>
            </Group>
            <Group title="Annotations">
              <Big icon="textIcon" label="Texte" active={tool === 'text'} onClick={() => use('text')} />
              <Big icon="legendIcon" label="Légende" active={tool === 'legend'} onClick={() => use('legend')} />
              <Big icon="image" label="Image / logo" onClick={() => A.insertImageAction()} />
            </Group>
            <Group title="Formes">
              <div className="rb-grid4">
                {([['rect', 'shapeRect', 'Rectangle'], ['ellipse', 'shapeEllipse', 'Ellipse'], ['triangle', 'shapeTriangle', 'Triangle'], ['diamond', 'shapeDiamond', 'Losange'],
                  ['hexagon', 'shapeHexagon', 'Hexagone'], ['line', 'shapeLine', 'Ligne'], ['arrow', 'shapeArrow', 'Flèche pleine'], ['star', 'shapeStar', 'Étoile']] as const)
                  .map(([k, icon, label]) => <Small key={k} icon={icon} title={label} active={tool === 'shape' && presets.shape === k} onClick={() => use('shape', { shape: k })} />)}
              </div>
            </Group>
            <Group title="Bibliothèque">
              <Big icon="import" label="Importer un picto." onClick={() => A.importSymbolAction()} title="Importer un pictogramme SVG / PNG" />
            </Group>
          </>
        )}

        {tab === 'building' && (
          <>
            <Group title="Structure">
              <Big icon="wall" label="Mur" active={tool === 'wall' && presets.wallThickness >= 18} onClick={() => use('wall', { wallThickness: 22 })} title="Mur porteur (M)" />
              <Big icon="partition" label="Cloison" active={tool === 'wall' && presets.wallThickness < 18} onClick={() => use('wall', { wallThickness: 10 })} />
              <Big icon="window" label="Fenêtre" active={tool === 'window'} onClick={() => use('window')} title="Fenêtre (F)" />
            </Group>
            <Group title="Portes" cols>
              {([['single', 'Battante'], ['double', 'Double'], ['sliding', 'Coulissante'], ['revolving', 'Tambour'], ['opening', 'Baie libre']] as const).map(([k, l]) => (
                <Small key={k} icon="door" label={l} active={tool === 'door' && presets.doorType === k} onClick={() => use('door', { doorType: k })} />
              ))}
            </Group>
            <Group title="Escaliers" cols>
              {([['straight', 'Droit'], ['landing', 'Avec palier'], ['escalator', 'Escalator']] as const).map(([k, l]) => (
                <Small key={k} icon="stairs" label={l} active={tool === 'stairs' && presets.stairType === k} onClick={() => use('stairs', { stairType: k })} />
              ))}
            </Group>
            <Group title="Espaces">
              <Big icon="room" label="Pièce" active={tool === 'room'} onClick={() => use('room')} title="Pièce (R)" />
              <Big icon="zone" label="Zone" active={tool === 'zone'} onClick={() => use('zone')} title="Zone de danger, refuge… (Z)" />
            </Group>
            <Group title="Mesure">
              <Big icon="calibrate" label="Étalonner" active={tool === 'calibrate'} onClick={() => use('calibrate')} title="Étalonner l’échelle (K)" />
            </Group>
          </>
        )}

        {tab === 'page' && floor && <PageTab page={floor.page} onPreview={onPrintPreview} />}
        {tab === 'view' && <ViewTab />}
      </div>
    </header>
  );
}

/** Aperçu d'une flèche d'évacuation, rendu avec le même code que le plan. */
function ArrowPresetButton({ preset }: { preset: ArrowPreset }) {
  const el = makeElement('route', {
    ...GREEN_ARROW_STYLE, points: preset.points, cornerRadius: preset.radius, arrowEnd: true, arrowStart: !!preset.both, width: 24,
  });
  return (
    <button className="arrow-preset" title={`${preset.name} — insérer au centre de la vue`} onClick={() => insertArrowPreset(preset.id)}>
      <svg viewBox="-140 -140 280 280" width={34} height={34} aria-hidden="true">
        <ElementView el={el} ctx={{ floor: null as any, variantId: '', customSymbols: [] }} />
      </svg>
    </button>
  );
}

const ACCENTS = ['#00843d', '#0f6e5a', '#1f4e8c', '#5b3fa0', '#b3261e', '#c27400', '#0f1b2a'];

export function ThemeThumb({ theme, accent, active, onClick }: { theme: PageTheme; accent: string; active?: boolean; onClick?(): void }) {
  const T = THEMES[theme];
  const head = T.headerBg === 'accent' ? accent : T.headerBg;
  return (
    <button className={active ? 'theme-card on' : 'theme-card'} onClick={onClick} title={T.description}>
      <svg viewBox="0 0 60 42" width={60} height={42} aria-hidden="true">
        <rect width="60" height="42" fill="#fff" />
        {T.frame === 'double' && <rect x="1.5" y="1.5" width="57" height="39" fill="none" stroke="#222" strokeWidth="0.6" />}
        {head ? <rect width="60" height="8" fill={head} /> : <rect x="4" y="3.5" width="22" height="2.4" fill={T.headerFg} />}
        {head && <rect x="4" y="2.6" width="20" height="2.4" fill="#fff" opacity="0.9" />}
        {theme === 'moderne' && <rect y="8" width="60" height="0.8" fill={accent} />}
        <rect x="4" y="11" width="36" height="24" rx={T.planRadius ? 1.4 : 0} fill={T.cardBg === '#ffffff' ? '#f7f8f9' : T.cardBg} stroke={T.cardBorder || '#eceff2'} strokeWidth="0.4" />
        <path d="M9 30 L18 22 L26 26 L34 16" fill="none" stroke="#00843d" strokeWidth="1.6" />
        <rect x="43" y="11" width="13" height="11" rx={T.cardRadius ? 1 : 0} fill={T.cardBg} stroke={T.cardBorder || '#eceff2'} strokeWidth="0.4" />
        <rect x="43" y="24" width="13" height="11" rx={T.cardRadius ? 1 : 0} fill={T.cardBg} stroke={T.cardBorder || '#eceff2'} strokeWidth="0.4" />
        <rect x="45" y="26" width="7" height="1.6" fill="#d52b1e" />
        <rect x="4" y="37" width="52" height={T.footer === 'band' ? 3 : 1.4} fill={T.footer === 'band' ? '#0f1b2a' : '#c8d0d8'} />
      </svg>
      <span>{T.name}</span>
    </button>
  );
}

function PageTab({ page, onPreview }: { page: PageSetup; onPreview(): void }) {
  const set = (patch: Partial<PageSetup>) =>
    useStore.getState().mutateFloor((f) => { Object.assign(f.page, patch); }, { keepValidation: true, coalesce: `page:${Object.keys(patch).join(',')}` });
  const toggles: [keyof PageSetup, string, string][] = [
    ['showTitleBlock', 'Cartouche', 'layout'], ['showLegend', 'Légende', 'legendIcon'], ['showInstructions', 'Consignes', 'textIcon'],
    ['showEmergencyNumbers', 'N° d’urgence', 'phone'], ['showScaleBar', 'Échelle', 'ruler'], ['showNorth', 'Nord', 'north'], ['showWatermark', 'Filigrane', 'watermark'],
  ];
  return (
    <>
      <Group title="Thème">
        <div className="theme-row">
          {(Object.keys(THEMES) as PageTheme[]).map((t) => <ThemeThumb key={t} theme={t} accent={page.accentColor} active={page.theme === t} onClick={() => set({ theme: t })} />)}
        </div>
      </Group>
      <Group title="Couleur d’accent">
        <div className="accent-row">
          {ACCENTS.map((c) => <button key={c} className={page.accentColor === c ? 'swatch on' : 'swatch'} style={{ background: c }} title={c} onClick={() => set({ accentColor: c })} />)}
          <input type="color" value={page.accentColor} onChange={(e) => set({ accentColor: e.target.value })} title="Couleur personnalisée" />
        </div>
      </Group>
      <Group title="Papier" cols>
        <div className="seg">
          {(['A4', 'A3', 'A2'] as const).map((p) => <button key={p} className={page.paper === p ? 'on' : ''} onClick={() => set({ paper: p })}>{p}</button>)}
        </div>
        <div className="seg">
          <button className={page.orientation === 'portrait' ? 'on' : ''} onClick={() => set({ orientation: 'portrait' })}><Icon name="portrait" size={14} /> Portrait</button>
          <button className={page.orientation === 'landscape' ? 'on' : ''} onClick={() => set({ orientation: 'landscape' })}><Icon name="landscape" size={14} /> Paysage</button>
        </div>
      </Group>
      <Group title="Disposition" cols>
        <label className="rb-field">Légende
          <select value={page.sidePosition} onChange={(e) => set({ sidePosition: e.target.value as any })}>
            <option value="right">à droite</option><option value="left">à gauche</option><option value="bottom">en bas</option>
          </select>
        </label>
        <label className="rb-field">Marges <input type="number" min={0} max={40} value={page.marginMm} onChange={(e) => set({ marginMm: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} /> mm</label>
      </Group>
      <Group title="Éléments de la page">
        <div className="rb-toggles">
          {toggles.map(([k, l, icon]) => <Small key={k} icon={icon} label={l} active={!!page[k]} onClick={() => set({ [k]: !page[k] } as any)} />)}
        </div>
      </Group>
      <Group title="Sortie">
        <Big icon="print" label="Aperçu" onClick={onPreview} />
        <Big icon="pdf" label="PDF" onClick={() => A.exportPdfAction()} />
        <Big icon="image" label="PNG" onClick={() => A.exportPngAction()} />
      </Group>
    </>
  );
}

function ViewTab() {
  const grid = useStore((s) => s.grid);
  const guides = useStore((s) => s.guides);
  const rulers = useStore((s) => s.rulers);
  const zoom = useStore((s) => s.view.zoom);
  const S = useStore.getState;
  const zoomBy = (k: number) => {
    const s = S();
    const el = document.querySelector('.canvas-wrap');
    const cx = (el?.clientWidth ?? 800) / 2, cy = (el?.clientHeight ?? 600) / 2;
    const z = Math.min(40, Math.max(0.02, s.view.zoom * k)), f = z / s.view.zoom;
    s.setView({ zoom: z, x: cx - (cx - s.view.x) * f, y: cy - (cy - s.view.y) * f });
  };
  return (
    <>
      <Group title="Zoom">
        <Big icon="zoomIn" label="Avant" onClick={() => zoomBy(1.25)} />
        <Big icon="zoomOut" label="Arrière" onClick={() => zoomBy(0.8)} />
        <Big icon="fit" label="Ajuster" onClick={() => S().requestFit()} />
        <div className="rb-zoomval">{Math.round(zoom * 100)} %</div>
      </Group>
      <Group title="Grille">
        <Big icon="grid" label="Afficher" active={grid.show} onClick={() => S().setGrid({ show: !grid.show })} />
        <Big icon="magnet" label="Magnétisme" active={grid.snap} onClick={() => S().setGrid({ snap: !grid.snap })} />
        <div className="rb-stack">
          <div className="seg">
            <button className={grid.style === 'lines' ? 'on' : ''} onClick={() => S().setGrid({ style: 'lines' })}><Icon name="grid" size={14} /> Lignes</button>
            <button className={grid.style === 'dots' ? 'on' : ''} onClick={() => S().setGrid({ style: 'dots' })}><Icon name="dots" size={14} /> Points</button>
          </div>
          <label className="rb-field">Pas
            <select value={grid.size} onChange={(e) => S().setGrid({ size: Number(e.target.value) })}>
              {[5, 10, 20, 25, 50, 100].map((v) => <option key={v} value={v}>{v} u</option>)}
            </select>
            Maillage
            <select value={grid.majorEvery} onChange={(e) => S().setGrid({ majorEvery: Number(e.target.value) })}>
              {[2, 4, 5, 10].map((v) => <option key={v} value={v}>1 / {v}</option>)}
            </select>
          </label>
          <label className="rb-field">Intensité
            <input type="range" min={0} max={1} step={0.05} value={grid.intensity} onChange={(e) => S().setGrid({ intensity: Number(e.target.value) })} />
          </label>
        </div>
      </Group>
      <Group title="Aides">
        <Big icon="ruler" label="Règles" active={rulers} onClick={() => S().toggleRulers()} />
        <Big icon="guides" label="Repères" active={guides} onClick={() => S().toggleGuides()} />
      </Group>
    </>
  );
}
