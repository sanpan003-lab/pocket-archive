// Masking for text read from documents (2.6.0): full card numbers, bank account numbers, SSNs and other
// long ID numbers keep only their last 4 digits ("•••• 1234") before anything is stored, summarized or shown.
// Phone numbers (3-3-4 with optional +1), dates, money amounts and short numbers are left alone.

const DOTS = '••••';

// A run of digits (with spaces / dashes / dots between groups) holding at least 8 digits
const LONG_NUMBER = /(?<![\w.,$€£])(?:\d[ \-.]?){7,}\d(?![\w])/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
// Phone-shaped: (555) 123-4567, 555-123-4567, 555.123.4567, +1 555 123 4567
const PHONE = /^(?:\+?1[ \-.]?)?(?:\(\d{3}\)|\d{3})[ \-.]\d{3}[ \-.]\d{4}$/;
// Dates (2026-10-22, 10-22-2026) and ZIP+4 (32801-1234) aren't secrets
const NOT_SECRET = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[-.]\d{1,2}[-.]\d{2,4}|\d{5}-\d{4})$/;

function maskNumber(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return raw;
  if (PHONE.test(raw.trim()) || NOT_SECRET.test(raw.trim())) return raw;
  return `${DOTS} ${digits.slice(-4)}`;
}

/** Mask sensitive numbers in free text */
function maskText(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(SSN, m => `•••-••-${m.slice(-4)}`)
    .replace(LONG_NUMBER, m => maskNumber(m));
}

/** Mask every string inside a (JSON) value; phone / email fields only if they aren't phone-shaped */
function maskDeep(value) {
  if (typeof value === 'string') return maskText(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  return value;
}

module.exports = { maskText, maskDeep };
