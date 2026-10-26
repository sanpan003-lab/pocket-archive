// One-line live summaries under each Settings category (2.11.0): "App lock on · 2 devices", "Everything · 2.1 GB",
// "2.10.0 · Up to date". Each is fetched on its own; one that fails just shows nothing.
import { useEffect, useState } from 'react';
import { isNative } from './platform';
import { getDevices, getPlaces, getDocumentSettings, getNotifySettings, adminUsers, getHealth } from './api';
import { QuickRecorder } from '../native/quickRecorder';
import { useAppearance } from '../context/appearanceStore';
import { useOfflineStatus } from './offline/status';
import { gb } from './offline/format';
import { useAppUpdate } from './appUpdate';
import { WEB_VERSION } from './changelog';

const PRESET = { upStartStop: 'Volume up starts and stops', upStartDownStop: 'Up starts · down stops', custom: 'Custom keys' };
const LAYOUT = { grid: 'Grid', list: 'List', compact: 'Compact' };
const SORT = { newest: 'Newest first', oldest: 'Oldest first', updated: 'Recently changed', type: 'By type' };
const THEME = { system: 'Follows the phone', light: 'Light', dark: 'Dark', black: 'Black' };
const MODE = { everything: 'Everything', thumbs: 'Text + thumbnails', text: 'Text only', recent: 'Pinned + last 30 days' };
const NOTIFY = { every: 'Every change', summary: 'Summary', off: 'Notifications off' };
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** { [categoryId]: string } and whether a watch was seen (for the Watch category) */
export function useSettingsSummaries({ user, isAdmin, lite, archive }) {
  const [data, setData] = useState({});
  const { settings } = useAppearance();
  const offline = useOfflineStatus();
  const { state: update } = useAppUpdate();

  useEffect(() => {
    let alive = true;
    const put = patch => { if (alive) setData(d => ({ ...d, ...patch })); };
    getDevices().then(list => put({ devices: Array.isArray(list) ? list.length : null })).catch(() => {});
    getPlaces().then(p => put({ places: p })).catch(() => {});
    getDocumentSettings().then(d => put({ docs: d })).catch(() => {});
    getNotifySettings().then(n => put({ notify: n })).catch(() => {});
    if (isNative) {
      QuickRecorder.getAppLock?.().then(l => put({ lock: l })).catch(() => {});
      QuickRecorder.getRecorderSettings().then(r => put({ recorder: r })).catch(() => {});
    }
    if (isAdmin && !lite) adminUsers().then(u => put({ users: Array.isArray(u) ? u.length : (u?.users || []).length })).catch(() => {});
    if (isAdmin && archive) getHealth().then(h => put({ health: h?.ok === true })).catch(() => put({ health: false }));
    return () => { alive = false; };
  }, [isAdmin, lite, archive]);

  const join = (...parts) => parts.filter(Boolean).join(' · ');
  const devices = data.devices ? `${data.devices} device${data.devices === 1 ? '' : 's'}` : null;
  const recorder = data.recorder;
  const watchKnown = !!(recorder?.status?.watchKnown || update?.watch);
  const usage = offline.usage ? Object.values(offline.usage).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  const latest = update?.latest;

  const out = {
    account: join(data.lock?.enabled ? 'App lock on' : null, user?.twoFactor ? 'Two-step on' : 'Two-step off', devices),
    recording: recorder ? join(PRESET[recorder.settings?.preset] || 'Custom keys', recorder.settings?.confirmStart ? 'Press again to confirm' : null) : 'Keys, widget, side key',
    notes: join(LAYOUT[settings?.inbox?.layout] || 'Grid', SORT[settings?.inbox?.sort]),
    places: data.places ? join(data.places.home ? 'Home set' : 'No home yet', `${(data.places.saved || []).length} saved place${(data.places.saved || []).length === 1 ? '' : 's'}`) : 'Home, places, calendar',
    documents: data.docs ? (data.docs.auto !== false ? 'Read and filed automatically' : 'Read only when you ask') : 'Receipts, bills, warranties…',
    sharing: data.notify ? join(NOTIFY[data.notify.mode] || 'Every change', data.notify.quietStart && data.notify.quietEnd ? `quiet ${data.notify.quietStart}–${data.notify.quietEnd}` : null) : 'Shared lists, notifications',
    offline: offline.available ? join(MODE[offline.settings?.mode] || 'Everything', usage ? gb(usage) : null, !offline.online ? 'Offline' : offline.pending ? `${offline.pending} waiting` : null) : 'Offline copy',
    appearance: join(THEME[settings?.theme?.theme] || 'Follows the phone', cap(settings?.theme?.accent || 'gold')),
    watch: update?.watch ? join(`Watch ${update.watch.versionName || ''}`.trim(), update.watch.status) : 'Galaxy Watch',
    admin: join(data.users != null ? `${data.users} user${data.users === 1 ? '' : 's'}` : null, archive ? (data.health === false ? 'server not reachable' : data.health ? 'server OK' : null) : null) || 'Users, server',
    about: isNative && update
      ? join(update.current || '', latest && latest.versionCode > update.currentCode ? `Update ${latest.versionName} available` : 'Up to date')
      : WEB_VERSION,
  };
  return { summaries: out, watchKnown };
}
