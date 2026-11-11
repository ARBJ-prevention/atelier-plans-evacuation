import { produce, type Draft } from 'immer';
import { create } from 'zustand';
import { LAYER_ORDER, makeElement, newProject, uid } from '../model/defaults';
import { clipToBuilding, outlineOf } from '../services/footprint';
import {
  DEFAULT_SYMBOL_WALL_GAP, elementBounds, isVisibleInVariant, rectCenter, rotateElementAround, snapSymbolToWalls, translateElement, unionRects,
} from '../model/geometry';
import type { Building, Element, Floor, Project } from '../model/types';

export type Tool =
  | 'select' | 'pan' | 'wall' | 'room' | 'zone' | 'door' | 'stairs' | 'route'
  | 'text' | 'symbol' | 'calibrate' | 'legend' | 'window' | 'shape';

export interface GridSettings {
  show: boolean; snap: boolean; size: number; style: 'lines' | 'dots'; intensity: number; majorEvery: number;
  symbolSnapEnabled: boolean; symbolWallGap: number;
}

export const MAX_SYMBOL_WALL_GAP = 50;
const DEFAULT_GRID: GridSettings = {
  show: true, snap: true, size: 10, style: 'lines', intensity: 0.75, majorEvery: 5,
  symbolSnapEnabled: true, symbolWallGap: DEFAULT_SYMBOL_WALL_GAP,
};

function normalizeSymbolWallGap(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_SYMBOL_WALL_GAP, Math.round(value)))
    : DEFAULT_SYMBOL_WALL_GAP;
}

/** Préréglages des outils (choisis dans le ruban). */
export interface ToolPresets {
  doorType: 'single' | 'double' | 'sliding' | 'revolving' | 'opening';
  /** Nouvelles portes coupe-feu. */
  doorFire: boolean;
  stairType: 'straight' | 'landing' | 'escalator';
  /** Flèche de montée sur les nouveaux escaliers. */
  stairArrow: boolean;
  /** Séparation centrale sur les nouveaux escaliers. */
  stairSplit: boolean;
  shape: 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'line' | 'arrow' | 'star';
  routeKind: 'principal' | 'secondaire';
  wallThickness: number;
}

const VIEW_KEY = 'evac.view.v2';
function loadViewPrefs(): { grid: GridSettings; guides: boolean; rulers: boolean } {
  const def = { grid: DEFAULT_GRID, guides: true, rulers: true };
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if (!raw) return def;
    const { symbolSnapRange, ...grid } = raw.grid ?? {};
    return {
      ...def, ...raw,
      grid: {
        ...def.grid, ...grid,
        symbolSnapEnabled: (grid.symbolSnapEnabled ?? def.grid.symbolSnapEnabled) && symbolSnapRange !== 0,
        symbolWallGap: normalizeSymbolWallGap(grid.symbolWallGap),
      },
    };
  } catch { return def; }
}
export function saveViewPrefs({ grid, guides, rulers }: { grid: GridSettings; guides: boolean; rulers: boolean }) {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ grid, guides, rulers })); } catch { /* stockage indisponible */ }
}
const prefs = loadViewPrefs();

export interface View { x: number; y: number; zoom: number }

export interface Toast { id: number; msg: string; kind: 'info' | 'success' | 'warning' | 'error' }

const HISTORY_LIMIT = 150;

export interface EditorState {
  project: Project | null;
  filePath: string | null;
  dirty: boolean;
  lastSavedAt: string | null;
  lastAutosaveAt: string | null;
  past: Project[];
  future: Project[];
  buildingId: string;
  floorId: string;
  activeVariant: Record<string, string>;
  selection: string[];
  tool: Tool;
  pendingSymbol: string;
  view: View;
  grid: GridSettings;
  guides: boolean;
  rulers: boolean;
  presets: ToolPresets;
  clipboard: Element[];
  toasts: Toast[];
  fitRequest: number;

