import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import {
  BellRing, MapPin, CheckCircle2, AlertTriangle, RefreshCw, FlaskConical, LocateFixed, Bell, BatteryCharging, Crosshair, Radio,
} from 'lucide-react';
import { getLocationReminders } from '../../lib/api';
import { isNative } from '../../lib/platform';
import { QuickRecorder } from '../../native/quickRecorder';
import { syncErrands } from '../../native/errands';

const ago = ms => {
  if (!ms) return 'never';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function Check({ ok, label, hint, fix, fixLabel = 'Fix' }) {
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      {ok ? <CheckCircle2 size={16} className="shrink-0 text-emerald-500" /> : <AlertTriangle size={16} className="shrink-0 text-amber-500" />}
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-navy-900 dark:text-white">{label}</span>
        {hint && <span className="block text-xs text-navy-500 dark:text-white/50">{hint}</span>}
      </span>
      {!ok && fix && <button type="button" className="btn-white text-xs py-1 px-2.5" onClick={fix}>{fixLabel}</button>}
    </li>
  );
}

/**
 * Settings → Places & errands → Location reminders: what's armed on this phone,
 * the permissions they need (with fix-it buttons), the last geofence event,
 * and "Test this reminder".
 */
export default function LocationReminders() {
  const [list, setList] = useState(null);
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    getLocationReminders().then(setList).catch(() => setList([]));
    if (isNative) QuickRecorder.getLocationStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    load();
    if (!isNative) return undefined;
    const sub = CapApp.addListener('resume', load);
    return () => { sub.then(h => h.remove()); };
  }, [load]);

  async function fix(kind) {
    setMsg(null);
    try {
      if (kind === 'location') {
        let s = await QuickRecorder.checkLocation();
        if (s.foreground !== 'granted') s = await QuickRecorder.requestLocation();
        if (s.foreground === 'granted' && s.background !== 'granted') await QuickRecorder.requestBackgroundLocation();
        else if (s.foreground !== 'granted') await QuickRecorder.openAppSettings();
      } else if (kind === 'notifications') {
        const r = await QuickRecorder.requestNotifications();
        if (r.notifications !== 'granted') await QuickRecorder.openAppSettings();
      } else if (kind === 'battery') {
        await QuickRecorder.openShortcutSetup({ target: 'battery' });
      } else if (kind === 'precise') {
        await QuickRecorder.openAppSettings();
      }
    } catch (err) { setMsg(err.message); }
    setTimeout(load, 800);
  }

  async function test(r) {
    setBusy(r.id);
    setMsg(null);
    try {
      await QuickRecorder.testLocationReminder({ id: r.id });
      setMsg(`Sent a test notification for “${r.title}”. If nothing showed up, check the items marked ⚠ above.`);
    } catch (err) {
      setMsg(err.message || 'Could not test this reminder');
    } finally {
      setBusy(null);
      setTimeout(load, 500);
    }
  }

  const loc = status?.location;
  const armed = status?.armed;
  const last = status?.lastEvent;
  const active = (list || []).filter(r => r.status === 'active');
  const others = (list || []).filter(r => r.status !== 'active');

  return (
    <div className="mt-5" id="location-reminders">
      <div className="flex items-center gap-2 mb-1">
        <BellRing size={15} className="text-gold-500" />
        <h3 className="flex-1 text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/40">Location reminders</h3>
        <button className="btn-ghost text-xs py-1" onClick={() => { syncErrands(); setTimeout(load, 1500); }}><RefreshCw size={12} /> Refresh</button>
      </div>
      <p className="text-xs text-navy-500 dark:text-white/50 mb-2">
        Say “remind me … when I get home”, “… when I leave work”, “next time I’m at the gym …”. They fire on this phone (and your watch).
      </p>

      {isNative && status && (
        <ul className="rounded-xl bg-navy-50/50 dark:bg-white/5 px-3 py-1.5 mb-3">
          <Check ok={loc?.foreground === 'granted' && loc?.background === 'granted'} label="Location: Allow all the time"
            hint={loc?.foreground !== 'granted' ? 'Off' : loc?.background !== 'granted' ? 'Only while using the app — reminders can’t fire in the background' : null}
            fix={() => fix('location')} />
          <Check ok={status.precise} label="Precise location" hint={status.precise ? null : 'Approximate location can miss small places like home'} fix={() => fix('precise')} fixLabel="Open settings" />
          <Check ok={status.locationOn} label="Location is turned on" hint={status.locationOn ? null : 'Swipe down → Location'} />
          <Check ok={status.notifications === 'granted'} label={<span className="inline-flex items-center gap-1"><Bell size={12} /> Notifications</span>} fix={() => fix('notifications')} />
          <Check ok={status.batteryUnrestricted} label={<span className="inline-flex items-center gap-1"><BatteryCharging size={12} /> Battery: Unrestricted</span>} hint={status.batteryUnrestricted ? null : 'Samsung may delay reminders otherwise'} fix={() => fix('battery')} fixLabel="Open" />
          <li className="flex items-center gap-2.5 py-1.5 text-xs text-navy-600 dark:text-white/60">
            <Crosshair size={15} className="shrink-0 text-navy-400" />
            <span className="flex-1">
              {armed?.error ? `Geofences not armed: ${armed.error}` : `${armed?.count || 0} geofence${armed?.count === 1 ? '' : 's'} armed${armed?.at ? ` · ${ago(armed.at)}` : ''}`}
            </span>
          </li>
          <li className="flex items-center gap-2.5 py-1.5 text-xs text-navy-600 dark:text-white/60">
            <Radio size={15} className="shrink-0 text-navy-400" />
            <span className="flex-1">Last geofence event: {last ? `${last.transition} · ${ago(last.at)}` : 'none yet'}</span>
          </li>
        </ul>
      )}
      {!isNative && <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">Location reminders fire in the Android app — open it there to check permissions or test.</p>}

      {list === null ? (
        <div className="h-12 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" />
      ) : list.length === 0 ? (
        <p className="text-sm text-navy-500 dark:text-white/50">No location reminders yet.</p>
      ) : (
        <ul className="space-y-2">
          {[...active, ...others].map(r => (
            <li key={r.id} className="rounded-xl bg-navy-50/50 dark:bg-white/5 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <MapPin size={15} className={`mt-0.5 shrink-0 ${r.status === 'active' ? 'text-emerald-500' : 'text-amber-500'}`} />
                <div className="flex-1 min-w-0">
                  <Link to={`/quick/${r.id}`} className="block text-sm font-semibold text-navy-900 dark:text-white break-words hover:underline">{r.title}</Link>
                  <p className="text-xs text-navy-500 dark:text-white/55">
                    {r.when === 'leave' ? 'Leaving' : 'Arriving at'} {r.place}{r.stores > 1 ? ` (${r.stores} stores)` : ''}
                    {' · '}
                    <span className={r.status === 'active' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                      {{ active: 'Active', needs_place: 'Needs a place', done: 'Done', expired: 'Expired', pending: 'Pending' }[r.status] || r.status}
                    </span>
                    {r.triggeredAt ? ` · last fired ${typeof r.triggeredAt === 'string' && r.triggeredAt.length > 10 ? ago(Date.parse(r.triggeredAt)) : r.triggeredAt}` : ''}
                  </p>
                  {r.error && <p className="text-xs text-amber-700 dark:text-amber-300">{r.error}</p>}
                </div>
                {isNative && r.status === 'active' && (
                  <button type="button" className="btn-white text-xs py-1 px-2.5 shrink-0" onClick={() => test(r)} disabled={busy === r.id}>
                    <FlaskConical size={13} /> {busy === r.id ? 'Testing…' : 'Test'}
                  </button>
                )}
                {r.status === 'needs_place' && (
                  <Link to={`/quick/${r.id}`} className="btn-white text-xs py-1 px-2.5 shrink-0"><LocateFixed size={13} /> Set place</Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="mt-2 text-xs rounded-xl bg-gold-500/10 px-3 py-2 text-navy-800 dark:text-white/85" role="status">{msg}</p>}
    </div>
  );
}
