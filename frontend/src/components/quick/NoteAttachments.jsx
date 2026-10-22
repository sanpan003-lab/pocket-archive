import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Paperclip, MoreVertical, Pencil, Trash2, ScanText, Download, X, ChevronLeft, ChevronRight, Loader2, ExternalLink, ChevronDown,
} from 'lucide-react';
import {
  attachmentFileUrl, attachmentThumbUrl, attachmentDownloadUrl, renameNoteAttachment, deleteNoteAttachment, readNoteAttachment, getQuickNote,
} from '../../lib/api';
import { KIND_ICON, KIND_COLOR, formatSize, browserImage, openAttachment } from '../../lib/attachments';
import { noteRole } from '../../lib/sharing';
import { NOTE_UPDATED } from '../../lib/opsQueue';
import { isNative } from '../../lib/platform';

const canEdit = note => !note.undone && ['owner', 'edit'].includes(noteRole(note));
const readable = att => att.kind === 'image' || att.kind === 'pdf';

/** While text is being read (AI), check the note again every few seconds */
function useReadingPoll(note, onChanged) {
  const reading = (note.attachments || []).some(a => a.textStatus === 'reading');
  useEffect(() => {
    if (!reading) return undefined;
    let tries = 0;
    const t = setInterval(async () => {
      if (++tries > 40) { clearInterval(t); return; }
      try {
        const fresh = await getQuickNote(note.id);
        if (!(fresh.attachments || []).some(a => a.textStatus === 'reading')) {
          onChanged?.(fresh);
          window.dispatchEvent(new CustomEvent(NOTE_UPDATED, { detail: fresh }));
          clearInterval(t);
        }
      } catch { /* try again */ }
    }, 3000);
    return () => clearInterval(t);
  }, [reading, note.id, onChanged]);
}

function Menu({ note, att, onChanged, onRename, onError }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const edit = canEdit(note);
  async function run(fn) {
    setOpen(false);
    try {
      const saved = await fn();
      if (saved?.id) { onChanged?.(saved); window.dispatchEvent(new CustomEvent(NOTE_UPDATED, { detail: saved })); }
    } catch (err) { onError(err.response?.data?.error || 'That didn’t work'); }
  }
  return (
    <div className="relative shrink-0" ref={ref}>
      <button className="w-9 h-9 rounded-xl flex items-center justify-center text-navy-500 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10" onClick={e => { e.stopPropagation(); setOpen(o => !o); }} aria-label={`More for ${att.name}`} aria-expanded={open}>
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-48 rounded-xl glass-panel shadow-xl py-1 text-sm" role="menu">
          {edit && <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10 text-left" onClick={() => { setOpen(false); onRename(); }}><Pencil size={14} /> Rename</button>}
          {edit && readable(att) && att.textStatus !== 'reading' && (
            <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10 text-left" onClick={() => run(() => readNoteAttachment(note.id, att.id))}><ScanText size={14} /> {att.text ? 'Read text again' : 'Read text (AI)'}</button>
          )}
          {!isNative && <a role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10" href={attachmentDownloadUrl(note.id, att.id)} onClick={() => setOpen(false)}><Download size={14} /> Download</a>}
          {edit && (
            <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10 text-left text-red-600 dark:text-red-400"
              onClick={() => window.confirm(`Delete “${att.name}”? This can’t be undone.`) ? run(() => deleteNoteAttachment(note.id, att.id)) : setOpen(false)}>
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RenameField({ note, att, onDone, onChanged, onError }) {
  const [value, setValue] = useState(att.name);
  const [saving, setSaving] = useState(false);
  const input = useRef(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    const dot = att.name.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : att.name.length);
  }, [att.name]);
  async function save() {
    const name = value.trim();
    if (!name || name === att.name) { onDone(); return; }
    setSaving(true);
    try {
      const saved = await renameNoteAttachment(note.id, att.id, name);
      onChanged?.(saved);
      window.dispatchEvent(new CustomEvent(NOTE_UPDATED, { detail: saved }));
      onDone();
    } catch (err) { onError(err.response?.data?.error || 'Couldn’t rename it'); setSaving(false); }
  }
  return (
    <form className="flex-1 min-w-0 flex gap-1.5" onSubmit={e => { e.preventDefault(); save(); }} onClick={e => e.stopPropagation()}>
      <input ref={input} className="input-field !py-1.5 text-sm flex-1 min-w-0" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onDone(); } }} aria-label="New name" maxLength={120} />
      <button className="btn-gold text-xs py-1.5 px-3" disabled={saving}>{saving ? '…' : 'Save'}</button>
    </form>
  );
}

function TextToggle({ att }) {
  const [open, setOpen] = useState(false);
  if (att.textStatus === 'reading') return <p className="text-[11px] text-gold-600 dark:text-gold-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Reading text…</p>;
  if (att.textStatus === 'failed' && !att.text) return <p className="text-[11px] text-amber-700 dark:text-amber-300">Couldn’t read the text</p>;
  if (!att.text) return null;
  return (
    <div onClick={e => e.stopPropagation()}>
      <button className="text-[11px] font-semibold text-navy-500 dark:text-white/55 flex items-center gap-1" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <ScanText size={11} /> Text <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="mt-1 text-xs text-navy-700 dark:text-white/75 whitespace-pre-line break-words max-h-60 overflow-y-auto">{att.text}</p>}
    </div>
  );
}

