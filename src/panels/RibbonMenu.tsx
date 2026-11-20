import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/icons';

/** Ferme le menu déroulant parent (utilisé par les entrées du menu). */
const CloseCtx = createContext<() => void>(() => {});

/**
 * Bouton de ruban à menu déroulant (inspiré des boutons « ▾ » d'EdrawMax).
 * - `big` : grande icône au-dessus du libellé ; sinon petit bouton en ligne.
 * - `onMain` : bouton partagé (« split ») — la partie haute lance l'action principale, la flèche ouvre le menu.
 * Le menu s'affiche dans un calque fixe pour ne pas être rogné par le ruban, avec une petite animation d'ouverture.
 */
export function DropButton({ icon, label, title, big, active, disabled, onMain, wide, children }: {
  icon: string; label: string; title?: string; big?: boolean; active?: boolean; disabled?: boolean;
  onMain?(): void; wide?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; color: string } | null>(null);
  const btn = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = menu.current?.offsetWidth ?? 220;
    const color = getComputedStyle(btn.current).getPropertyValue('--tab-c').trim();
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + 4, color });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') setOpen(false); return; }
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const shut = () => setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('resize', shut);
    window.addEventListener('blur', shut);
    return () => {
      window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close);
      window.removeEventListener('resize', shut); window.removeEventListener('blur', shut);
    };
  }, [open]);

  const cls = `rb-drop ${big ? 'big' : 'small'}${onMain ? ' split' : ''}${active ? ' on' : ''}${open ? ' open' : ''}`;
  const toggle = () => setOpen((o) => !o);
  return (
    <div className={cls} ref={btn} title={title ?? label}>
      {onMain ? (
        <>
          <button className="rb-drop-main" disabled={disabled} onClick={onMain} aria-pressed={active}>
            <Icon name={icon} size={big ? 22 : 16} />{!big && <span>{label}</span>}
          </button>
          <button className="rb-drop-arrow" disabled={disabled} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`${label} : plus de choix`}>
            {big && <span>{label}</span>}<Icon name="chevronDown" size={11} />
          </button>
        </>
      ) : (
        <button className="rb-drop-arrow whole" disabled={disabled} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-pressed={active}>
          <Icon name={icon} size={big ? 22 : 16} /><span>{label}</span><Icon name="chevronDown" size={11} />
        </button>
      )}
      {open && createPortal(
        <div ref={menu} className={wide ? 'rb-menu wide' : 'rb-menu'} role="menu"
          style={pos ? { left: pos.left, top: pos.top, ...(pos.color ? { '--tab-c': pos.color } : {}) } as React.CSSProperties : { visibility: 'hidden', left: 0, top: 0 }}>
          <CloseCtx.Provider value={() => setOpen(false)}>{children}</CloseCtx.Provider>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Entrée de menu déroulant. `keepOpen` pour les cases à cocher qu'on enchaîne. */
export function MenuItem({ icon, label, hint, onClick, active, disabled, keepOpen, check }: {
  icon?: string; label: string; hint?: string; onClick(): void; active?: boolean; disabled?: boolean; keepOpen?: boolean; check?: boolean;
}) {
  const close = useContext(CloseCtx);
  return (
    <button role={check ? 'menuitemcheckbox' : 'menuitem'} aria-checked={check ? !!active : undefined} className={active ? 'rb-mi on' : 'rb-mi'} disabled={disabled}
      onClick={() => { onClick(); if (!keepOpen) close(); }}>
      <span className="rb-mi-ico">{check ? <span className={active ? 'rb-cb on' : 'rb-cb'} /> : icon ? <Icon name={icon} size={16} /> : null}</span>
      <span className="rb-mi-label">{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
}

export const MenuSep = () => <div className="rb-menu-sep" role="separator" />;
export const MenuHead = ({ children }: { children: React.ReactNode }) => <div className="rb-menu-head">{children}</div>;
/** Zone libre dans un menu (galerie, réglages). Les clics n'y ferment pas le menu. */
export const MenuPane = ({ children }: { children: React.ReactNode }) => <div className="rb-menu-pane">{children}</div>;
export const useCloseMenu = () => useContext(CloseCtx);

/** Case à cocher de ruban (groupe « Afficher » d'EdrawMax). */
export function RibbonCheck({ label, checked, onChange, title }: { label: string; checked: boolean; onChange(v: boolean): void; title?: string }) {
  return (
    <label className="rb-check-box" title={title ?? label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="rb-cb" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
