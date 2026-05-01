import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Star, Mic } from 'lucide-react';
import { audioUrl } from '../lib/api';

function fmt(s) {
  if (!isFinite(s) || s < 0) return null;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatDateLabel(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T12:00:00');
  const dayOnly = new Date(dateStr + 'T12:00:00');
  dayOnly.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - dayOnly) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const currentYear = new Date().getFullYear();
  if (d.getFullYear() === currentYear) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function groupByDate(recordings) {
  const groups = {};
  for (const rec of recordings) {
    if (!groups[rec.date]) groups[rec.date] = [];
    groups[rec.date].push(rec);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, recs]) => ({ date, recs }));
}

const RING_R = 14;
const RING_C = 2 * Math.PI * RING_R;

function TimelineRow({ rec, isFav, onToggleFav, onClick }) {
  const [playing, setPlaying]   = useState(false);
  const [duration, setDuration] = useState(null);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onMeta  = () => setDuration(audio.duration);
    const onTime  = () => { if (audio.duration > 0) setProgress(audio.currentTime / audio.duration); };
    const onEnded = () => { setPlaying(false); setProgress(0); };
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  function togglePlay(e) {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play().catch(() => {}); setPlaying(true); }
  }

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
      onClick={onClick}
    >
      {rec.hasAudio && (
        <audio ref={audioRef} src={audioUrl(rec.audioFilename || `${rec.id}.mp3`)} preload="metadata" />
      )}

      {/* Mini play button */}
      {rec.hasAudio ? (
        <button
          className="relative shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)', boxShadow: '0 2px 8px rgba(245,158,11,0.35)' }}
          onClick={togglePlay}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing
            ? <Pause size={11} className="text-white" />
            : <Play  size={11} className="text-white" style={{ marginLeft: 1 }} />
          }
          {playing && (
            <svg className="absolute inset-0 w-8 h-8" style={{ transform: 'rotate(-90deg)' }} viewBox="0 0 32 32">
              <circle cx="16" cy="16" r={RING_R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
              <circle
                cx="16" cy="16" r={RING_R} fill="none" stroke="white" strokeWidth="2"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - progress)}
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      ) : (
        <div
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(15,23,42,0.06)' }}
        >
          <Mic size={13} className="text-navy-400 dark:text-white/40" />
        </div>
      )}

      {/* Title */}
      <p className="font-medium text-navy-900 dark:text-white text-sm flex-1 truncate min-w-0">
        {rec.title}
      </p>

      {/* Snippet — search results only, large screens */}
      {rec.snippet && (
        <p className="hidden lg:block text-xs text-navy-500 dark:text-white/40 truncate max-w-[200px] shrink-0">
          {rec.snippet}
        </p>
      )}

      {/* Badges — hidden on mobile */}
      <div className="hidden sm:flex gap-1 shrink-0">
        {rec.hasAudio        && <span className="badge badge-green" style={{ fontSize: 10, padding: '2px 7px' }}>Audio</span>}
        {rec.hasAiNotes      && <span className="badge badge-blue"  style={{ fontSize: 10, padding: '2px 7px' }}>AI</span>}
        {rec.hasOriginalNotes && <span className="badge badge-gold" style={{ fontSize: 10, padding: '2px 7px' }}>Orig</span>}
      </div>

      {/* Duration */}
      {rec.hasAudio && fmt(duration) && (
        <span className="text-xs text-navy-400 dark:text-white/40 shrink-0 tabular-nums">
          {fmt(duration)}
        </span>
      )}

      {/* Star */}
      <button
        className="shrink-0 transition-colors"
        style={{ color: isFav ? '#F59E0B' : '#CBD5E1' }}
        onClick={e => { e.stopPropagation(); onToggleFav(rec.id); }}
        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star size={15} fill={isFav ? '#F59E0B' : 'none'} />
      </button>
    </div>
  );
}

export function TimelineSkeletonRows({ count = 5 }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-navy-100 dark:bg-white/10 animate-pulse shrink-0" />
          <div className="h-4 flex-1 rounded bg-navy-100 dark:bg-white/10 animate-pulse" />
          <div className="hidden sm:block h-4 w-28 rounded bg-navy-100 dark:bg-white/10 animate-pulse shrink-0" />
          <div className="h-4 w-6 rounded-full bg-navy-100 dark:bg-white/10 animate-pulse shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default function TimelineView({ recordings, favorites, onToggleFav, onClickRec }) {
  const groups = groupByDate(recordings);

  return (
    <div className="flex flex-col gap-2">
      {groups.map(({ date, recs }) => (
        <div key={date}>
          {/* Date header */}
          <div className="pl-3 py-1.5 mb-0.5 border-l-2" style={{ borderColor: 'rgba(245,158,11,0.35)' }}>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-navy-400 dark:text-white/40">
              {formatDateLabel(date)}
            </span>
          </div>

          {recs.map(rec => (
            <TimelineRow
              key={rec.id}
              rec={rec}
              isFav={favorites.includes(rec.id)}
              onToggleFav={onToggleFav}
              onClick={() => onClickRec(rec.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
