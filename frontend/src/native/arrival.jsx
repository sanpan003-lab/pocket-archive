import { useState } from 'react';
import { MapPin, BellRing, ShieldCheck } from 'lucide-react';
import { useArrivalPermission, wasAsked, markAsked } from './errands';

/**
 * Explanation screen, shown once when the first arrival errand exists and
 * location isn't allowed yet. Mounted once for the signed-in app.
 */
export function ArrivalPermissionPrompt() {
  const { supported, status, activeCount, ready, enable } = useArrivalPermission();
  const [dismissed, setDismissed] = useState(wasAsked);

  if (!supported || !status || ready || dismissed || activeCount === 0) return null;

  function later() {
    markAsked();
    setDismissed(true);
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="arrival-title"
    >
      <div className="w-full sm:max-w-md p-6 rounded-t-3xl sm:rounded-3xl animate-slide-up" style={{ background: '#0F172A' }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(16,185,129,0.15)' }}>
          <MapPin size={28} className="text-emerald-400" />
        </div>
        <h2 id="arrival-title" className="text-xl font-bold text-white mb-2">Remind me when I arrive</h2>
        <p className="text-sm text-white/70 leading-relaxed mb-4">
          Your errand list can pop up when you get to the store, even if the app is closed.
          For that, Android needs location access <strong className="text-white">all the time</strong>.
        </p>
        <ul className="space-y-3 mb-6 text-sm text-white/70">
          <li className="flex gap-3">
            <ShieldCheck size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <span>Your location stays on this phone. Pocket Archive never sends it anywhere; only store locations come from your server.</span>
          </li>
          <li className="flex gap-3">
            <BellRing size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <span>
              Android asks twice: first choose <strong className="text-white">While using the app</strong>, then on the next
              screen pick <strong className="text-white">Allow all the time</strong>.
            </span>
          </li>
        </ul>
        <div className="flex flex-col gap-2">
          <button
            className="h-12 rounded-2xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}
            onClick={async () => { await enable(); setDismissed(true); }}
          >
            Turn on arrival reminders
          </button>
          <button className="h-11 rounded-2xl font-semibold text-white/60" onClick={later}>Not now</button>
        </div>
      </div>
    </div>
  );
}

/** In-app banner while arrival errands exist but reminders can't fire. */
export function ArrivalBanner() {
  const { supported, status, activeCount, ready, enable } = useArrivalPermission();
  if (!supported || !status || ready || activeCount === 0) return null;
  return (
    <div className="mb-4 p-4 rounded-2xl border border-amber-300/60 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 flex flex-wrap items-center gap-3">
      <MapPin size={18} className="text-amber-600 dark:text-amber-300 shrink-0" />
      <p className="flex-1 min-w-[12rem] text-sm text-amber-900 dark:text-amber-100">
        <strong>Arrival reminders are off.</strong> Allow location “All the time” so your list pops up at the store.
      </p>
      <button className="btn-gold text-sm py-2" onClick={enable}>Turn on</button>
    </div>
  );
}
