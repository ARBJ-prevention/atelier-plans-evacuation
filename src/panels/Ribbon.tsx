import React, { useState } from 'react';
import * as A from '../app/actions';
import { ARROW_PRESETS, GREEN_ARROW_STYLE, insertArrowPreset, type ArrowPreset } from '../app/arrowPresets';
import { makeElement } from '../model/defaults';
import { ElementView } from '../render/ElementView';
import type { PageSetup, PageTheme } from '../model/types';
import { STATUS_LABEL } from '../render/PrintPage';
import { horizonNight, THEMES, themePatch, themeColor } from '../render/layout';
import { currentFloor, currentVariantId, MAX_SYMBOL_WALL_GAP, useStore, type Tool, type ToolPresets } from '../store/store';
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

export function Ribbon({ onPrintPreview, onQuickExport }: { onPrintPreview(): void; onQuickExport(): void }) {
  const [tab, setTab] = useState<Tab>('home');
  const project = useStore((s) => s.project)!;
  const tool = useStore((s) => s.tool);
  const presets = useStore((s) => s.presets);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const dirty = useStore((s) => s.dirty);
  const floor = useStore((s) => currentFloor(s));
  const variantId = useStore((s) => currentVariantId(s));
  const variantName = floor?.variants.find((v) => v.id === variantId)?.name;
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
          <button className="rb-cta" onClick={onQuickExport} title={`Vérifier et exporter ${variantName ?? 'l’affiche active'}`}>
            <Icon name="pdf" size={16} /> <span className="quick-export-label">{variantName ? `PDF · ${variantName}` : 'Exporter PDF'}</span>
          </button>
        </div>
      </div>

      <div className="rb-panel" key={tab}>
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
              <Big icon="import" label="Plan DXF / PDF" onClick={() => A.importBackgroundAction()} title="Importer un plan existant : DXF (AutoCAD, à l’échelle réelle), PDF ou image" />
            </Group>
            <Group title="Évacuation">
              <Big icon="route" label="Itinéraire" active={tool === 'route' && presets.routeKind === 'principal'} onClick={() => use('route', { routeKind: 'principal' })} />
              <Big icon="routeDashed" label="Secondaire" active={tool === 'route' && presets.routeKind === 'secondaire'} onClick={() => use('route', { routeKind: 'secondaire' })} />
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
            <Group title="Murs et ouvertures">
              <Big icon="wall" label="Mur" active={tool === 'wall' && presets.wallThickness >= 18} onClick={() => use('wall', { wallThickness: 22 })}
                title="Mur porteur épais (M) — cliquez point par point, double-clic pour terminer" />
              <Big icon="partition" label="Cloison" active={tool === 'wall' && presets.wallThickness < 18} onClick={() => use('wall', { wallThickness: 10 })}
                title="Cloison fine — cliquez point par point, double-clic pour terminer" />
              <Big icon="window" label="Fenêtre" active={tool === 'window'} onClick={() => use('window')} title="Fenêtre (F) — cliquez sur un mur" />
            </Group>
            <Group title="Portes" cols>
              {([['single', 'Battante', 'door', 'Porte à un vantail qui pivote'], ['double', 'Double', 'doorDouble', 'Porte à deux vantaux'],
                ['sliding', 'Coulissante', 'doorSliding', 'Porte qui glisse le long du mur'], ['revolving', 'Tambour', 'doorRevolving', 'Porte tournante'],
                ['opening', 'Baie libre', 'doorOpening', 'Ouverture sans porte']] as const).map(([k, l, icon, tip]) => (
                <Small key={k} icon={icon} label={l} title={`${tip} — cliquez sur un mur`} active={tool === 'door' && presets.doorType === k} onClick={() => use('door', { doorType: k })} />
              ))}
              <Small icon="door" label={presets.doorFire ? 'Coupe-feu : oui' : 'Coupe-feu : non'} active={!!presets.doorFire}
                title="Poser les nouvelles portes comme portes coupe-feu (seuil rouge et libellé « CF »)"
                onClick={() => use('door', { doorFire: !presets.doorFire })} />
            </Group>
            <Group title="Escaliers" cols>
              {([['straight', 'Droit', 'stairs', 'Escalier droit'], ['landing', 'Avec palier', 'stairsLanding', 'Escalier en U avec palier'],
                ['escalator', 'Escalator', 'escalator', 'Escalier mécanique']] as const).map(([k, l, icon, tip]) => (
                <Small key={k} icon={icon} label={l} title={`${tip} — tracez un rectangle sur le plan`} active={tool === 'stairs' && presets.stairType === k} onClick={() => use('stairs', { stairType: k })} />
              ))}
              <Small icon="stairArrow" label={presets.stairArrow !== false ? 'Flèche : oui' : 'Flèche : non'} active={presets.stairArrow !== false}
                title="Dessiner la flèche de sens sur les nouveaux escaliers"
                onClick={() => { const on = presets.stairArrow === false; use('stairs', on ? { stairArrow: true } : { stairArrow: false, stairSplit: true }); }} />
              <Small icon="stairSplit" label={presets.stairSplit ? 'Séparé : oui' : 'Séparé : non'} active={!!presets.stairSplit}
                title="Séparation au milieu (deux côtés : montée / descente) sur les nouveaux escaliers droits"
                onClick={() => use('stairs', { stairSplit: !presets.stairSplit })} />
            </Group>
            <Group title="Espaces">
              <Big icon="room" label="Pièce" active={tool === 'room'} onClick={() => use('room')} title="Pièce (R) — tracez un rectangle, puis nommez-la" />
              <Big icon="zone" label="Zone" active={tool === 'zone'} onClick={() => use('zone')} title="Zone de danger, refuge… (Z)" />
            </Group>
            <Group title="Mesure">
              <Big icon="calibrate" label="Étalonner" active={tool === 'calibrate'} onClick={() => use('calibrate')} title="Étalonner l’échelle (K) — tracez une cote connue sur le plan et indiquez sa longueur réelle" />
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
  const gid = `thumb-grad-${React.useId().replace(/:/g, '')}`;
  const grad = T.headerBg === 'gradient';
  const head = grad ? `url(#${gid})` : T.headerBg === 'accent' ? accent : T.headerBg;
  const ed = theme === 'editorial';
  const cardFill = themeColor(T.cardBg, accent);
  return (
    <button className={active ? 'theme-card on' : 'theme-card'} onClick={onClick} title={T.description}>
      <svg viewBox="0 0 60 42" width={60} height={42} aria-hidden="true">
        {grad && (
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0.6">
              <stop offset="0" stopColor={horizonNight(accent)} />
              <stop offset="1" stopColor={accent} />
            </linearGradient>
          </defs>
        )}
        <rect width="60" height="42" fill="#fff" />
        {T.frame !== 'none' && <rect x="1.5" y="1.5" width="57" height="39" fill="none" stroke={T.ink} strokeWidth="0.6" />}
        {ed ? (
          <g>
            <rect x="4" y="2" width="52" height="0.3" fill={T.ink} />
            <rect x="4" y="2" width="7" height="1.1" fill={accent} />
            <rect x="4" y="4.4" width="27" height="3.4" fill={T.ink} />
            <rect x="4" y="8.6" width="1" height="1" fill={accent} />
            <rect x="6" y="8.6" width="16" height="1" fill={T.muted} />
            <rect x="44" y="4.6" width="12" height="1.6" fill="#d52b1e" />
            <rect x="4" y="10.4" width="52" height="0.7" fill={T.ink} />
          </g>
        ) : (
          <>
            {head ? <rect width="60" height="8" fill={head} /> : <rect x="4" y="3.5" width="22" height="2.4" fill={T.headerFg} />}
            {head && <rect x="4" y="2.6" width="20" height="2.4" fill="#fff" opacity="0.9" />}
            {grad && <circle cx="52" cy="0" r="8.5" fill="#fff" opacity="0.1" />}
            {grad && <rect x="45" y="2.8" width="11" height="2.4" rx="1.2" fill="#fff" />}
          </>
        )}
        {theme === 'moderne' && <rect y="8" width="60" height="0.8" fill={accent} />}
        <rect x="4" y={ed ? 13 : 11} width="36" height={ed ? 22 : 24} rx={T.planRadius ? Math.min(2.2, T.planRadius * 0.6) : 0}
          fill={cardFill === '#ffffff' ? '#f7f8f9' : cardFill} stroke={themeColor(T.planStroke || T.cardBorder, accent) || (ed ? T.ink : '#eceff2')} strokeWidth={ed ? 0.3 : 0.4} />
        <path d="M9 30 L18 22 L26 26 L34 16" fill="none" stroke="#00843d" strokeWidth="1.6" />
        {(T.extras ? [[11, 5.5], [17.8, 5.5], [24.6, 4.6], [30.4, 4.6]] : ed ? [[13, 10], [25, 10]] : [[11, 11], [24, 11]]).map(([y, h], i) => (
          <g key={i}>
            <rect x="43" y={y} width="13" height={h} rx={T.cardRadius ? Math.min(1.6, T.cardRadius * 0.45) : 0} fill={cardFill}
              stroke={themeColor(T.cardBorder, accent) || (cardFill === '#ffffff' && !ed ? '#eceff2' : 'none')} strokeWidth={T.cardStyle === 'tab' ? 0.7 : 0.4} />
            {T.cardStyle === 'header' && <rect x="43" y={y} width="13" height="1.6" fill={themeColor(T.cardHead, accent)} />}
            {T.cardStyle === 'tab' && <rect x="44" y={y - 0.6} width="6" height="1.4" fill={themeColor(T.cardBorder, accent)} />}
            {T.cardStyle === 'pill' && <rect x="44" y={y + 1} width="6.5" height="1.8" rx="0.9" fill={accent} />}
            {T.cardStyle === 'index' && (
              <g>
                <rect x="43" y={y} width="13" height="0.6" fill={T.ink} />
                <rect x="43" y={y + 1.5} width="2" height="1.3" fill={accent} />
                <rect x="45.8" y={y + 1.7} width="6" height="0.9" fill={T.ink} />
              </g>
            )}
          </g>
        ))}
        {!T.extras && !ed && !grad && <rect x="45" y="26" width="7" height="1.6" fill="#d52b1e" />}
        {T.extras && <path d="M45 26 h5 v3 h4" fill="none" stroke={T.ink} strokeWidth="0.5" />}
        {T.footer === 'capsule'
          ? <rect x="4" y="36.6" width="52" height="2.6" rx="1.3" fill={themeColor('tint', accent)} />
          : T.footer === 'rule'
            ? <g><rect x="4" y="36.6" width="52" height="0.5" fill={T.ink} /><rect x="4" y="38" width="30" height="0.8" fill={accent} opacity="0.7" /></g>
            : <rect x="4" y="37" width="52" height={T.footer === 'band' ? 3 : 1.4} fill={T.footer === 'band' ? '#0f1b2a' : '#c8d0d8'} />}
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
    ['showEmergencyNumbers', 'N° d’urgence', 'phone'], ['showAerial', 'Vue aérienne', 'image'], ['showSketch', 'Croquis', 'floor'],
    ['showScaleBar', 'Échelle', 'ruler'], ['showNorth', 'Nord', 'north'], ['showWatermark', 'Filigrane', 'watermark'],
  ];
  return (
    <>
      <Group title="Thème">
        <div className="theme-row">
          {(Object.keys(THEMES) as PageTheme[]).map((t) => <ThemeThumb key={t} theme={t} accent={page.accentColor} active={page.theme === t} onClick={() => set(themePatch(t))} />)}
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
        <label className="rb-field" title={page.orientation === 'portrait' ? 'En portrait, « à droite » et « à gauche » ne s’appliquent que si le plan est en hauteur ; sinon la légende passe en bas.' : undefined}>Légende
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
        <Big icon="layout" label="Modèles" onClick={() => A.manageOrganizationTemplates()} title="Enregistrer ou appliquer un modèle d’organisation" />
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
      <Group title="Pictogrammes">
        <Big icon="magnet" label="Aimantage" title="Aimantage des pictogrammes" active={grid.symbolSnapEnabled}
          onClick={() => S().setGrid({ symbolSnapEnabled: !grid.symbolSnapEnabled })} />
        <label className="rb-stack rb-field" title="Espace entre le bord du pictogramme et la face du mur après l’aimantage">
          <span>Retrait des murs · {grid.symbolWallGap} u</span>
          <input type="range" min={1} max={MAX_SYMBOL_WALL_GAP} step={1}
            value={grid.symbolWallGap} aria-label="Retrait des pictogrammes par rapport aux murs"
            aria-valuetext={`${grid.symbolWallGap} unités du plan`} disabled={!grid.symbolSnapEnabled}
            onChange={(e) => S().setGrid({ symbolWallGap: Number(e.target.value) })} />
        </label>
      </Group>
      <Group title="Aides">
        <Big icon="ruler" label="Règles" active={rulers} onClick={() => S().toggleRulers()} />
        <Big icon="guides" label="Repères" active={guides} onClick={() => S().toggleGuides()} />
      </Group>
    </>
  );
}
