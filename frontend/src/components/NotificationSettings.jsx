import { useCallback, useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Bell, CheckCircle2, AlertTriangle, Smartphone, Watch, Loader2, RefreshCw } from 'lucide-react';
import { isNative } from '../lib/platform';
import { QuickRecorder } from '../native/quickRecorder';

const IMPORTANCE = { 0: 'Off', 1: 'Silent, minimized', 2: 'Silent', 3: 'Sound', 4: 'Pops up', 5: 'Pops up' };

/**
 * Settings → Notifications (Android app): the permission, every notification category
 * (channel) with a fix-it link when it's turned off, and test notifications for the phone and watch.
 */
export default function NotificationSettings() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => {
    QuickRecorder.getNotificationStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (!isNative) return undefined;
    load();
    const sub = CapApp.addListener('resume', load);
    return () => { sub.then(h => h.remove()); };
  }, [load]);

  if (!isNative) return null;

  async function allow() {
    try {
      const r = await QuickRecorder.requestNotifications();
      if (r.notifications !== 'granted') await QuickRecorder.openNotificationSettings({});
    } catch { await QuickRecorder.openNotificationSettings({}).catch(() => {}); }
    setTimeout(load, 800);
  }

  async function test(target) {
    setBusy(target);
    setMsg(null);
    try {
      const r = await QuickRecorder.sendTestNotification({ target });
      if (!r.sent) setMsg('Notifications are off for Pocket Archive — turn them on above, then try again.');
      else if (target === 'watch') setMsg(r.watchApp
        ? 'Sent to your watch through the Pocket Archive watch app. Nothing there? Open the watch app once, keep the watch connected, and check the watch’s Do Not Disturb.'
        : 'Sent. The watch app isn’t connected, so it goes through Galaxy Wearable’s notification bridging (Galaxy Wearable → Watch settings → Notifications → Pocket Archive).');
      else setMsg('Sent a test notification to this phone.');
    } catch (err) {
      setMsg(err.message || 'Could not send the test');
    } finally {
      setBusy(null);
    }
  }

  const blocked = (status?.channels || []).filter(c => c.blocked);
  const ok = status?.enabled && status?.permission === 'granted';

  return (
    <div id="notifications" className="glass-panel p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Bell size={18} className="text-gold-500" />
        <h2 className="flex-1 font-bold text-navy-900 dark:text-white">Notifications</h2>
        <button className="btn-ghost text-xs py-1" onClick={load}><RefreshCw size={12} /> Refresh</button>
      </div>
      <p className="text-sm text-navy-600 dark:text-white/60 mb-3">Location reminders, saved-note confirmations and recording controls.</p>

      {!status ? (
        <div className="h-12 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" />
      ) : (
        <>
          <div className="flex items-center gap-2.5 rounded-xl bg-navy-50/50 dark:bg-white/5 px-3 py-2.5 mb-2">
            {ok ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> : <AlertTriangle size={16} className="text-amber-500 shrink-0" />}
            <span className="flex-1 text-sm text-navy-900 dark:text-white">
              {ok ? 'Notifications are allowed' : 'Notifications are turned off for Pocket Archive'}
            </span>
            {!ok && <button type="button" className="btn-white text-xs py-1 px-2.5" onClick={allow}>Turn on</button>}
          </div>

          <ul className="divide-y divide-navy-100 dark:divide-white/10 rounded-xl bg-navy-50/50 dark:bg-white/5 px-3">
            {(status.channels || []).map(c => (
              <li key={c.id} className="flex items-center gap-2.5 py-2">
                {c.blocked ? <AlertTriangle size={15} className="text-amber-500 shrink-0" /> : <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-navy-900 dark:text-white">{c.name}</span>
                  <span className="block text-xs text-navy-500 dark:text-white/50">{c.blocked ? 'Turned off' : IMPORTANCE[c.importance] || 'On'}{c.description ? ` · ${c.description}` : ''}</span>
                </span>
                <button type="button" className={`${c.blocked ? 'btn-white' : 'btn-ghost'} text-xs py-1 px-2.5 shrink-0`}
                  onClick={() => QuickRecorder.openNotificationSettings({ channel: c.id }).catch(() => {})}>
                  {c.blocked ? 'Turn on' : 'Settings'}
                </button>
              </li>
            ))}
          </ul>
          {blocked.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
              {blocked.length === 1 ? `“${blocked[0].name}” is` : `${blocked.length} categories are`} turned off — those notifications never show.
            </p>
          )}

          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn-white text-sm" onClick={() => test('phone')} disabled={!!busy}>
              {busy === 'phone' ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />} Send test notification
            </button>
            <button type="button" className="btn-white text-sm" onClick={() => test('watch')} disabled={!!busy}>
              {busy === 'watch' ? <Loader2 size={14} className="animate-spin" /> : <Watch size={14} />} Test on watch
            </button>
          </div>
          {msg && <p className="mt-2 text-xs rounded-xl bg-gold-500/10 px-3 py-2 text-navy-800 dark:text-white/85" role="status">{msg}</p>}
        </>
      )}
    </div>
  );
}
