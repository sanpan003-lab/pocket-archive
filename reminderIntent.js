// "Remind me …" detection and spoken-time parsing, independent of the AI classifier.
// The classifier sometimes files "remind me at 3" as an event, drops the time, or gets a relative
// time wrong ("in 2 minutes" → 2 hours). These rules are deterministic, so quickCapture applies
// them after the classifier: a reminder request is ALWAYS a reminder, and "in N minutes/hours" is exact.

const WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, couple: 2, few: 3,
};

function toNumber(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/-/g, ' ');
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s in WORDS) return WORDS[s];
  const [tens, ones, ...rest] = s.split(/\s+/);
  if (!rest.length && ones && WORDS[tens] >= 20 && WORDS[tens] % 10 === 0 && WORDS[ones] < 10) return WORDS[tens] + WORDS[ones];
  return null;
}

const UNIT_MS = { s: 1000, m: 60000, h: 3600000 };
const unitOf = u => (u.startsWith('sec') ? 's' : u.startsWith('min') ? 'm' : 'h');

const INTENT = [
  /\bremind (?:me|us)\b/,
  /\bset (?:a |an |another )?reminder\b/,
  /\b(?:add|make|create) (?:a |an )?reminder\b/,
  /\breminder (?:for|to|at|in|that)\b/,
  /\bdon'?t (?:let me )?forget\b/,
];

/** "in 20 minutes", "in an hour and a half", "in half an hour", "in two hours 15 minutes" → ms, or null */
function relativeMs(lower) {
  if (/\bin (?:a |an )?half(?: an| a)? hour\b/.test(lower)) return 30 * 60000;
  if (/\bin (?:an?|one) hour and a half\b/.test(lower)) return 90 * 60000;
  const re = /\bin\s+(?:about |around |roughly )?(\d+(?:\.\d+)?|[a-z]+(?:[ -][a-z]+)?)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b(?:\s*(?:and|,)?\s*(\d+|[a-z]+)\s+(minutes?|mins?))?/;
  const m = lower.match(re);
  if (!m) return null;
  let n = toNumber(m[1]);
  if (n == null) {
    // "in twenty five minutes" is matched as one phrase; "in a few minutes" is too vague but still a number
    return null;
  }
  let ms = n * UNIT_MS[unitOf(m[2])];
  if (m[3] && m[4] && unitOf(m[2]) === 'h') {
    const extra = toNumber(m[3]);
    if (extra != null) ms += extra * 60000;
  }
  return ms > 0 && ms <= 48 * 3600000 ? Math.round(ms) : null;
}

/** "at 3", "at 3:30 pm", "at noon", "9 am" → { h, mi, meridiem: 'am'|'pm'|null } */
function clockTime(lower) {
  if (/\bat noon\b|\bnoon\b/.test(lower)) return { h: 12, mi: 0, meridiem: 'pm' };
  if (/\bat midnight\b/.test(lower)) return { h: 12, mi: 0, meridiem: 'am' };
  const withMeridiem = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/);
  const bare = lower.match(/\b(?:at|by|around)\s+(\d{1,2})(?::(\d{2}))?(?!\d)(?:\s*o'?clock)?/);
  const m = withMeridiem || bare;
  if (!m) return null;
  const h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  if (h < 1 || h > 24 || mi > 59) return null;
  const meridiem = withMeridiem ? (m[3].startsWith('a') ? 'am' : 'pm') : null;
  return { h, mi, meridiem };
}

/** { intent, relativeMs, clock, tomorrow } for a transcript or typed text */
function analyze(text) {
  const lower = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  return {
    intent: INTENT.some(re => re.test(lower)),
    relativeMs: relativeMs(lower),
    clock: clockTime(lower),
    tomorrow: /\btomorrow\b/.test(lower),
  };
}

module.exports = { analyze, relativeMs, clockTime };
