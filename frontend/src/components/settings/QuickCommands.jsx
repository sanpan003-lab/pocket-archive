import { useCallback, useEffect, useState } from 'react';
import { Zap, CheckCircle2, AlertTriangle } from 'lucide-react';
import { isNative } from '../../lib/platform';
import { QuickRecorder } from '../../native/quickRecorder';

function Switch({ checked, onChange, title, hint }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="w-full flex items-center gap-3 py-2.5 text-left">
      <span className="flex-1">
        <span className="block text-sm font-semibold text-navy-900 dark:text-white">{title}</span>
        <span className="block text-xs text-navy-500 dark:text-white/50">{hint}</span>
      </span>
      <span className={`w-10 h-6 rounded-full p-0.5 transition-colors ${checked ? 'bg-gold-500' : 'bg-navy-200 dark:bg-white/20'}`}>
        <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

const OUT = { set: 'Set', failed: 'Could not set', 'server ran it first': 'Server did it first', 'not a command': 'Not a command', 'nothing recognized': 'Nothing recognized' };
const stamp = ms => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

/**
 * Settings › Alarms & phone actions (Android app): timers, alarms and "remind me in…" are understood on the
 * phone itself — no server, works offline — and the confirmation can be spoken.
 */
export default function QuickCommands() {
  const [s, setS] = useState(null);
  const load = useCallback(() => { QuickRecorder.getQuickCommandSettings().then(setS).catch(() => setS(null)); }, []);
  useEffect(() => { if (isNative) load(); }, [load]);
  if (!isNative) return null;

  const save = async patch => setS(await QuickRecorder.setQuickCommandSettings(patch).catch(() => s));

  return (
    <div id="quick-commands" className="glass-panel p-5 sm:p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Zap size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Quick commands on this phone</h2>
      </div>
      <p className="text-sm text-navy-600 dark:text-white/60 mb-2">
        “Timer 10 minutes”, “set an alarm for 6:30”, “wake me at 5” and “remind me in 20 minutes” are set right away on the phone,
        without waiting for the server — also offline, and for what you say into the watch. The recording is still saved as a note.
      </p>
      {!s ? <div className="h-12 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" /> : (
        <>
          <Switch checked={s.enabled} onChange={on => save({ enabled: on })} title="Set timers and alarms on this phone" hint="Uses Android’s on-device speech recognition" />
          <Switch checked={s.speak} onChange={on => save({ speak: on })} title="Say it out loud" hint="Speaks “Timer, 10 min” after it is set (a buzz and a message always show)" />
          <div className="flex items-start gap-2.5 py-2">
            {s.recognizer ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" /> : <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />}
            <span className="text-xs text-navy-600 dark:text-white/60">
              {s.recognizer ? 'On-device speech recognition is available.' : 'No on-device speech recognition found (needs Android 13+ and the Google app). The server understands commands as before.'}
            </span>
          </div>
          {!s.overlay && (
            <p className="text-xs text-navy-500 dark:text-white/50 pb-2">
              Without “Display over other apps” (above), Android won’t let a background timer open the Clock app: Pocket Archive rings its own alarm at the end instead.
            </p>
          )}
          <details data-quick-command-log="">
            <summary className="cursor-pointer select-none text-sm font-semibold text-navy-600 dark:text-white/70 min-h-[44px] flex items-center">Recent quick commands ({(s.log || []).length})</summary>
            {(s.log || []).length === 0 ? <p className="text-xs text-navy-500 dark:text-white/50">Nothing yet.</p> : (
              <ul className="rounded-xl bg-navy-50/50 dark:bg-white/5 px-3 divide-y divide-navy-100 dark:divide-white/10 max-h-64 overflow-y-auto">
                {s.log.map((e, i) => (
                  <li key={i} className="py-2 text-xs text-navy-700 dark:text-white/70">
                    <span className="font-semibold text-navy-900 dark:text-white">{OUT[e.out] || e.out}</span>
                    {e.kind ? ` · ${e.kind}` : ''}{e.ms != null ? ` · ${(e.ms / 1000).toFixed(1)} s` : ''} · {e.src}
                    <span className="block text-navy-400 dark:text-white/40">{stamp(e.t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      )}
    </div>
  );
}
