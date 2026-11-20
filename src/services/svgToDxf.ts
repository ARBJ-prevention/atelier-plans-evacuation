/**
 * Plans vectoriels SVG (Inkscape, Illustrator, EdrawMax, Visio, navigateurs…) → DXF texte.
 *
 * Le SVG est converti en DXF pour suivre exactement le même chemin qu'un plan AutoCAD :
 * choix des calques, unités, puis reconnaissance des murs, portes et fenêtres.
 * Lecteur autonome (sans navigateur) : lignes, polylignes, polygones, rectangles, cercles,
 * ellipses, chemins (toutes commandes, courbes et arcs échantillonnés), textes, groupes et
 * transformations. Les calques Inkscape / Illustrator (groupes nommés) deviennent des calques DXF.
 */

type V = [number, number];
type M = [number, number, number, number, number, number]; // a b c d e f

const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, [x, y]: V): V => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function parseTransform(s: string | undefined): M {
  let m: M = ID;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(s))) {
    const a = nums(r[2]);
    let t: M = ID;
    switch (r[1]) {
      case 'matrix': if (a.length >= 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]]; break;
      case 'translate': t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case 'scale': t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const k = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(k), sn = Math.sin(k);
        const cx = a[1] ?? 0, cy = a[2] ?? 0;
        t = mul(mul([1, 0, 0, 1, cx, cy], [c, sn, -sn, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX': t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, t);
  }
  return m;
}

function nums(s: string | undefined): number[] {
  if (!s) return [];
  return (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}
function len(s: string | undefined, def = 0): number {
  const n = parseFloat(s ?? '');
  return Number.isFinite(n) ? n : def;
}

function attrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(src))) out[r[1]] = decodeEntities(r[3] ?? r[4] ?? '');
  // Propriétés de présentation dans style="…"
  if (out.style) for (const decl of out.style.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) { const k = decl.slice(0, i).trim(); if (!(k in out)) out[k] = decl.slice(i + 1).trim(); }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
}

/** Échantillonne un arc elliptique SVG (paramétrisation par les extrémités, annexe F.6 de la norme). */
function arcPts(p0: V, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, p1: V): V[] {
  if (rx === 0 || ry === 0) return [p1];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, c = Math.cos(phi), s = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = c * dx + s * dy, y1 = -s * dx + c * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = c * cx1 - s * cy1 + (p0[0] + p1[0]) / 2, cy = s * cx1 + c * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t0 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil((Math.abs(dt) / (Math.PI / 2)) * 8));
  const out: V[] = [];
  for (let i = 1; i <= n; i++) {
    const t = t0 + (dt * i) / n;
    out.push([cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c]);
  }
  out[out.length - 1] = p1;
  return out;
}

