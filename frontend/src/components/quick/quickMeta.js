import { CalendarClock, Bell, Link2, StickyNote } from 'lucide-react';

export const QUICK_TYPES = {
  event:     { label: 'Event',       icon: CalendarClock, badge: 'badge-violet', color: '#8B5CF6' },
  reminder:  { label: 'Reminder',    icon: Bell,          badge: 'badge-rose',   color: '#F43F5E' },
  note_link: { label: 'Linked note', icon: Link2,         badge: 'badge-blue',   color: '#6366F1' },
  note:      { label: 'Quick note',  icon: StickyNote,    badge: 'badge-slate',  color: '#64748B' },
};

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

// Values for <input type="date"> / <input type="datetime-local">
export function toInputValue(value, allDay) {
  if (!value) return '';
  return allDay ? value.slice(0, 10) : (DATE_ONLY_RE.test(value) ? `${value}T09:00` : value.slice(0, 16));
}
