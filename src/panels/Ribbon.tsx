import React, { useEffect, useRef, useState } from 'react';
import brandIcon from '../../build/icon.svg';
import * as A from '../app/actions';
import { ARROW_PRESETS, GREEN_ARROW_STYLE, insertArrowPreset, type ArrowPreset } from '../app/arrowPresets';
import { makeElement } from '../model/defaults';
import { ElementView } from '../render/ElementView';
import type { PageSetup, PageTheme } from '../model/types';
import { PRINT_ISSUE_LEVEL, printIssues, STATUS_LABEL } from '../render/PrintPage';
import { headerColorValue, horizonNight, THEMES, themePatch, themeColor } from '../render/layout';
import { api } from '../services/api';
import { currentBuilding, currentFloor, currentVariantId, MAX_SYMBOL_WALL_GAP, useStore, type Tool, type ToolPresets } from '../store/store';
import { Icon } from '../ui/icons';
import { DropButton, MenuHead, MenuItem, MenuPane, MenuSep, RibbonCheck, useCloseMenu } from './RibbonMenu';

const DOOR_ICON: Record<string, string> = { single: 'door', double: 'doorDouble', sliding: 'doorSliding', slidingDouble: 'doorSlidingDouble', revolving: 'doorRevolving', opening: 'doorOpening', swingBoth: 'door', unequal: 'doorDouble', folding: 'door', foldingDouble: 'doorDouble', pocket: 'doorSliding', garage: 'doorOpening' };
const STAIR_ICON: Record<string, string> = { straight: 'stairs', landing: 'stairsLanding', escalator: 'escalator' };
const DOORS = [['single', 'Battante', 'door'], ['double', 'Double', 'doorDouble'], ['sliding', 'Coulissante', 'doorSliding'],
  ['slidingDouble', 'Coulissante double', 'doorSlidingDouble'], ['revolving', 'Tambour', 'doorRevolving'], ['opening', 'Baie libre', 'doorOpening'],
  ['swingBoth', 'Va-et-vient', 'door'], ['unequal', 'Tiercée', 'doorDouble'], ['folding', 'Pliante', 'door'], ['foldingDouble', 'Pliante double', 'doorDouble'],
  ['pocket', 'Galandage', 'doorSliding'], ['garage', 'Garage', 'doorOpening']] as const;
const SHAPES = [['rect', 'shapeRect', 'Rectangle'], ['ellipse', 'shapeEllipse', 'Ellipse'], ['triangle', 'shapeTriangle', 'Triangle'], ['diamond', 'shapeDiamond', 'Losange'],
  ['hexagon', 'shapeHexagon', 'Hexagone'], ['line', 'shapeLine', 'Ligne'], ['arrow', 'shapeArrow', 'Flèche pleine'], ['star', 'shapeStar', 'Étoile']] as const;

/** Vignette de galerie déroulante (ferme le menu au choix). */
function Tile({ icon, label, active, onPick }: { icon: string; label: string; active: boolean; onPick(): void }) {
  const close = useCloseMenu();
  return (
    <button className={active ? 'rb-tile on' : 'rb-tile'} title={label} onClick={() => { onPick(); close(); }}>
      <Icon name={icon} size={22} /><span>{label}</span>
    </button>
  );
}


type Tab = 'plan' | 'evac' | 'edit' | 'page' | 'check' | 'view';
/** Onglets dans l'ordre du travail : dessiner le plan, l'évacuation, mettre en page, vérifier et exporter. */
/** Couleur propre à chaque onglet (palette de l'Atelier) : on sait d'un coup d'œil dans quel menu on se trouve. */
const TAB_COLOR: Record<Tab, string> = {
  plan: '#1f6fd1', evac: '#00843d', edit: '#c26a00', page: '#7a4fc9', check: '#c4291c', view: '#4f6378',
};
const REDUCED_KEY = 'evac.ribbonReduced';
/** Six onglets calqués sur l'organisation d'EdrawMax (Accueil, Insérer, Conception, Symboles, Avancé, Affichage),
 *  avec des noms propres à l'Atelier. */
