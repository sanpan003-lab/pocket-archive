import { useEffect, useRef } from 'react';

// Layer palettes: Neon = cyan → blue → magenta; Gold = the app's gold
const PALETTES = {
  neon: [['#22D3EE', '#3B82F6'], ['#3B82F6', '#A855F7'], ['#A855F7', '#EC4899'], ['#67E8F9', '#C084FC']],
  gold: [['#FDE68A', '#F59E0B'], ['#FBBF24', '#D97706'], ['#FCD34D', '#F97316'], ['#FFF7D6', '#FBBF24']],
};
// Each layer: relative amplitude, frequency (waves across the width), speed
const LAYERS = [
  { amp: 1.0, freq: 1.6, speed: 0.052, width: 2.6 },
  { amp: 0.72, freq: 2.3, speed: -0.07, width: 2.0 },
  { amp: 0.55, freq: 3.1, speed: 0.09, width: 1.6 },
  { amp: 0.32, freq: 4.4, speed: -0.12, width: 1.2 },
];

/**
 * Live voice waveform: glowing layered waves, symmetric around the center line,
 * reacting to `level` (0..1, from the Web Audio analyser or the Android service).
 * mode: 'live' (recording) | 'collapse' (processing: shrinks to a shimmering pulse) | 'idle'.
 * motion: 'full' | 'reduced' | 'off' (Settings → Animations / system reduced motion).
 */
export default function VoiceWaveform({ level = 0, mode = 'live', variant = 'neon', motion = 'full', height = 150, label }) {
  const canvas = useRef(null);
  const target = useRef(0);
  const state = useRef({ amp: 0, phase: 0, width: 1, t: 0 });
  useEffect(() => { target.current = level; }, [level]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return undefined;
    const ctx = c.getContext('2d');
    let raf = 0;
    let running = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height: h } = c.getBoundingClientRect();
      c.width = Math.round(width * dpr);
      c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);

    const draw = () => {
      if (!running) return;
      const { width: W, height: H } = c.getBoundingClientRect();
      const s = state.current;
      const mid = H / 2;
      const still = motion === 'off';
      // Smooth toward the live level; a little life even when quiet
      const want = mode === 'collapse' ? 0 : Math.min(1, 0.08 + target.current * 1.25);
      s.amp += (want - s.amp) * (still ? 1 : 0.18);
      s.width += ((mode === 'collapse' ? 0.06 : 1) - s.width) * (still ? 1 : 0.09);
      s.t += still ? 0 : motion === 'reduced' ? 0.35 : 1;
      ctx.clearRect(0, 0, W, H);

      const span = W * s.width;
      const x0 = (W - span) / 2;

      if (variant === 'bars') {
        // Minimal bars: mirrored, rounded, in the accent color
        const n = Math.max(12, Math.floor(span / 9));
        const color = getComputedStyle(c).getPropertyValue('--wave-bar').trim() || '#F59E0B';
        ctx.fillStyle = color;
        for (let i = 0; i < n; i++) {
          const x = x0 + (i + 0.5) * (span / n);
          const env = Math.sin(Math.PI * (i + 0.5) / n);
          const wobble = still ? 1 : 0.55 + 0.45 * Math.sin(s.t * 0.12 + i * 0.9);
          const h = Math.max(3, env * wobble * s.amp * (H * 0.86));
          const bw = Math.max(2, (span / n) * 0.5);
          ctx.beginPath();
          ctx.roundRect?.(x - bw / 2, mid - h / 2, bw, h, bw / 2) ?? ctx.rect(x - bw / 2, mid - h / 2, bw, h);
          ctx.fill();
        }
      } else {
        const palette = PALETTES[variant] || PALETTES.neon;
        ctx.globalCompositeOperation = 'lighter';
        LAYERS.forEach((L, li) => {
          const [c1, c2] = palette[li];
          const grad = ctx.createLinearGradient(x0, 0, x0 + span, 0);
          grad.addColorStop(0, c1);
          grad.addColorStop(0.5, c2);
          grad.addColorStop(1, c1);
          const A = s.amp * L.amp * (H * 0.42);
          const ph = s.t * L.speed + li;
          // Filled lens between +wave and −wave (symmetric around the center line)
          ctx.beginPath();
          const steps = 96;
          for (let k = 0; k <= steps; k++) {
            const u = k / steps;
            const env = (1 - (2 * u - 1) ** 2) ** 2; // taper to the ends
            const y = mid - Math.abs(A * env * Math.sin(u * L.freq * Math.PI * 2 + ph));
            k === 0 ? ctx.moveTo(x0, y) : ctx.lineTo(x0 + u * span, y);
          }
          for (let k = steps; k >= 0; k--) {
            const u = k / steps;
            const env = (1 - (2 * u - 1) ** 2) ** 2;
            const y = mid + Math.abs(A * env * Math.sin(u * L.freq * Math.PI * 2 + ph));
            ctx.lineTo(x0 + u * span, y);
          }
          ctx.closePath();
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = L.width;
          ctx.strokeStyle = grad;
          if (motion === 'full') { ctx.shadowColor = c2; ctx.shadowBlur = 14; }
          ctx.stroke();
          ctx.shadowBlur = 0;
        });
        // Bright center line (the "voice")
        ctx.globalAlpha = 0.55 + s.amp * 0.4;
        const core = ctx.createLinearGradient(x0, 0, x0 + span, 0);
        core.addColorStop(0, 'rgba(255,255,255,0)');
        core.addColorStop(0.5, '#FFFFFF');
        core.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = core;
        ctx.fillRect(x0, mid - 0.75, span, 1.5);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        // Processing: a shimmering pulse where the wave collapsed
        if (mode === 'collapse' && s.width < 0.2) {
          const r = 10 + (still ? 0 : Math.sin(s.t * 0.12) * 3);
          const g = ctx.createRadialGradient(W / 2, mid, 0, W / 2, mid, r * 2.4);
          g.addColorStop(0, '#FFFFFF');
          g.addColorStop(0.35, (palette[1] || palette[0])[1]);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(W / 2, mid, r * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); };
  }, [mode, variant, motion]);

  return (
    <div
      className={`relative w-full rounded-3xl overflow-hidden ${variant === 'bars' ? 'bg-navy-50 dark:bg-white/5' : 'bg-[#060814]'}`}
      style={{ height, '--wave-bar': 'rgb(var(--accent-500))' }}
    >
      {variant !== 'bars' && <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(60% 80% at 50% 50%, rgba(59,130,246,0.18), transparent 70%)' }} aria-hidden="true" />}
      <canvas ref={canvas} className="absolute inset-0 w-full h-full" role="img" aria-label={label || 'Live voice level'} />
    </div>
  );
}
