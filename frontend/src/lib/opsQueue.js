import { useSyncExternalStore } from 'react';
import { applyNoteOps } from './api';

// Checklist changes (add / check / edit / remove) as item-level operations. They're queued here first
// (localStorage, per signed-in user), shown at once, and sent when there's a connection. Replays are
// harmless on the server (client item ids; missing items are skipped), so a retry never duplicates.

const keyFor = () => {
  let uid = 'anon';
  try { uid = JSON.parse(localStorage.getItem('pa_user') || '{}').id || 'anon'; } catch { /* ignore */ }
  return `pa_opsQueue:${uid}`;
};

let version = 0;
const listeners = new Set();
const emit = () => { version += 1; listeners.forEach(fn => fn()); };

function read() {
  try { return JSON.parse(localStorage.getItem(keyFor()) || '[]'); } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(keyFor(), JSON.stringify(list)); } catch { /* storage full: they're still sent now */ }
  emit();
}

export const newItemId = () => `it_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Queue ops for a note and try to send them */
export function queueOps(noteId, ops) {
  write([...read(), ...ops.map(op => ({ qid: newItemId(), noteId, op, at: Date.now() }))]);
  return flushOps();
}

export const pendingOps = noteId => read().filter(e => e.noteId === noteId).map(e => e.op);

/** The note as it will be once the queued ops reach the server (what the user sees) */
export function withPendingOps(note) {
  const ops = note ? pendingOps(note.id) : [];
  if (!ops.length) return note;
  let items = [...(note.items || [])];
  let title = note.title;
  for (const op of ops) {
    if (op.op === 'addItem' && !items.some(i => i.id === op.itemId)) {
      const item = { id: op.itemId, text: op.text, done: false, pending: true };
      if (Number.isInteger(op.index)) items.splice(op.index, 0, item); else items.push(item);
    } else if (op.op === 'removeItem') items = items.filter(i => i.id !== op.itemId);
    else if (op.op === 'toggleItem') items = items.map(i => (i.id === op.itemId ? { ...i, done: !!op.done, pending: true } : i));
    else if (op.op === 'editItem') items = items.map(i => (i.id === op.itemId ? { ...i, text: op.text, pending: true } : i));
    else if (op.op === 'rename') title = op.title;
  }
  return { ...note, items, title };
}

/** Re-render when the queue changes; returns the number of queued ops */
export function useOpsQueue() {
  useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => version);
  return read().length;
}

let flushing = null;
/** After the server took a batch: the saved note (open views replace their copy) */
export const NOTE_UPDATED = 'pa:note-updated';
/** The server refused a batch for good (access removed, note gone): { noteId, message } */
export const OPS_REJECTED = 'pa:ops-rejected';

export function flushOps() {
  if (flushing) return flushing;
  flushing = (async () => {
    for (;;) {
      const list = read();
      if (!list.length) break;
      const noteId = list[0].noteId;
      const batch = [];
      for (const e of list) { if (e.noteId !== noteId) break; batch.push(e); }
      const sent = new Set(batch.map(e => e.qid));
      try {
        const r = await applyNoteOps(noteId, batch.map(e => e.op));
        write(read().filter(e => !sent.has(e.qid)));
        window.dispatchEvent(new CustomEvent(NOTE_UPDATED, { detail: r.note }));
      } catch (err) {
        if (!err.response || err.response.status >= 500 || err.response.status === 429) break; // offline: keep, retry later
        // Refused for good (no access any more, note gone): drop that batch
        write(read().filter(e => !sent.has(e.qid)));
        window.dispatchEvent(new CustomEvent(OPS_REJECTED, { detail: { noteId, message: err.response.data?.error || 'That change could not be saved' } }));
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Send queued ops when the connection comes back, the app resumes, or every 30 s while some wait */
export function startOpsFlusher() {
  const kick = () => { if (read().length) flushOps(); };
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', kick);
  const timer = setInterval(kick, 30000);
  kick();
  return () => {
    window.removeEventListener('online', kick);
    document.removeEventListener('visibilitychange', kick);
    clearInterval(timer);
  };
}
