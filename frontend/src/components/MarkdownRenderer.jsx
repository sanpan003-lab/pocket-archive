import { Fragment, useEffect, useRef, useState } from 'react';
import VizRenderer from './visualizations/VizRenderer';

// ── Mermaid premium SVG post-processor ───────────────────────────────────────

function applyPremiumStyling(svgEl, uid) {
  if (!svgEl) return;

  // Ensure <defs> exists
  let defs = svgEl.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svgEl.insertBefore(defs, svgEl.firstChild);
  }

  // Parse gradient + filter markup inside a temp SVG so they get SVG namespace
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tmp.innerHTML = `
    <linearGradient id="mmg-${uid}" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#FFFBEB"/>
      <stop offset="100%" stop-color="#FDE68A"/>
    </linearGradient>
    <linearGradient id="mmd-${uid}" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#FEF3C7"/>
      <stop offset="100%" stop-color="#FBBF24"/>
    </linearGradient>
    <filter id="mmf-${uid}" x="-30%" y="-30%" width="160%" height="190%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="2" stdDeviation="3.5" flood-color="#92400E" flood-opacity="0.18"/>
    </filter>
  `;
  while (tmp.firstChild) defs.appendChild(tmp.firstChild);

  // Rect nodes — gradient fill + rounded corners + shadow
  svgEl.querySelectorAll('.node rect').forEach(el => {
    el.setAttribute('fill',         `url(#mmg-${uid})`);
    el.setAttribute('stroke',       '#D97706');
    el.setAttribute('stroke-width', '1.5');
    el.setAttribute('rx',           '8');
    el.setAttribute('ry',           '8');
    el.setAttribute('filter',       `url(#mmf-${uid})`);
  });

  // Diamond decision nodes
  svgEl.querySelectorAll('.node polygon').forEach(el => {
    el.setAttribute('fill',         `url(#mmd-${uid})`);
    el.setAttribute('stroke',       '#D97706');
    el.setAttribute('stroke-width', '1.5');
    el.setAttribute('filter',       `url(#mmf-${uid})`);
  });

  // Circle / ellipse terminal nodes
  svgEl.querySelectorAll('.node circle, .node ellipse').forEach(el => {
    el.setAttribute('fill',         `url(#mmd-${uid})`);
    el.setAttribute('stroke',       '#D97706');
    el.setAttribute('stroke-width', '2');
    el.setAttribute('filter',       `url(#mmf-${uid})`);
  });

  // Connector lines
  svgEl.querySelectorAll('.flowchart-link, .edgePath path').forEach(el => {
    el.setAttribute('stroke',       '#94A3B8');
    el.setAttribute('stroke-width', '1.5');
  });

  // Arrowheads
  svgEl.querySelectorAll('marker path, marker polygon').forEach(el => {
    el.setAttribute('fill',   '#94A3B8');
    el.setAttribute('stroke', 'none');
  });
}

// ── Mermaid diagram ───────────────────────────────────────────────────────────

function MermaidBlock({ chart }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'base',
          themeVariables: {
            primaryColor:        '#FEF3C7',
            primaryTextColor:    '#0F172A',
            primaryBorderColor:  '#D97706',
            lineColor:           '#94A3B8',
            secondaryColor:      '#FFF8EC',
            tertiaryColor:       '#F8FAFC',
            background:          '#FFFFFF',
            mainBkg:             '#FEF9EE',
            nodeBorder:          '#F59E0B',
            clusterBkg:          '#FEF3C7',
            titleColor:          '#0F172A',
            edgeLabelBackground: '#FFFBEB',
            fontFamily:          'Inter, system-ui, sans-serif',
            fontSize:            '13px',
          },
        });
        const id = 'mmd-' + Math.random().toString(36).slice(2, 9);
        const { svg } = await mermaid.render(id, chart.trim());
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          applyPremiumStyling(containerRef.current.querySelector('svg'), id);
        }
      } catch (err) {
        if (!cancelled) setError(String(err.message || err));
      }
    }
    render();
    return () => { cancelled = true; };
  }, [chart]);

  return (
    <div className="glass-card p-5 my-4 animate-slide-up overflow-x-auto">
      <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-3">Process Flow</p>
      {error
        ? <pre className="text-xs text-navy-500 dark:text-white/50 whitespace-pre-wrap font-mono">{chart}</pre>
        : <div ref={containerRef} className="flex justify-center [&_svg]:max-w-full" />
      }
    </div>
  );
}

// Split markdown into text segments, JSON viz blocks, and mermaid blocks
function splitAtVizBlocks(md) {
  const parts = [];
  const re = /```(json|mermaid)\s*([\s\S]*?)\s*```/g;
  let last = 0;
  let m;

  while ((m = re.exec(md)) !== null) {
    if (m.index > last) parts.push({ type: 'text', content: md.slice(last, m.index) });
    const lang = m[1];
    const body = m[2];
    if (lang === 'mermaid') {
      parts.push({ type: 'mermaid', chart: body });
    } else {
      try {
        const obj = JSON.parse(body);
        if (obj && typeof obj.type === 'string') {
          parts.push({ type: 'viz', data: obj });
        } else {
          parts.push({ type: 'text', content: m[0] });
        }
      } catch {
        parts.push({ type: 'text', content: m[0] });
      }
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
          : part.type === 'mermaid'
          ? <MermaidBlock key={i} chart={part.chart} />
          : <Fragment key={i}>{renderSection(part.content)}</Fragment>
      )}
    </div>
  );
}
