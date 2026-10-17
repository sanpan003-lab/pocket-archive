import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAppearance, saveAppearance } from '../lib/api';
import { APPEARANCE_DEFAULTS, GROUPS, effective, loadLocal, saveLocal } from '../lib/appearance';
import { AppearanceContext } from './appearanceStore';

function useMedia(query) {
  const [match, setMatch] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const fn = () => setMatch(mq.matches);
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, [query]);
  return match;
}

/**
 * Appearance & layout: theme, accent, text size, density, motion, inbox layout,
 * note opening style… Applied to <html> as data attributes (see index.css).
 */
export function AppearanceProvider({ authenticated, children }) {
  const [state, setState] = useState(loadLocal);
  const settings = useMemo(() => effective(state), [state]);
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const systemReduced = useMedia('(prefers-reduced-motion: reduce)');
  const pending = useRef({});
  const timer = useRef(null);

  const { theme, accent, textSize, density, motion } = settings.theme;
  const dark = theme === 'dark' || theme === 'black' || (theme === 'system' && systemDark);
  const motionLevel = motion === 'system' ? (systemReduced ? 'reduced' : 'full') : motion;

  // Apply to <html>
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle('dark', dark);
    el.dataset.theme = theme === 'black' ? 'black' : dark ? 'dark' : 'light';
    el.dataset.accent = accent;
    el.dataset.textsize = textSize;
    el.dataset.density = density;
    el.dataset.motion = motionLevel;
    el.dataset.cardstyle = settings.look.cardStyle;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#F8FAFC');
  }, [dark, theme, accent, textSize, density, motionLevel, settings.look.cardStyle]);

  // Browser tab / home-screen bookmark icon follows Settings → App icon
  const iconTile = ['dark', 'light', 'amoled'].includes(settings.icon?.tile) ? settings.icon.tile : 'dark';
  useEffect(() => {
    document.querySelector('link[rel="icon"][type="image/svg+xml"]')?.setAttribute('href', `/icons/favicon-${iconTile}.svg`);
    document.querySelector('link[rel="icon"]:not([type])')?.setAttribute('href', `/icons/favicon-${iconTile}-32.png`);
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', `/icons/apple-touch-icon-${iconTile}.png`);
  }, [iconTile]);

  useEffect(() => { saveLocal(state); }, [state]);

  // Shared settings come from the server once signed in
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    getAppearance()
      .then(server => {
        if (cancelled || !server || typeof server !== 'object') return;
        const shared = {};
        for (const g of GROUPS) if (server[g]) shared[g] = server[g];
        setState(s => ({ ...s, shared }));
      })
      .catch(() => { /* offline: the cached copy is fine */ });
    return () => { cancelled = true; };
  }, [authenticated]);

  const flush = useCallback(() => {
    const body = pending.current;
    pending.current = {};
    if (Object.keys(body).length) saveAppearance(body).catch(() => { /* retried on the next change */ });
  }, []);

  const queueSave = useCallback((group, values) => {
    pending.current[group] = values;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }, [flush]);

  const update = useCallback((group, key, value) => {
    setState(s => {
      if (s.scope[group] === 'device') {
        const next = { ...APPEARANCE_DEFAULTS[group], ...(s.device[group] || {}), [key]: value };
        return { ...s, device: { ...s.device, [group]: next } };
      }
      const next = { ...(s.shared[group] || {}), [key]: value };
      queueSave(group, next);
      return { ...s, shared: { ...s.shared, [group]: next } };
    });
  }, [queueSave]);

  /** "Apply to: All devices / This device only" */
  const setScope = useCallback((group, scope) => {
    setState(s => {
      if (scope === 'device') {
        // Start from what this device shows now
        const current = { ...APPEARANCE_DEFAULTS[group], ...(s.shared[group] || {}) };
        return { ...s, scope: { ...s.scope, [group]: 'device' }, device: { ...s.device, [group]: s.device[group] || current } };
      }
      return { ...s, scope: { ...s.scope, [group]: 'all' } };
    });
  }, []);

  const reset = useCallback(() => {
    setState(s => {
      for (const g of GROUPS) if (s.scope[g] !== 'device') queueSave(g, {});
      return { ...s, shared: Object.fromEntries(GROUPS.filter(g => s.scope[g] === 'device').map(g => [g, s.shared[g] || {}])), device: {} };
    });
  }, [queueSave]);

  // Header / sidebar sun-moon toggle
  const setDarkMode = useCallback(next => {
    const want = typeof next === 'function' ? next(dark) : next;
    update('theme', 'theme', want ? (theme === 'black' ? 'black' : 'dark') : 'light');
  }, [dark, theme, update]);

  const value = useMemo(() => ({
    settings, update, setScope, reset,
    scopeOf: g => (state.scope[g] === 'device' ? 'device' : 'all'),
    darkMode: dark, setDarkMode, motion: motionLevel,
  }), [settings, update, setScope, reset, state.scope, dark, setDarkMode, motionLevel]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
