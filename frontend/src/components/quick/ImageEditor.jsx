import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw, RotateCw, Crop, Pen, Highlighter, MoveUpRight, Type, Undo2, Check, Loader2 } from 'lucide-react';

const MAX_SIDE = 2400;
const COLORS = ['#ef4444', '#2563eb', '#111827', '#16a34a'];

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const copy = src => { const c = canvasOf(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; };
const toBlob = (c, q = 0.9) => new Promise(res => c.toBlob(b => res(b), 'image/jpeg', q));
async function thumbOf(c, max = 480) {
  const s = Math.min(1, max / Math.max(c.width, c.height));
  const t = canvasOf(c.width * s, c.height * s);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  return toBlob(t, 0.8);
}

function drawArrow(ctx, a, b, color, width) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const head = Math.max(14, width * 4);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
  ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
  ctx.closePath(); ctx.fill();
}
function drawLabel(ctx, p, text, color, size) {
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(p.x - 6, p.y - size, w + 12, size * 1.35);
  ctx.fillStyle = color;
  ctx.fillText(text, p.x, p.y);
}

/** One markup shape onto a 2D context (image coordinates) */
function paint(ctx, s) {
  ctx.save();
  if (s.tool === 'pen' || s.tool === 'highlight') {
    ctx.globalAlpha = s.tool === 'highlight' ? 0.35 : 1;
    ctx.strokeStyle = s.tool === 'highlight' ? '#facc15' : s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  } else if (s.tool === 'arrow' && s.points.length > 1) {
    drawArrow(ctx, s.points[0], s.points[s.points.length - 1], s.color, s.width);
  } else if (s.tool === 'text') {
    drawLabel(ctx, s.points[0], s.text, s.color, s.size);
  }
  ctx.restore();
}

