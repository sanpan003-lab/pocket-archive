import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, History, Link2 } from 'lucide-react';
import { quickAudioUrl } from '../../lib/api';
import QuickAudio from './QuickAudio';
import { TranscriptToggle } from './QuickSummary';

const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Later voice updates and merged notes, oldest first, each with its own audio/transcript. */
export default function UpdatesTimeline({ note, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const updates = note.updates || [];
  if (!updates.length) return null;
  return (
    <div className="mt-1">
      <button
        className="flex items-center gap-1.5 text-xs font-semibold text-navy-600 dark:text-white/60 hover:text-navy-900 dark:hover:text-white"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <History size={13} />
        {updates.length} update{updates.length === 1 ? '' : 's'}
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ol className="mt-2 border-l-2 border-gold-400/40 pl-4 space-y-3 animate-fade-in">
          {updates.map(u => (
            <li key={u.id} className="relative">
              <span className="absolute -left-[1.4rem] top-1.5 w-2.5 h-2.5 rounded-full bg-gold-500" aria-hidden="true" />
              <p className="text-xs font-semibold text-navy-500 dark:text-white/50">
                {when(u.at)}{u.kind === 'merge' ? ' · merged note' : ''}
              </p>
              <p className="text-sm text-navy-800 dark:text-white/85 break-words whitespace-pre-line">{u.text}</p>
              {u.transcript && u.transcript !== u.text && <TranscriptToggle transcript={u.transcript} />}
              {u.linkedRecordingId && (
                <Link to={`/recordings/${u.linkedRecordingId}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-300">
                  <Link2 size={12} /> Linked recording
                </Link>
              )}
              {u.hasAudio && <QuickAudio src={quickAudioUrl(u.captureId)} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
