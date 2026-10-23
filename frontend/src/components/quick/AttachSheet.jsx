import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, X, Images, Camera, ScanLine, FolderOpen, ScanText, Loader2, AlertTriangle } from 'lucide-react';
import { isNative } from '../../lib/platform';
import { pickNativePhoto } from '../../native/camera';
import { attachToNote, pickFiles, scanPagesInto, readPref, setReadPref, MAX_BYTES } from '../../lib/attachments';
import { NOTE_UPDATED } from '../../lib/opsQueue';

const touchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

/**
 * "Attach" on a note: Photo library, Camera, Scan document (app: Google ML Kit, on-device), Files (any type).
 * Up to 25 MB each. Optional: read the text of photos and scans with AI so they're searchable.
 */
export default function AttachSheet({ note, onClose, onChanged }) {
  const [read, setRead] = useState(readPref);
  const [busy, setBusy] = useState(null);       // { index, total, name, percent }
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, busy]);

  async function upload(items) {
    if (!items.length) return;
    setErrors([]);
    setMessage('');
    const tooBig = items.filter(i => i.file.size > MAX_BYTES);
    const ok = items.filter(i => i.file.size <= MAX_BYTES);
    setBusy({ index: 0, total: ok.length, name: ok[0]?.file.name, percent: 0 });
    const { note: saved, errors: failed } = await attachToNote(note.id, ok, {
      read,
      onProgress: p => setBusy({ ...p, total: ok.length }),
    });
    setBusy(null);
    const all = [...tooBig.map(i => ({ name: i.file.name, error: 'Over 25 MB' })), ...failed];
    if (saved) onChanged?.(saved);
    if (all.length) setErrors(all);
    else onClose();
  }

  async function choose(kind) {
    try {
      if (kind === 'photos') {
        const files = await pickFiles({ accept: 'image/*', multiple: true });
        return upload(files.map(file => ({ file, source: 'photos' })));
      }
      if (kind === 'camera') {
        if (isNative) {
          const blob = await pickNativePhoto('camera', () => Promise.resolve(true));
          if (!blob) return null;
          const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
          return upload([{ file: new File([blob], `Photo ${stamp}.jpg`, { type: blob.type || 'image/jpeg' }), source: 'camera' }]);
        }
        const files = await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' });
        return upload(files.map(file => ({ file, source: 'camera' })));
      }
      if (kind === 'scan') {
        // The app's scanner uploads the page images itself (a scan with pages you can edit, not a flat PDF)
        setMessage('Opening the scanner…');
        const saved = await scanPagesInto(note.id);
        setMessage('');
        if (saved?.id) { onChanged?.(saved); window.dispatchEvent(new CustomEvent(NOTE_UPDATED, { detail: saved })); onClose(); }
        return null;
      }
      const files = await pickFiles({ multiple: true });
      return upload(files.map(file => ({ file, source: 'file' })));
    } catch (err) {
      setMessage('');
      if (/cancel/i.test(err?.message || '')) return null;
      setErrors([{ name: kind === 'scan' ? 'Scanner' : kind === 'camera' ? 'Camera' : 'Files', error: err?.message || 'Something went wrong' }]);
      return null;
    }
  }

  const options = [
    { key: 'photos', icon: Images, label: 'Photo library', hint: 'One or more photos' },
    (isNative || touchDevice) && { key: 'camera', icon: Camera, label: 'Camera', hint: 'Take a photo' },
    isNative && { key: 'scan', icon: ScanLine, label: 'Scan document', hint: 'Auto-crop, several pages → PDF' },
    { key: 'files', icon: FolderOpen, label: 'Files', hint: 'PDF, Word, Excel, audio, any file' },
  ].filter(Boolean);

  return createPortal(
    <div className="fixed inset-0 z-[230] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !busy && onClose()} role="dialog" aria-modal="true" aria-labelledby="attach-title" data-no-swipe>
      <div className="glass-panel w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 rounded-b-none sm:rounded-b-2xl animate-slide-up pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 id="attach-title" className="font-bold text-navy-900 dark:text-white flex items-center gap-2 min-w-0">
            <Paperclip size={18} className="text-gold-500 shrink-0" /> <span className="truncate">Attach to “{note.title || 'this note'}”</span>
          </h2>
          <button className="w-10 h-10 -mt-2 -mr-2 rounded-xl flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10" onClick={onClose} disabled={!!busy} aria-label="Close">
            <X size={18} className="text-navy-600 dark:text-white/60" />
          </button>
        </div>

        {busy ? (
          <div className="py-4" aria-live="polite">
            <p className="text-sm text-navy-700 dark:text-white/75 truncate mb-2">
              <Loader2 size={14} className="inline animate-spin mr-1.5" />
              {busy.total > 1 ? `${busy.index + 1} of ${busy.total} · ` : ''}{busy.name}
            </p>
            <div className="h-2 rounded-full bg-navy-100 dark:bg-white/10 overflow-hidden">
              <div className="h-full bg-gold-500 transition-all" style={{ width: `${busy.percent || 0}%` }} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {options.map(o => (
              <button key={o.key} className="flex flex-col items-start gap-1 rounded-2xl border border-navy-100 dark:border-white/10 p-3 text-left hover:bg-black/[0.03] dark:hover:bg-white/5 min-h-[84px]" onClick={() => choose(o.key)}>
                <o.icon size={20} className="text-gold-500" />
                <span className="text-sm font-semibold text-navy-900 dark:text-white">{o.label}</span>
                <span className="text-[11px] leading-tight text-navy-500 dark:text-white/50">{o.hint}</span>
              </button>
            ))}
          </div>
        )}

        {message && <p className="text-xs text-navy-500 dark:text-white/55 mt-3">{message}</p>}
        {errors.length > 0 && (
          <div className="mt-3 rounded-xl bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-300" role="alert">
            {errors.map((e, i) => <p key={i} className="flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-px" /> <span className="break-all"><b>{e.name}</b>: {e.error}</span></p>)}
          </div>
        )}

        <label className="flex items-start gap-2.5 mt-4 text-sm text-navy-700 dark:text-white/75 cursor-pointer">
          <input type="checkbox" className="accent-amber-500 w-4 h-4 mt-0.5" checked={read} onChange={e => { setRead(e.target.checked); setReadPref(e.target.checked); }} />
          <span>
            <span className="flex items-center gap-1 font-medium"><ScanText size={14} className="text-gold-500" /> Read text with AI</span>
            <span className="block text-xs text-navy-500 dark:text-white/50">Photos and PDFs become searchable. Up to 25 MB per file.</span>
          </span>
        </label>
      </div>
    </div>,
    document.body,
  );
}
