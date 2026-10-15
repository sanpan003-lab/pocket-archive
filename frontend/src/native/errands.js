import { useCallback, useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { isNative } from '../lib/platform';
import { getActiveErrands } from '../lib/api';
import { QuickRecorder } from './quickRecorder';

// Arrival reminders (Android only): the phone registers geofences around the
// stores of active errands. Location never leaves the phone.

const ASKED_KEY = 'pa_arrivalPermissionAsked';

export const wasAsked = () => { try { return localStorage.getItem(ASKED_KEY) === '1'; } catch { return false; } };
export const markAsked = () => { try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* ignore */ } };

const CHANGED_EVENT = 'pa:errands-changed';

/** After errands changed: re-register the phone's geofences and refresh arrival UI. */
export function syncErrands() {
  if (!isNative) return;
  QuickRecorder.syncErrands().catch(() => {});
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/**
 * { supported, status: { foreground, background } | null, activeCount, ready, enable(), refresh() }
 * ready = arrival reminders can fire (both permissions granted).
 */
export function useArrivalPermission() {
  const [status, setStatus] = useState(null);
  const [activeCount, setActiveCount] = useState(0);

  const refresh = useCallback(() => {
    if (!isNative) return;
    QuickRecorder.checkLocation().then(setStatus).catch(() => setStatus(null));
    getActiveErrands().then(d => setActiveCount(d.errands.length)).catch(() => { /* offline */ });
  }, []);

  useEffect(() => {
    if (!isNative) return undefined;
    refresh();
    // Coming back from Android's location settings screen
    const sub = CapApp.addListener('resume', refresh);
    window.addEventListener(CHANGED_EVENT, refresh);
    return () => {
      sub.then(h => h.remove());
      window.removeEventListener(CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  // Foreground first, then "Allow all the time" (Android shows its settings screen for that)
  const enable = useCallback(async () => {
    markAsked();
    try {
      let s = await QuickRecorder.checkLocation();
      if (s.foreground !== 'granted') s = await QuickRecorder.requestLocation();
      if (s.foreground === 'granted' && s.background !== 'granted') s = await QuickRecorder.requestBackgroundLocation();
      if (s.foreground !== 'granted' && s.foreground !== 'prompt') {
        // Denied for good: only the app settings screen can turn it on
        await QuickRecorder.openAppSettings();
      }
      setStatus(s);
      syncErrands();
    } catch {
      refresh();
    }
  }, [refresh]);

  const ready = status?.foreground === 'granted' && status?.background === 'granted';
  return { supported: isNative, status, activeCount, ready, enable, refresh };
}
