import { useState } from 'react';
import { importSymbolAction } from '../app/actions';
import { ElementView, SymbolGraphic } from '../render/ElementView';
import { makeElement, newFloor } from '../model/defaults';
import type { DoorElement, Element, WindowElement } from '../model/types';
import { BUILTIN_SYMBOLS, SYMBOL_CATEGORIES } from '../symbols/library';
import { useStore } from '../store/store';
import { confirmDialog } from '../ui/dialogs';
import { Icon } from '../ui/icons';

/** Portes et fenêtres : éléments posés dans un mur (outils du ruban), proposés aussi dans la bibliothèque. */
type DoorKind = DoorElement['doorType'];
type WindowKind = NonNullable<WindowElement['windowStyle']>;
const OPENINGS: { key: string; name: string; door?: DoorKind; window?: WindowKind }[] = [
  { key: 'single', name: 'Porte battante', door: 'single' }, { key: 'double', name: 'Porte double', door: 'double' },
  { key: 'swingBoth', name: 'Porte va-et-vient', door: 'swingBoth' }, { key: 'unequal', name: 'Porte tiercée', door: 'unequal' },
  { key: 'sliding', name: 'Porte coulissante', door: 'sliding' }, { key: 'slidingDouble', name: 'Coulissante double', door: 'slidingDouble' },
  { key: 'pocket', name: 'Porte à galandage', door: 'pocket' }, { key: 'folding', name: 'Porte pliante', door: 'folding' },
  { key: 'foldingDouble', name: 'Pliante double', door: 'foldingDouble' }, { key: 'revolving', name: 'Porte tambour', door: 'revolving' },
  { key: 'garage', name: 'Porte de garage', door: 'garage' }, { key: 'opening', name: 'Baie libre', door: 'opening' },
  { key: 'w-standard', name: 'Fenêtre', window: 'standard' }, { key: 'w-casement', name: 'Fenêtre à battants', window: 'casement' },
  { key: 'w-sliding', name: 'Fenêtre coulissante', window: 'sliding' }, { key: 'w-fixed', name: 'Fenêtre fixe', window: 'fixed' },
  { key: 'w-tilt', name: 'Fenêtre à soufflet', window: 'tilt' },
];
const PREVIEW_FLOOR = newFloor('Aperçu', 0, 'BE');
const PREVIEW_CTX = { floor: PREVIEW_FLOOR, variantId: PREVIEW_FLOOR.variants[0].id, customSymbols: [], interactive: false, idPrefix: 'lib-' };

/** Petit dessin de la porte ou de la fenêtre dans un bout de mur. */
function OpeningPreview({ o }: { o: (typeof OPENINGS)[number] }) {
  const wide = o.door === 'garage' ? 1.6 : o.door && ['double', 'unequal', 'slidingDouble', 'foldingDouble', 'opening'].includes(o.door) ? 1.4 : 1;
  const w = 90 * wide;
  const el: Element = o.door
    ? makeElement('door', { x: 0, y: 0, width: w, doorType: o.door })
    : makeElement('window', { x: 0, y: 0, width: 120, depth: 18, panes: o.window === 'casement' ? 2 : 1, windowStyle: o.window });
  const half = (o.door ? w : 120) / 2;
  // vue cadrée sur l'ouverture et son débattement
  const vb = o.door === 'pocket' ? [-w * 1.5, -w * 0.9, w * 3, w * 1.8] : [-half - 20, -half - 10, half * 2 + 40, half * 2 + 20];
  return (
    <svg viewBox={vb.join(' ')} width={42} height={42} aria-hidden="true">
      <line x1={vb[0]} y1={0} x2={vb[0] + vb[2]} y2={0} stroke="#1d2630" strokeWidth={18} />
      <ElementView el={el} ctx={PREVIEW_CTX as never} />
    </svg>
  );
}

const OPEN_BY_DEFAULT = ['Évacuation', 'Lutte contre l’incendie', 'Premiers secours'];
const SYMBOL_PREFS = 'evac-symbol-prefs';

