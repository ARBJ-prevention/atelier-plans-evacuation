import { hereCallout, isHereMarker } from '../model/hereCallout';
import React, { useEffect, useRef, useState } from 'react';
import * as A from '../app/actions';
import { scopeLabel, scopeOf, selectionScope, setScopeAction } from '../app/scope';
import { COUNTRIES, getCountry } from '../model/countries';
import { defaultShadow, EMERGENCY_NUMBERS, FONTS, LAYER_NAMES } from '../model/defaults';
import { boxOf, distance, formatLength, polygonArea, polylineLength, straightenPolyline, straightnessLabel } from '../model/geometry';
import type { DashStyle, Element, FillPattern, Floor, LayerId, PageSetup, PageTheme } from '../model/types';
import { symbolName } from '../render/ElementView';
import { FRAME_ZONES, frameOn, THEMES, themePatch } from '../render/layout';
import { isoRoomNumberOk, STATUS_LABEL } from '../render/PrintPage';
import { computeRoomNumbers, STREET_SIDES } from '../model/roomNumbers';
import { seamlessStroke } from '../services/footprint';
import { ROOM_TAG_STYLE } from '../services/recognize';
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

/** Largeur d'une porte ou d'une fenêtre : en centimètres réels une fois le plan étalonné, sinon en unités du plan. */
function WidthRow({ value, u, max, onChange }: { value: number; u: number; max: number; onChange(v: number): void }) {
  if (u > 0) {
    return <Row label="Largeur"><Num value={Math.round((value / u) * 100)} min={Math.ceil((20 / u) * 100)} max={Math.floor((max / u) * 100)}
      onChange={(cm) => onChange((cm * u) / 100)} suffix="cm" /></Row>;
  }
  return <Row label="Largeur" hint="Unités du plan : étalonnez l’échelle pour saisir des centimètres"><Num value={value} min={20} max={max} onChange={onChange} suffix="u" /></Row>;
}

