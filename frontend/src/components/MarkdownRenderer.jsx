import { Fragment } from 'react';
import VizRenderer from './visualizations/VizRenderer';

// Split markdown into alternating text segments and viz blocks
function splitAtVizBlocks(md) {
  const parts = [];
  const re = /```json\s*(\{[\s\S]*?\})\s*```/g;
  let last = 0;
  let m;

  while ((m = re.exec(md)) !== null) {
    if (m.index > last) parts.push({ type: 'text', content: md.slice(last, m.index) });
    try {
      const obj = JSON.parse(m[1]);
      if (obj && typeof obj.type === 'string') {
        parts.push({ type: 'viz', data: obj });
      } else {
        parts.push({ type: 'text', content: m[0] });
      }
    } catch {
      parts.push({ type: 'text', content: m[0] });
    }
    last = re.lastIndex;
  }

  if (last < md.length) parts.push({ type: 'text', content: md.slice(last) });
  return parts;
}

// Render inline markdown: **bold**, *italic*, `code`
function renderInline(text, prefix = '') {
  const segments = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;
  let last = 0;
  let m;
  let k = 0;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push(text.slice(last, m.index));
    if (m[1] !== undefined)
      segments.push(
        <strong key={`${prefix}-b${k++}`} className="font-semibold text-navy-900 dark:text-white">
          {m[1]}
        </strong>
      );
    else if (m[2] !== undefined)
      segments.push(<em key={`${prefix}-i${k++}`} className="italic">{m[2]}</em>);
    else if (m[3] !== undefined)
      segments.push(
        <code
          key={`${prefix}-c${k++}`}
          className="bg-navy-100 dark:bg-white/10 px-1.5 py-0.5 rounded text-xs font-mono text-navy-800 dark:text-white/80"
        >
          {m[3]}
        </code>
      );
    last = re.lastIndex;
  }

  if (last < text.length) segments.push(text.slice(last));
  return segments.length === 1 && typeof segments[0] === 'string' ? segments[0] : segments;
}

// ── Table helpers ─────────────────────────────────────────────────────────────

function isTableRow(line) {
  return /^\|.+\|$/.test(line.trim());
}