/** Chemin SVG → sous-chemins (listes de points) avec drapeau « fermé ». */
export function pathToPolylines(d: string): { pts: V[]; closed: boolean }[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: { pts: V[]; closed: boolean }[] = [];
  let cur: V[] = [], p: V = [0, 0], start: V = [0, 0], ctrl: V | null = null, cmd = '', prev = '';
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const flush = (closed: boolean) => { if (cur.length >= 2) out.push({ pts: cur, closed }); cur = []; };
  const bez = (pts: V[]) => {
    const n = 12;
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      if (pts.length === 3) cur.push([u * u * pts[0][0] + 2 * u * t * pts[1][0] + t * t * pts[2][0], u * u * pts[0][1] + 2 * u * t * pts[1][1] + t * t * pts[2][1]]);
      else cur.push([
        u * u * u * pts[0][0] + 3 * u * u * t * pts[1][0] + 3 * u * t * t * pts[2][0] + t * t * t * pts[3][0],
        u * u * u * pts[0][1] + 3 * u * u * t * pts[1][1] + 3 * u * t * t * pts[2][1] + t * t * t * pts[3][1],
      ]);
    }
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const at = (x: number, y: number): V => (rel ? [p[0] + x, p[1] + y] : [x, y]);
    const before = i;
    if (C !== 'M' && C !== 'Z' && cur.length === 0) cur = [p];
    try {
      switch (C) {
        case 'M': { flush(false); p = at(num(), num()); start = p; cur = [p]; cmd = rel ? 'l' : 'L'; ctrl = null; break; }
        case 'L': p = at(num(), num()); cur.push(p); ctrl = null; break;
        case 'H': { const x = num(); p = [rel ? p[0] + x : x, p[1]]; cur.push(p); ctrl = null; break; }
        case 'V': { const y = num(); p = [p[0], rel ? p[1] + y : y]; cur.push(p); ctrl = null; break; }
        case 'C': { const c1 = at(num(), num()), c2 = at(num(), num()), e = at(num(), num()); bez([p, c1, c2, e]); ctrl = c2; p = e; break; }
        case 'S': {
          const c1: V = ctrl && /[CS]/i.test(prev) ? [2 * p[0] - ctrl[0], 2 * p[1] - ctrl[1]] : p;
          const c2 = at(num(), num()), e = at(num(), num()); bez([p, c1, c2, e]); ctrl = c2; p = e; break;
        }
        case 'Q': { const c1 = at(num(), num()), e = at(num(), num()); bez([p, c1, e]); ctrl = c1; p = e; break; }
        case 'T': {
          const c1: V = ctrl && /[QT]/i.test(prev) ? [2 * p[0] - ctrl[0], 2 * p[1] - ctrl[1]] : p;
          const e = at(num(), num()); bez([p, c1, e]); ctrl = c1; p = e; break;
        }
        case 'A': {
          const rx = num(), ry = num(), rot = num(), la = num(), sw = num(); const e = at(num(), num());
          cur.push(...arcPts(p, rx, ry, rot, !!la, !!sw, e)); p = e; ctrl = null; break;
        }
        case 'Z': flush(true); p = start; cur = []; ctrl = null; cmd = ''; break;
        default: i++;
      }
    } catch { break; }
    prev = C;
    if (i === before && C !== 'Z') i++;
    if (tokens.length && Number.isNaN(p[0])) break;
  }
  flush(false);
  return out.filter((s) => s.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
}

const SKIP = new Set(['defs', 'clipPath', 'mask', 'pattern', 'symbol', 'style', 'script', 'metadata', 'title', 'desc', 'marker', 'linearGradient', 'radialGradient', 'filter', 'sodipodi:namedview', 'foreignObject']);

interface Ent { layer: string; pts?: V[]; closed?: boolean; text?: string; at?: V; h?: number; rot?: number }

