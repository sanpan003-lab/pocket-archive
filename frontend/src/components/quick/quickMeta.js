import { CalendarClock, Bell, Link2, StickyNote } from 'lucide-react';

// color = badge tint and the accent bar on inbox cards (needs review uses REVIEW_ACCENT)
export const QUICK_TYPES = {
  event:     { label: 'Event',       icon: CalendarClock, badge: 'badge-sky',    color: '#3B82F6' },
  reminder:  { label: 'Reminder',    icon: Bell,          badge: 'badge-violet', color: '#8B5CF6' },
  note_link: { label: 'Linked note', icon: Link2,         badge: 'badge-teal',   color: '#14B8A6' },
  note:      { label: 'Quick note',  icon: StickyNote,    badge: 'badge-gold',   color: '#F59E0B' },
};

export const REVIEW_ACCENT = '#F97316';

export const TYPE_OPTIONS = Object.entries(QUICK_TYPES).map(([value, t]) => ({ value, label: t.label }));

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Stored values are New York wall time ("YYYY-MM-DD" or ISO with offset),
// so the first 10 characters are always the local calendar day.
export function quickDay(note) {
  const when = note.type === 'event' ? note.start : note.type === 'reminder' ? note.dueDate : null;
  return when ? when.slice(0, 10) : null;
}

function formatTimePart(iso) {
  const [h, m] = iso.slice(11, 16).split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${ampm}`;
}

function formatDayPart(dateOnly) {
  const [y, mo, d] = dateOnly.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatWhen(value) {
  if (!value) return null;
  if (DATE_ONLY_RE.test(value)) return formatDayPart(value);
  return `${formatDayPart(value.slice(0, 10))}, ${formatTimePart(value)}`;
}

// Short line describing when an event/reminder happens
export function describeWhen(note) {
  if (note.type === 'event' && note.start) {
    if (note.allDay) return `${formatWhen(note.start)} · all day`;
    const end = note.end && note.end.slice(0, 10) === note.start.slice(0, 10) ? ` – ${formatTimePart(note.end)}` : '';
    return `${formatWhen(note.start)}${end}`;
  }
  if (note.type === 'reminder') return note.dueDate ? `Due ${formatWhen(note.dueDate)}` : 'No due date';
  return null;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Compact "when" for confirmations: "Today 3 PM", "Tomorrow", "Fri", "Oct 27, 9:30 AM"
export function shortWhen(value) {
  if (!value) return '';
  const [y, mo, d] = value.slice(0, 10).split('-').map(Number);
  const day = new Date(y, mo - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400000);
  const dayLabel = diff === 0 ? 'Today'
    : diff === 1 ? 'Tomorrow'
      : diff > 1 && diff < 7 ? day.toLocaleDateString('en-US', { weekday: 'short' })
        : day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (DATE_ONLY_RE.test(value)) return dayLabel;
  const sep = diff >= 0 && diff < 7 ? ' ' : ', ';
  return `${dayLabel}${sep}${formatTimePart(value)}`;
}

/**
 * Short on-screen confirmation for a saved capture.
 * tone: 'success' | 'review' | 'queued'
 */
export function confirmationFor(note) {
  if (!note) return null;
  if (note.status === 'needs_review') return { icon: '⚠️', text: 'Saved — needs review', tone: 'review' };

  const calendarFailed = note.googleSync === 'failed';
  const detail = calendarFailed ? "Google Calendar didn't update" : null;
  const tone = calendarFailed ? 'review' : 'success';

  if (note.type === 'event') {
    const when = shortWhen(note.start);
    return { icon: '📅', text: `Added: ${note.title}${when ? ` · ${when}` : ''}`, tone, detail };
  }
  if (note.type === 'reminder') {
    const when = shortWhen(note.dueDate);
    return { icon: '⏰', text: `Reminder: ${note.title}${when ? ` · ${when}` : ''}`, tone, detail };
  }
  if (note.type === 'note_link') {
    const linked = (note.actions || []).map(a => a.match(/^Linked to “(.+)”$/)?.[1]).find(Boolean);
    return { icon: '📝', text: linked ? `Saved to ${linked}` : 'Saved to recording', tone, detail };
  }
  return { icon: '📝', text: 'Quick note saved', tone, detail };
}

// Values for <input type="date"> / <input type="datetime-local">
export function toInputValue(value, allDay) {
  if (!value) return '';
  return allDay ? value.slice(0, 10) : (DATE_ONLY_RE.test(value) ? `${value}T09:00` : value.slice(0, 16));
}

// ── Inbox cards ───────────────────────────────────────────────────────────

const normalize = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Words a summary heading adds without saying anything new
const FILLER = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'on', 'at', 'in', 'with', 'again',
  'note', 'notes', 'quick', 'summary', 'update', 'reminder', 'event', 'appointment', 'task']);

/** True when every (or nearly every) meaningful word of the heading is already in the title. */
function sameTitle(heading, title) {
  const h = normalize(heading);
  const t = normalize(title);
  if (!h || !t) return false;
  if (h === t || t.includes(h) || h.includes(t)) return true;
  const tw = t.split(' ');
  // "pickup" matches "pick up"
  const titleWords = new Set([...tw, ...tw.slice(1).map((w, i) => tw[i] + w)]);
  const words = h.split(' ').filter(w => !FILLER.has(w));
  if (!words.length) return true;
  const shared = words.filter(w => titleWords.has(w) || [...titleWords].some(x => x.length > 3 && (x.endsWith(w) || w.endsWith(x)))).length;
  return shared / words.length >= 0.6;
}

/** Drop a leading "# Heading" / "**Bold line**" that just repeats the card title. */
export function stripTitleHeading(summary, title) {
  if (!summary || !title) return summary;
  const lines = summary.split('\n');
  const first = lines.findIndex(l => l.trim());
  if (first < 0) return summary;
  const line = lines[first].trim();
  const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1]
    ?? line.match(/^(?:\*\*|__)(.+?)(?:\*\*|__):?$/)?.[1];
  if (!heading || !sameTitle(heading, title)) return summary;
  return lines.slice(first + 1).join('\n').replace(/^\s*\n/, '');
}

/** Plain-text summary for the collapsed card (markdown and chart tags removed). */
export function summaryPreview(note) {
  const text = stripTitleHeading(note.summary || '', note.title)
    .replace(/<pocket:[\s\S]*?<\/pocket:[^>]*>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Day header for a capture: "Today", "Yesterday", "Mon, Oct 12" (year added when not this year). */
export function dayHeader(iso, now = new Date()) {
  const day = startOfDay(iso);
  const diff = Math.round((startOfDay(now) - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(day.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export const dayKey = iso => startOfDay(iso).toDateString();

/** Card time: "5 min ago" within a day, otherwise the clock time (the day header has the date). */
export function cardTime(iso) {
  if (!iso) return '';
  if (Date.now() - new Date(iso).getTime() < 86400000) return timeAgo(iso);
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
