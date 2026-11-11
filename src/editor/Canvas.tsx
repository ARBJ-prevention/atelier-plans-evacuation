import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { makeElement } from '../model/defaults';
import { getCountry } from '../model/countries';
import {
  boxOf, constrain45, distance, distToSegment, elementBounds, floorContentBounds, isVisibleInVariant,
  openingWallFit, polylineLength, rectContains, rectFromPoints, rectsIntersect, RESIZE_DIRECTIONS, resizeBoxElement, rotatePoint, snapSymbolToWalls, snapToGrid, translateElement,
  unionRects, windowGlassWallFit, windowResizeWallFit, type Rect,
} from '../model/geometry';
import type { DoorElement, Element, Floor, Pt, SymbolElement, WindowElement } from '../model/types';
import { ElementView, legendCount, polygonCentroid } from '../render/ElementView';
import { FloorDrawing } from '../render/FloorDrawing';
import { getBuiltinSymbol } from '../symbols/library';
import { currentFloor, currentVariantId, useStore, type Tool } from '../store/store';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; start: Pt; orig: Element[]; startBounds: Rect; began: boolean; candX: number[]; candY: number[] }
  | { kind: 'marquee'; start: Pt; additive: boolean }
  | { kind: 'vertex'; id: string; index: number; began: boolean }
  | { kind: 'resize'; orig: Element; start: Pt; direction: Pt; wallDepth?: number; began: boolean }
  | { kind: 'pscale'; id: string; orig: Element; box: Rect; direction: Pt; start: Pt; began: boolean }
  | { kind: 'rotate'; id: string; center: Pt }
  | { kind: 'bgmove'; start: Pt; ox: number; oy: number; began: boolean }
  | { kind: 'rect'; start: Pt };

const POLY_TOOLS: Tool[] = ['wall', 'route', 'room', 'zone'];
const ZONE_STYLE = (points: Pt[]) => ({
  points, kind: 'zone', fill: '#d52b1e', fillOpacity: 0.08, pattern: 'hatch', patternColor: '#d52b1e', stroke: '#d52b1e',
  strokeWidth: 2.5, dash: 'dashed', label: 'Zone', labelColor: '#d52b1e', labelBold: true,
});
const RULER = 22;

function resizeHandle(key: string, [x, y]: Pt, [sx, sy]: Pt, zoom: number, rotation = 0) {
  const angle = Math.atan2(sy, sx) * 180 / Math.PI + rotation;
  const cursor = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][((Math.round(angle / 45) % 4) + 4) % 4];
  return (
    <g key={key} data-handle={key} className="resize-handle" style={{ cursor }} transform={`translate(${x} ${y}) scale(${1 / zoom})`}>
      <rect x={-8} y={-8} width={16} height={16} rx={3} />
      <path d="M-5 0H5 M-2 -3L-5 0l3 3 M2 -3L5 0 2 3" transform={`rotate(${angle})`} />
    </g>
  );
}

/** Champ texte éditable directement sur le plan (double-clic / F2 / Entrée), selon le type d'élément. */
type InlineField = { key: 'label' | 'text' | 'title'; multiline: boolean; size: number };
function inlineFieldOf(el: Element): InlineField | null {
  switch (el.type) {
    case 'area': return { key: 'label', multiline: true, size: el.labelSize };
    case 'symbol': return { key: 'label', multiline: false, size: el.labelSize > 0 ? el.labelSize : Math.max(8, el.size * 0.26) };
    case 'stairs': return { key: 'label', multiline: false, size: Math.min(el.w, el.h) * 0.16 };
    case 'shape': return el.shape === 'line' || el.shape === 'arrow' ? null : { key: 'text', multiline: true, size: el.textSize };
    case 'text': return { key: 'text', multiline: true, size: el.fontSize };
    case 'legend': return { key: 'title', multiline: false, size: el.fontSize * 1.2 };
    default: return null;
  }
}
type Editing = { id: string; field: InlineField; anchor: Pt; value: string };
const CURSORS: Partial<Record<Tool, string>> = {
  select: 'default', pan: 'grab', wall: 'crosshair', route: 'crosshair', room: 'crosshair', zone: 'crosshair',
  door: 'copy', window: 'copy', shape: 'crosshair', stairs: 'crosshair', text: 'text', symbol: 'copy', calibrate: 'crosshair', legend: 'copy',
};

export interface CanvasProps {
  onCalibrate(unitsDistance: number): void;
}

