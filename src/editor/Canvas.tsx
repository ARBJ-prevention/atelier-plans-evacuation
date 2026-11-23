import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { makeElement } from '../model/defaults';
import { getCountry } from '../model/countries';
import {
  boxOf, constrain45, corridorWidthAt, rotateElementAround, scaleElementAround, constrainWallTo45, straightnessLabel, distance, distToSegment, elementBounds, floorContentBounds, isVisibleInVariant,
  openingWallFit, openingShortWall, polylineLength, dimensionOffsetAt, formatLength, raiseOpeningAboveWalls, snapPointToWalls, wallJoints, rectContains, rectFromPoints, rectsIntersect, RESIZE_DIRECTIONS, resizeBoxElement, rotatePoint, roundDoorWidth, snapSymbolToWalls, snapToGrid, translateElement,
  unionRects, windowGlassWallFit, windowResizeWallFit, type Rect,
} from '../model/geometry';
import type { DoorElement, Element, Floor, Pt, SymbolElement, WindowElement } from '../model/types';
import { ElementView, legendCount, polygonCentroid } from '../render/ElementView';
import { hereCallout } from '../model/hereCallout';
import { FloorDrawing } from '../render/FloorDrawing';
import { computeCirculation, type Circulation } from '../services/circulation';
import { getBuiltinSymbol } from '../symbols/library';
import { currentFloor, currentVariantId, useStore, type Tool } from '../store/store';

/** Sommet d'un autre mur raccordé au mur déplacé (il suit le déplacement). */
type Joint = { id: string; index: number; orig: Pt };

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; start: Pt; orig: Element[]; startBounds: Rect; began: boolean; candX: number[]; candY: number[]; joints?: Joint[] }
  | { kind: 'marquee'; start: Pt; additive: boolean }
  | { kind: 'vertex'; id: string; index: number; began: boolean; joints?: Joint[] }
  | { kind: 'slide'; id: string; index: number; orig: [Pt, Pt]; start: Pt; n: Pt; began: boolean; joints: Joint[]; cands: number[] }
  | { kind: 'resize'; orig: Element; start: Pt; direction: Pt; wallDepth?: number; began: boolean }
  | { kind: 'pscale'; id: string; orig: Element; box: Rect; direction: Pt; start: Pt; began: boolean }
  | { kind: 'rotate'; id: string; center: Pt }
  | { kind: 'grot'; orig: Element[]; pivot: Pt; a0: number }
  | { kind: 'gscale'; orig: Element[]; anchor: Pt; d0: number }
  | { kind: 'label'; id: string; start: Pt; ox: number; oy: number; began: boolean; here?: boolean }
  | { kind: 'bgmove'; start: Pt; ox: number; oy: number; began: boolean }
  | { kind: 'rect'; start: Pt };

const POLY_TOOLS: Tool[] = ['wall', 'route', 'room', 'zone', 'measure'];
const ZONE_STYLE = (points: Pt[]) => ({
  points, kind: 'zone', fill: '#d52b1e', fillOpacity: 0.08, pattern: 'hatch', patternColor: '#d52b1e', stroke: '#d52b1e',
  strokeWidth: 2.5, dash: 'dashed', label: 'Zone', labelColor: '#d52b1e', labelBold: true,
});
const RULER = 22;

/** Écart (pixels écran) entre le tracé et le cadre d'étirement d'un itinéraire, d'un mur ou d'une zone. */
const STRETCH_GAP = 22;

/** Rectangle (repère de la page) d'un escalier tourné d'un multiple de 90°, sinon null. */
function stairsAxisBox(el: Element): Rect | null {
  if (el.type !== 'stairs') return null;
  const q = ((Math.round(el.rotation) % 360) + 360) % 360;
  if (q % 90) return null;
  const [w, h] = q % 180 ? [el.h, el.w] : [el.w, el.h];
  return { x: el.x - w / 2, y: el.y - h / 2, w, h };
}

/**
 * Aimant entre escaliers au redimensionnement : chaque bord qui bouge se cale sur le bord le plus proche
 * d'un autre escalier (même alignement, escaliers empilés de même largeur).
 */
function snapStairsBox(el: Element, orig: Element, floor: Floor, variantId: string, tol: number): Element {
  const b = stairsAxisBox(el), o = stairsAxisBox(orig);
  if (!b || !o || el.type !== 'stairs') return el;
  const xs: number[] = [], ys: number[] = [];
  for (const x of floor.elements) {
    if (x.id === el.id || x.type !== 'stairs' || !isVisibleInVariant(x, variantId)) continue;
    const r = stairsAxisBox(x);
    if (r) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); }
  }
  const near = (v: number, cands: number[]) => {
    let best = v, d = tol;
    for (const c of cands) if (Math.abs(c - v) < d) { d = Math.abs(c - v); best = c; }
    return best;
  };
  let x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
  const eps = 1e-6;
  if (Math.abs(x0 - o.x) > eps) x0 = near(x0, xs);
  if (Math.abs(x1 - (o.x + o.w)) > eps) x1 = near(x1, xs);
  if (Math.abs(y0 - o.y) > eps) y0 = near(y0, ys);
  if (Math.abs(y1 - (o.y + o.h)) > eps) y1 = near(y1, ys);
  if (x1 - x0 < 20 || y1 - y0 < 20) return el;
  const q = ((Math.round(el.rotation) % 360) + 360) % 360;
  const [w, h] = q % 180 ? [y1 - y0, x1 - x0] : [x1 - x0, y1 - y0];
  return { ...el, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w, h };
}

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
  door: 'copy', window: 'copy', shape: 'crosshair', stairs: 'crosshair', text: 'text', symbol: 'copy', calibrate: 'crosshair', legend: 'copy', dimension: 'crosshair', measure: 'crosshair',
};

export interface CanvasProps {
  onCalibrate(unitsDistance: number): void;
}

