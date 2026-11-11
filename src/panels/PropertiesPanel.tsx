import React, { useEffect, useRef, useState } from 'react';
import * as A from '../app/actions';
import { COUNTRIES, getCountry } from '../model/countries';
import { defaultShadow, EMERGENCY_NUMBERS, FONTS, LAYER_NAMES } from '../model/defaults';
import { boxOf, polygonArea, polylineLength } from '../model/geometry';
import type { DashStyle, Element, FillPattern, Floor, LayerId, PageSetup, PageTheme } from '../model/types';
import { symbolName } from '../render/ElementView';
import { FRAME_ZONES, frameOn, THEMES, themePatch } from '../render/layout';
import { STATUS_LABEL } from '../render/PrintPage';
import { SYMBOLS_BY_CATEGORY } from '../symbols/library';
import { currentBuilding, currentFloor, currentVariantId, useStore } from '../store/store';
import { confirmDialog } from '../ui/dialogs';
import { Icon } from '../ui/icons';
import { ThemeThumb } from './Ribbon';

// ——— Champs ———
function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div className="prop-row" title={hint}><span>{label}</span><div className="prop-ctl">{children}</div></div>;
}

const round = (v: number) => Math.round(v * 100) / 100;
function Num({ value, onChange, min, max, step = 1, suffix, width }: { value: number; onChange(v: number): void; min?: number; max?: number; step?: number; suffix?: string; width?: number }) {
  const [txt, setTxt] = useState(String(round(value)));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setTxt(String(round(value))); }, [value]);
  return (
    <span className="num">
      <input type="number" value={txt} min={min} max={max} step={step} style={width ? { width } : undefined}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setTxt(String(round(value))); }}
        onChange={(e) => {
          setTxt(e.target.value);
          const v = parseFloat(e.target.value.replace(',', '.'));
          if (!isNaN(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)));
        }} />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

function Slider({ value, onChange, min = 0, max = 1, step = 0.05, pct = true }: { value: number; onChange(v: number): void; min?: number; max?: number; step?: number; pct?: boolean }) {
  return (
    <span className="slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <em>{pct ? `${Math.round(value * 100)} %` : round(value)}</em>
    </span>
  );
}

