import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, FolderKanban, ScanText, Loader2, ChevronDown, Sparkles } from 'lucide-react';
import { quickAudioUrl, quickMediaUrl, convertHandwriting } from '../../lib/api';
import { useAppearance } from '../../context/appearanceStore';
import MarkdownRenderer from '../MarkdownRenderer';
import QuickSummary, { TranscriptToggle } from './QuickSummary';
import QuickAudio from './QuickAudio';
import UpdatesTimeline from './UpdatesTimeline';
import ErrandPanel from './ErrandPanel';
import { hasChecklist, isTyped } from './noteHelpers';
import GeoPlacePrompt from '../places/GeoPlacePrompt';
import NoteMap from '../places/NoteMap';
import NoteAttachments from './NoteAttachments';


/** The photo or drawing, with "Convert handwriting" and the text Gemini read from it */
export function NoteMedia({ note, onChanged, compact = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showText, setShowText] = useState(true);
  if (!note.media) return null;
  const drawing = note.media.kind === 'drawing';

  async function convert() {
    setBusy(true);
    setError(null);
    try { onChanged?.(await convertHandwriting(note.id)); }
    catch (err) { setError(err.response?.data?.error || 'Could not read the handwriting'); }
    finally { setBusy(false); }
  }

  return (
    <div className={compact ? '' : 'mb-3'}>
      <a href={quickMediaUrl(note.id)} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={quickMediaUrl(note.id)}
          alt={drawing ? 'Drawing' : (note.content || note.title || 'Photo')}
          className={`w-full rounded-2xl border border-navy-100 dark:border-white/10 object-contain ${drawing ? 'bg-white' : 'bg-black/5 dark:bg-white/5'} max-h-[60vh]`}
          loading="lazy"
        />
      </a>
      {!note.undone && !compact && (drawing || !note.mediaText) && (
        <button className="btn-ghost text-xs mt-2" onClick={convert} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ScanText size={13} />}
          {busy ? 'Reading…' : drawing ? (note.mediaText ? 'Read handwriting again' : 'Convert handwriting') : 'Read text in photo'}
        </button>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      {note.mediaText && !compact && (
        <div className="mt-2 rounded-xl bg-navy-50 dark:bg-white/5 px-3 py-2">
          <button className="flex items-center gap-1 text-xs font-semibold text-navy-500 dark:text-white/55" onClick={() => setShowText(s => !s)} aria-expanded={showText}>
            <ScanText size={12} /> {drawing ? 'Handwriting' : 'Text in photo'}
            <ChevronDown size={12} className={`transition-transform ${showText ? 'rotate-180' : ''}`} />
          </button>
          {showText && <p className="mt-1 text-sm text-navy-800 dark:text-white/85 whitespace-pre-line break-words">{note.mediaText}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Everything inside an opened note: photo/drawing, what was typed, checklist,
 * AI summary, updates timeline, transcript + audio, links.
 */
export default function NoteContent({ note, onChanged, projectName, arrivalReady }) {
  const { settings } = useAppearance();
  const typed = isTyped(note);
  const showSummary = note.summaryStatus && note.summaryStatus !== 'none';

  return (
    <div className="min-w-0">
      <GeoPlacePrompt note={note} onChanged={onChanged} />
      <NoteMap note={note} />
      <NoteMedia note={note} onChanged={onChanged} />
      <NoteAttachments note={note} onChanged={onChanged} />

      {/* What the user typed (markdown) */}
      {typed && note.content && (
        <div className="quick-summary text-[0.95rem] break-words mb-2">
          <MarkdownRenderer content={note.content} />
        </div>
      )}

      {hasChecklist(note) && (
        <div className="-mx-5 sm:-mx-6">
          <ErrandPanel note={note} onChanged={onChanged} arrivalReady={arrivalReady} />
        </div>
      )}

      {showSummary && (
        <section className={typed || hasChecklist(note) ? 'quick-card-divider pt-2 mt-1' : ''}>
          {typed && (
            <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-gold-600 dark:text-gold-400 mt-1">
              <Sparkles size={11} /> AI summary
            </p>
          )}
          <QuickSummary note={note} onChanged={onChanged} />
        </section>
      )}

      {(note.updates || []).length > 0 && (
        <section className="quick-card-divider py-3"><UpdatesTimeline note={note} defaultOpen /></section>
      )}

      {(note.transcript || (note.error && !typed) || note.linkedRecordingId || note.audioFile || note.projectId) && (
        <section className="quick-card-divider py-3">
          <TranscriptToggle transcript={note.transcript} defaultOpen={settings.look.transcriptOpen} />
          {!note.transcript && note.error && (
            <p className="text-xs text-amber-700 dark:text-amber-300 break-words">{note.error}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {note.linkedRecordingId && (
              <Link to={`/recordings/${note.linkedRecordingId}`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-300">
                <Link2 size={12} /> Open linked recording
              </Link>
            )}
            {note.projectId && (
              <Link to={`/projects/${note.projectId}`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gold-700 dark:text-gold-300">
                <FolderKanban size={12} /> {projectName || 'Open project'}
              </Link>
            )}
          </div>
          {note.audioFile && <QuickAudio src={quickAudioUrl(note.id)} durationSec={note.durationSec} />}
          {note.trigger && <p className="mt-1.5 text-[11px] text-navy-400 dark:text-white/40">Started from: {note.trigger}</p>}
        </section>
      )}
    </div>
  );
}
