import { useEffect } from 'react';

const TONES = {
  success: 'linear-gradient(135deg,#10B981 0%,#059669 100%)',
  review:  'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)',
  queued:  'linear-gradient(135deg,#64748B 0%,#475569 100%)',
  ask:     'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)',
};

/**
 * Top-of-screen confirmation. Auto-dismisses after `toast.duration` (or
 * `duration`) ms; tap to dismiss early.
 * toast: { id, icon, text, detail?, tone, actions?: [{ label, onClick }], duration? }
 */
export default function QuickToast({ toast, onDismiss, duration = 4000 }) {
  const ms = toast?.duration || duration;
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, ms);
    return () => clearTimeout(t);
  }, [toast, onDismiss, ms]);

  if (!toast) return null;
  const actions = toast.actions || [];

  return (
    <div className="fixed inset-x-0 top-16 md:top-5 z-[150] flex justify-center px-4 pointer-events-none">
      <div
        key={toast.id}
        role="status"
        aria-live="polite"
        className="pointer-events-auto w-full max-w-md rounded-2xl text-white shadow-xl animate-fade-in overflow-hidden"
        style={{ background: TONES[toast.tone] || TONES.success, boxShadow: '0 12px 32px rgba(0,0,0,0.30)' }}
      >
        <button
          type="button"
          className="w-full flex items-start gap-3 px-5 py-4 text-left"
          onClick={onDismiss}
          aria-label={`${toast.text}. Tap to dismiss`}
        >
          <span className="text-2xl leading-none shrink-0 mt-0.5" aria-hidden="true">{toast.icon}</span>
          <span className="min-w-0">
            <span className="block text-lg font-bold leading-snug break-words">{toast.text}</span>
            {toast.detail && <span className="block text-sm font-medium text-white/85 mt-0.5">{toast.detail}</span>}
          </span>
        </button>
        {actions.length > 0 && (
          <div className="flex border-t border-white/25">
            {actions.map(a => (
              <button
                key={a.label}
                type="button"
                className="flex-1 h-12 text-base font-bold hover:bg-white/15 active:bg-white/25 border-r last:border-r-0 border-white/25"
                onClick={() => { a.onClick(); onDismiss(); }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
