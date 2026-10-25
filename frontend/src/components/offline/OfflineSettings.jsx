import { Fragment, useEffect, useState } from 'react';
import { HardDriveDownload, RefreshCw, Trash2, Eraser, Loader2 } from 'lucide-react';
import { useOfflineStatus } from '../../lib/offline/status';
import { offlineStore, offlineCapable } from '../../lib/offline/native';
import { describe, ago, gb } from '../../lib/offline/format';
import { getOfflineManifest } from '../../lib/api';
import { useApp } from '../../context/AppContext';

const MODES = [
  ['everything', 'Everything', 'All notes, photos, scans, files and audio (recommended)'],
  ['thumbs', 'Text + thumbnails', 'Every note and small previews; full photos and audio stream when online'],
  ['text', 'Text only', 'Every note, list and summary — no pictures or audio'],
  ['recent', 'Pinned + last 30 days', 'Pinned and recent notes in full, older ones as text'],
];
const KINDS = [['text', 'Text'], ['photo', 'Photos'], ['scan', 'Scans & PDFs'], ['file', 'Files'], ['audio', 'Audio'], ['thumb', 'Thumbnails'], ['recording', 'Recordings']];
const LIMITS = [[0, 'No limit'], [1e9, '1 GB'], [2e9, '2 GB'], [5e9, '5 GB'], [10e9, '10 GB'], [20e9, '20 GB']];