export function Canvas({ onCalibrate }: CanvasProps) {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => currentFloor(s))!;
  const variantId = useStore((s) => currentVariantId(s));
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const pendingSymbol = useStore((s) => s.pendingSymbol);
  const [localRoute, setLocalRoute] = useState('');
  const view = useStore((s) => s.view);
  const grid = useStore((s) => s.grid);
  const guidesOn = useStore((s) => s.guides);
  const fitRequest = useStore((s) => s.fitRequest);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [rectDraft, setRectDraft] = useState<Rect | null>(null);
  const [guideLines, setGuideLines] = useState<{ x?: number; y?: number }>({});
  const [windowResizeGuides, setWindowResizeGuides] = useState<[Pt, Pt][]>([]);
  const [glassGuide, setGlassGuide] = useState<[Pt, Pt] | undefined>();
  const [calib, setCalib] = useState<Pt[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  /** Élément sous le dernier appui (pour le double-clic natif, la capture du pointeur redirigeant sa cible vers le SVG). */
  const lastDownId = useRef<string | null>(null);

  // ——— Taille de la zone ———
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ——— Ajuster à la fenêtre ———
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !floor) return;
    const b = floorContentBounds(floor, variantId);
    const w = el.clientWidth || 800, h = el.clientHeight || 600;
    const zoom = Math.min(w / b.w, h / b.h) * 0.92;
    useStore.getState().setView({ zoom, x: (w - b.w * zoom) / 2 - b.x * zoom, y: (h - b.h * zoom) / 2 - b.y * zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

  // Abandon des tracés en cours lors d'un changement d'outil / d'étage
  useEffect(() => { setDraft([]); setCalib([]); setRectDraft(null); setEditing(null); }, [tool, floor?.id]);

  // ——— Édition du nom directement sur le plan ———
  const startInlineEdit = useCallback((id: string) => {
    const s = useStore.getState();
    const f = currentFloor(s);
    const el = f?.elements.find((x) => x.id === id);
    if (!f || !el || el.locked) return false;
    const field = inlineFieldOf(el);
    if (!field) return false;
    let anchor: Pt;
    if (el.type === 'area') { const c = polygonCentroid(el.points); anchor = [c[0] + (el.labelDx || 0), c[1] + (el.labelDy || 0)]; }
    else if (el.type === 'text') anchor = [el.x, el.y];
    else { const r = elementBounds(el, legendCount(f, currentVariantId(s))); anchor = [r.x + r.w / 2, r.y + r.h / 2]; }
    s.select([id]);
    setEditing({ id, field, anchor, value: String((el as any)[field.key] ?? '') });
    return true;
  }, []);
  const commitInlineEdit = useCallback((ed: Editing | null, value: string) => {
    setEditing(null);
    if (!ed) return;
    const s = useStore.getState();
    const cur = currentFloor(s)?.elements.find((x) => x.id === ed.id) as any;
    if (!cur || cur[ed.field.key] === value) return;
    s.mutateFloor((f) => { const d = f.elements.find((x) => x.id === ed.id) as any; if (d) d[ed.field.key] = value; });
  }, []);
  useEffect(() => {
    const h = (ev: Event) => {
      const id = (ev as CustomEvent<string | undefined>).detail ?? useStore.getState().selection[0];
      if (id && !startInlineEdit(id)) {
        const el = currentFloor(useStore.getState())?.elements.find((x) => x.id === id);
        if (el?.type === 'text') window.dispatchEvent(new CustomEvent('evac:focus-text'));
      }
    };
    window.addEventListener('evac:inline-edit', h);
    return () => window.removeEventListener('evac:inline-edit', h);
  }, [startInlineEdit]);

  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = useStore.getState().view;
    return [(clientX - r.left - v.x) / v.zoom, (clientY - r.top - v.y) / v.zoom];
  }, []);

  const snap = useCallback((p: Pt, e: { altKey: boolean }): Pt => {
    const g = useStore.getState().grid;
    return g.snap && !e.altKey ? snapToGrid(p, g.size) : p;
  }, []);

  // ——— Zoom à la molette (autour du curseur) ———
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = useStore.getState().view;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const zoom = Math.min(40, Math.max(0.02, v.zoom * factor));
      const k = zoom / v.zoom;
      useStore.getState().setView({ zoom, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** Ajoute un élément posé sur le plan : retour à l'outil Sélection (élément sélectionné), sauf Maj enfoncée. */
  const placeOne = useCallback((el: Element, keepTool = false) => {
    const s = useStore.getState();
    if (keepTool) { s.addElements([el], false); return; }
    s.setTool('select');
    s.addElements([el]);
  }, []);

  // ——— Finalisation des tracés polylignes ———
  const finishPoly = useCallback((pts: Pt[]) => {
    const s = useStore.getState();
    const clean = pts.filter((p, i) => i === 0 || distance(p, pts[i - 1]) > 0.5);
    const t = s.tool;
    const min = t === 'room' || t === 'zone' ? 3 : 2;
    setDraft([]);
    if (clean.length < min) return;
    const routeColor = getCountry(s.project!.country).routeColor;
    let el: Element;
    const pr = s.presets;
    if (t === 'wall') el = makeElement('wall', { points: clean, thickness: pr.wallThickness });
    else if (t === 'route') {
      const active = currentVariantId(s);
      const variantId = localRoute === active ? active : undefined;
      el = makeElement('route', pr.routeKind === 'secondaire'
        ? { points: clean, variantId, kind: 'secondaire', dash: 'dashed', width: 6 }
        : { points: clean, variantId, outline: '#ffffff', arrowStyle: 'stealth' }, routeColor);
      setLocalRoute('');
    }
    else if (t === 'room') el = makeElement('area', { points: clean, kind: 'room', label: 'Local' });
    else el = makeElement('area', ZONE_STYLE(clean));
    placeOne(el);
  }, [placeOne, localRoute]);

  // ——— Clavier propre au dessin ———
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { spaceDown.current = e.type === 'keydown'; }
      if (e.type !== 'keydown') return;
      const s = useStore.getState();
      if (POLY_TOOLS.includes(s.tool) && draft.length) {
        if (e.key === 'Enter') { e.preventDefault(); finishPoly(draft); }
        else if (e.key === 'Escape') { e.preventDefault(); finishPoly(draft); } // Échap termine le tracé (les points posés sont conservés)
        else if (e.key === 'Backspace') { e.preventDefault(); setDraft(draft.slice(0, -1)); }
        return;
      }
      if (e.key === 'Escape') {
        if (calib.length) setCalib([]);
        else if (s.tool !== 'select') s.setTool('select');
        else s.select([]);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); };
  }, [draft, calib, finishPoly]);

  if (!floor) return null;
  const elById = (id: string) => floor.elements.find((e) => e.id === id);
  const lc = legendCount(floor, variantId);
  const selectionBox = (el: Element) =>
    boxOf(el, lc, el.type === 'door' ? openingWallFit(floor, variantId, el)?.depth : undefined);
  const snapOpening = (opening: DoorElement | WindowElement, altKey: boolean) => {
    const s = useStore.getState();
    if (altKey || !(s.grid.snap || (opening.type === 'window' && s.guides))) return undefined;
    const fit = openingWallFit(floor, variantId, opening, 10 / s.view.zoom);
    if (!fit) return undefined;
    const { depth, ...pose } = fit;
    return opening.type === 'window' ? { ...opening, ...pose, depth } : { ...opening, ...pose };
  };

  // ——— Pointeur ———
  const onPointerDown = (e: React.PointerEvent) => {
    const s = useStore.getState();
    const p = toWorld(e.clientX, e.clientY);
    svgRef.current!.setPointerCapture(e.pointerId);

    // Clic droit pendant un tracé : terminer (les points posés sont conservés).
    if (e.button === 2) {
      if (POLY_TOOLS.includes(s.tool) && draft.length) finishPoly(draft);
      return;
    }
    if (e.button === 1 || s.tool === 'pan' || spaceDown.current) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: s.view.x, vy: s.view.y };
      return;
    }
    if (e.button !== 0) return;
    const sp = snap(p, e);
    const target = e.target as SVGElement;

    switch (s.tool) {
      case 'select': {
        const handle = target.closest('[data-handle]')?.getAttribute('data-handle');
        if (handle && s.selection.length === 1) {
          const el = elById(s.selection[0]);
          if (!el || el.locked) return;
          const [kind, arg] = handle.split(':');
          if (kind === 'v') {
            if (e.detail === 2 && 'points' in el) {
              const min = el.type === 'area' ? 3 : 2;
              if (el.points.length > min) {
                s.mutateFloor((f) => { const d = f.elements.find((x) => x.id === el.id) as any; d.points.splice(Number(arg), 1); });
              }
              return;
            }
            drag.current = { kind: 'vertex', id: el.id, index: Number(arg), began: false };
          } else if (kind === 'm' && 'points' in el) {
            const i = Number(arg) + 1;
            s.mutateFloor((f) => { const d = f.elements.find((x) => x.id === el.id) as any; d.points.splice(i, 0, sp); });
            drag.current = { kind: 'vertex', id: el.id, index: i, began: true };
          } else if (kind === 'r') {
            const wallDepth = el.type === 'door' ? openingWallFit(floor, variantId, el)?.depth : undefined;
            drag.current = { kind: 'resize', orig: el, start: p, direction: RESIZE_DIRECTIONS[Number(arg)], wallDepth, began: false };
          } else if (kind === 'pb' && 'points' in el) {
            drag.current = { kind: 'pscale', id: el.id, orig: el, box: rectFromPoints(el.points), direction: RESIZE_DIRECTIONS[Number(arg)], start: p, began: false };
          } else if (kind === 'rot') {
            const b = selectionBox(el)!;
            const center: Pt = el.type === 'text' || el.type === 'door' ? [el.x, el.y] : [b.cx, b.cy];
            s.beginLive();
            drag.current = { kind: 'rotate', id: el.id, center };
          }
          return;
        }
        const id = target.closest('[data-id]')?.getAttribute('data-id');
        lastDownId.current = id ?? null;
        if (id) {
          const el = elById(id);
          if (e.detail === 2 && el) {
            if (startInlineEdit(id)) return;
            if (el.type === 'text') { window.dispatchEvent(new CustomEvent('evac:focus-text')); return; }
          }
          if (e.shiftKey || e.ctrlKey) { s.select([id], true); return; }
          if (!s.selection.includes(id)) s.select([id]);
          const selIds = new Set(useStore.getState().selection);
          const orig = floor.elements.filter((x) => selIds.has(x.id) && !x.locked);
          if (!orig.length) return;
          const others = floor.elements.filter((x) => !selIds.has(x.id) && isVisibleInVariant(x, variantId));
          const candX: number[] = [], candY: number[] = [];
          for (const o of others) {
            const r = elementBounds(o, lc);
            candX.push(r.x, r.x + r.w / 2, r.x + r.w);
            candY.push(r.y, r.y + r.h / 2, r.y + r.h);
          }
          drag.current = { kind: 'move', start: p, orig, startBounds: unionRects(orig.map((o) => elementBounds(o, lc)))!, began: false, candX, candY };
          return;
        }
        if (target.getAttribute('data-bg') && floor.background) {
          drag.current = { kind: 'bgmove', start: p, ox: floor.background.x, oy: floor.background.y, began: false };
          return;
        }
        if (!e.shiftKey) s.select([]);
        drag.current = { kind: 'marquee', start: p, additive: e.shiftKey };
        return;
      }
      case 'wall': case 'route': case 'room': case 'zone': {
        // (un 2e clic rapide sur un mur à un seul point doit poser la fin du mur, pas l'annuler)
        if (e.detail >= 2 && !(s.tool === 'wall' && draft.length === 1)) { finishPoly(draft); return; }
        const last = draft[draft.length - 1];
        const pt = last && e.shiftKey ? constrain45(last, sp) : sp;
        // Fermeture d'une pièce en cliquant sur le premier point
        if ((s.tool === 'room' || s.tool === 'zone') && draft.length >= 3 && distance(pt, draft[0]) < 10 / s.view.zoom) {
          finishPoly(draft); return;
        }
        // Mur : deux clics (début, fin) puis retour à la sélection. Ctrl + clic : continuer le mur (plusieurs segments).
        if (s.tool === 'wall' && draft.length >= 1 && !e.ctrlKey) {
          if (distance(pt, last) < 0.5) return;
          finishPoly([...draft, pt]); return;
        }
        setDraft([...draft, pt]);
        return;
      }
      case 'door': case 'window': {
        const dt = s.presets.doorType;
        const at = { x: p[0], y: p[1] };
        const opening = (s.tool === 'window'
          ? makeElement('window', { ...at, depth: s.presets.wallThickness })
          : makeElement('door', { ...at, doorType: dt, fireRated: !!s.presets.doorFire, width: dt === 'double' || dt === 'opening' ? 160 : dt === 'revolving' ? 140 : 90 })) as DoorElement | WindowElement;
        placeOne(snapOpening(opening, e.altKey) ?? { ...opening, x: sp[0], y: sp[1] }, e.shiftKey);
        return;
      }
      case 'shape':
      case 'stairs':
        drag.current = { kind: 'rect', start: sp };
        setRectDraft({ x: sp[0], y: sp[1], w: 0, h: 0 });
        return;
      case 'symbol': placeSymbol(s.pendingSymbol, p, e, e.shiftKey); return;
      case 'text': {
        const el = makeElement('text', { x: sp[0], y: sp[1], text: 'Nouveau texte' });
        s.addElements([el]);
        s.setTool('select');
        useStore.setState({ selection: [el.id] });
        setTimeout(() => window.dispatchEvent(new CustomEvent('evac:focus-text')), 50);
        return;
      }
      case 'legend': {
        const el = makeElement('legend', { x: sp[0], y: sp[1] });
        s.addElements([el]);
        s.setTool('select');
        useStore.setState({ selection: [el.id] });
        return;
      }
      case 'calibrate': {
        const next = [...calib, p];
        if (next.length === 2) {
          setCalib([]);
          onCalibrate(distance(next[0], next[1]));
        } else setCalib(next);
        return;
      }
    }
  };

  /** Pose un élément de la bibliothèque et le sélectionne, sauf si Maj est enfoncée. */
  const placeSymbol = (symbolId: string, at: Pt, e: { altKey: boolean }, keepTool = false) => {
    const s = useStore.getState();
    if (!symbolId) { s.toast('Choisissez d’abord un pictogramme dans la bibliothèque.', 'info'); return; }
    if (symbolId === 'door-double-fire') {
      const opening = makeElement('door', {
        x: at[0], y: at[1], doorType: 'double', fireRated: true, width: 160,
      }) as DoorElement;
      const [x, y] = snap(at, e);
      placeOne(snapOpening(opening, e.altKey) ?? { ...opening, x, y }, keepTool);
      return;
    }
    const def = getBuiltinSymbol(symbolId);
    const isYah = symbolId === 'you-are-here';
    const [x, y] = snap(at, e);
    const symbol = makeElement('symbol', {
      x, y, symbolId, label: def?.defaultLabel ?? '',
      size: isYah ? 56 : 48,
      ...(isYah ? { variantId: currentVariantId(s) } : {}),
    }) as SymbolElement;
    const el = s.grid.symbolSnapEnabled && !e.altKey
      ? snapSymbolToWalls(floor, variantId, symbol, { at, gap: s.grid.symbolWallGap })
      : symbol;
    if (keepTool) s.addElements([el], false);
    else { s.setTool('select'); s.addElements([el]); }
    if (isYah && floor.variants.length > 1) {
      s.toast('« Vous êtes ici » ajouté uniquement à la version active du plan.', 'info');
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = useStore.getState();
    const p = toWorld(e.clientX, e.clientY);
    const sp = snap(p, e);
    setCursor(POLY_TOOLS.includes(s.tool) && draft.length && e.shiftKey ? constrain45(draft[draft.length - 1], sp) : (s.tool === 'calibrate' ? p : sp));
    const d = drag.current;
    if (!d) return;
    switch (d.kind) {
      case 'pan':
        s.setView({ x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy });
        return;
      case 'move': {
        let dx = p[0] - d.start[0], dy = p[1] - d.start[1];
        if (!d.began) {
          if (Math.hypot(dx, dy) * s.view.zoom < 3) return;
          d.began = true;
          s.beginLive();
        }
        const only = d.orig.length === 1 ? d.orig[0] : undefined;
        const symbolTarget: Pt | undefined = only?.type === 'symbol' ? [only.x + dx, only.y + dy] : undefined;
        const fitted = only?.type === 'door' || only?.type === 'window'
          ? snapOpening(translateElement(only, dx, dy), e.altKey)
          : undefined;
        if (fitted) {
          setGuideLines({});
          s.mutateFloor((f) => {
            const index = f.elements.findIndex((el) => el.id === fitted.id);
            if (index !== -1) f.elements[index] = fitted;
          }, { history: false, keepValidation: true });
          return;
        }
        if (s.grid.snap && !e.altKey) {
          const a = snapToGrid([d.startBounds.x + dx, d.startBounds.y + dy], s.grid.size);
          dx = a[0] - d.startBounds.x; dy = a[1] - d.startBounds.y;
        }
        const g: { x?: number; y?: number } = {};
        if (s.guides && !e.altKey) {
          const tol = 6 / s.view.zoom;
          const b = d.startBounds;
          const mx = [b.x + dx, b.x + b.w / 2 + dx, b.x + b.w + dx];
          const my = [b.y + dy, b.y + b.h / 2 + dy, b.y + b.h + dy];
          let best = tol, adj = 0;
          for (const m of mx) for (const c of d.candX) if (Math.abs(c - m) < best) { best = Math.abs(c - m); adj = c - m; g.x = c; }
          if (g.x !== undefined) dx += adj;
          best = tol; adj = 0;
          for (const m of my) for (const c of d.candY) if (Math.abs(c - m) < best) { best = Math.abs(c - m); adj = c - m; g.y = c; }
          if (g.y !== undefined) dy += adj;
        }
        if (only?.type === 'symbol' && s.grid.symbolSnapEnabled && !e.altKey) {
          const moved = translateElement(only, dx, dy);
          const fitted = snapSymbolToWalls(floor, variantId, moved, { at: symbolTarget, gap: s.grid.symbolWallGap });
          if (fitted.x !== moved.x) { dx += fitted.x - moved.x; delete g.x; }
          if (fitted.y !== moved.y) { dy += fitted.y - moved.y; delete g.y; }
        }
        setGuideLines(g);
        const moved = new Map(d.orig.map((o) => [o.id, translateElement(o, dx, dy)]));
        s.mutateFloor((f) => { f.elements = f.elements.map((x) => (moved.get(x.id) as any) ?? x); }, { history: false, keepValidation: true });
        return;
      }
      case 'marquee':
        setMarquee(rectFromPoints([d.start, p]));
        return;
      case 'vertex': {
        if (!d.began) { d.began = true; s.beginLive(); }
        const el = elById(d.id) as any;
        let pt = sp;
        if (e.shiftKey && el?.points) {
          const ref = el.points[d.index - 1] ?? el.points[d.index + 1];
          if (ref) pt = constrain45(ref, sp);
        }
        s.mutateFloor((f) => { const x = f.elements.find((q) => q.id === d.id) as any; if (x) x.points[d.index] = pt; }, { history: false, keepValidation: true });
        return;
      }
      case 'resize':
      case 'pscale': {
        const delta: Pt = [p[0] - d.start[0], p[1] - d.start[1]];
        if (!d.began) {
          if (distance(p, d.start) * s.view.zoom < 2) return;
          d.began = true;
          s.beginLive();
        }
        if (d.kind === 'resize') {
          const resized = resizeBoxElement(d.orig, d.direction, delta, e.shiftKey, lc, d.wallDepth);
          const [sx, sy] = d.direction;
          const canAlign = (s.grid.snap || s.guides) && !e.altKey && !(sx && sy && e.shiftKey);
          const tolerance = 8 / s.view.zoom;
          const fit = resized.type === 'window' && canAlign
            ? windowResizeWallFit(floor, variantId, resized, sy, tolerance)
            : undefined;
          const aligned = fit?.window ?? resized;
          const glass = aligned.type === 'window' && canAlign && sx
            ? windowGlassWallFit(floor, variantId, aligned, sx, tolerance)
            : undefined;
          if (resized.type === 'window') {
            setWindowResizeGuides(fit?.guides ?? []);
            setGlassGuide(glass?.guide);
          }
          s.mutateFloor((f) => {
            const index = f.elements.findIndex((el) => el.id === resized.id);
            if (index !== -1) f.elements[index] = glass?.window ?? aligned;
          }, { history: false, keepValidation: true });
          return;
        }
        if (!('points' in d.orig)) return;
        const r = d.box;
        const [xs, ys] = d.direction;
        const ax = xs < 0 ? r.x + r.w : r.x, ay = ys < 0 ? r.y + r.h : r.y;
        const startEdge: Pt = [xs < 0 ? r.x : r.x + r.w, ys < 0 ? r.y : r.y + r.h];
        const snappedDelta = snap(delta, e);
        const edge: Pt = [startEdge[0] + snappedDelta[0], startEdge[1] + snappedDelta[1]];
        let kx = xs && r.w > 0.5 ? Math.max(0.05, xs * (edge[0] - ax) / r.w) : 1;
        let ky = ys && r.h > 0.5 ? Math.max(0.05, ys * (edge[1] - ay) / r.h) : 1;
        if (e.shiftKey && xs && ys) {
          const scale = (kx * r.w ** 2 + ky * r.h ** 2) / (r.w ** 2 + r.h ** 2);
          kx = scale; ky = scale;
        }
        const pts = d.orig.points.map(([x, y]): Pt => [ax + (x - ax) * kx, ay + (y - ay) * ky]);
        s.mutateFloor((f) => {
          const el = f.elements.find((item) => item.id === d.id);
          if (el && 'points' in el) el.points = pts;
        }, { history: false, keepValidation: true });
        return;
      }
      case 'rotate': {
        let ang = (Math.atan2(p[1] - d.center[1], p[0] - d.center[0]) * 180) / Math.PI + 90;
        const step = e.shiftKey ? 45 : 5;
        ang = ((Math.round(ang / step) * step) % 360 + 360) % 360;
        s.mutateFloor((f) => { const x = f.elements.find((q) => q.id === d.id); if (x) x.rotation = ang; }, { history: false, keepValidation: true });
        return;
      }
      case 'bgmove': {
        const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
        if (!d.began) { if (Math.hypot(dx, dy) * s.view.zoom < 3) return; d.began = true; s.beginLive(); }
        s.mutateFloor((f) => { if (f.background) { f.background.x = d.ox + dx; f.background.y = d.oy + dy; } }, { history: false, keepValidation: true });
        return;
      }
      case 'rect':
        setRectDraft(rectFromPoints([d.start, sp]));
        return;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = useStore.getState();
    const d = drag.current;
    drag.current = null;
    setGuideLines({});
    setWindowResizeGuides([]);
    setGlassGuide(undefined);
    if (!d) return;
    if (d.kind === 'marquee') {
      const p = toWorld(e.clientX, e.clientY);
      const r = rectFromPoints([d.start, p]);
      setMarquee(null);
      if (r.w * s.view.zoom < 3 && r.h * s.view.zoom < 3) return;
      const crossing = p[0] < d.start[0];
      const lockedLayers = new Set(floor.layers.filter((l) => l.locked || !l.visible).map((l) => l.id));
      const ids = floor.elements
        .filter((x) => !lockedLayers.has(x.layer) && isVisibleInVariant(x, variantId))
        .filter((x) => (crossing ? rectsIntersect(r, elementBounds(x, lc)) : rectContains(r, elementBounds(x, lc))))
        .map((x) => x.id);
      s.select(ids, d.additive);
    } else if (d.kind === 'rect') {
      const r = rectDraft;
      setRectDraft(null);
      const w = r && r.w > 10 ? r.w : 120, h = r && r.h > 10 ? r.h : 240;
      const cx = r && r.w > 10 ? r.x + r.w / 2 : d.start[0];
      const cy = r && r.h > 10 ? r.y + r.h / 2 : d.start[1];
      if (s.tool === 'shape') {
        const sh = s.presets.shape;
        const el = makeElement('shape', { x: cx, y: cy, w: r && r.w > 10 ? w : 160, h: sh === 'line' ? 0 : r && r.h > 10 ? h : 100, shape: sh,
          ...(sh === 'line' ? { fill: 'none', stroke: '#1d2630', strokeWidth: 3 } : {}) });
        placeOne(el, e.shiftKey);
      } else {
        placeOne(makeElement('stairs', { x: cx, y: cy, w, h, steps: Math.max(3, Math.round(Math.max(w, h) / 25)), stairType: s.presets.stairType, arrow: s.presets.stairArrow !== false, split: !!s.presets.stairSplit }), e.shiftKey);
      }
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-evac-symbol');
    if (!id) return;
    e.preventDefault();
    placeSymbol(id, toWorld(e.clientX, e.clientY), e);
  };

  // ——— Rendus auxiliaires ———
  const z = view.zoom;
  const hs = 8 / z;
  const selEls = selection.map(elById).filter(Boolean) as Element[];

  const gridPattern = (() => {
    let gs = grid.size * z;
    while (gs < 9) gs *= 2;
    const n = Math.max(2, grid.majorEvery);
    const major = gs * n;
    const I = Math.max(0, Math.min(1, grid.intensity));
    return { gs, major, n, minor: `rgba(55,72,92,${(0.1 + 0.32 * I).toFixed(3)})`, majorC: `rgba(35,50,68,${(0.2 + 0.5 * I).toFixed(3)})` };
  })();

  const handles: React.ReactNode[] = [];
  if (tool === 'select' && selEls.length === 1 && !selEls[0].locked) {
    const el = selEls[0];
    if ('points' in el) {
      el.points.forEach((pt, i) => {
        if (i < el.points.length - 1 || el.type === 'area') {
          const nx = el.points[(i + 1) % el.points.length];
          handles.push(<circle key={`m${i}`} data-handle={`m:${i}`} className="handle-mid" cx={(pt[0] + nx[0]) / 2} cy={(pt[1] + nx[1]) / 2} r={hs * 0.45} />);
        }
      });
      el.points.forEach((pt, i) => handles.push(
        <rect key={`v${i}`} data-handle={`v:${i}`} className="handle" x={pt[0] - hs / 2} y={pt[1] - hs / 2} width={hs} height={hs} />,
      ));
      // Cadre d'étirement : 4 coins + 4 côtés (le côté opposé reste fixe).
      const r = rectFromPoints(el.points);
      const padX = Math.max(10 / z, (40 / z - r.w) / 2);
      const padY = Math.max(10 / z, (40 / z - r.h) / 2);
      const x0 = r.x - padX, y0 = r.y - padY, x1 = r.x + r.w + padX, y1 = r.y + r.h + padY;
      handles.push(<rect key="pbox" className="sel-box" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />);
      RESIZE_DIRECTIONS.forEach(([sx, sy], i) => {
        if ((sx && r.w < 0.5) || (sy && r.h < 0.5)) return;
        const at: Pt = [(x0 + x1) / 2 + sx * (x1 - x0) / 2, (y0 + y1) / 2 + sy * (y1 - y0) / 2];
        handles.push(resizeHandle(`pb:${i}`, at, [sx, sy], z));
      });
    } else {
      const b = selectionBox(el)!;
      const pivot: Pt = el.type === 'text' || el.type === 'door' ? [el.x, el.y] : [b.cx, b.cy];
      const rotation = el.type === 'legend' ? 0 : el.rotation;
      const rot = (q: Pt) => rotatePoint(q, pivot, rotation);
      const corners = RESIZE_DIRECTIONS.slice(0, 4).map(([sx, sy]) => rot([b.cx + sx * b.w / 2, b.cy + sy * b.h / 2]));
      handles.push(<polygon key="box" className="sel-box" points={corners.map((c) => c.join(',')).join(' ')} />);
      const handleW = Math.max(b.w, 40 / z), handleH = Math.max(b.h, 40 / z);
      const widthOnly = el.type === 'door' || (el.type === 'shape' && el.shape === 'line');
      RESIZE_DIRECTIONS.forEach(([sx, sy], i) => {
        if (widthOnly && sy) return;
        const y = el.type === 'door' ? el.y : b.cy + sy * handleH / 2;
        handles.push(resizeHandle(`r:${i}`, rot([b.cx + sx * handleW / 2, y]), [sx, sy], z, rotation));
      });
      if (el.type !== 'legend') {
        const top = rot([b.cx, b.cy - b.h / 2]);
        const knob = rot([b.cx, b.cy - handleH / 2 - 26 / z]);
        handles.push(<line key="rl" className="sel-line" x1={top[0]} y1={top[1]} x2={knob[0]} y2={knob[1]} />);
        handles.push(<circle key="rot" data-handle="rot" className="handle-rot" cx={knob[0]} cy={knob[1]} r={hs * 0.65} />);
      }
    }
  }

  const selBoxes = selEls.map((el) => {
    if (selEls.length === 1 && !('points' in el) && !el.locked) return null;
    const r = elementBounds(el, lc);
    return <rect key={el.id} className={el.locked ? 'sel-box locked' : 'sel-box'} x={r.x - 3 / z} y={r.y - 3 / z} width={r.w + 6 / z} height={r.h + 6 / z} />;
  });

  // Aperçu du tracé en cours
  let preview: React.ReactNode = null;
  if (draft.length && cursor) {
    const pts = [...draft, cursor];
    const routeColor = getCountry(project.country).routeColor;
    const tmp: Element | null =
      tool === 'wall' ? makeElement('wall', { points: pts })
      : tool === 'route' ? makeElement('route', { points: pts }, routeColor)
      : pts.length >= 3 ? makeElement('area', tool === 'zone'
        ? ZONE_STYLE(pts)
        : { points: pts })
      : null;
    const seg = distance(draft[draft.length - 1], cursor);
    const label = floor.unitsPerMeter > 0
      ? `${(seg / floor.unitsPerMeter).toFixed(2)} m  (total ${(polylineLength(pts) / floor.unitsPerMeter).toFixed(2)} m)`
      : `${Math.round(seg)} u`;
    preview = (
      <g className="preview" pointerEvents="none">
        {tmp && <g opacity={0.7}><ElementView el={tmp} ctx={{ floor, variantId, customSymbols: project.customSymbols, interactive: true }} /></g>}
        <polyline points={pts.map((q) => q.join(',')).join(' ')} className="draft-line" />
        {draft.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={3 / z} className="draft-pt" />)}
        <text x={cursor[0] + 12 / z} y={cursor[1] - 12 / z} fontSize={12 / z} className="measure">{label}</text>
      </g>
    );
  }
  let calibPreview: React.ReactNode = null;
  if (tool === 'calibrate' && calib.length === 1 && cursor) {
    calibPreview = (
      <g pointerEvents="none">
        <line x1={calib[0][0]} y1={calib[0][1]} x2={cursor[0]} y2={cursor[1]} className="calib-line" />
        <circle cx={calib[0][0]} cy={calib[0][1]} r={4 / z} className="draft-pt" />
      </g>
    );
  }

  // Indication de survol pour l'insertion de point sur un itinéraire
  const hint = (() => {
    if (tool === 'symbol' && pendingSymbol === 'you-are-here') {
      const name = floor.variants.find((v) => v.id === variantId)?.name;
      return `Cliquez sur le plan pour placer « Vous êtes ici » sur l’affiche « ${name} ».`;
    }
    if (tool === 'select' && selEls.length === 1 && selEls[0].type === 'window' && (grid.snap || guidesOn)) {
      if (glassGuide) return 'Bord blanc du vitrage aligné sur le bord du mur.';
      return windowResizeGuides.length
        ? 'Fenêtre alignée sur les deux faces du mur.'
        : 'Approchez le bord de la fenêtre d’une face du mur • Alt pour un réglage libre';
    }
    if (tool === 'select' && selEls.length === 1 && 'points' in selEls[0] && cursor) {
      const el = selEls[0];
      for (let i = 0; i < el.points.length - 1; i++) {
        if (distToSegment(cursor, el.points[i], el.points[i + 1]) < 6 / z) return 'Glissez un point milieu pour ajouter un point de passage ; double-clic sur un point pour le supprimer.';
      }
    }
    return HINTS[tool];
  })();

  return (
    <div ref={wrapRef} className="canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className="canvas"
        width={size.w}
        height={size.h}
        style={{ cursor: drag.current?.kind === 'pan' ? 'grabbing' : CURSORS[tool] }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setGuideLines({});
          setWindowResizeGuides([]);
          setGlassGuide(undefined);
          setMarquee(null);
          setRectDraft(null);
        }}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={() => {
          const id = lastDownId.current;
          if (!id || editing || useStore.getState().tool !== 'select') return;
          const el = elById(id);
          if (startInlineEdit(id)) { drag.current = null; return; }
          if (el?.type === 'text') window.dispatchEvent(new CustomEvent('evac:focus-text'));
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="editor-grid" width={gridPattern.major} height={gridPattern.major} patternUnits="userSpaceOnUse"
            x={view.x % gridPattern.major} y={view.y % gridPattern.major}>
            {grid.style === 'dots' ? (
              <g>
                {Array.from({ length: gridPattern.n }, (_, i) => Array.from({ length: gridPattern.n }, (_, j) => (
                  <circle key={`${i}-${j}`} cx={i * gridPattern.gs} cy={j * gridPattern.gs} r={i === 0 && j === 0 ? 1.9 : 1.15}
                    fill={i === 0 && j === 0 ? gridPattern.majorC : gridPattern.minor} />
                )))}
              </g>
            ) : (
              <g fill="none">
                <path d={Array.from({ length: gridPattern.n }, (_, i) => `M ${i * gridPattern.gs + 0.5} 0 V ${gridPattern.major} M 0 ${i * gridPattern.gs + 0.5} H ${gridPattern.major}`).join(' ')}
                  stroke={gridPattern.minor} strokeWidth={1} />
                <path d={`M 0.5 0 V ${gridPattern.major} M 0 0.5 H ${gridPattern.major}`} stroke={gridPattern.majorC} strokeWidth={1} />
              </g>
            )}
          </pattern>
        </defs>
        <rect x={0} y={0} width={size.w} height={size.h} fill={floor.page.planBackground || '#ffffff'} />
        {grid.show && <rect x={0} y={0} width={size.w} height={size.h} fill="url(#editor-grid)" pointerEvents="none" />}
        <g transform={`translate(${view.x} ${view.y}) scale(${z})`}>
          <FloorDrawing floor={floor} variantId={variantId} customSymbols={project.customSymbols} interactive />
          {rectDraft && <rect className="draft-rect" x={rectDraft.x} y={rectDraft.y} width={rectDraft.w} height={rectDraft.h} />}
          {preview}
          {calibPreview}
          <g className="overlay" style={{ ['--z' as any]: z }}>
            {selBoxes}
            {handles}
            {marquee && <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} />}
            {guidesOn && guideLines.x !== undefined && <line className="guide" x1={guideLines.x} x2={guideLines.x} y1={-1e5} y2={1e5} />}
            {guidesOn && guideLines.y !== undefined && <line className="guide" y1={guideLines.y} y2={guideLines.y} x1={-1e5} x2={1e5} />}
            {guidesOn && windowResizeGuides.map(([[x1, y1], [x2, y2]], i) => (
              <line key={i} className="guide" x1={x1} y1={y1} x2={x2} y2={y2} />
            ))}
            {guidesOn && glassGuide && (
              <line className="guide" x1={glassGuide[0][0]} y1={glassGuide[0][1]} x2={glassGuide[1][0]} y2={glassGuide[1][1]} style={{ strokeWidth: 2 }} />
            )}
          </g>
        </g>
      </svg>
      {tool === 'route' && floor.variants.length > 1 && (
        <label className="canvas-route-scope">
          <input type="checkbox" checked={localRoute === variantId} onChange={(e) => setLocalRoute(e.target.checked ? variantId : '')} />
          Itinéraire réservé à cette affiche
        </label>
      )}
      {editing && (
        <InlineEditor
          key={editing.id}
          editing={editing}
          left={editing.anchor[0] * z + view.x}
          top={editing.anchor[1] * z + view.y}
          fontSize={Math.min(40, Math.max(13, editing.field.size * z))}
          onCommit={(v) => commitInlineEdit(editing, v)}
          onCancel={() => setEditing(null)}
        />
      )}
      {hint && !editing && <div className="canvas-hint">{hint}</div>}
      {editing && <div className="canvas-hint">Entrée : valider{editing.field.multiline ? ' • Maj+Entrée : nouvelle ligne' : ''} • Échap : annuler</div>}
      <CoordReadout floor={floor} cursor={cursor} />
      {useStore.getState().rulers && <Rulers w={size.w} h={size.h} view={view} upm={floor.unitsPerMeter} cursor={cursor} />}
    </div>
  );
}

/** Zone de saisie posée sur le plan pour renommer un élément sans passer par le panneau latéral. */
function InlineEditor({ editing, left, top, fontSize, onCommit, onCancel }: {
  editing: Editing; left: number; top: number; fontSize: number; onCommit(v: string): void; onCancel(): void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(editing.value);
  const done = useRef(false);
  // Focus différé : le mousedown du double-clic redonne sinon le focus au plan juste après (blur → fermeture immédiate).
  useEffect(() => {
    const h = window.setTimeout(() => { const t = ref.current; if (t) { t.focus(); t.select(); } }, 0);
    return () => window.clearTimeout(h);
  }, []);
  const lines = Math.max(1, value.split('\n').length);
  const longest = Math.max(4, ...value.split('\n').map((l) => l.length));
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value); else onCancel();
  };
  return (
    <textarea
      ref={ref}
      className="inline-edit"
      value={value}
      rows={lines}
      spellCheck={false}
      style={{ left, top, fontSize, width: `calc(${longest + 2}ch + 16px)` }}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Enter' && !(e.shiftKey && editing.field.multiline)) { e.preventDefault(); finish(true); }
      }}
      onBlur={() => finish(true)}
    />
  );
}