/** Lit un SVG et renvoie le DXF texte équivalent (Y inversé, unités = unités utilisateur du SVG). */
export function svgToDxf(svg: string): { dxf: string; count: number } {
  const ents: Ent[] = [];
  const stack: { m: M; layer: string; skip: boolean; tag: string }[] = [{ m: ID, layer: 'SVG', skip: false, tag: '' }];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let r: RegExpExecArray | null;
  let textOpen: { a: Record<string, string>; m: M; layer: string; buf: string } | null = null;
  let last = 0;
  let rootMatrix: M | null = null;
  while ((r = re.exec(svg))) {
    if (textOpen) textOpen.buf += svg.slice(last, r.index);
    last = re.lastIndex;
    if (!r[2]) continue;
    const closing = r[1] === '/', tag = r[2], selfClose = r[4] === '/';
    const top = stack[stack.length - 1];
    if (closing) {
      if (tag === 'text' && textOpen) {
        const t = textOpen.buf.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        if (t) {
          const size = len(textOpen.a['font-size'], 12);
          const at = apply(textOpen.m, [len(textOpen.a.x?.split(/[\s,]+/)[0]), len(textOpen.a.y?.split(/[\s,]+/)[0])]);
          const sc = Math.sqrt(Math.abs(textOpen.m[0] * textOpen.m[3] - textOpen.m[1] * textOpen.m[2])) || 1;
          ents.push({ layer: textOpen.layer, text: decodeEntities(t), at, h: size * sc, rot: (Math.atan2(textOpen.m[1], textOpen.m[0]) * 180) / Math.PI });
        }
        textOpen = null;
      }
      if (stack.length > 1 && top.tag === tag) stack.pop();
      continue;
    }
    const a = attrs(r[3]);
    let m = mul(top.m, parseTransform(a.transform));
    if (tag === 'svg' && !rootMatrix) {
      // viewBox : on garde les unités utilisateur (le choix de l'unité se fait dans la fenêtre d'import)
      const vb = nums(a.viewBox);
      if (vb.length === 4) m = mul(m, [1, 0, 0, 1, -vb[0], -vb[1]]);
      rootMatrix = m;
    }
    const hidden = a.display === 'none' || a.visibility === 'hidden';
    const label = a['inkscape:label'] || (tag === 'g' && a.id && !/^(g|group|layer)?[-_]?\d+$/i.test(a.id) ? a.id : '');
    const layer = (label || top.layer).replace(/[<>/\\":;?*|=,]/g, '_').slice(0, 60) || 'SVG';
    const skip = top.skip || hidden || SKIP.has(tag);
    if (!selfClose) stack.push({ m, layer, skip, tag });
    if (skip) continue;
    const add = (pts: V[], closed: boolean) => { if (pts.length >= 2) ents.push({ layer, pts: pts.map((q) => apply(m, q)), closed }); };
    switch (tag) {
      case 'line': add([[len(a.x1), len(a.y1)], [len(a.x2), len(a.y2)]], false); break;
      case 'polyline': case 'polygon': {
        const n = nums(a.points), pts: V[] = [];
        for (let k = 0; k + 1 < n.length; k += 2) pts.push([n[k], n[k + 1]]);
        add(pts, tag === 'polygon');
        break;
      }
      case 'rect': {
        const x = len(a.x), y = len(a.y), w = len(a.width), h = len(a.height);
        if (w > 0 && h > 0) add([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
        break;
      }
      case 'circle': case 'ellipse': {
        const cx = len(a.cx), cy = len(a.cy), rx = tag === 'circle' ? len(a.r) : len(a.rx), ry = tag === 'circle' ? len(a.r) : len(a.ry, rx);
        if (rx > 0 && ry > 0) {
          const pts: V[] = [];
          for (let k = 0; k < 48; k++) { const t = (k / 48) * 2 * Math.PI; pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
          add(pts, true);
        }
        break;
      }
      case 'path':
        for (const sp of pathToPolylines(a.d ?? '')) add(sp.pts, sp.closed);
        break;
      case 'text':
        if (!selfClose) textOpen = { a, m, layer, buf: '' };
        break;
    }
  }
  return { dxf: entsToDxf(ents), count: ents.length };
}

function entsToDxf(ents: Ent[]): string {
  const o: string[] = [];
  const P = (c: number, v: string | number) => { o.push(String(c), typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : v); };
  const layers = [...new Set(ents.map((e) => e.layer))];
  P(0, 'SECTION'); P(2, 'HEADER'); P(9, '$ACADVER'); P(1, 'AC1009'); P(9, '$INSUNITS'); P(70, 0); P(0, 'ENDSEC');
  P(0, 'SECTION'); P(2, 'TABLES'); P(0, 'TABLE'); P(2, 'LAYER'); P(70, layers.length);
  for (const l of layers) { P(0, 'LAYER'); P(2, l); P(70, 0); P(62, 7); P(6, 'CONTINUOUS'); }
  P(0, 'ENDTAB'); P(0, 'ENDSEC');
  P(0, 'SECTION'); P(2, 'ENTITIES');
  for (const e of ents) {
    if (e.text && e.at) {
      P(0, 'TEXT'); P(8, e.layer); P(10, e.at[0]); P(20, -e.at[1]); P(30, 0); P(40, e.h ?? 12); P(1, e.text); P(50, -(e.rot ?? 0));
    } else if (e.pts) {
      P(0, 'LWPOLYLINE'); P(8, e.layer); P(90, e.pts.length); P(70, e.closed ? 1 : 0);
      for (const [x, y] of e.pts) { P(10, x); P(20, -y); }
    }
  }
  P(0, 'ENDSEC'); P(0, 'EOF');
  return o.join('\n') + '\n';
}
