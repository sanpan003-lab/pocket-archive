import { isNative } from './platform';
import { QuickRecorder } from '../native/quickRecorder';

// Timed-reminder alerts (2.12.0): keep the phone's local alarms in step with every reminder the
// web layer saves, edits, completes or deletes — also offline (the offline adapter answers first).
// The server's list (GET /api/reminders/timed, pulled on every sync) stays the source of truth.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const NOTE_ID = /^qn_[\w-]+$/;

const ignore = () => {};

/** One note came back from the server / offline copy */
export function noteChanged(note) {
  if (!isNative || !note || typeof note !== 'object' || !NOTE_ID.test(String(note.id || '')) || note.type !== 'reminder') return;
  const due = typeof note.dueDate === 'string' ? note.dueDate : '';
  const open = !note.reminderDone && !note.undone && !note.hidden && !note.cancelled && !note.geo && note.format !== 'list' && note.status !== 'pending_decision';
  if (!open || !due || DATE_ONLY.test(due)) {
    QuickRecorder.cancelReminder({ id: note.id }).catch(ignore);
  } else if (HAS_ZONE.test(due) && Number.isFinite(Date.parse(due))) {
    QuickRecorder.scheduleReminder({ id: note.id, title: String(note.title || ''), text: String(note.content || note.title || '').slice(0, 300), dueAt: Date.parse(due) }).catch(ignore);
  } else {
    QuickRecorder.syncReminders().catch(ignore); // no zone in the value: let the server work out the instant
  }
}

/** A request for /quick/<id> succeeded */
export function responseSeen(config, data) {
  if (!isNative) return;
  const url = String(config?.url || '');
  const method = String(config?.method || 'get').toLowerCase();
  if (method === 'post' && /^\/quick\/(text|capture|media)$/.test(url)) { noteChanged(data?.note || data); return; } // a new note
  const m = url.match(/^\/quick\/(qn_[\w-]+)(\/[\w-]+)?$/);
  if (!m) return;
  if (method === 'delete' && !m[2]) { QuickRecorder.cancelReminder({ id: m[1] }).catch(ignore); return; }
  if (method !== 'get' || !m[2]) noteChanged(data?.note || data);
}