function ToolButton({ icon: Icon, label, onClick, active }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={label}
      className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl text-[11px] font-medium ${active ? 'bg-gold-500 text-white' : 'text-white/85 hover:bg-white/10'}`}>
      <Icon size={18} /> {label}
    </button>
  );
}

/**
 * Edit a photo or scan page: rotate, crop, and light markup (pen, highlighter, arrow, text label).
 * Saved as a new version (the server keeps the original — "Restore original").
 * onSave(blob, thumbBlob) → Promise
 */
export default function ImageEditor({ src, title, onCancel, onSave }) {
  const [base, setBase] = useState(null);         // committed pixels (a canvas)
  const [history, setHistory] = useState([]);     // earlier bases (undo)
  const [shapes, setShapes] = useState([]);       // markup not yet committed
  const [tool, setTool] = useState(null);         // null | crop | pen | highlight | arrow | text
  const [color, setColor] = useState(COLORS[0]);
  const [crop, setCrop] = useState(null);         // { x, y, w, h } in image px
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const view = useRef(null);
  const drawing = useRef(null);
  const drag = useRef(null);

  // Load the image (downscaled to ≤ 2400 px)
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = canvasOf(img.naturalWidth * s, img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      setBase(c);
    };
    img.onerror = () => setError('This image can’t be edited in the browser (HEIC?)');
    img.src = src;
  }, [src]);

  // Render: base + markup (+ crop shade)
  const render = useCallback(() => {
    const c = view.current;
    if (!c || !base) return;
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    shapes.forEach(s => paint(ctx, s));
    if (drawing.current) paint(ctx, drawing.current);
    if (crop) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.rect(0, 0, c.width, c.height);
      ctx.rect(crop.x, crop.y, crop.w, crop.h);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, c.width / 400);
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      const h = Math.max(18, c.width / 40);
      ctx.fillStyle = '#fff';
      for (const [x, y] of [[crop.x, crop.y], [crop.x + crop.w, crop.y], [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h]]) ctx.fillRect(x - h / 2, y - h / 2, h, h);
      ctx.restore();
    }
  }, [base, shapes, crop]);
  useEffect(() => { render(); }, [render]);

  const commit = useCallback((next) => {
    setHistory(h => [...h.slice(-9), base]);
    setBase(next);
  }, [base]);

  /** Markup → into the pixels (before rotating, cropping or saving) */
  const flatten = useCallback(() => {
    if (!shapes.length) return base;
    const c = copy(base);
    const ctx = c.getContext('2d');
    shapes.forEach(s => paint(ctx, s));
    setShapes([]);
    return c;
  }, [base, shapes]);

  function rotate(dir) {
    const src = flatten();
    const c = canvasOf(src.height, src.width);
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(dir * Math.PI / 2);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    commit(c);
    setCrop(null);
    if (tool === 'crop') setTool(null);
  }

  function startCrop() {
    if (tool === 'crop') { setTool(null); setCrop(null); return; }
    const flat = flatten();
    if (flat !== base) commit(flat);
    const m = Math.round(Math.min(flat.width, flat.height) * 0.06);
    setCrop({ x: m, y: m, w: flat.width - 2 * m, h: flat.height - 2 * m });
    setTool('crop');
  }
  function applyCrop() {
    if (!crop) return;
    const c = canvasOf(crop.w, crop.h);
    c.getContext('2d').drawImage(base, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    commit(c);
    setCrop(null);
    setTool(null);
  }

  function undo() {
    if (shapes.length) { setShapes(s => s.slice(0, -1)); return; }
    if (!history.length) return;
    setBase(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setCrop(null);
    if (tool === 'crop') setTool(null);
  }

  // Pointer → image coordinates
  const pos = e => {
    const r = view.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (base.width / r.width), y: (e.clientY - r.top) * (base.height / r.height) };
  };
  const stroke = () => Math.max(3, base.width / (tool === 'highlight' ? 40 : 250));

  function down(e) {
    if (!base || !tool) return;
    e.preventDefault();
    view.current.setPointerCapture?.(e.pointerId);
    const p = pos(e);
    if (tool === 'crop' && crop) {
      const h = Math.max(30, base.width / 20);
      const corners = { nw: [crop.x, crop.y], ne: [crop.x + crop.w, crop.y], sw: [crop.x, crop.y + crop.h], se: [crop.x + crop.w, crop.y + crop.h] };
      const corner = Object.entries(corners).find(([, [x, y]]) => Math.abs(p.x - x) < h && Math.abs(p.y - y) < h)?.[0];
      const inside = p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h;
      drag.current = corner ? { corner, start: p, crop } : inside ? { corner: 'move', start: p, crop } : null;
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Label text');
      if (text?.trim()) setShapes(s => [...s, { tool: 'text', points: [p], text: text.trim().slice(0, 80), color, size: Math.max(18, base.width / 28) }]);
      return;
    }
    drawing.current = { tool, color, width: stroke(), points: [p] };
    render();
  }
  function move(e) {
    if (!base) return;
    const p = pos(e);
    if (drag.current) {
      const { corner, start, crop: c0 } = drag.current;
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      const min = Math.max(40, base.width / 15);
      let { x, y, w, h } = c0;
      if (corner === 'move') { x = Math.min(Math.max(0, x + dx), base.width - w); y = Math.min(Math.max(0, y + dy), base.height - h); }
      if (corner.includes('w')) { const nx = Math.min(Math.max(0, x + dx), x + w - min); w += x - nx; x = nx; }
      if (corner.includes('e')) w = Math.min(Math.max(min, w + dx), base.width - x);
      if (corner.includes('n')) { const ny = Math.min(Math.max(0, y + dy), y + h - min); h += y - ny; y = ny; }
      if (corner === 'sw' || corner === 'se') h = Math.min(Math.max(min, h + dy), base.height - y);
      setCrop({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
      return;
    }
    if (!drawing.current) return;
    if (drawing.current.tool === 'arrow') drawing.current.points = [drawing.current.points[0], p];
    else drawing.current.points.push(p);
    render();
  }
  function up() {
    drag.current = null;
    if (drawing.current) {
      const s = drawing.current;
      drawing.current = null;
      if (s.points.length > 1 || s.tool === 'pen') setShapes(list => [...list, s]);
    }
  }

  async function save() {
    if (!base || saving) return;
    setSaving(true);
    setError('');
    try {
      const flat = flatten();
      await onSave(await toBlob(flat), await thumbOf(flat));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Couldn’t save');
      setSaving(false);
    }
  }

  const changed = history.length > 0 || shapes.length > 0;
  const pick = id => () => { setCrop(null); setTool(t => (t === id ? null : id)); };

  return createPortal(
    <div className="fixed inset-0 z-[270] bg-black flex flex-col text-white" role="dialog" aria-modal="true" aria-label={`Edit ${title || 'image'}`} data-no-swipe>
      <div className="flex items-center gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <button className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white/10" onClick={() => (!changed || window.confirm('Discard your changes?')) && onCancel()} aria-label="Cancel"><X size={20} /></button>
        <p className="flex-1 min-w-0 truncate text-sm">{title || 'Edit image'}</p>
        <button className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white/10 disabled:opacity-30" onClick={undo} disabled={!changed} aria-label="Undo"><Undo2 size={18} /></button>
        {tool === 'crop'
          ? <button className="btn-gold text-sm py-1.5 px-3" onClick={applyCrop}><Check size={15} /> Apply crop</button>
          : <button className="btn-gold text-sm py-1.5 px-3" onClick={save} disabled={!changed || saving}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save</button>}
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-2 overflow-hidden">
        {error && !base && <p className="text-sm text-red-300">{error}</p>}
        {!base && !error && <Loader2 className="animate-spin" />}
        {base && (
          <canvas ref={view} className="max-w-full max-h-full object-contain" style={{ touchAction: tool ? 'none' : 'auto', cursor: tool ? 'crosshair' : 'default' }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Image" />
        )}
      </div>
      {error && base && <p className="text-xs text-red-300 text-center pb-1">{error}</p>}
      {['pen', 'arrow', 'text'].includes(tool) && (
        <div className="flex justify-center gap-2 pb-1" role="radiogroup" aria-label="Color">
          {COLORS.map(c => <button key={c} role="radio" aria-checked={color === c} aria-label={`Color ${c}`} onClick={() => setColor(c)} className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} />)}
        </div>
      )}
      <div className="flex justify-center flex-wrap gap-1 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 border-t border-white/10">
        <ToolButton icon={RotateCcw} label="Left" onClick={() => rotate(-1)} active={false} />
        <ToolButton icon={RotateCw} label="Right" onClick={() => rotate(1)} active={false} />
        <ToolButton icon={Crop} label="Crop" onClick={startCrop} active={tool === 'crop'} />
        <ToolButton icon={Pen} label="Pen" onClick={pick('pen')} active={tool === 'pen'} />
        <ToolButton icon={Highlighter} label="Highlight" onClick={pick('highlight')} active={tool === 'highlight'} />
        <ToolButton icon={MoveUpRight} label="Arrow" onClick={pick('arrow')} active={tool === 'arrow'} />
        <ToolButton icon={Type} label="Text" onClick={pick('text')} active={tool === 'text'} />
      </div>
    </div>,
    document.body,
  );
}
