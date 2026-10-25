// Offline-aware requests (2.9.0, Android app): every /api call goes to the NAS as before; when there's no
// connection — or changes made offline are still waiting to be sent — the offline copy answers instead
// (localApi.js) and changes join the queue, so they reach the server in the order they were made.
import axios, { AxiosError } from 'axios';
import { offlineCapable, offlineStore } from './native';
import { handleLocal, handledLocally, kvKey, KV_ROUTES, NeedsConnection } from './localApi';
import { getStatus, markOffline, pendingCount } from './status';
import * as data from './localData';

const NOTE_READS = [/^\/quick$/, /^\/quick\/qn_[\w-]+$/, /^\/find$/, /^\/shared$/, /^\/projects$/, /^\/projects\/pj_[\w-]+$/, /^\/actions$/];

function requestOf(config) {
  const url = new URL(axios.getUri(config), window.location.origin);
  const path = url.pathname.replace(/^.*?\/api(?=\/)/, '');
  const query = Object.fromEntries(url.searchParams.entries());
  let body = null;
  let form = null;
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) form = config.data;
  else if (typeof config.data === 'string' && config.data) { try { body = JSON.parse(config.data); } catch { body = null; } }
  else if (config.data && typeof config.data === 'object') body = config.data;
  return { method: (config.method || 'get').toUpperCase(), path, query, body, form };
}

function response(config, data, status = 200) {
  return { data, status, statusText: status === 200 ? 'OK' : 'Error', headers: { 'x-offline': '1' }, config, request: { offline: true } };
}

function failure(config, err) {
  const status = err.status || 503;
  const res = response(config, { error: err.message, offline: !!err.offline, ...(err.data || {}) }, status);
  return new AxiosError(err.message, err.offline ? 'ERR_OFFLINE' : 'ERR_BAD_REQUEST', config, res.request, res);
}

async function answerLocally(config, req) {
  try {
    const r = await handleLocal(req);
    return response(config, r.data, r.status);
  } catch (err) {
    throw failure(config, err);
  }
}

/** The network adapter hands back the raw body (axios parses JSON after the adapter) */
const bodyOf = res => { if (typeof res.data !== 'string') return res.data; try { return JSON.parse(res.data); } catch { return null; } };

const isNetworkError = err => !err.response && (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /Network Error|timeout/i.test(err.message || ''));
const isNote = v => v && typeof v === 'object' && /^qn_/.test(v.id || '') && (v.createdAt || v.capturedAt);

/** Notes read from the server still show what only this phone knows: "Edited on another device" */
async function withLocalConflicts(req, res) {
  if (req.method !== 'GET' || !NOTE_READS.some(re => re.test(req.path))) return res;
  const body = bodyOf(res);
  if (!body) return res;
  res = { ...res, data: body };
  await data.ensureLoaded();
  const mark = n => { const local = n && data.anyNote(n.id); return local?._conflict ? { ...n, _conflict: local._conflict } : n; };
  if (Array.isArray(res.data)) return { ...res, data: res.data.map(mark) };
  if (res.data?.id) return { ...res, data: mark(res.data) };
  if (Array.isArray(res.data?.notes)) return { ...res, data: { ...res.data, notes: res.data.notes.map(mark) } };
  return res;
}

/** Online answers keep the copy current between syncs (settings, places… and the note you just changed) */
async function writeThrough(req, res) {
  try {
    const store = await offlineStore();
    if (!store) return;
    const body = bodyOf(res);
    if (body == null) return;
    if (req.method === 'GET' && KV_ROUTES.some(re => re.test(req.path))) {
      await store.putKv({ key: kvKey(req.path, req.query), value: body });
      return;
    }
    const notes = [body, body?.note].filter(isNote);
    for (const n of notes) {
      await data.ensureLoaded();
      const prev = data.anyNote(n.id);
      await data.saveNote(prev?.sharedFrom && !n.sharedFrom ? { ...n, sharedFrom: prev.sharedFrom } : n);
    }
  } catch { /* the copy catches up at the next sync */ }
}

/**
 * Before a change goes out: give creates a clientId and new list items an id, so if the answer is lost on the way
 * (the request reached the server, then the connection dropped) sending it again from the queue is harmless.
 */
const CREATES = [/^\/quick\/text$/, /^\/quick\/media$/, /^\/quick\/document$/, /^\/projects$/, /^\/quick\/qn_[\w-]+\/attachments$/];
const rid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
function makeRetrySafe(config, req) {
  if (req.method !== 'POST') return config;
  if (CREATES.some(re => re.test(req.path))) {
    if (req.form) { if (!req.form.get('clientId')) req.form.append('clientId', rid()); return config; }
    if (req.body && !req.body.clientId) { req.body = { ...req.body, clientId: rid() }; return { ...config, data: JSON.stringify(req.body) }; }
    return config;
  }
  if (/^\/quick\/qn_[\w-]+\/ops$/.test(req.path) && Array.isArray(req.body?.ops) && req.body.ops.some(o => o.op === 'addItem' && !o.itemId)) {
    req.body = { ...req.body, ops: req.body.ops.map(o => (o.op === 'addItem' && !o.itemId ? { ...o, itemId: `it_${rid()}` } : o)) };
    return { ...config, data: JSON.stringify(req.body) };
  }
  return config;
}

export function installOfflineAdapter(http) {
  const network = axios.getAdapter(http.defaults.adapter || axios.defaults.adapter);
  http.defaults.adapter = async config => {
    if (!offlineCapable() || !getStatus().available) return network(config);
    const req = requestOf(config);
    config = makeRetrySafe(config, req);
    const local = handledLocally(req.method, req.path);
    const st = getStatus();
    const mutation = req.method !== 'GET';
    // No connection: the copy answers (or "needs a connection")
    if (!st.online) {
      if (local) return answerLocally(config, req);
      throw failure(config, new NeedsConnection());
    }
    // Changes made offline still waiting: new changes queue behind them, notes are read with them applied
    if (local && pendingCount() > 0 && (mutation || NOTE_READS.some(re => re.test(req.path)))) return answerLocally(config, req);
    try {
      const res = await network(local && !mutation && !config.timeout ? { ...config, timeout: 8000 } : config);
      if (local) writeThrough(req, res);
      return local && getStatus().conflicts > 0 ? withLocalConflicts(req, res) : res;
    } catch (err) {
      if (local && isNetworkError(err)) {
        markOffline();
        return answerLocally(config, req);
      }
      throw err;
    }
  };
}