/** Portée explicite : toutes les affiches de l'étage, ou l'affiche active uniquement. */
function ScopeControl({ els, floor }: { els: Element[]; floor: Floor }) {
  const variantId = useStore((s) => currentVariantId(s));
  if (floor.variants.length <= 1) return null;
  const n = floor.variants.length;
  const kind = selectionScope(els, floor);
  const active = floor.variants.find((v) => v.id === variantId)?.name ?? '';
  const ids = els.map((e) => e.id);
  const locked = els.some((e) => e.locked);
  const note = els.length === 1 ? scopeLabel(scopeOf(els[0], floor), floor)
    : kind === 'mixed' ? 'Portées différentes dans la sélection' : kind === 'all' ? `Communs aux ${n} affiches` : kind === 'own' ? `Uniquement sur « ${active} »` : 'Communs avec exceptions';
  return (
    <div className={`scope-box scope-${kind}`} role="group" aria-label="Portée de la sélection">
      <div className="scope-title">S’applique à</div>
      <div className="seg full">
        <button disabled={locked} className={kind === 'all' ? 'on' : ''} aria-pressed={kind === 'all'} onClick={() => kind !== 'all' && setScopeAction(ids, 'all')}>Toutes les affiches ({n})</button>
        <button disabled={locked} className={kind === 'own' ? 'on' : ''} aria-pressed={kind === 'own'} onClick={() => kind !== 'own' && setScopeAction(ids, 'own')}>Cette affiche uniquement</button>
      </div>
      <p className="scope-note">{note}</p>
    </div>
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
  route: 'Itinéraire d’évacuation', dimension: 'Cote', text: 'Texte', image: 'Image', legend: 'Légende', shape: 'Forme',
};
const TYPE_ICON: Record<string, string> = {
  wall: 'wall', area: 'room', door: 'door', window: 'window', stairs: 'stairs', symbol: 'symbol', route: 'route', dimension: 'ruler', text: 'textIcon', image: 'image', legend: 'legendIcon', shape: 'shapeRect',
};

/** Élément qui porte un texte réglable : texte libre ou zone / pièce avec un nom. */
const hasText = (e: Element) => e.type === 'text' || (e.type === 'area' && !!e.label.trim());
/** Élément avec un fond coloré : zone, pièce, ou forme fermée. */
const hasFill = (e: Element) => e.type === 'area' || (e.type === 'shape' && e.shape !== 'line' && e.shape !== 'arrow');
const textSizeOf = (e: Element) => (e.type === 'text' ? e.fontSize : e.type === 'area' ? e.labelSize : 0);

function MultiProps({ els }: { els: Element[] }) {
  const S = useStore.getState;
  const grouped = els.every((e) => e.groupId && e.groupId === els[0].groupId);
  const ids = new Set(els.map((e) => e.id));
  const batch = (patch: Record<string, unknown>, key: string) =>
    S().mutateFloor((f) => { f.elements.forEach((e) => { if (ids.has(e.id)) Object.assign(e, patch); }); }, { coalesce: `multi:${key}` });
  return (
    <div className="panel-body">
      <div className="props-head"><Icon name="group" size={18} /><div><h2>{els.length} éléments</h2><p className="muted small">{grouped ? 'Groupe' : 'Sélection multiple'}</p></div></div>
      {(() => { const f = currentFloor(S()); return f ? <ScopeControl els={els} floor={f} /> : null; })()}
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
        {els.some((e) => e.type === 'wall') && (() => {
          const walls = els.filter((e) => e.type === 'wall') as any[];
          const u = currentFloor(S())?.unitsPerMeter ?? 0;
          const th = walls.map((w) => w.thickness as number);
          const lo = Math.min(...th), hi = Math.max(...th);
          const same = hi - lo < 0.05;
          // murs raccordés, portes et fenêtres retravaillés avec le mur
          const setTh = (v: number) => S().setWallThickness(walls.map((w) => w.id), v);
          const cmOf = (v: number) => (u > 0 ? `${((v / u) * 100).toFixed(0)} cm` : `${round(v)} u`);
          return (
            <Row label="Épaisseur des murs" hint={`${walls.length} mur(s) · ${same ? cmOf(lo) : `de ${cmOf(lo)} à ${cmOf(hi)}`} · une valeur saisie s’applique à tous`}>
              <Num value={same ? lo : th.reduce((s, v) => s + v, 0) / th.length} min={1} max={200} width={60}
                suffix={same ? cmOf(lo) : 'mixte'} onChange={setTh} />
            </Row>
          );
        })()}
        {els.some(hasFill) && (() => {
          const filled = els.filter(hasFill) as any[];
          const first = filled[0].fill as string;
          const mixed = filled.some((e) => e.fill !== first);
          return (
            <Row label="Remplissage" hint={mixed ? 'Couleurs différentes : la couleur choisie s’applique à toutes les zones et formes sélectionnées' : undefined}>
              <Color value={first} onChange={(v) => S().mutateFloor((f) => {
                f.elements.forEach((e: any) => {
                  if (!ids.has(e.id) || !hasFill(e)) return;
                  // contour « invisible » (de la couleur du fond, après Découper en locaux) : il suit la nouvelle couleur
                  if (e.stroke === e.fill) e.stroke = v;
                  e.fill = v;
                });
              }, { coalesce: 'multi:fill' })} />
            </Row>
          );
        })()}
        {els.some(hasText) && (() => {
          const withText = els.filter(hasText);
          const sizes = withText.map(textSizeOf);
          const allBold = withText.every((e) => (e.type === 'text' ? e.bold : (e as any).labelBold));
          const scale = (k: number) => S().mutateFloor((f) => {
            f.elements.forEach((e: any) => {
              if (!ids.has(e.id)) return;
              if (e.type === 'text') e.fontSize = Math.max(2, Math.round(e.fontSize * k * 10) / 10);
              else if (e.type === 'area' && e.label?.trim()) e.labelSize = Math.max(2, Math.round(e.labelSize * k * 10) / 10);
            });
          });
          const setSize = (v: number) => S().mutateFloor((f) => {
            f.elements.forEach((e: any) => {
              if (!ids.has(e.id)) return;
              if (e.type === 'text') e.fontSize = v;
              else if (e.type === 'area' && e.label?.trim()) e.labelSize = v;
            });
          }, { coalesce: 'multi:textsize' });
          const lo = Math.min(...sizes), hi = Math.max(...sizes);
          const same = hi - lo < 0.05;
          return (
            <>
              <Row label="Taille du texte" hint={`${withText.length} texte(s) · ${same ? `taille ${round(lo)}` : `de ${round(lo)} à ${round(hi)}`} · une valeur saisie s’applique à tous`}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Num value={same ? lo : Math.round(sizes.reduce((s, v) => s + v, 0) / sizes.length)} min={2} max={400} width={60}
                    suffix={same ? undefined : 'mixte'} onChange={setSize} />
                  <button className="btn small" title="Réduire tous les textes sélectionnés" onClick={() => scale(1 / 1.2)}>A−</button>
                  <button className="btn small" title="Agrandir tous les textes sélectionnés" onClick={() => scale(1.2)}>A+</button>
                </div>
              </Row>
              {withText.some((e) => e.type === 'text') && (() => {
                const texts = withText.filter((e) => e.type === 'text') as any[];
                const setTexts = (patch: Record<string, unknown>, key: string) => S().mutateFloor((f) => {
                  f.elements.forEach((e: any) => { if (ids.has(e.id) && e.type === 'text') Object.assign(e, patch); });
                }, { coalesce: `multi:${key}` });
                return (
                  <>
                    <Row label="Couleur du texte"><Color value={texts[0].color} onChange={(v) => setTexts({ color: v }, 'color')} /></Row>
                    <Row label="Fond du texte"><Color value={texts[0].background} allowNone onChange={(v) => setTexts({ background: v === 'none' ? '' : v }, 'bg')} /></Row>
                    <div className="actions-grid" style={{ marginBottom: 6 }}>
                      <button className="btn small" title="Fond foncé, texte blanc en gras : le numéro saute aux yeux sur des locaux clairs"
                        onClick={() => setTexts({ ...ROOM_TAG_STYLE }, 'tag')}>Étiquette foncée</button>
                      <button className="btn small" title="Fond blanc bordé, texte foncé en gras"
                        onClick={() => setTexts({ color: '#1d2630', background: '#ffffff', border: true, borderColor: '#1d2630', bold: true, padding: 0.22 }, 'tag')}>Étiquette blanche</button>
                    </div>
                  </>
                );
              })()}
              <Row label="Gras">
                <Toggle checked={allBold} onChange={(v) => S().mutateFloor((f) => {
                  f.elements.forEach((e: any) => { if (!ids.has(e.id)) return; if (e.type === 'text') e.bold = v; else if (e.type === 'area') e.labelBold = v; });
                })} label="" />
              </Row>
            </>
          );
        })()}
        {els.some((e) => e.type === 'area' && !!e.label.trim()) && (
          <button className="btn small" style={{ width: '100%', marginBottom: 6 }}
            title="Efface le nom affiché dans les zones et pièces sélectionnées (les textes indépendants ne sont pas touchés)"
            onClick={() => S().mutateFloor((f) => {
              f.elements.forEach((e) => { if (ids.has(e.id) && e.type === 'area') e.label = ''; });
            })}>
            <Icon name="text" size={15} /> Retirer les noms des zones
          </button>
        )}
        {els.every((e) => e.type === 'area') && (
          <button className="btn small" style={{ width: '100%' }}
            title="Retire le contour de toutes les zones sélectionnées (utile après « Découper en locaux » : plus de traits entre les locaux)"
            onClick={() => S().mutateFloor((f) => {
              f.elements.forEach((e) => { if (ids.has(e.id) && e.type === 'area') Object.assign(e, seamlessStroke(e as any)); });
            })}>
            <Icon name="fill" size={15} /> Sans contour
          </button>
        )}
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
  const canClip = useStore((s) => {
    const f = currentFloor(s);
    if (!f) return false;
    return f.elements.some((e) => s.selection.includes(e.id) && (e.type === 'area' || (e.type === 'shape' && e.shape !== 'line' && e.shape !== 'arrow')));
  });
  return (
    <div className="actions-grid">
      {canClip && (
        <button className="btn small" style={{ gridColumn: '1 / -1' }} onClick={() => S().clipSelectionToBuilding()}
          title="Ne garde que la partie de la forme située à l’intérieur des façades (les ouvertures sont refermées)">
          <Icon name="building" size={15} /> Limiter au bâtiment
        </button>
      )}
      {canClip && (
        <button className="btn small" style={{ gridColumn: '1 / -1' }} onClick={() => S().splitSelectionIntoRooms()}
          title="Limite la forme au bâtiment puis la découpe en une zone par local (les murs et les portes séparent les locaux). Les zones n’ont pas de nom : les noms des locaux restent des textes indépendants.">
          <Icon name="room" size={15} /> Découper en locaux
        </button>
      )}
      {canClip && (
        <button className="btn small" style={{ gridColumn: '1 / -1' }} onClick={() => S().splitSelectionIntoRooms(true)}
          title="Comme « Découper en locaux », mais chaque zone reprend le nom de la pièce ou du texte qu’elle contient">
          <Icon name="room" size={15} /> Découper en locaux avec les noms
        </button>
      )}
      <button className="btn small" style={{ gridColumn: '1 / -1' }} onClick={() => S().selectWhere('similar')}
        title="Sélectionne tous les éléments du même genre (toutes les zones, tous les textes, le même pictogramme…) pour les modifier d’un coup">
        <Icon name="select" size={15} /> Sélectionner les semblables
      </button>
      <button className="btn small" onClick={() => S().rotateSelection(-90)} title="Pivoter de 90° à gauche"><Icon name="rotate" size={15} /> −90°</button>
      <button className="btn small" onClick={() => S().rotateSelection(90)} title="Pivoter de 90° à droite"><Icon name="rotate" size={15} /> +90°</button>
      <button className="btn small" onClick={() => S().flipSelection('h')}><Icon name="flipH" size={15} /> Miroir ↔</button>
      <button className="btn small" onClick={() => S().flipSelection('v')}><Icon name="flipV" size={15} /> Miroir ↕</button>
      <button className="btn small" onClick={() => S().reorderSelection('front')}><Icon name="front" size={15} /> Devant</button>
      <button className="btn small" onClick={() => S().reorderSelection('back')}><Icon name="back" size={15} /> Derrière</button>
      <button className="btn small" onClick={() => S().reorderSelection('forward')} title="Avancer d’un cran"><Icon name="forward" size={15} /> Avancer</button>
      <button className="btn small" onClick={() => S().reorderSelection('backward')} title="Reculer d’un cran (passe sous les autres calques)"><Icon name="backward" size={15} /> Reculer</button>
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
        </div>
      </div>
      <ScopeControl els={[el]} floor={floor} />
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
            {el.type === 'dimension' && (
              <Section title="Cote" icon="ruler">
                <p className="muted small">Distance mesurée : <b>{formatLength(distance(e.points[0], e.points[1]), u)}</b>{u > 0 ? '' : ' — étalonnez l’échelle pour l’avoir en mètres'}</p>
                <Row label="Texte imposé" hint="Laisser vide pour afficher la mesure calculée">
                  <input type="text" value={e.text} placeholder={formatLength(distance(e.points[0], e.points[1]), u)} onChange={(ev) => upd({ text: ev.target.value })} />
                </Row>
                <Row label="Décalage" hint="Distance entre les points mesurés et la ligne de cote"><Num value={Math.round(e.offset)} min={-2000} max={2000} onChange={(v) => upd({ offset: v })} suffix="u" /></Row>
                <Row label="Extrémités"><Seg value={e.ends} options={[['tick', 'Traits'], ['arrow', 'Flèches'], ['dot', 'Points']]} onChange={(v) => upd({ ends: v })} /></Row>
                <Row label="Taille du texte"><Num value={e.fontSize} min={4} max={200} onChange={(v) => upd({ fontSize: v })} /></Row>
                <Row label="Épaisseur"><Num value={e.strokeWidth} min={0.3} max={20} step={0.1} onChange={(v) => upd({ strokeWidth: v })} /></Row>
                <Row label="Couleur"><Color value={e.color} onChange={(v) => upd({ color: v })} /></Row>
                <Row label="Sens du décalage"><button className="btn small" onClick={() => upd({ offset: -e.offset })}>Passer de l’autre côté</button></Row>
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
                  {e.arrowRepeat > 0 && (
                    <Row label="Couleur des chevrons">
                      <span className="row gap">
                        <Seg value={e.repeatColor === 'line' ? 'line' : e.repeatColor ? 'custom' : 'auto'}
                          options={[['auto', 'Blanc'], ['line', 'Trait'], ['custom', 'Autre']]}
                          onChange={(v) => upd({ repeatColor: v === 'auto' ? '' : v === 'line' ? 'line' : '#ffd400' })} />
                        {e.repeatColor && e.repeatColor !== 'line' && <Color value={e.repeatColor} onChange={(v) => upd({ repeatColor: v })} />}
                      </span>
                    </Row>
                  )}
                </Section>
              </>
            )}
            {el.type === 'door' && (
              <Section title="Porte" icon="door">
                <Row label="Type">
                  <select value={e.doorType} onChange={(ev) => upd({ doorType: ev.target.value })}>
                    <option value="single">Battante simple</option><option value="double">Double battant</option><option value="sliding">Coulissante</option><option value="slidingDouble">Coulissante double</option>
                    <option value="revolving">Tambour</option><option value="opening">Baie libre</option>
                    <option value="swingBoth">Va-et-vient</option><option value="unequal">Tiercée (vantaux inégaux)</option>
                    <option value="folding">Pliante</option><option value="foldingDouble">Pliante double</option>
                    <option value="pocket">À galandage</option><option value="garage">Porte de garage</option>
                  </select>
                </Row>
                {['single', 'swingBoth', 'unequal', 'folding', 'pocket'].includes(e.doorType) && <Row label="Ouverture"><Seg value={e.swing} options={[['left', 'Gauche'], ['right', 'Droite']]} onChange={(v) => upd({ swing: v })} /></Row>}
                <WidthRow value={e.width} u={u} max={800} onChange={(v) => upd({ width: v })} />
                <Row label="Côté du débattement"><Seg value={e.flipY ? 'b' : 'a'} options={[['a', 'Côté A'], ['b', 'Côté B']]} onChange={(v) => upd({ flipY: v === 'b' })} /></Row>
                <Row label="Issue de secours" hint="Marquage vert sur le seuil"><Toggle checked={e.emergency} onChange={(v) => upd({ emergency: v })} /></Row>
                <Row label="Porte coupe-feu" hint="Marquage rouge sur le seuil, ajoutée à la légende"><Toggle checked={!!e.fireRated} onChange={(v) => upd({ fireRated: v })} /></Row>
                {e.fireRated && <Row label="Libellé" hint="Ex. CF, EI 30, EI 60 — vide : aucun libellé"><input type="text" value={e.fireRating ?? ''} maxLength={12} onChange={(ev) => upd({ fireRating: ev.target.value })} /></Row>}
              </Section>
            )}
            {el.type === 'window' && (
              <Section title="Fenêtre" icon="window">
                <WidthRow value={e.width} u={u} max={1000} onChange={(v) => upd({ width: v })} />
                <Row label="Épaisseur"><Num value={e.depth} min={2} max={80} onChange={(v) => upd({ depth: v })} /></Row>
                <Row label="Modèle">
                  <select value={e.windowStyle ?? 'standard'} onChange={(ev) => upd({ windowStyle: ev.target.value })}>
                    <option value="standard">Standard</option><option value="casement">À battants (ouverture dessinée)</option>
                    <option value="sliding">Coulissante</option><option value="fixed">Fixe</option><option value="tilt">À soufflet</option>
                  </select>
                </Row>
                <Row label="Vantaux"><Num value={e.panes} min={1} max={8} onChange={(v) => upd({ panes: Math.round(v) })} /></Row>
                {(e.windowStyle === 'casement' || e.windowStyle === 'tilt') && (e.shutter ?? 'none') === 'none' && (
                  <Row label="Côté intérieur" hint="Côté où s'ouvre la fenêtre"><Seg value={e.flipY ? 'a' : 'b'} options={[['a', 'Côté A'], ['b', 'Côté B']]} onChange={(v) => upd({ flipY: v === 'a' })} /></Row>
                )}
                <Row label="Volet"><Seg value={e.shutter ?? 'none'} options={[['none', 'Aucun'], ['rolling', 'Roulant'], ['hinged', 'Battants']]} onChange={(v) => upd({ shutter: v })} /></Row>
                {(e.shutter ?? 'none') !== 'none' && <Row label="Côté du volet" hint="Côté extérieur de la façade"><Seg value={e.flipY ? 'b' : 'a'} options={[['a', 'Côté A'], ['b', 'Côté B']]} onChange={(v) => upd({ flipY: v === 'b' })} /></Row>}
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
                <Row label="Épaisseur"><Num value={e.thickness} min={1} max={200} onChange={(v) => useStore.getState().setWallThickness([el.id], v)} suffix={u > 0 ? `${((e.thickness / u) * 100).toFixed(0)} cm` : 'u'} /></Row>
                <Row label="Fermé"><Toggle checked={e.closed} onChange={(v) => upd({ closed: v })} /></Row>
                <p className="muted small">{e.points.length} points · longueur {len(polylineLength(e.points))}</p>
                {(() => {
                  const n = e.points.length, segs = e.closed ? n : n - 1;
                  if (segs < 1 || segs > 6) return null;
                  const rows = Array.from({ length: segs }, (_, i) => straightnessLabel(e.points[i], e.points[(i + 1) % n]));
                  const crooked = rows.some((r) => !r.straight);
                  return (
                    <>
                      {rows.map((r, i) => (
                        <p key={i} className="small" style={{ margin: '2px 0', color: r.straight ? '#00843d' : '#c2410c', fontWeight: 600 }}>
                          {segs > 1 ? `Segment ${i + 1} : ` : 'Direction : '}{r.text}
                        </p>
                      ))}
                      {crooked && (
                        <button className="btn small full" title="Aligne chaque segment sur l’horizontale, la verticale ou 45° le plus proche (le premier point ne bouge pas)"
                          onClick={() => useStore.getState().mutateFloor((f) => {
                            const w = f.elements.find((x) => x.id === el.id) as any;
                            if (w) w.points = straightenPolyline(w.points);
                          })}>Redresser le mur</button>
                      )}
                    </>
                  );
                })()}
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
                {el.type === 'area' && e.kind === 'zone' && e.strokeWidth > 0 && e.stroke !== e.fill && (
                  <button className="btn small" style={{ width: '100%' }}
                    title="Après « Découper en locaux » : retire le contour de toutes les zones de même couleur, pour qu'aucun trait ne sépare les locaux"
                    onClick={() => useStore.getState().mutateFloor((f) => {
                      f.elements.forEach((x) => {
                        if (x.type === 'area' && x.kind === 'zone' && x.fill === e.fill && x.stroke === e.stroke && x.strokeWidth === e.strokeWidth) Object.assign(x, seamlessStroke(x));
                      });
                    })}>
                    Sans contour sur toutes les zones de cette couleur
                  </button>
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
              {floor.variants.length > 1 && <p className="muted small">Portée : {scopeLabel(scopeOf(el, floor), floor)} (réglable en haut du panneau).</p>}
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
  const variantId = useStore((s) => currentVariantId(s));
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
        {isHereMarker(e) && <Row label="Style"><Seg value={e.hereStyle ?? 'pill'} options={[['pill', 'Pastille'], ['dark', 'Sombre'], ['outline', 'Contour'], ['tag', 'Étiquette']]} onChange={(v) => upd({ hereStyle: v })} /></Row>}
        {isHereMarker(e)
          ? <>
            <Row label="Position" hint="Auto : le cartouche et sa flèche se placent là où le plan est le moins chargé. Libre : glissez le cartouche sur le plan, même en dehors du dessin.">
              <Seg value={e.hereOffset ? 'free' : e.labelPosition}
                options={[['auto', 'Auto'], ['free', 'Libre'], ['above', 'Dessus'], ['below', 'Dessous'], ['right', 'Droite'], ['left', 'Gauche']]}
                onChange={(v) => {
                  if (v !== 'free') { upd({ labelPosition: v, hereOffset: undefined }); return; }
                  const c = hereCallout(e, floor, variantId);
                  if (c) upd({ hereOffset: [Math.round(c.x + c.w / 2 - e.x), Math.round(c.y + c.h / 2 - e.y)] });
                }} />
            </Row>
            <p className="muted tiny">Glissez le cartouche « {e.label || 'Vous êtes ici'} » sur le plan pour le placer où vous voulez, même hors du dessin : la flèche suit.</p>
          </>
          : <Row label="Position"><Seg value={e.labelPosition === 'auto' ? 'below' : e.labelPosition} options={[['below', 'Dessous'], ['above', 'Dessus'], ['right', 'Droite'], ['left', 'Gauche']]} onChange={(v) => upd({ labelPosition: v })} /></Row>}
        <Row label="Taille"><Num value={e.labelSize} min={0} max={200} onChange={(v) => upd({ labelSize: v })} suffix={e.labelSize ? '' : 'auto'} /></Row>
        <Row label="Couleur"><Color value={e.labelColor} onChange={(v) => upd({ labelColor: v })} /></Row>
      </Section>
      </>
    );
  }
  if (el.type === 'area') {
    return (
      <Section title="Nom de la pièce" icon="textIcon">
        <textarea ref={textRef} className="ta" rows={2} value={e.label} placeholder="Fonction du local (ex. Bureau)" onChange={(ev) => upd({ label: ev.target.value })} />
        <Row label="Type" hint="Seules les pièces reçoivent un numéro de local"><Seg value={e.kind === 'room' ? 'room' : 'zone'} options={[['room', 'Pièce'], ['zone', 'Zone']]} onChange={(v) => upd({ kind: v })} /></Row>
        {e.kind === 'room' && <Row label="Numéro" hint="Norme : chiffre de l’étage + deux chiffres (ex. 012, 105)">
          <input type="text" value={e.number ?? ''} style={{ width: 80 }} onChange={(ev) => upd({ number: ev.target.value })} />
        </Row>}
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
      {tab === 'page' && <PageSummary page={floor.page} />}
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
      <section id="floor-status" className={`status-box status-${tb.status}`}>
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
      <RoomNumbering floor={floor} />
      <Section title="Cartouche" icon="layout">
        <Row label="Titre"><input type="text" value={tb.title} onChange={(e) => setTb({ title: e.target.value })} /></Row>
        <Row label="Sous-titre"><input type="text" value={tb.subtitle} placeholder="Adresse, zone…" onChange={(e) => setTb({ subtitle: e.target.value })} /></Row>
        <Row label="Auteur"><input type="text" value={tb.author} onChange={(e) => setTb({ author: e.target.value })} /></Row>
        <Row label="Organisation"><input type="text" value={tb.organization} onChange={(e) => setTb({ organization: e.target.value })} /></Row>
        <Row label="Date"><input type="date" value={tb.date} onChange={(e) => setTb({ date: e.target.value })} /></Row>
        <Row label="N° du plan"><input type="text" value={tb.planNumber ?? ''} placeholder="Ex. EV-0-01" onChange={(e) => setTb({ planNumber: e.target.value })} /></Row>
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
        <input id="floor-numbers" className="full-input" type="text" value={tb.emergencyNumbers} onChange={(e) => setTb({ emergencyNumbers: e.target.value })} />
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

/** La mise en page est stockée sur l'étage : la rappeler quand il porte plusieurs affiches. */
export function PageScopeNote() {
  const floor = useStore((s) => currentFloor(s));
  if (!floor || floor.variants.length <= 1) return null;
  return (
    <p className="page-scope" role="note">
      <Icon name="layers" size={14} /> Mise en page commune aux {floor.variants.length} affiches de « {floor.name} » : {floor.variants.map((v) => v.name).join(', ')}.
    </p>
  );
}

/** Onglet Page : résumé de la mise en page ; tous les réglages sont dans l'aperçu (un seul endroit). */
/** Numérotation des locaux selon la fiche pratique (étage + deux chiffres, depuis la rue principale, de gauche à droite). */
function RoomNumbering({ floor }: { floor: Floor }) {
  const S = useStore.getState;
  const rooms = floor.elements.filter((e) => e.type === 'area' && e.kind === 'room');
  if (!rooms.length) {
    const zones = floor.elements.filter((e) => e.type === 'area' && e.kind !== 'room').length;
    return (
      <Section title="Numéros des locaux" icon="floor">
        <p className="muted tiny">
          Aucune pièce sur cet étage : la numérotation porte sur les pièces (outil « Pièce » de l’onglet Plan).
          {zones ? ` Les ${zones} surface(s) dessinée(s) ici sont des zones : sélectionnez-les et choisissez « Type : Pièce » pour les numéroter.` : ''}
        </p>
      </Section>
    );
  }
  const ok = rooms.filter((r) => r.type === 'area' && isoRoomNumberOk(r.number, floor.level)).length;
  const side = floor.page.streetSide ?? 'bottom';
  const run = (s = side) => {
    const nums = new Map(computeRoomNumbers(floor, s).map((n) => [n.id, n.number]));
    S().mutateFloor((f) => {
      f.page.streetSide = s;
      for (const e of f.elements) if (e.type === 'area' && nums.has(e.id)) e.number = nums.get(e.id);
    }, { keepValidation: true });
  };
  return (
    <Section title="Numéros des locaux" icon="floor">
      <Row label="Rue principale" hint="Côté du plan où se trouve la rue principale">
        <select value={side} onChange={(ev) => run(ev.target.value as typeof side)}>
          {STREET_SIDES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Row>
      <button className="btn small full" onClick={() => run()}>Numéroter les locaux automatiquement</button>
      <p className="muted tiny">{ok}/{rooms.length} locaux numérotés selon la norme : chiffre de l’étage (niveau {floor.level}) puis deux chiffres, en partant des locaux les plus proches de la rue principale, de gauche à droite vu depuis la rue. Le nom de chaque pièce doit indiquer sa fonction.</p>
    </Section>
  );
}

function PageSummary({ page }: { page: PageSetup }) {
  const items = ([['showLegend', 'légende'], ['showInstructions', 'consignes'], ['showEmergencyNumbers', 'numéros d’urgence'], ['showScaleBar', 'échelle'], ['showNorth', 'nord']] as const)
    .filter(([k]) => page[k]).map(([, l]) => l);
  return (
    <>
      <PageScopeNote />
      <Section title="Mise en page" icon="paper">
        <div className="page-summary">
          <ThemeThumb theme={page.theme} accent={page.accentColor} active />
          <div>
            <b>{THEMES[page.theme].name}</b>
            <p className="small">{page.paper} {page.orientation === 'portrait' ? 'portrait' : 'paysage'} · marges {page.marginMm} mm · {page.scaleMode === 'fixed' ? `échelle 1:${page.scale}` : 'ajustée à la page'}</p>
            <p className="muted tiny">{items.length ? `Affiche : ${items.join(', ')}` : 'Aucun bloc affiché'}</p>
          </div>
        </div>
        <button className="btn primary full" onClick={() => window.dispatchEvent(new CustomEvent('evac:command', { detail: { action: 'layout-settings' } }))}>
          <Icon name="print" size={15} /> Régler la mise en page…
        </button>
        <p className="muted tiny">Thème, papier, échelle, zone imprimée, blocs et cadres se règlent dans l’aperçu, page sous les yeux (Ctrl+P). Le ruban <i>Mise en page</i> garde les réglages courants.</p>
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
