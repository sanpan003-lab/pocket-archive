import { createContext, useCallback, useContext } from 'react';

export const AppearanceContext = createContext(null);

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used within AppearanceProvider');
  return ctx;
}

/** Short vibration for UI taps — respects Settings → Behavior → Haptics */
export function useHaptics() {
  const { settings } = useAppearance();
  return useCallback(ms => {
    if (!settings.behavior.haptics) return;
    try { navigator.vibrate?.(ms); } catch { /* not supported */ }
  }, [settings.behavior.haptics]);
}
