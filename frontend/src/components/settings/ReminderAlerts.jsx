import { useCallback, useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { AlarmClock, CheckCircle2, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { isNative } from '../../lib/platform';
import { QuickRecorder } from '../../native/quickRecorder';

/**
 * Settings › Places & reminders (Android app): alerts for reminders with a due time, a test button
 * (phone + watch) and a health check — notifications, exact alarms, battery "Unrestricted".
 */
export default function ReminderAlerts() {
  const [h, setH] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => { QuickRecorder.getReminderHealth().then(setH).catch(() => setH(null)); }, []);

  useEffect(() => {
    if (!isNative) return undefined;
    load();
    const sub = CapApp.addListener('resume', load);
    return () => { sub.then(x => x.remove()); };
  }, [load]);

  if (!isNative) return null;

  const fix = which => QuickRecorder.openReminderSetting({ which }).catch(err => setMsg(err.message || 'Could not open that setting'));
  const notificationsFix = () => QuickRecorder.openNotificationSettings(h?.notifications ? { channel: 'timed_reminders' } : {}).catch(() => {});

  async function toggle(on) {
    setH(await QuickRecorder.setReminderAlerts({ enabled: on }).catch(() => h));
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await QuickRecorder.testReminderAlert();
      setMsg(!r.sent ? 'Notifications are off for Pocket Archive — fix that below, then try again.'
        : r.watchApp ? 'Sent to this phone and your watch.' : 'Sent to this phone (no Pocket Archive watch app found).');
    } catch (err) {
      setMsg(err.message || 'Could not send the test');
    } finally {
      setBusy(false);
    }
  }

  const checks = h ? [
    { key: 'n', ok: h.notifications && !h.channelBlocked, label: 'Notifications allowed', bad: h.notifications ? 'The “Reminder alerts” category is turned off' : 'Notifications are turned off for Pocket Archive', fix: notificationsFix },
    { key: 'a', ok: h.exactAlarms, label: 'Exact alarms allowed', bad: 'Without it Android may delay reminders by several minutes', fix: () => fix('exactAlarms') },
    { key: 'b', ok: h.batteryUnrestricted, label: 'Battery: Unrestricted', bad: h.manufacturer?.toLowerCase() === 'samsung'
      ? 'Samsung may stop the app in the background. Allow it, then Settings › Battery › Background usage limits › Never sleeping apps › add Pocket Archive'
      : 'Android may stop the app in the background', fix: () => fix('battery') },
  ] : [];
  const allOk = checks.length > 0 && checks.every(c => c.ok);
  const next = h?.nextAt ? new Date(h.nextAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <div id="reminder-alerts" className="glass-panel p-5 sm:p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <AlarmClock size={18} className="text-gold-500" />
        <h2 className="flex-1 font-bold text-navy-900 dark:text-white">Reminder alerts</h2>
        <button className="btn-ghost text-xs py-1" onClick={load}><RefreshCw size={12} /> Refresh</button>
      </div>
      <p className="text-sm text-navy-600 dark:text-white/60 mb-3">
        A notification on this phone (and your watch) at the due time of a reminder, even offline. Buttons: Done, Snooze 10 min, Snooze 1 h, Open.
        “Also add to Google Calendar” is below.
      </p>

      {!h ? (
        <div className="h-12 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" />
      ) : (
        <>
          <button type="button" role="switch" aria-checked={h.enabled} onClick={() => toggle(!h.enabled)} className="w-full flex items-center gap-3 py-2.5 text-left">
            <span className="flex-1">
              <span className="block text-sm font-semibold text-navy-900 dark:text-white">Reminder alerts</span>
              <span className="block text-xs text-navy-500 dark:text-white/50">
                {h.scheduled ? `${h.scheduled} scheduled${next ? ` · next ${next}` : ''}` : 'No timed reminders waiting'}
              </span>
            </span>
            <span className={`w-10 h-6 rounded-full p-0.5 transition-colors ${h.enabled ? 'bg-gold-500' : 'bg-navy-200 dark:bg-white/20'}`}>
              <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${h.enabled ? 'translate-x-4' : ''}`} />
            </span>
          </button>

          <div className="rounded-xl bg-navy-50/50 dark:bg-white/5 px-3 py-1 mt-1 divide-y divide-navy-100 dark:divide-white/10">
            {checks.map(c => (
              <div key={c.key} className="flex items-start gap-2.5 py-2.5">
                {c.ok ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" /> : <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-navy-900 dark:text-white">{c.label}</span>
                  {!c.ok && <span className="block text-xs text-navy-500 dark:text-white/50">{c.bad}</span>}
                </span>
                {!c.ok && <button type="button" className="btn-white text-xs py-1 px-2.5 shrink-0" onClick={c.fix}>Fix</button>}
              </div>
            ))}
          </div>
          <p className="text-xs text-navy-500 dark:text-white/50 mt-2">{allOk ? 'Everything needed for on-time alerts is on.' : 'Fix the items above so alerts arrive on time.'}</p>

          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn-white text-sm" disabled={busy} onClick={test}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <AlarmClock size={14} />} Test reminder alert
            </button>
          </div>
          {msg && <p className="text-sm text-navy-600 dark:text-white/70 mt-2" role="status">{msg}</p>}
        </>
      )}
    </div>
  );
}
