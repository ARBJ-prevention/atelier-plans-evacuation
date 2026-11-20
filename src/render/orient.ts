import { isVisibleInVariant } from '../model/geometry';
import type { Element, Floor, PageSetup, Pt } from '../model/types';

/** Étage tourné pour l'impression (rotation appliquée au plan de fond au rendu). */
export type OrientedFloor = Floor & { orient?: { deg: number; cx: number; cy: number } };

export type PlanRotation = NonNullable<PageSetup['planRotation']>;

/**
 * Fiche pratique, point c) : le plan est orienté dans le sens de lecture de l'utilisateur ; le mur sur lequel
 * il est fixé correspond au trait de paroi situé en haut du repère « Vous êtes ici ». En automatique, le mur le
 * plus proche du repère est pris pour le mur d'affichage et le plan est tourné (par quarts de tour) pour le mettre en haut.
 */
export function autoRotation(floor: Floor, variantId: string): number {
  const visible = new Set(floor.layers.filter((l) => l.visible).map((l) => l.id));
  const shown = floor.elements.filter((e) => visible.has(e.layer) && isVisibleInVariant(e, variantId));
  const marker = shown.find((e) => e.type === 'symbol' && e.symbolId === 'you-are-here');
  if (!marker || marker.type !== 'symbol') return 0;
  const m: Pt = [marker.x, marker.y];
  let best: Pt | null = null, bestD = Infinity;
  for (const w of shown) {
    if (w.type !== 'wall' || w.points.length < 2) continue;
    const pts = w.closed ? [...w.points, w.points[0]] : w.points;
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / L2)) : 0;
      const p: Pt = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(p[0] - m[0], p[1] - m[1]);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  if (!best || bestD < 1e-6) return 0;
  // angle (sens horaire, y vers le bas) qui amène la direction repère → mur vers le haut de la page
  const ang = Math.atan2(best[1] - m[1], best[0] - m[0]) * 180 / Math.PI;
  return (((Math.round((-90 - ang) / 90) * 90) % 360) + 360) % 360;
}

/** Rotation effective du plan imprimé (degrés, 0/90/180/270). Sans la norme et sans choix : 0. */
export function planRotation(floor: Floor, variantId: string, page: PageSetup): number {
  const r = page.planRotation ?? (page.norm !== false ? 'auto' : 0);
  return r === 'auto' ? autoRotation(floor, variantId) : ((Number(r) % 360) + 360) % 360;
}

/** Symboles directionnels qui tournent avec le plan (les autres pictogrammes restent droits). */
const turnsWithPlan = (symbolId: string) => symbolId.includes('arrow') || symbolId.startsWith('you-are-here');

/**
 * Étage tourné de `deg` autour du centre de son contenu : les géométries tournent, les textes, noms de pièces
 * et pictogrammes restent droits et lisibles. Renvoie l'étage tel quel si aucune rotation (ou déjà tourné).
 */
export function orientFloor(floor: Floor, variantId: string, page: PageSetup): OrientedFloor {
  // Déjà tourné, ou zone imprimée choisie à la main (définie dans le repère du dessin) : pas de rotation.
  if ((floor as OrientedFloor).orient || page.area === 'custom') return floor;
  const deg = planRotation(floor, variantId, page);
  if (!deg) return floor;
  const xs: number[] = [], ys: number[] = [];
  for (const e of floor.elements) {
    if ('points' in e) for (const p of e.points) { xs.push(p[0]); ys.push(p[1]); }
    else if ('x' in e) { xs.push(e.x); ys.push(e.y); }
  }
  if (!xs.length) return floor;
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rad = deg * Math.PI / 180, c = Math.round(Math.cos(rad)), s = Math.round(Math.sin(rad));
  const R = (p: Pt): Pt => [cx + (p[0] - cx) * c - (p[1] - cy) * s, cy + (p[0] - cx) * s + (p[1] - cy) * c];
  const V = (v: Pt): Pt => [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
  const turn = (r: number) => (((r + deg) % 360) + 360) % 360;
  const elements = floor.elements.map((e): Element => {
    switch (e.type) {
      case 'wall': case 'area': case 'route':
        return { ...e, points: e.points.map(R) } as Element;
      case 'door': case 'window': case 'stairs': case 'image': {
        const [x, y] = R([e.x, e.y]);
        return { ...e, x, y, rotation: turn(e.rotation) } as Element;
      }
      case 'shape': {
        const [x, y] = R([e.x, e.y]);
        return { ...e, x, y, rotation: turn(e.rotation) };
      }
      case 'symbol': {
        const [x, y] = R([e.x, e.y]);
        return { ...e, x, y, rotation: turnsWithPlan(e.symbolId) ? turn(e.rotation) : e.rotation, ...(e.hereOffset ? { hereOffset: V(e.hereOffset) } : {}) };
      }
      case 'text': case 'legend': {
        const [x, y] = R([e.x, e.y]);
        return { ...e, x, y };
      }
    }
  });
  return { ...floor, elements, orient: { deg, cx, cy } };
}
