// Smart append: a new voice note can add to, update, or cancel an existing
// errand, note, event/reminder or project — explicitly ("add eggs to my Publix
// list", "for the Tesla drawer project", "move the dentist to 4") or by
// automatic detection. Also: Merge into…, Combine notes, Undo / Move / Split back.
//
// Every change is recorded in an audit log on the target ({ captureId, kind,
// before, after, … }) so Undo can reverse exactly that change, even after
// later edits (e.g. items checked off since).

const QUICK_ID_RE = /^qn_\d+_[a-z0-9]+$/;
const DEFAULT_SETTINGS = { autoApply: 0.85, ask: 0.6, alwaysAskCancel: true, alwaysAskEventChanges: false };
const ASK_TIMEOUT_MS = 2 * 60 * 1000;
const TARGET_TYPES = ['errand', 'note', 'project', 'event', 'reminder', 'recording'];

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const singular = w => (w.length > 3
  ? w.replace(/ies$/, 'y').replace(/(ch|sh|ss|x|z)es$/, '$1').replace(/([^s])s$/, '$1')
  : w);
/** "Eggs" ≡ "egg", "Tomatoes" ≡ "tomato", "2 boxes of screws" stays itself */
const itemKey = t => norm(t).split(' ').map(singular).join(' ');
const sameItem = (a, b) => {
  const x = itemKey(a), y = itemKey(b);
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
};
/** Errands and typed checklists both have items */
const hasList = n => n.type === 'errand' || n.format === 'list';
const plain = md => String(md || '').replace(/<[^>]+>/g, ' ').replace(/[#*_`>|-]+/g, ' ').replace(/\s+/g, ' ').trim();
const oneLine = (n, max = 110) => plain(n.summary || n.content || n.transcript || '').slice(0, max);
const uid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function createAppender(ctx) {
  const { store, projects, deps } = ctx;

  // ── Settings (config.json → quickSettings) ────────────────────────────────
  function settings() {
    return { ...DEFAULT_SETTINGS, ...(deps.getConfig?.().quickSettings || {}) };
  }
  function saveSettings(patch) {
    const config = deps.getConfig();
    const next = { ...settings() };
    for (const k of ['autoApply', 'ask']) {
      if (patch[k] !== undefined) {
        const v = Number(patch[k]);
        if (!(v >= 0.3 && v <= 1)) throw Object.assign(new Error(`${k} must be between 0.3 and 1`), { status: 400 });
        next[k] = Math.round(v * 100) / 100;
      }
    }
    if (next.ask > next.autoApply) next.ask = next.autoApply;
    for (const k of ['alwaysAskCancel', 'alwaysAskEventChanges']) if (typeof patch[k] === 'boolean') next[k] = patch[k];
    config.quickSettings = next;
    deps.saveConfig(config);
    return next;
  }

  // ── Visibility helpers ────────────────────────────────────────────────────
  const visible = n => n && !n.undone && !n.hidden && n.status !== 'pending_decision';
  const isEventLike = n => n.type === 'event' || n.type === 'reminder';
  const whenOf = n => n.type === 'reminder' ? n.dueDate : n.start;

  function readTarget(type, id) {
    if (!id) return null;
    if (type === 'project') {
      const p = projects.read(id);
      return p && !p.deleted ? { type, id, title: p.name, project: p } : null;
    }
    if (type === 'recording') {
      return deps.recordingExists(id) ? { type, id, title: deps.getRecordingTitle(id) || id } : null;
    }
    if (!QUICK_ID_RE.test(id)) return null;
    const n = store.read(id);
    if (!visible(n)) return null;
    const actualType = n.type === 'errand' ? 'errand' : isEventLike(n) ? n.type : 'note';
    return { type: actualType, id, title: `${errandName(n) || n.title}${ownerHint(n)}`, note: n };
  }

  const errandName = n => (n.type === 'errand' ? (n.place?.query || n.placeSpec?.query ? `${n.place?.query || n.placeSpec.query} list` : n.title) : null);
  const ownerHint = n => (n?.sharedFrom?.name ? ` (${n.sharedFrom.name}'s, shared)` : '');

  // ── Candidates for the classifier (kept small) ────────────────────────────
  function candidates(now = new Date()) {
    const all = store.list().filter(visible);
    const day = 86400000;
    const errands = all.filter(n => n.type === 'errand' && !n.errandDone).slice(0, 15);
    const recent = all.filter(n => n.type !== 'errand' && !isEventLike(n) &&
      now - new Date(n.capturedAt || n.createdAt) < 14 * day).slice(0, 40);
    const upcoming = all.filter(n => isEventLike(n) && !n.cancelled && whenOf(n) &&
      new Date(whenOf(n).slice(0, 10)) >= new Date(now - day) && new Date(whenOf(n).slice(0, 10)) - now < 30 * day).slice(0, 30);
    const projs = projects.active().slice(0, 30);
    const date = n => (n.capturedAt || n.createdAt || '').slice(0, 10);
    const lines = [
      '## Open errands (id | title | place | items | date)',
      ...errands.map(n => `${n.id} | ${n.title}${ownerHint(n)} | ${n.place?.query || n.placeSpec?.query || '-'} | ${(n.items || []).map(i => i.text).join(', ') || '-'} | ${n.start || date(n)}`),
      '## Active projects (id | name | aliases | summary)',
      ...projs.map(p => `${p.id} | ${p.name} | ${(p.aliases || []).join(', ') || '-'} | ${plain(p.livingSummary).slice(0, 110) || '-'}`),
      '## Quick notes, last 14 days, newest first (id | type | title | date | summary)',
      ...recent.map(n => `${n.id} | ${n.type} | ${n.title} | ${date(n)} | ${oneLine(n)}`),
      '## Upcoming events and reminders, next 30 days (id | type | title | when)',
      ...upcoming.map(n => `${n.id} | ${n.type} | ${n.title} | ${whenOf(n)}`),
    ];
    return lines.join('\n');
  }

  // ── Resolving the target ──────────────────────────────────────────────────

  /**
   * Explicit "add to <name>" with no id (Addendum A). Order: project name/alias →
   * errand/list title → quick note titles & summaries → recordings → nothing.
   * Returns { target } or { createProject: { name, noteIds } }.
   */
  function resolveByName(name, excludeId) {
    const q = norm(name);
    if (!q) return null;
    const p = projects.findByName(name, { includeArchived: false });
    if (p) return { target: { type: 'project', id: p.id, title: p.name, project: p } };

    const pool = store.list().filter(n => visible(n) && n.id !== excludeId);
    const errand = pool.find(n => n.type === 'errand' && !n.errandDone &&
      [n.title, n.place?.query, n.placeSpec?.query, errandName(n)].some(t => t && (norm(t) === q || norm(t).includes(q))));
    if (errand) return { target: readTarget('errand', errand.id) };

    const notes = pool.filter(n => n.type !== 'errand' &&
      (norm(n.title).includes(q) || norm(n.summary).includes(q) || norm(n.content).includes(q)));
    if (notes.length === 1) return { target: readTarget(notes[0].type === 'errand' ? 'errand' : isEventLike(notes[0]) ? notes[0].type : 'note', notes[0].id) };
    if (notes.length > 1) return { createProject: { name: String(name).trim(), noteIds: notes.map(n => n.id) } };

    const rec = (deps.getRecentRecordings?.(200) || []).find(r => norm(r.title).includes(q));
    if (rec) return { target: { type: 'recording', id: rec.id, title: rec.title } };

    return { createProject: { name: String(name).trim(), noteIds: [] } };
  }

  /**
   * Classifier output → what to do with this capture.
   * { mode: 'create' } | { mode: 'apply'|'ask', target, payload, confidence } | { mode: 'createProject', … }
   */
  function decide(capture, cls) {
    const action = ['append', 'update', 'cancel'].includes(cls.action) ? cls.action : 'create';
    if (action === 'create') return { mode: 'create' };

    const s = settings();
    const explicit = cls.explicitTarget === true;
    let confidence = Math.max(0, Math.min(1, Number(cls.confidence) || 0));
    if (explicit) confidence = Math.max(confidence, 0.92);

    let target = TARGET_TYPES.includes(cls.targetType) ? readTarget(cls.targetType, cls.targetId) : null;
    if (!target && cls.targetId) {
      // Wrong type from the model: try the id as any kind of target
      for (const t of TARGET_TYPES) { target = readTarget(t, cls.targetId); if (target) break; }
    }
    // Explicit "add to <name>": project → list → notes (several → new project) → recordings → new project.
    // Only for appends — moving/cancelling uses the model's pick.
    if (explicit && action === 'append' && String(cls.targetName || '').trim()) {
      const r = resolveByName(cls.targetName, capture.id);
      if (r?.createProject && (r.createProject.noteIds.length >= 2 || !target)) return { mode: 'createProject', ...r.createProject, confidence };
      if (r?.target) target = r.target;
    }
    if (!target) return { mode: 'create' };

    const payload = {
      action,
      addItems: (cls.addItems || []).map(String).filter(Boolean),
      removeItems: (cls.removeItems || []).map(String).filter(Boolean),
      changes: cls.changes || {},
      appendText: String(cls.appendText || '').trim(),
    };
    // Lists: adding items needs an errand; otherwise it's a note-style update
    const eventChange = isEventLike(target) && (action === 'cancel' || (action === 'update' && Object.values(payload.changes).some(v => v)));

    // Everything to add is already on the list: nothing would change, so no need to ask
    const noOp = target.note && hasList(target.note) && action === 'append' && payload.addItems.length && !payload.removeItems.length &&
      payload.addItems.every(t => (target.note.items || []).some(i => sameItem(i.text, t)));

    // Several open lists match (e.g. your Publix list and one shared with you): ask which
    if (action === 'append' && target.note?.type === 'errand') {
      const key = norm(errandName(target.note));
      const place = norm(target.note.place?.query || target.note.placeSpec?.query);
      const others = store.list().filter(n => visible(n) && n.type === 'errand' && !n.errandDone && n.id !== target.id &&
        (norm(errandName(n)) === key || (place && norm(n.place?.query || n.placeSpec?.query) === place)));
      if (others.length && confidence >= s.ask) {
        const alternatives = [target, ...others.slice(0, 3).map(n => readTarget('errand', n.id)).filter(Boolean)]
          .map(t => ({ id: t.id, title: t.title }));
        return { mode: 'ask', target, payload, confidence, alternatives };
      }
    }

    let mode;
    if (noOp && confidence >= s.ask) mode = 'apply';
    else if (action === 'cancel') mode = (confidence >= 0.9 && !s.alwaysAskCancel) ? 'apply' : 'ask';
    else if (eventChange && s.alwaysAskEventChanges) mode = 'ask';
    else if (confidence >= s.autoApply) mode = 'apply';
    else if (confidence >= s.ask) mode = 'ask';
    else mode = 'create';
    return { mode, target, payload, confidence };
  }

  // ── Applying ──────────────────────────────────────────────────────────────

  const pushAudit = (obj, entry) => { obj.audit = [...(obj.audit || []), { at: new Date().toISOString(), ...entry }]; };
  const fmtList = arr => (arr.length <= 2 ? arr.join(' and ') : `${arr.slice(0, -1).join(', ')} and ${arr.at(-1)}`);

  /** Add items to an errand without duplicates; returns { added: [item], already: [text] } */
  function addItems(errand, texts) {
    const added = [], already = [];
    errand.items = errand.items || [];
    for (const raw of texts) {
      const text = ctx.cleanItemText(raw);
      if (!text) continue;
      if (errand.items.some(i => sameItem(i.text, text)) || added.some(i => sameItem(i.text, text))) { already.push(text); continue; }
      const item = { id: uid('it'), text, done: false };
      // Who added it (shown on shared lists)
      const me = ctx.self?.();
      if (me) Object.assign(item, { v: 1, addedBy: me.id, addedAt: new Date().toISOString() });
      errand.items.push(item);
      added.push(item);
    }
    if (added.length && errand.errandDone) ctx.setErrandDone(errand, false); // new things to get
    return { added, already };
  }

  function removeItems(errand, texts) {
    const removed = [], missing = [];
    for (const raw of texts) {
      const idx = (errand.items || []).findIndex(i => sameItem(i.text, raw));
      if (idx < 0) { missing.push(raw); continue; }
      removed.push({ item: errand.items[idx], index: idx });
      errand.items.splice(idx, 1);
    }
    return { removed, missing };
  }

  function addUpdate(target, capture, { text, kind = 'append' }) {
    const update = {
      id: uid('up'),
      captureId: capture.id,
      kind,
      at: capture.capturedAt || capture.createdAt || new Date().toISOString(),
      text: text || capture.content || capture.transcript || '',
      transcript: capture.transcript || null,
      hasAudio: !!capture.audioFile,
      media: capture.media ? { kind: capture.media.kind } : null,
      mediaText: capture.mediaText || null,
      linkedRecordingId: capture.linkedRecordingId || null,
    };
    target.updates = [...(target.updates || []), update];
    return update;
  }

  /** Field changes for events/reminders/errands: start/end/title/location */
  function applyChanges(n, changes) {
    const before = {}, after = {};
    const keep = k => { if (!(k in before)) before[k] = n[k] ?? null; };
    if (changes.title && String(changes.title).trim()) { keep('title'); n.title = String(changes.title).trim().slice(0, 120); }
    if (changes.location) { keep('location'); n.location = String(changes.location).trim(); }
    if (changes.start) {
      const field = n.type === 'reminder' ? 'dueDate' : 'start';
      keep(field); keep('end'); keep('allDay');
      const raw = String(changes.start).trim();
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
      const value = ctx.normalizeWhen(raw, dateOnly);
      if (value) {
        if (field === 'start' && n.type === 'event' && !dateOnly && n.start && n.end && !ctx.DATE_ONLY_RE.test(n.start)) {
          // Keep the duration when moving a timed event
          const dur = ctx.parseZoned(n.end) - ctx.parseZoned(n.start);
          n.end = ctx.toZonedIso(new Date(ctx.parseZoned(value).getTime() + (dur > 0 ? dur : 3600000)));
        } else if (field === 'start' && !dateOnly) {
          n.end = ctx.toZonedIso(new Date(ctx.parseZoned(value).getTime() + 3600000));
        } else if (dateOnly) {
          n.end = null;
        }
        n[field] = value;
        n.allDay = dateOnly;
      }
    }
    if (changes.end && n.type === 'event') {
      const v = ctx.normalizeWhen(String(changes.end), n.allDay);
      if (v) { keep('end'); n.end = v; }
    }
    for (const k of Object.keys(before)) after[k] = n[k] ?? null;
    return { before, after };
  }

  /**
   * Apply a decided append/update/cancel. Mutates + saves target and capture.
   * Returns the confirmation { icon, text, tone, detail } and a short resultLine.
   */
  async function apply(capture, target, payload, { origin = 'voice' } = {}) {
    let icon = '📝', text = '', resultLine = '', detail = null;

    if (target.type === 'project') {
      projects.addNote(target.id, capture.id);
      const p = projects.read(target.id);
      pushAudit(p, { captureId: capture.id, kind: 'member', noteId: capture.id });
      projects.write(p);
      capture.projectId = target.id;
      capture.appliedTo = { type: 'project', id: target.id, title: target.title, origin };
      icon = '📁'; text = `Added to project ${target.title}`; resultLine = `→ 📁 ${target.title}`;
    } else if (target.type === 'recording') {
      capture.type = 'note_link';
      capture.linkedRecordingId = target.id;
      capture.appliedTo = { type: 'recording', id: target.id, title: target.title, origin };
      icon = '📝'; text = `Saved to ${target.title}`; resultLine = `→ ${target.title}`;
    } else {
      const n = store.read(target.id);
      const entry = { captureId: capture.id, kind: payload.action, origin };
      const name = errandName(n) || n.title;

      if (payload.action === 'cancel') {
        entry.before = { cancelled: !!n.cancelled, cancelledAt: n.cancelledAt || null };
        n.cancelled = true;
        n.cancelledAt = new Date().toISOString();
        entry.after = { cancelled: true, cancelledAt: n.cancelledAt };
        icon = '🗑️'; text = `Cancelled ${n.title}`; resultLine = `✕ ${n.title}`;
      } else if (hasList(n) && (payload.addItems.length || payload.removeItems.length)) {
        const { added, already } = addItems(n, payload.addItems);
        const { removed, missing } = removeItems(n, payload.removeItems);
        entry.kind = 'items';
        entry.addedIds = added.map(i => i.id);
        entry.removed = removed;
        entry.alreadyHad = already;
        icon = '🛒';
        const parts = [];
        if (added.length) parts.push(`Added ${fmtList(added.map(i => i.text))} to ${name}`);
        if (removed.length) parts.push(`Removed ${fmtList(removed.map(r => r.item.text))} from ${name}`);
        if (!added.length && !removed.length && already.length) {
          parts.push(`${fmtList(already)} ${already.length === 1 ? 'is' : 'are'} already on your ${name}`);
        } else if (already.length) {
          detail = `${fmtList(already)} ${already.length === 1 ? 'was' : 'were'} already on the list`;
        }
        if (missing.length && !removed.length && !added.length && !already.length) parts.push(`${fmtList(missing)} wasn't on your ${name}`);
        text = parts.join(' · ') || `Updated ${name}`;
        // Shared lists: "Jane added Yogurt" in the activity log
        if (n.sharedFrom || n.sharedWith?.length) {
          const me = ctx.self?.();
          for (const i of added) ctx.logActivity?.(n, me, 'added', i.text);
          for (const r of removed) ctx.logActivity?.(n, me, 'removed', r.item.text);
        }
        const delta = added.length ? `+${added.length}` : removed.length ? `−${removed.length}` : '±0';
        resultLine = `${delta} → ${name}`;
        if (payload.appendText && !added.length && !removed.length && !already.length) {
          entry.updateId = addUpdate(n, capture, { text: payload.appendText }).id;
        }
        ctx.queueCalendarSync(n.id, 0);
      } else if (payload.action === 'update' && Object.values(payload.changes || {}).some(v => v)) {
        const { before, after } = applyChanges(n, payload.changes);
        entry.kind = 'fields';
        entry.before = before;
        entry.after = after;
        const when = ctx.shortWhen(whenOf(n));
        icon = n.type === 'reminder' ? '⏰' : n.type === 'errand' ? '🛒' : '📅';
        text = 'start' in before || 'dueDate' in before ? `Moved ${n.title}${when ? ` to ${when}` : ''}` : `Updated ${n.title}`;
        resultLine = `✎ ${n.title}`;
      } else {
        // Note-style update: dated entry with its own audio/transcript
        entry.kind = 'update';
        entry.updateId = addUpdate(n, capture, { text: payload.appendText }).id;
        icon = n.type === 'errand' ? '🛒' : '📝';
        text = `Updated ${name}`;
        resultLine = `+ → ${name}`;
        if (ctx.markSummaryPending(n)) ctx.queueSummaryLater(n.id);
      }

      pushAudit(n, entry);
      ctx.finalize(n);
      if (entry.kind === 'fields' || entry.kind === 'cancel') {
        await ctx.syncGoogle(n);
        ctx.finalize(n);
      }
      if (n.projectId) projects.queueSummary(n.projectId);
      capture.appliedTo = { type: target.type, id: n.id, title: name, origin };
      capture.hidden = true;            // lives on inside the target
      capture.kind = 'append';
    }

    capture.appendOrigin = origin;
    capture.status = 'ok';
    capture.pending = null;
    capture.resultLine = resultLine;
    capture.appendConfirmation = { icon, text, tone: 'success', detail, undoable: true, movable: origin === 'voice' };
    ctx.finalize(capture);
    return capture.appendConfirmation;
  }

  /** Addendum A: create a project from matching notes and this capture. */
  function createProjectFrom(capture, { name, noteIds }) {
    const p = projects.create({ name });
    const moved = [];
    for (const id of noteIds) {
      const n = store.read(id);
      if (!n) continue;
      moved.push({ id, prevProjectId: n.projectId || null });
      if (n.projectId && n.projectId !== p.id) projects.removeNote(n.projectId, id);
      p.noteIds.push(id);
      ctx.updateNote(id, x => { x.projectId = p.id; });
    }
    p.noteIds.unshift(capture.id);
    capture.projectId = p.id;
    projects.markSummaryPending(p);
    projects.write(p);
    projects.queueSummary(p.id);
    const count = p.noteIds.length;
    capture.appliedTo = { type: 'project', id: p.id, title: p.name, origin: 'voice', created: true, moved };
    capture.appendOrigin = 'voice';
    capture.resultLine = `→ 📁 ${p.name}`;
    capture.appendConfirmation = {
      icon: '📁',
      text: moved.length ? `Created project ${p.name} with ${count} notes` : `Created project ${p.name}`,
      tone: 'success', detail: null, undoable: true, movable: true,
    };
    ctx.finalize(capture);
    return capture.appendConfirmation;
  }

  // ── Reversing (Undo / Move / Split back) ──────────────────────────────────

  async function reverse(capture) {
    const to = capture.appliedTo;
    if (!to) return;
    if (to.type === 'project') {
      if (to.created) {
        // Project made for this capture: put moved notes back, remove the project
        for (const m of to.moved || []) {
          ctx.updateNote(m.id, x => { x.projectId = m.prevProjectId; });
          if (m.prevProjectId) projects.addNote(m.prevProjectId, m.id);
        }
        const p = projects.read(to.id);
        if (p) projects.write(Object.assign(p, { deleted: true, deletedAt: new Date().toISOString(), noteIds: [] }));
      } else {
        projects.removeNote(to.id, capture.id);
      }
      capture.projectId = null;
    } else if (to.type === 'recording') {
      capture.type = 'note';
      capture.linkedRecordingId = null;
    } else {
      const n = store.read(to.id);
      if (n) {
        const entry = [...(n.audit || [])].reverse().find(a => a.captureId === capture.id && !a.reversed);
        if (entry) {
          if (entry.kind === 'items') {
            n.items = (n.items || []).filter(i => !(entry.addedIds || []).includes(i.id));
            for (const r of [...(entry.removed || [])].sort((a, b) => a.index - b.index)) {
              if (!n.items.some(i => i.id === r.item.id)) n.items.splice(Math.min(r.index, n.items.length), 0, r.item);
            }
            if (n.items.length && n.items.every(i => i.done)) ctx.setErrandDone(n, true);
            ctx.queueCalendarSync(n.id, 0);
          }
          if (entry.updateId) n.updates = (n.updates || []).filter(u => u.id !== entry.updateId);
          if (entry.kind === 'fields' || entry.kind === 'cancel') Object.assign(n, entry.before);
          if (entry.kind === 'merge' && entry.titleBefore !== undefined) n.title = entry.titleBefore;
          entry.reversed = true;
          entry.reversedAt = new Date().toISOString();
          ctx.finalize(n);
          if (entry.kind === 'fields' || entry.kind === 'cancel') { await ctx.syncGoogle(n); ctx.finalize(n); }
          if (entry.updateId || entry.kind === 'merge') { if (ctx.markSummaryPending(n)) ctx.queueSummaryLater(n.id); }
          if (n.projectId) projects.queueSummary(n.projectId);
        }
      }
    }
    capture.appliedTo = null;
    capture.hidden = false;
    capture.kind = null;
    capture.resultLine = null;
    capture.appendConfirmation = null;
  }

  /** Undo of a voice append: reverse it and discard the capture. */
  async function undoAppend(capture) {
    await reverse(capture);
    capture.hidden = true;
    return capture;
  }

  /** Move = undo + apply elsewhere (or keep as its own note). */
  async function move(capture, dest) {
    const payload = capture.lastPayload || { action: 'append', addItems: capture.items?.map(i => i.text) || [], removeItems: [], changes: {}, appendText: capture.content || '' };
    await reverse(capture);
    capture.hidden = false;
    capture.kind = null;
    if (dest.new) {
      capture.status = 'ok';
      capture.pending = null;
      ctx.finalize(capture);
      await ctx.syncGoogle(capture);
      ctx.finalize(capture);
      return { icon: '📝', text: 'Kept as its own note', tone: 'success' };
    }
    const target = readTarget(dest.targetType, dest.targetId) || (dest.targetId && TARGET_TYPES.map(t => readTarget(t, dest.targetId)).find(Boolean));
    if (!target || target.id === capture.id) throw Object.assign(new Error('Target not found'), { status: 404 });
    // Moving onto a list: the capture's own items become the items to add
    const p = { ...payload, action: payload.action === 'cancel' ? 'append' : payload.action };
    const listTarget = target.type === 'errand' || (target.note && hasList(target.note));
    if (listTarget && !p.addItems.length && capture.items?.length) p.addItems = capture.items.map(i => i.text);
    if (!listTarget) { p.addItems = []; p.removeItems = []; }
    if (!p.appendText) p.appendText = capture.content || capture.transcript || '';
    return apply(capture, target, p, { origin: 'voice' });
  }

  /** "Ask" answer: yes | new | other (with dest). */
  async function resolvePending(capture, choice, dest = null, pickedId = null) {
    const pending = capture.pending;
    if (!pending) throw Object.assign(new Error('Nothing to decide'), { status: 409 });
    capture.pending = null;
    capture.status = 'ok';
    if (choice === 'yes') {
      // "Which list?" — one of the offered alternatives, or the first (best) match
      const picked = pickedId && (pending.alternatives || []).some(a => a.id === pickedId) ? pickedId : pending.targetId;
      const target = readTarget(pending.targetType, picked);
      if (!target) throw Object.assign(new Error('That target no longer exists'), { status: 409 });
      return apply(capture, target, pending.payload, { origin: 'voice' });
    }
    if (choice === 'other' && dest) {
      capture.lastPayload = pending.payload;
      return move(capture, dest);
    }
    // "New note" (or no answer): keep it, sync its calendar event, remember the possible match
    if (choice === 'timeout') capture.possibleMatch = { type: pending.targetType, id: pending.targetId, title: pending.targetTitle };
    ctx.finalize(capture);
    await ctx.syncGoogle(capture);
    ctx.finalize(capture);
    return choice === 'timeout'
      ? { icon: '📝', text: 'Saved as a new note', tone: 'success', detail: `Possible match: ${pending.targetTitle}` }
      : { icon: '📝', text: 'Saved as a new note', tone: 'success' };
  }

  function markPending(capture, decision) {
    capture.status = 'pending_decision';
    capture.lastPayload = decision.payload;
    capture.pending = {
      action: decision.payload.action,
      targetType: decision.target.type,
      targetId: decision.target.id,
      targetTitle: decision.target.title,
      payload: decision.payload,
      confidence: decision.confidence,
      alternatives: decision.alternatives || null,
      expiresAt: new Date(Date.now() + ASK_TIMEOUT_MS).toISOString(),
    };
    const verb = decision.alternatives ? 'Add to which list?'
      : decision.payload.action === 'cancel' ? `Cancel ${decision.target.title}?`
      : decision.payload.action === 'update' && isEventLike(decision.target) ? `Change ${decision.target.title}?`
        : `Add to ${decision.target.title}?`;
    capture.appendConfirmation = {
      icon: decision.payload.action === 'cancel' ? '🗑️' : '❓', text: verb, tone: 'ask', detail: null,
      ask: { targetType: decision.target.type, targetId: decision.target.id, targetTitle: decision.target.title, action: decision.payload.action, alternatives: decision.alternatives || null },
    };
  }

  /** No answer within 2 minutes → keep as a new note with a "Possible match" chip. */
  async function sweepPending() {
    const now = Date.now();
    for (const n of store.list()) {
      if (n.status !== 'pending_decision' || !n.pending) continue;
      if (new Date(n.pending.expiresAt).getTime() > now) continue;
      try { await resolvePending(n, 'timeout'); } catch (err) { console.warn(`[append] Timeout for ${n.id}: ${err.message}`); }
    }
  }

  // ── Merge into / Combine / Split back ─────────────────────────────────────

  /** Fold note `src` into `target` (errand checklists merge without duplicates). */
  function mergeInto(src, target, { groupId = null, titleBefore } = {}) {
    const n = store.read(target.id);
    const entry = { captureId: src.id, kind: 'merge', origin: 'merge', groupId };
    if (titleBefore !== undefined) entry.titleBefore = titleBefore;
    if (hasList(n) && src.items?.length) {
      const { added, already } = addItems(n, src.items.map(i => i.text));
      // Keep checked state of merged items
      for (const a of added) {
        const from = src.items.find(i => sameItem(i.text, a.text));
        if (from?.done) a.done = true;
      }
      entry.addedIds = added.map(i => i.id);
      entry.alreadyHad = already;
      ctx.queueCalendarSync(n.id, 0);
    }
    entry.updateId = addUpdate(n, src, { text: src.content || src.transcript || src.title, kind: 'merge' }).id;
    if (!n.linkedRecordingId && src.linkedRecordingId) {
      entry.linkedBefore = null;
      n.linkedRecordingId = src.linkedRecordingId;
      if (n.type === 'note') { entry.typeBefore = 'note'; n.type = 'note_link'; }
    }
    pushAudit(n, entry);
    ctx.finalize(n);
    src.hidden = true;
    src.kind = 'merged';           // keeps its own calendar event (carried over)
    src.mergedInto = { id: n.id, groupId, at: new Date().toISOString() };
    src.appliedTo = { type: target.type, id: n.id, title: n.title, origin: 'merge' };
    ctx.finalize(src);
    return n;
  }

  function unmerge(src) {
    const to = src.mergedInto;
    if (!to) return src;
    const n = store.read(to.id);
    if (n) {
      const entry = [...(n.audit || [])].reverse().find(a => a.captureId === src.id && a.kind === 'merge' && !a.reversed);
      if (entry) {
        n.items = (n.items || []).filter(i => !(entry.addedIds || []).includes(i.id));
        n.updates = (n.updates || []).filter(u => u.id !== entry.updateId);
        if ('linkedBefore' in entry) n.linkedRecordingId = entry.linkedBefore;
        if (entry.typeBefore) n.type = entry.typeBefore;
        entry.reversed = true;
        entry.reversedAt = new Date().toISOString();
        ctx.finalize(n);
        if (entry.addedIds?.length) ctx.queueCalendarSync(n.id, 0);
      }
    }
    src.hidden = false;
    src.kind = null;
    src.mergedInto = null;
    src.appliedTo = null;
    ctx.finalize(src);
    return src;
  }

  return {
    settings, saveSettings, candidates, decide, apply, createProjectFrom, markPending, resolvePending,
    reverse, undoAppend, move, sweepPending, mergeInto, unmerge, readTarget, resolveByName,
    visible, errandName, sameItem, itemKey,
  };
}

module.exports = { createAppender, DEFAULT_SETTINGS, _internal: { itemKey, sameItem, singular } };
