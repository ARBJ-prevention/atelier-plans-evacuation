import { LAYER_ORDER } from '../model/defaults';
import { isVisibleInVariant } from '../model/geometry';
import type { CustomSymbol, Floor } from '../model/types';
import { ElementView } from './ElementView';

/**
 * Dessin vectoriel d'un étage (coordonnées plan). Utilisé à la fois par
 * l'éditeur (interactive = true : ajoute les attributs de sélection) et par
 * les exports PDF / PNG / impression.
 */
export function FloorDrawing({ floor, variantId, customSymbols, interactive = false, idPrefix = '' }: {
  floor: Floor; variantId: string; customSymbols: CustomSymbol[]; interactive?: boolean; idPrefix?: string;
}) {
  const layer = (id: string) => floor.layers.find((l) => l.id === id)!;
  const ctx = { floor, variantId, customSymbols, interactive, idPrefix };
  const bg = floor.background;
  const bgLayer = layer('background');
  return (
    <g>
      {bg && bgLayer.visible && (
        <image href={bg.src} x={bg.x} y={bg.y} width={bg.naturalWidth * bg.scale} height={bg.naturalHeight * bg.scale}
          opacity={bg.opacity} preserveAspectRatio="none"
          style={{ ...(bg.grayscale ? { filter: 'grayscale(1) contrast(1.05)' } : {}), ...(interactive ? { pointerEvents: bg.locked || bgLayer.locked ? 'none' : 'auto' } : {}) } as any}
          {...(interactive ? { 'data-bg': '1' } : {})} />
      )}
      {LAYER_ORDER.filter((l) => l !== 'background').map((lid) => {
        const L = layer(lid);
        if (!L.visible) return null;
        return (
          <g key={lid} data-layer={lid} style={interactive && L.locked ? { pointerEvents: 'none' } : undefined}>
            {floor.elements
              .filter((e) => e.layer === lid && isVisibleInVariant(e, variantId))
              .map((e) => (
                <g key={e.id} {...(interactive ? { 'data-id': e.id, className: e.locked ? 'el locked' : 'el' } : {})}>
                  <ElementView el={e} ctx={ctx} />
                </g>
              ))}
          </g>
        );
      })}
    </g>
  );
}
