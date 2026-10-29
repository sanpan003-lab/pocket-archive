import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { isNative } from '../../lib/platform';
import { QuickRecorder } from '../../native/quickRecorder';
import { noteChanged } from '../../lib/reminderAlarms';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const timeOf = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayOf = ms => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
const when = ms => (new Date(ms).toDateString() === new Date().toDateString() ? timeOf(ms) : `${dayOf(ms)}, ${timeOf(ms)}`);

/**
 * Under a timed reminder / event (Android app): "🔔 Alert set for 3:00 PM", or "⚠ Alert not set — tap to fix".
 * Tapping a warning re-arms the alert from this note; if something on the phone is blocking it
 * (notifications, alerts turned off), it opens Settings → Reminder alerts.
 */
export default function ReminderAlertLine({ note }) {
  const [st, setSt] = useState(null);
  const [mountedAt] = useState(() => Date.now()); // "past" only needs to be right when the note was opened
  const navigate = useNavigate();

  const dueText = note.type === 'reminder' ? note.dueDate : note.type === 'event' && !note.allDay ? note.start : null;
  const due = dueText && !DATE_ONLY.test(dueText) ? Date.parse(dueText) : NaN;
  const open = !note.reminderDone && !note.undone && !note.geo && note.format !== 'list';
  const relevant = isNative && open && Number.isFinite(due);

  const load = useCallback(() => {
    QuickRecorder.getReminderStatus({ id: note.id }).then(setSt).catch(() => setSt(null));
  }, [note.id]);

  useEffect(() => {
    if (!relevant) return undefined;
    load();
    const sub = CapApp.addListener('resume', load);
    return () => { sub.then(h => h.remove()); };
  }, [relevant, load, note.dueDate, note.start]);

  if (!relevant || !st) return null;

  const past = due < mountedAt - 60000;
  const toSettings = () => navigate('/settings/places', { state: { reveal: 'reminder-alerts|Reminder alerts' } });

  async function fix() {
    noteChanged(note, 'fixed from the note');
    await new Promise(r => setTimeout(r, 300));
    const next = await QuickRecorder.getReminderStatus({ id: note.id }).catch(() => null);
    setSt(next);
    if (!next || !['set', 'approx'].includes(next.state)) toSettings();
  }

  let text; let warn = false; let action = null;
  if (st.state === 'set') text = `🔔 Alert set for ${when(st.dueAt || due)}`;
  else if (st.state === 'fired') text = `🔔 Alert sent at ${timeOf(st.dueAt || due)}`;
  else if (st.state === 'approx') { text = `⚠ Alert set for ${when(st.dueAt || due)}, may be a few minutes late — tap to fix`; warn = true; action = toSettings; }
  else if (st.state === 'blocked' || st.state === 'off') { text = '⚠ Alert not set — tap to fix'; warn = true; action = toSettings; }
  else if (past) return null;
  else { text = '⚠ Alert not set — tap to fix'; warn = true; action = fix; }

  const cls = `text-xs font-medium ${warn ? 'text-amber-700 dark:text-amber-300' : 'text-navy-500 dark:text-white/50'}`;
  return action ? (
    <button type="button" onClick={action} className={`${cls} min-h-[44px] flex items-center text-left`} data-reminder-alert={st.state}>{text}</button>
  ) : (
    <p className={`${cls} py-2`} data-reminder-alert={st.state}>{text}</p>
  );
}
