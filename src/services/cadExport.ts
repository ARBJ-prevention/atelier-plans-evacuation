/**
 * Export du plan au format DXF (AutoCAD R2000, texte).
 *
 * Le DXF est le format d'échange universel des logiciels de dessin : AutoCAD, BricsCAD,
 * DraftSight, LibreCAD, QCAD, EdrawMax, Visio, SketchUp, Revit, ArchiCAD… savent l'ouvrir.
 * Chaque famille d'objets va sur son propre calque (MURS, PORTES, FENETRES, PIECES…) ;
 * les coordonnées sont en millimètres réels quand l'étage est étalonné ($INSUNITS = 4).
 */
import type { Element, Floor, Pt } from '../model/types';
import { isVisibleInVariant } from '../model/geometry';

type V = [number, number];

/** Calques exportés : nom, couleur AutoCAD (ACI). */
const LAYERS: [string, number][] = [
  ['MURS', 7], ['PORTES', 3], ['PORTES_SECOURS', 3], ['FENETRES', 4], ['ESCALIERS', 6],
  ['PIECES', 8], ['TEXTES_PIECES', 7], ['EVACUATION', 3], ['PICTOGRAMMES', 1], ['TEXTES', 7], ['FORMES', 5],
];

class DxfWriter {
  private out: string[] = [];
  private handle = 0x100;
  constructor(private k: number) {}
  pair(code: number, value: string | number) { this.out.push(String(code), typeof value === 'number' ? fmt(value) : value); }
  private h() { return (this.handle++).toString(16).toUpperCase(); }
  /** Point plan (Y vers le bas) → point DXF (Y vers le haut, unités de sortie). */
  p([x, y]: V): V { return [x * this.k, -y * this.k]; }
  private start(type: string, layer: string) { this.pair(0, type); this.pair(5, this.h()); this.pair(100, 'AcDbEntity'); this.pair(8, layer); }
  poly(pts: V[], closed: boolean, layer: string) {
    if (pts.length < 2) return;
    this.start('LWPOLYLINE', layer);
    this.pair(100, 'AcDbPolyline'); this.pair(90, pts.length); this.pair(70, closed ? 1 : 0);
    for (const q of pts) { const [x, y] = this.p(q); this.pair(10, x); this.pair(20, y); }
  }
  line(a: V, b: V, layer: string) {
    const [x1, y1] = this.p(a), [x2, y2] = this.p(b);
    this.start('LINE', layer); this.pair(100, 'AcDbLine');
    this.pair(10, x1); this.pair(20, y1); this.pair(30, 0); this.pair(11, x2); this.pair(21, y2); this.pair(31, 0);
  }
  /** Arc : centre, rayon (unités plan), angles en degrés dans le repère plan (sens horaire). */
  arc(c: V, r: number, a0: number, a1: number, layer: string) {
    const [x, y] = this.p(c);
    // Repère plan Y-bas → repère DXF Y-haut : les angles changent de signe et le sens s'inverse.
    this.start('ARC', layer); this.pair(100, 'AcDbCircle');
    this.pair(10, x); this.pair(20, y); this.pair(30, 0); this.pair(40, r * this.k);
    this.pair(100, 'AcDbArc'); this.pair(50, norm(-a1)); this.pair(51, norm(-a0));
  }
  circle(c: V, r: number, layer: string) {
    const [x, y] = this.p(c);
    this.start('CIRCLE', layer); this.pair(100, 'AcDbCircle');
    this.pair(10, x); this.pair(20, y); this.pair(30, 0); this.pair(40, r * this.k);
  }
  text(at: V, height: number, rotation: number, text: string, layer: string, center = false) {
    const clean = text.replace(/\r?\n/g, ' ').trim();
    if (!clean) return;
    const [x, y] = this.p(at);
    this.start('TEXT', layer); this.pair(100, 'AcDbText');
    this.pair(10, x); this.pair(20, y); this.pair(30, 0); this.pair(40, Math.max(height * this.k, 1e-3));
    this.pair(1, clean); this.pair(50, norm(-rotation));
    if (center) { this.pair(72, 1); this.pair(11, x); this.pair(21, y); this.pair(31, 0); }
    this.pair(100, 'AcDbText');
    if (center) this.pair(73, 2);
  }

