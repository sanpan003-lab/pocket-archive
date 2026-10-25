// The Android app's offline copy (2.9.0) lives in native code (OfflineStore: SQLCipher database + encrypted media,
// key in the Android Keystore, behind the app lock). This is the web side's handle on it.
//
// Plugin contract (Offline):
//   status() → { available, enabled, open, locked, online, syncing, lastSyncAt, pending, conflicts, progress, settings, usage }
//   getAll({ kind: notes|shared|projects|sharedProjects }) → { items }      get({ kind, id }) → { item }
//   getKv({ key }) → { value }   putKv({ key, value })                     putNotes({ notes, kind })   removeNote({ id })
//   enqueue({ op }) → { seq }    queue() → { ops }                          syncNow({ reason })
//   putMedia({ key, base64, type })   setSettings(settings)   freeUpSpace()   wipe({ reason })   resolveConflict({ id })
//   events: status, changed { ids }, idmap { tempId, id }, conflict { id }
//
// Browsers never keep an offline copy. The browser tests (and only they) can switch on a JS stand-in with the same
// contract: localStorage pa_offlineTest = '1' (see testStore.js).
import { registerPlugin } from '@capacitor/core';
import { isNative } from '../platform';

const plugin = isNative ? registerPlugin('Offline') : null;
let testStore = null;

function testMode() {
  try { return !isNative && localStorage.getItem('pa_offlineTest') === '1'; } catch { return false; }
}

/** The store, or null when this device keeps no offline copy (any browser) */
export async function offlineStore() {
  if (plugin) return plugin;
  if (testMode()) {
    if (!testStore) {
      testStore = (async () => {
        const store = (await import('./testStore.js')).createTestStore();
        // Browser tests drive the app's own request layer through this (test mode only)
        const api = await import('../api.js');
        window.__paTestApi = { ...api, status: () => store.status(), wipe: () => store.wipe({ reason: 'test' }) };
        return store;
      })();
    }
    return testStore;
  }
  return null;
}

/** Synchronous check for code paths that must not wait (true in the app and in the browser tests) */
export const offlineCapable = () => !!plugin || testMode();
