// Offline status for the web layer (2.9.0): is the NAS reachable, what's waiting to be sent, how far the offline copy
// has synced. Native code (or the test store) is the source; requests that fail for lack of a connection also flip
// it to offline right away (and ask native code to check again).
import { useSyncExternalStore } from 'react';
import { offlineStore, offlineCapable } from './native';
import { reload, renameNote } from './localData';
import { isNative } from '../platform';

/** Breadcrumbs for logcat (tag OfflineJS) — how a phone problem is found without a debugger */
export async function trace(msg) {
  try { (await offlineStore())?.trace?.({ msg: String(msg) }).catch(() => {}); } catch { /* tracing never breaks the app */ }
}

let status = {
  checked: false, error: null, lastError: null,
  available: false, online: true, syncing: false, pending: 0, conflicts: 0, lastSyncAt: null,
  progress: null, settings: null, usage: null, open: true, locked: false,
};
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());

function update(patch) {
  status = { ...status, ...patch };
  emit();
}

export const getStatus = () => status;
export const isOffline = () => status.available && !status.online;
export const pendingCount = () => status.pending || 0;

export function useOfflineStatus() {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => status);
}

/** A request found no connection: show offline now, and let native code check (it decides when it's back) */
export async function markOffline() {
  if (!status.online) return;
  update({ online: false });
  const store = await offlineStore();
  store?.syncNow?.({ reason: 'network-error' }).catch(() => {});
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('The offline plugin did not answer')), ms))]);
}

/** Ask native code for the status now (5 s limit). Resolves true when it answered; the reason is kept in status.error */
export async function refreshOfflineStatus() {
  const store = await offlineStore();
  if (!store) return false;
  const t0 = Date.now();
  try {
    update({ ...(await withTimeout(store.status(), 5000)), checked: true, error: null });
    trace(`status ok in ${Date.now() - t0} ms · available=${status.available} online=${status.online}`);
    return true;
  } catch (err) {
    update({ checked: true, error: err?.message || String(err) });
    trace(`status FAILED after ${Date.now() - t0} ms: ${err?.message || err}`);
    return false;
  }
}

let started = false;
/** Once, at start: follow native status, and reload the in-memory copy when sync changed notes */
export async function startOfflineStatus() {
  if (started || !offlineCapable()) return;
  started = true;
  const store = await offlineStore();
  trace(`start · native=${isNative} · page=${location.origin}${location.pathname} · script=${document.querySelector('script[type=module]')?.getAttribute('src')}`);
  if (!store) return;
  store.addListener?.('status', s => update(s));
  store.addListener?.('changed', () => { reload().then(() => window.dispatchEvent(new CustomEvent('pa:quick-changed', { detail: null }))); });
  store.addListener?.('idmap', e => { renameNote(e.tempId, e.id); window.dispatchEvent(new CustomEvent('pa:offline-idmap', { detail: e })); });
  store.addListener?.('conflict', e => window.dispatchEvent(new CustomEvent('pa:offline-conflict', { detail: e })));
  // Coming back to the app: check again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') store.syncNow?.({ reason: 'resume' }).catch(() => {});
  });
  window.addEventListener('online', () => store.syncNow?.({ reason: 'online' }).catch(() => {}));
  // Live updates (someone changed a shared list, a summary finished…): bring the copy up to date shortly after
  let liveTimer = null;
  window.addEventListener('pa:live', () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => store.syncNow?.({ reason: 'live' }).catch(() => {}), 3000);
  });
  // First status (the app only waits 400 ms for it); if native code is slow or fails, keep trying in the background
  // and keep the reason in status.error, so Settings can say what is wrong instead of staying blank
  if (!(await refreshOfflineStatus())) {
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
      if (await refreshOfflineStatus()) break;
    }
  }
}

/** Tests / settings: status changed elsewhere */
export const setStatusForTests = update;