/** Full-screen photo viewer (swipe / arrows between the note's photos) */
function Viewer({ note, images, start, onClose }) {
  const [i, setI] = useState(start);
  const touch = useRef(null);
  const att = images[i];
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'ArrowLeft') { e.stopPropagation(); setI(x => Math.max(0, x - 1)); }
      if (e.key === 'ArrowRight') { e.stopPropagation(); setI(x => Math.min(images.length - 1, x + 1)); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [images.length, onClose]);
  if (!att) return null;
  return createPortal(
    <div className="fixed inset-0 z-[260] bg-black flex flex-col" role="dialog" aria-modal="true" aria-label={att.name} data-no-swipe
      onTouchStart={e => { touch.current = e.touches.length === 1 ? e.touches[0].clientX : null; }}
      onTouchEnd={e => {
        if (touch.current == null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (dx < -60) setI(x => Math.min(images.length - 1, x + 1));
        if (dx > 60) setI(x => Math.max(0, x - 1));
      }}>
      <div className="flex items-center gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-white">
        <p className="flex-1 min-w-0 truncate text-sm">{att.name}{images.length > 1 ? ` · ${i + 1}/${images.length}` : ''}</p>
        <button className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white/10" onClick={() => openAttachment(note, att)} aria-label="Open in another app"><ExternalLink size={18} /></button>
        <button className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white/10" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center relative overflow-auto" style={{ touchAction: 'pinch-zoom' }}>
        <img src={attachmentFileUrl(note.id, att.id)} alt={att.name} className="max-w-full max-h-full object-contain" />
        {i > 0 && <button className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center" onClick={() => setI(i - 1)} aria-label="Previous photo"><ChevronLeft size={22} /></button>}
        {i < images.length - 1 && <button className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center" onClick={() => setI(i + 1)} aria-label="Next photo"><ChevronRight size={22} /></button>}
      </div>
    </div>,
    document.body,
  );
}

/** A note's attachments: photo thumbnails, file cards (tap to open), audio players; rename / delete / read text */
export default function NoteAttachments({ note, onChanged }) {
  const [viewing, setViewing] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [error, setError] = useState('');
  useReadingPoll(note, onChanged);
  const list = note.attachments || [];
  if (!list.length) return null;
  const images = list.filter(browserImage);
  const files = list.filter(a => !browserImage(a));

  async function open(att) {
    setError('');
    const err = await openAttachment(note, att);
    if (err) setError(err);
  }

  return (
    <section className="mb-3" aria-label="Attachments" data-no-swipe>
      <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mb-1.5"><Paperclip size={11} /> Attachments · {list.length}</p>
      {images.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 mb-2">
          {images.map((att, k) => (
            <div key={att.id} className="relative group">
              <button className="block w-full aspect-square rounded-xl overflow-hidden bg-black/5 dark:bg-white/5 border border-navy-100 dark:border-white/10" onClick={() => setViewing(k)} aria-label={`Open ${att.name}`}>
                <img src={att.thumb ? attachmentThumbUrl(note.id, att.id) : attachmentFileUrl(note.id, att.id)} alt={att.name} loading="lazy" className="w-full h-full object-cover" />
              </button>
              <div className="absolute top-0.5 right-0.5 rounded-xl bg-white/80 dark:bg-black/50">
                <Menu note={note} att={att} onChanged={onChanged} onRename={() => setRenaming(att.id)} onError={setError} />
              </div>
              {att.textStatus === 'reading' && <span className="absolute bottom-1 left-1 rounded-md bg-black/60 text-white text-[10px] px-1.5 py-0.5 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Reading</span>}
              {renaming === att.id && (
                <div className="absolute inset-x-0 -bottom-11 z-10 glass-panel rounded-xl p-1.5 flex"><RenameField note={note} att={att} onDone={() => setRenaming(null)} onChanged={onChanged} onError={setError} /></div>
              )}
            </div>
          ))}
        </div>
      )}
      {images.some(a => a.text) && (
        <div className="mb-2 space-y-1">{images.filter(a => a.text || a.textStatus).map(a => <div key={a.id} className="text-xs"><span className="text-navy-500 dark:text-white/50">{a.name}</span> <TextToggle att={a} /></div>)}</div>
      )}
      <div className="space-y-1.5">
        {files.map(att => {
          const Icon = KIND_ICON[att.source === 'scan' ? 'scan' : att.kind] || KIND_ICON.other;
          return (
            <div key={att.id} className="rounded-2xl border border-navy-100 dark:border-white/10 bg-white/60 dark:bg-white/[0.03]">
              <div className="flex items-center gap-2.5 p-2 pl-2.5">
                {att.thumb
                  ? <img src={attachmentThumbUrl(note.id, att.id)} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0 border border-navy-100 dark:border-white/10" loading="lazy" />
                  : <span className="w-11 h-11 rounded-lg bg-navy-50 dark:bg-white/5 flex items-center justify-center shrink-0"><Icon size={20} className={KIND_COLOR[att.kind] || KIND_COLOR.other} /></span>}
                {renaming === att.id ? (
                  <RenameField note={note} att={att} onDone={() => setRenaming(null)} onChanged={onChanged} onError={setError} />
                ) : (
                  <button className="flex-1 min-w-0 text-left" onClick={() => open(att)}>
                    <span className="block text-sm font-medium text-navy-900 dark:text-white truncate">{att.name}</span>
                    <span className="block text-[11px] text-navy-500 dark:text-white/50">
                      {[att.source === 'scan' ? 'Scan' : (att.ext || att.kind).toUpperCase(), att.pages ? `${att.pages} page${att.pages > 1 ? 's' : ''}` : null, formatSize(att.size)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                )}
                {renaming !== att.id && <Menu note={note} att={att} onChanged={onChanged} onRename={() => setRenaming(att.id)} onError={setError} />}
              </div>
              {att.kind === 'audio' && <audio controls preload="none" src={attachmentFileUrl(note.id, att.id)} className="w-full h-9 px-2 pb-2" />}
              {(att.text || att.textStatus) && <div className="px-3 pb-2"><TextToggle att={att} /></div>}
            </div>
          );
        })}
      </div>
      {error && <p className="text-xs text-red-500 mt-1.5" role="alert">{error}</p>}
      {viewing != null && <Viewer note={note} images={images} start={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