function loadSymbolPrefs(): { favorites: string[]; recent: string[] } {
  try {
    const data = JSON.parse(localStorage.getItem(SYMBOL_PREFS) ?? '{}');
    return { favorites: data.favorites ?? [], recent: data.recent ?? [] };
  } catch { return { favorites: [], recent: [] }; }
}

export function LibraryPanel() {
  const project = useStore((s) => s.project)!;
  const tool = useStore((s) => s.tool);
  const pending = useStore((s) => s.pendingSymbol);
  const [q, setQ] = useState('');
  const [prefs, setPrefs] = useState(loadSymbolPrefs);
  const updatePrefs = (next: typeof prefs) => {
    setPrefs(next);
    try { localStorage.setItem(SYMBOL_PREFS, JSON.stringify(next)); } catch { /* Préférences de la session. */ }
  };
  // Catégories les plus utilisées ouvertes au départ, les autres repliées.
  const [closed, setClosed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SYMBOL_CATEGORIES.filter((c) => !OPEN_BY_DEFAULT.includes(c)).map((c) => [c, true])));

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const all = [
    ...BUILTIN_SYMBOLS.map((s) => ({ id: s.id, name: s.name, category: s.category, code: s.code ?? '', custom: false })),
    ...project.customSymbols.map((s) => ({ id: s.id, name: s.name, category: s.category, code: '', custom: true })),
  ].filter((s) => !q || norm(`${s.name} ${s.code} ${s.category}`).includes(norm(q)));
  const cats = Array.from(new Set([...SYMBOL_CATEGORIES, ...project.customSymbols.map((s) => s.category)]));
  const pinned = (ids: string[]) => ids.flatMap((id) => all.find((s) => s.id === id) ?? []);
  const favoriteItems = pinned(prefs.favorites);
  const recentItems = pinned(prefs.recent);

  const allClosed = cats.every((c) => closed[c]);
  const toggleAll = () => setClosed(Object.fromEntries(cats.map((c) => [c, !allClosed])));

  const removeCustom = async (id: string, name: string) => {
    const used = project.buildings.some((b) => b.floors.some((f) => f.elements.some((e) => e.type === 'symbol' && e.symbolId === id)));
    if (!(await confirmDialog('Retirer le pictogramme', `Retirer « ${name} » de la bibliothèque du projet ?${used ? '\nAttention : il est utilisé sur au moins un plan.' : ''}`, 'Retirer', true))) return;
    useStore.getState().mutate((d) => { d.customSymbols = d.customSymbols.filter((s) => s.id !== id); });
  };
  const remember = (id: string) => updatePrefs({ ...prefs, recent: [id, ...prefs.recent.filter((x) => x !== id)].slice(0, 6) });
  const tiles = (items: typeof all) => (
    <div className="lib-grid">
      {items.map((s) => {
        const favorite = prefs.favorites.includes(s.id);
        const label = `${s.code ? s.code + ' — ' : ''}${s.name}`;
        return (
          <div className="lib-tile" key={s.id}>
            <button type="button" className={tool === 'symbol' && pending === s.id ? 'lib-item active' : 'lib-item'}
              draggable title={label} aria-label={label}
              onDragStart={(e) => { e.dataTransfer.setData('application/x-evac-symbol', s.id); e.dataTransfer.effectAllowed = 'copy'; remember(s.id); }}
              onClick={() => { remember(s.id); useStore.getState().setTool('symbol', s.id); }}>
              <svg viewBox="-23 -23 46 46" width={42} height={42} aria-hidden="true"><SymbolGraphic symbolId={s.id} size={42} custom={project.customSymbols} /></svg>
              <span>{s.name}</span>
              {s.code && <i className="code">{s.code}</i>}
            </button>
            <button type="button" className={favorite ? 'lib-star on' : 'lib-star'} aria-pressed={favorite}
              aria-label={`Favori · ${s.name}`} title={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              onClick={() => updatePrefs({ ...prefs, favorites: favorite ? prefs.favorites.filter((id) => id !== s.id) : [...prefs.favorites, s.id] })}>
              {favorite ? '★' : '☆'}
            </button>
            {s.custom && <button type="button" className="lib-del" title="Retirer" onClick={() => removeCustom(s.id, s.name)}>×</button>}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="panel-body lib">
      <div className="search-wrap">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="6" /><path d="M16 16 L21 21" /></svg>
        <input className="search" placeholder="Rechercher (nom ou code ISO, ex. F001)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un pictogramme" />
      </div>
      {!q && <button className="btn small full" onClick={toggleAll}>{allClosed ? 'Tout déplier' : 'Tout replier'}</button>}
      <p className="muted tiny">Cliquez puis cliquez sur le plan, ou glissez-déposez. Signaux ISO 7010 (domaine public / CC0) et dessins originaux (CC0).</p>
      {!q && favoriteItems.length > 0 && <section className="lib-cat"><h3>Favoris</h3>{tiles(favoriteItems)}</section>}
      {(() => {
        const items = OPENINGS.filter((o) => !q || norm(`${o.name} portes et fenetres`).includes(norm(q)));
        if (!items.length) return null;
        const c = 'Portes et fenêtres', isClosed = closed[c] && !q;
        const presets = useStore.getState().presets;
        return (
          <section className="lib-cat">
            <button className="lib-cat-head" onClick={() => setClosed({ ...closed, [c]: !closed[c] })} aria-expanded={!isClosed}>
              <span>{c}</span><em>{items.length}</em>
              <svg className={isClosed ? 'chev' : 'chev open'} width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5 L6 7.5 L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
            {!isClosed && (
              <div className="lib-grid">
                {items.map((o) => {
                  const active = o.door ? tool === 'door' && presets.doorType === o.door
                    : tool === 'window' && (presets.windowStyle ?? 'standard') === o.window && (presets.windowShutter ?? 'none') === 'none';
                  return (
                    <div className="lib-tile" key={o.key}>
                      <button type="button" className={active ? 'lib-item active' : 'lib-item'} title={`${o.name} — cliquez puis cliquez sur un mur`} aria-label={o.name}
                        onClick={() => {
                          const st = useStore.getState();
                          if (o.door) { st.setPreset({ doorType: o.door }); st.setTool('door'); }
                          else { st.setPreset({ windowStyle: o.window, windowShutter: 'none' }); st.setTool('window'); }
                        }}>
                        <OpeningPreview o={o} />
                        <span>{o.name}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })()}
      {!q && recentItems.length > 0 && <section className="lib-cat"><h3>Récents</h3>{tiles(recentItems)}</section>}
      {cats.map((c) => {
        const items = all.filter((s) => s.category === c);
        if (!items.length) return null;
        const isClosed = closed[c] && !q;
        return (
          <section key={c} className="lib-cat">
            <button className="lib-cat-head" onClick={() => setClosed({ ...closed, [c]: !closed[c] })} aria-expanded={!isClosed}>
              <span>{c}</span><em>{items.length}</em>
              <svg className={isClosed ? 'chev' : 'chev open'} width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5 L6 7.5 L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
            {!isClosed && tiles(items)}
          </section>
        );
      })}
      {all.length === 0 && <p className="muted small">Aucun pictogramme ne correspond à « {q} ».</p>}
      <button className="btn small full" onClick={() => importSymbolAction()}><Icon name="import" size={15} /> Importer un pictogramme (SVG, PNG)</button>
      <p className="muted tiny">
        Les pictogrammes sans code ISO sont des dessins originaux (CC0). Les symboles de plan (structure, mobilier, sanitaires, équipements) ne figurent pas dans la légende.
        Vérifiez toujours les exigences applicables dans votre pays.
      </p>
    </div>
  );
}
