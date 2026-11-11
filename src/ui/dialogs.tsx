import React, { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'select' | 'date' | 'checkbox';
  value: any;
  options?: { value: string; label: string }[];
  min?: number;
  step?: number;
  required?: boolean;
  help?: string;
}
export interface DialogButton { label: string; value: string; primary?: boolean; danger?: boolean }
interface DialogReq {
  id: number;
  title: string;
  message?: React.ReactNode;
  fields?: Field[];
  buttons: DialogButton[];
  /** Contenu personnalisé (affiché après les champs) ; peut lire et modifier les valeurs. */
  render?: (values: Record<string, any>, set: (patch: Record<string, any>) => void) => React.ReactNode;
  /** Valeurs initiales supplémentaires (utilisées par `render`). */
  initial?: Record<string, any>;
  /** Désactive le bouton principal tant que la fonction renvoie un message. */
  invalid?: (values: Record<string, any>) => string | null;
  wide?: boolean;
  /** Fenêtre presque plein écran (aperçus de plan). */
  large?: boolean;
  resolve(r: { button: string; values: Record<string, any> }): void;
}

const useDialogStore = create<{ queue: DialogReq[] }>(() => ({ queue: [] }));
let seq = 1;

export function ask(req: Omit<DialogReq, 'id' | 'resolve'>): Promise<{ button: string; values: Record<string, any> }> {
  return new Promise((resolve) => {
    const r: DialogReq = { ...req, id: seq++, resolve };
    useDialogStore.setState((s) => ({ queue: [...s.queue, r] }));
  });
}

export async function confirmDialog(title: string, message: React.ReactNode, ok = 'Confirmer', danger = false): Promise<boolean> {
  const r = await ask({ title, message, buttons: [{ label: 'Annuler', value: 'cancel' }, { label: ok, value: 'ok', primary: !danger, danger }] });
  return r.button === 'ok';
}

export async function promptDialog(title: string, label: string, value = '', message?: React.ReactNode): Promise<string | null> {
  const r = await ask({
    title, message, fields: [{ key: 'v', label, type: 'text', value, required: true }],
    buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Valider', value: 'ok', primary: true }],
  });
  return r.button === 'ok' ? String(r.values.v).trim() : null;
}

export async function alertDialog(title: string, message: React.ReactNode): Promise<void> {
  await ask({ title, message, buttons: [{ label: 'OK', value: 'ok', primary: true }] });
}

export function DialogHost() {
  const queue = useDialogStore((s) => s.queue);
  const req = queue[0];
  if (!req) return null;
  return <DialogView key={req.id} req={req} />;
}

function DialogView({ req }: { req: DialogReq }) {
  const [values, setValues] = useState<Record<string, any>>(() => ({ ...req.initial, ...Object.fromEntries((req.fields ?? []).map((f) => [f.key, f.value])) }));
  const firstRef = useRef<HTMLElement | null>(null);
  useEffect(() => { setTimeout(() => (firstRef.current as any)?.focus?.(), 30); }, []);

  const close = (button: string) => {
    useDialogStore.setState((s) => ({ queue: s.queue.slice(1) }));
    req.resolve({ button, values });
  };
  const primary = req.buttons.find((b) => b.primary) ?? req.buttons[req.buttons.length - 1];
  const missing = (req.fields ?? []).some((f) => f.required && String(values[f.key] ?? '').trim() === '') || !!req.invalid?.(values);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!missing) close(primary.value);
  };

  return (
    <div className="modal-backdrop" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close('cancel'); } }}>
      <form className={req.large ? 'modal wide large' : req.wide ? 'modal wide' : 'modal'} onSubmit={submit} role="dialog" aria-modal="true" aria-label={req.title}>
        <h2>{req.title}</h2>
        {req.message && <div className="modal-msg">{req.message}</div>}
        {(req.fields ?? []).map((f, i) => (
          <label key={f.key} className={f.type === 'checkbox' ? 'field check' : 'field'}>
            {f.type !== 'checkbox' && <span>{f.label}</span>}
            {f.type === 'textarea' ? (
              <textarea ref={i === 0 ? (r) => { firstRef.current = r; } : undefined} rows={6} value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
            ) : f.type === 'select' ? (
              <select ref={i === 0 ? (r) => { firstRef.current = r; } : undefined} value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <><input type="checkbox" checked={!!values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} /> <span>{f.label}</span></>
            ) : (
              <input ref={i === 0 ? (r) => { firstRef.current = r; } : undefined} type={f.type} value={values[f.key]} min={f.min} step={f.step ?? 'any'}
                onChange={(e) => setValues({ ...values, [f.key]: f.type === 'number' ? e.target.value : e.target.value })} />
            )}
            {f.help && <small>{f.help}</small>}
          </label>
        ))}
        {req.render?.(values, (patch) => setValues((v) => ({ ...v, ...patch })))}
        <div className="modal-actions">
          {req.buttons.map((b) => (
            <button key={b.value} type={b === primary ? 'submit' : 'button'} disabled={b === primary && missing}
              className={b.danger ? 'btn danger' : b.primary ? 'btn primary' : 'btn'}
              onClick={b === primary ? undefined : () => close(b.value)}>{b.label}</button>
          ))}
        </div>
      </form>
    </div>
  );
}
