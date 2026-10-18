import { eventsUrl } from './api';
import { isNative } from './platform';
import { notifyQuickChanged } from './uiBus';
import { flushOps } from './opsQueue';
import { QuickRecorder } from '../native/quickRecorder';
import { syncErrands } from '../native/errands';

// Live updates (Server-Sent Events, /api/events): someone changed a note you can see, or shared
// something with you. Open lists reload; the app also refreshes its widget and geofences. The browser
// reconnects by itself (server: retry 3 s, heartbeat 25 s); when the stream is closed for good
// (signed out, media token expired) it's reopened with a fresh URL.

export const LIVE_EVENT = 'pa:live';

let source = null;
let reopenTimer = null;
let reloadTimer = null;
let nativeTimer = null;
let stopped = true;
let lastEventAt = 0;

function reloadSoon(detail) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => notifyQuickChanged({ id: detail?.id || null, live: true }), 250);
  if (isNative) {
    clearTimeout(nativeTimer);
    nativeTimer = setTimeout(() => {
      QuickRecorder.refreshWidget().catch(() => {}); // older APKs don't have it
      syncErrands();
    }, 1500);
  }
}

function handle(type, raw) {
  lastEventAt = Date.now();
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: { type, ...data } }));
  if (type === 'note' || type === 'share') reloadSoon(data);
}

function open() {
  if (stopped) return;
  close();
  try {
    source = new EventSource(eventsUrl(), { withCredentials: true });
  } catch { scheduleReopen(); return; }
  source.addEventListener('hello', e => { handle('hello', e.data); flushOps(); });
  source.addEventListener('note', e => handle('note', e.data));
  source.addEventListener('share', e => handle('share', e.data));
  source.onerror = () => { if (source?.readyState === EventSource.CLOSED) scheduleReopen(); };
}

function close() {
  if (source) { source.close(); source = null; }
}

function scheduleReopen(ms = 5000) {
  clearTimeout(reopenTimer);
  reopenTimer = setTimeout(open, ms);
}

/** Back from the background / online again: reconnect if needed and catch up on what was missed */
function wake() {
  if (stopped || document.visibilityState === 'hidden') return;
  if (!source || source.readyState === EventSource.CLOSED) open();
  if (Date.now() - lastEventAt > 60000) notifyQuickChanged({ live: true });
}

export function startLiveEvents() {
  if (typeof EventSource === 'undefined') return () => {};
  stopped = false;
  // The app needs its media token first (it's fetched right after sign-in)
  setTimeout(open, isNative ? 1500 : 0);
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);
  return () => {
    stopped = true;
    clearTimeout(reopenTimer);
    close();
    window.removeEventListener('online', wake);
    document.removeEventListener('visibilitychange', wake);
  };
}
