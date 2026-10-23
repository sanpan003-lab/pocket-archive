import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, GripVertical, Pencil, Camera, ScanLine, Trash2, Star, Undo2, Scissors, Merge, Plus, Loader2, ChevronUp, ChevronDown, FileText, Images,
} from 'lucide-react';
import {
  attachmentFileUrl, attachmentThumbUrl, pageUrl, pageThumbUrl, replaceAttachmentImage, restoreAttachment, orderAttachments,
  mergeScans, splitScan, setNoteCover, adoptNoteMedia, addScanPages, orderScanPages, replaceScanPage, restoreScanPage,
  deleteScanPage, deleteNoteAttachment,
} from '../../lib/api';
import { browserImage, imageThumb, pickFiles } from '../../lib/attachments';
import { isNative } from '../../lib/platform';
import { pickNativePhoto } from '../../native/camera';
import { QuickRecorder } from '../../native/quickRecorder';
import { NOTE_UPDATED } from '../../lib/opsQueue';
import ImageEditor from './ImageEditor';

const editableImage = a => a.kind === 'image' && /^image\/(jpeg|png|webp)$/.test(a.mime || '');
const scanOf = a => (a.pageList?.length ? a : null);

/** Drag to reorder (mouse, touch, pen): the item under the pointer takes the dragged item's place */
function useSortable(ids, onCommit) {
  const [order, setOrder] = useState(ids);
  const [dragId, setDragId] = useState(null);
  const els = useRef(new Map());
  const key = ids.join(',');
  const [seen, setSeen] = useState(key);
  if (seen !== key && !dragId) { setSeen(key); setOrder(ids); }
  const handle = id => ({
    onPointerDown: e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); setDragId(id); },
    style: { touchAction: 'none', cursor: 'grab' },
  });
  const container = {
    onPointerMove: e => {
      if (!dragId) return;
      let target = null;
      for (const [id, el] of els.current) {
        const r = el?.getBoundingClientRect();
        if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { target = id; break; }
      }
      if (!target || target === dragId) return;
      setOrder(list => {
        const from = list.indexOf(dragId);
        const to = list.indexOf(target);
        const next = [...list];
        next.splice(from, 1);
        next.splice(to, 0, dragId);
        return next;
      });
    },
    onPointerUp: () => { if (dragId) { setDragId(null); if (order.join(',') !== key) onCommit(order); } },
    onPointerCancel: () => { setDragId(null); setOrder(ids); },
  };
  const ref = id => el => { if (el) els.current.set(id, el); else els.current.delete(id); };
  const move = (id, delta) => {
    const i = order.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    onCommit(next);
  };
  return { order, dragId, handle, container, ref, move };
}

