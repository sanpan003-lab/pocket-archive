// Hey Pocket summaries embed chart tags such as
//   <pocket:timeline title="Attendance History">Aug 21, 2025 | Label | Description …</pocket:timeline>
//   <pocket:flowchart title="Workflow">Step A → Step B …</pocket:flowchart>
// These helpers find the tags and turn them into the data shapes the existing
// visualization components already understand. Anything that can't be parsed
// becomes a plain titled card so raw tags are never shown.

const OPEN_TAG_RE  = /<pocket:([\w-]+)([^>]*)>/gi;
const STRAY_TAG_RE = /<\/?pocket:[\w-]*[^>]*>/gi;
const ATTR_RE      = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|“([^”]*)”|([^\s"'>/]+))/g;

const MONTH    = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
const DATE_SRC = `(?:${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|${MONTH}\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{2,4}|Q[1-4]\\s+\\d{4})`;
// Start of a new "date | …" entry when newlines are missing
const DATE_ENTRY_SPLIT = new RegExp(`\\s+(?=${DATE_SRC}\\s*\\|)`, 'i');

const ARROW_RE = /\s*(?:-{1,2}>|={1,2}>|→|⟶|➔|➜|⇒|&rarr;)\s*/;

function parseAttrs(raw) {
  const attrs = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').trim();
  }
  return attrs;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Strip list markers and table pipes from the ends of a line
function cleanLine(line) {
  return line
    .replace(STRAY_TAG_RE, '')
    .trim()
    .replace(/^(?:[-*•+]|\d+[.)])\s+/, '')
    .replace(/^\|\s*/, '')
    .replace(/\s*\|$/, '')
    .trim();
}

/**
 * Split markdown into text segments and pocket tag blocks.
 * Handles closed tags, unclosed tags (run to the next tag or end of text)
 * and self-closing tags. Stray closing tags are removed from text.
 */
export function splitPocketTags(md) {
  if (!md || !/<\/?pocket:/i.test(md)) return [{ type: 'text', content: md || '' }];

  const parts = [];
  let last = 0;
  let m;
  OPEN_TAG_RE.lastIndex = 0;

  while ((m = OPEN_TAG_RE.exec(md)) !== null) {
    const [, rawType, rawAttrs] = m;
    if (m.index > last) parts.push({ type: 'text', content: md.slice(last, m.index) });

    let end  = OPEN_TAG_RE.lastIndex;
    let body = '';
    if (!/\/\s*$/.test(rawAttrs)) {
      const rest     = md.slice(end);
      const close    = new RegExp(`</pocket:${escapeRe(rawType)}\\s*>`, 'i').exec(rest);
      const nextOpen = rest.search(/<pocket:[\w-]+[^>]*>/i);
      if (close && (nextOpen === -1 || close.index < nextOpen)) {
        body = rest.slice(0, close.index);
        end += close.index + close[0].length;
      } else {
        const stop = nextOpen === -1 ? rest.length : nextOpen;
        body = rest.slice(0, stop);
        end += stop;
      }
    }

    parts.push({
      type:    'pocket',
      tagType: rawType.toLowerCase(),
      title:   parseAttrs(rawAttrs).title || '',
      body,
    });
    last = end;
    OPEN_TAG_RE.lastIndex = end;
  }

  if (last < md.length) parts.push({ type: 'text', content: md.slice(last) });

  return parts.map(p => (p.type === 'text' ? { ...p, content: p.content.replace(STRAY_TAG_RE, '') } : p));
}

/** "date | label | description" lines → [{ date, title, description }] or null */
export function parseTimeline(body) {
  const lines = body
    .split(/\r?\n/)
    .flatMap(l => l.split(DATE_ENTRY_SPLIT))
    .map(cleanLine)
    .filter(Boolean);

  const events = [];
  for (const line of lines) {
    const cells = line.split('|').map(c => c.trim());
    if (cells.length >= 2 && cells[0]) {
      events.push({
        date:        cells[0],
        title:       cells[1] || '',
        description: cells.slice(2).filter(Boolean).join(' | '),
      });
    } else if (events.length) {
      // Continuation text for the previous entry
      const prev = events[events.length - 1];
      prev.description = [prev.description, line].filter(Boolean).join(' ');
    }
  }
  return events.length ? events : null;
}

function nodeKey(label) {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

// When newlines are missing, "A → B B → C" splits into [A, "B B", C].
// Work out where one edge's target ends and the next edge's source begins.
function splitJoinedNode(token, known) {
  const words = token.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const left  = words.slice(0, i).join(' ');
    const right = words.slice(i).join(' ');
    if (nodeKey(left) === nodeKey(right)) return [left];
  }
  for (const n of known) {
    if (nodeKey(token).startsWith(nodeKey(n) + ' ')) return [n, token.slice(n.length).trim()];
    if (nodeKey(token).endsWith(' ' + nodeKey(n)))   return [token.slice(0, token.length - n.length).trim(), n];
  }
  return [token];
}

/** "A → B" edge lines → ordered, de-duplicated flowchart steps or null */
export function parseFlowchart(body) {
  const lines = body.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const tokenLines = lines.map(l => l.split(ARROW_RE).map(t => t.trim()).filter(Boolean));
  // Clean endpoints help resolve joined middle tokens
  const known = tokenLines.flatMap(t => (t.length ? [t[0], t[t.length - 1]] : []));

  const edges = [];
  for (const tokens of tokenLines) {
    if (tokens.length < 2) continue;
    let prev = tokens[0];
    for (let i = 1; i < tokens.length; i++) {
      const isMiddle = i < tokens.length - 1;
      const pieces   = isMiddle ? splitJoinedNode(tokens[i], known) : [tokens[i]];
      edges.push([prev, pieces[0]]);
      prev = pieces[pieces.length - 1];
    }
  }
  if (!edges.length) return null;

  const order = [];
  const label = new Map();
  const inDeg = new Map();
  const outs  = new Map();
  for (const [a, b] of edges) {
    for (const n of [a, b]) {
      const k = nodeKey(n);
      if (!label.has(k)) { label.set(k, n); order.push(k); inDeg.set(k, 0); outs.set(k, new Set()); }
    }
    const ka = nodeKey(a), kb = nodeKey(b);
    if (!outs.get(ka).has(kb)) {
      outs.get(ka).add(kb);
      inDeg.set(kb, inDeg.get(kb) + 1);
    }
  }
  if (order.length < 2) return null;

  return order.map((k, i) => {
    const out  = outs.get(k).size;
    let type   = 'process';
    if (i === 0 && inDeg.get(k) === 0)                 type = 'start';
    else if (i === order.length - 1 && out === 0)      type = 'end';
    else if (out > 1)                                  type = 'decision';
    return { id: i + 1, label: label.get(k), type };
  });
}

/** Readable bullet items for the fallback card */
export function toBulletItems(body) {
  return body
    .split(/\r?\n/)
    .flatMap(l => l.split(DATE_ENTRY_SPLIT))
    .map(cleanLine)
    .filter(Boolean)
    .map(l => l.replace(/\s*\|\s*/g, ' — ').split(ARROW_RE).join(' → '));
}

function humanize(type) {
  return type.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Convert a pocket tag block into a renderable part (viz data or fallback card) */
export function pocketTagToPart({ tagType, title, body }) {
  try {
    if (tagType === 'timeline') {
      const events = parseTimeline(body);
      if (events) return { type: 'viz', data: { type: 'timeline', title, events } };
    } else if (tagType === 'flowchart') {
      const steps = parseFlowchart(body);
      if (steps) return { type: 'viz', data: { type: 'flowchart', title, steps } };
    }
  } catch {
    // fall through to the card
  }
  const items = toBulletItems(body);
  if (!items.length && !title) return null;
  return { type: 'pocketCard', title: title || humanize(tagType), kind: humanize(tagType), items };
}
