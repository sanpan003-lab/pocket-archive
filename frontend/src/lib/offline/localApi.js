// The server, offline (2.9.0): answers the app's /api requests from the local copy and keeps every change as a
// queued request that native code sends — in order — once the NAS is reachable again. Answers have the same shape
// as the server's, so the screens work unchanged. Things only the server can do (AI summaries, reading documents,
// classifying a typed note) are queued and show "Will be processed when online"; things that need the internet
// right now (place search, sharing with someone new, admin) say so.
import * as data from './localData';
import { offlineStore } from './native';

const now = () => new Date().toISOString();
const rand = () => Math.random().toString(36).slice(2, 8);
/** Offline-made ids look like the server's (qn_<ms>_<x>) so every screen accepts them */
export const tempNoteId = () => `qn_${Date.now()}_off${rand()}`;
const tempProjectId = () => `pj_${Date.now()}_off${rand()}`;
const itemId = () => `it_${Date.now().toString(36)}${rand().slice(0, 5)}`;
export const isTempId = id => /_off[a-z0-9]{6}$/.test(String(id || ''));

/** "Needs a connection" — the request can't be done offline */
export class NeedsConnection extends Error {
  constructor(message = 'You’re offline — this needs a connection. Try again when you’re back online.') {
    super(message);
    this.status = 503;
    this.offline = true;
  }
}
const notFound = what => Object.assign(new Error(`${what} isn’t in the offline copy`), { status: 404 });

// ── Queue ───────────────────────────────────────────────────────────────────
async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** FormData → [{ name, value } | { name, file: { base64, type, filename } }] (files up to 40 MB in all) */
async function serializeForm(form) {
  const out = [];
  let total = 0;
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') { out.push({ name, value }); continue; }
    total += value.size;
    if (total > 40 * 1024 * 1024) throw new NeedsConnection('That’s too big to keep offline — send it when you’re back online.');
    out.push({ name, file: { base64: await blobToBase64(value), type: value.type || 'application/octet-stream', filename: value.name || name } });
  }
  return out;
}

async function enqueue(op) {
  const store = await offlineStore();
  if (!store) throw new NeedsConnection();
  const r = await store.enqueue({ op: { ...op, queuedAt: now() } });
  return r?.seq;
}

/** Show a local picture right away (the photo of an offline note): keep it under the URL the screens use */
async function keepMedia(key, blob) {
  if (!blob) return;
  const store = await offlineStore();
  try { await store?.putMedia({ key, base64: await blobToBase64(blob), type: blob.type || 'image/jpeg' }); } catch { /* preview only */ }
}

// ── Notes: local versions of the server's edits ─────────────────────────────
const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);

/** The server's applyOps, item by item (quickCapture.js) */
export function applyOpsLocally(note, ops) {
  const items = [...(note.items || [])];
  const find = id => items.findIndex(i => i.id === id);
  for (const o of ops || []) {
    const i = o.itemId ? find(o.itemId) : -1;
    switch (o.op) {
      case 'addItem': {
        const text = cleanText(o.text, 300);
        if (!text || (o.itemId && i >= 0) || items.length >= 100) break;
        const item = { id: o.itemId || itemId(), text, done: false, v: 1, addedAt: now(), pending: true };
        if (Number.isInteger(o.index) && o.index >= 0 && o.index < items.length) items.splice(o.index, 0, item); else items.push(item);
        break;
      }
      case 'removeItem': if (i >= 0) items.splice(i, 1); break;
      case 'toggleItem': if (i >= 0) items[i] = { ...items[i], done: typeof o.done === 'boolean' ? o.done : !items[i].done, pending: true }; break;
      case 'editItem': { const text = cleanText(o.text, 300); if (i >= 0 && text) items[i] = { ...items[i], text, pending: true }; break; }
      case 'editText': note = { ...note, content: String(o.text ?? '').slice(0, 20000) }; break;
      case 'rename': { const t = cleanText(o.title, 120); if (t) note = { ...note, title: t }; break; }
      default: break;
    }
  }
  return { ...note, items };
}

