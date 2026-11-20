import { polygonCentroid } from '../render/ElementView';
import type { AreaElement, Floor, PageSetup } from './types';

export type StreetSide = NonNullable<PageSetup['streetSide']>;

export const STREET_SIDES: [StreetSide, string][] = [['bottom', 'En bas'], ['top', 'En haut'], ['left', 'À gauche'], ['right', 'À droite']];

/** Numéro de local : chiffre(s) de l'étage puis deux chiffres (étage 0, local 12 → « 012 » ; étage 1 → « 105 »). */
export function roomNumber(level: number, index: number): string {
  return `${level}${String(index).padStart(2, '0')}`;
}

/**
 * Numérotation des locaux selon la fiche pratique : en commençant par les locaux les plus proches de la rue
 * principale, de gauche à droite en regardant le bâtiment depuis la rue. Les locaux sont rangés par « rangées »
 * de profondeur (distance à la rue), puis de gauche à droite dans chaque rangée.
 * Renvoie l'identifiant de chaque pièce et son numéro, dans l'ordre.
 */
export function computeRoomNumbers(floor: Floor, side: StreetSide = 'bottom'): { id: string; number: string }[] {
  const rooms = floor.elements.filter((e): e is AreaElement => e.type === 'area' && e.kind === 'room' && e.points.length >= 3);
  if (!rooms.length) return [];
  const xs = rooms.flatMap((r) => r.points.map((p) => p[0])), ys = rooms.flatMap((r) => r.points.map((p) => p[1]));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const items = rooms.map((r) => {
    const [cx, cy] = polygonCentroid(r.points);
    const px = r.points.map((p) => p[0]), py = r.points.map((p) => p[1]);
    // profondeur = distance à la rue ; latéral = de gauche à droite pour quelqu'un qui regarde le bâtiment depuis la rue
    const depth = side === 'bottom' ? maxY - cy : side === 'top' ? cy - minY : side === 'left' ? cx - minX : maxX - cx;
    const lat = side === 'bottom' ? cx : side === 'top' ? -cx : side === 'left' ? cy : -cy;
    const extent = side === 'bottom' || side === 'top' ? Math.max(...py) - Math.min(...py) : Math.max(...px) - Math.min(...px);
    return { id: r.id, depth, lat, extent };
  }).sort((a, b) => a.depth - b.depth);
  const extents = items.map((i) => i.extent).sort((a, b) => a - b);
  const tol = extents[Math.floor(extents.length / 2)] * 0.5;
  const rows: typeof items[] = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    if (row && it.depth - row[0].depth <= tol) row.push(it);
    else rows.push([it]);
  }
  let n = 0;
  return rows.flatMap((row) => row.sort((a, b) => a.lat - b.lat)).map((it) => ({ id: it.id, number: roomNumber(floor.level, ++n) }));
}
