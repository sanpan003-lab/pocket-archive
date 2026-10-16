import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, Sparkles, X } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { CHANGELOG, WEB_VERSION, entryFor } from '../lib/changelog';
import { isNative } from '../lib/platform';

/** "*and*" → <em>and</em> (the changelog uses simple emphasis only) */
function Rich({ text }) {
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((p, i) => (p.startsWith('*') && p.endsWith('*') && p.length > 2
    ? <em key={i}>{p.slice(1, -1)}</em>
    : <Fragment key={i}>{p}</Fragment>));
}

export function ReleaseNotes({ entry }) {
  return (
    <div className="space-y-2.5">
      {entry.groups.map((g, i) => (
        <div key={i}>
          {g.title && <p className="text-xs font-bold uppercase tracking-wider text-gold-600 dark:text-gold-400 mb-1">{g.title}</p>}
          <ul className="list-disc pl-5 space-y-1 text-sm text-navy-700 dark:text-white/80">
            {g.items.map((it, j) => <li key={j}><Rich text={it} /></li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** App (Android) version + build, or null in the browser */
function useAppVersion() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!isNative) return;
    CapApp.getInfo().then(i => setInfo({ version: i.version, build: i.build })).catch(() => {});
  }, []);
  return info;
}

/** Settings → About: versions + What's new (newest open, older collapsible) */
export function AboutSection() {
  const app = useAppVersion();
  return (
    <div id="about" className="glass-panel p-5 sm:p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">About</h2>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm mb-4">
        {isNative && (
          <>
            <dt className="text-navy-500 dark:text-white/50">Android app</dt>
            <dd className="font-semibold text-navy-900 dark:text-white">{app ? `${app.version} (build ${app.build})` : '…'}</dd>
          </>
        )}
        <dt className="text-navy-500 dark:text-white/50">{isNative ? 'Screens (web)' : 'Web app'}</dt>
        <dd className="font-semibold text-navy-900 dark:text-white">{WEB_VERSION}</dd>
      </dl>

      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mb-2">What’s new</h3>
      <div className="space-y-2">
        {CHANGELOG.map((e, i) => (
          <details key={e.version} open={i === 0} className="group rounded-2xl border border-navy-100 dark:border-white/10 px-3 py-2">
            <summary className="flex items-center gap-2 cursor-pointer list-none">
              <span className="font-semibold text-navy-900 dark:text-white">{e.version}</span>
              <span className="text-xs text-navy-500 dark:text-white/50">{e.date}{e.note ? ` · ${e.note}` : ''}</span>
              {i === 0 && <span className="badge badge-gold !text-[10px]">Latest</span>}
              <ChevronDown size={15} className="ml-auto text-navy-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="pt-2 pb-1"><ReleaseNotes entry={e} /></div>
          </details>
        ))}
      </div>
    </div>
  );
}

const SEEN_KEY = 'pa_seenVersion';
const read = () => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const write = v => { try { localStorage.setItem(SEEN_KEY, v); } catch { /* private mode */ } };

/**
 * Android app: once after an update, "What's new in X.Y.Z". Not on a fresh
 * install (nothing to compare with) and never in the browser.
 */
export function WhatsNewSheet() {
  const app = useAppVersion();
  // Decided once, when the app version is known (React's "adjust state while rendering")
  const [entry, setEntry] = useState(undefined);
  if (app && entry === undefined) {
    const seen = read();
    let wasUsed = false;
    try { wasUsed = localStorage.getItem('pa_wasAuthed') === '1'; } catch { /* ignore */ }
    const e = seen === app.version ? null : entryFor(app.version);
    // Updated: an older version was seen, or the app was used before this feature existed
    setEntry(e && (seen || wasUsed) ? e : null);
  }
  useEffect(() => { if (app) write(app.version); }, [app]);

  if (!entry) return null;
  return (
    <div className="fixed inset-0 z-[230] flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="whatsnew-title">
      <div className="absolute inset-0 note-scrim-blur note-anim-fade" onClick={() => setEntry(null)} aria-hidden="true" />
      <div className="relative note-surface w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl note-anim-up pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start gap-2 mb-3">
          <Sparkles size={22} className="text-gold-500 mt-0.5" />
          <div className="flex-1">
            <h2 id="whatsnew-title" className="text-lg font-bold text-navy-900 dark:text-white">What’s new in {entry.version}</h2>
            <p className="text-xs text-navy-500 dark:text-white/50">{entry.date}</p>
          </div>
          <button className="w-9 h-9 rounded-xl flex items-center justify-center text-navy-500 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setEntry(null)} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <ReleaseNotes entry={entry} />
        <button className="btn-gold w-full justify-center mt-5" onClick={() => setEntry(null)}>Got it</button>
      </div>
    </div>
  );
}