  loadProject(p: Project, path: string | null): void;
  closeProject(): void;
  mutate(fn: (d: Draft<Project>) => void, opts?: { history?: boolean; coalesce?: string }): void;
  mutateFloor(fn: (f: Draft<Floor>, p: Draft<Project>) => void, opts?: { history?: boolean; keepValidation?: boolean; coalesce?: string; validationReason?: string }): void;
  beginLive(): void;
  undo(): void;
  redo(): void;
  markSaved(path: string): void;
  markAutosaved(): void;
  setFloor(buildingId: string, floorId: string): void;
  setVariant(variantId: string): void;
  setTool(t: Tool, symbolId?: string): void;
  select(ids: string[], additive?: boolean): void;
  setView(v: Partial<View>): void;
  requestFit(): void;
  setGrid(g: Partial<GridSettings>): void;
  toggleGuides(): void;
  toggleRulers(): void;
  setPreset(p: Partial<ToolPresets>): void;
  toast(msg: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;

  addElements(els: Element[], select?: boolean): void;
  deleteSelection(): void;
  copySelection(): void;
  cutSelection(): void;
  paste(): void;
  duplicateSelection(): void;
  groupSelection(): void;
  ungroupSelection(): void;
  alignSelection(kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hdist' | 'vdist'): void;
  rotateSelection(deg: number): void;
  reorderSelection(where: 'front' | 'back' | 'forward' | 'backward'): void;
  /** Découpe les formes / zones sélectionnées selon l'emprise du bâtiment (intérieur des façades). */
  clipSelectionToBuilding(): void;
  nudgeSelection(dx: number, dy: number): void;
  flipSelection(axis: 'h' | 'v'): void;
  toggleLockSelection(): void;
}

let toastSeq = 1;
let lastCoalesce = { key: '', t: 0 };

export const useStore = create<EditorState>((set, get) => ({
  project: null,
  filePath: null,
  dirty: false,
  lastSavedAt: null,
  lastAutosaveAt: null,
  past: [],
  future: [],
  buildingId: '',
  floorId: '',
  activeVariant: {},
  selection: [],
  tool: 'select',
  pendingSymbol: '',
  view: { x: 0, y: 0, zoom: 1 },
  grid: prefs.grid,
  guides: prefs.guides,
  rulers: prefs.rulers,
  presets: { doorType: 'single', doorFire: false, stairType: 'straight', stairArrow: true, stairSplit: false, shape: 'rect', routeKind: 'principal', wallThickness: 12 },
  clipboard: [],
  toasts: [],
  fitRequest: 0,

  loadProject(p, path) {
    const b = p.buildings[0];
    const f = b?.floors[0];
    set({
      project: p, filePath: path, dirty: false, past: [], future: [], selection: [],
      buildingId: b?.id ?? '', floorId: f?.id ?? '', activeVariant: {},
      lastSavedAt: path ? new Date().toISOString() : null, lastAutosaveAt: null, tool: 'select',
      fitRequest: get().fitRequest + 1,
    });
  },

  closeProject() {
    set({ project: null, filePath: null, dirty: false, past: [], future: [], selection: [] });
  },

  mutate(fn, opts = {}) {
    const { project, past } = get();
    if (!project) return;
    const next = produce(project, (d) => { fn(d); d.updatedAt = new Date().toISOString(); });
    if (next === project) return;
    const now = Date.now();
    let history = opts.history !== false;
    if (history && opts.coalesce) {
      if (lastCoalesce.key === opts.coalesce && now - lastCoalesce.t < 1500) history = false;
      lastCoalesce = { key: opts.coalesce, t: now };
    } else if (history) lastCoalesce = { key: '', t: 0 };
    set({
      project: next,
      dirty: true,
      ...(!history ? {} : { past: [...past, project].slice(-HISTORY_LIMIT), future: [] }),
    });
  },

  mutateFloor(fn, opts = {}) {
    const { floorId } = get();
    let reset = false;
    get().mutate((d) => {
      for (const b of d.buildings) {
        const f = b.floors.find((x) => x.id === floorId);
        if (f) {
          fn(f, d);
          if (!opts.keepValidation && f.titleBlock.status === 'validated') {
            f.titleBlock.status = 'to_validate';
            f.titleBlock.validatedAt = '';
            f.titleBlock.validatedBy = '';
            f.titleBlock.validationReason = opts.validationReason;
            reset = true;
          }
        }
      }
    }, opts);
    if (reset) get().toast(`${opts.validationReason ?? 'Plan modifié après validation'} — statut repassé à « À valider ».`, 'warning');
  },

  /** À appeler au début d'un glisser : enregistre UN état dans l'historique. */
  beginLive() {
    const { project, past } = get();
    if (!project) return;
    set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
    // Validation : toute modification invalide le statut « Validé ».
    const f = currentFloor(get());
    if (f?.titleBlock.status === 'validated') {
      get().mutateFloor(() => {}, { history: false });
    }
  },

  undo() {
    const { past, future, project } = get();
    if (!past.length || !project) return;
    const prev = past[past.length - 1];
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], dirty: true });
    sanitizeSelection();
  },

  redo() {
    const { past, future, project } = get();
    if (!future.length || !project) return;
    const next = future[0];
    set({ project: next, future: future.slice(1), past: [...past, project], dirty: true });
    sanitizeSelection();
  },

  markSaved(path) { set({ filePath: path, dirty: false, lastSavedAt: new Date().toISOString() }); },
  markAutosaved() { set({ lastAutosaveAt: new Date().toISOString() }); },

  setFloor(buildingId, floorId) {
    set({ buildingId, floorId, selection: [], fitRequest: get().fitRequest + 1 });
  },

  setVariant(variantId) {
    set({ activeVariant: { ...get().activeVariant, [get().floorId]: variantId }, selection: [] });
  },

  setTool(t, symbolId) { set({ tool: t, pendingSymbol: symbolId ?? get().pendingSymbol, ...(t !== 'select' ? { selection: [] } : {}) }); },

  select(ids, additive = false) {
    const f = currentFloor(get());
    if (!f) return;
    const variant = currentVariantId(get());
    const expanded = new Set<string>();
    for (const id of ids) {
      const el = f.elements.find((e) => e.id === id);
      if (!el || !isVisibleInVariant(el, variant)) continue;
      if (el.groupId) f.elements.filter((e) => e.groupId === el.groupId && isVisibleInVariant(e, variant)).forEach((e) => expanded.add(e.id));
      else expanded.add(id);
    }
    if (additive) {
      const cur = new Set(get().selection);
      const allIn = [...expanded].every((id) => cur.has(id));
      expanded.forEach((id) => (allIn ? cur.delete(id) : cur.add(id)));
      set({ selection: [...cur] });
    } else set({ selection: [...expanded] });
  },

  setView(v) { set({ view: { ...get().view, ...v } }); },
  requestFit() { set({ fitRequest: get().fitRequest + 1 }); },
  setGrid(g) {
    const grid = { ...get().grid, ...g };
    grid.symbolWallGap = normalizeSymbolWallGap(grid.symbolWallGap);
    set({ grid });
    saveViewPrefs(get());
  },
  toggleGuides() { set({ guides: !get().guides }); saveViewPrefs(get()); },
  toggleRulers() { set({ rulers: !get().rulers }); saveViewPrefs(get()); },
  setPreset(p) { set({ presets: { ...get().presets, ...p } }); },

  toast(msg, kind = 'info') {
    const t = { id: toastSeq++, msg, kind };
    set({ toasts: [...get().toasts, t].slice(-4) });
    setTimeout(() => get().dismissToast(t.id), kind === 'error' ? 8000 : 4000);
  },
  dismissToast(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }); },

  addElements(els, select = true) {
    get().mutateFloor((f) => { f.elements.push(...(els as Draft<Element>[])); });
    if (select) set({ selection: els.map((e) => e.id) });
  },

  deleteSelection() {
    const { selection } = get();
    const f = currentFloor(get());
    if (!f || !selection.length) return;
    const ids = new Set(selection.filter((id) => !f.elements.find((e) => e.id === id)?.locked));
    if (!ids.size) { get().toast('Les éléments verrouillés ne peuvent pas être supprimés.', 'warning'); return; }
    get().mutateFloor((fd) => { fd.elements = fd.elements.filter((e) => !ids.has(e.id)); });
    set({ selection: [] });
  },

  copySelection() {
    const f = currentFloor(get());
    if (!f) return;
    const sel = new Set(get().selection);
    const els = f.elements.filter((e) => sel.has(e.id));
    if (els.length) set({ clipboard: JSON.parse(JSON.stringify(els)) });
  },

  cutSelection() { get().copySelection(); get().deleteSelection(); },

  paste() {
    const state = get();
    const { clipboard } = state;
    if (!clipboard.length) return;
    const variantId = currentVariantId(state);
    const groupMap = new Map<string, string>();
    const offset = 20;
    const els = clipboard.map((e) => {
      const n = translateElement({ ...e, id: uid('el'), locked: false }, offset, offset) as Element;
      if (n.groupId) { if (!groupMap.has(n.groupId)) groupMap.set(n.groupId, uid('grp')); n.groupId = groupMap.get(n.groupId); }
      if (n.variantId) n.variantId = variantId;
      delete n.excludedVariantIds;
      return n;
    });
    set({ clipboard: els.map((e) => ({ ...e })) }); // collages successifs décalés
    const floor = currentFloor(state);
    const [first] = els;
    const placed = state.grid.symbolSnapEnabled && floor && els.length === 1 && first.type === 'symbol'
      ? [snapSymbolToWalls(floor, variantId, first, { gap: state.grid.symbolWallGap })]
      : els;
    state.addElements(placed);
  },

  duplicateSelection() { get().copySelection(); get().paste(); },

  groupSelection() {
    const { selection } = get();
    if (selection.length < 2) return;
    const gid = uid('grp');
    const ids = new Set(selection);
    get().mutateFloor((f) => { f.elements.forEach((e) => { if (ids.has(e.id)) e.groupId = gid; }); });
    get().toast(`${selection.length} éléments groupés.`, 'success');
  },

  ungroupSelection() {
    const ids = new Set(get().selection);
    get().mutateFloor((f) => { f.elements.forEach((e) => { if (ids.has(e.id)) delete e.groupId; }); });
  },

  alignSelection(kind) {
    const f = currentFloor(get());
    if (!f) return;
    const sel = f.elements.filter((e) => get().selection.includes(e.id) && !e.locked);
    if (sel.length < 2) { get().toast('Sélectionnez au moins deux éléments à aligner.', 'info'); return; }
    // Unités d'alignement : groupes ou éléments isolés
    const units = new Map<string, Element[]>();
    sel.forEach((e) => { const k = e.groupId ?? e.id; units.set(k, [...(units.get(k) ?? []), e]); });
    const ub = [...units.entries()].map(([k, els]) => ({ k, els, r: unionRects(els.map((e) => elementBounds(e)))! }));
    const all = unionRects(ub.map((u) => u.r))!;
    const moves = new Map<string, [number, number]>();
    if (kind === 'hdist' || kind === 'vdist') {
      if (ub.length < 3) { get().toast('La répartition nécessite au moins trois éléments.', 'info'); return; }
      const horiz = kind === 'hdist';
      ub.sort((a, b) => (horiz ? a.r.x - b.r.x : a.r.y - b.r.y));
      const total = ub.reduce((s, u) => s + (horiz ? u.r.w : u.r.h), 0);
      const gap = ((horiz ? all.w : all.h) - total) / (ub.length - 1);
      let pos = horiz ? all.x : all.y;
      for (const u of ub) {
        moves.set(u.k, horiz ? [pos - u.r.x, 0] : [0, pos - u.r.y]);
        pos += (horiz ? u.r.w : u.r.h) + gap;
      }
    } else {
      for (const u of ub) {
        const r = u.r;
        const d: [number, number] =
          kind === 'left' ? [all.x - r.x, 0]
          : kind === 'right' ? [all.x + all.w - (r.x + r.w), 0]
          : kind === 'hcenter' ? [all.x + all.w / 2 - (r.x + r.w / 2), 0]
          : kind === 'top' ? [0, all.y - r.y]
          : kind === 'bottom' ? [0, all.y + all.h - (r.y + r.h)]
          : [0, all.y + all.h / 2 - (r.y + r.h / 2)];
        moves.set(u.k, d);
      }
    }
    get().mutateFloor((fd) => {
      fd.elements = fd.elements.map((e) => {
        const m = moves.get(e.groupId ?? e.id);
        return m && get().selection.includes(e.id) ? (translateElement(e as Element, m[0], m[1]) as any) : e;
      });
    });
  },

  rotateSelection(deg) {
    const f = currentFloor(get());
    if (!f) return;
    const ids = new Set(get().selection);
    const sel = f.elements.filter((e) => ids.has(e.id) && !e.locked);
    if (!sel.length) return;
    const pivot = rectCenter(unionRects(sel.map((e) => elementBounds(e)))!);
    get().mutateFloor((fd) => {
      fd.elements = fd.elements.map((e) => (ids.has(e.id) && !e.locked ? (rotateElementAround(e as Element, pivot, deg) as any) : e));
    });
  },

  reorderSelection(where) {
    const ids = new Set(get().selection);
    if (!ids.size) return;
    if (where === 'front' || where === 'back') {
      get().mutateFloor((fd) => {
        const sel = fd.elements.filter((e) => ids.has(e.id));
        const rest = fd.elements.filter((e) => !ids.has(e.id));
        fd.elements = where === 'front' ? [...rest, ...sel] : [...sel, ...rest];
      });
      return;
    }
    // Avancer / Reculer d'un cran : l'ordre d'affichage réel est « calque puis
    // position dans le tableau ». On fait passer la sélection juste derrière
    // (ou devant) le prochain élément visible qui la chevauche, quitte à changer
    // de calque (ex. une annotation qui passe sous les murs du Bâtiment).
    const f = currentFloor(get());
    if (!f) return;
    const variant = currentVariantId(get());
    const lockedLayers = new Set(f.layers.filter((l) => l.locked || !l.visible).map((l) => l.id));
    const rank = (l: string) => { const i = LAYER_ORDER.indexOf(l as any); return i < 0 ? LAYER_ORDER.length : i; };
    const order = f.elements.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e.layer) - rank(b.e.layer) || a.i - b.i).map((x) => x.e);
    const sel = order.filter((e) => ids.has(e.id));
    if (!sel.length) return;
    const box = unionRects(sel.map((e) => elementBounds(e)))!;
    const overlaps = (e: Element) => {
      const r = elementBounds(e);
      return r.x <= box.x + box.w && box.x <= r.x + r.w && r.y <= box.y + box.h && box.y <= r.y + r.h;
    };
    const candidate = (e: Element) => !ids.has(e.id) && isVisibleInVariant(e, variant) && !lockedLayers.has(e.layer);
    const back = where === 'backward';
    const positions = sel.map((e) => order.indexOf(e));
    const start = back ? Math.min(...positions) : Math.max(...positions);
    let target: Element | undefined;
    let fallback: Element | undefined;
    for (let k = start + (back ? -1 : 1); k >= 0 && k < order.length; k += back ? -1 : 1) {
      const e = order[k];
      if (!candidate(e)) continue;
      fallback ??= e;
      if (overlaps(e)) { target = e; break; }
    }
    target ??= fallback;
    if (!target) return;
    const tid = target.id;
    const tLayer = target.layer;
    get().mutateFloor((fd) => {
      const moved = fd.elements.filter((e) => ids.has(e.id)).map((e) => (e.layer === tLayer ? e : { ...e, layer: tLayer }));
      const rest = fd.elements.filter((e) => !ids.has(e.id));
      const ti = rest.findIndex((e) => e.id === tid);
      if (ti < 0) return;
      rest.splice(back ? ti : ti + 1, 0, ...(moved as any));
      fd.elements = rest;
    });
  },

  clipSelectionToBuilding() {
    const f = currentFloor(get());
    if (!f) return;
    const variant = currentVariantId(get());
    const ids = new Set(get().selection);
    const results = new Map<string, Element>();
    for (const e of f.elements) {
      if (!ids.has(e.id) || e.locked) continue;
      const outline = outlineOf(e);
      if (!outline) continue;
      const pts = clipToBuilding(f, variant, outline, e.id);
      if (!pts) continue;
      const src = e as any;
      const base = {
        kind: 'zone' as const, points: pts, layer: 'building' as const,
        fill: src.fill, fillOpacity: src.fillOpacity, pattern: src.pattern, patternColor: src.patternColor,
        stroke: src.stroke, strokeWidth: src.strokeWidth, dash: src.dash,
        opacity: src.opacity, shadow: src.shadow, variantId: src.variantId, excludedVariantIds: src.excludedVariantIds, groupId: src.groupId,
      };
      const next = e.type === 'area'
        ? { ...e, ...base, kind: (e as any).kind, id: e.id }
        : { ...makeElement('area', { ...base, label: src.text ?? '', labelSize: src.textSize ?? 16, labelColor: src.textColor ?? '#3b4754' }), id: e.id };
      results.set(e.id, next as Element);
    }
    if (!results.size) {
      get().toast('Aucune forme à découper : sélectionnez un rectangle, une ellipse ou une zone qui chevauche des murs.', 'info');
      return;
    }
    get().mutateFloor((fd) => {
      const moved = fd.elements.filter((e) => results.has(e.id)).map((e) => results.get(e.id)! as any);
      const rest = fd.elements.filter((e) => !results.has(e.id));
      // fond du bâtiment : derrière les murs et les pièces
      fd.elements = [...moved, ...rest];
    });
    get().toast(results.size > 1 ? `${results.size} formes limitées au bâtiment.` : 'Forme limitée à l’intérieur du bâtiment.', 'success');
  },

  flipSelection(axis) {
    const f = currentFloor(get());
    if (!f) return;
    const ids = new Set(get().selection);
    const sel = f.elements.filter((e) => ids.has(e.id) && !e.locked);
    if (!sel.length) return;
    const [cx, cy] = rectCenter(unionRects(sel.map((e) => elementBounds(e)))!);
    get().mutateFloor((fd) => {
      fd.elements = fd.elements.map((e: any) => {
        if (!ids.has(e.id) || e.locked) return e;
        if ('points' in e) return { ...e, points: e.points.map(([x, y]: [number, number]) => (axis === 'h' ? [2 * cx - x, y] : [x, 2 * cy - y])) };
        const n = { ...e, x: axis === 'h' ? 2 * cx - e.x : e.x, y: axis === 'v' ? 2 * cy - e.y : e.y };
        if (axis === 'h') n.flipX = !e.flipX; else n.flipY = !e.flipY;
        if (e.type === 'door' && axis === 'h') n.swing = e.swing === 'left' ? 'right' : 'left';
        if (e.rotation) n.rotation = (360 - e.rotation) % 360;
        return n;
      });
    });
  },

  toggleLockSelection() {
    const f = currentFloor(get());
    if (!f) return;
    const ids = new Set(get().selection);
    const anyUnlocked = f.elements.some((e) => ids.has(e.id) && !e.locked);
    get().mutateFloor((fd) => { fd.elements.forEach((e) => { if (ids.has(e.id)) e.locked = anyUnlocked; }); });
  },

  nudgeSelection(dx, dy) {
    const ids = new Set(get().selection);
    if (!ids.size) return;
    get().mutateFloor((fd) => {
      fd.elements = fd.elements.map((e) => (ids.has(e.id) && !e.locked ? (translateElement(e as Element, dx, dy) as any) : e));
    });
  },
}));

