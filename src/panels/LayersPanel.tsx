import { LAYER_ORDER } from '../model/defaults';
import { currentFloor, useStore } from '../store/store';
import { Icon } from '../ui/icons';

const LAYER_COLORS: Record<string, string> = {
  background: '#9aa7b4', building: '#1d2630', routes: '#00843d', symbols: '#e30613', annotations: '#1f4e8c',
};

export function LayersPanel() {
  const floor = useStore((s) => currentFloor(s))!;
  const grid = useStore((s) => s.grid);
  const guides = useStore((s) => s.guides);
  const rulers = useStore((s) => s.rulers);
  const S = useStore.getState;

  const toggle = (id: string, key: 'visible' | 'locked') => {
    S().mutateFloor((f) => { const l = f.layers.find((x) => x.id === id)!; l[key] = !l[key]; }, { history: false, keepValidation: true });
    useStore.setState({ selection: [] });
  };
  const selectLayer = (id: string) => {
    const vis = floor.layers.find((l) => l.id === id);
    if (!vis?.visible || vis.locked) return;
    S().select(floor.elements.filter((e) => e.layer === id).map((e) => e.id));
  };

  return (
    <div className="panel-body">
      <h3>Calques</h3>
      <p className="muted tiny">Du dessus vers le dessous. Cliquez sur le nom pour sélectionner tout le calque.</p>
      <div className="layers">
        {[...LAYER_ORDER].reverse().map((id) => {
          const l = floor.layers.find((x) => x.id === id)!;
          const count = id === 'background' ? (floor.background ? 1 : 0) : floor.elements.filter((e) => e.layer === id).length;
          return (
            <div key={id} className={l.visible ? 'layer' : 'layer hidden'}>
              <span className="layer-dot" style={{ background: LAYER_COLORS[id] }} />
              <button className="layer-name" onClick={() => selectLayer(id)} disabled={id === 'background'}>{l.name}</button>
              <span className="layer-count">{count}</span>
              <button className="icon-btn" title={l.visible ? 'Masquer' : 'Afficher'} aria-pressed={l.visible} onClick={() => toggle(id, 'visible')}>
                <Icon name={l.visible ? 'eye' : 'eyeOff'} size={16} />
              </button>
              <button className={l.locked ? 'icon-btn on' : 'icon-btn'} title={l.locked ? 'Déverrouiller' : 'Verrouiller'} aria-pressed={l.locked} onClick={() => toggle(id, 'locked')}>
                <Icon name={l.locked ? 'lock' : 'unlock'} size={16} />
              </button>
            </div>
          );
        })}
      </div>

      <h3>Affichage de l’espace de travail</h3>
      <div className="toggle-list">
        <label className="check"><input type="checkbox" checked={grid.show} onChange={(e) => S().setGrid({ show: e.target.checked })} /> Grille</label>
        <label className="check"><input type="checkbox" checked={grid.snap} onChange={(e) => S().setGrid({ snap: e.target.checked })} /> Magnétisme sur la grille</label>
        <label className="check"><input type="checkbox" checked={guides} onChange={() => S().toggleGuides()} /> Repères d’alignement</label>
        <label className="check"><input type="checkbox" checked={rulers} onChange={() => S().toggleRulers()} /> Règles</label>
      </div>
      <label className="field inline"><span>Style</span>
        <select value={grid.style} onChange={(e) => S().setGrid({ style: e.target.value as any })}><option value="lines">Lignes</option><option value="dots">Points</option></select>
      </label>
      <label className="field inline"><span>Pas de grille</span>
        <select value={grid.size} onChange={(e) => S().setGrid({ size: Number(e.target.value) })}>
          {[5, 10, 20, 25, 50, 100].map((v) => <option key={v} value={v}>{v} u</option>)}
        </select>
      </label>
      <label className="field inline"><span>Intensité</span>
        <input type="range" min={0} max={1} step={0.05} value={grid.intensity} onChange={(e) => S().setGrid({ intensity: Number(e.target.value) })} />
      </label>
      <p className="muted tiny">Maintenez Alt pendant un déplacement pour désactiver temporairement grille et repères.</p>
    </div>
  );
}
