import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, RefreshCw, Pencil, Check, X, FolderKanban, BellPlus, UserPlus, AlertTriangle, ChevronDown, Sparkles } from 'lucide-react';
import {
  getQuickNote, reprocessDocument, editDocument, resolveDocumentConflict, decideDocumentProject, documentReminder,
} from '../../lib/api';
import { DOC_TYPES, DOC_FIELDS, money, niceDate, documentActions, saveContact } from '../../lib/documents';
import { noteRole, isOwner } from '../../lib/sharing';
import { NOTE_UPDATED } from '../../lib/opsQueue';
import { notifyQuickChanged } from '../../lib/uiBus';

const canEdit = note => !note.undone && ['owner', 'edit'].includes(noteRole(note));

function Toast({ text, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return createPortal(
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5rem))] z-[300] rounded-full bg-navy-900 text-white dark:bg-white dark:text-navy-900 text-sm font-medium px-4 py-2 shadow-xl animate-fade-in" role="status">{text}</div>,
    document.body,
  );
}

/** While the document is being read: check again every few seconds */
function usePendingPoll(note, onChanged) {
  const pending = note.document?.status === 'pending';
  useEffect(() => {
    if (!pending) return undefined;
    let tries = 0;
    const t = setInterval(async () => {
      if (++tries > 60) { clearInterval(t); return; }
      try {
        const fresh = await getQuickNote(note.id);
        if (fresh.document?.status !== 'pending') {
          clearInterval(t);
          onChanged?.(fresh);
          window.dispatchEvent(new CustomEvent(NOTE_UPDATED, { detail: fresh }));
        }
      } catch { /* next time */ }
    }, 2500);
    return () => clearInterval(t);
  }, [pending, note.id, onChanged]);
}

function shown(key, kind, v, f) {
  if (kind === 'money') return money(v, f.currency);
  if (kind === 'date') return niceDate(v);
  return v;
}

function FieldRow({ note, label, k, kind, value, fields, edit, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const start = () => {
    setDraft(kind === 'items' ? (value || []).map(i => [i.name, i.qty, i.price].join(' | ')).join('\n') : value || '');
    setEditing(true);
  };
  async function save() {
    let v = draft;
    if (kind === 'items') v = draft.split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p[0]).map(([name, qty, price]) => ({ name, qty: Number(qty) || 1, price: price || '' }));
    try { onSaved(await editDocument(note.id, { fields: { [k]: v } })); setEditing(false); }
    catch (err) { onError(err.response?.data?.error || 'Couldn’t save'); }
  }
  if (editing) {
    return (
      <div className="col-span-2 py-1">
        <span className="block text-[11px] font-semibold text-navy-500 dark:text-white/50 mb-0.5">{label}</span>
        <div className="flex gap-1.5 items-start">
          {kind === 'items' || kind === 'long'
            ? <textarea className="input-field text-sm flex-1 min-h-[5rem]" value={draft} onChange={e => setDraft(e.target.value)} aria-label={label} placeholder={kind === 'items' ? 'Name | qty | price (one per line)' : ''} autoFocus />
            : <input className="input-field !py-1.5 text-sm flex-1 min-w-0" type={kind === 'date' ? 'date' : kind === 'email' ? 'email' : kind === 'tel' ? 'tel' : 'text'} inputMode={kind === 'money' ? 'decimal' : undefined}
              value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }} aria-label={label} autoFocus />}
          <button className="btn-gold text-xs py-1.5 px-2.5" onClick={save} aria-label={`Save ${label}`}><Check size={14} /></button>
          <button className="btn-ghost text-xs py-1.5 px-2" onClick={() => setEditing(false)} aria-label="Cancel"><X size={14} /></button>
        </div>
      </div>
    );
  }
  if (kind === 'items') {
    return (
      <details className="col-span-2 py-0.5 group">
        <summary className="flex items-center gap-1 text-xs font-semibold text-navy-500 dark:text-white/50 cursor-pointer list-none">
          <ChevronDown size={12} className="group-open:rotate-180 transition-transform" /> {label} · {(value || []).length}
          {edit && <button type="button" className="ml-1 p-0.5" onClick={e => { e.preventDefault(); start(); }} aria-label={`Edit ${label}`}><Pencil size={11} /></button>}
        </summary>
        <ul className="mt-1 text-xs text-navy-700 dark:text-white/75 space-y-0.5">
          {(value || []).map((i, n) => <li key={n} className="flex gap-2"><span className="flex-1 min-w-0 truncate">{i.qty && i.qty !== 1 ? `${i.qty} × ` : ''}{i.name}</span><span>{i.price ? money(i.price, fields.currency) : ''}</span></li>)}
        </ul>
      </details>
    );
  }
  return (
    <>
      <dt className="text-xs text-navy-500 dark:text-white/50 py-0.5">{label}</dt>
      <dd className="text-sm text-navy-900 dark:text-white py-0.5 flex items-start gap-1 min-w-0">
        <span className="flex-1 min-w-0 break-words">{value ? shown(k, kind, value, fields) : <span className="text-navy-300 dark:text-white/30">—</span>}</span>
        {edit && <button type="button" className="p-0.5 text-navy-400 hover:text-gold-600 shrink-0" onClick={start} aria-label={`Edit ${label}`}><Pencil size={12} /></button>}
      </dd>
    </>
  );
}

