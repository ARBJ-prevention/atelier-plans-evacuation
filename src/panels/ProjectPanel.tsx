import { newBuilding, newFloor, newVariant, uid } from '../model/defaults';
import { cloneFloorWithNewIds } from '../model/serialize';
import { STATUS_LABEL } from '../render/PrintPage';
import { currentVariantId, useStore } from '../store/store';
import { confirmDialog, promptDialog } from '../ui/dialogs';
import { Icon } from '../ui/icons';

export function ProjectPanel() {
  const project = useStore((s) => s.project)!;
  const floorId = useStore((s) => s.floorId);
  const variantId = useStore((s) => currentVariantId(s));
  const s = useStore.getState;

  const renameProject = async () => {
    const n = await promptDialog('Renommer le projet', 'Nom du projet', project.name);
    if (n) s().mutate((d) => { d.name = n; });
  };
  const addBuilding = async () => {
    const n = await promptDialog('Nouveau bâtiment', 'Nom du bâtiment', `Bâtiment ${project.buildings.length + 1}`);
    if (!n) return;
    const b = newBuilding(n, project.country);
    s().mutate((d) => { d.buildings.push(b); });
    s().setFloor(b.id, b.floors[0].id);
  };
  const renameBuilding = async (bid: string, cur: string) => {
    const n = await promptDialog('Renommer le bâtiment', 'Nom du bâtiment', cur);
    if (n) s().mutate((d) => { d.buildings.find((b) => b.id === bid)!.name = n; });
  };
  const deleteBuilding = async (bid: string, name: string) => {
    if (project.buildings.length <= 1) { s().toast('Un projet doit contenir au moins un bâtiment.', 'info'); return; }
    if (!(await confirmDialog('Supprimer le bâtiment', `Supprimer « ${name} » et tous ses étages ? (Annulable avec Ctrl+Z)`, 'Supprimer', true))) return;
    s().mutate((d) => { d.buildings = d.buildings.filter((b) => b.id !== bid); });
    const b = useStore.getState().project!.buildings[0];
    s().setFloor(b.id, b.floors[0].id);
  };
  const addFloor = async (bid: string) => {
    const b = project.buildings.find((x) => x.id === bid)!;
    const n = await promptDialog('Nouvel étage', 'Nom de l’étage', `Étage ${b.floors.length}`);
    if (!n) return;
    const f = newFloor(n, b.floors.length, project.country);
    f.titleBlock.author = b.floors[0]?.titleBlock.author ?? '';
    f.titleBlock.organization = b.floors[0]?.titleBlock.organization ?? '';
    f.titleBlock.logo = b.floors[0]?.titleBlock.logo ?? '';
    s().mutate((d) => { d.buildings.find((x) => x.id === bid)!.floors.push(f); });
    s().setFloor(bid, f.id);
  };
  const duplicateFloor = async (bid: string, fid: string) => {
    const b = project.buildings.find((x) => x.id === bid)!;
    const f = b.floors.find((x) => x.id === fid)!;
    const n = await promptDialog('Dupliquer l’étage', 'Nom de la copie', `${f.name} (copie)`);
    if (!n) return;
    const copy = cloneFloorWithNewIds(f, n);
    s().mutate((d) => { const bb = d.buildings.find((x) => x.id === bid)!; bb.floors.splice(bb.floors.findIndex((x) => x.id === fid) + 1, 0, copy); });
    s().setFloor(bid, copy.id);
  };
  const renameFloor = async (bid: string, fid: string, cur: string) => {
    const n = await promptDialog('Renommer l’étage', 'Nom de l’étage', cur);
    if (n) s().mutate((d) => { d.buildings.find((b) => b.id === bid)!.floors.find((f) => f.id === fid)!.name = n; });
  };
  const deleteFloor = async (bid: string, fid: string, name: string) => {
    const b = project.buildings.find((x) => x.id === bid)!;
    if (b.floors.length <= 1) { s().toast('Un bâtiment doit contenir au moins un étage.', 'info'); return; }
    if (!(await confirmDialog('Supprimer l’étage', `Supprimer « ${name} » ? (Annulable avec Ctrl+Z)`, 'Supprimer', true))) return;
    s().mutate((d) => { const bb = d.buildings.find((x) => x.id === bid)!; bb.floors = bb.floors.filter((f) => f.id !== fid); });
    if (fid === floorId) s().setFloor(bid, useStore.getState().project!.buildings.find((x) => x.id === bid)!.floors[0].id);
  };

  // Versions (emplacements « Vous êtes ici »)
  const floor = project.buildings.flatMap((b) => b.floors).find((f) => f.id === floorId);
  const addVariant = async (duplicate: boolean) => {
    if (!floor) return;
    const n = await promptDialog(duplicate ? 'Dupliquer la version' : 'Nouvelle version du plan', 'Nom de la version (ex. « Accueil », « Couloir B »)', `Version ${floor.variants.length + 1}`,
      'Chaque version partage les éléments communs de l’étage et possède ses propres éléments (notamment l’emplacement « Vous êtes ici »).');
    if (!n) return;
    const v = newVariant(n);
    s().mutateFloor((f) => {
      f.variants.push(v);
      if (duplicate) {
        const own = f.elements.filter((e) => e.variantId === variantId);
        f.elements.push(...own.map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: uid('el'), variantId: v.id })));
      }
    });
    s().setVariant(v.id);
  };
  const renameVariant = async () => {
    const v = floor?.variants.find((x) => x.id === variantId);
    if (!v) return;
    const n = await promptDialog('Renommer la version', 'Nom', v.name);
    if (n) s().mutateFloor((f) => { f.variants.find((x) => x.id === v.id)!.name = n; }, { keepValidation: true });
  };
  const deleteVariant = async () => {
    if (!floor || floor.variants.length <= 1) return;
    const v = floor.variants.find((x) => x.id === variantId)!;
    if (!(await confirmDialog('Supprimer la version', `Supprimer la version « ${v.name} » et ses éléments propres ?`, 'Supprimer', true))) return;
    s().mutateFloor((f) => { f.variants = f.variants.filter((x) => x.id !== v.id); f.elements = f.elements.filter((e) => e.variantId !== v.id); });
    s().setVariant(useStore.getState().project!.buildings.flatMap((b) => b.floors).find((f) => f.id === floorId)!.variants[0].id);
  };

  return (
    <div className="panel-body">
      <div className="proj-head">
        <div>
          <div className="muted small">Projet</div>
          <div className="proj-name" title={project.name}>{project.name}</div>
        </div>
        <button className="icon-btn" title="Renommer le projet" onClick={renameProject}><Icon name="edit" size={16} /></button>
      </div>

      <div className="tree">
        {project.buildings.map((b) => (
          <div key={b.id} className="tree-building">
            <div className="tree-row building">
              <Icon name="building" size={16} />
              <span className="tree-label" title={b.name}>{b.name}</span>
              <button className="icon-btn" title="Ajouter un étage" onClick={() => addFloor(b.id)}><Icon name="plus" size={15} /></button>
              <button className="icon-btn" title="Renommer" onClick={() => renameBuilding(b.id, b.name)}><Icon name="edit" size={15} /></button>
              <button className="icon-btn" title="Supprimer" onClick={() => deleteBuilding(b.id, b.name)}><Icon name="trash" size={15} /></button>
            </div>
            {b.floors.map((f) => (
              <div key={f.id} className={f.id === floorId ? 'tree-row floor active' : 'tree-row floor'}
                onClick={() => s().setFloor(b.id, f.id)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') s().setFloor(b.id, f.id); }}>
                <Icon name="floor" size={15} />
                <span className="tree-label" title={f.name}>{f.name}</span>
                <span className={`badge status-${f.titleBlock.status}`}>{STATUS_LABEL[f.titleBlock.status]}</span>
                <button className="icon-btn" title="Dupliquer l’étage" onClick={(e) => { e.stopPropagation(); duplicateFloor(b.id, f.id); }}><Icon name="copy" size={14} /></button>
                <button className="icon-btn" title="Renommer" onClick={(e) => { e.stopPropagation(); renameFloor(b.id, f.id, f.name); }}><Icon name="edit" size={14} /></button>
                <button className="icon-btn" title="Supprimer" onClick={(e) => { e.stopPropagation(); deleteFloor(b.id, f.id, f.name); }}><Icon name="trash" size={14} /></button>
              </div>
            ))}
          </div>
        ))}
        <button className="btn small full" onClick={addBuilding}><Icon name="plus" size={15} /> Ajouter un bâtiment</button>
      </div>

      {floor && (
        <section className="variants">
          <h3>Versions de ce plan</h3>
          <p className="muted small">Une version par emplacement « Vous êtes ici ». Les éléments communs sont partagés.</p>
          <div className="variant-list">
            {floor.variants.map((v) => (
              <button key={v.id} className={v.id === variantId ? 'variant active' : 'variant'} onClick={() => s().setVariant(v.id)}>
                {v.name}
                <span className="muted small"> · {floor.elements.filter((e) => e.variantId === v.id).length} propre(s)</span>
              </button>
            ))}
          </div>
          <div className="row gap">
            <button className="btn small" onClick={() => addVariant(false)}><Icon name="plus" size={14} /> Nouvelle</button>
            <button className="btn small" onClick={() => addVariant(true)}><Icon name="copy" size={14} /> Dupliquer</button>
            <button className="btn small" onClick={renameVariant} title="Renommer"><Icon name="edit" size={14} /></button>
            <button className="btn small" onClick={deleteVariant} disabled={floor.variants.length <= 1} title="Supprimer"><Icon name="trash" size={14} /></button>
          </div>
        </section>
      )}
    </div>
  );
}
