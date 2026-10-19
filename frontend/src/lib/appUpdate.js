import { useCallback, useEffect, useState } from 'react';
import { isNative } from './platform';
import { QuickRecorder } from '../native/quickRecorder';

// Over-the-air updates of the Android app (and the watch), served by the NAS. Native does the work
// (AppUpdater.kt): check, download, SHA-256 + signature check, install. This hook mirrors its state.

const STATUS_LABEL = { current: 'Up to date', available: 'Update available', required: 'Update required', unknown: '' };

/** "Phone app 2.4.0 · Up to date · Watch 2.3.0 · Update available" for device lists */
export function appVersionLine(device) {
  const parts = [];
  for (const [target, label] of [['phone', 'App'], ['watch', 'Watch']]) {
    const a = device?.apps?.[target];
    if (!a) continue;
    const st = STATUS_LABEL[device.updateStatus?.[target]] || '';
    parts.push(`${label} ${a.versionName || a.versionCode}${st ? ` · ${st}` : ''}`);
  }
  return parts.join(' · ');
}

/** { state, check(), start(), setWifiOnly(on), openInstallSettings(), updateWatch() } — null state in the browser */
export function useAppUpdate() {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!isNative) return undefined;
    QuickRecorder.getUpdateState().then(setState).catch(() => {});
    const sub = QuickRecorder.addListener('update', setState);
    return () => { sub.then(h => h.remove()); };
  }, []);
  const call = useCallback((m, a) => QuickRecorder[m](a).then(s => { if (s && s.status !== undefined) setState(s); return s; }), []);
  return {
    state,
    check: () => call('checkForUpdates'),
    start: () => call('startUpdate'),
    setWifiOnly: on => call('setUpdateSettings', { wifiOnly: on }),
    openInstallSettings: () => QuickRecorder.openInstallSettings(),
    updateWatch: () => QuickRecorder.updateWatch(),
  };
}