/**
 * "Details" for photos, scans and PDFs: type, extracted fields (editable — never overwritten without asking),
 * project suggestion, reminders / Save to contacts, Reprocess. Above the AI summary.
 */
export default function DocumentCard({ note, onChanged }) {
  const doc = note.document;
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const seen = useRef(doc?.changedAt || null);
  usePendingPoll(note, onChanged);

  // Processing found something different after an edit / new page → "Details updated"
  useEffect(() => {
    if (doc?.changedAt && seen.current && doc.changedAt !== seen.current) setToast('Details updated');
    seen.current = doc?.changedAt || seen.current;
  }, [doc?.changedAt, doc?.status, note.attachmentsAt]);

  if (!doc || !doc.status || doc.status === 'off' || doc.status === 'empty') return null;
  const edit = canEdit(note);
  const apply = saved => { if (saved?.id) { onChanged?.(saved); window.dispatchEvent(new CustomEvent(NOTE_UPDATED, { detail: saved })); } };
  async function act(fn, done) {
    setError('');
    try {
      const r = await fn();
      if (r?.note && !r.id) notifyQuickChanged(r.note);   // a new note (the reminder)
      else apply(r);
      if (done) setToast(done);
      return r;
    }
    catch (err) { setError(err.response?.data?.error || 'That didn’t work'); return null; }
  }

  if (doc.status === 'pending') {
    return (
      <section className="mb-3 rounded-2xl border border-gold-400/40 bg-gold-500/5 px-3 py-2.5 text-sm text-navy-700 dark:text-white/75 flex items-center gap-2" aria-live="polite">
        <Loader2 size={15} className="animate-spin text-gold-500" /> Reading the document…
        {toast && <Toast text={toast} onDone={() => setToast(null)} />}
      </section>
    );
  }
  if (doc.status === 'failed' && !doc.type) {
    return (
      <section className="mb-3 rounded-2xl border border-amber-400/50 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
        <AlertTriangle size={15} /> <span className="flex-1">Couldn’t read the document.</span>
        {edit && <button className="btn-white text-xs py-1 px-2.5" onClick={() => act(() => reprocessDocument(note.id))}><RefreshCw size={12} /> Try again</button>}
      </section>
    );
  }

  const t = DOC_TYPES[doc.type] || DOC_TYPES.other;
  const f = doc.fields || {};
  const defs = DOC_FIELDS[doc.type] || [];
  const conflicts = Object.entries(doc.conflicts || {});
  const actions = documentActions(doc);
  const project = isOwner(note) ? doc.project : null;
  const label = k => (k === 'type' ? 'type' : (defs.find(d => d[0] === k)?.[1] || k).toLowerCase());

  return (
    <section className="mb-3 rounded-2xl border border-navy-100 dark:border-white/10 bg-white/60 dark:bg-white/[0.03] p-3" aria-label="Document details">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-lg leading-none" aria-hidden="true">{t.icon}</span>
        {edit ? (
          <select className="bg-transparent text-sm font-bold text-navy-900 dark:text-white outline-none cursor-pointer" value={doc.type} aria-label="Document type"
            onChange={e => act(() => editDocument(note.id, { type: e.target.value }))}>
            {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        ) : <span className="text-sm font-bold text-navy-900 dark:text-white">{t.label}</span>}
        <span className="badge badge-slate !text-[10px]">{doc.category || t.category}</span>
        <span className="flex-1" />
        {edit && (
          <button className="btn-ghost text-xs py-1 px-2" onClick={() => act(() => reprocessDocument(note.id))} title="Read the document again (your edits are kept)">
            <Sparkles size={12} /> Reprocess
          </button>
        )}
      </div>

      {doc.status === 'failed' && <p className="text-xs text-amber-700 dark:text-amber-300 mb-1.5">The last reading failed — showing the earlier details.</p>}

      {conflicts.length > 0 && edit && (
        <div className="mb-2 space-y-1.5">
          {conflicts.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-gold-500/10 px-2.5 py-2 text-xs text-navy-800 dark:text-white/85">
              <p>Found a different {label(k)}: <b>{k === 'type' ? DOC_TYPES[v]?.label : Array.isArray(v) ? `${v.length} items` : shown(k, defs.find(d => d[0] === k)?.[2], v, f)}</b> — you changed it, so it wasn’t replaced.</p>
              <div className="flex gap-1.5 mt-1">
                <button className="btn-gold text-xs py-1 px-2.5" onClick={() => act(() => resolveDocumentConflict(note.id, k, 'new'))}>Use it</button>
                <button className="btn-white text-xs py-1 px-2.5" onClick={() => act(() => resolveDocumentConflict(note.id, k, 'mine'))}>Keep mine</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {defs.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3">
          {defs.map(([k, l, kind]) => (
            (f[k] !== undefined || edit) && <FieldRow key={k} note={note} k={k} label={l} kind={kind} value={f[k]} fields={f} edit={edit} onSaved={apply} onError={setError} />
          ))}
        </dl>
      )}

      {project && project.status === 'applied' && (
        <p className="mt-2 text-xs text-navy-600 dark:text-white/65 flex items-center gap-1.5">
          <FolderKanban size={13} className="text-gold-500" /> Filed in <b>{project.name}</b>
          <button className="underline" onClick={() => act(() => decideDocumentProject(note.id, 'undo'), 'Removed from the project')}>Undo</button>
        </p>
      )}
      {project && project.status === 'ask' && (
        <div className="mt-2 rounded-xl bg-black/[0.03] dark:bg-white/5 px-2.5 py-2 text-xs text-navy-700 dark:text-white/75">
          <FolderKanban size={13} className="inline text-gold-500 mr-1" /> Add to project <b>{project.name}</b>?
          <span className="inline-flex gap-1.5 ml-2">
            <button className="btn-gold text-xs py-1 px-2.5" onClick={() => act(() => decideDocumentProject(note.id, 'yes'), `Added to ${project.name}`)}>Yes</button>
            <button className="btn-white text-xs py-1 px-2.5" onClick={() => act(() => decideDocumentProject(note.id, 'no'))}>No</button>
          </span>
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {actions.map(a => (
            <button key={a.label} className="btn-white text-xs py-1.5 px-3"
              onClick={() => (a.kind === 'contact'
                ? saveContact(f).catch(err => setError(err?.message || 'Couldn’t open Contacts'))
                : act(() => documentReminder(a.title, a.date, note.id), `Reminder set for ${niceDate(a.date)}`))}>
              {a.kind === 'contact' ? <UserPlus size={13} /> : <BellPlus size={13} />} {a.label}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-500 mt-1.5" role="alert">{error}</p>}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </section>
  );
}
