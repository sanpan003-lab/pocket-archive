import { useSyncExternalStore } from 'react';

// Tiny shared UI flags across pages (e.g. hide the "+" button while the Inbox
// is in select mode) and a "quick notes changed" signal for open lists.

let fabHidden = false;
const listeners = new Set();

export function setFabHidden(value) {
  if (fabHidden === value) return;
  fabHidden = value;
  listeners.forEach(fn => fn());
}

export function useFabHidden() {
  return useSyncExternalStore(
    fn => { listeners.add(fn); return () => listeners.delete(fn); },
    () => fabHidden,
  );
}

/** A note was created / changed elsewhere (create menu) → lists reload */
export function notifyQuickChanged(note) {
  window.dispatchEvent(new CustomEvent('pa:quick-changed', { detail: note || null }));
}

export function onQuickChanged(fn) {
  const handler = e => fn(e.detail);
  window.addEventListener('pa:quick-changed', handler);
  return () => window.removeEventListener('pa:quick-changed', handler);
}

/** Settings → Welcome tour: open the first-sign-in walkthrough again */
export const OPEN_WELCOME = 'pa:open-welcome';
export function openWelcome() { window.dispatchEvent(new Event(OPEN_WELCOME)); }
