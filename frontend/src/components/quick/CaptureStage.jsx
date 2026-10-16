import { useEffect, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import VoiceWaveform from './VoiceWaveform';
import { useAppearance } from '../../context/appearanceStore';

const SIZES = { small: 112, medium: 140, large: 180 };

const HINTS = [
  'Try: “Remind me to put clothes in the dryer when I get home”',
  'Try: “Add milk and eggs to the Publix list”',
  'Try: “Dentist Tuesday at 3”',
  'Try: “When I leave work, call Mom”',
  'Try: “For the Tesla drawer project: the cubby is 7 inches deep”',
  'Try: “Move the dentist to 4 PM”',
  'Try: “Next time I’m at Home Depot, get screws and tape”',
];

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return 'Up late?';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Good night';
}

const fmt = ms => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The Capture screen's stage: idle (greeting, breathing mic, rotating hints),
 * recording (timer, live neon waveform, Stop), processing (the wave collapses
 * into a shimmering pulse).
 */
export default function CaptureStage({ recording, processing, level, elapsedMs, onTap, statusText, error }) {
  const { settings, motion } = useAppearance();
  const size = SIZES[settings.capture.micSize] || SIZES.medium;
  const [hint, setHint] = useState(0);
  const [hintVisible, setHintVisible] = useState(true);
  const idle = !recording && !processing;

  // Rotate the example hints every few seconds (fade out, swap, fade in)
  useEffect(() => {
    if (!idle || motion === 'off') return undefined;
    const t = setInterval(() => {
      setHintVisible(false);
      setTimeout(() => { setHint(i => (i + 1) % HINTS.length); setHintVisible(true); }, 450);
    }, 5200);
    return () => clearInterval(t);
  }, [idle, motion]);

  if (recording || processing) {
    return (
      <div className="w-full max-w-2xl flex flex-col items-center gap-4 animate-fade-in">
        <p className="text-4xl font-bold tabular-nums text-navy-900 dark:text-white" aria-live="off">
          {processing ? '' : fmt(elapsedMs)}
        </p>
        <VoiceWaveform
          level={processing ? 0 : level}
          mode={processing ? 'collapse' : 'live'}
          variant={settings.capture.waveform}
          motion={motion}
          height={size + 24}
          label={processing ? 'Processing' : 'Recording — live voice level'}
        />
        <p className="text-base font-semibold text-navy-700 dark:text-white/80" aria-live="polite">{statusText}</p>
        {recording && (
          <button
            type="button"
            onClick={onTap}
            className="w-20 h-20 rounded-full flex items-center justify-center text-white shadow-xl active:scale-95 transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400/60"
            style={{ background: 'linear-gradient(135deg,#F43F5E 0%,#DC2626 100%)', boxShadow: '0 10px 30px rgba(244,63,94,0.40)' }}
            aria-label="Stop recording"
          >
            <Square size={28} fill="currentColor" />
          </button>
        )}
        {recording && settings.capture.showSilenceHint !== false && (
          <p className="-mt-2 text-xs text-navy-400 dark:text-white/40">Stops by itself after a pause</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 animate-fade-in">
      <p className="text-xl font-semibold text-navy-700 dark:text-white/80">{greeting()}</p>
      <div className="relative flex items-center justify-center" style={{ width: size * 1.6, height: size * 1.6 }}>
        <span className={`absolute rounded-full ${motion === 'full' ? 'capture-breathe' : ''}`} style={{ width: size * 1.35, height: size * 1.35 }} aria-hidden="true" />
        <button
          type="button"
          onClick={onTap}
          className="relative rounded-full flex items-center justify-center text-white transition-transform active:scale-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-400/60"
          style={{
            width: size, height: size,
            background: 'linear-gradient(135deg, rgb(var(--accent-500)) 0%, rgb(var(--accent-600)) 100%)',
            boxShadow: '0 10px 32px rgb(var(--accent-500) / 0.40), inset 0 2px 0 rgba(255,255,255,0.25)',
          }}
          aria-label="Start recording"
        >
          <Mic size={Math.round(size * 0.36)} />
        </button>
      </div>
      <p className={`text-center text-lg font-semibold px-2 max-w-md ${error ? 'text-red-500 dark:text-red-400' : 'text-navy-900 dark:text-white'}`} aria-live="polite">{statusText}</p>
      <p
        className={`text-center text-sm text-navy-500 dark:text-white/50 max-w-sm px-4 min-h-[2.5rem] transition-opacity duration-500 ${hintVisible ? 'opacity-100' : 'opacity-0'}`}
        aria-live="off"
      >
        {HINTS[hint]}
      </p>
    </div>
  );
}
