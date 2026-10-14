import { useEffect } from 'react';

const TONES = {
  success: 'linear-gradient(135deg,#10B981 0%,#059669 100%)',
  review:  'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)',
  queued:  'linear-gradient(135deg,#64748B 0%,#475569 100%)',
};

/**
 * Top-of-screen confirmation. Auto-dismisses after `duration` ms; tap to
 * dismiss early. toast: { id, icon, text, detail?, tone }
 */
export default function QuickToast({ toast, onDismiss, duration = 4000 }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [toast, onDismiss, duration]);

  if (!toast) return null;

  return (
    <div className="fixed inset-x-0 top-16 md:top-5 z-[150] flex justify-center px-4 pointer-events-none">
      <button
        key={toast.id}
        type="button"
        role="status"
        aria-live="polite"
        className="pointer-events-auto w-full max-w-md flex items-start gap-3 px-5 py-4 rounded-2xl text-left text-white shadow-xl animate-fade-in"
        style={{ background: TONES[toast.tone] || TONES.success, boxShadow: '0 12px 32px rgba(0,0,0,0.30)' }}
        onClick={onDismiss}
        aria-label={`${toast.text}. Tap to dismiss`}
      >
        <span className="text-2xl leading-none shrink-0 mt-0.5" aria-hidden="true">{toast.icon}</span>
        <span className="min-w-0">
          <span className="block text-lg font-bold leading-snug break-words">{toast.text}</span>
          {toast.detail && <span className="block text-sm font-medium text-white/85 mt-0.5">{toast.detail}</span>}
        </span>
      </button>
    </div>
  );
}