const TABS: { id: Tab; label: string; title: string }[] = [
  { id: 'edit', label: 'Atelier', title: 'Outils de base : sélection, presse-papiers, organiser, aligner, supprimer' },
  { id: 'plan', label: 'Construire', title: 'Plan de fond, étalonnage, murs, portes, fenêtres, escaliers, pièces, textes et formes' },
  { id: 'page', label: 'Habillage', title: 'Thème, couleur, papier, blocs de la page — tous les réglages dans l’aperçu' },
  { id: 'evac', label: 'Sécurité', title: 'Affiches, « Vous êtes ici », itinéraires, flèches, pictogrammes, légende, circulations probables' },
  { id: 'check', label: 'Contrôle', title: 'Statut, points à vérifier, aperçu, PDF, PNG, export du bâtiment' },
  { id: 'view', label: 'Vue', title: 'Zoom, grille, aimantage, règles, repères' },
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

/** Lance une commande de l'application (mêmes commandes que le menu Fichier de la fenêtre). */
export const runAppCommand = (action: string, arg?: string) => window.dispatchEvent(new CustomEvent('evac:command', { detail: { action, arg } }));

const FILE_ITEMS: ([string, string, string] | '-')[] = [
  ['new', 'Nouveau projet', 'Ctrl+N'], ['open', 'Ouvrir…', 'Ctrl+O'], '-',
  ['save', 'Enregistrer', 'Ctrl+S'], ['save-as', 'Enregistrer sous…', 'Ctrl+Maj+S'], ['duplicate-project', 'Dupliquer le projet…', ''], '-',
  ['import-background', 'Importer un plan de fond (DWG, DXF, SVG, PDF, image)…', ''], ['import-symbol', 'Importer un pictogramme…', ''], '-',
  ['print-preview', 'Aperçu et vérification', 'Ctrl+P'], ['export-pdf', 'Exporter cette affiche (PDF, PNG)…', 'Ctrl+E'], ['export-building', 'Exporter le bâtiment…', ''],
  ['export-dxf', 'Exporter le plan en DXF (AutoCAD, EdrawMax, Visio…)…', ''], ['export-dwg', 'Exporter le plan en DWG (AutoCAD)…', ''], ['export-svg', 'Exporter l’affiche en SVG (vectoriel)…', ''], '-',
  ['help', 'Guide d’utilisation', 'F1'], ['shortcuts', 'Raccourcis clavier', ''],
];

const BACKSTAGE: { title: string; items: [string, string, string, string][] }[] = [
  { title: 'Démarrer', items: [['new', 'new', 'Nouveau projet', 'Ctrl+N'], ['open', 'open', 'Ouvrir…', 'Ctrl+O']] },
  { title: 'Conserver', items: [['save', 'save', 'Enregistrer', 'Ctrl+S'],
    ['save-as', 'save', 'Enregistrer sous…', 'Ctrl+Maj+S'], ['duplicate-project', 'copy', 'Dupliquer le projet…', '']] },
  { title: 'Apporter', items: [['import-background', 'import', 'Plan de fond (DWG, DXF, SVG, PDF, image)…', ''], ['import-symbol', 'symbol', 'Pictogramme…', '']] },
  { title: 'Diffuser', items: [['print-preview', 'print', 'Aperçu et vérification', 'Ctrl+P'], ['export-pdf', 'pdf', 'Cette affiche (PDF, PNG)…', 'Ctrl+E'],
    ['export-building', 'building', 'Tout le bâtiment…', ''], ['export-dxf', 'layers', 'Plan en DXF (AutoCAD, EdrawMax, Visio…)…', ''],
    ['export-dwg', 'layers', 'Plan en DWG (AutoCAD)…', ''], ['export-svg', 'image', 'Affiche en SVG (vectoriel)…', '']] },
  { title: 'Assistance', items: [['help', 'help', 'Guide d’utilisation', 'F1'], ['shortcuts', 'textIcon', 'Raccourcis clavier', '']] },
];

/** Menu Fichier plein écran (« backstage ») : commandes à gauche, projets récents à droite. */
function FileMenu() {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    api().recentList().then(setRecent).catch(() => setRecent([]));
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  const go = (action: string, arg?: string) => { setOpen(false); runAppCommand(action, arg); };
  return (
    <div className="rb-file-wrap">
      <button className="rb-file" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>Dossier</button>
      {open && (
        <div className="backstage" role="dialog" aria-label="Dossier">
          <nav className="bs-nav">
            <button className="bs-back" onClick={() => setOpen(false)} title="Revenir au plan (Échap)">
              <span aria-hidden>←</span> Revenir au plan
            </button>
            {BACKSTAGE.map((sec) => (
              <div key={sec.title} className="bs-sec">
                <div className="bs-head">{sec.title}</div>
                {sec.items.map(([action, icon, label, key]) => (
                  <button key={action} onClick={() => go(action)}><Icon name={icon} size={17} /><span>{label}</span><kbd>{key}</kbd></button>
                ))}
              </div>
            ))}
          </nav>
          <section className="bs-main">
            <h2>Démarrer</h2>
            <div className="bs-cards">
              <button onClick={() => go('import-background')}><Icon name="import" size={26} /><b>Nouveau projet depuis un plan</b><span>PDF, image, DXF ou DWG</span></button>
              <button onClick={() => go('new')}><Icon name="new" size={26} /><b>Nouveau projet vide</b><span>Partir d’un étage vide</span></button>
              <button onClick={() => go('open')}><Icon name="open" size={26} /><b>Ouvrir un projet</b><span>Fichier .planevac</span></button>
            </div>
            <h2>Projets récents</h2>
            {recent.length === 0
              ? <p className="bs-empty">Aucun projet récent pour l’instant.</p>
              : <div className="bs-recent">{recent.slice(0, 10).map((p) => (
                  <button key={p} title={p} onClick={() => go('open-recent', p)}>
                    <Icon name="folder" size={18} /><span><b>{p.split(/[\\/]/).pop()}</b><small>{p}</small></span>
                  </button>))}</div>}
          </section>
        </div>
      )}
    </div>
  );
}

export function Ribbon({ onPrintPreview, onQuickExport }: { onPrintPreview(): void; onQuickExport(): void }) {
  const [tab, setTab] = useState<Tab>('edit');
  const [reduced, setReduced] = useState(() => { try { return localStorage.getItem(REDUCED_KEY) === '1'; } catch { return false; } });
  const toggleReduced = (v = !reduced) => { setReduced(v); try { localStorage.setItem(REDUCED_KEY, v ? '1' : '0'); } catch { /* sans stockage */ } };
  const pendingSymbol = useStore((s) => s.pendingSymbol);
  const newScope = useStore((s) => s.newScope);
  const showCirculation = useStore((s) => s.showCirculation);
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
    <header className={reduced ? 'ribbon reduced' : 'ribbon'} style={{ '--tab-c': TAB_COLOR[tab] } as React.CSSProperties}>
      <div className="rb-top">
        <div className="rb-brand" title="Atelier Plans d’Évacuation">
          <img src={brandIcon} width={22} height={22} alt="" />
        </div>
        <div className="rb-quick">
          <button title="Enregistrer (Ctrl+S)" onClick={() => A.saveProject(false)}><Icon name="save" size={16} /></button>
          <button title="Annuler (Ctrl+Z)" disabled={!canUndo} onClick={() => S().undo()}><Icon name="undo" size={16} /></button>
          <button title="Rétablir (Ctrl+Y)" disabled={!canRedo} onClick={() => S().redo()}><Icon name="redo" size={16} /></button>
        </div>
        <nav className="rb-tabs" role="tablist">
          <FileMenu />
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} title={`${t.title}
Double-clic : réduire ou déplier le ruban`}
              style={{ '--c': TAB_COLOR[t.id] } as React.CSSProperties}
              className={`${tab === t.id ? 'on' : ''}`}
              onClick={() => { setTab(t.id); if (reduced) toggleReduced(false); }} onDoubleClick={() => toggleReduced()}>
              {t.label}{t.id === 'edit' && sel > 0 && <span className="rb-count" title={`${sel} élément(s) sélectionné(s)`}>{sel}</span>}
            </button>
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

      {!reduced && <div className="rb-panel" key={tab}>
        {tab === 'plan' && (
          <>
            <Group title="Plan de fond">
              <Big icon="import" label="Importer un plan" onClick={() => A.importBackgroundAction()}
                title="Assistant d’import : PDF, image, DXF ou DWG ; étage, page, préparation du fond et échelle" />
              <Big icon="calibrate" label="Étalonner" active={tool === 'calibrate'} onClick={() => use('calibrate')} title="Étalonner l’échelle (K) — tracez une cote connue sur le plan et indiquez sa longueur réelle" />
            </Group>
            <Group title="Murs">
              <DropButton big icon={presets.wallThickness < 18 ? 'partition' : 'wall'} label={presets.wallThickness < 18 ? 'Cloison' : 'Mur'}
                active={tool === 'wall'} onMain={() => use('wall')} title="Mur (M) — cliquez point par point, double-clic pour terminer">
                <MenuItem icon="wall" label="Mur porteur épais" hint="M" active={presets.wallThickness >= 18} onClick={() => use('wall', { wallThickness: 22 })} />
                <MenuItem icon="partition" label="Cloison fine" active={presets.wallThickness < 18} onClick={() => use('wall', { wallThickness: 10 })} />
              </DropButton>
            </Group>
            <Group title="Ouvertures">
              <DropButton big icon={DOOR_ICON[presets.doorType] ?? 'door'} label="Porte" active={tool === 'door'} onMain={() => use('door')} title="Porte (P) — cliquez sur un mur">
                <MenuHead>Type de porte</MenuHead>
                {DOORS.map(([k, l, icon]) => (
                  <MenuItem key={k} icon={icon} label={l} active={presets.doorType === k} onClick={() => use('door', { doorType: k })} />
                ))}
                <MenuSep />
                <MenuItem check label="Porte coupe-feu (seuil rouge, « CF »)" active={!!presets.doorFire} keepOpen onClick={() => use('door', { doorFire: !presets.doorFire })} />
              </DropButton>
              <DropButton big icon={presets.windowShutter === 'rolling' ? 'shutterRolling' : presets.windowShutter === 'hinged' ? 'shutterHinged' : 'window'} label="Fenêtre"
                active={tool === 'window'} onMain={() => use('window')} title="Fenêtre (F) — cliquez sur un mur">
                <MenuHead>Type de fenêtre</MenuHead>
                {([['standard', 'Fenêtre simple'], ['casement', 'À battants'], ['sliding', 'Coulissante'], ['fixed', 'Fixe'], ['tilt', 'Soufflet']] as const).map(([k, l]) => (
                  <MenuItem key={k} icon="window" label={l} hint={k === 'standard' ? 'F' : undefined}
                    active={(presets.windowShutter ?? 'none') === 'none' && (presets.windowStyle ?? 'standard') === k} onClick={() => use('window', { windowShutter: 'none', windowStyle: k })} />
                ))}
                <MenuSep />
                <MenuHead>Avec volets</MenuHead>
                <MenuItem icon="shutterRolling" label="Avec volet roulant" active={presets.windowShutter === 'rolling'} onClick={() => use('window', { windowShutter: 'rolling' })} />
                <MenuItem icon="shutterHinged" label="Avec volets battants" active={presets.windowShutter === 'hinged'} onClick={() => use('window', { windowShutter: 'hinged' })} />
              </DropButton>
              <DropButton big icon={STAIR_ICON[presets.stairType] ?? 'stairs'} label="Escalier" active={tool === 'stairs'} onMain={() => use('stairs')}
                title="Escalier (E) — tracez un rectangle sur le plan">
                <MenuHead>Type d’escalier</MenuHead>
                {([['straight', 'Droit', 'stairs'], ['landing', 'En U avec palier', 'stairsLanding'], ['escalator', 'Escalator', 'escalator']] as const).map(([k, l, icon]) => (
                  <MenuItem key={k} icon={icon} label={l} active={presets.stairType === k} onClick={() => use('stairs', { stairType: k })} />
                ))}
                <MenuSep />
                <MenuItem check label="Flèche de sens" active={presets.stairArrow !== false} keepOpen
                  onClick={() => { const on = presets.stairArrow === false; use('stairs', on ? { stairArrow: true } : { stairArrow: false, stairSplit: true }); }} />
                <MenuItem check label="Séparation montée / descente" active={!!presets.stairSplit} keepOpen onClick={() => use('stairs', { stairSplit: !presets.stairSplit })} />
              </DropButton>
            </Group>
            <Group title="Espaces">
              <Big icon="room" label="Pièce" active={tool === 'room'} onClick={() => use('room')} title="Pièce (R) — tracez un rectangle, puis nommez-la" />
              <Big icon="zone" label="Zone" active={tool === 'zone'} onClick={() => use('zone')} title="Zone de danger, refuge… (Z)" />
            </Group>
            <Group title="Cotes et mesures">
              <Big icon="ruler" label="Cote" active={tool === 'dimension'} onClick={() => use('dimension')} title="Cote imprimée — cliquez le début, la fin, puis la position de la ligne de cote" />
              <Big icon="calibrate" label="Mesurer" active={tool === 'measure'} onClick={() => use('measure')} title="Mesurer une distance ou un parcours (rien n’est ajouté au plan)" />
            </Group>
            <Group title="Illustrations">
              <Big icon="textIcon" label="Texte" active={tool === 'text'} onClick={() => use('text')} title="Texte (T)" />
              <Big icon="image" label="Image / logo" onClick={() => A.insertImageAction()} />
              <DropButton big icon={SHAPES.find((x) => x[0] === presets.shape)?.[1] ?? 'shapeRect'} label="Formes" active={tool === 'shape'}
                onMain={() => use('shape')} title="Formes (S)">
                <MenuHead>Formes</MenuHead>
                <MenuPane>
                  <div className="rb-menu-grid">
                    {SHAPES.map(([k, icon, label]) => (
                      <Tile key={k} icon={icon} label={label} active={tool === 'shape' && presets.shape === k} onPick={() => use('shape', { shape: k })} />
                    ))}
                  </div>
                </MenuPane>
              </DropButton>
            </Group>
          </>
        )}

        {tab === 'evac' && (
          <>
            <Group title="Affiches">
              <Big icon="plus" label="Nouvelle affiche" onClick={() => A.createDisplayLocation()} title="Nouvelle affiche : un emplacement « Vous êtes ici » de cet étage" />
              <Big icon="symbol" label="Vous êtes ici" active={tool === 'symbol' && pendingSymbol === 'you-are-here'} onClick={() => S().setTool('symbol', 'you-are-here')}
                title="Placer le repère « Vous êtes ici » de l’affiche active" />
              {(floor?.variants.length ?? 0) > 1 && (
                <DropButton big icon="layers" label={newScope === 'all' ? 'Sur toutes' : 'Sur celle-ci'} title="Où vont les nouveaux éléments dessinés ou posés">
                  <MenuHead>Nouveaux éléments</MenuHead>
                  <MenuItem icon="layers" label="Sur toutes les affiches de l’étage" active={newScope === 'all'} onClick={() => S().setNewScope('all')} />
                  <MenuItem icon="image" label={`Seulement sur « ${variantName ?? ''} »`} active={newScope === 'variant'} onClick={() => S().setNewScope('variant')} />
                </DropButton>
              )}
            </Group>
            <Group title="Itinéraires">
              <Big icon="route" label="Principal" active={tool === 'route' && presets.routeKind === 'principal'} onClick={() => use('route', { routeKind: 'principal' })} title="Itinéraire principal (I) — cliquez les points de passage, double-clic pour terminer" />
              <Big icon="routeDashed" label="Secondaire" active={tool === 'route' && presets.routeKind === 'secondaire'} onClick={() => use('route', { routeKind: 'secondaire' })} />
            </Group>
            <Group title="Flèches d’évacuation">
              <div className="arrow-presets">
                {ARROW_PRESETS.slice(0, 6).map((p) => <ArrowPresetButton key={p.id} preset={p} />)}
              </div>
              {ARROW_PRESETS.length > 6 && (
                <DropButton big icon="plus" label="Toutes" title="Toutes les flèches prêtes à poser">
                  <MenuHead>Flèches prêtes à poser</MenuHead>
                  <MenuPane><div className="arrow-presets in-menu">{ARROW_PRESETS.map((p) => <ArrowPresetButton key={p.id} preset={p} />)}</div></MenuPane>
                </DropButton>
              )}
            </Group>
            <Group title="Pictogrammes">
              <Big icon="symbol" label="Bibliothèque" onClick={() => window.dispatchEvent(new CustomEvent('evac:show-library'))} title="Pictogrammes ISO 7010 et compléments (panneau Symboles)" />
              <Big icon="import" label="Importer un picto." onClick={() => A.importSymbolAction()} title="Importer un pictogramme SVG / PNG" />
              <Big icon="legendIcon" label="Légende" active={tool === 'legend'} onClick={() => use('legend')} title="Légende sur le plan (L)" />
            </Group>
            <Group title="Aide à la vérification">
              <Big icon="route" label="Circulations" active={showCirculation} onClick={() => S().toggleCirculation()}
                title="Circulations probables : chemin le plus court du repère vers une sortie et zones sans accès (non imprimé)" />
            </Group>
          </>
        )}

        {tab === 'edit' && (
          <>
            <Group title="Presse-papiers">
              <DropButton big icon="paste" label="Coller" onMain={() => S().paste()} title="Coller (Ctrl+V)">
                <MenuItem icon="paste" label="Coller" hint="Ctrl+V" onClick={() => S().paste()} />
                <MenuItem icon="copy" label="Dupliquer la sélection" hint="Ctrl+D" onClick={() => S().duplicateSelection()} disabled={!sel} />
              </DropButton>
              <div className="rb-items cols">
                <Small icon="cut" label="Couper" title="Couper (Ctrl+X)" onClick={() => S().cutSelection()} disabled={!sel} />
                <Small icon="copy" label="Copier" title="Copier (Ctrl+C)" onClick={() => S().copySelection()} disabled={!sel} />
                <Small icon="copy" label="Dupliquer" title="Dupliquer (Ctrl+D)" onClick={() => S().duplicateSelection()} disabled={!sel} />
              </div>
            </Group>
            <Group title="Outils">
              <DropButton big icon="select" label="Sélection" active={tool === 'select'} onMain={() => use('select')} title="Sélection (V)">
                <MenuItem icon="select" label="Outil Sélection" hint="V" active={tool === 'select'} onClick={() => use('select')} />
                <MenuItem icon="pan" label="Outil Main (déplacer la vue)" hint="H" active={tool === 'pan'} onClick={() => use('pan')} />
                <MenuSep />
                <MenuHead>Sélectionner d’un coup</MenuHead>
                <MenuItem icon="select" label="Les éléments semblables" onClick={() => S().selectWhere('similar')} disabled={!sel} />
                <MenuItem icon="room" label="Toutes les zones et pièces" onClick={() => S().selectWhere('areas')} />
                <MenuItem icon="text" label="Tous les textes" onClick={() => S().selectWhere('texts')} />
                <MenuItem icon="image" label="Tous les pictogrammes" onClick={() => S().selectWhere('symbols')} />
              </DropButton>
              <Big icon="pan" label="Main" active={tool === 'pan'} onClick={() => use('pan')} title="Déplacer la vue (H)" />
              <Big icon="textIcon" label="Texte" active={tool === 'text'} onClick={() => use('text')} title="Texte (T)" />
            </Group>
            <Group title="Organiser">
              <DropButton big icon="front" label="Position" disabled={!sel} title="Ordre de superposition">
                <MenuItem icon="front" label="Premier plan" onClick={() => S().reorderSelection('front')} />
                <MenuItem icon="forward" label="Avancer d’un cran" hint="Ctrl+Pg préc." onClick={() => S().reorderSelection('forward')} />
                <MenuItem icon="backward" label="Reculer d’un cran" hint="Ctrl+Pg suiv." onClick={() => S().reorderSelection('backward')} />
                <MenuItem icon="back" label="Arrière-plan" onClick={() => S().reorderSelection('back')} />
              </DropButton>
              <DropButton big icon="alignHCenter" label="Aligner" disabled={sel < 2} title="Aligner et répartir (2 éléments ou plus)">
                <MenuItem icon="alignLeft" label="Aligner à gauche" onClick={() => S().alignSelection('left')} />
                <MenuItem icon="alignHCenter" label="Centrer horizontalement" onClick={() => S().alignSelection('hcenter')} />
                <MenuItem icon="alignRight" label="Aligner à droite" onClick={() => S().alignSelection('right')} />
                <MenuSep />
                <MenuItem icon="alignTop" label="Aligner en haut" onClick={() => S().alignSelection('top')} />
                <MenuItem icon="alignVCenter" label="Centrer verticalement" onClick={() => S().alignSelection('vcenter')} />
                <MenuItem icon="alignBottom" label="Aligner en bas" onClick={() => S().alignSelection('bottom')} />
                <MenuSep />
                <MenuItem icon="distH" label="Répartir horizontalement" onClick={() => S().alignSelection('hdist')} />
                <MenuItem icon="distV" label="Répartir verticalement" onClick={() => S().alignSelection('vdist')} />
              </DropButton>
              <DropButton big icon="rotate" label="Rotation" disabled={!sel} title="Pivoter ou retourner">
                <MenuItem icon="rotate" label="Pivoter de 90° à droite" onClick={() => S().rotateSelection(90)} />
                <MenuItem icon="rotate" label="Pivoter de 90° à gauche" onClick={() => S().rotateSelection(-90)} />
                <MenuItem icon="rotate" label="Pivoter de 180°" onClick={() => S().rotateSelection(180)} />
                <MenuSep />
                <MenuItem icon="flipH" label="Retourner horizontalement" onClick={() => S().flipSelection('h')} />
                <MenuItem icon="flipV" label="Retourner verticalement" onClick={() => S().flipSelection('v')} />
              </DropButton>
              <DropButton big icon="group" label="Grouper" disabled={!sel} onMain={() => S().groupSelection()} title="Grouper (2 éléments ou plus)">
                <MenuItem icon="group" label="Grouper" onClick={() => S().groupSelection()} disabled={sel < 2} />
                <MenuItem icon="group" label="Dégrouper" onClick={() => S().ungroupSelection()} />
              </DropButton>
              <Big icon="lockOn" label="Verrouiller" onClick={() => S().toggleLockSelection()} disabled={!sel} title="Verrouiller / déverrouiller la sélection" />
            </Group>
            <Group title="Suppression">
              <Big icon="trash" label="Supprimer" onClick={() => S().deleteSelection()} disabled={!sel} title="Supprimer (Suppr)" />
            </Group>
          </>
        )}

        {tab === 'check' && floor && <CheckTab onPreview={onPrintPreview} onQuickExport={onQuickExport} />}
        {tab === 'page' && floor && <PageTab page={floor.page} onPreview={onPrintPreview} />}
        {tab === 'view' && <ViewTab />}
        <button className="rb-collapse" title="Réduire le ruban (double-clic sur un onglet pour le déplier)" onClick={() => toggleReduced(true)}>
          <Icon name="chevronDown" size={14} />
        </button>
      </div>}
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
  if (T.printStyle) {
    const left = T.blockPosition === 'left';
    const bottom = T.blockPosition === 'bottom';
    const planX = left ? 19 : 4;
    const cardX = left || bottom ? 4 : 42;
    const swatch = T.accent || accent;
    return (
      <button className={active ? 'theme-card on' : 'theme-card'} onClick={onClick} title={T.description}>
        <svg viewBox="0 0 60 42" width={60} height={42} aria-hidden="true">
          <rect width="60" height="42" fill={T.paperBg || '#fff'} />
          <rect x="4" y="2" width="52" height="9" rx={theme === 'indigo' ? 1.2 : 0} fill={head} />
          {theme === 'sienne' && <path d="M4 2v9h52" fill="none" stroke={swatch} strokeWidth="0.6" />}
          {left && <path d="M4 2h52" stroke={swatch} strokeWidth="0.8" />}
          <rect x="7" y="5.4" width="28" height="2.3" fill={T.headerFg} />
          <rect x="48" y="4" width="6" height="5" rx="0.7" fill="#faebe7" />
          <rect x="49" y="6" width="4" height="1.1" fill="#a1261e" />
          <rect x={planX} y="13" width={bottom ? 52 : 37} height={bottom ? 15 : 23} rx={T.planRadius * 0.28}
            fill="#fff" stroke={T.planStroke} strokeWidth="0.45" />
          <path d={bottom ? 'M19 23l8-6 8 5 8-6' : `M${planX + 5} 30l8-8 8 4 10-9`} fill="none" stroke="#00843d" strokeWidth="1.2" />
          <rect x={cardX} y={bottom ? 30 : 13} width="14" height={bottom ? 6 : 7} rx="0.5" fill={cardFill} />
          <rect x={cardX + (bottom ? 16 : 0)} y={bottom ? 30 : 21} width={bottom ? 17 : 14} height={bottom ? 6 : 7} rx="0.5" fill="#faebe7" />
          <rect x={cardX + (bottom ? 35 : 0)} y={bottom ? 30 : 29} width={bottom ? 17 : 14} height={bottom ? 6 : 7} rx="0.5" fill="#e7f5ed" />
          <rect x="4" y="38" width="52" height={bottom ? 0.7 : 2} fill={left ? T.ink : bottom ? swatch : cardFill} />
        </svg>
        <span>{T.name}</span>
      </button>
    );
  }
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
        {(T.extras === true ? [[11, 5.5], [17.8, 5.5], [24.6, 4.6], [30.4, 4.6]] : ed ? [[13, 10], [25, 10]] : [[11, 11], [24, 11]]).map(([y, h], i) => (
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
        {T.extras !== true && !ed && !grad && <rect x="45" y="26" width="7" height="1.6" fill="#d52b1e" />}
        {T.extras === true && <path d="M45 26 h5 v3 h4" fill="none" stroke={T.ink} strokeWidth="0.5" />}
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
    ['showTitleBlock', 'En-tête', 'layout'], ['showFooter', 'Cartouche', 'layout'], ['showLegend', 'Légende', 'legendIcon'], ['showInstructions', 'Consignes', 'textIcon'],
    ['showEmergencyNumbers', 'N° d’urgence', 'phone'], ['showAerial', 'Vue aérienne', 'image'], ['showSketch', 'Croquis', 'floor'],
    ['showScaleBar', 'Échelle', 'ruler'], ['showNorth', 'Nord', 'north'], ['showWatermark', 'Filigrane', 'watermark'],
  ];
  return (
    <>
      <Group title="Thème">
        <div className="theme-row">
          {(Object.keys(THEMES) as PageTheme[]).slice(0, 5).map((t) => <ThemeThumb key={t} theme={t} accent={page.accentColor} active={page.theme === t} onClick={() => set(themePatch(t))} />)}
        </div>
        <DropButton big icon="theme" label="Tous" title="Tous les thèmes de mise en page" wide>
          <MenuHead>Thèmes</MenuHead>
          <MenuPane>
            <div className="theme-row in-menu">
              {(Object.keys(THEMES) as PageTheme[]).map((t) => <ThemeThumb key={t} theme={t} accent={page.accentColor} active={page.theme === t} onClick={() => set(themePatch(t))} />)}
            </div>
          </MenuPane>
        </DropButton>
      </Group>
      <Group title="Couleurs">
        <DropButton big icon="fill" label="Accent" title="Couleur d’accent de l’affiche">
          <MenuHead>Couleur d’accent</MenuHead>
          <MenuPane>
            <div className="accent-row">
              {ACCENTS.map((c) => <button key={c} className={page.accentColor === c ? 'swatch on' : 'swatch'} style={{ background: c }} title={c} onClick={() => set({ accentColor: c })} />)}
            </div>
            <label className="rb-field rb-menu-field">Personnalisée <input type="color" value={page.accentColor} onChange={(e) => set({ accentColor: e.target.value })} /></label>
          </MenuPane>
        </DropButton>
        <DropButton big icon="layout" label="En-tête" title="Couleur de fond de l’en-tête">
          <MenuHead>Couleur de l’en-tête</MenuHead>
          <MenuPane>
            <label className="rb-field rb-menu-field">Couleur <input type="color" value={headerColorValue(page)} onChange={(e) => set({ headerColor: e.target.value })} /></label>
          </MenuPane>
          <MenuItem icon="theme" label="Couleur prévue par le thème" disabled={!page.headerColor} onClick={() => set({ headerColor: undefined })} />
        </DropButton>
      </Group>
      <Group title="Papier">
        <DropButton big icon="paper" label={`Taille : ${page.paper}`} title="Format du papier">
          <MenuHead>Format</MenuHead>
          {(['A4', 'A3', 'A2', 'A1', 'A0'] as const).map((p) => <MenuItem key={p} icon="paper" label={p} active={page.paper === p} onClick={() => set({ paper: p })} />)}
        </DropButton>
        <DropButton big icon={page.orientation} label="Orientation" title="Portrait ou paysage">
          <MenuItem icon="portrait" label="Portrait" active={page.orientation === 'portrait'} onClick={() => set({ orientation: 'portrait' })} />
          <MenuItem icon="landscape" label="Paysage" active={page.orientation === 'landscape'} onClick={() => set({ orientation: 'landscape' })} />
        </DropButton>
      </Group>
      <Group title="Disposition" cols>
        <button className="btn small" onClick={() => runAppCommand('layout-settings')}>Placer les blocs…</button>
        <label className="rb-field">Marges <input type="number" min={0} max={40} value={page.marginMm} onChange={(e) => set({ marginMm: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} /> mm</label>
      </Group>
      <Group title="Éléments de la page">
        <DropButton big icon="legendIcon" label="Blocs affichés" title="Choisir les blocs présents sur la page" wide>
          <MenuHead>Afficher sur la page</MenuHead>
          {toggles.map(([k, l]) => <MenuItem key={k} check keepOpen label={l} active={!!page[k]} onClick={() => set({ [k]: !page[k] } as any)} />)}
        </DropButton>
      </Group>
      <Group title="Réglages">
        <Big icon="paper" label="Tous les réglages" onClick={() => runAppCommand('layout-settings')} title="Échelle, zone imprimée, cadres, angle du nord… dans l’aperçu, page sous les yeux" />
        <Big icon="layout" label="Modèles" onClick={() => A.manageOrganizationTemplates()} title="Enregistrer ou appliquer un modèle d’organisation" />
      </Group>
    </>
  );
}

/** Onglet « Vérifier et exporter » : statut explicite, points à vérifier, sorties. */
function CheckTab({ onPreview, onQuickExport }: { onPreview(): void; onQuickExport(): void }) {
  const floor = useStore((s) => currentFloor(s))!;
  const building = useStore((s) => currentBuilding(s)) ?? undefined;
  const variantId = useStore((s) => currentVariantId(s));
  const S = useStore.getState;
  const variants = floor.variants;
  const checks = variants.map((v) => ({ v, n: printIssues(floor, v.id, floor.page, building).filter((i) => PRINT_ISSUE_LEVEL[i] === 'check').length }));
  const total = checks.reduce((n, c) => n + c.n, 0);
  const status = floor.titleBlock.status;
  return (
    <>
      <Group title="Statut de l’étage">
        <div className="rb-stack">
          <span className={`chip status-${status}`}>{STATUS_LABEL[status]}</span>
          {status !== 'validated' && (
            <div className="seg">
              <button className={status === 'draft' ? 'on' : ''} onClick={() => S().mutateFloor((f) => { f.titleBlock.status = 'draft'; f.titleBlock.validationReason = undefined; }, { keepValidation: true })}>Brouillon</button>
              <button className={status === 'to_validate' ? 'on' : ''} onClick={() => S().mutateFloor((f) => { f.titleBlock.status = 'to_validate'; f.titleBlock.validationReason = undefined; }, { keepValidation: true })}>À valider</button>
            </div>
          )}
        </div>
        <Big icon="check" label={status === 'validated' ? 'Validé' : 'Valider…'} disabled={status === 'validated'} onClick={() => A.validateAction()}
          title="Validation explicite : votre nom et la date sont inscrits dans le cartouche. Les alertes ne valident rien." />
      </Group>
      <Group title="Points à vérifier">
        <div className="rb-checks">
          {checks.map(({ v, n }) => (
            <button key={v.id} className={`rb-check${n ? ' warn' : ' ok'}${v.id === variantId ? ' on' : ''}`} onClick={() => { S().setVariant(v.id); onPreview(); }}
              title={n ? `${n} point(s) à vérifier sur « ${v.name} » — ouvrir l’aperçu` : `Rien à signaler sur « ${v.name} »`}>
              <span>{v.name}</span><b>{n ? `${n} à vérifier` : 'OK'}</b>
            </button>
          ))}
        </div>
        <Big icon="print" label={total ? `Vérifier (${total})` : 'Aperçu'} onClick={onPreview} title="Aperçu et vérification avant export (Ctrl+P)" />
      </Group>
      <Group title="Exporter">
        <Big icon="pdf" label="Cette affiche" onClick={onQuickExport} title="PDF ou PNG de l’affiche active (Ctrl+E)" />
        <Big icon="building" label="Bâtiment" onClick={() => runAppCommand('export-building')} title="Toutes les pages du bâtiment : un PDF regroupé ou un PDF par page" />
        <Big icon="print" label="Imprimer…" onClick={onPreview} title="L’impression se lance depuis l’aperçu" />
        <DropButton big icon="layers" label="Autres formats" title="Exporter le plan pour d’autres logiciels">
          <MenuItem icon="layers" label="Plan en DXF (AutoCAD, Visio…)" onClick={() => runAppCommand('export-dxf')} />
          <MenuItem icon="layers" label="Plan en DWG (AutoCAD)" onClick={() => runAppCommand('export-dwg')} />
          <MenuItem icon="image" label="Affiche en SVG (vectoriel)" onClick={() => runAppCommand('export-svg')} />
        </DropButton>
      </Group>
    </>
  );
}

function ViewTab() {
  const grid = useStore((s) => s.grid);
  const guides = useStore((s) => s.guides);
  const rulers = useStore((s) => s.rulers);
  const circulation = useStore((s) => s.showCirculation);
  const zoom = useStore((s) => s.view.zoom);
  const S = useStore.getState;
  const zoomBy = (k: number) => {
    const s = S();
    const el = document.querySelector('.canvas-wrap');
    const cx = (el?.clientWidth ?? 800) / 2, cy = (el?.clientHeight ?? 600) / 2;
    const z = Math.min(40, Math.max(0.002, s.view.zoom * k)), f = z / s.view.zoom;
    s.setView({ zoom: z, x: cx - (cx - s.view.x) * f, y: cy - (cy - s.view.y) * f });
  };
  return (
    <>
      <Group title="Afficher">
        <div className="rb-checks-col">
          <RibbonCheck label="Grille" checked={grid.show} onChange={(v) => S().setGrid({ show: v })} />
          <RibbonCheck label="Règles" checked={rulers} onChange={() => S().toggleRulers()} />
          <RibbonCheck label="Repères" checked={guides} onChange={() => S().toggleGuides()} />
          <RibbonCheck label="Circulations" checked={circulation} onChange={() => S().toggleCirculation()}
            title="Circulations probables : chemin le plus court vers une sortie et zones sans accès (non imprimées)" />
        </div>
      </Group>
      <Group title="Zoom">
        <Big icon="zoomIn" label="Avant" onClick={() => zoomBy(1.25)} />
        <Big icon="zoomOut" label="Arrière" onClick={() => zoomBy(0.8)} />
        <Big icon="fit" label="Page entière" onClick={() => S().requestFit()} />
        <DropButton big icon="zoomIn" label={`${Math.round(zoom * 100)} %`} title="Niveau de zoom">
          <MenuItem icon="fit" label="Page entière" onClick={() => S().requestFit()} />
          <MenuSep />
          {[25, 50, 75, 100, 150, 200, 400].map((z) => <MenuItem key={z} label={`${z} %`} active={Math.round(zoom * 100) === z} onClick={() => zoomBy(z / 100 / zoom)} />)}
        </DropButton>
      </Group>
      <Group title="Grille et aimantage">
        <DropButton big icon="grid" label="Grille" active={grid.show} title="Réglages de la grille" wide>
          <MenuItem check keepOpen label="Afficher la grille" active={grid.show} onClick={() => S().setGrid({ show: !grid.show })} />
          <MenuItem check keepOpen label="Magnétisme sur la grille" active={grid.snap} onClick={() => S().setGrid({ snap: !grid.snap })} />
          <MenuSep />
          <MenuPane>
            <div className="seg">
              <button className={grid.style === 'lines' ? 'on' : ''} onClick={() => S().setGrid({ style: 'lines' })}><Icon name="grid" size={14} /> Lignes</button>
              <button className={grid.style === 'dots' ? 'on' : ''} onClick={() => S().setGrid({ style: 'dots' })}><Icon name="dots" size={14} /> Points</button>
            </div>
            <label className="rb-field rb-menu-field">Pas
              <select value={grid.size} onChange={(e) => S().setGrid({ size: Number(e.target.value) })}>
                {[5, 10, 20, 25, 50, 100].map((v) => <option key={v} value={v}>{v} u</option>)}
              </select>
            </label>
            <label className="rb-field rb-menu-field">Maillage
              <select value={grid.majorEvery} onChange={(e) => S().setGrid({ majorEvery: Number(e.target.value) })}>
                {[2, 4, 5, 10].map((v) => <option key={v} value={v}>1 / {v}</option>)}
              </select>
            </label>
            <label className="rb-field rb-menu-field">Intensité
              <input type="range" min={0} max={1} step={0.05} value={grid.intensity} onChange={(e) => S().setGrid({ intensity: Number(e.target.value) })} />
            </label>
          </MenuPane>
        </DropButton>
        <Big icon="magnet" label="Magnétisme" active={grid.snap} onClick={() => S().setGrid({ snap: !grid.snap })} />
        <DropButton big icon="magnet" label="Pictos" active={grid.symbolSnapEnabled} onMain={() => S().setGrid({ symbolSnapEnabled: !grid.symbolSnapEnabled })}
          title="Aimantage des pictogrammes contre les murs" wide>
          <MenuItem check keepOpen label="Aimanter les pictogrammes aux murs" active={grid.symbolSnapEnabled} onClick={() => S().setGrid({ symbolSnapEnabled: !grid.symbolSnapEnabled })} />
          <MenuPane>
            <label className="rb-field rb-menu-field" title="Espace entre le bord du pictogramme et la face du mur après l’aimantage">
              Retrait des murs · {grid.symbolWallGap} u
              <input type="range" min={1} max={MAX_SYMBOL_WALL_GAP} step={1} value={grid.symbolWallGap}
                aria-label="Retrait des pictogrammes par rapport aux murs" disabled={!grid.symbolSnapEnabled}
                onChange={(e) => S().setGrid({ symbolWallGap: Number(e.target.value) })} />
            </label>
          </MenuPane>
        </DropButton>
      </Group>
    </>
  );
}
