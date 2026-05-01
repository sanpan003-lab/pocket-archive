import { useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';

function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function AudioPlayer({ src }) {
  const ref = useRef(null);
  const [playing, setPlaying]   = useState(false);
  const [current, setCurrent]   = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume]     = useState(1);
  const [muted, setMuted]       = useState(false);
  const [loading, setLoading]   = useState(true);

  function togglePlay() {
    const a = ref.current;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => {}); setPlaying(true); }
  }

  function seek(e) {
    const t = Number(e.target.value);
    ref.current.currentTime = t;
    setCurrent(t);
  }

  function changeVolume(e) {
    const v = Number(e.target.value);
    ref.current.volume = v;
    setVolume(v);
    setMuted(v === 0);
  }

  function toggleMute() {
    const a = ref.current;
    const next = !muted;
    a.muted = next;
    setMuted(next);
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="glass-panel p-5 mb-4">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onTimeUpdate={() => setCurrent(ref.current.currentTime)}
        onLoadedMetadata={() => { setDuration(ref.current.duration); setLoading(false); }}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        onCanPlay={() => setLoading(false)}
      />

      <div className="flex items-center gap-4">
        {/* Play / Pause */}
        <button
          className="btn-gold rounded-2xl shrink-0"
          style={{ padding: '10px 14px' }}
          onClick={togglePlay}
          disabled={loading}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>

        {/* Scrubber + time */}
        <div className="flex-1">
          <div className="relative mb-1">
            {/* Progress fill track */}
            <div
              className="absolute top-0 left-0 h-full rounded-full pointer-events-none"
              style={{
                width: `${pct}%`,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                borderRadius: 99,
                height: 4,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            />
            <input
              type="range"
              className="audio-track relative"
              min={0}
              max={duration || 0}
              step={0.1}
              value={current}
              onChange={seek}
              disabled={loading}
            />
          </div>
          <div className="flex justify-between text-xs text-navy-400 dark:text-white/40 font-medium">
            <span>{fmt(current)}</span>
            <span>{loading ? '—:——' : fmt(duration)}</span>
          </div>
        </div>

        {/* Volume — hidden on mobile to save space */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <button
            onClick={toggleMute}
            className="text-navy-400 dark:text-white/40 hover:text-navy-700 dark:hover:text-white/80 transition-colors"
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            className="audio-track"
            style={{ width: 60 }}
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={changeVolume}
          />
        </div>
      </div>
    </div>
  );
}