export function Canvas({ onCalibrate }: CanvasProps) {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => currentFloor(s))!;
  const variantId = useStore((s) => currentVariantId(s));
  const showCirculation = useStore((s) => s.showCirculation);
  const [circulation, setCirculation] = useState<Circulation | null>(null);
  useEffect(() => {
    if (!showCirculation) { setCirculation(null); return; }
    // recalcul différé : pas de calcul à chaque image pendant un déplacement
    const t = setTimeout(() => setCirculation(computeCirculation(floor, variantId)), circulation ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCirculation, floor, variantId]);
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
  const lastShortWallHint = useRef(0);
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [rectDraft, setRectDraft] = useState<Rect | null>(null);
  const [guideLines, setGuideLines] = useState<{ x?: number; y?: number }>({});
  /** Point d'accroche d'un mur sur un autre (extrémité ou axe), affiché pendant le tracé ou le déplacement. */
  const [wallHint, setWallHint] = useState<Pt | null>(null);
  const [routeHint, setRouteHint] = useState<Pt | null>(null);
  const [wallFaceGuides, setWallFaceGuides] = useState<[Pt, Pt][]>([]);
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

  /** Point de mur : accroché à l'extrémité ou à l'axe d'un mur voisin (Alt pour un placement libre), sinon à la grille. */
  /** Aimant des itinéraires : un point posé près d'un itinéraire existant se cale sur son axe. */
  const snapRoute = (p: Pt, e: { altKey: boolean }): Pt => {
    const st = useStore.getState();
    if (e.altKey) { if (routeHint) setRouteHint(null); return snap(p, e); }
    let best: Pt | null = null, bd = Infinity;
    for (const r of floor.elements) {
      if (r.type !== 'route' || !isVisibleInVariant(r, variantId)) continue;
      const range = Math.max(r.width * 1.5, 14 / st.view.zoom);
      for (let i = 0; i + 1 < r.points.length; i++) {
        const a = r.points[i], b = r.points[i + 1];
        const d = distToSegment(p, a, b);
        if (d > range || d >= bd) continue;
        const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
        bd = d; best = [a[0] + vx * t, a[1] + vy * t];
      }
    }
    setRouteHint(best);
    return best ?? snap(p, e);
  };
  const snapWall = (p: Pt, e: { altKey: boolean }, exclude: Set<string> = new Set(), ownThickness?: number): Pt => {
    const st = useStore.getState();
    const own = ownThickness ?? st.presets.wallThickness ?? 0;
    const hit = e.altKey ? null : snapPointToWalls(floor, variantId, p, 10 / st.view.zoom, exclude, own);
    setWallHint(hit ? hit.point : null);
    setWallFaceGuides(hit ? hit.faces : []);
    return hit ? hit.point : snap(p, e);
  };

  /** Maj : tracé à 45°, arrêté sur l'axe du mur visé (sinon le point accroché serait décalé et dépasserait). */
  const wall45 = (from: Pt, p: Pt, sp: Pt, e: { altKey: boolean }, exclude: Set<string> = new Set(), ownThickness?: number): Pt => {
    const st = useStore.getState();
    if (e.altKey) return constrain45(from, sp);
    const pt = constrainWallTo45(floor, variantId, from, p, 10 / st.view.zoom, exclude, ownThickness ?? st.presets.wallThickness ?? 0);
    setWallHint(pt);
    return pt;
  };

  // ——— Zoom à la molette (autour du curseur) ———
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = useStore.getState().view;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const zoom = Math.min(40, Math.max(0.002, v.zoom * factor));
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
    if (t === 'measure') {
      const upm = currentFloor(s)?.unitsPerMeter ?? 0;
      s.toast(`Mesure : ${formatLength(polylineLength(clean), upm)}${clean.length > 2 ? ` sur ${clean.length - 1} segments` : ''}${upm > 0 ? '' : ' (échelle non étalonnée)'}`, 'info');
      return;
    }
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
      // Raccord sur un itinéraire existant (par l'arrivée, sinon par le départ) :
      // le nouveau tracé reprend tout son réglage (type, couleur, chevrons, virages…).
      const f = currentFloor(s);
      if (f) {
        const routes = f.elements.filter((e): e is Extract<Element, { type: 'route' }> => e.type === 'route' && isVisibleInVariant(e, active));
        const near = (pt: Pt) => {
          let best: (typeof routes)[number] | undefined, bd = Infinity, proj: Pt = pt;
          for (const r of routes) for (let i = 0; i + 1 < r.points.length; i++) {
            const a = r.points[i], b = r.points[i + 1];
            const d = distToSegment(pt, a, b);
            if (d < bd) {
              bd = d; best = r;
              const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1;
              const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * vx + (pt[1] - a[1]) * vy) / L2));
              proj = [a[0] + vx * t, a[1] + vy * t];
            }
          }
          return best && bd <= Math.max(best.width * 2, f.unitsPerMeter * 0.4) ? { ref: best, proj } : undefined;
        };
        const atEnd = near(clean[clean.length - 1]);
        const atStart = atEnd ? undefined : near(clean[0]);
        const hit = atEnd ?? atStart;
        if (hit) {
          const { color, width, dash, arrowEnd, arrowStart, arrowStyle, arrowSize, arrowRepeat, repeatColor, corner, cornerRadius, outline, smooth, kind } = hit.ref;
          Object.assign(el, { color, width, dash, arrowEnd, arrowStart, arrowStyle, arrowSize, arrowRepeat, repeatColor, corner, cornerRadius, outline, smooth, kind });
          // Le raccord se fond dans la bande existante : le bout est posé sur son axe
          // (le trait ne déborde pas de l'autre côté) et ne porte pas de pointe.
          // Le bout s'arrête au bord de la bande (recul d'une demi-largeur depuis l'axe).
          // Coupe au premier contact avec la bande rejointe : si le tracé la longe
          // (raccord en biais ou parallèle), toute la partie superposée disparaît.
          const target = hit.ref.points;
          const toTarget = (q: Pt) => {
            let m = Infinity;
            for (let i = 0; i + 1 < target.length; i++) m = Math.min(m, distToSegment(q, target[i], target[i + 1]));
            return m;
          };
          const cutTowardEnd = (pts: Pt[]): Pt[] => {
            // pts se termine sur l'axe de la bande ; on cherche, depuis le début, le premier point à une demi-largeur
            const lim = width / 2;
            for (let i = 0; i + 1 < pts.length; i++) {
              const a = pts[i], b = pts[i + 1];
              if (toTarget(a) <= lim) return i === 0 ? pts.slice(0, 2) : pts.slice(0, i + 1);
              const L = distance(a, b), n = Math.max(2, Math.ceil(L / Math.max(1, lim / 4)));
              for (let k = 1; k <= n; k++) {
                const q: Pt = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n];
                if (toTarget(q) <= lim) return [...pts.slice(0, i + 1), q];
              }
            }
            return pts;
          };
          let pts2 = [...clean];
          if (atEnd) {
            pts2[pts2.length - 1] = hit.proj;
            pts2 = cutTowardEnd(pts2);
            Object.assign(el, { arrowEnd: false, arrowStart: false, joinEnd: true });
          } else {
            pts2[0] = hit.proj;
            pts2 = cutTowardEnd(pts2.reverse()).reverse();
            Object.assign(el, { arrowStart: false, joinStart: true });
          }
          if (pts2.length >= 2 && distance(pts2[0], pts2[pts2.length - 1]) > 1) (el as any).points = pts2;
        }
      }
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
    // les ouvertures s'accrochent aux murs même sans le magnétisme de la grille (Alt : pose libre)
    if (altKey) return undefined;
    const fit = openingWallFit(floor, variantId, opening, 10 / s.view.zoom);
    if (!fit) {
      const short = openingShortWall(floor, variantId, opening, 10 / s.view.zoom);
      const now = Date.now();
      if (short !== undefined && now - lastShortWallHint.current > 4000) {
        lastShortWallHint.current = now;
        const m = floor.unitsPerMeter > 0 ? floor.unitsPerMeter : 50;
        const cm = (v: number) => Math.round((v / m) * 100);
        const what = opening.type === 'window' ? 'La fenêtre' : 'La porte';
        s.toast(`${what} (${cm(opening.width)} cm) ne peut pas s’accrocher : ce tronçon de mur ne mesure que ${cm(short)} cm. Réduisez sa largeur ou retracez le mur en un seul segment plus long.`, 'warning');
      }
      return undefined;
    }
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
    const sp = s.tool === 'wall' || s.tool === 'dimension' || s.tool === 'measure' ? snapWall(p, e) : s.tool === 'route' ? snapRoute(p, e) : snap(p, e);
    const target = e.target as SVGElement;

    switch (s.tool) {
      case 'select': {
        // Cartouche « Vous êtes ici » : on le saisit directement pour le placer librement (même hors du plan)
        const hereId = !e.shiftKey && !e.ctrlKey ? target.closest('[data-here-label]')?.getAttribute('data-here-label') : null;
        const hereEl = hereId ? elById(hereId) : null;
        if (hereEl && hereEl.type === 'symbol' && !hereEl.locked) {
          const c = hereCallout(hereEl, floor, variantId);
          if (c) {
            if (!s.selection.includes(hereEl.id) || s.selection.length !== 1) s.select([hereEl.id]);
            const ox = hereEl.hereOffset ? hereEl.hereOffset[0] : c.x + c.w / 2 - hereEl.x;
            const oy = hereEl.hereOffset ? hereEl.hereOffset[1] : c.y + c.h / 2 - hereEl.y;
            drag.current = { kind: 'label', id: hereEl.id, start: p, ox, oy, began: false, here: true };
            return;
          }
        }
        const handle = target.closest('[data-handle]')?.getAttribute('data-handle');
        if (handle === 'grot' || handle?.startsWith('gs:')) {
          // poignées de la sélection multiple : rotation ou mise à l'échelle de l'ensemble
          const ids = new Set(s.selection);
          const orig = floor.elements.filter((x) => ids.has(x.id) && !x.locked);
          const box = orig.length ? unionRects(orig.map((x) => elementBounds(x))) : null;
          if (!box) return;
          const c: Pt = [box.x + box.w / 2, box.y + box.h / 2];
          s.beginLive();
          if (handle === 'grot') {
            drag.current = { kind: 'grot', orig, pivot: c, a0: Math.atan2(p[1] - c[1], p[0] - c[0]) };
          } else {
            const [sx, sy] = RESIZE_DIRECTIONS[Number(handle.split(':')[1])];
            const anchor: Pt = [c[0] - sx * box.w / 2, c[1] - sy * box.h / 2];
            drag.current = { kind: 'gscale', orig, anchor, d0: Math.max(1e-6, distance(p, anchor)) };
          }
          return;
        }
        if (handle && s.selection.length === 1) {
          const el = elById(s.selection[0]);
          if (!el || el.locked) return;
          const [kind, arg] = handle.split(':');
          if (kind === 'lbl' && el.type === 'area') {
            drag.current = { kind: 'label', id: el.id, start: p, ox: el.labelDx || 0, oy: el.labelDy || 0, began: false };
          } else if (kind === 'v') {
            if (e.detail === 2 && 'points' in el) {
              const min = el.type === 'area' ? 3 : 2;
              if (el.points.length > min) {
                s.mutateFloor((f) => { const d = f.elements.find((x) => x.id === el.id) as any; d.points.splice(Number(arg), 1); });
              }
              return;
            }
            const index = Number(arg);
            const joints = el.type === 'wall' ? wallJoints(floor, variantId, el.id, el.points[index]) : undefined;
            drag.current = { kind: 'vertex', id: el.id, index, began: false, joints };
          } else if (kind === 'm' && el.type === 'wall' && !(e.ctrlKey || e.metaKey)) {
            // coulisser le pan de mur parallèlement à lui-même (Ctrl : ajouter un point à la place)
            const i = Number(arg);
            const a = el.points[i], b = el.points[(i + 1) % el.points.length];
            const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n: Pt = [-u[1], u[0]];
            // murs raccordés aux deux extrémités : ils suivent, sauf ceux qui prolongent le mur (ils se plieraient)
            const joints = [...wallJoints(floor, variantId, el.id, a), ...wallJoints(floor, variantId, el.id, b)].filter((j) => {
              const w = floor.elements.find((x) => x.id === j.id);
              if (!w || w.type !== 'wall') return false;
              const nb = w.points[j.index + 1] ?? w.points[j.index - 1];
              if (!nb) return true;
              const dl = Math.hypot(nb[0] - j.orig[0], nb[1] - j.orig[1]) || 1;
              return Math.abs(((nb[0] - j.orig[0]) * u[0] + (nb[1] - j.orig[1]) * u[1]) / dl) < 0.94;
            });
            // positions d'alignement : axe et faces des autres murs parallèles
            const cands: number[] = [];
            for (const w of floor.elements) {
              if (w.type !== 'wall' || w.id === el.id || !isVisibleInVariant(w, variantId)) continue;
              for (let k = 0; k + 1 < w.points.length; k++) {
                const [p0, p1] = [w.points[k], w.points[k + 1]];
                const wl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
                if (wl < 1e-6 || Math.abs(((p1[0] - p0[0]) * n[0] + (p1[1] - p0[1]) * n[1]) / wl) > 0.02) continue;
                const c = p0[0] * n[0] + p0[1] * n[1];
                const df = (w.thickness - el.thickness) / 2;
                cands.push(c, c + df, c - df);
              }
            }
            drag.current = { kind: 'slide', id: el.id, index: i, orig: [a, b], start: p, n, began: false, joints, cands };
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
          // un mur déplacé seul entraîne les extrémités des murs qui lui sont raccordés
          const wall = orig.length === 1 && orig[0].type === 'wall' ? orig[0] : undefined;
          const joints = wall ? wall.points.flatMap((v, i) => wallJoints(floor, variantId, wall.id, v,
            i + 1 < wall.points.length ? [v, wall.points[i + 1]] : undefined)) : undefined;
          drag.current = { kind: 'move', start: p, orig, startBounds: unionRects(orig.map((o) => elementBounds(o, lc)))!, began: false, candX, candY, joints };
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
        const pt = last && e.shiftKey ? (s.tool === 'wall' ? wall45(last, p, sp, e) : constrain45(last, sp)) : sp;
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
          ? makeElement('window', { ...at, depth: s.presets.wallThickness, shutter: s.presets.windowShutter ?? 'none', ...(s.presets.windowStyle && s.presets.windowStyle !== 'standard' ? { windowStyle: s.presets.windowStyle, panes: s.presets.windowStyle === 'casement' ? 2 : 1 } : {}) })
          : makeElement('door', { ...at, doorType: dt, fireRated: !!s.presets.doorFire, width: dt === 'double' || dt === 'opening' || dt === 'unequal' || dt === 'foldingDouble' ? 160 : dt === 'slidingDouble' ? 180 : dt === 'revolving' ? 140 : dt === 'garage' ? 250 : 90 })) as DoorElement | WindowElement;
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
      case 'dimension': {
        // 1er clic : début • 2e clic : fin • 3e clic : position de la ligne de cote
        if (draft.length < 2) {
          const pt = draft.length === 1 && e.shiftKey ? constrain45(draft[0], sp) : sp;
          if (draft.length === 1 && distance(pt, draft[0]) < 0.5) return;
          setDraft([...draft, pt]);
          return;
        }
        const el = makeElement('dimension', { points: [draft[0], draft[1]], offset: dimensionOffsetAt(draft[0], draft[1], p) });
        setDraft([]);
        placeOne(el, e.shiftKey);
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
    if (symbolId === 'door-double-fire' || symbolId === 'door-sliding-double') {
      // posée comme une vraie porte, calée dans le mur visé
      const opening = makeElement('door', symbolId === 'door-double-fire'
        ? { x: at[0], y: at[1], doorType: 'double', fireRated: true, width: 160 }
        : { x: at[0], y: at[1], doorType: 'slidingDouble', width: 180 }) as DoorElement;
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
    // Pictogramme posé dans un couloir : sa taille s'adapte à la largeur entre les murs.
    if (!isYah && !def?.planSymbol && s.grid.symbolSnapEnabled && !e.altKey) {
      const upm = floor.unitsPerMeter > 0 ? floor.unitsPerMeter : 100;
      const clear = corridorWidthAt(floor, variantId, at, upm * 4);
      if (clear) {
        const fit = (clear - 2 * s.grid.symbolWallGap) / (symbol.halo ? 1.26 : 1);
        if (fit >= 16) symbol.size = Math.min(fit, symbol.size * 3);
      }
    }
    const el = s.grid.symbolSnapEnabled && !e.altKey
      ? snapSymbolToWalls(floor, variantId, symbol, { at, gap: s.grid.symbolWallGap })
      : symbol;
    if (keepTool) s.addElements([el], false);
    else { s.setTool('select'); s.addElements([el]); }
    if (isYah && floor.variants.length > 1) {
      s.toast(`« Vous êtes ici » ajouté uniquement à l’affiche « ${floor.variants.find((v) => v.id === variantId)?.name ?? ''} ».`, 'info');
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = useStore.getState();
    const p = toWorld(e.clientX, e.clientY);
    const sp = (s.tool === 'wall' || s.tool === 'dimension' || s.tool === 'measure') && !drag.current ? snapWall(p, e) : s.tool === 'route' && !drag.current ? snapRoute(p, e) : snap(p, e);
    if (s.tool !== 'route' && routeHint) setRouteHint(null);
    if (s.tool !== 'wall' && !drag.current && wallHint) { setWallHint(null); setWallFaceGuides([]); }
    setCursor((POLY_TOOLS.includes(s.tool) || (s.tool === 'dimension' && draft.length === 1)) && draft.length && e.shiftKey ? (s.tool === 'wall' ? wall45(draft[draft.length - 1], p, sp, e) : constrain45(draft[draft.length - 1], sp)) : (s.tool === 'calibrate' ? p : sp));
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
        if (only?.type === 'wall' && !e.altKey) {
          // accroche le mur déplacé aux murs voisins par le sommet le plus proche d'une extrémité ou d'un axe
          const exclude = new Set([only.id, ...(d.joints ?? []).map((j) => j.id)]);
          let fix: { dx: number; dy: number; at: Pt; dist: number; faces: [Pt, Pt][] } | null = null;
          for (const v of only.points) {
            const q: Pt = [v[0] + dx, v[1] + dy];
            const hit = snapPointToWalls(floor, variantId, q, 10 / s.view.zoom, exclude, only.thickness);
            if (hit && (!fix || distance(q, hit.point) < fix.dist)) fix = { dx: hit.point[0] - q[0], dy: hit.point[1] - q[1], at: hit.point, dist: distance(q, hit.point), faces: hit.faces };
          }
          if (fix) { dx += fix.dx; dy += fix.dy; delete g.x; delete g.y; }
          setWallHint(fix ? fix.at : null);
          setWallFaceGuides(fix ? fix.faces : []);
        }
        setGuideLines(g);
        const moved = new Map(d.orig.map((o) => [o.id, translateElement(o, dx, dy)]));
        const joints = d.joints ?? [];
        s.mutateFloor((f) => {
          f.elements = f.elements.map((x) => (moved.get(x.id) as any) ?? x);
          for (const j of joints) {
            const w = f.elements.find((x) => x.id === j.id) as any;
            if (w?.points?.[j.index]) w.points[j.index] = [j.orig[0] + dx, j.orig[1] + dy];
          }
        }, { history: false, keepValidation: true });
        return;
      }
      case 'marquee':
        setMarquee(rectFromPoints([d.start, p]));
        return;
      case 'slide': {
        const [n0, n1] = d.n;
        let off = (p[0] - d.start[0]) * n0 + (p[1] - d.start[1]) * n1;
        if (!d.began) { if (Math.abs(off) * s.view.zoom < 2) return; d.began = true; s.beginLive(); }
        const base = d.orig[0][0] * n0 + d.orig[0][1] * n1;
        let guide: [Pt, Pt][] = [];
        if ((s.grid.snap || s.guides) && !e.altKey) {
          const tol = 8 / s.view.zoom;
          let best: number | null = null;
          for (const c of d.cands) if (Math.abs(c - (base + off)) <= tol && (best == null || Math.abs(c - (base + off)) < Math.abs(best - (base + off)))) best = c;
          if (best != null) {
            off = best - base;
            const u: Pt = [n1, -n0], m: Pt = [(d.orig[0][0] + d.orig[1][0]) / 2 + n0 * off, (d.orig[0][1] + d.orig[1][1]) / 2 + n1 * off];
            guide = [[[m[0] - u[0] * 1e5, m[1] - u[1] * 1e5], [m[0] + u[0] * 1e5, m[1] + u[1] * 1e5]]];
          } else if (s.grid.snap) {
            off = Math.round(off / 5) * 5; // pas de 5 unités sans mur à proximité
          }
        }
        setWindowResizeGuides(guide);
        const mv = (q: Pt): Pt => [q[0] + n0 * off, q[1] + n1 * off];
        s.mutateFloor((f) => {
          const x = f.elements.find((q) => q.id === d.id) as any;
          if (!x) return;
          x.points[d.index] = mv(d.orig[0]);
          x.points[(d.index + 1) % x.points.length] = mv(d.orig[1]);
          for (const j of d.joints) {
            const w = f.elements.find((q) => q.id === j.id) as any;
            if (w?.points?.[j.index]) w.points[j.index] = mv(j.orig);
          }
        }, { history: false, keepValidation: true });
        return;
      }
      case 'vertex': {
        if (!d.began) { d.began = true; s.beginLive(); }
        const el = elById(d.id) as any;
        let pt = el?.type === 'wall' ? snapWall(p, e, new Set([d.id, ...(d.joints ?? []).map((j) => j.id)]), el.thickness) : sp;
        if (e.shiftKey && el?.points) {
          const ref = el.points[d.index - 1] ?? el.points[d.index + 1];
          if (ref) pt = el.type === 'wall' ? wall45(ref, p, sp, e, new Set([d.id, ...(d.joints ?? []).map((j) => j.id)]), el.thickness) : constrain45(ref, sp);
        }
        const joints = d.joints ?? [];
        s.mutateFloor((f) => {
          const x = f.elements.find((q) => q.id === d.id) as any;
          if (x) x.points[d.index] = pt;
          // les murs raccordés à ce sommet le suivent
          for (const j of joints) {
            const w = f.elements.find((q) => q.id === j.id) as any;
            if (w?.points?.[j.index]) w.points[j.index] = pt;
          }
        }, { history: false, keepValidation: true });
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
          let resized = resizeBoxElement(d.orig, d.direction, delta, e.shiftKey, lc, d.wallDepth);
          const [sx, sy] = d.direction;
          if (resized.type === 'door' && floor.unitsPerMeter > 0 && sx) {
            resized = roundDoorWidth(resized, sx, floor.unitsPerMeter, s.grid.snap && !e.altKey ? 5 : 1);
          }
          const canAlign = (s.grid.snap || s.guides) && !e.altKey && !(sx && sy && e.shiftKey);
          const tolerance = 8 / s.view.zoom;
          const fit = resized.type === 'window' && canAlign
            ? windowResizeWallFit(floor, variantId, resized, sy, tolerance)
            : undefined;
          if (resized.type === 'stairs' && canAlign) resized = snapStairsBox(resized, d.orig, floor, variantId, 8 / s.view.zoom);
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
        let pts = d.orig.points.map(([x, y]): Pt => [ax + (x - ax) * kx, ay + (y - ay) * ky]);
        if (d.orig.type === 'wall' && !e.altKey) {
          // mur étiré par sa poignée : l'extrémité tirée s'aimante aux murs voisins (Alt : étirement libre)
          const along = (q: Pt) => q[0] * xs + q[1] * ys;
          const tip = pts.reduce((best, q) => (along(q) > along(best) ? q : best), pts[0]);
          const hit = snapPointToWalls(floor, variantId, tip, 10 / s.view.zoom, new Set([d.id]), d.orig.thickness);
          setWallHint(hit ? hit.point : null);
          setWallFaceGuides(hit ? hit.faces : []);
          if (hit) {
            const i = pts.indexOf(tip), o = d.orig.points[i];
            if (xs && Math.abs(o[0] - ax) > 1e-6) kx = (hit.point[0] - ax) / (o[0] - ax);
            if (ys && Math.abs(o[1] - ay) > 1e-6) ky = (hit.point[1] - ay) / (o[1] - ay);
            pts = d.orig.points.map(([x, y]): Pt => [ax + (x - ax) * kx, ay + (y - ay) * ky]);
          }
        }
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
      case 'grot': case 'gscale': {
        let make: (x: Element) => Element;
        if (d.kind === 'grot') {
          let deg = (Math.atan2(p[1] - d.pivot[1], p[0] - d.pivot[0]) - d.a0) * 180 / Math.PI;
          const step = e.shiftKey ? 45 : 5;
          deg = Math.round(deg / step) * step;
          make = (x) => rotateElementAround(x, d.pivot, deg);
        } else {
          const k = Math.max(0.1, Math.min(20, distance(p, d.anchor) / d.d0));
          make = (x) => scaleElementAround(x, d.anchor, k);
        }
        const byId = new Map(d.orig.map((x) => [x.id, make(x)]));
        s.mutateFloor((f) => { f.elements = f.elements.map((x) => byId.get(x.id) ?? x); }, { history: false, keepValidation: true });
        return;
      }
      case 'label': {
        // nom de la zone déplacé librement (décalage par rapport au centre de la zone)
        const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
        if (!d.began) { if (Math.hypot(dx, dy) * s.view.zoom < 3) return; d.began = true; s.beginLive(); }
        const rd = (v: number) => Math.round(v * 10) / 10;
        s.mutateFloor((f) => {
          const x = f.elements.find((q) => q.id === d.id) as any;
          if (x && d.here) x.hereOffset = [rd(d.ox + dx), rd(d.oy + dy)];
          else if (x) { x.labelDx = rd(d.ox + dx); x.labelDy = rd(d.oy + dy); }
        }, { history: false, keepValidation: true });
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
    setWallHint(null); setWallFaceGuides([]);
    setWindowResizeGuides([]);
    setGlassGuide(undefined);
    if (!d) return;
    if (d.kind === 'move' && d.began) {
      // une porte ou fenêtre déposée sur un mur passe au-dessus des murs, pour ne pas rester cachée dessous
      const ids = d.orig
        .filter((o) => o.type === 'door' || o.type === 'window')
        .map((o) => o.id)
        .filter((id) => {
          const el = floor.elements.find((x) => x.id === id);
          return (el?.type === 'door' || el?.type === 'window') && !!openingWallFit(floor, variantId, el);
        });
      if (ids.length) {
        s.mutateFloor((f) => { for (const id of ids) raiseOpeningAboveWalls(f.elements as Element[], id); }, { history: false, keepValidation: true });
      }
    }
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
    if (el.type === 'area' && (el.label.trim() || el.showArea)) {
      // poignée du nom : on le fait glisser où l'on veut dans (ou hors de) la zone
      const c = polygonCentroid(el.points);
      const lines = el.label ? el.label.split('\n') : [];
      const n = lines.length + (el.showArea ? 1 : 0);
      const chars = Math.max(6, ...lines.map((l) => l.length));
      const w = chars * el.labelSize * 0.62 + 8 / z, h = n * el.labelSize * 1.2 + 6 / z;
      const lx = c[0] + (el.labelDx || 0), ly = c[1] + (el.labelDy || 0);
      handles.push(
        <rect key="lbl" data-handle="lbl" className="label-handle" x={lx - w / 2} y={ly - h / 2} width={w} height={h} rx={4 / z}
          style={{ cursor: 'move' }} fill="rgba(37,99,235,0.07)" stroke="#2563eb" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke">
          <title>Glisser pour déplacer le nom</title>
        </rect>,
      );
    }
    const hc = el.type === 'symbol' ? hereCallout(el, floor, variantId) : null;
    if (hc) {
      // cadre du cartouche « Vous êtes ici » : on le glisse où l'on veut
      const m = 5 / z;
      handles.push(
        <rect key="hlbl" className="label-handle" x={hc.x - m} y={hc.y - m} width={hc.w + m * 2} height={hc.h + m * 2} rx={hc.h / 2 + m}
          fill="none" stroke="#2563eb" strokeWidth={1.2} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />,
      );
    }
    if (el.type === 'dimension') {
      el.points.forEach((pt, i) => handles.push(
        <rect key={`v${i}`} data-handle={`v:${i}`} className="handle" x={pt[0] - hs / 2} y={pt[1] - hs / 2} width={hs} height={hs} />,
      ));
    } else if ('points' in el) {
      el.points.forEach((pt, i) => {
        if (i < el.points.length - 1 || el.type === 'area') {
          const nx = el.points[(i + 1) % el.points.length];
          const mx = (pt[0] + nx[0]) / 2, my = (pt[1] + nx[1]) / 2;
          if (el.type === 'wall') {
            // poignée « coulisser » : flèche double perpendiculaire au mur
            const ang = Math.atan2(nx[1] - pt[1], nx[0] - pt[0]) * 180 / Math.PI;
            const cursor = Math.abs(Math.sin(ang * Math.PI / 180)) > 0.7 ? 'ew-resize' : 'ns-resize';
            const r = hs * 0.75;
            handles.push(
              <g key={`m${i}`} data-handle={`m:${i}`} className="handle-slide" style={{ cursor }} transform={`translate(${mx} ${my}) rotate(${ang})`}>
                <title>Glisser pour faire coulisser le mur (aimant sur les autres murs, Alt : libre) • Ctrl + glisser : ajouter un point</title>
                <rect x={-r * 0.9} y={-r * 1.6} width={r * 1.8} height={r * 3.2} rx={r * 0.5} fill="#fff" stroke="#2563eb" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
                <path d={`M0 ${-r * 1.15} L${r * 0.55} ${-r * 0.4} L${-r * 0.55} ${-r * 0.4} Z M0 ${r * 1.15} L${r * 0.55} ${r * 0.4} L${-r * 0.55} ${r * 0.4} Z`} fill="#2563eb" />
              </g>,
            );
          } else {
            handles.push(<circle key={`m${i}`} data-handle={`m:${i}`} className="handle-mid" cx={mx} cy={my} r={hs * 0.45} />);
          }
        }
      });
      // Cadre d'étirement : 4 coins + 4 côtés (le côté opposé reste fixe). Écarté des sommets
      // pour qu'une poignée du cadre ne recouvre jamais une extrémité du tracé.
      const r = rectFromPoints(el.points);
      const padX = Math.max(STRETCH_GAP / z, (40 / z - r.w) / 2);
      const padY = Math.max(STRETCH_GAP / z, (40 / z - r.h) / 2);
      const x0 = r.x - padX, y0 = r.y - padY, x1 = r.x + r.w + padX, y1 = r.y + r.h + padY;
      handles.push(<rect key="pbox" className="sel-box" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />);
      RESIZE_DIRECTIONS.forEach(([sx, sy], i) => {
        if ((sx && r.w < 0.5) || (sy && r.h < 0.5)) return;
        const at: Pt = [(x0 + x1) / 2 + sx * (x1 - x0) / 2, (y0 + y1) / 2 + sy * (y1 - y0) / 2];
        handles.push(resizeHandle(`pb:${i}`, at, [sx, sy], z));
      });
      // sommets en dernier : toujours au-dessus des autres poignées
      el.points.forEach((pt, i) => handles.push(
        <rect key={`v${i}`} data-handle={`v:${i}`} className="handle" x={pt[0] - hs / 2} y={pt[1] - hs / 2} width={hs} height={hs} />,
      ));
    } else {
      const b = selectionBox(el)!;
      const pivot: Pt = el.type === 'text' || el.type === 'door' ? [el.x, el.y] : [b.cx, b.cy];
      const rotation = el.type === 'legend' ? 0 : el.rotation;
      const rot = (q: Pt) => rotatePoint(q, pivot, rotation);
      const corners = RESIZE_DIRECTIONS.slice(0, 4).map(([sx, sy]) => rot([b.cx + sx * b.w / 2, b.cy + sy * b.h / 2]));
      handles.push(<polygon key="box" className="sel-box" points={corners.map((c) => c.join(',')).join(' ')} />);
      const handleW = Math.max(b.w, 40 / z), handleH = Math.max(b.h, 40 / z);
      const widthOnly = el.type === 'door' || (el.type === 'shape' && el.shape === 'line');
      // pictogramme (toujours proportionnel) ou objet petit à l'écran : les 4 coins suffisent
      const cornersOnly = !widthOnly && (el.type === 'symbol' || Math.max(b.w, b.h) * z < 48);
      RESIZE_DIRECTIONS.forEach(([sx, sy], i) => {
        if (widthOnly && sy) return;
        if (cornersOnly && !(sx && sy)) return;
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

  // Sélection multiple (ex. pictogramme combiné) : 4 coins pour agrandir / réduire
  // l'ensemble, et une poignée au-dessus pour le faire pivoter.
  const free = selEls.filter((x) => !x.locked);
  if (tool === 'select' && selEls.length > 1 && free.length) {
    const gb = unionRects(free.map((x) => elementBounds(x)))!;
    const pad = 4 / z;
    const x0 = gb.x - pad, y0 = gb.y - pad, x1 = gb.x + gb.w + pad, y1 = gb.y + gb.h + pad;
    handles.push(<rect key="gbox" className="sel-box" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />);
    RESIZE_DIRECTIONS.forEach(([sx, sy], i) => {
      if (!(sx && sy)) return;
      handles.push(resizeHandle(`gs:${i}`, [(x0 + x1) / 2 + sx * (x1 - x0) / 2, (y0 + y1) / 2 + sy * (y1 - y0) / 2], [sx, sy], z));
    });
    const cx = (x0 + x1) / 2, knobY = y0 - 26 / z;
    handles.push(<line key="grl" className="sel-line" x1={cx} y1={y0} x2={cx} y2={knobY} />);
    handles.push(<circle key="grot" data-handle="grot" className="handle-rot" cx={cx} cy={knobY} r={hs * 0.65}><title>Glisser pour faire pivoter (Maj : par 45°)</title></circle>);
  }

  const selBoxes = selEls.map((el) => {
    if (selEls.length === 1 && !('points' in el) && !el.locked) return null;
    const r = elementBounds(el, lc);
    return <rect key={el.id} className={el.locked ? 'sel-box locked' : 'sel-box'} x={r.x - 3 / z} y={r.y - 3 / z} width={r.w + 6 / z} height={r.h + 6 / z} />;
  });

  // Aperçu du tracé en cours
  let preview: React.ReactNode = null;
  if (tool === 'dimension' && draft.length && cursor) {
    const tmp = draft.length === 1
      ? makeElement('dimension', { points: [draft[0], cursor] })
      : makeElement('dimension', { points: [draft[0], draft[1]], offset: dimensionOffsetAt(draft[0], draft[1], cursor) });
    preview = (
      <g className="preview" pointerEvents="none">
        <g opacity={0.8}><ElementView el={tmp} ctx={{ floor, variantId, customSymbols: project.customSymbols, interactive: false }} /></g>
        {draft.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={3 / z} className="draft-pt" />)}
      </g>
    );
  } else if (draft.length && cursor) {
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
    const dir = tool === 'wall' && seg > 0.5 ? straightnessLabel(draft[draft.length - 1], cursor) : null;
    preview = (
      <g className="preview" pointerEvents="none">
        {tmp && <g opacity={0.7}><ElementView el={tmp} ctx={{ floor, variantId, customSymbols: project.customSymbols, interactive: true }} /></g>}
        <polyline points={pts.map((q) => q.join(',')).join(' ')} className="draft-line" />
        {draft.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={3 / z} className="draft-pt" />)}
        <text x={cursor[0] + 12 / z} y={cursor[1] - 12 / z} fontSize={12 / z} className="measure">{label}</text>
        {dir && <text x={cursor[0] + 12 / z} y={cursor[1] + 4 / z} fontSize={12 / z} className="measure"
          style={{ fill: dir.straight ? '#00843d' : '#c2410c', fontWeight: 600 }}>{dir.text}{dir.straight ? '' : ' (Maj : tracé droit)'}</text>}
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
        if (distToSegment(cursor, el.points[i], el.points[i + 1]) < 6 / z && el.type === 'wall') return 'Glissez la poignée du milieu pour faire coulisser le mur (il s’aligne sur les autres murs ; Alt : libre) ; Ctrl + glisser pour ajouter un point.';
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
          {circulation && (
            <g className="circulation" pointerEvents="none" aria-hidden="true">
              {circulation.unreachable && <path d={circulation.unreachable} fill="#f59e0b" fillOpacity={0.3} />}
              {circulation.paths.map((p, i) => (
                <polyline key={i} points={p.points.map((q) => q.join(',')).join(' ')} fill="none" stroke="#16a34a" strokeOpacity={0.32}
                  strokeWidth={(floor.unitsPerMeter > 0 ? floor.unitsPerMeter : 50) * 1.1} strokeLinecap="round" strokeLinejoin="round" />
              ))}
              {circulation.stranded.map(([x, y], i) => <circle key={`s${i}`} cx={x} cy={y} r={36 / z} fill="none" stroke="#dc2626" strokeWidth={4 / z} />)}
            </g>
          )}
          {rectDraft && <rect className="draft-rect" x={rectDraft.x} y={rectDraft.y} width={rectDraft.w} height={rectDraft.h} />}
          {preview}
          {calibPreview}
          <g className="overlay" style={{ ['--z' as any]: z }}>
            {floor.variants.length > 1 && floor.elements.filter((x) => x.variantId === variantId && !(x.type === 'symbol' && x.symbolId === 'you-are-here')).map((x) => {
              // repère « propre à cette affiche » (éditeur uniquement, jamais imprimé)
              const r = elementBounds(x, lc);
              return (
                <g key={`own-${x.id}`} className="own-mark" transform={`translate(${r.x + r.w} ${r.y}) scale(${1 / z})`}>
                  <title>Propre à cette affiche</title>
                  <circle r={5} />
                </g>
              );
            })}
            {selBoxes}
            {handles}
            {marquee && <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} />}
            {wallHint && wallFaceGuides.map(([[x1, y1], [x2, y2]], i) => (
              <line key={`wf${i}`} className="guide" x1={x1} y1={y1} x2={x2} y2={y2} />
            ))}
            {wallHint && <circle className="wall-snap" cx={wallHint[0]} cy={wallHint[1]} r={7 / z} />}
            {routeHint && tool === 'route' && <circle className="wall-snap" cx={routeHint[0]} cy={routeHint[1]} r={7 / z} />}
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
      {circulation && <CirculationNote c={circulation} />}
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
  door: 'Cliquez pour placer une porte (type choisi dans le ruban Plan) • retour automatique à la sélection • Maj + clic : en placer plusieurs',
  window: 'Cliquez sur un mur pour placer une fenêtre • retour automatique à la sélection • Maj + clic : en placer plusieurs',
  shape: 'Tracez un rectangle pour dessiner la forme choisie dans le ruban Insérer',
  stairs: 'Tracez un rectangle (ou cliquez) pour placer un escalier • Maj : en placer plusieurs',
  symbol: 'Cliquez sur le plan pour placer le pictogramme choisi (retour automatique à la sélection) • Maj + clic : en placer plusieurs • Échap : annuler',
  text: 'Cliquez pour placer un texte',
  legend: 'Cliquez pour placer une légende automatique',
  dimension: 'Cote : cliquez le début puis la fin de la distance à coter (s’accroche aux murs) • 3e clic : position de la ligne de cote • Maj : angles à 45° • Échap : annuler',
  measure: 'Mesure : cliquez les points du parcours, la longueur s’affiche en direct • Double-clic, Entrée ou clic droit : résultat (rien n’est ajouté au plan)',
  calibrate: 'Étalonnage : cliquez deux points dont vous connaissez la distance réelle (ex. une cote du plan)',
  pan: 'Glissez pour déplacer la vue • Molette : zoom',
};

/** Légende de l'aide « circulations probables » (rappel : aide à la vérification, non imprimée). */
function CirculationNote({ c }: { c: Circulation }) {
  const m = c.paths.map((p) => p.meters).filter((x): x is number => x != null);
  return (
    <div className="circulation-note" role="status">
      <b>Circulations probables</b> · aide à la vérification, non imprimée
      {!c.exits && <div>Aucune sortie trouvée : marquez une porte « issue de secours » ou posez un pictogramme de sortie.</div>}
      {!!c.exits && !c.closedOutline && <div>Façade non fermée : l’intérieur n’a pas pu être distingué de l’extérieur.</div>}
      {!!c.exits && (
        <>
          <div><span className="sw green" /> chemin le plus court du repère vers la sortie la plus proche{m.length ? ` (≈ ${m.map((x) => x.toFixed(0)).join(', ')} m)` : ''}</div>
          {c.unreachable && <div><span className="sw orange" /> zones sans accès à une sortie ({Math.round(c.unreachableShare * 100)} % de l’intérieur) : porte manquante ou mal posée ?</div>}
          {!!c.stranded.length && <div><span className="sw red" /> repère sans chemin vers une sortie</div>}
        </>
      )}
      <div className="muted">Calcul sur les murs et les portes ; à confirmer par la lecture du plan.</div>
    </div>
  );
}

function CoordReadout({ floor, cursor }: { floor: Floor; cursor: Pt | null }) {
  if (!cursor) return null;
  const u = floor.unitsPerMeter;
  return (
    <div className="coords">
      {u > 0 ? `x ${(cursor[0] / u).toFixed(2)} m · y ${(cursor[1] / u).toFixed(2)} m` : `x ${Math.round(cursor[0])} · y ${Math.round(cursor[1])} u`}
    </div>
  );
}
