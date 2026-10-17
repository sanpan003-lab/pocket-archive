// Appearance & layout settings (Settings → Appearance & layout).
// Shared values live on the server (all devices); each group can instead be
// kept on this device only. Both are cached in localStorage for instant load.

export const APPEARANCE_DEFAULTS = {
  opening: {
    style: 'auto',          // auto | card | full | sheet | side | inline
    backdrop: 'blur',       // blur | fade | none
    swipe: true,
  },
  inbox: {
    layout: 'list',         // grid | list | compact
    preview: 'two',         // title | two | four | full
    showAudio: false,
    showBadge: true,
    showAccent: true,
    showTime: true,
    groupByDay: true,
    sort: 'newest',         // newest | oldest | updated | type
    pinnedSection: true,
  },
  look: {
    cardStyle: 'glass',     // glass | solid | outlined
    noteColors: true,
    transcriptOpen: false,
  },
  theme: {
    theme: 'system',        // system | light | dark | black
    accent: 'gold',         // gold | blue | teal | purple | rose
    textSize: 'default',    // small | default | large | xlarge
    density: 'comfortable', // comfortable | compact
    motion: 'system',       // system | full | reduced | off
  },
  toolbar: {
    order: '',              // comma-separated action ids ('' = default order)
    hidden: '',             // comma-separated action ids shown only in "⋯ More"
  },
  capture: {
    micSize: 'medium',      // small | medium | large
    waveform: 'neon',       // neon | gold | bars
    afterDone: 'capture',   // capture | inbox
  },
  icon: {
    tile: 'dark',           // dark | light | amoled — Purple Neon Bolt app icon (Android launcher + browser tab)
  },
  behavior: {
    defaultScreen: 'dashboard', // dashboard | quick | inbox | projects
    defaultTab: 'all',
    createButton: 'capture',    // capture (Quick Capture/Inbox/Projects) | everywhere
    haptics: true,
  },
};

export const GROUPS = Object.keys(APPEARANCE_DEFAULTS);

const LOCAL_KEY  = 'pa_appearance';        // { shared: {...}, device: {...}, scope: { group: 'device'|'all' } }

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (raw && typeof raw === 'object') return raw;
  } catch { /* private mode / corrupt */ }
  // First run: keep the old dark-mode toggle's choice
  let theme;
  try {
    const old = localStorage.getItem('pa_darkMode');
    if (old === 'true') theme = 'dark';
    else if (old === 'false') theme = 'light';
  } catch { /* ignore */ }
  return { shared: {}, device: theme ? { theme: { theme } } : {}, scope: theme ? { theme: 'device' } : {} };
}

export function loadLocal() {
  const raw = read();
  return { shared: raw.shared || {}, device: raw.device || {}, scope: raw.scope || {} };
}

export function saveLocal(state) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

/** Defaults ← shared (server) ← this device's groups */
export function effective({ shared, device, scope }) {
  const out = {};
  for (const g of GROUPS) {
    const src = scope[g] === 'device' ? device[g] : shared[g];
    out[g] = { ...APPEARANCE_DEFAULTS[g], ...(src || {}) };
  }
  return out;
}

// ── Option lists (labels for Settings) ──────────────────────────────────────
export const OPTIONS = {
  style: [
    ['auto', 'Auto'], ['card', 'Floating card'], ['full', 'Full screen'],
    ['sheet', 'Bottom sheet'], ['side', 'Side panel (desktop)'], ['inline', 'Expand in place'],
  ],
  backdrop: [['blur', 'Blur + fade'], ['fade', 'Fade only'], ['none', 'None']],
  layout: [['grid', 'Grid'], ['list', 'List'], ['compact', 'Compact list']],
  preview: [['title', 'Title only'], ['two', '2 lines'], ['four', '4 lines'], ['full', 'Full summary']],
  sort: [['newest', 'Newest'], ['oldest', 'Oldest'], ['updated', 'Recently updated'], ['type', 'Type']],
  cardStyle: [['glass', 'Glass'], ['solid', 'Solid'], ['outlined', 'Outlined']],
  theme: [['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['black', 'Black (AMOLED)']],
  accent: [['gold', 'Gold'], ['blue', 'Blue'], ['teal', 'Teal'], ['purple', 'Purple'], ['rose', 'Rose']],
  textSize: [['small', 'Small'], ['default', 'Default'], ['large', 'Large'], ['xlarge', 'Extra large']],
  density: [['comfortable', 'Comfortable'], ['compact', 'Compact']],
  motion: [['system', 'Follow system'], ['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']],
  defaultScreen: [['dashboard', 'Dashboard'], ['quick', 'Quick Capture'], ['inbox', 'Inbox'], ['projects', 'Projects']],
  defaultTab: [
    ['all', 'All'], ['review', 'Needs review'], ['event', 'Events'], ['reminder', 'Reminders'],
    ['errand', 'Errands'], ['projects', 'Projects'], ['notes', 'Notes'],
  ],
  createButton: [['capture', 'Quick Capture, Inbox & Projects'], ['everywhere', 'Everywhere']],
  micSize: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']],
  waveform: [['neon', 'Neon'], ['gold', 'Gold'], ['bars', 'Minimal bars']],
  afterDone: [['capture', 'Capture screen'], ['inbox', 'Inbox']],
};

export const ACCENT_SWATCH = { gold: '#F59E0B', blue: '#3B82F6', teal: '#14B8A6', purple: '#8B5CF6', rose: '#F43F5E' };

/** Keep-style soft note colors (light / dark), used when "Note colors" is on */
export const NOTE_COLORS = [
  { key: 'default', label: 'Default', light: null, dark: null },
  { key: 'red',     label: 'Coral',   light: '#FDE2E1', dark: '#5C2B29' },
  { key: 'orange',  label: 'Peach',   light: '#FDE9D6', dark: '#614A19' },
  { key: 'yellow',  label: 'Sand',    light: '#FEF6C7', dark: '#635D19' },
  { key: 'green',   label: 'Mint',    light: '#DFF5E3', dark: '#345920' },
  { key: 'teal',    label: 'Sage',    light: '#D7F2EE', dark: '#16504B' },
  { key: 'blue',    label: 'Fog',     light: '#DCEBFB', dark: '#2D555E' },
  { key: 'purple',  label: 'Dusk',    light: '#ECE3FB', dark: '#42275E' },
  { key: 'pink',    label: 'Blossom', light: '#FBE2EF', dark: '#5B2245' },
];
