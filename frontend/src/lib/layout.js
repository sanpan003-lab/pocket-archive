import { useSyncExternalStore } from 'react';
import { useApp } from '../context/AppContext';

// Which layout this person sees.
//   lite    — Lite accounts, or an admin who chose "Use Lite layout on this device" (Pocket Notes):
//             Capture, Inbox, Lists, Projects, Shared with me, Calendar, Search, Settings.
//   archive — the Hey Pocket archive (Dashboard stats, Recordings, AI Notes, Hey Pocket, Sync, Trash):
//             the admin only, and not in the Lite layout. The server enforces it either way.

const KEY = 'pa_liteLayout';
const listeners = new Set();
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

/** Admin only: use the Lite layout on this device (stays on this device) */
export function setLiteOnDevice(on) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach(fn => fn());
}

export function layoutFor(user, liteOnDevice) {
  const isAdmin = user?.role === 'admin';
  const lite = user?.plan === 'lite' || (isAdmin && liteOnDevice);
  return { lite, archive: isAdmin && !lite, appName: lite ? 'Pocket Notes' : 'Pocket Archive' };
}

/** { lite, archive, appName, liteOnDevice } */
export function useLayout() {
  const { user } = useApp();
  const liteOnDevice = useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, read);
  return { ...layoutFor(user, liteOnDevice), liteOnDevice };
}