function Btn({ icon: Icon, label, onClick, danger, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30 ${danger ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10' : 'text-navy-600 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/10'}`}>
      <Icon size={16} />
    </button>
  );
}

/** Scan pages: drag to reorder, edit / retake / restore / cover / delete each page, split between pages */
function ScanPages({ note, att, run, onEdit, onRetake, coverId }) {
  const ids = att.pageList.map(p => p.id);
  const s = useSortable(ids, next => run('Reordering pages…', () => orderScanPages(note.id, att.id, next)));
  const byId = Object.fromEntries(att.pageList.map(p => [p.id, p]));
  return (
    <ol className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2" {...s.container} aria-label={`Pages of ${att.name}`}>
      {s.order.map((pid, i) => {
        const p = byId[pid];
        if (!p) return null;
        const cover = coverId === `${att.id}/${p.id}`;
        return (
          <li key={pid} ref={s.ref(pid)} className={`rounded-xl border bg-white/70 dark:bg-white/5 overflow-hidden ${s.dragId === pid ? 'border-gold-400 opacity-70' : 'border-navy-100 dark:border-white/10'}`}>
            <div className="relative aspect-[3/4] bg-black/5" {...s.handle(pid)} aria-label={`Page ${i + 1}, drag to move`}>
              <img src={p.thumb ? pageThumbUrl(note.id, att.id, p.id, p.version) : pageUrl(note.id, att.id, p.id, p.version)} alt={`Page ${i + 1}`} className="w-full h-full object-cover pointer-events-none" draggable={false} />
              <span className="absolute top-1 left-1 rounded-md bg-black/60 text-white text-[10px] px-1.5">{i + 1}</span>
              {cover && <Star size={14} className="absolute top-1 right-1 text-gold-400 fill-current" aria-label="Cover" />}
              {p.original && <span className="absolute bottom-1 left-1 rounded-md bg-gold-500 text-white text-[9px] px-1">Edited</span>}
            </div>
            <div className="flex flex-wrap justify-center">
              <Btn icon={Pencil} label={`Edit page ${i + 1} (rotate, crop, mark up)`} onClick={() => onEdit({ att, page: p, index: i })} />
              <Btn icon={isNative ? ScanLine : Camera} label={`Retake page ${i + 1}`} onClick={() => onRetake({ att, page: p })} />
              {p.original && <Btn icon={Undo2} label={`Restore page ${i + 1} as scanned`} onClick={() => run('Restoring…', () => restoreScanPage(note.id, att.id, p.id))} />}
              {!cover && <Btn icon={Star} label={`Use page ${i + 1} as cover`} onClick={() => run('Setting cover…', () => setNoteCover(note.id, att.id, p.id))} />}
              {i > 0 && <Btn icon={Scissors} label={`Split before page ${i + 1}`} onClick={() => window.confirm(`Split “${att.name}” into two scans before page ${i + 1}?`) && run('Splitting…', () => splitScan(note.id, att.id, i))} />}
              <Btn icon={Trash2} label={`Delete page ${i + 1}`} danger onClick={() => window.confirm(att.pageList.length === 1 ? 'Delete the last page (and the scan)?' : `Delete page ${i + 1}?`) && run('Deleting…', () => deleteScanPage(note.id, att.id, p.id))} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Pages & photos of a note: reorder (drag or ↑/↓), edit (rotate, crop, markup), retake, restore original,
 * cover, delete; scans: add pages, reorder/split pages, merge with the next scan. Every change re-reads the
 * document (Details) on the server.
 */
export default function PagesEditor({ note: initial, onClose, onChanged }) {
  const [note, setNote] = useState(initial);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);   // { att, page?, index? }

  // An older photo note (note.media): make it an editable attachment first
  useEffect(() => {
    if (initial.media?.kind === 'image' && !(initial.attachments || []).some(a => a.kind === 'image')) {
      adoptNoteMedia(initial.id).then(n => { setNote(n); onChanged?.(n); }).catch(err => setError(err.response?.data?.error || 'Couldn’t open this photo for editing'));
    }
  }, [initial, onChanged]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !editing && !busy) { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, editing, busy]);

  async function run(label, fn) {
    setBusy(label);
    setError('');
    try {
      const saved = await fn();
      if (saved?.id) {
        setNote(saved);
        onChanged?.(saved);
        window.dispatchEvent(new CustomEvent(NOTE_UPDATED, { detail: saved }));
      }
    } catch (err) {
      if (!/cancel/i.test(err?.message || '')) setError(err.response?.data?.error || err.message || 'That didn’t work');
    } finally { setBusy(''); }
  }

  const list = note.attachments || [];
  const items = list.filter(a => browserImage(a) || scanOf(a) || a.kind === 'pdf');
  const top = useSortable(list.map(a => a.id), next => run('Reordering…', () => orderAttachments(note.id, next)));
  const byId = Object.fromEntries(list.map(a => [a.id, a]));

  // App only: the ML Kit scanner uploads the pages itself and returns the note
  const scanInto = (path, method, partName, pageLimit) => QuickRecorder.scanUpload({ path, method, partName, pageLimit });

  async function retake({ att, page }) {
    if (page) {
      if (isNative) return run('Scanning…', () => scanInto(`/api/quick/${note.id}/attachments/${att.id}/pages/${page.id}/content`, 'PUT', 'file', 1));
      const [file] = await pickFiles({ accept: 'image/jpeg,image/png', multiple: false, capture: 'environment' });
      if (!file) return null;
      return run('Uploading…', async () => replaceScanPage(note.id, att.id, page.id, file, await imageThumb(file)));
    }
    let blob;
    if (isNative) blob = await pickNativePhoto('camera', () => Promise.resolve(true)).catch(err => { setError(err.message); return null; });
    else [blob] = await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' });
    if (!blob) return null;
    return run('Uploading…', async () => replaceAttachmentImage(note.id, att.id, blob, await imageThumb(blob)));
  }

  async function addPages(att) {
    if (isNative) return run('Scanning…', () => scanInto(`/api/quick/${note.id}/attachments/${att.id}/pages`, 'POST', 'page', 30));
    const files = await pickFiles({ accept: 'image/jpeg,image/png', multiple: true });
    if (!files.length) return null;
    return run('Adding pages…', async () => addScanPages(note.id, att.id, files, await Promise.all(files.map(f => imageThumb(f)))));
  }

  async function saveEdit(blob, thumb) {
    const { att, page } = editing;
    if (page) await run('Saving…', () => replaceScanPage(note.id, att.id, page.id, blob, thumb));
    else await run('Saving…', () => replaceAttachmentImage(note.id, att.id, blob, thumb));
    setEditing(null);
  }

  return createPortal(
    <>
    <div className="fixed inset-0 z-[235] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !busy && onClose()} role="dialog" aria-modal="true" aria-labelledby="pages-title" data-no-swipe>
      <div className="glass-panel w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-5 rounded-b-none sm:rounded-b-2xl animate-slide-up pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 id="pages-title" className="font-bold text-navy-900 dark:text-white flex items-center gap-2"><Images size={18} className="text-gold-500" /> Pages &amp; photos</h2>
          <button className="w-10 h-10 -mt-2 -mr-2 rounded-xl flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10" onClick={onClose} disabled={!!busy} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="text-xs text-navy-500 dark:text-white/50 mb-3">Drag to reorder. Edits keep the original — you can restore it. The details are read again after changes.</p>
        {busy && <p className="text-xs text-gold-700 dark:text-gold-300 mb-2 flex items-center gap-1.5" role="status"><Loader2 size={13} className="animate-spin" /> {busy}</p>}
        {error && <p className="text-xs text-red-600 dark:text-red-400 mb-2" role="alert">{error}</p>}
        {!items.length && <p className="text-sm text-navy-500 dark:text-white/50">No photos or scans yet — use Attach to add some.</p>}

        <ul className="space-y-2.5" {...top.container}>
          {top.order.map((aid, idx) => {
            const att = byId[aid];
            if (!att || !items.includes(att)) return null;
            const scan = scanOf(att);
            const nextScan = scan && top.order.slice(idx + 1).map(i => byId[i]).find(a => a && items.includes(a));
            const cover = note.coverId === att.id;
            return (
              <li key={aid} ref={top.ref(aid)} className={`rounded-2xl border p-2.5 ${top.dragId === aid ? 'border-gold-400 bg-gold-500/5' : 'border-navy-100 dark:border-white/10'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-navy-400 dark:text-white/40 p-1" {...top.handle(aid)} aria-label={`Drag ${att.name}`}><GripVertical size={16} /></span>
                  {scan || att.kind === 'pdf'
                    ? <FileText size={18} className="text-red-500 shrink-0" />
                    : <img src={att.thumb ? attachmentThumbUrl(note.id, att.id, att.version) : attachmentFileUrl(note.id, att.id, att.version)} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 border border-navy-100 dark:border-white/10" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-navy-900 dark:text-white truncate">{att.name}</span>
                    <span className="block text-[11px] text-navy-500 dark:text-white/50">
                      {scan ? `Scan · ${att.pageList.length} page${att.pageList.length > 1 ? 's' : ''}` : att.kind === 'pdf' ? 'PDF' : 'Photo'}
                      {att.original ? ' · edited' : ''}{cover ? ' · cover' : ''}
                    </span>
                  </span>
                  <Btn icon={ChevronUp} label={`Move ${att.name} up`} onClick={() => top.move(aid, -1)} disabled={idx === 0} />
                  <Btn icon={ChevronDown} label={`Move ${att.name} down`} onClick={() => top.move(aid, 1)} disabled={idx === top.order.length - 1} />
                </div>
                {!scan && att.kind === 'image' && (
                  <div className="flex flex-wrap gap-0.5 mt-1.5 pl-8">
                    {editableImage(att) && <Btn icon={Pencil} label={`Edit ${att.name} (rotate, crop, mark up)`} onClick={() => setEditing({ att })} />}
                    <Btn icon={Camera} label={`Retake ${att.name}`} onClick={() => retake({ att })} />
                    {att.original && <Btn icon={Undo2} label={`Restore the original of ${att.name}`} onClick={() => run('Restoring…', () => restoreAttachment(note.id, att.id))} />}
                    {!cover && <Btn icon={Star} label={`Use ${att.name} as cover`} onClick={() => run('Setting cover…', () => setNoteCover(note.id, att.id))} />}
                    <Btn icon={Trash2} label={`Delete ${att.name}`} danger onClick={() => window.confirm(`Delete “${att.name}”?`) && run('Deleting…', () => deleteNoteAttachment(note.id, att.id))} />
                  </div>
                )}
                {scan && (
                  <>
                    <div className="flex flex-wrap gap-1.5 mt-1.5 pl-8">
                      <button type="button" className="btn-white text-xs py-1.5 px-2.5" onClick={() => addPages(att)}><Plus size={13} /> {isNative ? 'Scan more pages' : 'Add pages'}</button>
                      {nextScan?.pageList?.length && (
                        <button type="button" className="btn-white text-xs py-1.5 px-2.5" onClick={() => run('Merging…', () => mergeScans(note.id, [att.id, nextScan.id]))}><Merge size={13} /> Merge with “{nextScan.name}”</button>
                      )}
                      <button type="button" className="btn-ghost text-xs py-1.5 px-2.5 text-red-600 dark:text-red-400" onClick={() => window.confirm(`Delete the whole scan “${att.name}”?`) && run('Deleting…', () => deleteNoteAttachment(note.id, att.id))}><Trash2 size={13} /> Delete scan</button>
                    </div>
                    <ScanPages note={note} att={att} run={run} onEdit={setEditing} onRetake={retake} coverId={note.coverId} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
      {editing && (
        <ImageEditor
          src={editing.page ? pageUrl(note.id, editing.att.id, editing.page.id, editing.page.version) : attachmentFileUrl(note.id, editing.att.id, editing.att.version)}
          title={editing.page ? `${editing.att.name} · page ${editing.index + 1}` : editing.att.name}
          onCancel={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}
    </>,
    document.body,
  );
}
