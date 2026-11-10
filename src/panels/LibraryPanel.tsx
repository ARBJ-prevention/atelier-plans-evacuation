import { useState } from 'react';
import { importSymbolAction } from '../app/actions';
import { SymbolGraphic } from '../render/ElementView';
import { BUILTIN_SYMBOLS, SYMBOL_CATEGORIES } from '../symbols/library';
import { useStore } from '../store/store';
import { confirmDialog } from '../ui/dialogs';
import { Icon } from '../ui/icons';

export function LibraryPanel() {
  const project = useStore((s) => s.project)!;
  const tool = useStore((s) => s.tool);
  const pending = useStore((s) => s.pendingSymbol);
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const all = [
    ...BUILTIN_SYMBOLS.map((s) => ({ id: s.id, name: s.name, category: s.category, code: s.code ?? '', custom: false })),
    ...project.customSymbols.map((s) => ({ id: s.id, name: s.name, category: s.category, code: '', custom: true })),
  ].filter((s) => !q || norm(`${s.name} ${s.code}`).includes(norm(q)));
  const cats = Array.from(new Set([...SYMBOL_CATEGORIES, ...project.customSymbols.map((s) => s.category)]));

  const removeCustom = async (id: string, name: string) => {
    const used = project.buildings.some((b) => b.floors.some((f) => f.elements.some((e) => e.type === 'symbol' && e.symbolId === id)));
    if (!(await confirmDialog('Retirer le pictogramme', `Retirer « ${name} » de la bibliothèque du projet ?${used ? '\nAttention : il est utilisé sur au moins un plan.' : ''}`, 'Retirer', true))) return;
    useStore.getState().mutate((d) => { d.customSymbols = d.customSymbols.filter((s) => s.id !== id); });
  };

  return (
    <div className="panel-body lib">
      <div className="search-wrap">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="6" /><path d="M16 16 L21 21" /></svg>
        <input className="search" placeholder="Rechercher (nom ou code ISO, ex. F001)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un pictogramme" />
      </div>
      <p className="muted tiny">Cliquez puis cliquez sur le plan, ou glissez-déposez. Signaux ISO 7010 officiels (domaine public / CC0).</p>
      {cats.map((c) => {
        const items = all.filter((s) => s.category === c);
        if (!items.length) return null;
        const isClosed = closed[c] && !q;
        return (
          <section key={c} className="lib-cat">
            <button className="lib-cat-head" onClick={() => setClosed({ ...closed, [c]: !closed[c] })} aria-expanded={!isClosed}>
              <span>{c}</span><em>{items.length}</em>
              <svg className={isClosed ? 'chev' : 'chev open'} width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5 L6 7.5 L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
            {!isClosed && (
              <div className="lib-grid">
                {items.map((s) => (
                  <div key={s.id} className={tool === 'symbol' && pending === s.id ? 'lib-item active' : 'lib-item'}
                    draggable title={`${s.code ? s.code + ' — ' : ''}${s.name}`} role="button" tabIndex={0}
                    onDragStart={(e) => { e.dataTransfer.setData('application/x-evac-symbol', s.id); e.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => useStore.getState().setTool('symbol', s.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') useStore.getState().setTool('symbol', s.id); }}>
                    <svg viewBox="-23 -23 46 46" width={42} height={42}><SymbolGraphic symbolId={s.id} size={42} custom={project.customSymbols} /></svg>
                    <span>{s.name}</span>
                    {s.code && <i className="code">{s.code}</i>}
                    {s.custom && <button className="lib-del" title="Retirer" onClick={(e) => { e.stopPropagation(); removeCustom(s.id, s.name); }}>×</button>}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {all.length === 0 && <p className="muted small">Aucun pictogramme ne correspond à « {q} ».</p>}
      <button className="btn small full" onClick={() => importSymbolAction()}><Icon name="import" size={15} /> Importer un pictogramme (SVG, PNG)</button>
      <p className="muted tiny">
        Les pictogrammes « Repères » et « Mobilier » sont des dessins originaux (CC0) pour les éléments sans signal ISO 7010.
        Vérifiez toujours les exigences applicables dans votre pays.
      </p>
    </div>
  );
}