function Switch({ label, hint, checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="w-full flex items-center gap-3 py-2.5 text-left disabled:opacity-50">
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-navy-900 dark:text-white">{label}</span>
        {hint && <span className="block text-xs text-navy-500 dark:text-white/50">{hint}</span>}
      </span>
      <span className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${checked ? 'bg-gold-500' : 'bg-navy-200 dark:bg-white/20'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

/** Settings → Offline & storage (Android app): what the phone keeps, how much space it uses, Sync now / Free up / Delete */
export default function OfflineSettings() {
  const st = useOfflineStatus();
  const { isAdmin } = useApp();
  const [estimate, setEstimate] = useState(null);
  const [queue, setQueue] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!offlineCapable()) return;
    getOfflineManifest().then(setEstimate).catch(() => setEstimate(null));
  }, [st.online]);
  useEffect(() => {
    let alive = true;
    offlineStore().then(s => s?.queue()).then(q => { if (alive) setQueue(q || null); }).catch(() => {});
    return () => { alive = false; };
  }, [st.pending, st.lastSyncAt]);

  if (!offlineCapable() || !st.available) return null;
  const s = st.settings || {};
  const usage = st.usage || {};
  const used = KINDS.reduce((a, [k]) => a + (usage[k] || 0), 0);
  const limit = s.limitBytes || 0;
  const nearLimit = limit > 0 && used > limit * 0.9;
  const { text: statusText } = describe(st);
  const p = st.progress;

  async function set(patch) {
    const store = await offlineStore();
    await store?.setSettings({ ...s, ...patch });
  }
  async function act(kind, fn, done) {
    setBusy(kind); setMsg('');
    try { await fn(await offlineStore()); if (done) setMsg(done); } catch (err) { setMsg(err.message || 'That didn’t work'); } finally { setBusy(null); }
  }

  return (
    <div id="offline" className="glass-panel p-5 sm:p-6 mb-4 scroll-mt-20" data-offline-settings="">
      <div className="flex items-center gap-2 mb-1">
        <HardDriveDownload size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Offline & storage</h2>
      </div>
      <p className="text-sm text-navy-500 dark:text-white/50 mb-3">
        This phone keeps an encrypted copy, so everything works without a connection — reading, searching, photos, audio, and changes,
        which are sent when you’re back online.{s.lockProtected ? ' It opens only after the app lock.' : ''}
      </p>

      <div className="rounded-2xl bg-navy-50 dark:bg-white/5 px-3 py-2.5 mb-3">
        <p className="text-sm font-semibold text-navy-900 dark:text-white" data-offline-status="">{statusText}</p>
        <p className="text-xs text-navy-500 dark:text-white/50">Last synced {ago(st.lastSyncAt)}{st.pending ? ` · ${st.pending} change${st.pending === 1 ? '' : 's'} waiting` : ''}</p>
        {p && p.bytesTotal > 0 && p.bytesDone < p.bytesTotal && (
          <div className="mt-2" aria-label="Download progress">
            <div className="h-2 rounded-full bg-navy-200/70 dark:bg-white/10 overflow-hidden"><div className="h-full bg-gold-500" style={{ width: `${Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100))}%` }} /></div>
            <p className="text-[11px] text-navy-500 dark:text-white/50 mt-1">{p.phase === 'text' ? 'Notes first' : p.phase === 'thumbs' ? 'Then thumbnails' : 'Then photos, scans and audio'}{p.waitingForWifi ? ' · waiting for Wi-Fi' : ''}</p>
          </div>
        )}
        {queue?.ops?.length > 0 && (
          <p className="text-xs text-navy-600 dark:text-white/65 mt-1.5">Waiting: {queue.ops.slice(0, 6).map(o => o.label || o.method).join(' · ')}{queue.ops.length > 6 ? ' …' : ''}</p>
        )}
        {queue?.failed?.length > 0 && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{queue.failed.length} change{queue.failed.length === 1 ? '' : 's'} couldn’t be saved: {queue.failed.slice(-3).map(f => f.error || f.status).join(' · ')}</p>
        )}
        <button type="button" className="btn-white text-xs mt-2 min-h-[40px] px-3" disabled={!!busy || !st.online} onClick={() => act('sync', store => store.syncNow({ reason: 'user' }))} data-sync-now="">
          {busy === 'sync' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync now
        </button>
      </div>

      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mt-4 mb-1">What to keep on this phone</h3>
      <div className="space-y-1.5" role="radiogroup" aria-label="What to keep offline">
        {MODES.map(([k, l, hint]) => (
          <button key={k} type="button" role="radio" aria-checked={(s.mode || 'everything') === k} onClick={() => set({ mode: k })}
            className={`w-full text-left rounded-xl border px-3 py-2 ${(s.mode || 'everything') === k ? 'border-gold-400 bg-gold-500/10' : 'border-navy-200 dark:border-white/15'}`}>
            <span className="block text-sm font-semibold text-navy-900 dark:text-white">{l}</span>
            <span className="block text-xs text-navy-500 dark:text-white/50">{hint}</span>
          </button>
        ))}
      </div>
      {(s.mode || 'everything') !== 'everything' && <p className="text-xs text-navy-500 dark:text-white/50 mt-1">Open a note or project and tap <b>Keep offline</b> to keep it in full anyway.</p>}
      <Switch label="Photos and audio over Wi-Fi only" hint="Notes and changes always sync on mobile data" checked={s.wifiOnlyMedia !== false} onChange={v => set({ wifiOnlyMedia: v })} />
      {isAdmin && <Switch label="Include the Hey Pocket archive" hint="AI notes, summaries, transcripts and recordings" checked={s.archive !== false} onChange={v => set({ archive: v })} />}
      <Switch label="Keep the map for offline use" hint={estimate?.map ? `About ${gb(estimate.map)}` : 'Large — saved places show on the map without a connection'} checked={!!s.maps} onChange={v => set({ maps: v })} />

      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mt-4 mb-1">Storage</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm" data-storage="">
        {KINDS.filter(([k]) => k !== 'recording' || isAdmin).map(([k, l]) => (<Fragment key={k}><dt className="text-navy-600 dark:text-white/65">{l}</dt><dd className="text-right font-semibold text-navy-900 dark:text-white">{gb(usage[k] || 0)}</dd></Fragment>))}
        <dt className="font-bold text-navy-900 dark:text-white border-t border-navy-100 dark:border-white/10 pt-1">On this phone</dt>
        <dd className="text-right font-bold text-navy-900 dark:text-white border-t border-navy-100 dark:border-white/10 pt-1" data-used={used}>{gb(used)}</dd>
      </dl>
      {estimate && <p className="text-xs text-navy-500 dark:text-white/50 mt-1" data-estimate={estimate.total}>A full copy of your account is about <b>{gb(estimate.total)}</b>{estimate.archive ? ' (with the archive)' : ''}.</p>}
      <label className="flex items-center gap-2 mt-2 text-sm">
        <span className="flex-1 text-navy-700 dark:text-white/75">Storage limit</span>
        <select className="search-input !w-auto !py-1.5" value={limit} onChange={e => set({ limitBytes: Number(e.target.value) })}>
          {LIMITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {nearLimit && <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mt-1" role="status">Almost full: {gb(used)} of {gb(limit)}. Older photos and audio are left on the NAS; text is always kept.</p>}

      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className="btn-white text-xs min-h-[40px] px-3" disabled={!!busy}
          onClick={() => window.confirm('Remove photos, scans and audio from this phone? Your notes stay offline; pictures load from the NAS when you’re online.') && act('free', store => store.freeUpSpace(), 'Photos and audio removed — notes are still here')}>
          <Eraser size={13} /> Free up space
        </button>
        <button type="button" className="btn-ghost text-xs min-h-[40px] px-3 text-red-600 dark:text-red-400" disabled={!!busy}
          onClick={() => window.confirm('Delete the offline copy from this phone? Changes not sent yet are lost. It downloads again with Sync now.') && act('wipe', store => store.wipe({ reason: 'user' }), 'Offline copy deleted')}>
          <Trash2 size={13} /> Delete offline data
        </button>
      </div>
      {msg && <p className="text-xs mt-2 text-navy-700 dark:text-white/75" role="status">{msg}</p>}
    </div>
  );
}
