import { useEffect, useState } from 'react';
import { CalendarDays, Copy, Check, FlaskConical } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getCalendarSetup, updateMe, testCalendar } from '../lib/api';

const INPUT = 'w-full bg-navy-50/50 dark:bg-white/5 border border-navy-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-gold-400/50';

/**
 * Settings → Google Calendar: events and dated errands go to YOUR calendar. Share it with the
 * server's service account ("Make changes to events"), paste its Calendar ID, Test.
 */
export default function CalendarSettings() {
  const { refreshUser } = useApp();
  const [info, setInfo] = useState(null);
  const [id, setId] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getCalendarSetup().then(i => { setInfo(i); setId(i.calendarId || ''); }).catch(() => setInfo({ configured: false }));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy('save'); setMsg(null);
    try {
      await updateMe({ googleCalendarId: id.trim() || null });
      await refreshUser();
      setInfo(await getCalendarSetup());
      setMsg({ ok: id.trim() ? 'Saved. New events go to this calendar.' : 'Removed. Events stay in the app only.' });
    } catch (err) { setMsg({ error: err.response?.data?.error || 'Could not save' }); } finally { setBusy(null); }
  }
  async function test() {
    setBusy('test'); setMsg(null);
    try {
      const r = await testCalendar(id.trim() || undefined);
      setMsg(r.ok ? { ok: `Works: “${r.summary}” is shared with Pocket Archive.` } : { error: r.error });
    } catch (err) { setMsg({ error: err.response?.data?.error || 'Test failed' }); } finally { setBusy(null); }
  }

  if (!info) return null;
  return (
    <div id="calendar" className="glass-panel p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Google Calendar</h2>
      </div>
      {!info.configured ? (
        <p className="text-sm text-navy-600 dark:text-white/60">The server has no Google service account set up, so events stay in the app.</p>
      ) : (
        <form onSubmit={save} className="space-y-2.5">
          <p className="text-sm text-navy-600 dark:text-white/60">
            Events and dated errands you capture go to your own Google Calendar.
            {info.usingDefault ? ' Right now they go to the server’s default calendar.' : ''}
          </p>
          <ol className="text-sm text-navy-700 dark:text-white/75 list-decimal pl-5 space-y-1">
            <li>In Google Calendar (on a computer): your calendar → <em>Settings and sharing</em> → <em>Share with specific people</em> → add this address with <em>Make changes to events</em>:</li>
          </ol>
          {info.serviceAccountEmail && (
            <div className="flex items-center gap-2 rounded-xl bg-navy-50/60 dark:bg-white/5 px-3 py-2">
              <code className="flex-1 min-w-0 text-xs break-all text-navy-800 dark:text-white/85">{info.serviceAccountEmail}</code>
              <button type="button" className="btn-ghost text-xs shrink-0" onClick={() => { navigator.clipboard?.writeText(info.serviceAccountEmail); setCopied(true); }}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
          <ol start={2} className="text-sm text-navy-700 dark:text-white/75 list-decimal pl-5">
            <li>Same page, <em>Integrate calendar</em> → copy the <em>Calendar ID</em> and paste it here:</li>
          </ol>
          <input className={INPUT} placeholder="e.g. you@gmail.com or …@group.calendar.google.com" value={id} onChange={e => setId(e.target.value)} aria-label="Calendar ID" />
          <div className="flex flex-wrap gap-2">
            <button className="btn-gold text-sm" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn-white text-sm" onClick={test} disabled={!!busy || (!id.trim() && !info.usingDefault)}><FlaskConical size={13} /> {busy === 'test' ? 'Testing…' : 'Test'}</button>
          </div>
          {msg && <p className={`text-xs ${msg.error ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`} role="status">{msg.error || msg.ok}</p>}
        </form>
      )}
    </div>
  );
}
