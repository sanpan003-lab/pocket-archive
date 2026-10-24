import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useSwipeDismiss } from '../lib/swipeDismiss';

/**
 * Every popup message (toasts, undo / restore, errors) goes through here:
 * - ✕ in the top-right corner (44 px), swipe up or sideways to dismiss; tapping the message itself does nothing
 * - all toasts share one stack below the top bar (never over the navigation), newest at the bottom;
 *   the stack lets taps through everywhere except on the toasts
 * - the timer pauses while a finger / pointer / keyboard focus is on a toast
 * - reduced motion: no slide or fade, swipes still work
 */

let stackEl = null;
function stackRoot() {
  if (stackEl && document.body.contains(stackEl)) return stackEl;
  stackEl = document.createElement('div');
  stackEl.className = 'toast-stack';
  stackEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(stackEl);
  return stackEl;
}

/** Auto-dismiss after ms, paused while hovered / touched / focused. ms = 0 → stays. */
function useAutoDismiss(onDismiss, ms, key) {
  const [paused, setPaused] = useState(false);
  const left = useRef(ms);
  useEffect(() => { left.current = ms; }, [ms, key]);
  useEffect(() => {
    if (!ms || paused) return undefined;
    const started = Date.now();
    const t = setTimeout(onDismiss, Math.max(500, left.current));
    return () => { clearTimeout(t); left.current -= Date.now() - started; };
  }, [ms, paused, onDismiss, key]);
  return {
    onPointerEnter: () => setPaused(true), onPointerLeave: () => setPaused(false),
    onFocus: () => setPaused(true), onBlur: e => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); },
  };
}

const TONES = {
  success: 'linear-gradient(135deg,#10B981 0%,#059669 100%)',
  review:  'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)',
  ask:     'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)',
  queued:  'linear-gradient(135deg,#64748B 0%,#475569 100%)',
  error:   'linear-gradient(135deg,#EF4444 0%,#DC2626 100%)',
  neutral: 'linear-gradient(135deg,#1E293B 0%,#0F172A 100%)',
};

/**
 * One toast in the shared stack.
 * toast: { id, icon?, text, detail?, tone?, actions?: [{ label, onClick }], duration? (ms, 0 = stays) }
 */
export default function Toast({ toast, onDismiss, duration = 4000 }) {
  return toast ? <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} ms={toast.duration ?? duration} /> : null;
}

function ToastCard({ toast, onDismiss, ms }) {
  const swipe = useSwipeDismiss(onDismiss);
  const timer = useAutoDismiss(onDismiss, ms, toast.id);
  const actions = toast.actions || [];
  const alert = toast.tone === 'error' || toast.tone === 'review';

  return createPortal(
    <div
      role={alert ? 'alert' : 'status'}
      data-toast=""
      className="toast-card pointer-events-auto relative w-full max-w-md rounded-2xl text-white overflow-hidden select-none"
      style={{ background: TONES[toast.tone] || TONES.success, boxShadow: '0 12px 32px rgba(0,0,0,0.30)', ...swipe.style }}
      {...swipe.handlers}
      {...timer}
    >
      <div className="flex items-start gap-3 pl-5 pr-12 py-4">
        {toast.icon && <span className="text-2xl leading-none shrink-0 mt-0.5" aria-hidden="true">{toast.icon}</span>}
        <span className="min-w-0">
          <span className="block text-lg font-bold leading-snug break-words">{toast.text}</span>
          {toast.detail && <span className="block text-sm font-medium text-white/85 mt-0.5 break-words">{toast.detail}</span>}
        </span>
      </div>
      <button
        type="button"
        className="absolute top-0 right-0 w-11 h-11 flex items-center justify-center rounded-bl-2xl text-white/85 hover:text-white hover:bg-white/15 active:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        onClick={onDismiss}
        aria-label="Dismiss"
        data-toast-close=""
      >
        <X size={20} strokeWidth={2.5} />
      </button>
      {actions.length > 0 && (
        <div className="flex border-t border-white/25">
          {actions.map(a => (
            <button
              key={a.label}
              type="button"
              className="flex-1 min-h-[48px] text-base font-bold hover:bg-white/15 active:bg-white/25 border-r last:border-r-0 border-white/25"
              onClick={() => { a.onClick(); if (!a.keepOpen) onDismiss(); }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>,
    stackRoot(),
  );
}
