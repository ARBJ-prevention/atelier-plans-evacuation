/**
 * Portée d'un élément entre les affiches d'un même étage :
 * commun à toutes, commun sauf certaines (exceptions), ou propre à une seule affiche.
 */
import type { Element, Floor, Variant } from '../model/types';
import { isVisibleInVariant } from '../model/geometry';
import { currentFloor, currentVariantId, useStore } from '../store/store';
import { confirmDialog } from '../ui/dialogs';

export type ScopeKind = 'all' | 'some' | 'own';

export interface ScopeInfo {
  kind: ScopeKind;
  /** Affiches sur lesquelles l'élément apparaît. */
  on: Variant[];
}

export function scopeOf(el: Element, floor: Floor): ScopeInfo {
  const on = floor.variants.filter((v) => isVisibleInVariant(el, v.id));
  const kind: ScopeKind = el.variantId ? 'own' : el.excludedVariantIds?.some((id) => floor.variants.some((v) => v.id === id)) ? 'some' : 'all';
  return { kind, on };
}

/** Portée d'une sélection : identique pour tous, sinon « mixed ». */
export function selectionScope(els: Element[], floor: Floor): ScopeKind | 'mixed' {
  const kinds = new Set(els.map((e) => scopeOf(e, floor).kind));
  return kinds.size === 1 ? [...kinds][0] : 'mixed';
}

export function scopeLabel(info: ScopeInfo, floor: Floor): string {
  const n = floor.variants.length;
  if (n <= 1) return 'Affiche unique de cet étage';
  if (info.kind === 'all') return `Commun aux ${n} affiches de cet étage`;
  if (info.kind === 'own') return `Uniquement sur « ${info.on[0]?.name ?? '?'} »`;
  return `Sur ${info.on.length} affiche${info.on.length > 1 ? 's' : ''} sur ${n} : ${info.on.map((v) => v.name).join(', ')}`;
}

/**
 * Change la portée des éléments `ids` : 'all' (toutes les affiches de l'étage) ou 'own' (affiche active).
 * Demande confirmation quand des éléments vont disparaître d'autres affiches.
 */
export async function setScopeAction(ids: string[], target: 'all' | 'own'): Promise<boolean> {
  const s = useStore.getState();
  const floor = currentFloor(s);
  if (!floor || floor.variants.length <= 1) return false;
  const variantId = currentVariantId(s);
  const variant = floor.variants.find((v) => v.id === variantId);
  const els = floor.elements.filter((e) => ids.includes(e.id));
  if (!els.length) return false;
  if (target === 'own') {
    const others = floor.variants.filter((v) => v.id !== variantId && els.some((e) => isVisibleInVariant(e, v.id)));
    if (others.length) {
      const what = els.length === 1 ? 'Cet élément' : `Ces ${els.length} éléments`;
      const ok = await confirmDialog('Garder sur cette affiche uniquement',
        `${what} ne sera plus affiché sur ${others.length === 1 ? 'l’affiche' : 'les affiches'} ${others.map((v) => `« ${v.name} »`).join(', ')}.\n\nIl reste modifiable sur « ${variant?.name ?? ''} ». Annulable avec Ctrl+Z.`,
        'Retirer des autres affiches');
      if (!ok) return false;
    }
  }
  useStore.getState().mutateFloor((f) => {
    for (const e of f.elements) {
      if (!ids.includes(e.id)) continue;
      if (target === 'own') { e.variantId = variantId; delete e.excludedVariantIds; }
      else { delete e.variantId; delete e.excludedVariantIds; }
    }
  });
  const n = floor.variants.length;
  useStore.getState().toast(target === 'own'
    ? `Visible uniquement sur « ${variant?.name ?? ''} ».`
    : `Visible sur les ${n} affiches de cet étage.`, 'success');
  return true;
}
