import { useMemo } from 'react';
import type { Background, Element, Floor } from '../model/types';
import type { FlatDxf } from '../services/dxf';
import {
  guessLayerRole, recognizedElements, recognizePlan, RECOGNIZED_KINDS, ROLE_LABELS, type LayerRole, type Recognized,
} from '../services/recognize';
import { FloorDrawing } from '../render/FloorDrawing';
import { ask } from '../ui/dialogs';

export interface RecognizeChoice { elements: Element[]; counts: Record<keyof Recognized, number> }

const ROLE_ORDER: LayerRole[] = ['walls', 'partitions', 'doors', 'windows', 'stairs', 'rooms', 'labels', 'other', 'ignore'];

/**
 * Fenêtre de vérification de la reconnaissance : rôle de chaque calque, catégories à garder,
 * aperçu du plan redessiné (rendu identique à l'éditeur) par-dessus le plan importé.
 * Renvoie les éléments à ajouter, [] pour garder le fond seul, null si annulé.
 */
export async function askRecognition(
  flat: FlatDxf, layers: string[], origin: { minX: number; maxY: number; k: number }, floor: Floor, background: Background, unitsPerMeter: number,
): Promise<RecognizeChoice | null> {
  const roles: Record<string, LayerRole> = Object.fromEntries(layers.map((l) => [l, guessLayerRole(l)]));
  const counts = new Map(flat.layers.map((l) => [l.name, l.count]));
  const run = (v: Record<string, any>) => {
    const all: Record<string, LayerRole> = Object.fromEntries(flat.layers.map((l) => [l.name, (v.roles as Record<string, LayerRole>)[l.name] ?? 'ignore']));
    return recognizePlan(flat, { roles: all, origin, unitsPerMeter });
  };
  const r = await ask({
    title: 'Redessiner le plan',
    wide: true,
    initial: { roles, kinds: RECOGNIZED_KINDS.map((k) => k.key) },
    render: (v, set) => <RecognizePanel values={v} set={set} layers={layers} counts={counts} run={run} floor={floor} background={background} upm={unitsPerMeter} />,
    buttons: [
      { label: 'Annuler', value: 'cancel' },
      { label: 'Garder le fond seul', value: 'background' },
      { label: 'Ajouter au plan', value: 'ok', primary: true },
    ],
  });
  if (r.button === 'cancel') return null;
  const rec = run(r.values);
  const counts2 = Object.fromEntries(RECOGNIZED_KINDS.map((k) => [k.key, rec[k.key].length])) as Record<keyof Recognized, number>;
  if (r.button === 'background') return { elements: [], counts: counts2 };
  return { elements: recognizedElements(rec, new Set(r.values.kinds as (keyof Recognized)[])), counts: counts2 };
}

export function RecognizePanel({ values, set, layers, counts, run, floor, background, upm }: {
  values: Record<string, any>; set(p: Record<string, any>): void; layers: string[]; counts: Map<string, number>;
  run(v: Record<string, any>): Recognized; floor: Floor; background: Background; upm: number;
}) {
  const rec = useMemo(() => { try { return run(values); } catch { return null; } }, [values.roles]); // eslint-disable-line react-hooks/exhaustive-deps
  const kinds = new Set(values.kinds as (keyof Recognized)[]);
  const roles = values.roles as Record<string, LayerRole>;
  const preview: Floor | null = rec ? {
    ...floor, unitsPerMeter: upm,
    background: { ...background, opacity: 0.35, grayscale: true },
    elements: recognizedElements(rec, kinds),
    layers: floor.layers.map((l) => ({ ...l, visible: true, locked: false })),
  } : null;
  const pad = Math.max(background.naturalWidth, background.naturalHeight) * 0.03;
  return (
    <div className="recog">
      <div className="recog-preview">
        {preview
          ? <svg viewBox={`${-pad} ${-pad} ${background.naturalWidth + 2 * pad} ${background.naturalHeight + 2 * pad}`} preserveAspectRatio="xMidYMid meet">
              <FloorDrawing floor={preview} variantId={floor.variants[0].id} customSymbols={[]} />
            </svg>
          : <p className="muted small">La reconnaissance a échoué sur ce plan. Vous pouvez garder le fond seul.</p>}
      </div>
      <div className="recog-side">
        <b className="small">Éléments reconnus</b>
        {RECOGNIZED_KINDS.map((k) => (
          <label key={k.key} className="field check">
            <input type="checkbox" checked={kinds.has(k.key)}
              onChange={(e) => set({ kinds: RECOGNIZED_KINDS.map((x) => x.key).filter((x) => (x === k.key ? e.target.checked : kinds.has(x))) })} />
            <span>{k.label} <span className="muted">({rec ? rec[k.key].length : 0})</span></span>
          </label>
        ))}
        <p className="muted tiny">Le plan importé reste en fond (calque « Fond ») pour comparer. Tout reste modifiable ensuite.</p>
      </div>
      <div className="recog-roles">
        <b className="small">Rôle des calques</b>
        <ul>
          {layers.map((l) => (
            <li key={l}>
              <span className="name" title={l}>{l}</span>
              <span className="muted tiny">{(counts.get(l) ?? 0).toLocaleString('fr-BE')}</span>
              <select value={roles[l]} onChange={(e) => set({ roles: { ...roles, [l]: e.target.value } })}>
                {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </li>
          ))}
        </ul>
        <p className="muted tiny">Rôles devinés d’après le nom des calques. Si un élément manque ou est en trop, changez le rôle du calque concerné : l’aperçu se met à jour.</p>
      </div>
    </div>
  );
}
