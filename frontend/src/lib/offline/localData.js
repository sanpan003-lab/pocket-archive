// The offline copy as the web layer sees it (2.9.0): notes (own + shared with you), projects, saved server answers
// (settings, places, recordings…), kept in memory while the app runs and refreshed when native sync changes it.
import { offlineStore } from './native';
import { createSearchCore } from './searchCore';

// The server's document kinds and the same search code as GET /api/find
export const core = createSearchCore();

const state = {
  loaded: null,                 // Promise while loading / once loaded
  notes: new Map(),             // own notes
  shared: new Map(),            // shared with you (sharedFrom)
  projects: [],
  sharedProjects: [],
  entries: new Map(),           // search entries by id (rebuilt when updatedAt changes)
};

async function loadAll() {
  const store = await offlineStore();
  if (!store) return false;
  const [notes, shared, projects, sharedProjects] = await Promise.all(
    ['notes', 'shared', 'projects', 'sharedProjects'].map(kind => store.getAll({ kind }).then(r => r.items || []).catch(() => [])),
  );
  state.notes = new Map(notes.map(n => [n.id, n]));
  state.shared = new Map(shared.map(n => [n.id, n]));
  state.projects = projects;
  state.sharedProjects = sharedProjects;
  return true;
}

/** Load once (and again after sync changed things — see reload) */
export function ensureLoaded() {
  if (!state.loaded) state.loaded = loadAll().catch(() => { state.loaded = null; return false; });
  return state.loaded;
}

export function reload() {
  state.loaded = loadAll().catch(() => { state.loaded = null; return false; });
  return state.loaded;
}

export const ownNote = id => state.notes.get(id) || null;
export const sharedNote = id => state.shared.get(id) || null;
export const anyNote = id => ownNote(id) || sharedNote(id);
export const ownNotes = () => [...state.notes.values()];
export const sharedNotes = () => [...state.shared.values()];
export const projects = () => state.projects;
export const sharedProjects = () => state.sharedProjects;

/** A local change (offline edit): keep it here and in the native copy */
export async function saveNote(note) {
  const map = note.sharedFrom ? state.shared : state.notes;
  map.set(note.id, note);
  const store = await offlineStore();
  await store?.putNotes({ notes: [note], kind: note.sharedFrom ? 'shared' : 'notes' });
  return note;
}

/** A note made offline got its real id on upload: the same note, under the new id (until the next sync) */
export function renameNote(tempId, id) {
  const n = state.notes.get(tempId);
  if (!n) return;
  state.notes.delete(tempId);
  if (!state.notes.has(id)) state.notes.set(id, { ...n, id });
}

export async function dropNote(id) {
  state.notes.delete(id);
  const store = await offlineStore();
  await store?.removeNote({ id });
}

export async function saveProjects(list) {
  state.projects = list;
  const store = await offlineStore();
  await store?.putKv({ key: '__projects', value: list });
}

/** Note list in the server's order (newest created first) */
export function sortedNotes(list) {
  return [...list].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// ── Search pool with cached entries ─────────────────────────────────────────
function entry(n) {
  const cached = state.entries.get(n.id);
  const stamp = `${n.updatedAt || ''}|${n.title}|${n.textRev || 0}|${(n.items || []).length}`;
  if (cached && cached.stamp === stamp) return cached.entry;
  const e = core.entryFor(n);
  state.entries.set(n.id, { stamp, entry: e });
  return e;
}

export function searchPool() {
  return core.pool({
    own: ownNotes().map(entry),
    shared: sharedNotes(),
    ownProjects: projects(),
    sharedProjects: sharedProjects(),
  });
}

/** Tests: forget everything (sign-out wipe) */
export function clearMemory() {
  state.notes = new Map(); state.shared = new Map(); state.projects = []; state.sharedProjects = []; state.entries = new Map();
  state.loaded = null;
}