const SWATCHES = ['#00843d', '#e30613', '#0f1b2a', '#4b5866', '#8795a3', '#1f4e8c', '#ef7d00', '#ffd400', '#eef2f6', '#ffffff'];
function Color({ value, onChange, allowNone }: { value: string; onChange(v: string): void; allowNone?: boolean }) {
  const [open, setOpen] = useState(false);
  const none = !value || value === 'none';
  return (
    <span className="color">
      <button type="button" className={none ? 'chip-color none' : 'chip-color'} style={{ background: none ? undefined : value }} onClick={() => setOpen(!open)} aria-label="Choisir une couleur" />
      <input type="text" value={none ? '' : value} placeholder={allowNone ? 'aucune' : ''} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      {open && (
        <div className="color-pop" onMouseLeave={() => setOpen(false)}>
          {SWATCHES.map((c) => <button key={c} type="button" style={{ background: c }} title={c} onClick={() => { onChange(c); setOpen(false); }} />)}
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} title="Couleur personnalisée" />
          {allowNone && <button type="button" className="none" title="Aucune" onClick={() => { onChange(''); setOpen(false); }} />}
        </div>
      )}
    </span>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, React.ReactNode, string?][]; onChange(v: T): void }) {
  return (
    <div className="seg">
      {options.map(([v, label, title]) => <button type="button" key={v} title={title} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="thumb" /></span>{label && <span className="tl">{label}</span>}
    </label>
  );
}

function Section({ title, icon, children, defaultOpen = true }: { title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={open ? 'psec open' : 'psec'}>
      <button className="psec-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={icon} size={15} /><span>{title}</span><svg className={open ? 'chev open' : 'chev'} width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5 L6 7.5 L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {open && <div className="psec-body">{children}</div>}
    </section>
  );
}

const DASHES: [DashStyle, React.ReactNode, string][] = [
  ['solid', <svg width="28" height="8"><line x1="1" y1="4" x2="27" y2="4" stroke="currentColor" strokeWidth="2" /></svg>, 'Continu'],
  ['dashed', <svg width="28" height="8"><line x1="1" y1="4" x2="27" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="6 4" /></svg>, 'Tirets'],
  ['dotted', <svg width="28" height="8"><line x1="2" y1="4" x2="27" y2="4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="0.1 4.5" /></svg>, 'Pointillé'],
  ['dashdot', <svg width="28" height="8"><line x1="1" y1="4" x2="27" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="7 3 0.1 3" /></svg>, 'Tiret-point'],
  ['longdash', <svg width="28" height="8"><line x1="1" y1="4" x2="27" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="11 4" /></svg>, 'Tirets longs'],
];
const PATTERNS: [FillPattern, string][] = [['solid', 'Uni'], ['none', 'Aucun'], ['hatch', 'Hachures'], ['crosshatch', 'Quadrillé'], ['vertical', 'Rayures'], ['dots', 'Points']];

// ——— Panneau ———
export function PropertiesPanel() {
  const floor = useStore((s) => currentFloor(s));
  const selection = useStore((s) => s.selection);
  if (!floor) return null;
  const sel = floor.elements.filter((e) => selection.includes(e.id));
  return (
    <aside className="props">
      {sel.length === 0 && <FloorProps floor={floor} />}
      {sel.length === 1 && <ElementProps key={sel[0].id} el={sel[0]} floor={floor} />}
      {sel.length > 1 && <MultiProps els={sel} />}
    </aside>
  );
}

const TYPE_LABEL: Record<string, string> = {
  wall: 'Mur', area: 'Pièce', door: 'Porte', window: 'Fenêtre', stairs: 'Escalier', symbol: 'Pictogramme',
  route: 'Itinéraire d’évacuation', text: 'Texte', image: 'Image', legend: 'Légende', shape: 'Forme',
};
const TYPE_ICON: Record<string, string> = {
  wall: 'wall', area: 'room', door: 'door', window: 'window', stairs: 'stairs', symbol: 'symbol', route: 'route', text: 'textIcon', image: 'image', legend: 'legendIcon', shape: 'shapeRect',
};

function MultiProps({ els }: { els: Element[] }) {
  const S = useStore.getState;
  const grouped = els.every((e) => e.groupId && e.groupId === els[0].groupId);
  const ids = new Set(els.map((e) => e.id));
  const batch = (patch: Record<string, unknown>, key: string) =>
    S().mutateFloor((f) => { f.elements.forEach((e) => { if (ids.has(e.id)) Object.assign(e, patch); }); }, { coalesce: `multi:${key}` });
  return (
    <div className="panel-body">
      <div className="props-head"><Icon name="group" size={18} /><div><h2>{els.length} éléments</h2><p className="muted small">{grouped ? 'Groupe' : 'Sélection multiple'}</p></div></div>
      <Section title="Aligner et répartir" icon="alignLeft">
        <div className="btn-grid">
          {([['left', 'alignLeft', 'À gauche'], ['hcenter', 'alignHCenter', 'Centrer horizontalement'], ['right', 'alignRight', 'À droite'], ['hdist', 'distH', 'Répartir horizontalement'],
            ['top', 'alignTop', 'En haut'], ['vcenter', 'alignVCenter', 'Centrer verticalement'], ['bottom', 'alignBottom', 'En bas'], ['vdist', 'distV', 'Répartir verticalement']] as const).map(([k, icon, label]) => (
            <button key={k} className="icon-btn boxed" title={label} onClick={() => S().alignSelection(k)}><Icon name={icon} /></button>
          ))}
        </div>
      </Section>
      <Section title="Apparence commune" icon="fill">
        <Row label="Opacité"><Slider value={els[0].opacity ?? 1} onChange={(v) => batch({ opacity: v }, 'opacity')} /></Row>
        <Row label="Calque">
          <select value={els[0].layer} onChange={(e) => batch({ layer: e.target.value }, 'layer')}>
            {(Object.keys(LAYER_NAMES) as LayerId[]).filter((l) => l !== 'background').map((l) => <option key={l} value={l}>{LAYER_NAMES[l]}</option>)}
          </select>
        </Row>
      </Section>
      <Section title="Organiser" icon="group">
        <div className="actions-grid">
          {grouped
            ? <button className="btn small" onClick={() => S().ungroupSelection()}><Icon name="group" size={15} /> Dégrouper</button>
            : <button className="btn small" onClick={() => S().groupSelection()}><Icon name="group" size={15} /> Grouper</button>}
          <button className="btn small" onClick={() => S().toggleLockSelection()}><Icon name="lockOn" size={15} /> Verrouiller</button>
        </div>
        <CommonActions />
      </Section>
    </div>
  );
}

function CommonActions() {
  const S = useStore.getState;
  return (
    <div className="actions-grid">
      <button className="btn small" onClick={() => S().rotateSelection(-90)} title="Pivoter de 90° à gauche"><Icon name="rotate" size={15} /> −90°</button>
      <button className="btn small" onClick={() => S().rotateSelection(90)} title="Pivoter de 90° à droite"><Icon name="rotate" size={15} /> +90°</button>
      <button className="btn small" onClick={() => S().flipSelection('h')}><Icon name="flipH" size={15} /> Miroir ↔</button>
      <button className="btn small" onClick={() => S().flipSelection('v')}><Icon name="flipV" size={15} /> Miroir ↕</button>
      <button className="btn small" onClick={() => S().reorderSelection('front')}><Icon name="front" size={15} /> Devant</button>
      <button className="btn small" onClick={() => S().reorderSelection('back')}><Icon name="back" size={15} /> Derrière</button>
      <button className="btn small" onClick={() => S().duplicateSelection()}><Icon name="copy" size={15} /> Dupliquer</button>
      <button className="btn small danger" onClick={() => S().deleteSelection()}><Icon name="trash" size={15} /> Supprimer</button>
    </div>
  );
}

function ElementProps({ el, floor }: { el: Element; floor: Floor }) {
  const variantId = useStore((s) => currentVariantId(s));
  const customSymbols = useStore((s) => s.project!.customSymbols);
  const hasText = ['text', 'symbol', 'area', 'shape', 'stairs', 'legend'].includes(el.type);
  const [tab, setTab] = useState<'style' | 'text' | 'layout'>(el.type === 'text' ? 'text' : 'style');
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const h = () => { setTab('text'); setTimeout(() => { textRef.current?.focus(); textRef.current?.select(); }, 30); };
    window.addEventListener('evac:focus-text', h);
    return () => window.removeEventListener('evac:focus-text', h);
  }, []);

  const upd = (patch: Record<string, unknown>, key = Object.keys(patch).join(',')) =>
    useStore.getState().mutateFloor((f) => {
      const x = f.elements.find((e) => e.id === el.id);
      if (x) Object.assign(x, patch);
    }, { coalesce: `${el.id}:${key}` });
  const e = el as any;
  const u = floor.unitsPerMeter;
  const variant = floor.variants.find((v) => v.id === variantId);
  const locked = !!el.locked;
  const shadow = el.shadow ?? defaultShadow();
  const setShadow = (p: Partial<typeof shadow>) => upd({ shadow: { ...shadow, ...p } }, `shadow:${Object.keys(p).join(',')}`);
  const len = (v: number) => (u > 0 ? `${(v / u).toFixed(2)} m` : `${Math.round(v)} u`);
  const title = el.type === 'area' && e.kind === 'zone' ? 'Zone' : el.type === 'shape' ? 'Forme' : TYPE_LABEL[el.type];

  return (
    <div className="panel-body">
      <div className="props-head">
        <span className="type-badge"><Icon name={TYPE_ICON[el.type]} size={18} /></span>
        <div>
          <h2>{title}</h2>
          <p className="muted small">{el.type === 'symbol' ? symbolName(e.symbolId, customSymbols) : LAYER_NAMES[el.layer]}{locked ? ' · verrouillé' : ''}</p>
          <button className="scope-link" onClick={() => setTab('layout')}>
            {el.variantId ? `Uniquement « ${floor.variants.find((v) => v.id === el.variantId)?.name ?? variant?.name} »`
              : el.excludedVariantIds?.length ? 'Commun · exceptions selon l’affiche' : 'Commun à toutes les versions'}
          </button>
        </div>
      </div>
      <div className="ptabs" role="tablist">
        <button className={tab === 'style' ? 'on' : ''} onClick={() => setTab('style')}><Icon name="fill" size={14} /> Style</button>
        {hasText && <button className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}><Icon name="textIcon" size={14} /> Texte</button>}
        <button className={tab === 'layout' ? 'on' : ''} onClick={() => setTab('layout')}><Icon name="layout" size={14} /> Disposition</button>
      </div>

      <fieldset disabled={locked}>
        {tab === 'style' && (
          <>
            {/* ——— Spécifique au type ——— */}
            {el.type === 'symbol' && (
              <Section title="Pictogramme" icon="symbol">
                <Row label="Signal">
                  <select value={e.symbolId} onChange={(ev) => upd({ symbolId: ev.target.value })}>
                    {SYMBOLS_BY_CATEGORY.map(([c, list]) => (
                      <optgroup key={c} label={c}>
                        {list.map((s) => <option key={s.id} value={s.id}>{s.code ? `${s.code} — ` : ''}{s.name}</option>)}
                      </optgroup>
                    ))}
                    {customSymbols.length > 0 && <optgroup label="Importés">{customSymbols.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
                  </select>
                </Row>
                <Row label="Taille"><Num value={e.size} min={8} max={1000} onChange={(v) => upd({ size: v })} suffix={u > 0 ? `${((e.size / u) * 100).toFixed(0)} cm` : 'u'} /></Row>
                <Row label="Pastille blanche" hint="Fond blanc derrière le pictogramme"><Toggle checked={e.halo} onChange={(v) => upd({ halo: v })} /></Row>
              </Section>
            )}
            {el.type === 'route' && (
              <>
                <Section title="Itinéraire" icon="route">
                  <Row label="Type">
                    <Seg value={e.kind} options={[['principal', 'Principal'], ['secondaire', 'Secondaire']]}
                      onChange={(v) => upd(v === 'secondaire' ? { kind: v, dash: 'dashed' } : { kind: v, dash: 'solid' })} />
                  </Row>
                  <Row label="Rayon des virages" hint="Raccorde les segments par des arcs (0 = angles nets)">
                    <Slider value={e.cornerRadius ?? 0} min={0} max={200} step={5} pct={false} onChange={(v) => upd({ cornerRadius: v, smooth: false })} />
                  </Row>
                  <Row label="Tracé lissé" hint="Courbe libre passant par tous les points"><Toggle checked={e.smooth} onChange={(v) => upd({ smooth: v })} /></Row>
                  <Row label="Style rapide">
                    <button className="btn small" onClick={() => upd({ color: '#00843d', width: 14, arrowStyle: 'open', arrowSize: 1, corner: 'round', outline: '', arrowRepeat: 0, dash: 'solid', cornerRadius: Math.max(e.cornerRadius ?? 0, 50) })}>
                      Flèche verte arrondie
                    </button>
                  </Row>
                  <Row label="Sens"><button className="btn small" onClick={() => upd({ points: [...e.points].reverse() })}>Inverser le sens</button></Row>
                  <p className="muted small">{e.points.length} points · {len(polylineLength(e.points))}. Glissez les carrés, glissez les ronds pour ajouter un point, double-clic pour supprimer.</p>
                </Section>
                <Section title="Flèches" icon="shapeArrow">
                  <Row label="Extrémités">
                    <span className="row gap">
                      <Toggle checked={e.arrowStart} onChange={(v) => upd({ arrowStart: v })} label="Départ" />
                      <Toggle checked={e.arrowEnd} onChange={(v) => upd({ arrowEnd: v })} label="Arrivée" />
                    </span>
                  </Row>
                  <Row label="Forme">
                    <select value={e.arrowStyle} onChange={(ev) => upd({ arrowStyle: ev.target.value })}>
                      <option value="triangle">Triangle</option><option value="stealth">Effilée</option><option value="open">Ouverte</option>
                      <option value="chevrons">Double chevron</option><option value="circle">Rond</option><option value="square">Carré</option>
                    </select>
                  </Row>
                  <Row label="Taille"><Slider value={e.arrowSize} min={0.5} max={3} step={0.1} pct={false} onChange={(v) => upd({ arrowSize: v })} /></Row>
                  <Row label="Chevrons répétés" hint="Petites flèches le long du tracé"><Num value={e.arrowRepeat} min={0} max={2000} step={10} onChange={(v) => upd({ arrowRepeat: v })} suffix={e.arrowRepeat ? 'u' : 'aucun'} /></Row>
                </Section>
              </>
            )}
            {el.type === 'door' && (
              <Section title="Porte" icon="door">
                <Row label="Type">
                  <select value={e.doorType} onChange={(ev) => upd({ doorType: ev.target.value })}>
                    <option value="single">Battante simple</option><option value="double">Double battant</option><option value="sliding">Coulissante</option>
                    <option value="revolving">Tambour</option><option value="opening">Baie libre</option>
                  </select>
                </Row>
                {e.doorType === 'single' && <Row label="Ouverture"><Seg value={e.swing} options={[['left', 'Gauche'], ['right', 'Droite']]} onChange={(v) => upd({ swing: v })} /></Row>}
                <Row label="Largeur"><Num value={e.width} min={20} max={800} onChange={(v) => upd({ width: v })} suffix={u > 0 ? `${((e.width / u) * 100).toFixed(0)} cm` : 'u'} /></Row>
                <Row label="Côté du débattement"><Seg value={e.flipY ? 'b' : 'a'} options={[['a', 'Côté A'], ['b', 'Côté B']]} onChange={(v) => upd({ flipY: v === 'b' })} /></Row>
                <Row label="Issue de secours" hint="Marquage vert sur le seuil"><Toggle checked={e.emergency} onChange={(v) => upd({ emergency: v })} /></Row>
                <Row label="Porte coupe-feu" hint="Marquage rouge sur le seuil, ajoutée à la légende"><Toggle checked={!!e.fireRated} onChange={(v) => upd({ fireRated: v })} /></Row>
                {e.fireRated && <Row label="Libellé" hint="Ex. CF, EI 30, EI 60 — vide : aucun libellé"><input type="text" value={e.fireRating ?? ''} maxLength={12} onChange={(ev) => upd({ fireRating: ev.target.value })} /></Row>}
              </Section>
            )}
            {el.type === 'window' && (
              <Section title="Fenêtre" icon="window">
                <Row label="Largeur"><Num value={e.width} min={20} max={1000} onChange={(v) => upd({ width: v })} suffix={u > 0 ? `${((e.width / u) * 100).toFixed(0)} cm` : 'u'} /></Row>
                <Row label="Épaisseur"><Num value={e.depth} min={2} max={80} onChange={(v) => upd({ depth: v })} /></Row>
                <Row label="Vantaux"><Num value={e.panes} min={1} max={8} onChange={(v) => upd({ panes: Math.round(v) })} /></Row>
              </Section>
            )}
            {el.type === 'stairs' && (
              <Section title="Escalier" icon="stairs">
                <Row label="Type">
                  <Seg value={e.stairType} options={[['straight', 'Droit'], ['landing', 'Palier'], ['escalator', 'Escalator']]} onChange={(v) => upd({ stairType: v })} />
                </Row>
                <Row label="Marches"><Num value={e.steps} min={2} max={80} onChange={(v) => upd({ steps: Math.round(v) })} /></Row>
                {e.stairType !== 'landing' && (
                  <Row label="Séparé au milieu"><Toggle checked={!!e.split} onChange={(v) => upd({ split: v })} /></Row>
                )}
                <Row label="Flèche de sens"><Toggle checked={e.arrow} onChange={(v) => upd({ arrow: v })} /></Row>
                {e.stairType !== 'landing' && e.split && <p className="muted small">Avec la séparation, la flèche indique la montée à gauche et la descente à droite. Désactivez-la pour placer vos propres flèches.</p>}
              </Section>
            )}
            {el.type === 'wall' && (
              <Section title="Mur" icon="wall">
                <Row label="Rendu"><Seg value={e.wallStyle} options={[['solid', 'Plein'], ['hatch', 'Hachuré'], ['outline', 'Contour']]} onChange={(v) => upd({ wallStyle: v })} /></Row>
                <Row label="Épaisseur"><Num value={e.thickness} min={1} max={200} onChange={(v) => upd({ thickness: v })} suffix={u > 0 ? `${((e.thickness / u) * 100).toFixed(0)} cm` : 'u'} /></Row>
                <Row label="Fermé"><Toggle checked={e.closed} onChange={(v) => upd({ closed: v })} /></Row>
                <p className="muted small">{e.points.length} points · longueur {len(polylineLength(e.points))}</p>
              </Section>
            )}
            {el.type === 'shape' && (
              <Section title="Forme" icon="shapeRect">
                <Row label="Type">
                  <select value={e.shape} onChange={(ev) => upd({ shape: ev.target.value })}>
                    <option value="rect">Rectangle</option><option value="ellipse">Ellipse</option><option value="triangle">Triangle</option><option value="diamond">Losange</option>
                    <option value="hexagon">Hexagone</option><option value="line">Ligne</option><option value="arrow">Flèche pleine</option><option value="star">Étoile</option>
                  </select>
                </Row>
                {e.shape === 'rect' && <Row label="Arrondi"><Num value={e.radius} min={0} max={500} onChange={(v) => upd({ radius: v })} /></Row>}
              </Section>
            )}
            {el.type === 'image' && (
              <Section title="Image" icon="image">
                <Row label="Coins arrondis"><Num value={e.radius} min={0} max={500} onChange={(v) => upd({ radius: v })} /></Row>
                <Row label="Bordure"><Color value={e.border} allowNone onChange={(v) => upd({ border: v })} /></Row>
              </Section>
            )}
            {el.type === 'legend' && (
              <Section title="Légende" icon="legendIcon">
                <Row label="Colonnes"><Num value={e.columns} min={1} max={4} onChange={(v) => upd({ columns: Math.round(v) })} /></Row>
                <Row label="Fond"><Color value={e.background} allowNone onChange={(v) => upd({ background: v })} /></Row>
                <Row label="Bordure"><Color value={e.border} allowNone onChange={(v) => upd({ border: v })} /></Row>
              </Section>
            )}

            {/* ——— Remplissage ——— */}
            {(el.type === 'area' || (el.type === 'shape' && e.shape !== 'line') || el.type === 'stairs') && (
              <Section title="Remplissage" icon="fill">
                {el.type !== 'stairs' && (
                  <Row label="Motif">
                    <select value={e.pattern} onChange={(ev) => upd({ pattern: ev.target.value })}>
                      {PATTERNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Row>
                )}
                {e.pattern !== 'none' && <Row label="Couleur"><Color value={e.fill} onChange={(v) => upd({ fill: v })} /></Row>}
                {el.type !== 'stairs' && e.pattern !== 'none' && <Row label="Opacité"><Slider value={e.fillOpacity} onChange={(v) => upd({ fillOpacity: v })} /></Row>}
                {el.type !== 'stairs' && !['solid', 'none'].includes(e.pattern) && <Row label="Couleur du motif"><Color value={e.patternColor} onChange={(v) => upd({ patternColor: v })} /></Row>}
              </Section>
            )}

            {/* ——— Trait ——— */}
            {['area', 'shape', 'route', 'wall', 'door', 'window', 'stairs'].includes(el.type) && (
              <Section title="Trait" icon="stroke">
                <Row label="Couleur"><Color value={el.type === 'area' || el.type === 'shape' ? e.stroke : e.color} allowNone={el.type === 'area' || el.type === 'shape'}
                  onChange={(v) => upd(el.type === 'area' || el.type === 'shape' ? { stroke: v } : { color: v })} /></Row>
                {(el.type === 'area' || el.type === 'shape') && <Row label="Épaisseur"><Num value={e.strokeWidth} min={0} max={100} step={0.5} onChange={(v) => upd({ strokeWidth: v })} /></Row>}
                {el.type === 'route' && <Row label="Épaisseur"><Num value={e.width} min={1} max={80} onChange={(v) => upd({ width: v })} /></Row>}
                {(el.type === 'area' || el.type === 'shape' || el.type === 'route') && (
                  <Row label="Style"><Seg value={e.dash} options={DASHES} onChange={(v) => upd({ dash: v })} /></Row>
                )}
                {el.type === 'route' && (
                  <>
                    <Row label="Angles"><Seg value={e.corner} options={[['round', 'Arrondis'], ['miter', 'Vifs'], ['bevel', 'Biseautés']]} onChange={(v) => upd({ corner: v })} /></Row>
                    <Row label="Liseré" hint="Contour autour du tracé pour la lisibilité"><Color value={e.outline} allowNone onChange={(v) => upd({ outline: v })} /></Row>
                  </>
                )}
              </Section>
            )}

            {/* ——— Ombre et effets ——— */}
            <Section title="Ombre et effets" icon="shadow" defaultOpen={false}>
              <Row label="Opacité"><Slider value={el.opacity ?? 1} onChange={(v) => upd({ opacity: v })} /></Row>
              <Row label="Ombre portée"><Toggle checked={shadow.enabled} onChange={(v) => setShadow({ enabled: v })} /></Row>
              {shadow.enabled && (
                <>
                  <Row label="Couleur"><Color value={shadow.color} onChange={(v) => setShadow({ color: v })} /></Row>
                  <Row label="Intensité"><Slider value={shadow.opacity} onChange={(v) => setShadow({ opacity: v })} /></Row>
                  <Row label="Flou"><Num value={shadow.blur} min={0} max={60} onChange={(v) => setShadow({ blur: v })} /></Row>
                  <Row label="Décalage"><span className="row gap"><Num value={shadow.dx} width={52} onChange={(v) => setShadow({ dx: v })} /><Num value={shadow.dy} width={52} onChange={(v) => setShadow({ dy: v })} /></span></Row>
                </>
              )}
            </Section>
          </>
        )}

        {tab === 'text' && <TextTab el={el} upd={upd} textRef={textRef} floor={floor} />}

        {tab === 'layout' && (
          <>
            <Section title="Position et taille" icon="layout">
              {'x' in e && (
                <Row label="Position (X, Y)"><span className="row gap"><Num value={e.x} width={64} onChange={(v) => upd({ x: v })} /><Num value={e.y} width={64} onChange={(v) => upd({ y: v })} /></span></Row>
              )}
              {(el.type === 'image' || el.type === 'shape' || el.type === 'stairs') && (
                <Row label="Taille (L, H)"><span className="row gap"><Num value={e.w} width={64} min={1} onChange={(v) => upd({ w: v })} /><Num value={e.h} width={64} min={0} onChange={(v) => upd({ h: v })} /></span></Row>
              )}
              {'points' in e && <p className="muted small">Emprise : {(() => { const b = boxOf(el); return b ? '' : ''; })()}{e.points.length} sommets{el.type === 'area' && u > 0 ? ` · surface ${(polygonArea(e.points) / (u * u)).toFixed(1)} m²` : ''}</p>}
              {'x' in e && el.type !== 'legend' && (
                <>
                  <Row label="Rotation"><Num value={e.rotation} min={-360} max={360} onChange={(v) => upd({ rotation: ((v % 360) + 360) % 360 })} suffix="°" /></Row>
                  <Row label=""><div className="seg">{[0, 90, 180, 270].map((a) => <button key={a} className={e.rotation === a ? 'on' : ''} onClick={() => upd({ rotation: a })}>{a}°</button>)}</div></Row>
                </>
              )}
            </Section>
            <Section title="Calque et visibilité" icon="layers">
              <Row label="Calque">
                <select value={el.layer} onChange={(ev) => upd({ layer: ev.target.value as LayerId })}>
                  {(Object.keys(LAYER_NAMES) as LayerId[]).filter((l) => l !== 'background').map((l) => <option key={l} value={l}>{LAYER_NAMES[l]}</option>)}
                </select>
              </Row>
              <Row label="Versions">
                <select value={el.variantId ? 'own' : el.excludedVariantIds?.length ? 'shared' : 'all'}
                  onChange={(ev) => upd({ variantId: ev.target.value === 'own' ? variantId : undefined, excludedVariantIds: undefined })}>
                  <option value="all">Toutes les versions</option>
                  <option value="own">Uniquement « {variant?.name} »</option>
                  {!!el.excludedVariantIds?.length && <option value="shared" disabled>Commun avec exceptions</option>}
                </select>
              </Row>
            </Section>
          </>
        )}
      </fieldset>
      <div className="lock-row">
        <Toggle checked={locked} onChange={(v) => upd({ locked: v })} label="Verrouiller l’élément" />
        {el.groupId && <button className="link" onClick={() => useStore.getState().ungroupSelection()}>Dégrouper</button>}
      </div>
      {!locked && <Section title="Actions" icon="rotate"><CommonActions /></Section>}
    </div>
  );
}

function TextTab({ el, upd, textRef, floor }: { el: Element; upd(p: Record<string, unknown>, k?: string): void; textRef: React.RefObject<HTMLTextAreaElement | null>; floor: Floor }) {
  const e = el as any;
  if (el.type === 'text') {
    return (
      <>
        <Section title="Contenu" icon="textIcon">
          <textarea ref={textRef} className="ta" rows={4} value={e.text} onChange={(ev) => upd({ text: ev.target.value })} />
          <button className="btn small" onClick={() => upd({ text: floor.titleBlock.instructions, fontSize: 14, background: '#ffffff', border: true })}>Insérer les consignes du plan</button>
        </Section>
        <Section title="Police" icon="textIcon">
          <Row label="Famille">
            <select value={e.fontFamily} onChange={(ev) => upd({ fontFamily: ev.target.value })} style={{ fontFamily: e.fontFamily }}>
              {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
          </Row>
          <Row label="Taille"><Num value={e.fontSize} min={4} max={400} onChange={(v) => upd({ fontSize: v })} /></Row>
          <Row label="Couleur"><Color value={e.color} onChange={(v) => upd({ color: v })} /></Row>
          <Row label="Style">
            <div className="seg">
              <button className={e.bold ? 'on' : ''} onClick={() => upd({ bold: !e.bold })} title="Gras"><b>G</b></button>
              <button className={e.italic ? 'on' : ''} onClick={() => upd({ italic: !e.italic })} title="Italique"><i>I</i></button>
              <button className={e.underline ? 'on' : ''} onClick={() => upd({ underline: !e.underline })} title="Souligné"><u>S</u></button>
              <button className={e.uppercase ? 'on' : ''} onClick={() => upd({ uppercase: !e.uppercase })} title="Majuscules">AB</button>
            </div>
          </Row>
          <Row label="Alignement"><Seg value={e.align} options={[['start', 'Gauche'], ['middle', 'Centre'], ['end', 'Droite']]} onChange={(v) => upd({ align: v })} /></Row>
        </Section>
        <Section title="Paragraphe" icon="layout">
          <Row label="Interligne"><Slider value={e.lineHeight} min={0.9} max={2.5} step={0.05} pct={false} onChange={(v) => upd({ lineHeight: v })} /></Row>
          <Row label="Espacement"><Num value={e.letterSpacing} min={-5} max={40} step={0.5} onChange={(v) => upd({ letterSpacing: v })} /></Row>
        </Section>
        <Section title="Cadre" icon="shapeRect">
          <Row label="Fond"><Color value={e.background} allowNone onChange={(v) => upd({ background: v })} /></Row>
          <Row label="Bordure"><Toggle checked={e.border} onChange={(v) => upd({ border: v })} /></Row>
          {e.border && <Row label="Couleur bordure"><Color value={e.borderColor} onChange={(v) => upd({ borderColor: v })} /></Row>}
          <Row label="Arrondi"><Num value={e.radius} min={0} max={100} onChange={(v) => upd({ radius: v })} /></Row>
          <Row label="Marge interne"><Slider value={e.padding} min={0} max={2} step={0.1} pct={false} onChange={(v) => upd({ padding: v })} /></Row>
        </Section>
      </>
    );
  }
  if (el.type === 'symbol') {
    const sx = e.stretchX ?? 1, sy = e.stretchY ?? 1;
    return (
      <>
      <Section title="Étirement" icon="layout">
        <Row label="Largeur"><Num value={Math.round(sx * 100)} min={15} max={1200} onChange={(v) => upd({ stretchX: Math.max(0.15, v / 100) })} suffix="%" /></Row>
        <Row label="Hauteur"><Num value={Math.round(sy * 100)} min={15} max={1200} onChange={(v) => upd({ stretchY: Math.max(0.15, v / 100) })} suffix="%" /></Row>
        {(sx !== 1 || sy !== 1) && <button className="btn small" onClick={() => upd({ stretchX: 1, stretchY: 1 })}>Proportions d’origine</button>}
        <Row label="Fusionner" hint="Collé à un autre panneau, la séparation (liseré blanc) disparaît"><Toggle checked={e.fuse !== false} onChange={(v) => upd({ fuse: v })} /></Row>
        <p className="muted tiny">Glissez les poignées des côtés sur le plan pour étirer ; les coins gardent les proportions.</p>
      </Section>
      <Section title="Libellé" icon="textIcon">
        <Row label="Texte"><input type="text" value={e.label} placeholder="(aucun)" onChange={(ev) => upd({ label: ev.target.value })} /></Row>
        <Row label="Position"><Seg value={e.labelPosition} options={[['below', 'Dessous'], ['above', 'Dessus'], ['right', 'Droite'], ['left', 'Gauche']]} onChange={(v) => upd({ labelPosition: v })} /></Row>
        <Row label="Taille"><Num value={e.labelSize} min={0} max={200} onChange={(v) => upd({ labelSize: v })} suffix={e.labelSize ? '' : 'auto'} /></Row>
        <Row label="Couleur"><Color value={e.labelColor} onChange={(v) => upd({ labelColor: v })} /></Row>
      </Section>
      </>
    );
  }
  if (el.type === 'area') {
    return (
      <Section title="Nom de la pièce" icon="textIcon">
        <textarea ref={textRef} className="ta" rows={2} value={e.label} onChange={(ev) => upd({ label: ev.target.value })} />
        <Row label="Taille"><Num value={e.labelSize} min={4} max={200} onChange={(v) => upd({ labelSize: v })} /></Row>
        <Row label="Couleur"><Color value={e.labelColor} onChange={(v) => upd({ labelColor: v })} /></Row>
        <Row label="Gras"><Toggle checked={e.labelBold} onChange={(v) => upd({ labelBold: v })} /></Row>
        <Row label="Afficher la surface" hint="Nécessite l’étalonnage de l’échelle"><Toggle checked={e.showArea} onChange={(v) => upd({ showArea: v })} /></Row>
        <Row label="Décalage (X, Y)"><span className="row gap"><Num value={e.labelDx} width={60} onChange={(v) => upd({ labelDx: v })} /><Num value={e.labelDy} width={60} onChange={(v) => upd({ labelDy: v })} /></span></Row>
      </Section>
    );
  }
  if (el.type === 'shape') {
    return (
      <Section title="Texte dans la forme" icon="textIcon">
        <textarea ref={textRef} className="ta" rows={2} value={e.text} onChange={(ev) => upd({ text: ev.target.value })} />
        <Row label="Taille"><Num value={e.textSize} min={4} max={200} onChange={(v) => upd({ textSize: v })} /></Row>
        <Row label="Couleur"><Color value={e.textColor} onChange={(v) => upd({ textColor: v })} /></Row>
      </Section>
    );
  }
  if (el.type === 'stairs') {
    return <Section title="Libellé" icon="textIcon"><Row label="Texte"><input type="text" value={e.label} placeholder="ex. Vers étage 1" onChange={(ev) => upd({ label: ev.target.value })} /></Row></Section>;
  }
  if (el.type === 'legend') {
    return (
      <Section title="Légende" icon="textIcon">
        <Row label="Titre"><input type="text" value={e.title} onChange={(ev) => upd({ title: ev.target.value })} /></Row>
        <Row label="Taille"><Num value={e.fontSize} min={4} max={100} onChange={(v) => upd({ fontSize: v })} /></Row>
      </Section>
    );
  }
  return null;
}

// ——— Propriétés du plan (aucune sélection) ———
function FloorProps({ floor }: { floor: Floor }) {
  const [tab, setTab] = useState<'plan' | 'page' | 'bg'>('plan');
  return (
    <div className="panel-body">
      <div className="props-head">
        <span className="type-badge"><Icon name="floor" size={18} /></span>
        <div><h2>{floor.name}</h2><p className="muted small">Aucun élément sélectionné</p></div>
      </div>
      <div className="ptabs" role="tablist">
        <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}><Icon name="layout" size={14} /> Plan</button>
        <button className={tab === 'page' ? 'on' : ''} onClick={() => setTab('page')}><Icon name="paper" size={14} /> Page</button>
        <button className={tab === 'bg' ? 'on' : ''} onClick={() => setTab('bg')}><Icon name="image" size={14} /> Fond</button>
      </div>
      {tab === 'plan' && <PlanTab floor={floor} />}
      {tab === 'page' && <PageSettings page={floor.page} />}
      {tab === 'bg' && <BackgroundTab floor={floor} />}
    </div>
  );
}

function PlanTab({ floor }: { floor: Floor }) {
  const project = useStore((s) => s.project)!;
  const building = useStore((s) => currentBuilding(s));
  const tb = floor.titleBlock;
  const S = useStore.getState;
  const setTb = (patch: Partial<typeof tb>, key = Object.keys(patch).join(',')) => {
    const reason = patch.instructions !== undefined && patch.instructions !== tb.instructions ? 'Consignes modifiées depuis la validation'
      : patch.emergencyNumbers !== undefined && patch.emergencyNumbers !== tb.emergencyNumbers ? 'Numéros d’urgence modifiés depuis la validation' : undefined;
    S().mutateFloor((f) => { Object.assign(f.titleBlock, patch); },
      { keepValidation: !reason, validationReason: reason, coalesce: `tb:${floor.id}:${key}` });
  };
  return (
    <>
      <section className={`status-box status-${tb.status}`}>
        <div className="row between"><span className="small">Statut du plan</span><span className={`chip status-${tb.status}`}>{STATUS_LABEL[tb.status]}</span></div>
        {tb.status === 'to_validate' && tb.validationReason && <p className="small">{tb.validationReason}.</p>}
        {tb.status === 'validated' ? (
          <>
            <p className="small">Validé par <b>{tb.validatedBy}</b> le {new Date(tb.validatedAt).toLocaleString('fr-BE')}.</p>
            <button className="btn small" onClick={() => setTb({ status: 'to_validate', validatedAt: '', validatedBy: '' })}>Retirer la validation</button>
          </>
        ) : (
          <div className="row gap">
            <Seg value={tb.status} options={[['draft', 'Brouillon'], ['to_validate', 'À valider']]} onChange={(v) => setTb({ status: v, validationReason: undefined })} />
            <button className="btn small primary" onClick={() => A.validateAction()}><Icon name="check" size={15} /> Valider…</button>
          </div>
        )}
      </section>
      <Section title="Bâtiment et étage" icon="building">
        <Row label="Bâtiment">
          <input type="text" value={building?.name ?? ''} placeholder="Ex. Bâtiment A"
            onChange={(e) => { const v = e.target.value; S().mutate((d) => { const b = d.buildings.find((x) => x.id === building?.id); if (b) b.name = v; }, { coalesce: 'bld:name' }); }} />
        </Row>
        <Row label="Étage">
          <input type="text" value={floor.name} placeholder="Ex. Niveau 0" list="floor-name-suggestions"
            onChange={(e) => { const v = e.target.value; S().mutateFloor((f) => { f.name = v; }, { keepValidation: true, coalesce: 'floor:name' }); }} />
          <datalist id="floor-name-suggestions">
            {['Niveau -1', 'Niveau 0', 'Niveau 1', 'Niveau 2', 'Niveau 3', 'Rez-de-chaussée', 'Sous-sol', '1er étage', '2e étage'].map((n) => <option key={n} value={n} />)}
          </datalist>
        </Row>
        <p className="muted small">Ces noms apparaissent dans l’en-tête du plan (si le sous-titre est vide) et dans le cartouche.</p>
      </Section>
      <Section title="Cartouche" icon="layout">
        <Row label="Titre"><input type="text" value={tb.title} onChange={(e) => setTb({ title: e.target.value })} /></Row>
        <Row label="Sous-titre"><input type="text" value={tb.subtitle} placeholder="Adresse, zone…" onChange={(e) => setTb({ subtitle: e.target.value })} /></Row>
        <Row label="Auteur"><input type="text" value={tb.author} onChange={(e) => setTb({ author: e.target.value })} /></Row>
        <Row label="Organisation"><input type="text" value={tb.organization} onChange={(e) => setTb({ organization: e.target.value })} /></Row>
        <Row label="Date"><input type="date" value={tb.date} onChange={(e) => setTb({ date: e.target.value })} /></Row>
        <Row label="Version"><input type="text" value={tb.version} onChange={(e) => setTb({ version: e.target.value })} /></Row>
        <Row label="Logo">
          <span className="row gap">
            {tb.logo && <img src={tb.logo} alt="" className="logo-thumb" />}
            <button className="btn small" onClick={() => A.pickLogoAction()}>{tb.logo ? 'Changer' : 'Choisir…'}</button>
            {tb.logo && <button className="btn small" onClick={() => setTb({ logo: '' })}>Retirer</button>}
          </span>
        </Row>
        <Row label="Vue aérienne">
          <span className="row gap">
            {tb.aerialImage && <img src={tb.aerialImage} alt="" className="logo-thumb" />}
            <button className="btn small" onClick={() => A.pickAerialAction()} title="Photo vue du ciel du site (capture satellite, plan masse…)">{tb.aerialImage ? 'Changer' : 'Choisir…'}</button>
            {tb.aerialImage && <button className="btn small" onClick={() => setTb({ aerialImage: '' })}>Retirer</button>}
          </span>
        </Row>
      </Section>
      <Section title="Numéros d’urgence" icon="phone">
        <input className="full-input" type="text" value={tb.emergencyNumbers} onChange={(e) => setTb({ emergencyNumbers: e.target.value })} />
        <button className="btn small" onClick={() => setTb({ emergencyNumbers: EMERGENCY_NUMBERS[project.country] ?? EMERGENCY_NUMBERS.INT })}>Numéros du pays</button>
      </Section>
      <Section title="Consignes" icon="textIcon">
        <textarea id="floor-instructions" aria-label="Consignes" className="ta instructions" rows={9} value={tb.instructions} onChange={(e) => setTb({ instructions: e.target.value })} />
        <p className="muted tiny">Lignes en MAJUSCULES = titres colorés ; « 1. … » = étapes numérotées.</p>
        <button className="btn small" onClick={async () => {
          if (await confirmDialog('Rétablir les consignes', `Remplacer le texte par le modèle « ${getCountry(project.country).name} » ?`, 'Remplacer')) setTb({ instructions: getCountry(project.country).instructions });
        }}>Modèle du pays</button>
      </Section>
      <Section title="Projet" icon="building" defaultOpen={false}>
        <Row label="Pays (modèles)">
          <select value={project.country} onChange={(e) => S().mutate((d) => { d.country = e.target.value; })}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Row>
        <p className="muted tiny">{getCountry(project.country).references}</p>
      </Section>
    </>
  );
}

export function PageSettings({ page }: { page: PageSetup }) {
  const set = (patch: Partial<PageSetup>) =>
    useStore.getState().mutateFloor((f) => { Object.assign(f.page, patch); }, { keepValidation: true, coalesce: `page:${Object.keys(patch).join(',')}` });
  return (
    <>
      <Section title="Thème graphique" icon="theme">
        <div className="theme-grid">
          {(Object.keys(THEMES) as PageTheme[]).map((t) => <ThemeThumb key={t} theme={t} accent={page.accentColor} active={page.theme === t} onClick={() => set(themePatch(t))} />)}
        </div>
        <Row label="Accent"><Color value={page.accentColor} onChange={(v) => set({ accentColor: v })} /></Row>
        <Row label="Fond du plan"><Color value={page.planBackground} onChange={(v) => set({ planBackground: v })} /></Row>
      </Section>
      <Section title="Format" icon="paper">
        <Row label="Papier"><Seg value={page.paper} options={[['A4', 'A4'], ['A3', 'A3'], ['A2', 'A2']]} onChange={(v) => set({ paper: v })} /></Row>
        <Row label="Orientation"><Seg value={page.orientation} options={[['portrait', 'Portrait'], ['landscape', 'Paysage']]} onChange={(v) => set({ orientation: v })} /></Row>
        <Row label="Marges"><Num value={page.marginMm} min={0} max={40} onChange={(v) => set({ marginMm: v })} suffix="mm" /></Row>
        <Row label="Légende"><Seg value={page.sidePosition} options={[['left', 'Gauche'], ['right', 'Droite'], ['bottom', 'Bas']]} onChange={(v) => set({ sidePosition: v })} /></Row>
        <p className="muted tiny">
          {page.orientation === 'portrait'
            ? 'En portrait, « Gauche » et « Droite » placent la légende à côté du plan seulement s’il est en hauteur ; sinon elle passe en bas. Les tailles s’ajustent à la forme du plan.'
            : 'Les tailles de la légende et du plan s’ajustent automatiquement à la forme du plan.'}
        </p>
      </Section>
      <Section title="Contenu" icon="legendIcon">
        {([['showTitleBlock', 'En-tête et cartouche'], ['showLegend', 'Légende'], ['showInstructions', 'Consignes'], ['showEmergencyNumbers', 'Numéros d’urgence'],
          ['showAerial', 'Vue aérienne du site'], ['showSketch', 'Croquis de situation (miniature du plan)'],
          ['showScaleBar', 'Barre d’échelle'], ['showNorth', 'Flèche du nord'], ['showWatermark', 'Filigrane Brouillon / À valider'], ['showFrame', 'Cadre de page (thèmes encadrés)']] as const).map(([k, l]) => (
          <div key={k} className="toggle-line"><Toggle checked={!!page[k]} onChange={(v) => set({ [k]: v } as any)} label={l} /></div>
        ))}
        {page.showNorth && <Row label="Angle du nord"><Num value={page.northAngle} min={-360} max={360} onChange={(v) => set({ northAngle: v })} suffix="°" /></Row>}
      </Section>
      <Section title="Cadres" icon="layout">
        <p className="muted tiny">Cochez les zones à entourer d’un cadre. Sans choix de votre part, chaque thème applique le sien.</p>
        {FRAME_ZONES.map(([k, l]) => (
          <div key={k} className="toggle-line"><Toggle checked={frameOn(page, k)} onChange={(v) => set({ frames: { ...page.frames, [k]: v } })} label={l} /></div>
        ))}
        {page.frames && Object.keys(page.frames).length > 0 && (
          <button className="btn small" onClick={() => set({ frames: undefined })}>Revenir aux cadres du thème</button>
        )}
      </Section>
    </>
  );
}

function BackgroundTab({ floor }: { floor: Floor }) {
  const bg = floor.background;
  const S = useStore.getState;
  const setBg = (patch: Partial<NonNullable<typeof bg>>, key = Object.keys(patch).join(',')) =>
    S().mutateFloor((f) => { if (f.background) Object.assign(f.background, patch); }, { keepValidation: true, coalesce: `bg:${key}` });
  return (
    <>
      <Section title="Plan de fond" icon="image">
        {bg ? (
          <>
            {bg.vector
              ? <p className="muted small" title={bg.sourceName}>{bg.sourceName} · plan {bg.vector.format.toUpperCase()} vectoriel<br />
                  {bg.vector.widthM.toFixed(2).replace('.', ',')} m × {bg.vector.heightM.toFixed(2).replace('.', ',')} m · unité : {bg.vector.unit} · {bg.vector.layers.length} calque(s)</p>
              : <p className="muted small" title={bg.sourceName}>{bg.sourceName} · {bg.naturalWidth}×{bg.naturalHeight} px</p>}
            <Row label="Opacité"><Slider value={bg.opacity} onChange={(v) => setBg({ opacity: Math.max(0.05, v) })} /></Row>
            <Row label="Niveaux de gris"><Toggle checked={bg.grayscale} onChange={(v) => setBg({ grayscale: v })} /></Row>
            {!bg.vector && <Row label="Largeur"><Num value={bg.naturalWidth * bg.scale} min={10} onChange={(v) => setBg({ scale: v / bg.naturalWidth })} suffix="u" /></Row>}
            <Row label="Verrouillé"><Toggle checked={bg.locked} onChange={(v) => setBg({ locked: v })} /></Row>
            <p className="muted tiny">Déverrouillez le fond pour le déplacer à la souris.</p>
            <div className="row gap">
              <button className="btn small" onClick={() => A.importBackgroundAction()}>Remplacer…</button>
              <button className="btn small danger" onClick={() => S().mutateFloor((f) => { f.background = null; })}>Retirer</button>
            </div>
          </>
        ) : (
          <button className="btn small full" onClick={() => A.importBackgroundAction()}><Icon name="import" size={15} /> Importer un plan (DXF, PDF, image)</button>
        )}
      </Section>
      <Section title="Échelle" icon="ruler">
        {floor.unitsPerMeter > 0
          ? <p className="small">1 m = {floor.unitsPerMeter.toFixed(2)} unités plan.</p>
          : <p className="small warn"><Icon name="warning" size={14} /> Échelle non étalonnée : mesures et impression à l’échelle indisponibles.</p>}
        <div className="row gap">
          <button className="btn small" onClick={() => S().setTool('calibrate')}><Icon name="calibrate" size={15} /> Étalonner…</button>
          {floor.unitsPerMeter > 0 && <Num value={floor.unitsPerMeter} min={0.01} onChange={(v) => S().mutateFloor((f) => { f.unitsPerMeter = v; }, { coalesce: 'upm' })} suffix="u/m" />}
        </div>
      </Section>
    </>
  );
}
