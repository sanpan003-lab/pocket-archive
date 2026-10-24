// Settings search (2.8.0): every setting by title, description, section and everyday words for it.
// [section id, title, description, synonyms, { native | web | admin | full | archive, boost }, anchor text if not the title]
// Visibility: the flags first (Lite / Full / admin, phone vs web), then the page itself — a result is only shown
// when its row is really on this Settings page (some blocks hide themselves, e.g. without a fingerprint sensor).

export const SECTIONS = {
  layout: 'Layout on this device', appearance: 'Appearance & layout', recording: 'Recording & shortcuts',
  alarms: 'Alarms & phone actions', notifications: 'Notifications', backend: 'Server', archive: 'Archive',
  'smart-append': 'Smart append', documents: 'Documents', places: 'Places & errands', sharing: 'Shared lists',
  calendar: 'Google Calendar', security: 'Security', users: 'Users', sync: 'Syncing Recordings', welcome: 'Welcome tour',
  about: 'About',
};

const E = (section, title, desc = '', synonyms = '', flags = {}, anchor = null) => ({ section, title, desc, synonyms, flags, anchor });

const ENTRIES = [
  E('layout', 'Use Lite layout on this device', 'Pocket Notes only; hides the archive and admin settings here', 'lite full simple mode', { admin: true }),

  // Appearance & layout
  E('appearance', 'Appearance & layout', 'Theme, layout, colors, toolbar and more — per account or this device', 'look style customize'),
  E('appearance', 'Note opening style', 'How a note opens: floating, full screen, side panel', 'open popup sheet'),
  E('appearance', 'Background behind floating notes', '', 'blur dim backdrop'),
  E('appearance', 'Swipe between notes', 'Swipe left/right for the next or previous note', 'gesture next previous'),
  E('appearance', 'Inbox layout', 'Grid, list or compact cards', 'layout grid list masonry columns'),
  E('appearance', 'Card preview', 'How much text each card shows', 'lines snippet'),
  E('appearance', 'Sort', 'Newest, oldest, recently changed', 'order sorting'),
  E('appearance', 'Show on cards', 'Audio player, type badge, accent bar, time', 'badge time audio accent bar'),
  E('appearance', 'Group by day', 'Today / Yesterday / dates', 'dates headers'),
  E('appearance', 'Pinned notes at the top', '', 'pin pinned'),
  E('appearance', 'Show actions in Inbox', 'Alarms, timers, directions, messages in the Inbox', 'actions alarms timers'),
  E('appearance', 'Note toolbar', 'Reorder, show or hide the buttons in a note', 'buttons toolbar tools'),
  E('appearance', 'Card style', '', 'cards border shadow flat'),
  E('appearance', 'Note colors', 'Soft colors for notes, like Keep', 'colour color keep'),
  E('appearance', 'Show transcript by default', '', 'transcript text'),
  E('appearance', 'Theme', 'Light, dark or follow the system', 'dark light night mode black white appearance'),
  E('appearance', 'Accent color', 'Buttons, highlights and active tabs', 'colour gold blue purple green accent'),
  E('appearance', 'Text size', '', 'font bigger smaller large small zoom'),
  E('appearance', 'Density', 'Compact or comfortable spacing', 'compact spacing padding'),
  E('appearance', 'Animations', 'Full, reduced or off', 'motion animation reduce'),
  E('appearance', 'App icon', 'The home-screen icon style', 'icon launcher logo', { native: true }),
  E('appearance', 'Mic button size', 'On the Capture screen', 'microphone record button big'),
  E('appearance', 'Waveform while recording', '', 'wave bars visualizer'),
  E('appearance', '“Done” after a recording goes to', '', 'after done finish'),
  E('appearance', 'Default screen when opening the app', '', 'start screen home opening launch'),
  E('appearance', 'Default Inbox tab', '', 'tab filter'),
  E('appearance', 'Create (+) button', '', 'plus fab new create'),
  E('appearance', 'Haptics', 'Short vibrations on long-press and the create menu', 'vibrate vibration buzz'),
  E('appearance', 'Reset to defaults', 'Undo all appearance changes', 'reset default'),

  // Recording & shortcuts (the phone app)
  E('recording', 'Recording & shortcuts', 'Volume keys, side key, widget, accidental recordings, watch', 'volume keys record recorder shortcut', { native: true }),
  E('recording', 'Volume up starts and stops', 'Preset', 'preset volume', { native: true }),
  E('recording', 'Ways to start recording', 'Routines, side key, widget, tile, Hey Google, watch', 'start shortcut routine', { native: true }),
  E('recording', 'Samsung side key', 'Double-press the side key for Quick Record', 'power button side key bixby', { native: true, boost: 4 }),
  E('recording', 'Samsung Modes & Routines (e.g. a volume key)', '', 'routine routines modes volume', { native: true }),
  E('recording', 'Home-screen widget', '', 'widget home screen', { native: true }),
  E('recording', 'Quick Settings tile', '', 'tile quick settings shade', { native: true }),
  E('recording', '“Hey Google, open Quick Record”', '', 'assistant google voice hey', { native: true }),
  E('recording', 'Battery: Unrestricted', 'Keeps recording reliable with the screen off', 'battery power saving optimization doze', { native: true }),
  E('recording', 'Test a key', 'Press a key to see what it does', 'test volume key', { native: true }),
  E('recording', 'Volume up', 'While recording', 'volume key button', { native: true }),
  E('recording', 'Volume down', 'While recording: stop, discard or ignore', 'volume key button discard', { native: true }),
  E('recording', 'Long-press volume down discards', '', 'hold volume discard', { native: true }),
  E('recording', 'Auto-stop after silence', '', 'silence stop quiet', { native: true }),
  E('recording', 'Maximum length', '', 'max limit duration minutes', { native: true }),
  E('recording', 'Start/stop feedback', 'Sound or vibration', 'beep vibrate sound', { native: true }),
  E('recording', 'Countdown beep before recording starts', '', 'countdown beep', { native: true }),
  E('recording', 'Accidental recordings', 'Ignored starts, kept for 30 s with Restore', 'pocket accidental false mistake restore', { native: true }),
  E('recording', 'Press again to confirm', 'A 3-second prompt before recording from a key', 'confirm prompt accidental', { native: true }, 'Press again to confirm'),
  E('recording', 'Side key & volume keys: only when unlocked (strict)', '', 'strict unlocked lock screen', { native: true }),
  E('recording', 'Pocket detection', 'Proximity sensor: don’t record in a pocket', 'proximity pocket bag sensor', { native: true }),
  E('recording', 'Discard if no speech at the start', '', 'no speech voice silence', { native: true }),
  E('recording', 'Discard recordings shorter than 2 seconds', '', 'short tiny', { native: true }),
  E('recording', 'Recent recording starts', 'What started each recording, and Restore', 'log history starts restore', { native: true }),
  E('recording', 'Prevent double actions', '', 'double duplicate guard', { native: true }),
  E('recording', 'Double-press volume up to start recording', 'Accessibility shortcut', 'double press accessibility', { native: true }),
  E('recording', 'Double-press volume down to stop', '', 'double press accessibility', { native: true }),
  E('recording', 'Galaxy Watch', 'The watch’s own recording settings', 'watch wear galaxy wrist', { native: true }),

  // Alarms, notifications (the phone app)
  E('alarms', 'Alarms & phone actions', 'Alarms, timers, calls, messages from a voice note', 'alarm timer call text message phone actions', { native: true }),
  E('alarms', 'Keep actions for', '', 'history actions keep', { native: true }),
  E('notifications', 'Notifications', 'Location reminders, saved-note confirmations, recording controls', 'notification alerts push sounds', { native: true }),

  // Server / archive (the archive admin)
  E('backend', 'Server status', 'Is the backend reachable', 'server status nas connection backend', { archive: true }, 'Backend'),
  E('archive', 'Archive', 'Recordings, audio, AI notes, transcripts', 'archive stats recordings', { archive: true }),
  E('smart-append', 'Smart append', 'Add to existing notes and lists automatically', 'append merge add to auto threshold', { full: true }),
  E('smart-append', 'Auto-apply threshold', '', 'confidence', { full: true }),
  E('smart-append', 'Always ask before cancelling', '', 'cancel ask', { full: true }),

  // Documents, places, sharing, calendar
  E('documents', 'Documents', 'Receipts, bills, medical, school, warranty, business cards', 'receipt bill scan document ocr'),
  E('documents', 'Organize documents automatically', '', 'auto file categories'),
  E('documents', 'Kinds of documents', 'Turn each kind on or off', 'receipt bill medical school warranty business card'),
  E('places', 'Places & errands', 'Home, saved places, store reminders', 'location gps map address errands'),
  E('places', 'Home location', '', 'home address house'),
  E('places', 'Remind me on arrival for store errands', '', 'arrival store geofence location reminder'),
  E('places', 'My Places', 'Saved places with nicknames', 'saved places aliases work school'),
  E('sharing', 'Shared lists', 'People, notifications about changes, quiet hours', 'share sharing family people'),
  E('sharing', 'Notify me about other people’s changes', '', 'notifications changes quiet hours', {}, 'Notify me about other people'),
  E('calendar', 'Google Calendar', 'Events and reminders go to your calendar', 'calendar google events schedule'),
  E('calendar', 'Calendar ID', '', 'calendar id'),

  // Security
  E('security', 'Security', 'Password, two-step verification, passkeys, app lock, devices', 'lock locked privacy protect safe account'),
  E('security', 'Password', 'Change your password', 'password change login sign in credentials'),
  E('security', 'Two-step verification', 'A code from an authenticator app', '2fa two factor totp authenticator otp code'),
  E('security', 'Passkeys', 'Sign in with a fingerprint, face or Windows Hello', 'passkey webauthn fingerprint face windows hello', { web: true }),
  E('security', 'Lock app with fingerprint', 'App lock on this phone', 'fingerprint biometric face pin app lock lock secure privacy', { native: true }),
  E('security', 'Hide content in recent apps and screenshots', '', 'screenshot recents secure privacy', { native: true }),
  E('security', 'Where you’re signed in', 'Devices and sessions — sign out', 'devices sessions sign out logout phones', {}, 'Where you'),
  E('security', 'Recent security events', '', 'log security history'),

  // Admin
  E('users', 'Users', 'Create users, plans, passwords', 'accounts family members admin', { admin: true, full: true }),
  E('users', 'Create user', '', 'new account add user', { admin: true, full: true }),
  E('sync', 'Syncing Recordings', 'Import from Hey Pocket', 'sync import pocket python', { archive: true }),
  E('welcome', 'Welcome tour', 'Password, two-step, home, permissions, calendar', 'tour intro help onboarding'),

  // About
  E('about', 'About', 'Version and what’s new', 'version info update updates'),
  E('about', 'Check for updates', 'Updates for the Android app and the watch', 'update upgrade new version ota install', { native: true, boost: 5 }),
  E('about', 'Update watch', 'Send the watch update', 'watch update wear', { native: true }),
  E('about', 'What’s new', 'Release notes', 'changelog release notes news update updates version', {}, 'What’s new'),
  E('about', 'App updates', 'Publish phone and watch updates', 'ota publish apk', { admin: true }),
];

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’'“”"]/g, '');
const words = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

