import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Undo2, Redo2, Trash2, Pen, Highlighter, Eraser, Loader2, Check } from 'lucide-react';
import { createMediaNote } from '../../lib/api';

const COLORS = ['#111827', '#DC2626', '#2563EB', '#16A34A', '#F59E0B', '#9333EA'];
const SIZES = [{ key: 's', label: 'Thin', px: 2 }, { key: 'm', label: 'Medium', px: 5 }, { key: 'l', label: 'Thick', px: 10 }];
const TOOLS = [
  { key: 'pen', label: 'Pen', icon: Pen },
  { key: 'highlighter', label: 'Highlighter', icon: Highlighter },
  { key: 'eraser', label: 'Eraser', icon: Eraser },
];
const newClientId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

/** One stroke: smooth quadratic curve through the points */
function drawStroke(ctx, s) {
  const pts = s.points;
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = s.tool === 'highlighter' ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.tool === 'eraser' ? '#FFFFFF' : s.color;
  ctx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;
  ctx.lineWidth = s.tool === 'highlighter' ? s.size * 3 : s.tool === 'eraser' ? s.size * 4 : s.size;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  if (pts.length > 1) ctx.lineTo(pts.at(-1).x, pts.at(-1).y);
  ctx.stroke();
  ctx.restore();
}

/** Full-screen drawing: pen, highlighter, eraser · 6 colors · 3 sizes · undo/redo · clear · saves a PNG */
export default function DrawingComposer({ onClose, onSaved }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [strokes, setStrokes] = useState([]);
  const [redo, setRedo] = useState([]);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState('m');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const current = useRef(null);
  const frame = useRef(0);
  const clientId = useRef(newClientId());

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(ctx, s);
    if (current.current) drawStroke(ctx, current.current);
  }, [strokes]);

  // Size the canvas to its box (sharp on high-DPI screens)
  useEffect(() => {
    const fit = () => {
      const canvas = canvasRef.current, wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = wrap.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      redraw();
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [redraw]);

  useEffect(() => { redraw(); }, [redraw]);

  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => { html.style.overflow = prev; };
  }, []);

  const point = e => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const sizePx = SIZES.find(s => s.key === size).px;

  function down(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    current.current = { tool, color, size: sizePx, points: [point(e)] };
    redraw();
  }
  function move(e) {
    if (!current.current) return;
    const evs = e.getCoalescedEvents?.() || [e];
    for (const ev of evs) current.current.points.push(point(ev));
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(redraw);
  }
  function up() {
    if (!current.current) return;
    const s = current.current;
    current.current = null;
    setStrokes(list => [...list, s]);
    setRedo([]);
  }

  const undo = useCallback(() => {
    if (!strokes.length) return;
    setRedo(r => [...r, strokes.at(-1)]);
    setStrokes(strokes.slice(0, -1));
  }, [strokes]);
  const redoOne = useCallback(() => {
    if (!redo.length) return;
    setStrokes(list => [...list, redo.at(-1)]);
    setRedo(redo.slice(0, -1));
  }, [redo]);

  function clear() {
    if (!strokes.length || !window.confirm('Clear the drawing?')) return;
    setRedo([]);
    setStrokes([]);
  }

  const close = useCallback(() => {
    if (strokes.length && !saving && !window.confirm('Discard this drawing?')) return;
    onClose();
  }, [strokes.length, saving, onClose]);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') close();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redoOne(); else undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redoOne(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, undo, redoOne]);

  async function save() {
    if (!strokes.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await new Promise(resolve => canvasRef.current.toBlob(resolve, 'image/png'));
      const form = new FormData();
      form.append('file', blob, 'drawing.png');
      form.append('kind', 'drawing');
      form.append('title', title.trim());
      form.append('clientId', clientId.current);
      onSaved(await createMediaNote(form));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not save the drawing');
      setSaving(false);
    }
  }

  const iconBtn = 'w-11 h-11 rounded-xl flex items-center justify-center text-navy-700 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30';

  return (
    <div className="fixed inset-0 z-[210] note-surface flex flex-col note-anim-up" role="dialog" aria-modal="true" aria-label="New drawing">
      <div className="flex items-center gap-1 px-2 h-14 pt-[env(safe-area-inset-top)] box-content border-b border-navy-100 dark:border-white/10">
        <button className={iconBtn} onClick={close} aria-label="Cancel"><X size={21} /></button>
        <input
          className="flex-1 min-w-0 bg-transparent outline-none font-semibold text-navy-900 dark:text-white placeholder:text-navy-300 dark:placeholder:text-white/30 px-1"
          placeholder="Drawing"
          value={title}
          onChange={e => setTitle(e.target.value)}
          aria-label="Title"
        />
        <button className={iconBtn} onClick={undo} disabled={!strokes.length} aria-label="Undo"><Undo2 size={19} /></button>
        <button className={iconBtn} onClick={redoOne} disabled={!redo.length} aria-label="Redo"><Redo2 size={19} /></button>
        <button className={iconBtn} onClick={clear} disabled={!strokes.length} aria-label="Clear"><Trash2 size={19} /></button>
        <button className="btn-gold py-2 px-4 ml-1" onClick={save} disabled={!strokes.length || saving}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div ref={wrapRef} className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          className="draw-canvas absolute inset-0"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-label="Drawing canvas"
        />
        {error && <p className="absolute top-3 inset-x-3 text-center text-sm bg-red-600 text-white rounded-xl px-3 py-2" role="alert">{error}</p>}
      </div>

      <div className="border-t border-navy-100 dark:border-white/10 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <div className="flex gap-1" role="radiogroup" aria-label="Tool">
          {TOOLS.map(t => (
            <button key={t.key} role="radio" aria-checked={tool === t.key} aria-label={t.label} title={t.label} onClick={() => setTool(t.key)}
              className={`w-11 h-11 rounded-xl flex items-center justify-center ${tool === t.key ? 'bg-gold-500/15 text-gold-600 dark:text-gold-300' : 'text-navy-600 dark:text-white/70'}`}>
              <t.icon size={20} />
            </button>
          ))}
        </div>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Color">
          {COLORS.map(c => (
            <button key={c} role="radio" aria-checked={color === c} aria-label={`Color ${c}`} onClick={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }}
              className={`w-8 h-8 rounded-full border-2 ${color === c && tool !== 'eraser' ? 'border-gold-500 scale-110' : 'border-white dark:border-neutral-800'} shadow`}
              style={{ background: c }} />
          ))}
        </div>
        <div className="flex gap-1" role="radiogroup" aria-label="Size">
          {SIZES.map(sz => (
            <button key={sz.key} role="radio" aria-checked={size === sz.key} aria-label={sz.label} title={sz.label} onClick={() => setSize(sz.key)}
              className={`w-11 h-11 rounded-xl flex items-center justify-center ${size === sz.key ? 'bg-gold-500/15' : ''}`}>
              <span className="rounded-full bg-navy-800 dark:bg-white" style={{ width: sz.px + 4, height: sz.px + 4 }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
