import { useState } from 'react';
import { RefreshCw, Download, ShieldCheck, Watch, AlertTriangle } from 'lucide-react';
import { useAppUpdate } from '../lib/appUpdate';
import { isNative } from '../lib/platform';
import MarkdownRenderer from './MarkdownRenderer';

/** The watch is being updated right now (download / transfer running) */
const watchBusy = status => /^(asking|downloading|sending|watch is receiving)/i.test(status || '');

const when = ms => (ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');

/** The release notes of an update, in a sheet ("What's new") */
export function UpdateNotes({ latest, onClose }) {
  return (
    <div className="fixed inset-0 z-[240] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose} role="dialog" aria-modal="true" aria-label={`What's new in ${latest.versionName}`}>
      <div className="glass-panel w-full sm:max-w-lg max-h-[85vh] overflow-y-auto p-5 rounded-b-none sm:rounded-b-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-navy-900 dark:text-white mb-2">What’s new in {latest.versionName}</h2>
        <div className="quick-summary text-sm"><MarkdownRenderer content={latest.releaseNotes || 'Improvements and fixes.'} /></div>
        <button className="btn-ghost w-full justify-center mt-3" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/**
 * Settings → About (Android app): current version, Check for updates, last check, Wi-Fi only,
 * Update with progress, the first-time "Install unknown apps" step, and the watch.
 */
export default function AppUpdatePanel() {
  const { state: s, check, start, setWifiOnly, openInstallSettings, updateWatch } = useAppUpdate();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(false);
  if (!isNative || !s) return null;
  const latest = s.latest;
  const newer = latest && latest.versionCode > s.currentCode;
  const status = s.status;

  return (
    <div className="rounded-2xl border border-navy-100 dark:border-white/10 p-3 mb-4" aria-label="App updates">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-gold-500 shrink-0" />
        <p className="flex-1 text-sm font-semibold text-navy-900 dark:text-white">
          {status === 'rolledBack' ? 'A newer build is on the way'
            : newer ? `Update ${latest.versionName} available`
              : `Up to date · ${s.current}`}
        </p>
        <button className="btn-white text-xs py-1.5 px-3" disabled={busy} onClick={async () => { setBusy(true); try { await check(); } finally { setBusy(false); } }}>
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Check for updates
        </button>
      </div>
      <p className="text-xs text-navy-500 dark:text-white/50 mt-1">Last checked {when(s.lastCheckAt)}. Updates come from your NAS and are installed only when they’re signed with the Pocket Archive key.</p>

      {status === 'rolledBack' && (
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">The admin went back to {latest?.versionName}. Android can’t install an older version over a newer one (only after uninstalling), so this phone keeps {s.current} until a fixed, newer build is published.</p>
      )}

      {newer && (
        <div className="mt-2.5">
          {!s.canInstall ? (
            <div className="rounded-xl bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
              <p className="flex items-center gap-1.5 font-semibold mb-1"><AlertTriangle size={13} /> One-time step: allow updates</p>
              <p className="mb-2">Android asks once: Settings → Install unknown apps → Pocket Archive → <b>Allow from this source</b>. Then come back and tap Update.</p>
              <button className="btn-white text-xs py-1.5 px-3" onClick={openInstallSettings}>Open the setting</button>
            </div>
          ) : status === 'downloading' ? (
            <div aria-live="polite">
              <p className="text-xs text-navy-600 dark:text-white/60 mb-1">Downloading… {s.progress}%</p>
              <div className="h-2 rounded-full bg-navy-100 dark:bg-white/10 overflow-hidden"><div className="h-full bg-gold-500 transition-all" style={{ width: `${s.progress}%` }} /></div>
            </div>
          ) : status === 'deferred' ? (
            <p className="text-xs text-navy-600 dark:text-white/60">Ready — it installs when the recording ends.</p>
          ) : status === 'installing' ? (
            <p className="text-xs text-navy-600 dark:text-white/60">Installing… confirm if Android asks.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="btn-gold text-xs py-1.5 px-3" onClick={start}><Download size={13} /> Update</button>
              <button className="btn-ghost text-xs py-1.5 px-3" onClick={() => setNotes(true)}>What’s new</button>
            </div>
          )}
          {s.error && <p className="text-xs text-red-500 mt-1.5">{s.error}</p>}
        </div>
      )}

      <label className="flex items-center gap-2 mt-3 text-sm text-navy-700 dark:text-white/75 cursor-pointer">
        <input type="checkbox" className="accent-amber-500 w-4 h-4" checked={!!s.wifiOnly} onChange={e => setWifiOnly(e.target.checked)} />
        Check and download on Wi-Fi only
      </label>

      {s.watch && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-navy-100 dark:border-white/10">
          <Watch size={15} className="text-gold-500 shrink-0" />
          <span className="flex-1 min-w-0 text-sm text-navy-700 dark:text-white/75">
            Watch app {s.watch.versionName}
            {s.watch.status && (
              <span className={`flex items-center gap-1 text-xs ${/couldn|rejected|cancelled|not connected|no phone|waiting for wi-fi/i.test(s.watch.status) ? 'text-amber-700 dark:text-amber-300'
                : /^updated to/i.test(s.watch.status) ? 'text-emerald-600 dark:text-emerald-400' : 'text-navy-500 dark:text-white/50'}`} role="status" aria-live="polite">
                {watchBusy(s.watch.status) && <RefreshCw size={11} className="animate-spin shrink-0" />}
                {s.watch.status}
              </span>
            )}
          </span>
          <button className="btn-white text-xs py-1.5 px-3" onClick={updateWatch} disabled={watchBusy(s.watch.status)}>Update watch</button>
        </div>
      )}
      {notes && latest && <UpdateNotes latest={latest} onClose={() => setNotes(false)} />}
    </div>
  );
}