/** The settings this user / device can have (before checking the page) */
export function visibleEntries({ lite, archive, isAdmin, isNative }) {
  return ENTRIES.filter(({ flags: f }) =>
    (!f.native || isNative) && (!f.web || !isNative) && (!f.admin || isAdmin) && (!f.full || !lite) && (!f.archive || archive));
}

/** Best matches first: every word must start a word in the title, synonyms, section or description */
export function searchSettings(entries, query, limit = 12) {
  const ts = words(query);
  if (!ts.length) return [];
  const out = [];
  for (const e of entries) {
    const fields = [[words(e.title), 6], [words(e.synonyms), 4], [words(SECTIONS[e.section]), 2], [words(e.desc), 1]];
    let score = 0;
    let ok = true;
    for (const t of ts) {
      let best = 0;
      for (const [ws, w] of fields) {
        for (const x of ws) {
          if (x === t) best = Math.max(best, w + 1);
          else if (x.startsWith(t)) best = Math.max(best, w);
        }
      }
      if (!best) { ok = false; break; }
      score += best;
    }
    // Ties: the section itself, then a boosted entry, then the shorter title
    if (ok) out.push({ ...e, score: score + (norm(e.title).startsWith(norm(query)) ? 3 : 0) + (e.title === SECTIONS[e.section] ? 3 : 0) + (e.flags.boost || 0) - words(e.title).length * 0.1 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The row for an entry on the page: the section's element containing the title text (or null) */
export function findSettingElement(entry) {
  const section = document.getElementById(entry.section);
  if (!section) return null;
  const want = norm(entry.anchor || entry.title);
  if (want === norm(SECTIONS[entry.section]) || entry.title === SECTIONS[entry.section]) return section.querySelector('h2') || section;
  // Exact text, else text starting with it, else the shortest text containing it ("Turn on “Press again to confirm”")
  let starts = null;
  let contains = null;
  for (const el of section.querySelectorAll('h2, h3, h4, p, span, summary, dt, label, button')) {
    if (el.children.length > 3) continue;
    const t = norm(el.textContent).trim();
    if (!t) continue;
    if (t === want) return el;
    if (!starts && t.startsWith(want) && t.length < want.length + 40) starts = el;
    if (t.includes(want) && t.length < want.length + 80 && (!contains || t.length < norm(contains.textContent).length)) contains = el;
  }
  return starts || contains;
}

/** Scroll to a setting, open what it's inside (details), and flash it */
export function revealSetting(entry) {
  const el = findSettingElement(entry);
  if (!el) return false;
  for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
  window.dispatchEvent(new CustomEvent('pa:settings-reveal', { detail: { section: entry.section, title: entry.title } }));
  const row = el.closest('[role="switch"], li, details, label')
    || (el.tagName === 'P' && /\bpy-/.test(el.parentElement?.className || '') ? el.parentElement : null)
    || (el.tagName === 'H2' ? el.parentElement : el);
  const reduced = document.documentElement.dataset.motion ? document.documentElement.dataset.motion !== 'full'
    : window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  row.classList.remove('setting-flash');
  void row.offsetWidth;   // restart the animation
  row.classList.add('setting-flash');
  setTimeout(() => row.classList.remove('setting-flash'), 2600);
  return true;
}