  document(insUnits: number): string {
    const body = this.out;
    this.out = [];
    // En-tête
    this.pair(0, 'SECTION'); this.pair(2, 'HEADER');
    this.pair(9, '$ACADVER'); this.pair(1, 'AC1015');
    this.pair(9, '$HANDSEED'); this.pair(5, 'FFFFF');
    this.pair(9, '$INSUNITS'); this.pair(70, insUnits);
    this.pair(9, '$MEASUREMENT'); this.pair(70, 1);
    this.pair(9, '$DWGCODEPAGE'); this.pair(3, 'ANSI_1252');
    this.pair(0, 'ENDSEC');
    // Tables (types de ligne, calques, styles de texte, enregistrements de blocs)
    this.pair(0, 'SECTION'); this.pair(2, 'TABLES');
    this.table('LTYPE', 1, () => {
      this.pair(0, 'LTYPE'); this.pair(5, this.h()); this.pair(100, 'AcDbSymbolTableRecord'); this.pair(100, 'AcDbLinetypeTableRecord');
      this.pair(2, 'CONTINUOUS'); this.pair(70, 0); this.pair(3, 'Solid line'); this.pair(72, 65); this.pair(73, 0); this.pair(40, 0);
    });
    this.table('LAYER', LAYERS.length + 1, () => {
      for (const [name, color] of [['0', 7] as [string, number], ...LAYERS]) {
        this.pair(0, 'LAYER'); this.pair(5, this.h()); this.pair(100, 'AcDbSymbolTableRecord'); this.pair(100, 'AcDbLayerTableRecord');
        this.pair(2, name); this.pair(70, 0); this.pair(62, color); this.pair(6, 'CONTINUOUS');
      }
    });
    this.table('STYLE', 1, () => {
      this.pair(0, 'STYLE'); this.pair(5, this.h()); this.pair(100, 'AcDbSymbolTableRecord'); this.pair(100, 'AcDbTextStyleTableRecord');
      this.pair(2, 'STANDARD'); this.pair(70, 0); this.pair(40, 0); this.pair(41, 1); this.pair(50, 0); this.pair(71, 0); this.pair(42, 2.5); this.pair(3, 'arial.ttf'); this.pair(4, '');
    });
    this.table('BLOCK_RECORD', 2, () => {
      for (const name of ['*Model_Space', '*Paper_Space']) {
        this.pair(0, 'BLOCK_RECORD'); this.pair(5, this.h()); this.pair(100, 'AcDbSymbolTableRecord'); this.pair(100, 'AcDbBlockTableRecord'); this.pair(2, name);
      }
    });
    this.pair(0, 'ENDSEC');
    // Blocs obligatoires (espace objet / espace papier)
    this.pair(0, 'SECTION'); this.pair(2, 'BLOCKS');
    for (const name of ['*Model_Space', '*Paper_Space']) {
      this.pair(0, 'BLOCK'); this.pair(5, this.h()); this.pair(100, 'AcDbEntity'); this.pair(8, '0'); this.pair(100, 'AcDbBlockBegin');
      this.pair(2, name); this.pair(70, 0); this.pair(10, 0); this.pair(20, 0); this.pair(30, 0); this.pair(3, name); this.pair(1, '');
      this.pair(0, 'ENDBLK'); this.pair(5, this.h()); this.pair(100, 'AcDbEntity'); this.pair(8, '0'); this.pair(100, 'AcDbBlockEnd');
    }
    this.pair(0, 'ENDSEC');
    const head = this.out;
    this.out = [];
    this.pair(0, 'SECTION'); this.pair(2, 'ENTITIES');
    const open = this.out;
    this.out = [];
    this.pair(0, 'ENDSEC');
    this.pair(0, 'SECTION'); this.pair(2, 'OBJECTS');
    this.pair(0, 'DICTIONARY'); this.pair(5, this.h()); this.pair(100, 'AcDbDictionary');
    this.pair(0, 'ENDSEC'); this.pair(0, 'EOF');
    return [...head, ...open, ...body, ...this.out].join('\r\n') + '\r\n';
  }
  private table(name: string, count: number, rows: () => void) {
    this.pair(0, 'TABLE'); this.pair(2, name); this.pair(5, this.h()); this.pair(100, 'AcDbSymbolTable'); this.pair(70, count);
    rows();
    this.pair(0, 'ENDTAB');
  }
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}
function norm(a: number): number { return ((a % 360) + 360) % 360; }