function sanitizeSelection() {
  const s = useStore.getState();
  const f = currentFloor(s);
  if (!f) {
    // l'étage courant n'existe plus (annulation d'un ajout d'étage)
    const b = s.project?.buildings[0];
    if (b?.floors[0]) useStore.setState({ buildingId: b.id, floorId: b.floors[0].id, selection: [] });
    return;
  }
  const ids = new Set(f.elements.map((e) => e.id));
  useStore.setState({ selection: s.selection.filter((id) => ids.has(id)) });
}

// ——— Sélecteurs ———
export function currentBuilding(s: Pick<EditorState, 'project' | 'buildingId' | 'floorId'>): Building | null {
  if (!s.project) return null;
  return s.project.buildings.find((b) => b.floors.some((f) => f.id === s.floorId))
    ?? s.project.buildings.find((b) => b.id === s.buildingId) ?? null;
}

export function currentFloor(s: Pick<EditorState, 'project' | 'buildingId' | 'floorId'>): Floor | null {
  if (!s.project) return null;
  for (const b of s.project.buildings) {
    const f = b.floors.find((x) => x.id === s.floorId);
    if (f) return f;
  }
  return null;
}

export function currentVariantId(s: Pick<EditorState, 'project' | 'buildingId' | 'floorId' | 'activeVariant'>): string {
  const f = currentFloor(s);
  if (!f) return '';
  const v = s.activeVariant[f.id];
  return f.variants.some((x) => x.id === v) ? v : f.variants[0].id;
}

export function createEmptyProject(country = 'BE'): Project {
  return newProject('Nouveau projet', country);
}
