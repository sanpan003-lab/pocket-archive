/** Text with the searched words marked (word starts, case- and accent-insensitive) */
export default function Highlight({ text, terms }) {
  const s = String(text || '');
  const ts = (terms || []).filter(Boolean);
  if (!s || !ts.length) return s;
  const fold = s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  // Folding only removes combining marks, so map folded positions back to the original
  const map = [];
  for (let i = 0; i < s.length; i++) {
    const f = s[i].toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    for (let k = 0; k < f.length; k++) map.push(i);
  }
  map.push(s.length);
  const marks = [];
  for (const t of ts) {
    let i = fold.indexOf(t);
    while (i !== -1) {
      const wordStart = i === 0 || !/[\p{L}\p{N}]/u.test(fold[i - 1]) || /\d/.test(t[0]);
      if (wordStart) marks.push([map[i], map[i + t.length - 1] + 1]);
      i = fold.indexOf(t, i + 1);
    }
  }
  if (!marks.length) return s;
  marks.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]); else merged.push([...m]);
  }
  const out = [];
  let at = 0;
  merged.forEach(([a, b], i) => {
    if (a > at) out.push(s.slice(at, a));
    out.push(<mark key={i} className="search-mark">{s.slice(a, b)}</mark>);
    at = b;
  });
  if (at < s.length) out.push(s.slice(at));
  return <>{out}</>;
}