/** Règles graduées (mètres si l'échelle est étalonnée, unités sinon). */
function Rulers({ w, h, view, upm, cursor }: { w: number; h: number; view: { x: number; y: number; zoom: number }; upm: number; cursor: Pt | null }) {
  const unit = upm > 0 ? upm : 1;
  const steps = upm > 0 ? [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200] : [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const step = steps.find((s) => s * unit * view.zoom >= 64) ?? steps[steps.length - 1];
  const px = step * unit * view.zoom;
  const fmt = (v: number) => (upm > 0 ? `${+v.toFixed(1)} m` : String(Math.round(v)));
  const ticks = (len: number, offset: number) => {
    const out: { p: number; v: number; major: boolean }[] = [];
    const first = Math.floor(-offset / px) - 1;
    for (let i = first; i * px + offset < len + px; i++) {
      for (let k = 0; k < 5; k++) out.push({ p: i * px + offset + (k * px) / 5, v: i * step, major: k === 0 });
    }
    return out;
  };
  const tx = ticks(w, view.x), ty = ticks(h, view.y);
  return (
    <svg className="rulers" width={w} height={h} aria-hidden="true">
      <rect x={0} y={0} width={w} height={RULER} className="ruler-bg" />
      <rect x={0} y={0} width={RULER} height={h} className="ruler-bg" />
      {tx.filter((t) => t.p > RULER).map((t, i) => (
        <g key={`x${i}`}>
          <line x1={t.p} x2={t.p} y1={t.major ? 6 : 15} y2={RULER} className="ruler-tick" />
          {t.major && <text x={t.p + 3} y={11} className="ruler-txt">{fmt(t.v)}</text>}
        </g>
      ))}
      {ty.filter((t) => t.p > RULER).map((t, i) => (
        <g key={`y${i}`}>
          <line y1={t.p} y2={t.p} x1={t.major ? 6 : 15} x2={RULER} className="ruler-tick" />
          {t.major && <text x={11} y={t.p + 3} className="ruler-txt" transform={`rotate(-90 11 ${t.p + 3})`} textAnchor="end">{fmt(t.v)}</text>}
        </g>
      ))}
      {cursor && <line x1={cursor[0] * view.zoom + view.x} x2={cursor[0] * view.zoom + view.x} y1={0} y2={RULER} className="ruler-cursor" />}
      {cursor && <line y1={cursor[1] * view.zoom + view.y} y2={cursor[1] * view.zoom + view.y} x1={0} x2={RULER} className="ruler-cursor" />}
      <rect x={0} y={0} width={RULER} height={RULER} className="ruler-corner" />
      <line x1={0} y1={RULER - 0.5} x2={w} y2={RULER - 0.5} className="ruler-edge" />
      <line x1={RULER - 0.5} y1={0} x2={RULER - 0.5} y2={h} className="ruler-edge" />
    </svg>
  );
}

const HINTS: Partial<Record<Tool, string>> = {
  wall: 'Clic : début du mur • 2e clic : fin du mur (retour à la sélection) • Maj : angles à 45° • Ctrl + clic : continuer le mur en plusieurs segments',
  route: 'Cliquez pour poser les points de passage • Maj : angles à 45° • Double-clic, Entrée, Échap ou clic droit : terminer',
  room: 'Cliquez les angles de la pièce • Cliquez sur le premier point, double-clic, Entrée, Échap ou clic droit pour fermer',
  zone: 'Cliquez les angles de la zone • Cliquez sur le premier point, double-clic, Entrée, Échap ou clic droit pour fermer',
  door: 'Cliquez pour placer une porte (type choisi dans le ruban Bâtiment) • retour automatique à la sélection • Maj + clic : en placer plusieurs',
  window: 'Cliquez sur un mur pour placer une fenêtre • retour automatique à la sélection • Maj + clic : en placer plusieurs',
  shape: 'Tracez un rectangle pour dessiner la forme choisie dans le ruban Insérer',
  stairs: 'Tracez un rectangle (ou cliquez) pour placer un escalier • Maj : en placer plusieurs',
  symbol: 'Cliquez sur le plan pour placer le pictogramme choisi (retour automatique à la sélection) • Maj + clic : en placer plusieurs • Échap : annuler',
  text: 'Cliquez pour placer un texte',
  legend: 'Cliquez pour placer une légende automatique',
  calibrate: 'Étalonnage : cliquez deux points dont vous connaissez la distance réelle (ex. une cote du plan)',
  pan: 'Glissez pour déplacer la vue • Molette : zoom',
};

function CoordReadout({ floor, cursor }: { floor: Floor; cursor: Pt | null }) {
  if (!cursor) return null;
  const u = floor.unitsPerMeter;
  return (
    <div className="coords">
      {u > 0 ? `x ${(cursor[0] / u).toFixed(2)} m · y ${(cursor[1] / u).toFixed(2)} m` : `x ${Math.round(cursor[0])} · y ${Math.round(cursor[1])} u`}
    </div>
  );
}
