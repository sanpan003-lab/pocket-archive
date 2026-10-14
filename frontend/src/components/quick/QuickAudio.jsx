import { useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';

function fmt(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/**
 * Compact player for quick-note audio. Phone recordings saved before
 * conversion may report an Infinity/NaN duration — fall back to the
 * server-measured durationSec so the length still shows.
 */
export default function QuickAudio({ src, durationSec }) {
  const ref = useRef(null);
  const [playing, setPlaying]   = useState(false);
  const [current, setCurrent]   = useState(0);
  const [mediaDur, setMediaDur] = useState(NaN);

  const duration = Number.isFinite(mediaDur) && mediaDur > 0 ? mediaDur : (durationSec || 0);
  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function seek(e) {
    const t = Number(e.target.value);
    try { ref.current.currentTime = t; } catch { /* not seekable */ }
    setCurrent(t);
  }

  return (
    <div className="flex items-center gap-3 mt-3 min-w-0">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => setMediaDur(ref.current.duration)}
        onDurationChange={() => setMediaDur(ref.current.duration)}
        onTimeUpdate={() => setCurrent(ref.current.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
      />
      <button
        className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-white shadow-gold transition-transform active:scale-95"
        style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
      </button>
      <div className="relative flex-1 min-w-0">
        <div
          className="absolute left-0 h-1 rounded-full pointer-events-none"
          style={{ width: `${pct}%`, top: '50%', transform: 'translateY(-50%)', background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}
        />
        <input
          type="range"
          className="audio-track relative w-full"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          onChange={seek}
          disabled={!duration}
          aria-label="Seek"
        />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-navy-500 dark:text-white/50">
        {fmt(current)} / {fmt(duration)}
      </span>
    </div>
  );
}
