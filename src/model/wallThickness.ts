import { openingHostFit, openingWallFit } from './geometry';
import type { DoorElement, Floor, Pt, WallElement, WindowElement } from './types';

type P = [number, number];

/**
 * Change l'épaisseur de murs et retravaille ce qui s'y rattache (le plancher est modifié sur place) :
 *
 * - bouts des autres murs : un bout posé sur l'axe du mur ne bouge pas ; un bout arrêté contre une face
 *   (ou dont le bout carré affleure une face) suit cette face ; un bout pris dans l'épaisseur garde sa
 *   position relative. Les murs restent ainsi raccordés, sans jour ni dépassement ;
 * - portes et fenêtres posées dans le mur (à quelques mm près) : recalées sur son axe ; les fenêtres
 *   (et leurs volets) prennent sa nouvelle épaisseur ;
 * - portes : leur épaisseur suit déjà celle du mur où elles sont posées (calculée au rendu).
 *
 * Les murs gardent leur axe : l'épaisseur s'ajoute de part et d'autre.
 */
export function setWallsThickness(floor: Floor, variantId: string, ids: Set<string>, thickness: number): void {
  const walls = floor.elements.filter((e): e is WallElement => e.type === 'wall');
  const changed = walls.filter((w) => ids.has(w.id) && Math.abs(w.thickness - thickness) > 1e-9);
  if (!changed.length) return;
  const m = floor.unitsPerMeter > 0 ? floor.unitsPerMeter : 50;
  const tol = Math.max(0.5, 0.03 * m);

  // ouvertures posées dans les murs (tolérance de quelques mm) : épaisseur du mur avant changement,
  // pour garder la même proportion ensuite
  const openings = floor.elements.filter((e): e is WindowElement | DoorElement => e.type === 'window' || e.type === 'door');
  const before = new Map(openings.map((o) => [o.id, openingHostFit(floor, variantId, o)]));

  // segments des murs modifiés, avec l'ancienne et la nouvelle épaisseur
  const segs: { id: string; a: P; b: P; t0: number; t1: number }[] = [];
  for (const w of changed) {
    const pts = w.points as P[];
    for (let i = 0; i + 1 < pts.length; i++) segs.push({ id: w.id, a: pts[i], b: pts[i + 1], t0: w.thickness, t1: thickness });
    if (w.closed && pts.length > 2) segs.push({ id: w.id, a: pts[pts.length - 1], b: pts[0], t0: w.thickness, t1: thickness });
  }

  // bouts des murs (les murs modifiés compris : un mur épaissi raccordé à un autre mur épaissi)
  const moves: { w: WallElement; index: number; to: Pt }[] = [];
  for (const w of walls) {
    const pts = w.points as P[];
    if (w.closed || pts.length < 2) continue;
    for (const index of [0, pts.length - 1]) {
      const end = pts[index], prev = pts[index === 0 ? 1 : pts.length - 2];
      const len = Math.hypot(end[0] - prev[0], end[1] - prev[1]);
      if (len < 1e-6) continue;
      // direction du mur vers son bout
      const dir: P = [(end[0] - prev[0]) / len, (end[1] - prev[1]) / len];
      // bout carré du mur (dépasse d'une demi-épaisseur) : avant, pour reconnaître le raccord ; après, pour le refaire
      const cap0 = w.thickness / 2, cap1 = (ids.has(w.id) ? thickness : w.thickness) / 2;
      let best: { s1: number; s: number; cross: number } | null = null;
      for (const sg of segs) {
        if (sg.id === w.id) continue;
        const L = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]);
        if (L < 1e-6) continue;
        const u: P = [(sg.b[0] - sg.a[0]) / L, (sg.b[1] - sg.a[1]) / L];
        const n: P = [-u[1], u[0]];
        const cross = Math.abs(dir[0] * n[0] + dir[1] * n[1]); // 1 : perpendiculaire, 0 : parallèle
        if (cross < 0.5) continue;
        const along = (end[0] - sg.a[0]) * u[0] + (end[1] - sg.a[1]) * u[1];
        if (along < -sg.t0 / 2 - tol || along > L + sg.t0 / 2 + tol) continue;
        // distance du bout à l'axe, comptée positivement du côté d'où vient le mur (le long de sa direction)
        const off = (end[0] - sg.a[0]) * n[0] + (end[1] - sg.a[1]) * n[1];
        const side = Math.sign(-(dir[0] * n[0] + dir[1] * n[1])) || 1;
        const s = (off * side) / cross; // distance mesurée le long du mur
        const h0 = sg.t0 / 2, h1 = sg.t1 / 2;
        let s1: number | null = null;
        // sur l'axe : raccord d'angle, rien à faire (tolérance limitée pour un mur très fin, valeur en cours de saisie)
        if (Math.abs(s) < Math.min(tol, h0 / cross / 2)) s1 = null;
        else if (Math.abs(s - cap0 - h0 / cross) < tol) s1 = cap1 + h1 / cross; // bout carré contre la face proche
        else if (Math.abs(s - cap0 + h0 / cross) < tol) s1 = cap1 - h1 / cross; // bout carré contre la face opposée
        else if (Math.abs(s - h0 / cross) < tol) s1 = h1 / cross; // bout contre la face proche
        else if (Math.abs(s + h0 / cross) < tol) s1 = -h1 / cross; // bout contre la face opposée
        else if (Math.abs(s) < h0 / cross) s1 = s * (h1 / h0); // dans l'épaisseur
        if (s1 === null) continue;
        if (!best || cross > best.cross) best = { s1, s, cross };
      }
      if (best) {
        // avancer le bout le long du mur de k réduit sa distance à l'axe de k : k = s - s1
        // (k < 0 : il recule devant une face qui s'approche, k > 0 : il avance vers une face qui s'éloigne)
        const k = best.s - best.s1;
        moves.push({ w, index, to: [end[0] + dir[0] * k, end[1] + dir[1] * k] });
      }
    }
  }

  for (const w of changed) w.thickness = thickness;
  const rd = (v: number) => Math.round(v * 100) / 100;
  for (const mv of moves) mv.w.points[mv.index] = [rd(mv.to[0]), rd(mv.to[1])];

  for (const o of openings) {
    const fit0 = before.get(o.id);
    if (!fit0) continue;
    // recalée exactement sur l'axe de son mur (répare un léger décalage), puis à la nouvelle épaisseur
    o.x = fit0.x; o.y = fit0.y; o.rotation = fit0.rotation;
    const fit1 = openingWallFit(floor, variantId, o);
    // fenêtre (et son volet) à l'épaisseur du mur, comme à l'import : répare aussi une fenêtre restée à l'ancienne épaisseur
    if (o.type === 'window' && fit1 && Math.abs(fit1.depth - fit0.depth) > 1e-9) o.depth = rd(fit1.depth);
  }
}
