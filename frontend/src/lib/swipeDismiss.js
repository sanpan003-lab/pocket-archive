import { useCallback, useRef, useState } from 'react';

// Settings → Appearance → Motion (data-motion on <html>: full | reduced | off), else the system setting
export const reducedMotion = () => {
  const m = document.documentElement.dataset.motion;
  if (m) return m !== 'full';
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Swipe up / left / right past a threshold → onDismiss. Returns props for the element. */
export function useSwipeDismiss(onDismiss, { up = true, sideways = true } = {}) {
  const start = useRef(null);
  const moved = useRef(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false, leaving: null });

  const finish = useCallback(dir => {
    if (reducedMotion()) { onDismiss(); return; }
    setDrag(d => ({ ...d, active: false, leaving: dir }));
    setTimeout(onDismiss, 160);
  }, [onDismiss]);

  const onPointerDown = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    moved.current = false;
  };
  const onPointerMove = e => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    let dx = sideways ? e.clientX - s.x : 0;
    let dy = up ? Math.min(0, e.clientY - s.y) : 0;
    if (!moved.current && Math.hypot(dx, dy) < 8) return;
    if (!moved.current) { moved.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
    setDrag({ x: dx, y: dy, active: true, leaving: null });
  };
  const onPointerUp = e => {
    const s = start.current;
    start.current = null;
    if (!s || !moved.current) return;
    const dx = sideways ? e.clientX - s.x : 0;
    const dy = up ? e.clientY - s.y : 0;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)) finish(dx > 0 ? 'right' : 'left');
    else if (dy < -40 && Math.abs(dy) >= Math.abs(dx)) finish('up');
    else setDrag({ x: 0, y: 0, active: false, leaving: null });
  };
  const onPointerCancel = () => { start.current = null; setDrag({ x: 0, y: 0, active: false, leaving: null }); };
  // A swipe that ends on a button must not press it
  const onClickCapture = e => { if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; } };

  const off = { left: 'translateX(-120%)', right: 'translateX(120%)', up: 'translateY(-140%)' }[drag.leaving];
  const style = {
    transform: off || (drag.x || drag.y ? `translate(${drag.x}px, ${drag.y}px)` : undefined),
    opacity: off ? 0 : drag.x || drag.y ? Math.max(0.35, 1 - Math.max(Math.abs(drag.x) / 260, Math.abs(drag.y) / 120)) : undefined,
    transition: drag.active || reducedMotion() ? 'none' : 'transform 160ms ease-out, opacity 160ms ease-out',
    touchAction: 'none',
  };
  return { style, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture }, dragging: drag.active, finish };
}

