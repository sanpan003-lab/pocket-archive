// Spoken feedback for hands-free Quick Capture (Web Speech API)

export function speak(text) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1;
    synth.speak(u);
  } catch {
    // speech is a nicety — never block the capture flow
  }
}

// iOS only allows speech that starts from a user gesture; speaking a silent
// utterance during the tap unlocks later (async) confirmations.
export function unlockSpeech() {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  } catch {
    // ignore
  }
}

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}
