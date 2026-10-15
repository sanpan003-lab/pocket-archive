import { useEffect, useRef, useState } from 'react';
import { Sparkles, RotateCcw, ChevronDown } from 'lucide-react';
import MarkdownRenderer from '../MarkdownRenderer';
import { summarizeQuickNote } from '../../lib/api';
import { stripTitleHeading } from './quickMeta';

// Collapses long content to ~4 lines with a "Show more" toggle
function Clamp({ clamp, children }) {
  const ref = useRef(null);
  const [expanded, setExpanded]       = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!clamp || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setOverflowing(el.scrollHeight > el.clientHeight + 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, [clamp, expanded]);

  if (!clamp) return children;

  const collapsed = !expanded;
  const fade = 'linear-gradient(to bottom, black 55%, transparent)';
  return (
    <div>
      <div
        ref={ref}
        className={collapsed ? 'max-h-[6.75rem] overflow-hidden' : ''}
        style={collapsed && overflowing ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
      >
        {children}
      </div>
      {(overflowing || expanded) && (
        <button
          className="mt-1 text-xs font-semibold text-gold-600 dark:text-gold-400 hover:underline"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/**
 * AI summary of a quick note.
 * pending → "Summarizing…" shimmer; failed → "Summary unavailable" + Retry;
 * done → markdown (clamped to ~4 lines when `clamp`), without a leading
 * heading that just repeats the note's title.
 */
export default function QuickSummary({ note, clamp = false, onChanged }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError]       = useState(null);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      onChanged?.(await summarizeQuickNote(note.id));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  if (note.summaryStatus === 'pending') {
    return (
      <div className="my-2" aria-live="polite">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-gold-600 dark:text-gold-400 mb-2">
          <Sparkles size={12} className="animate-pulse" /> Summarizing…
        </p>
        <div className="space-y-1.5">
          <div className="h-3 w-11/12 rounded bg-navy-100 dark:bg-white/10 animate-pulse" />
          <div className="h-3 w-3/4 rounded bg-navy-100 dark:bg-white/10 animate-pulse" />
        </div>
      </div>
    );
  }

  if (note.summaryStatus === 'failed') {
    return (
      <div className="my-2 flex flex-wrap items-center gap-2">
        <p className="text-xs text-navy-500 dark:text-white/50">Summary unavailable</p>
        {note.transcript && !note.undone && (
          <button className="btn-ghost text-xs py-1" onClick={retry} disabled={retrying}>
            <RotateCcw size={12} className={retrying ? 'animate-spin' : ''} />
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
        {error && <p className="basis-full text-xs text-red-500 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  if (note.summaryStatus !== 'done' || !note.summary) return null;

  return (
    <div className="my-2 break-words">
      <Clamp clamp={clamp} key={note.summaryUpdatedAt}>
        <div className="quick-summary">
          <MarkdownRenderer content={stripTitleHeading(note.summary, note.title)} />
        </div>
      </Clamp>
    </div>
  );
}

/** "Show transcript" disclosure with the original transcript in italics */
export function TranscriptToggle({ transcript, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!transcript) return null;
  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-1 text-xs font-medium text-navy-500 dark:text-white/50 hover:text-navy-800 dark:hover:text-white/80 transition-colors"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? 'Hide transcript' : 'Show transcript'}
      </button>
      {open && (
        <p className="text-sm italic text-navy-600 dark:text-white/60 mt-1.5 break-words animate-fade-in">
          “{transcript}”
        </p>
      )}
    </div>
  );
}
