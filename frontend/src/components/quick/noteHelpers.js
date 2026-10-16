import { NOTE_COLORS } from '../../lib/appearance';
import { summaryPreview } from './quickMeta';

/** Errands and typed checklists both have items */
export const hasChecklist = note => note.type === 'errand' || note.format === 'list';

/** Typed in the app (text, list, photo, drawing) rather than spoken */
export const isTyped = note => !!note.source && note.source !== 'voice';

/** Plain preview text: AI summary, else what was typed, else transcript / photo text */
export function previewText(note) {
  // Typed notes preview what was written (like Keep); voice notes their AI summary
  if (isTyped(note) && note.content) return note.content.replace(/[#*_`>]+/g, '').replace(/\s+/g, ' ').trim();
  if (note.summaryStatus === 'done' && note.summary) return summaryPreview(note);
  return (note.content || note.transcript || note.mediaText || '').replace(/[#*_`>]+/g, '').replace(/\s+/g, ' ').trim();
}

/** Card / note background for a Keep color (undefined = default surface) */
export function noteColorStyle(note, darkMode, enabled) {
  if (!enabled || !note?.color) return undefined;
  const c = NOTE_COLORS.find(x => x.key === note.color);
  return c?.light ? { background: darkMode ? c.dark : c.light } : undefined;
}

/** Opening style used on this screen: auto -> card (>=768px) or sheet (phone); side -> sheet on phones */
export function resolveOpenStyle(style, isMobile) {
  if (style === 'auto') return isMobile ? 'sheet' : 'card';
  if (style === 'side' && isMobile) return 'sheet';
  return style;
}
