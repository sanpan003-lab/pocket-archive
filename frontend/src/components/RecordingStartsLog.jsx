import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, RefreshCw, Trash2, Watch, Smartphone, ChevronDown } from 'lucide-react';
import { QuickRecorder } from '../native/quickRecorder';

const SCREEN = { off: 'Screen off', locked: 'Locked', on: 'Unlocked' };
const RESULT = {
  saved: ['Saved', 'badge-green'], recorded: ['Recorded', 'badge-green'], recording: ['Recording…', 'badge-gold'], starting: ['Starting…', 'badge-gold'],
  ignored: ['Ignored', 'badge-slate'], discarded: ['Discarded', 'badge-slate'], cancelled: ['Cancelled', 'badge-slate'], failed: ['Failed', 'badge-orange'],
};

const when = ms => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Which trigger made the notes that were saved — "Side key / Quick Record: 5 of 7" */
function summary(entries) {
  const saved = entries.filter(e => ['saved', 'recorded'].includes(e.result));
  const ignored = entries.filter(e => e.result === 'ignored');
  const top = list => {
    const counts = {};
    for (const e of list) counts[e.trigger || 'Other'] = (counts[e.trigger || 'Other'] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  };
  const parts = [];
  const s = top(saved);
  if (s) parts.push(`Most saved recordings came from ${s[0]} (${s[1]} of ${saved.length}).`);
  const i = top(ignored);
  if (i) parts.push(`Most ignored starts: ${i[0]} (${i[1]} of ${ignored.length}).`);
  return parts.join(' ');
}

function Entry({ e }) {
  const [open, setOpen] = useState(false);
  const [label, cls] = RESULT[e.result] || [e.result, 'badge-slate'];
  const Device = e.device === 'watch' ? Watch : Smartphone;
  return (
    <li className="rounded-xl border border-navy-100 dark:border-white/10 px-3 py-2">
      <button type="button" className="w-full flex items-start gap-2 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Device size={14} className="shrink-0 mt-0.5 text-navy-400 dark:text-white/45" />
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-navy-900 dark:text-white">{e.trigger || 'Other'}</span>
            <span className={`badge ${cls} !text-[10px]`}>{label}</span>
          </span>
          <span className="block text-[11px] text-navy-500 dark:text-white/50">
            {[when(e.at), SCREEN[e.screen] && `${SCREEN[e.screen]}${e.justWoken ? ' (just woken)' : ''}`,
              e.near != null && (e.near ? 'Proximity: covered' : 'Proximity: clear')].filter(Boolean).join(' · ')}
          </span>
          {e.reason && <span className="block text-xs text-navy-700 dark:text-white/70">{e.reason}</span>}
          {e.title && e.noteId && <Link to={`/quick/${e.noteId}`} className="block text-xs font-medium text-gold-700 dark:text-gold-300 truncate" onClick={ev => ev.stopPropagation()}>→ {e.title}</Link>}
        </span>
        <ChevronDown size={14} className={`shrink-0 mt-1 text-navy-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <dl className="mt-1.5 ml-6 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-navy-600 dark:text-white/60">
          {e.speech && <><dt>Heard</dt><dd>{e.speech}</dd></>}
          {e.lengthSec != null && <><dt>Length</dt><dd>{Number(e.lengthSec).toFixed(1)} s</dd></>}
          {e.proximity != null && <><dt>Proximity</dt><dd>{Number(e.proximity).toFixed(1)} cm</dd></>}
          {e.confirmed && <><dt>Confirmed</dt><dd>Yes (pressed again)</dd></>}
          {e.detection && <><dt>Detection</dt><dd>{e.detection === 'voice' ? 'Voice (pitch + syllables)' : 'Volume only (older method)'}</dd></>}
          {e.referrer && <><dt>Opened by</dt><dd className="break-all">{e.referrer}</dd></>}
          <dt>Source</dt><dd>{e.source}</dd>
        </dl>
      )}
    </li>
  );
}

/** Settings → Accidental recordings: the last 20 recording starts, to see what's misfiring */
export default function RecordingStartsLog() {
  const [entries, setEntries] = useState(null);
  const [all, setAll] = useState(false);
  const load = useCallback(() => {
    QuickRecorder.getRecordingLog({ limit: 20 }).then(r => setEntries(r.entries || [])).catch(() => setEntries([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!entries) return <div className="h-16 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse mt-3" />;
  const shown = all ? entries : entries.slice(0, 5);
  const text = summary(entries);
  return (
    <div className="mt-4" id="recording-log">
      <div className="flex items-center gap-2 mb-1">
        <History size={14} className="text-gold-500" />
        <h4 className="flex-1 text-sm font-semibold text-navy-900 dark:text-white">Recent recording starts</h4>
        <button type="button" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" onClick={load} aria-label="Refresh"><RefreshCw size={14} /></button>
        {entries.length > 0 && (
          <button type="button" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" onClick={() => window.confirm('Clear the list of recording starts?') && QuickRecorder.clearRecordingLog().then(load)} aria-label="Clear the list"><Trash2 size={14} /></button>
        )}
      </div>
      <p className="text-xs text-navy-500 dark:text-white/50 mb-2">
        What started each recording (phone and watch), how the screen was, the proximity sensor, what was heard, and what happened. Kept on this phone only.
      </p>
      {text && <p className="text-xs rounded-xl bg-gold-500/10 text-navy-800 dark:text-white/85 px-3 py-2 mb-2">{text}</p>}
      {entries.length === 0
        ? <p className="text-xs text-navy-400 dark:text-white/40">Nothing yet — starts are listed from now on.</p>
        : <ul className="space-y-1.5">{shown.map(e => <Entry key={e.id} e={e} />)}</ul>}
      {entries.length > 5 && (
        <button type="button" className="btn-ghost text-xs mt-1.5" onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${entries.length}`}</button>
      )}
    </div>
  );
}