/** Like the server after a list change: every item checked → done, otherwise open again */
function errandDone(note) {
  const items = note.items || [];
  if ((note.type !== 'errand' && note.format !== 'list') || !items.length) return note;
  const allDone = items.every(i => i.done);
  return { ...note, errandDone: allDone, completedAt: allDone ? (note.completedAt || now()) : null };
}

/** Marks a note as changed here and waiting to be sent (cards show a small "waiting" state) */
const touched = (note, extra = {}) => ({ ...note, updatedAt: now(), offlineEdited: true, ...extra });

async function noteOr404(id) {
  await data.ensureLoaded();
  const n = data.anyNote(id);
  if (!n) throw notFound('That note');
  return n;
}

/** The text version an offline edit started from (for "Edited on another device") */
const baseOf = n => (Number.isInteger(n.baseTextRev) ? n.baseTextRev : (n.textRev || 0));

const PUT_FIELDS = ['type', 'title', 'content', 'start', 'end', 'allDay', 'location', 'dueDate', 'bodyPosition', 'trigger', 'linkedRecordingId'];

// ── Routes ──────────────────────────────────────────────────────────────────
const routes = [];
const on = (method, re, fn) => routes.push({ method, re, fn });
const NOTE = '(qn_[\\w-]+)';

// Session: signed in as before (the copy belongs to this user)
on('GET', /^\/auth\/status$/, async () => {
  const me = await kv('/auth/me');
  if (!me) throw new NeedsConnection();
  return { authenticated: true, user: me, offline: true };
});
on('GET', /^\/auth\/media-token$/, async () => ({ token: 'offline', offline: true }));
on('GET', /^\/health$/, async () => { throw new NeedsConnection(); });

