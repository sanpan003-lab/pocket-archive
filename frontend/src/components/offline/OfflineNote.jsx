import { useState } from 'react';
import { CloudOff, Sparkles, AlertTriangle, Download, Loader2 } from 'lucide-react';
import { useOfflineStatus } from '../../lib/offline/status';
import { offlineStore } from '../../lib/offline/native';
import { updateQuickNote } from '../../lib/api';
import { notifyQuickChanged } from '../../lib/uiBus';

const WHAT = { organize: 'Sorting it into a note, list or reminder', read: 'Reading the photo or document', summary: 'The AI summary', handwriting: 'Turning handwriting into text', combine: 'Combining the notes' };

/** Small badge on cards: changed here, waiting to be sent / processed */
export function OfflineBadge({ note }) {
  if (!note?.offline && !note?.offlineEdited && !note?._conflict) return null;
  if (note._conflict) return <span className="badge badge-orange"><AlertTriangle size={11} /> Edited on 2 devices</span>;
  return <span className="badge badge-slate" title="Saved on this phone — sends when you’re back online"><CloudOff size={11} /> Waiting</span>;
}

/**
 * In an open note: "Edited on another device — keep mine / keep theirs / keep both", what waits for the server, and
 * "Keep offline" (when Settings → Offline keeps less than everything).
 */
export function OfflineNoteBanner({ note, onChanged }) {
  const st = useOfflineStatus();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  if (!st.available || !note) return null;
  const pending = note.offline?.pending || [];
  const conflict = note._conflict;

  async function resolve(choice) {
    setBusy(choice); setError('');
    try {
      const store = await offlineStore();
      if (choice === 'mine') await updateQuickNote(note.id, { title: conflict.mine.title, content: conflict.mine.content });
      if (choice === 'both') {
        const both = [conflict.theirs.content, `— Edited on this phone —\n${conflict.mine.content || ''}`].filter(Boolean).join('\n\n');
        await updateQuickNote(note.id, { content: both, ...(conflict.mine.title && conflict.mine.title !== conflict.theirs.title ? { title: conflict.theirs.title } : {}) });
      }
      await store?.resolveConflict({ id: note.id, choice });
      notifyQuickChanged();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'That didn’t work');
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-2 mb-3" data-offline-banner="">
      {conflict && (
        <div className="rounded-2xl border border-orange-300/70 bg-orange-500/10 px-3 py-2.5" role="alert" data-conflict="">
          <p className="text-sm font-semibold text-navy-900 dark:text-white flex items-center gap-1.5"><AlertTriangle size={15} className="text-orange-500" /> Edited on another device</p>
          <p className="text-xs text-navy-600 dark:text-white/65 mt-0.5">This phone changed it offline while it was also changed somewhere else. Which version do you want?</p>
          <div className="grid sm:grid-cols-2 gap-2 mt-2 text-xs">
            <div className="rounded-xl bg-white/70 dark:bg-white/5 p-2"><p className="font-bold text-navy-500 dark:text-white/50 mb-0.5">THIS PHONE</p><p className="font-semibold text-navy-900 dark:text-white">{conflict.mine.title}</p><p className="whitespace-pre-wrap line-clamp-4 text-navy-700 dark:text-white/75">{conflict.mine.content}</p></div>
            <div className="rounded-xl bg-white/70 dark:bg-white/5 p-2"><p className="font-bold text-navy-500 dark:text-white/50 mb-0.5">OTHER DEVICE</p><p className="font-semibold text-navy-900 dark:text-white">{conflict.theirs.title}</p><p className="whitespace-pre-wrap line-clamp-4 text-navy-700 dark:text-white/75">{conflict.theirs.content}</p></div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {[['mine', 'Keep mine'], ['theirs', 'Keep theirs'], ['both', 'Keep both']].map(([k, l]) => (
              <button key={k} type="button" className={k === 'mine' ? 'btn-gold text-xs min-h-[40px] px-3' : 'btn-white text-xs min-h-[40px] px-3'} disabled={!!busy} onClick={() => resolve(k)} data-resolve={k}>
                {busy === k ? <Loader2 size={13} className="animate-spin" /> : null} {l}
              </button>
            ))}
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{error}</p>}
        </div>
      )}
      {pending.length > 0 && (
        <p className="rounded-xl bg-gold-500/10 px-3 py-2 text-xs text-navy-800 dark:text-white/85 flex items-start gap-1.5" data-will-process="">
          <Sparkles size={13} className="shrink-0 mt-0.5 text-gold-600" />
          <span><b>Will be processed when online:</b> {pending.map(p => WHAT[p] || p).join(' · ')}.</span>
        </p>
      )}
      {!pending.length && note.offlineEdited && !conflict && (
        <p className="rounded-xl bg-navy-50 dark:bg-white/5 px-3 py-2 text-xs text-navy-600 dark:text-white/65 flex items-center gap-1.5" data-waiting="">
          <CloudOff size={13} /> Changed on this phone — sends when you’re back online.
        </p>
      )}
      <KeepOfflineButton id={note.id} />
    </div>
  );
}

/** Settings → Offline keeps less than everything: keep this note / project in full anyway */
export function KeepOfflineButton({ id }) {
  const st = useOfflineStatus();
  if (!st.available || (st.settings?.mode || 'everything') === 'everything') return null;
  const kept = (st.settings?.keepIds || []).includes(id);
  async function toggle() {
    const store = await offlineStore();
    const keepIds = kept ? (st.settings.keepIds || []).filter(x => x !== id) : [...(st.settings.keepIds || []), id];
    await store?.setSettings({ ...st.settings, keepIds });
  }
  return (
    <button type="button" onClick={toggle} aria-pressed={kept} data-keep-offline=""
      className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-xs font-semibold border ${kept ? 'border-gold-400 bg-gold-500/10 text-gold-800 dark:text-gold-200' : 'border-navy-200 dark:border-white/15 text-navy-600 dark:text-white/70'}`}>
      <Download size={13} /> {kept ? 'Kept offline (with photos and audio)' : 'Keep offline'}
    </button>
  );
}
