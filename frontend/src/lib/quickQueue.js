// Offline queue for Quick Capture uploads (IndexedDB).
// Captures that can't be sent (no signal, server unreachable, signed out)
// are stored here and retried automatically when the browser is back online.
// The server de-duplicates by clientId, so retrying is always safe.

import { captureQuick } from './api';

const DB_NAME = 'pocket-archive';
const STORE   = 'quickQueue';
const EVENT   = 'quick-queue';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'clientId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result?.result ?? result);
      t.onerror    = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

function emit(detail) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
}

export async function queueCount() {
  try { return await tx('readonly', s => s.count()); }
  catch { return 0; }
}

// item: { clientId, blob, mimeType, capturedAt }
export async function enqueue(item) {
  await tx('readwrite', s => s.put({ ...item, queuedAt: new Date().toISOString() }));
  emit({ count: await queueCount() });
}

async function remove(clientId) {
  await tx('readwrite', s => s.delete(clientId));
}

async function allItems() {
  return tx('readonly', s => s.getAll());
}

export function extensionFor(mimeType = '') {
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

export function buildCaptureForm({ blob, mimeType, clientId, capturedAt }) {
  const fd = new FormData();
  fd.append('audio', new Blob([blob], { type: mimeType }), `capture.${extensionFor(mimeType)}`);
  fd.append('clientId', clientId);
  fd.append('capturedAt', capturedAt);
  return fd;
}

// Network failure, gateway/server errors and expired sessions are retryable;
// a 400/413 (bad or oversized audio) never will be.
export function isRetryable(err) {
  const status = err?.response?.status;
  return !status || status >= 500 || status === 401 || status === 408 || status === 429;
}

let flushing = false;

// Send everything in the queue, oldest first. Emits { count, sent } per success.
export async function flushQueue() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const items = (await allItems()).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    for (const item of items) {
      try {
        const result = await captureQuick(buildCaptureForm(item));
        await remove(item.clientId);
        emit({ count: await queueCount(), sent: result });
      } catch (err) {
        if (!isRetryable(err)) {
          await remove(item.clientId);
          emit({ count: await queueCount(), dropped: item.clientId });
          continue;
        }
        emit({ count: await queueCount(), error: err.response?.status === 401 ? 'signed_out' : 'offline' });
        break; // still offline (or signed out) — try again later
      }
    }
  } catch {
    // IndexedDB unavailable (e.g. private mode) — nothing to flush
  } finally {
    flushing = false;
  }
}

// Start background retries (call once, app-wide). Returns a cleanup function.
export function startQueueFlusher() {
  const onOnline = () => flushQueue();
  window.addEventListener('online', onOnline);
  const timer = setInterval(() => { flushQueue(); }, 30000);
  flushQueue();
  return () => {
    window.removeEventListener('online', onOnline);
    clearInterval(timer);
  };
}

export function onQueueChange(handler) {
  const fn = e => handler(e.detail);
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
