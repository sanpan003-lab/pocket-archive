import { isNative } from './platform';
import { QuickRecorder } from '../native/quickRecorder';

// Timed-reminder alerts (2.12.0, 2.12.1): keep the phone's local alarms in step with every reminder / event
// the web layer sees — saved, edited, completed, deleted, created offline (the offline adapter answers first).
// The native side decides what to arm (reminder dueDate, event start) and logs why; the server's list
// (GET /api/reminders/timed, pulled on every sync) stays the source of truth for what no longer exists.

const NOTE_ID = /^qn_[\w-]+$/;
const ignore = () => {};
const seen = new Map(); // id → signature, so list polling doesn't call the bridge for unchanged notes

const isTimedCandidate = n => n && (n.type === 'reminder' || n.type === 'event') && NOTE_ID.test(String(n.id || ''));
const signature = n => [n.type, n.dueDate, n.start, n.allDay, n.reminderDone, n.undone, n.hidden, n.cancelled, n.status, !!n.geo, n.title].join('|');

/** One note came back from the server / offline copy */
export function noteChanged(note, source = 'saved in the app') {
  if (!isNative || !isTimedCandidate(note)) return;
  seen.set(note.id, signature(note));
  QuickRecorder.noteSeen({ note, source }).catch(ignore);
}

/** A list of notes (inbox, calendar, search): only notes that changed since last seen */
function notesSeen(list) {
  for (const n of list.slice(0, 300)) {
    if (!isTimedCandidate(n) || seen.get(n.id) === signature(n)) continue;
    noteChanged(n, 'found in a list');
  }
}

/** A request succeeded */
export function responseSeen(config, data) {
  if (!isNative) return;
  const url = String(config?.url || '').split('?')[0];
  const method = String(config?.method || 'get').toLowerCase();
  if (method === 'post' && /^\/quick\/(text|capture|media)$/.test(url)) { noteChanged(data?.note || data); return; } // a new note
  if (method === 'get' && /^\/quick(\/inbox|\/recent)?$/.test(url)) {
    const list = Array.isArray(data) ? data : data?.notes || data?.items;
    if (Array.isArray(list)) notesSeen(list);
    return;
  }
  const m = url.match(/^\/quick\/(qn_[\w-]+)(\/[\w-]+)?$/);
  if (!m) return;
  if (method === 'delete' && !m[2]) { QuickRecorder.cancelReminder({ id: m[1], reason: 'Deleted' }).catch(ignore); seen.delete(m[1]); return; }
  if (method === 'post' && m[2] === '/undo') { QuickRecorder.cancelReminder({ id: m[1], reason: 'Undone' }).catch(ignore); seen.delete(m[1]); return; }
  if (method !== 'get' || !m[2]) noteChanged(data?.note || data);
}
