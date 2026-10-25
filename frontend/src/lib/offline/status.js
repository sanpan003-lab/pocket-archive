// Offline status for the web layer (2.9.0): is the NAS reachable, what's waiting to be sent, how far the offline copy
// has synced. Native code (or the test store) is the source; requests that fail for lack of a connection also flip
// it to offline right away (and ask native code to check again).
import { useSyncExternalStore } from 'react';
import { offlineStore, offlineCapable } from './native';
import { reload, renameNote } from './localData';

let status = {
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

let started = false;
/** Once, at start: follow native status, and reload the in-memory copy when sync changed notes */
export async function startOfflineStatus() {
  if (started || !offlineCapable()) return;
  started = true;
  const store = await offlineStore();
  if (!store) return;
  try { update(await store.status()); } catch { /* not ready yet */ }
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
}

/** Tests / settings: status changed elsewhere */
export const setStatusForTests = update;
