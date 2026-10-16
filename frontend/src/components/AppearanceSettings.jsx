import { useState } from 'react';
import {
  Palette, RotateCcw, Monitor, Smartphone, Pin, StickyNote, ShoppingCart, CalendarClock, Square, Check, X,
} from 'lucide-react';
import { useAppearance } from '../context/appearanceStore';
import { OPTIONS, ACCENT_SWATCH, NOTE_COLORS } from '../lib/appearance';
import { noteColorStyle, resolveOpenStyle } from './quick/noteHelpers';
import { useIsMobile } from '../hooks/useIsMobile';
import ToolbarEditor from './quick/ToolbarEditor';

const GROUP_INFO = {
  opening:  { title: 'Opening notes' },
  inbox:    { title: 'Inbox layout' },
  look:     { title: 'Notes look' },
  theme:    { title: 'Theme' },
  capture:  { title: 'Capture screen' },
  toolbar:  { title: 'Note toolbar' },
  behavior: { title: 'Behavior' },
};

function Segmented({ label, value, options, onChange, id }) {
  return (
    <div className="py-2.5">
      <p id={id} className="text-sm font-semibold text-navy-900 dark:text-white mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby={id}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${value === v
              ? 'bg-gold-500/15 border-gold-400 text-gold-700 dark:text-gold-300'
              : 'border-navy-200 dark:border-white/15 text-navy-600 dark:text-white/65 hover:border-gold-300'}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Switch({ label, hint, checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="w-full flex items-center gap-3 py-2.5 text-left">
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-navy-900 dark:text-white">{label}</span>
        {hint && <span className="block text-xs text-navy-500 dark:text-white/50">{hint}</span>}
      </span>
      <span className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${checked ? 'bg-gold-500' : 'bg-navy-200 dark:bg-white/20'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

/** "Apply to: All devices / This device only" */
function ScopePicker({ group }) {
  const { scopeOf, setScope } = useAppearance();
  const scope = scopeOf(group);
  return (
    <div className="flex items-center gap-1 text-xs" role="radiogroup" aria-label={`${GROUP_INFO[group].title}: apply to`}>
      <span className="text-navy-400 dark:text-white/40 mr-1 hidden sm:inline">Apply to</span>
      {[['all', 'All devices', Monitor], ['device', 'This device', Smartphone]].map(([v, text, Icon]) => (
        <button key={v} type="button" role="radio" aria-checked={scope === v} onClick={() => setScope(group, v)}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg font-medium ${scope === v ? 'bg-navy-900 text-white dark:bg-white dark:text-navy-900' : 'text-navy-500 dark:text-white/55 hover:bg-black/5 dark:hover:bg-white/10'}`}>
          <Icon size={12} /> {text}
        </button>
      ))}
    </div>
  );
}

function Group({ group, children }) {
  return (
    <section className="py-3 border-t border-navy-100 dark:border-white/10 first:border-t-0" aria-labelledby={`ap-${group}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`ap-${group}`} className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45">{GROUP_INFO[group].title}</h3>
        <ScopePicker group={group} />
      </div>
      {children}
    </section>
  );
}

const SAMPLE = [
  { id: 'a', type: 'errand', title: 'Publix list', pinned: true, color: 'green', items: [{ id: 1, text: 'Milk', done: true }, { id: 2, text: 'Eggs' }, { id: 3, text: 'Bread' }], icon: ShoppingCart, badge: 'badge-green', label: 'Errand', accent: '#10B981', time: '9:12 AM' },
  { id: 'b', type: 'event', title: 'Dentist', when: 'Tue, Oct 20, 3 PM', preview: 'Cleaning with Dr. Smith. Bring the insurance card and arrive ten minutes early.', icon: CalendarClock, badge: 'badge-sky', label: 'Event', accent: '#3B82F6', time: '8:40 AM' },
  { id: 'c', type: 'note', title: 'Tesla drawer idea', color: 'yellow', preview: 'The cubby is 7 inches deep — a two-level drawer would fit the charger and the sunglasses.', icon: StickyNote, badge: 'badge-gold', label: 'Quick note', accent: 'rgb(var(--accent-500))', time: 'Yesterday' },
];
const CLAMP = { two: 'line-clamp-2', four: 'line-clamp-4' };

/** Live preview: a mini inbox + an opened note, drawn with the current settings */
function Preview() {
  const { settings, darkMode } = useAppearance();
  const isMobile = useIsMobile();
  const s = settings.inbox;
  const open = resolveOpenStyle(settings.opening.style, isMobile);
  const dense = settings.theme.density === 'compact';
  const notes = s.pinnedSection ? [...SAMPLE].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) : SAMPLE;

  const card = n => {
    const style = noteColorStyle(n, darkMode, settings.look.noteColors);
    if (s.layout === 'compact') {
      return (
        <div key={n.id} className="quick-card !rounded-xl flex items-center gap-2 px-3 py-2" style={style}>
          {s.showAccent && <span className="quick-card-accent" style={{ background: n.accent }} />}
          {s.showBadge && <n.icon size={13} style={{ color: n.accent }} />}
          {n.pinned && <Pin size={11} className="text-gold-500 fill-current" />}
          <span className="flex-1 truncate text-xs font-semibold text-navy-900 dark:text-white">{n.title}</span>
          {s.showTime && <span className="text-[10px] text-navy-400 dark:text-white/45">{n.time}</span>}
        </div>
      );
    }
    return (
      <div key={n.id} className={`quick-card ${dense ? 'px-3 py-2' : 'px-4 py-3'} ${s.layout === 'grid' ? 'break-inside-avoid mb-2' : ''}`} style={style}>
        {s.showAccent && <span className="quick-card-accent" style={{ background: n.accent }} />}
        <div className="flex items-center gap-1.5">
          {s.showBadge && <span className={`badge ${n.badge} !text-[10px] !py-0.5`}><n.icon size={10} /> {n.label}</span>}
          {n.pinned && <Pin size={11} className="text-gold-500 fill-current" />}
          {s.showTime && <span className="ml-auto text-[10px] text-navy-400 dark:text-white/45">{n.time}</span>}
        </div>
        <p className="mt-1 text-sm font-semibold text-navy-900 dark:text-white">{n.title}</p>
        {n.when && <p className="text-[11px] text-navy-500 dark:text-white/55">{n.when}</p>}
        {s.preview !== 'title' && (n.items ? (
          <ul className="mt-1 space-y-0.5">
            {n.items.slice(0, s.preview === 'two' ? 2 : 3).map(i => (
              <li key={i.id} className={`flex items-center gap-1.5 text-[11px] ${i.done ? 'line-through text-navy-400 dark:text-white/40' : 'text-navy-700 dark:text-white/75'}`}>
                {i.done ? <Check size={11} className="text-emerald-500" /> : <Square size={11} />} {i.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-1 text-[11px] text-navy-600 dark:text-white/65 ${CLAMP[s.preview] || ''}`}>{n.preview}</p>
        ))}
      </div>
    );
  };

  const openedLabel = { card: 'Floating card', full: 'Full screen', sheet: 'Bottom sheet', side: 'Side panel', inline: 'Expand in place' }[open];
  return (
    <div className="rounded-2xl border border-navy-100 dark:border-white/10 overflow-hidden" aria-label="Preview" role="img">
      <div className="relative h-72 sm:h-64 p-3 overflow-hidden" style={{ background: 'var(--preview-bg, transparent)' }}>
        <div className={s.layout === 'grid' ? 'columns-2 gap-2' : 'flex flex-col gap-2'}>
          {s.groupByDay && <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 dark:text-white/40 mb-0.5">Today</p>}
          {notes.map(card)}
        </div>
        {/* The opened note, in the chosen style */}
        {open !== 'inline' && (
          <div className={`absolute inset-0 flex ${open === 'sheet' ? 'items-end' : open === 'side' ? 'justify-end' : open === 'full' ? '' : 'items-center justify-center'} ${settings.opening.backdrop === 'blur' && (open === 'card' || open === 'sheet') ? 'note-scrim-blur' : settings.opening.backdrop === 'fade' && (open === 'card' || open === 'sheet') ? 'note-scrim-fade' : ''}`}>
            <div className={`note-surface shadow-2xl p-3 ${open === 'full' ? 'w-full h-full' : open === 'sheet' ? 'w-full h-[70%] rounded-t-2xl' : open === 'side' ? 'w-1/2 h-full rounded-2xl' : 'w-3/4 rounded-2xl'}`}
              style={noteColorStyle(SAMPLE[2], darkMode, settings.look.noteColors)}>
              {open === 'sheet' && <div className="mx-auto mb-2 w-8 h-1 rounded-full bg-navy-200 dark:bg-white/25" />}
              <div className="flex items-center gap-1.5">
                <span className="badge badge-gold !text-[10px] !py-0.5"><StickyNote size={10} /> Quick note</span>
                <X size={13} className="ml-auto text-navy-400" />
              </div>
              <p className="mt-1.5 text-sm font-bold text-navy-900 dark:text-white">Tesla drawer idea</p>
              <p className="mt-1 text-[11px] text-navy-600 dark:text-white/65 line-clamp-3">{SAMPLE[2].preview}</p>
            </div>
          </div>
        )}
      </div>
      <p className="px-3 py-2 text-xs text-navy-500 dark:text-white/50 border-t border-navy-100 dark:border-white/10">
        Opens as: <span className="font-semibold">{openedLabel}</span>
        {settings.opening.style === 'auto' && ` (Auto — ${isMobile ? 'phone' : 'wide screen'})`}
      </p>
    </div>
  );
}

/** Settings → Appearance & layout */
export default function AppearanceSettings() {
  const { settings, update, reset } = useAppearance();
  const [confirmReset, setConfirmReset] = useState(false);
  const set = (g, k) => v => update(g, k, v);
  const { opening, inbox, look, theme, behavior } = settings;

  return (
    <div id="appearance" className="glass-panel p-5 sm:p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Palette size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white flex-1">Appearance &amp; layout</h2>
        {confirmReset ? (
          <span className="flex items-center gap-1">
            <button className="btn-ghost text-xs text-red-600 dark:text-red-400" onClick={() => { reset(); setConfirmReset(false); }}>Reset everything</button>
            <button className="btn-ghost text-xs" onClick={() => setConfirmReset(false)}>Cancel</button>
          </span>
        ) : (
          <button className="btn-ghost text-xs" onClick={() => setConfirmReset(true)}><RotateCcw size={13} /> Reset to defaults</button>
        )}
      </div>
      <p className="text-sm text-navy-500 dark:text-white/50 mb-4">
        Saved to your account and shared across devices — or pick “This device” for a group (e.g. a different layout on the phone).
      </p>

      <div className="md:sticky md:top-2 z-10 mb-3"><Preview /></div>

      <Group group="opening">
        <Segmented id="ap-style" label="Note opening style" value={opening.style} options={OPTIONS.style} onChange={set('opening', 'style')} />
        <Segmented id="ap-backdrop" label="Background behind floating notes" value={opening.backdrop} options={OPTIONS.backdrop} onChange={set('opening', 'backdrop')} />
        <Switch label="Swipe between notes" hint="Swipe left/right (or ←/→) for the next or previous note" checked={opening.swipe} onChange={set('opening', 'swipe')} />
      </Group>

      <Group group="inbox">
        <Segmented id="ap-layout" label="Layout" value={inbox.layout} options={OPTIONS.layout} onChange={set('inbox', 'layout')} />
        <Segmented id="ap-preview" label="Card preview" value={inbox.preview} options={OPTIONS.preview} onChange={set('inbox', 'preview')} />
        <Segmented id="ap-sort" label="Sort" value={inbox.sort} options={OPTIONS.sort} onChange={set('inbox', 'sort')} />
        <p className="text-sm font-semibold text-navy-900 dark:text-white pt-2.5">Show on cards</p>
        <div className="grid sm:grid-cols-2 gap-x-6">
          <Switch label="Audio player" checked={inbox.showAudio} onChange={set('inbox', 'showAudio')} />
          <Switch label="Type badge" checked={inbox.showBadge} onChange={set('inbox', 'showBadge')} />
          <Switch label="Accent bar" checked={inbox.showAccent} onChange={set('inbox', 'showAccent')} />
          <Switch label="Time" checked={inbox.showTime} onChange={set('inbox', 'showTime')} />
        </div>
        <Switch label="Group by day" hint="Today / Yesterday / dates" checked={inbox.groupByDay} onChange={set('inbox', 'groupByDay')} />
        <Switch label="Pinned notes at the top" checked={inbox.pinnedSection} onChange={set('inbox', 'pinnedSection')} />
      </Group>

      <Group group="toolbar">
        <p className="text-xs text-navy-500 dark:text-white/50 pt-2 pb-1">Drag to reorder, tap the eye to show or hide. Tip: long-press the toolbar in a note to edit it there.</p>
        <ToolbarEditor />
      </Group>

      <Group group="look">
        <Segmented id="ap-card" label="Card style" value={look.cardStyle} options={OPTIONS.cardStyle} onChange={set('look', 'cardStyle')} />
        <Switch label="Note colors" hint={`${NOTE_COLORS.length - 1} soft colors, like Keep (Color in a note's toolbar)`} checked={look.noteColors} onChange={set('look', 'noteColors')} />
        <Switch label="Show transcript by default" checked={look.transcriptOpen} onChange={set('look', 'transcriptOpen')} />
      </Group>

      <Group group="theme">
        <Segmented id="ap-theme" label="Theme" value={theme.theme} options={OPTIONS.theme} onChange={set('theme', 'theme')} />
        <div className="py-2.5">
          <p id="ap-accent" className="text-sm font-semibold text-navy-900 dark:text-white mb-1.5">Accent color</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="ap-accent">
            {OPTIONS.accent.map(([v, text]) => (
              <button key={v} type="button" role="radio" aria-checked={theme.accent === v} onClick={() => update('theme', 'accent', v)}
                className={`inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-xl border text-sm font-medium ${theme.accent === v ? 'border-navy-900 dark:border-white text-navy-900 dark:text-white' : 'border-navy-200 dark:border-white/15 text-navy-600 dark:text-white/65'}`}>
                <span className="w-5 h-5 rounded-full" style={{ background: ACCENT_SWATCH[v] }} /> {text}
              </button>
            ))}
          </div>
          <p className="text-xs text-navy-400 dark:text-white/40 mt-1.5">Buttons, highlights and active tabs. The app icon stays gold.</p>
        </div>
        <Segmented id="ap-text" label="Text size" value={theme.textSize} options={OPTIONS.textSize} onChange={set('theme', 'textSize')} />
        <Segmented id="ap-density" label="Density" value={theme.density} options={OPTIONS.density} onChange={set('theme', 'density')} />
        <Segmented id="ap-motion" label="Animations" value={theme.motion} options={OPTIONS.motion} onChange={set('theme', 'motion')} />
      </Group>

      <Group group="capture">
        <Segmented id="ap-mic" label="Mic button size" value={settings.capture.micSize} options={OPTIONS.micSize} onChange={set('capture', 'micSize')} />
        <Segmented id="ap-wave" label="Waveform while recording" value={settings.capture.waveform} options={OPTIONS.waveform} onChange={set('capture', 'waveform')} />
        <Segmented id="ap-done" label="“Done” after a recording goes to" value={settings.capture.afterDone} options={OPTIONS.afterDone} onChange={set('capture', 'afterDone')} />
      </Group>

      <Group group="behavior">
        <Segmented id="ap-start" label="Default screen when opening the app" value={behavior.defaultScreen} options={OPTIONS.defaultScreen} onChange={set('behavior', 'defaultScreen')} />
        <Segmented id="ap-tab" label="Default Inbox tab" value={behavior.defaultTab} options={OPTIONS.defaultTab} onChange={set('behavior', 'defaultTab')} />
        <Segmented id="ap-create" label="Create (+) button" value={behavior.createButton} options={OPTIONS.createButton} onChange={set('behavior', 'createButton')} />
        <Switch label="Haptics" hint="Short vibrations on long-press and the create menu (Android)" checked={behavior.haptics} onChange={set('behavior', 'haptics')} />
      </Group>
    </div>
  );
}
