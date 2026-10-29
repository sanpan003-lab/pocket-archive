// Settings categories (2.11.0): the top level of Settings, like a phone's settings menu. Each setting section (the DOM
// ids of the settings components, also used by search and by "/settings#…" links) belongs to one category.
import {
  ShieldCheck, Mic, StickyNote, MapPin, FileText, Users, HardDriveDownload, Palette, Watch, Server, Info,
} from 'lucide-react';

export const CATEGORIES = [
  { id: 'account',    name: 'Account & security',      icon: ShieldCheck },
  { id: 'recording',  name: 'Recording & shortcuts',   icon: Mic },
  { id: 'notes',      name: 'Notes & inbox',           icon: StickyNote },
  { id: 'places',     name: 'Places & reminders',      icon: MapPin },
  { id: 'documents',  name: 'Documents',               icon: FileText },
  { id: 'sharing',    name: 'Sharing & notifications', icon: Users },
  { id: 'offline',    name: 'Offline & storage',       icon: HardDriveDownload },
  { id: 'appearance', name: 'Appearance & app icon',   icon: Palette },
  { id: 'watch',      name: 'Watch',                   icon: Watch },
  { id: 'admin',      name: 'Admin',                   icon: Server },
  { id: 'about',      name: 'About & updates',         icon: Info },
];
export const CATEGORY_NAME = Object.fromEntries(CATEGORIES.map(c => [c.id, c.name]));

/** Section (element id) → category. Old "/settings#<id>" links and search use this. */
export const SECTION_CATEGORY = {
  security: 'account', passkeys: 'account', 'app-lock': 'account',
  recording: 'recording', accidental: 'recording', 'recording-log': 'recording', alarms: 'recording',
  'notes-look': 'notes', 'smart-append': 'notes',
  places: 'places', 'reminder-alerts': 'places', calendar: 'places',
  documents: 'documents',
  sharing: 'sharing', notifications: 'sharing',
  offline: 'offline',
  appearance: 'appearance', layout: 'appearance',
  watch: 'watch',
  users: 'admin', 'app-updates': 'admin', backend: 'admin', archive: 'admin', sync: 'admin',
  about: 'about', welcome: 'about',
};

/**
 * Which categories this account / device can use. ctx: { lite, archive, isAdmin, isNative, offline, watch }
 * Recording + Watch: the phone app (Watch only once a watch was seen). Admin: the admin, when Users (Full layout) or
 * the server / archive (archive) is shown here. Offline: the app (and the browser tests).
 */
export function visibleCategories(ctx) {
  return CATEGORIES.filter(c => {
    if (c.id === 'recording') return ctx.isNative;
    if (c.id === 'watch') return ctx.isNative && ctx.watch;
    if (c.id === 'offline') return ctx.offline;
    if (c.id === 'admin') return ctx.isAdmin && (!ctx.lite || ctx.archive);
    return true;
  });
}

export const categoryOf = section => SECTION_CATEGORY[section] || null;

const LAST_KEY = 'pa_settingsCategory';
export function lastCategory() { try { return localStorage.getItem(LAST_KEY); } catch { return null; } }
export function rememberCategory(id) { try { localStorage.setItem(LAST_KEY, id); } catch { /* ignore */ } }