// Notes
on('GET', /^\/quick$/, async ({ query }) => {
  await data.ensureLoaded();
  let list = data.ownNotes();
  if (query.all !== '1') list = list.filter(n => !n.hidden);
  if (query.projectId) list = list.filter(n => n.projectId === query.projectId);
  if (query.status) list = list.filter(n => n.status === query.status);
  return data.sortedNotes(list);
});
on('GET', new RegExp(`^/quick/${NOTE}$`), async ({ m }) => noteOr404(m[1]));
on('GET', /^\/quick\/search$/, async () => []);
on('GET', /^\/find$/, async ({ query }) => {
  await data.ensureLoaded();
  const me = await kv('/auth/me');
  let recordings = null;
  if (query.recordings === '1' && me?.role === 'admin' && query.q) {
    const store = await offlineStore();
    const q = String(query.q).trim();
    const longest = q.split(/\s+/).sort((a, b) => b.length - a.length)[0];
    const [whole, word] = await Promise.all([q, longest].map(x => store?.searchArchive?.({ q: x }).then(r => r.items || []).catch(() => []) ?? []));
    recordings = x => (x === q ? whole : word);
  }
  return data.core.find({ pool: data.searchPool(), user: me, qs: query, searchRecordings: recordings });
});
on('GET', /^\/shared$/, async () => {
  await data.ensureLoaded();
  return { notes: data.sharedNotes().filter(n => !n.undone && !n.hidden).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')), projects: data.sharedProjects() };
});
on('GET', /^\/changes$/, async () => ({ changes: [], at: now() }));
on('GET', /^\/actions$/, async ({ query }) => {
  await data.ensureLoaded();
  const ICON = { alarm: '⏰', timer: '⏲', navigate: '📍', message: '💬', call: '📞', dnd: '🔕', flashlight: '🔦', openApp: '📱' };
  return data.sortedNotes(data.ownNotes().filter(n => n.type === 'action' && !n.undone && (!query.filter || n.action?.filter === query.filter)))
    .map(n => ({ id: n.id, title: n.title, icon: ICON[n.action?.kind] || '⚡', capturedAt: n.capturedAt || n.createdAt, parentId: n.parentId || null, transcript: n.transcript || null, action: n.action, clientId: n.clientId || null }));
});

// Projects (computed from the local notes, like projects.js)
on('GET', /^\/projects$/, async ({ query }) => {
  await data.ensureLoaded();
  if (query.deleted === '1') return (await kv('/projects?deleted=1')) || [];
  return data.projects().map(p => ({ ...p, noteCount: (p.noteIds || []).filter(id => { const n = data.anyNote(id); return n && !n.undone; }).length }));
});
on('GET', /^\/projects\/(pj_[\w-]+)$/, async ({ m }) => {
  await data.ensureLoaded();
  const p = data.projects().find(x => x.id === m[1]) || data.sharedProjects().find(x => x.id === m[1]);
  if (!p) throw notFound('That project');
  return withNotes(p);
});
function withNotes(p) {
  return {
    ...p,
    notes: (p.noteIds || []).map(data.anyNote).filter(n => n && !n.undone)
      .sort((a, b) => (b.capturedAt || b.createdAt || '').localeCompare(a.capturedAt || a.createdAt || '')),
  };
}

// ── Changes ─────────────────────────────────────────────────────────────────
// Typed note / checklist: kept here at once, classified by the server when it arrives
on('POST', /^\/quick\/text$/, async ({ body }) => {
  const id = tempNoteId();
  const clientId = body.clientId || `off-${id}`;
  const items = (body.items || []).map(t => (typeof t === 'string' ? t : t?.text)).map(t => cleanText(t, 300)).filter(Boolean)
    .map(text => ({ id: itemId(), text, done: false, v: 1 }));
  const content = cleanText(body.body, 20000);
  const firstLine = content.split('\n').find(Boolean) || items[0]?.text || 'New note';
  const note = {
    id, clientId, createdAt: now(), capturedAt: now(), updatedAt: now(), source: 'text', type: 'note',
    title: cleanText(body.title, 120) || firstLine.slice(0, 80), content, items, format: items.length ? 'list' : null,
    color: body.color || null, status: 'saved', offline: { queuedAt: now(), pending: body.aiOrganize !== false ? ['organize'] : [] },
  };
  await data.saveNote(note);
  await enqueue({ method: 'POST', path: '/api/quick/text', body: { ...body, clientId }, tempId: id, createsNote: true, label: 'New note' });
  return { note, confirmation: { icon: '📥', text: 'Saved on this phone', detail: 'Sends when you’re back online', tone: 'queued' } };
});

// Photo / drawing / scan / document: the picture shows at once, the server reads it later
async function mediaCreate({ form }, path, kindOf) {
  const id = tempNoteId();
  const clientId = form.get('clientId') || `off-${id}`;
  if (!form.get('clientId')) form.append('clientId', clientId);
  const file = form.get('file') || form.get('page');
  const caption = String(form.get('caption') || '').trim();
  const note = {
    id, clientId, createdAt: now(), capturedAt: now(), updatedAt: now(), source: kindOf(form), type: 'note',
    title: String(form.get('title') || '').trim() || (kindOf(form) === 'scan' ? 'Scanned document' : 'Photo'), content: caption,
    media: file ? { file: 'offline', kind: form.get('kind') === 'drawing' ? 'drawing' : 'image' } : null,
    status: 'saved', offline: { queuedAt: now(), pending: ['read'] },
  };
  await keepMedia(`/api/quick/${id}/media`, file);
  await data.saveNote(note);
  await enqueue({ method: 'POST', path, form: await serializeForm(form), tempId: id, createsNote: true, label: note.title });
  return { note, confirmation: { icon: '📥', text: 'Saved on this phone', detail: 'Read and filed when you’re back online', tone: 'queued' } };
}
on('POST', /^\/quick\/media$/, async req => mediaCreate(req, '/api/quick/media', f => (f.get('kind') === 'drawing' ? 'drawing' : 'photo')));
on('POST', /^\/quick\/document$/, async req => mediaCreate(req, '/api/quick/document', f => (f.getAll('page').length || f.get('kind') === 'scan' ? 'scan' : 'camera')));

// Edit fields (title, text, type, dates…)
on('PUT', new RegExp(`^/quick/${NOTE}$`), async ({ m, body }) => {
  const n = await noteOr404(m[1]);
  if (n.undone) throw Object.assign(new Error('This capture was undone and can no longer be edited'), { status: 409 });
  const base = baseOf(n);
  const next = { ...n };
  for (const k of PUT_FIELDS) if (body[k] !== undefined) next[k] = body[k];
  if (Array.isArray(body.items)) next.items = body.items;
  if (next.status === 'needs_review') next.status = 'ok';
  const saved = await data.saveNote(touched(errandDone(next), { baseTextRev: base }));
  const textChange = body.title !== undefined || body.content !== undefined;
  await enqueue({ method: 'PUT', path: `/api/quick/${n.id}`, body: textChange ? { ...body, baseTextRev: base } : body, noteId: n.id, label: 'Edit' });
  return saved;
});

// Checklist and text as item-level changes (they always merge per item)
on('POST', new RegExp(`^/quick/${NOTE}/ops$`), async ({ m, body }) => {
  const n = await noteOr404(m[1]);
  const ops = Array.isArray(body.ops) ? body.ops.map(o => (o.op === 'addItem' && !o.itemId ? { ...o, itemId: itemId() } : o)) : [];
  const base = baseOf(n);
  const saved = await data.saveNote(touched(applyOpsLocally(n, ops), { baseTextRev: base }));
  const textOps = ops.some(o => o.op === 'editText' || o.op === 'rename');
  await enqueue({ method: 'POST', path: `/api/quick/${n.id}/ops`, body: textOps ? { ops, baseTextRev: base } : { ops }, noteId: n.id, label: 'List change' });
  return { note: saved, applied: ops.map(o => ({ op: o.op, itemId: o.itemId })), skipped: [] };
});
on('PATCH', new RegExp(`^/quick/${NOTE}/items$`), async ({ m, body }) => {
  const n = await noteOr404(m[1]);
  const { action, itemId: iid, text, done, order } = body;
  let next;
  if (action === 'reorder') {
    const by = new Map((n.items || []).map(i => [i.id, i]));
    next = { ...n, items: (order || []).map(id => by.get(id)).filter(Boolean) };
  } else {
    const op = { toggle: 'toggleItem', add: 'addItem', edit: 'editItem', remove: 'removeItem' }[action];
    if (!op) throw Object.assign(new Error('action must be toggle, add, edit, remove or reorder'), { status: 400 });
    next = applyOpsLocally(n, [{ op, itemId: iid || (op === 'addItem' ? itemId() : undefined), text, done }]);
  }
  const saved = await data.saveNote(touched(errandDone(next)));
  await enqueue({ method: 'PATCH', path: `/api/quick/${n.id}/items`, body, noteId: n.id, label: 'List change' });
  return saved;
});
on('PATCH', new RegExp(`^/quick/${NOTE}/meta$`), async ({ m, body }) => {
  const n = await noteOr404(m[1]);
  const next = { ...n };
  if (typeof body.pinned === 'boolean') { next.pinned = body.pinned; next.pinnedAt = body.pinned ? now() : null; }
  if (body.color !== undefined) next.color = body.color;
  const saved = await data.saveNote(touched(next));
  await enqueue({ method: 'PATCH', path: `/api/quick/${n.id}/meta`, body, noteId: n.id, label: 'Pin / color' });
  return saved;
});
on('POST', new RegExp(`^/quick/${NOTE}/undo$`), async ({ m }) => {
  const n = await noteOr404(m[1]);
  // A note made offline too: the queue sends its creation first, then this (with the real id)
  const saved = await data.saveNote(touched(n, { undone: true, undoneAt: now() }));
  await enqueue({ method: 'POST', path: `/api/quick/${n.id}/undo`, noteId: n.id, label: 'Delete' });
  return saved;
});
on('POST', new RegExp(`^/quick/${NOTE}/restore$`), async ({ m }) => {
  const n = await noteOr404(m[1]);
  const saved = await data.saveNote(touched(n, { undone: false, undoneAt: null }));
  await enqueue({ method: 'POST', path: `/api/quick/${n.id}/restore`, noteId: n.id, label: 'Restore' });
  return saved;
});
on('POST', new RegExp(`^/quick/${NOTE}/done$`), async ({ m, body }) => {
  const n = await noteOr404(m[1]);
  const done = body?.done !== false;
  const next = n.geo && n.type !== 'errand' && n.format !== 'list'
    ? { ...n, reminderDone: done, geo: { ...n.geo, status: done ? 'done' : 'active', doneAt: done ? now() : null } }
    : { ...n, errandDone: done, completedAt: done ? (n.completedAt || now()) : null };
  const saved = await data.saveNote(touched(next));
  await enqueue({ method: 'POST', path: `/api/quick/${n.id}/done`, body: { done }, noteId: n.id, label: done ? 'Done' : 'Reopen' });
  return saved;
});

// AI and reading: the server does it once the request arrives
const AI = [
  ['summarize', 'summary'], ['retry', 'organize'], ['document/process', 'read'], ['handwriting', 'handwriting'],
];
for (const [route, what] of AI) {
  on('POST', new RegExp(`^/quick/${NOTE}/${route}$`), async ({ m }) => {
    const n = await noteOr404(m[1]);
    const pending = [...new Set([...(n.offline?.pending || []), what])];
    const saved = await data.saveNote(touched(n, { offline: { ...(n.offline || {}), queuedAt: n.offline?.queuedAt || now(), pending } }));
    await enqueue({ method: 'POST', path: `/api/quick/${n.id}/${route}`, noteId: n.id, label: 'AI' });
    return route === 'retry' ? { note: saved } : saved;
  });
}
on('POST', new RegExp(`^/quick/${NOTE}/attachments/([\\w-]+)/read$`), async ({ m }) => {
  const n = await noteOr404(m[1]);
  const attachments = (n.attachments || []).map(a => (a.id === m[2] ? { ...a, textStatus: 'reading', offlinePending: true } : a));
  const saved = await data.saveNote(touched(n, { attachments }));
  await enqueue({ method: 'POST', path: `/api/quick/${n.id}/attachments/${m[2]}/read`, noteId: n.id, label: 'Read text' });
  return saved;
});

// Attachments: added at once (preview), uploaded later (the same clientId never adds a second copy)
on('POST', new RegExp(`^/quick/${NOTE}/attachments$`), async ({ m, form }) => {
  const n = await noteOr404(m[1]);
  const file = form.get('file') || form.get('page');
  const clientId = form.get('clientId') || `off-${rand()}${rand()}`;
  if (!form.get('clientId')) form.append('clientId', clientId);
  const aid = `att_off${rand()}`;
  const isImage = /^image\//.test(file?.type || '');
  const att = {
    id: aid, name: String(form.get('name') || file?.name || 'Attachment'), mime: file?.type || 'application/octet-stream', size: file?.size || 0,
    kind: isImage ? 'image' : 'file', file: 'offline', thumb: false, source: String(form.get('source') || 'file'), addedAt: now(), pending: true,
  };
  if (isImage) await keepMedia(`/api/quick/${n.id}/attachments/${aid}`, file);
  const saved = await data.saveNote(touched(n, { attachments: [...(n.attachments || []), att] }));
  await enqueue({ method: 'POST', path: `/api/quick/${n.id}/attachments`, form: await serializeForm(form), noteId: n.id, label: 'Attachment' });
  return saved;
});
on('PATCH', new RegExp(`^/quick/${NOTE}/attachments/([\\w-]+)$`), async ({ m, body }) => {
  const n = await noteOr404(m[1]);
  const saved = await data.saveNote(touched(n, { attachments: (n.attachments || []).map(a => (a.id === m[2] ? { ...a, name: cleanText(body.name, 120) || a.name } : a)) }));
  await enqueue({ method: 'PATCH', path: `/api/quick/${n.id}/attachments/${m[2]}`, body, noteId: n.id, label: 'Rename' });
  return saved;
});
on('DELETE', new RegExp(`^/quick/${NOTE}/attachments/([\\w-]+)$`), async ({ m }) => {
  const n = await noteOr404(m[1]);
  const saved = await data.saveNote(touched(n, { attachments: (n.attachments || []).filter(a => a.id !== m[2]) }));
  await enqueue({ method: 'DELETE', path: `/api/quick/${n.id}/attachments/${m[2]}`, noteId: n.id, label: 'Remove attachment' });
  return saved;
});

// Combine: the main note gets the others' text now; the server does the real merge when it arrives
on('POST', /^\/quick\/combine$/, async ({ body }) => {
  await data.ensureLoaded();
  const main = data.ownNote(body.mainId);
  if (!main) throw notFound('That note');
  const others = (body.ids || []).filter(id => id !== main.id).map(data.ownNote).filter(Boolean);
  const groupId = `grp_off${rand()}`;
  for (const o of others) await data.saveNote(touched(o, { hidden: true, mergedInto: main.id }));
  const merged = touched(main, {
    title: cleanText(body.title, 120) || main.title,
    content: [main.content, ...others.map(o => [o.title, o.content].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n'),
    items: [...(main.items || []), ...others.flatMap(o => o.items || [])],
    offline: { ...(main.offline || {}), queuedAt: now(), pending: [...new Set([...(main.offline?.pending || []), 'combine'])] },
  });
  await data.saveNote(merged);
  await enqueue({ method: 'POST', path: '/api/quick/combine', body, noteId: main.id, label: 'Combine' });
  return { note: merged, groupId, combined: others.length + 1 };
});

// Move to a project (or out of one)
on('POST', /^\/projects\/(pj_[\w-]+)\/notes$/, async ({ m, body }) => {
  await data.ensureLoaded();
  const list = data.projects().map(p => ({ ...p, noteIds: [...(p.noteIds || [])] }));
  const p = list.find(x => x.id === m[1]);
  if (!p) throw notFound('That project');
  for (const id of body.noteIds || []) {
    const n = data.ownNote(id);
    if (!n) continue;
    if (n.projectId && n.projectId !== p.id) { const old = list.find(x => x.id === n.projectId); if (old) old.noteIds = old.noteIds.filter(x => x !== id); }
    if (!p.noteIds.includes(id)) p.noteIds.unshift(id);
    await data.saveNote(touched(n, { projectId: p.id }));
  }
  await data.saveProjects(list);
  await enqueue({ method: 'POST', path: `/api/projects/${p.id}/notes`, body, label: 'Move to project' });
  return withNotes(p);
});
on('DELETE', /^\/projects\/(pj_[\w-]+)\/notes\/(qn_[\w-]+)$/, async ({ m }) => {
  await data.ensureLoaded();
  const list = data.projects().map(p => (p.id === m[1] ? { ...p, noteIds: (p.noteIds || []).filter(x => x !== m[2]) } : p));
  const p = list.find(x => x.id === m[1]);
  if (!p) throw notFound('That project');
  const n = data.ownNote(m[2]);
  if (n) await data.saveNote(touched(n, { projectId: null }));
  await data.saveProjects(list);
  await enqueue({ method: 'DELETE', path: `/api/projects/${m[1]}/notes/${m[2]}`, label: 'Remove from project' });
  return withNotes(p);
});
on('POST', /^\/projects$/, async ({ body }) => {
  await data.ensureLoaded();
  const name = cleanText(body.name, 80);
  if (!name) throw Object.assign(new Error('Give the project a name'), { status: 400 });
  const existing = data.projects().find(p => p.status !== 'archived' && p.name.toLowerCase() === name.toLowerCase());
  if (existing && body.allowDuplicate !== true) throw Object.assign(new Error(`“${existing.name}” already exists`), { status: 409, data: { project: existing } });
  const p = { id: tempProjectId(), name, aliases: body.aliases || [], noteIds: [], status: 'active', createdAt: now(), updatedAt: now(), clientId: `off-${rand()}${rand()}`, offline: { queuedAt: now() } };
  await data.saveProjects([p, ...data.projects()]);
  await enqueue({ method: 'POST', path: '/api/projects', body: { ...body, clientId: p.clientId }, tempId: p.id, createsProject: true, label: 'New project' });
  return p;
});
on('PUT', /^\/projects\/(pj_[\w-]+)$/, async ({ m, body }) => {
  await data.ensureLoaded();
  const list = data.projects().map(p => (p.id === m[1] ? { ...p, ...(body.name ? { name: cleanText(body.name, 80) } : {}), ...(body.aliases ? { aliases: body.aliases } : {}), ...(body.status ? { status: body.status } : {}), updatedAt: now() } : p));
  const p = list.find(x => x.id === m[1]);
  if (!p) throw notFound('That project');
  await data.saveProjects(list);
  await enqueue({ method: 'PUT', path: `/api/projects/${m[1]}`, body, label: 'Project' });
  return withNotes(p);
});

// Settings kept as the server's answers: change them here, send later
const SETTINGS = ['/appearance', '/quick/settings', '/notify-settings', '/documents/settings', '/actions/settings'];
for (const key of SETTINGS) {
  on('PUT', new RegExp(`^${key.replace(/\//g, '\\/')}$`), async ({ body }) => {
    const cur = (await kv(key)) || {};
    const next = key === '/appearance'
      ? { ...cur, ...Object.fromEntries(Object.entries(body || {}).map(([g, v]) => [g, { ...(cur[g] || {}), ...v }])), updatedAt: now() }
      : { ...cur, ...body };
    const store = await offlineStore();
    await store?.putKv({ key, value: next });
    await enqueue({ method: 'PUT', path: `/api${key}`, body, label: 'Settings' });
    return next;
  });
}

// ── Saved answers ───────────────────────────────────────────────────────────
export function kvKey(path, query) {
  const q = Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').sort(([a], [b]) => a.localeCompare(b));
  return q.length ? `${path}?${q.map(([k, v]) => `${k}=${v}`).join('&')}` : path;
}
async function kv(key) {
  const store = await offlineStore();
  try { return (await store?.getKv({ key }))?.value ?? null; } catch { return null; }
}

/** GETs whose answer is kept for offline use (exact path + query) */
export const KV_ROUTES = [
  /^\/auth\/me$/, /^\/appearance$/, /^\/quick\/settings$/, /^\/places$/, /^\/notify-settings$/, /^\/documents\/settings$/,
  /^\/actions\/settings$/, /^\/location-reminders$/, /^\/errands\/active$/, /^\/maps\/status$/, /^\/share\/people$/,
  /^\/recordings$/, /^\/recordings\/[\w.-]+$/, /^\/recordings\/[\w.-]+\/attachments$/, /^\/stats$/, /^\/recordings\/deleted$/,
  /^\/projects$/, /^\/calendar\/setup$/,
];

/**
 * Answer a request from the offline copy. req: { method, path (after /api), query, body (object), form (FormData) }.
 * → { status, data }. Throws NeedsConnection (or an error with .status) like the server would.
 */
export async function handleLocal(req) {
  const method = req.method.toUpperCase();
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = req.path.match(r.re);
    if (!m) continue;
    const result = await r.fn({ ...req, m, query: req.query || {}, body: req.body || {} });
    return { status: 200, data: result };
  }
  if (method === 'GET') {
    const value = await kv(kvKey(req.path, req.query));
    if (value != null) return { status: 200, data: value };
  }
  throw new NeedsConnection();
}

/** Is there a local answer / local version of this request (vs. "needs a connection")? */
export function handledLocally(method, path) {
  const M = method.toUpperCase();
  return routes.some(r => r.method === M && r.re.test(path)) || (M === 'GET' && KV_ROUTES.some(re => re.test(path)));
}
