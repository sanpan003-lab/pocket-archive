import { useNavigate } from 'react-router-dom';
import { useOfflineStatus } from '../../lib/offline/status';
import { describe } from '../../lib/offline/format';

const TONE = {
  offline: 'bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-400/50',
  warn: 'bg-orange-500/15 text-orange-800 dark:text-orange-200 border-orange-400/50',
  busy: 'bg-sky-500/10 text-sky-800 dark:text-sky-200 border-sky-400/40',
  ok: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border-emerald-400/40',
};

/** Header chip (Android app): "Offline · last synced 2 h ago" / "Syncing 12 changes…" / "Up to date" → Settings › Offline */
export default function OfflineChip({ compact = false }) {
  const st = useOfflineStatus();
  const navigate = useNavigate();
  if (!st.available) return null;
  const { tone, Icon, text } = describe(st);
  // Started on the screens bundled in the app (no connection then): back online → load the NAS's latest screens
  const reload = window.PA_BUNDLED && st.online && !st.pending;
  return (
    <button type="button" data-offline-chip={tone}
      onClick={() => (reload ? window.location.reload() : navigate('/settings/offline'))}
      className={`inline-flex items-center gap-1 rounded-full border px-2 ${compact ? 'h-6 text-[10px] max-w-[11rem]' : 'h-7 text-xs'} font-semibold ${TONE[tone]} min-w-0`}
      aria-label={reload ? 'Back online — tap to load the latest screens' : `${text}. Open offline settings`}>
      <Icon size={compact ? 11 : 13} className={`shrink-0 ${tone === 'busy' ? 'animate-spin [animation-duration:2s]' : ''}`} />
      <span className="truncate">{reload ? 'Back online · tap to refresh' : text}</span>
    </button>
  );
}
