// Non-visual Quick Capture feedback (vibration + soft tones) so you know
// what happened without looking. Tones share one AudioContext that is
// unlocked while recording starts (tap or mic capture), so a chime played
// seconds later — after the server responds — isn't blocked by autoplay rules.

let ctx = null;

function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  return ctx;
}

// Call during a tap / while recording starts
export function primeAudio() {
  try { getCtx()?.resume().catch(() => {}); } catch { /* ignore */ }
}

function tone(notes) {
  try {
    const c = getCtx();
    if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    let t = c.currentTime + 0.01;
    for (const { freq, dur, gain = 0.06 } of notes) {
      const osc = c.createOscillator();
      const g   = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // soft attack and release — a chime, not a beep
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur * 0.6;
    }
  } catch {
    // audio cue is optional
  }
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

// Saved OK: double buzz + short rising two-note chime (~150 ms)
export function feedbackSuccess() {
  vibrate([60, 40, 60]);
  tone([{ freq: 880, dur: 0.09 }, { freq: 1318.5, dur: 0.12 }]);
}

// Needs review / error: one long buzz + a lower tone
export function feedbackWarning() {
  vibrate(300);
  tone([{ freq: 330, dur: 0.28, gain: 0.07 }]);
}
