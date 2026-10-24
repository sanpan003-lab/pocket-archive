import Toast from '../Toast';

/**
 * Top-of-screen confirmation (the shared toast stack, components/Toast.jsx). Auto-dismisses after
 * `toast.duration` (or `duration`) ms; ✕ or a swipe dismisses early — tapping the message doesn't.
 * toast: { id, icon, text, detail?, tone, actions?: [{ label, onClick }], duration? }
 */
export default function QuickToast({ toast, onDismiss, duration = 4000 }) {
  return <Toast toast={toast} onDismiss={onDismiss} duration={duration} />;
}
