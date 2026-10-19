import { useCallback, useEffect, useState } from 'react';
import { Download, Upload, Undo2, Trash2 } from 'lucide-react';
import { adminUpdates, publishUpdate, discardUpdateDraft, rollbackUpdate } from '../lib/api';

const day = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const mb = n => `${(n / 1048576).toFixed(1)} MB`;

/**
 * Settings → Users → App updates (admin): what the phones and watches are offered, a held-back draft
 * ("update-android.bat draft") to publish or discard, and the kept older versions to roll back to.
 */
export default function AppUpdatesAdmin() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => { adminUpdates().then(setData).catch(() => setMsg({ error: 'Could not load app updates' })); }, []);
  useEffect(() => { load(); }, [load]);

  async function run(key, fn, ok) {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg({ ok }); load(); } catch (err) { setMsg({ error: err.response?.data?.error || 'That didn’t work' }); } finally { setBusy(null); }
  }

  if (!data) return <div className="h-12 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse mt-4" />;
  return (
    <div id="app-updates" className="mt-5 pt-4 border-t border-navy-100 dark:border-white/10 scroll-mt-20">
      <h3 className="flex items-center gap-1.5 font-bold text-navy-900 dark:text-white mb-1"><Download size={16} className="text-gold-500" /> App updates</h3>
      <p className="text-xs text-navy-500 dark:text-white/50 mb-3">
        Phones and watches update themselves from the NAS. <code>update-android.bat</code> publishes each build; <code>update-android.bat draft</code> holds it here until you publish.
      </p>
      {[['phone', 'Phone app'], ['watch', 'Watch app']].map(([t, label]) => {
        const x = data[t];
        const older = x.history.filter(h => h.versionCode !== x.latest?.versionCode && h.versionCode !== x.draft?.versionCode);
        return (
          <div key={t} className="rounded-2xl border border-navy-100 dark:border-white/10 p-3 mb-2.5">
            <p className="text-sm font-semibold text-navy-900 dark:text-white">{label}: {x.latest ? `${x.latest.versionName} (${x.latest.versionCode})` : 'nothing published yet'}</p>
            {x.latest && <p className="text-xs text-navy-500 dark:text-white/50">Published {day(x.latest.publishedAt)} · {mb(x.latest.size)}{x.latest.rolledBackFrom ? ` · rolled back from ${x.latest.rolledBackFrom}` : ''}</p>}
            {x.draft && (
              <div className="flex flex-wrap items-center gap-2 mt-2 rounded-xl bg-gold-500/10 px-2.5 py-2">
                <span className="flex-1 min-w-0 text-xs text-navy-800 dark:text-white/80">Draft {x.draft.versionName} ({x.draft.versionCode}) — not offered yet</span>
                <button className="btn-gold text-xs py-1.5 px-3" disabled={!!busy} onClick={() => run(`pub-${t}`, () => publishUpdate(t), `${label} ${x.draft.versionName} published`)}><Upload size={13} /> Publish</button>
                <button className="btn-ghost text-xs py-1.5 px-2" disabled={!!busy} onClick={() => run(`del-${t}`, () => discardUpdateDraft(t), 'Draft discarded')} aria-label="Discard draft"><Trash2 size={13} /></button>
              </div>
            )}
            {older.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-navy-400 dark:text-white/40 mb-1">Kept for rollback</p>
                {older.map(h => (
                  <div key={h.versionCode} className="flex items-center gap-2 text-xs py-1">
                    <span className="flex-1 text-navy-700 dark:text-white/70">{h.versionName} ({h.versionCode}) · {day(h.publishedAt)}</span>
                    <button className="btn-white text-xs py-1 px-2.5" disabled={!!busy}
                      onClick={() => window.confirm(`Offer ${h.versionName} again?\n\nPhones and watches that haven’t updated yet stay on it. Android can’t install an older version over a newer one, so devices already on ${x.latest?.versionName} keep it until you publish a fixed, newer build.`)
                        && run(`rb-${t}-${h.versionCode}`, () => rollbackUpdate(t, h.versionCode), `${label}: ${h.versionName} is offered again`)}>
                      <Undo2 size={12} /> Roll back
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-navy-500 dark:text-white/50">Rolling back can’t downgrade a device that already updated (Android only allows that after uninstalling). The real fix for a bad release is a newer build with the fix.</p>
      {msg && <p className={`text-xs mt-2 ${msg.error ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`} role="status">{msg.error || msg.ok}</p>}
    </div>
  );
}
