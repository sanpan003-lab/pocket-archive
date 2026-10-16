import { Share } from '@capacitor/share';
import { isNative } from './platform';
import { summaryPreview } from '../components/quick/quickMeta';

/** Plain text of a note for sharing: title, what was typed / summary, checklist */
export function noteShareText(note) {
  const body = note.content
    || (note.summaryStatus === 'done' && note.summary ? summaryPreview(note) : '')
    || note.transcript || note.mediaText || '';
  const items = (note.items || []).map(i => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n');
  return [note.title, body, items].filter(Boolean).join('\n\n');
}

/**
 * Android app: the system share sheet; browsers: Web Share, else copy.
 * Returns 'shared' | 'copied' | 'cancelled'.
 */
export async function shareNote(note) {
  const text = noteShareText(note);
  try {
    if (isNative) {
      await Share.share({ title: note.title, text, dialogTitle: 'Share note' });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share({ title: note.title, text });
      return 'shared';
    }
  } catch (err) {
    if (err?.name === 'AbortError' || /cancel/i.test(err?.message || '')) return 'cancelled';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