function isSeparatorRow(line) {
  // Matches |---|---| or |:--:|--:| etc. — only dashes, colons, spaces, pipes
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

function parseTableCells(line) {
  const cells = line.trim().split('|').map(c => c.trim());
  // Strip empty first/last elements from leading/trailing pipes
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function parseAlignments(separatorLine) {
  return parseTableCells(separatorLine).map(cell => {
    const c = cell.trim();
    if (c.startsWith(':') && c.endsWith(':')) return 'center';
    if (c.endsWith(':')) return 'right';
    return 'left';
  });
}

function renderTable(tableLines, keyBase) {
  const headerCells = parseTableCells(tableLines[0]);

  // Detect optional separator row
  let alignments = headerCells.map(() => 'left');
  let dataStart = 1;
  if (tableLines.length > 1 && isSeparatorRow(tableLines[1])) {
    alignments = parseAlignments(tableLines[1]);
    dataStart = 2;
  }

  const dataRows = tableLines.slice(dataStart).map(parseTableCells);

  return (
    <div className="overflow-x-auto my-4 rounded-xl border border-black/10 dark:border-white/10">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-amber-50/80 dark:bg-amber-900/20">
            {headerCells.map((cell, ci) => (
              <th
                key={ci}
                className="px-4 py-3 font-semibold text-navy-900 dark:text-white border-b border-black/10 dark:border-white/10 whitespace-nowrap"
                style={{ textAlign: alignments[ci] ?? 'left' }}
              >
                {renderInline(cell, `${keyBase}-th-${ci}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => {
            const isLast = ri === dataRows.length - 1;
            return (
              <tr
                key={ri}
                className={`transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
                  ri % 2 === 1 ? 'bg-black/[0.02] dark:bg-white/[0.02]' : ''
                }`}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`px-4 py-3 text-navy-700 dark:text-white/80 ${
                      isLast ? '' : 'border-b border-black/[0.06] dark:border-white/10'
                    }`}
                    style={{ textAlign: alignments[ci] ?? 'left' }}
                  >
                    {renderInline(cell, `${keyBase}-td-${ri}-${ci}`)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main section renderer ─────────────────────────────────────────────────────

function renderSection(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();

    // Skip empty
    if (!trim) { i++; continue; }

    // Headings
    const hm = trim.match(/^(#{1,4})\s+(.+)/);
    if (hm) {
      const lvl = hm[1].length;
      const cls = [
        'text-xl font-bold text-navy-900 dark:text-white mt-7 mb-2',
        'text-lg font-bold text-navy-900 dark:text-white mt-6 mb-2 pb-1 border-b border-navy-100 dark:border-white/10',
        'text-base font-semibold text-navy-800 dark:text-white/90 mt-5 mb-1.5',
        'text-sm font-semibold text-navy-700 dark:text-white/80 mt-4 mb-1',
      ][lvl - 1] || 'text-sm font-semibold text-navy-700 dark:text-white/80 mt-3 mb-1';
      const Tag = `h${Math.min(lvl, 6)}`;
      out.push(<Tag key={k++} className={cls}>{renderInline(hm[2], String(k))}</Tag>);
      i++; continue;
    }

    // Horizontal rule (must come before table check — no pipe chars so no conflict)
    if (/^[-*_]{3,}$/.test(trim)) {
      out.push(<div key={k++} className="divider my-4" />);
      i++; continue;
    }

    // Table — collect all consecutive pipe-row lines
    if (isTableRow(trim)) {
      const tableLines = [];
      while (i < lines.length && isTableRow(lines[i].trim())) {
        tableLines.push(lines[i].trim());
        i++;
      }
      out.push(<Fragment key={k++}>{renderTable(tableLines, String(k))}</Fragment>);
      continue;
    }

    // Unordered list — dash/asterisk/plus bullets
    if (/^[-*+]\s/.test(trim)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i].trim())) {
        const txt = lines[i].trim().slice(2);
        items.push(
          <li key={i} className="text-navy-700 dark:text-white/80 leading-relaxed">
            {renderInline(txt, `ul-${i}`)}
          </li>
        );
        i++;
      }
      out.push(
        <ul key={k++} className="list-disc list-outside ml-5 space-y-1 my-2 text-sm">
          {items}
        </ul>
      );
      continue;
    }

    // Unicode bullet points (•)
    if (trim.startsWith('•')) {
      const items = [];
      while (i < lines.length && lines[i].trim().startsWith('•')) {
        const txt = lines[i].trim().replace(/^•\s*/, '');
        items.push(
          <li key={i} className="text-navy-700 dark:text-white/80 leading-relaxed">
            {renderInline(txt, `ub-${i}`)}
          </li>
        );
        i++;
      }
      out.push(
        <ul key={k++} className="list-disc list-outside ml-5 space-y-1 my-2 text-sm">
          {items}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s/.test(trim)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i].trim())) {
        const txt = lines[i].trim().replace(/^\d+[.)]\s/, '');
        items.push(
          <li key={i} className="text-navy-700 dark:text-white/80 leading-relaxed">
            {renderInline(txt, `ol-${i}`)}
          </li>
        );
        i++;
      }
      out.push(
        <ol key={k++} className="list-decimal list-outside ml-5 space-y-1 my-2 text-sm">
          {items}
        </ol>
      );
      continue;
    }

    // Blockquote
    if (trim.startsWith('> ')) {
      const txt = trim.slice(2);
      out.push(
        <blockquote
          key={k++}
          className="border-l-4 border-gold-400 pl-4 py-1 my-3 text-sm text-navy-600 dark:text-white/70 italic bg-gold-50 dark:bg-yellow-900/20 rounded-r-lg"
        >
          {renderInline(txt, `bq-${k}`)}
        </blockquote>
      );
      i++; continue;
    }

    // Paragraph — absorb consecutive non-special lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,4}\s/.test(lines[i].trim()) &&
      !/^[-*+]\s/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('•') &&
      !/^\d+[.)]\s/.test(lines[i].trim()) &&
      !/^[-*_]{3,}$/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('> ') &&
      !isTableRow(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length) {
      out.push(
        <p key={k++} className="text-navy-700 dark:text-white/80 leading-relaxed my-2 text-sm">
          {renderInline(paraLines.join(' '), `p-${k}`)}
        </p>
      );
    }
  }

  return out;
}

export default function MarkdownRenderer({ content }) {
  if (!content) return null;

  const parts = splitAtVizBlocks(content);

  return (
    <div>
      {parts.map((part, i) =>
        part.type === 'viz'
          ? <VizRenderer key={i} data={part.data} />
          : <Fragment key={i}>{renderSection(part.content)}</Fragment>
      )}
    </div>
  );
}