/** Transforme un point local (repère de l'élément) en point plan : miroirs, rotation, translation. */
function place(el: { x: number; y: number; rotation: number; flipX?: boolean; flipY?: boolean }) {
  const r = (el.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return ([u, v]: V): V => {
    const a = el.flipX ? -u : u, b = el.flipY ? -v : v;
    return [el.x + a * c - b * s, el.y + a * s + b * c];
  };
}

/** Contour d'un tronçon de mur (rectangle de l'épaisseur du mur). */
function wallSegment(a: Pt, b: Pt, t: number): V[] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if (L < 1e-9) return null;
  const nx = (-dy / L) * t / 2, ny = (dx / L) * t / 2;
  return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
}

function writeElement(w: DxfWriter, el: Element) {
  switch (el.type) {
    case 'wall': {
      const pts = el.points;
      const n = el.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const seg = wallSegment(pts[i], pts[(i + 1) % pts.length], Math.max(el.thickness, 0.01));
        if (seg) w.poly(seg, true, 'MURS');
      }
      break;
    }
    case 'area': {
      w.poly(el.points, true, 'PIECES');
      if (el.label && el.points.length) {
        const cx = el.points.reduce((s, p) => s + p[0], 0) / el.points.length + (el.labelDx || 0);
        const cy = el.points.reduce((s, p) => s + p[1], 0) / el.points.length + (el.labelDy || 0);
        w.text([cx, cy], el.labelSize || 12, 0, el.label, 'TEXTES_PIECES', true);
      }
      break;
    }
    case 'door': {
      const P = place(el), hw = el.width / 2, layer = el.emergency ? 'PORTES_SECOURS' : 'PORTES';
      // Ouverture dans le mur
      w.line(P([-hw, 0]), P([hw, 0]), layer);
      const leaf = (hinge: number, len: number, dir: 1 | -1) => {
        const h = P([hinge, 0]), tip = P([hinge, -len]);
        w.line(h, tip, layer);
        // Arc de débattement de la pointe du vantail jusqu'au bout de l'ouverture
        const a0 = Math.atan2(tip[1] - h[1], tip[0] - h[0]) * 180 / Math.PI;
        const end = P([hinge + dir * len, 0]);
        const a1 = Math.atan2(end[1] - h[1], end[0] - h[0]) * 180 / Math.PI;
        let sweep = a1 - a0; while (sweep <= -180) sweep += 360; while (sweep > 180) sweep -= 360;
        if (sweep >= 0) w.arc(h, len, a0, a0 + sweep, layer); else w.arc(h, len, a0 + sweep, a0, layer);
      };
      if (el.doorType === 'single') {
        if (el.swing === 'left') leaf(-hw, el.width, 1); else leaf(hw, el.width, -1);
      } else if (el.doorType === 'double') {
        leaf(-hw, hw, 1); leaf(hw, hw, -1);
      } else if (el.doorType === 'revolving') {
        w.circle([el.x, el.y], hw, layer);
        w.line(P([-hw, 0]), P([hw, 0]), layer); w.line(P([0, -hw]), P([0, hw]), layer);
      } else if (el.doorType === 'sliding' || el.doorType === 'slidingDouble') {
        const s = Math.max(2, el.width * 0.035) * 2;
        w.poly([P([-hw, -s]), P([el.doorType === 'sliding' ? hw : 0, -s])], false, layer);
        if (el.doorType === 'slidingDouble') w.poly([P([0, s]), P([hw, s])], false, layer);
      }
      if (el.fireRated && el.fireRating) w.text(P([0, el.width * 0.25]), el.width * 0.18, el.rotation, el.fireRating, layer, true);
      break;
    }
    case 'window': {
      const P = place(el), hw = el.width / 2, hd = Math.max(el.depth, 1) / 2;
      w.poly([P([-hw, -hd]), P([hw, -hd]), P([hw, hd]), P([-hw, hd])], true, 'FENETRES');
      w.line(P([-hw, 0]), P([hw, 0]), 'FENETRES');
      for (let i = 1; i < Math.max(1, el.panes); i++) { const x = -hw + (el.width * i) / el.panes; w.line(P([x, -hd]), P([x, hd]), 'FENETRES'); }
      break;
    }
    case 'stairs': {
      const P = place(el), hw = el.w / 2, hh = el.h / 2;
      w.poly([P([-hw, -hh]), P([hw, -hh]), P([hw, hh]), P([-hw, hh])], true, 'ESCALIERS');
      const n = Math.max(1, el.steps);
      for (let i = 1; i < n; i++) { const x = -hw + (el.w * i) / n; w.line(P([x, -hh]), P([x, hh]), 'ESCALIERS'); }
      if (el.label) w.text([el.x, el.y], Math.min(el.w, el.h) * 0.2, 0, el.label, 'ESCALIERS', true);
      break;
    }
    case 'route':
      w.poly(el.points, false, 'EVACUATION');
      break;
    case 'symbol': {
      const r = el.size / 2;
      w.circle([el.x, el.y], r, 'PICTOGRAMMES');
      const label = (el as any).label || el.symbolId.replace(/^iso-/, '');
      w.text([el.x, el.y], r * 0.5, 0, String(label), 'PICTOGRAMMES', true);
      break;
    }
    case 'text':
      w.text([el.x, el.y], el.fontSize || 12, el.rotation, el.text, 'TEXTES', el.align === 'middle');
      break;
    case 'shape': {
      const P = place(el), hw = el.w / 2, hh = el.h / 2;
      if (el.shape === 'line' || el.shape === 'arrow') w.line(P([-hw, 0]), P([hw, 0]), 'FORMES');
      else if (el.shape === 'ellipse' && Math.abs(el.w - el.h) < 1e-6) w.circle([el.x, el.y], hw, 'FORMES');
      else w.poly([P([-hw, -hh]), P([hw, -hh]), P([hw, hh]), P([-hw, hh])], true, 'FORMES');
      if (el.text) w.text([el.x, el.y], Math.min(el.h * 0.3, 14), el.rotation, el.text, 'FORMES', true);
      break;
    }
    default:
      break;
  }
}

/**
 * Produit le DXF d'un étage. Étage étalonné : millimètres réels ; sinon unités du plan (sans unité).
 */
export function floorToDxf(floor: Floor, variantId: string): string {
  const upm = floor.unitsPerMeter > 0 ? floor.unitsPerMeter : 0;
  const w = new DxfWriter(upm ? 1000 / upm : 1);
  const order: Element['type'][] = ['area', 'wall', 'window', 'door', 'stairs', 'route', 'shape', 'symbol', 'text'];
  const els = floor.elements.filter((e) => isVisibleInVariant(e, variantId));
  for (const t of order) for (const el of els) if (el.type === t) writeElement(w, el);
  return w.document(upm ? 4 : 0);
}
