/**
 * Flèches d'évacuation prêtes à poser : trait épais à bouts arrondis,
 * virages en arc de cercle, pointe ouverte. Ce sont de vrais itinéraires
 * (type « route ») : points de passage, couleur et épaisseur restent modifiables.
 */
import { makeElement } from '../model/defaults';
import type { Pt, RouteElement } from '../model/types';
import { useStore } from '../store/store';

export interface ArrowPreset {
  id: string;
  name: string;
  /** Points dans une boîte d'environ 200 u, centrés sur l'origine. */
  points: Pt[];
  radius: number;
  both?: boolean;
}

export const ARROW_PRESETS: ArrowPreset[] = [
  { id: 'u-turn', name: 'Demi-tour', points: [[-55, 20], [-55, -100], [55, -100], [55, 110]], radius: 55 },
  { id: 'u-turn-left', name: 'Demi-tour (à gauche)', points: [[55, 20], [55, -100], [-55, -100], [-55, 110]], radius: 55 },
  { id: 'straight', name: 'Tout droit', points: [[0, 100], [0, -100]], radius: 0 },
  { id: 'turn-right', name: 'Virage à droite', points: [[-60, 100], [-60, -40], [90, -40]], radius: 60 },
  { id: 'turn-left', name: 'Virage à gauche', points: [[60, 100], [60, -40], [-90, -40]], radius: 60 },
  { id: 'chicane', name: 'Chicane', points: [[-50, 110], [-50, 10], [50, 10], [50, -110]], radius: 45 },
  { id: 'both-ways', name: 'Double sens', points: [[-110, 0], [110, 0]], radius: 0, both: true },
];

export const GREEN_ARROW_STYLE = {
  color: '#00843d', width: 14, arrowStyle: 'open', arrowSize: 1, corner: 'round', outline: '', arrowRepeat: 0, kind: 'principal', dash: 'solid',
} as const;

/** Insère une flèche au centre de la vue et la sélectionne. */
export function insertArrowPreset(id: string): void {
  const preset = ARROW_PRESETS.find((p) => p.id === id);
  const s = useStore.getState();
  if (!preset || !s.project) return;
  const el = document.querySelector('.canvas-wrap');
  const cx = ((el?.clientWidth ?? 800) / 2 - s.view.x) / s.view.zoom;
  const cy = ((el?.clientHeight ?? 600) / 2 - s.view.y) / s.view.zoom;
  const route = makeElement('route', {
    ...GREEN_ARROW_STYLE,
    points: preset.points.map(([x, y]) => [Math.round(cx + x), Math.round(cy + y)] as Pt),
    cornerRadius: preset.radius,
    arrowEnd: true,
    arrowStart: !!preset.both,
  }) as RouteElement;
  s.addElements([route]);
  s.setTool('select');
  useStore.setState({ selection: [route.id] });
}
