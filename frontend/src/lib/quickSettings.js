import { useCallback, useState } from 'react';

// Quick Capture preferences, remembered on this device
export const QUICK_SETTINGS = {
  readAloud: { key: 'pa_quickReadAloud', default: false }, // speak the confirmation
  feedback:  { key: 'pa_quickFeedback',  default: true  }, // sound & vibration
  // Android app only (synced to the native recorder)
  volumeStop:     { key: 'pa_volumeStop',     default: true }, // volume down stops recording
  launcherToggle: { key: 'pa_launcherToggle', default: true }, // Quick Record stops a running recording
};

function load(name) {
  const { key, default: fallback } = QUICK_SETTINGS[name];
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'true';
  } catch {
    return fallback;
  }
}

export function useQuickSetting(name) {
  const [value, setValue] = useState(() => load(name));
  const update = useCallback(next => {
    setValue(next);
    try { localStorage.setItem(QUICK_SETTINGS[name].key, String(next)); } catch { /* private mode */ }
  }, [name]);
  return [value, update];
}
