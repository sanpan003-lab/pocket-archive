import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Zap, Trash2, Undo2, Play, Smartphone, Users, FileText, Loader2 } from 'lucide-react';
import QuickTabs from '../components/quick/QuickTabs';
import QuickToast from '../components/quick/QuickToast';
import { getActions, deleteAction, reportActionResult } from '../lib/api';
import { ACTION_FILTERS, canRunActions, runPhoneAction, undoPhoneAction, findChoices } from '../lib/phoneActions';
import { timeAgo } from '../components/quick/quickMeta';
import { onQuickChanged } from '../lib/uiBus';
import { useLayout } from '../lib/layout';

const STATUS = {
  pending: 'Waiting to run on your phone',
  tap: 'Tap the notification on your phone to run it',
  needs_choice: 'Pick who or which one',
  needs_permission: 'Needs a permission on your phone',
  done: 'Done',
  failed: 'Didn’t work',
  undone: 'Undone',
};
const UNDOABLE = new Set(['alarm', 'timer', 'flashlight', 'dnd']);

/** Several contacts / apps: pick one */
function Chooser({ entry, onPick, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    findChoices(entry.action).then(setData).catch(err => setError(err.message || 'Couldn’t look that up'));
  }, [entry]);
  const isApp = entry.action.kind === 'openApp';
  return (
    <div className="fixed inset-0 z-[230] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose} role="dialog" aria-modal="true" aria-label={isApp ? 'Which app?' : 'Which contact?'}>
      <div className="glass-panel w-full sm:max-w-md max-h-[80vh] overflow-y-auto p-5 rounded-b-none sm:rounded-b-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-navy-900 dark:text-white mb-1">{isApp ? `Which “${entry.action.appName}”?` : `Which ${entry.action.to}?`}</h2>
        <p className="text-xs text-navy-500 dark:text-white/50 mb-3">{entry.title}</p>
        {!data && !error && <div className="h-24 rounded-xl bg-black/5 dark:bg-white/5 animate-pulse" />}
        {data?.permission === 'denied' && <p className="text-sm text-amber-700 dark:text-amber-300 mb-2">Contacts access is off — allow it in Android settings, or pick below if a number was said.</p>}
        {data && !data.choices?.length && <p className="text-sm text-navy-600 dark:text-white/60">{isApp ? 'No app with that name on this phone.' : 'No contact with that name.'}</p>}
        <ul className="space-y-1.5">
          {(data?.choices || []).map(c => (
            <li key={c.id}>
              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-navy-100 dark:border-white/10 text-left hover:bg-black/[0.03] dark:hover:bg-white/5" onClick={() => onPick(c)}>
                <Users size={16} className="text-gold-500 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-navy-900 dark:text-white truncate">{c.label}</span>
                  {c.sub && <span className="block text-xs text-navy-500 dark:text-white/50 truncate">{c.sub}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        <button className="btn-ghost w-full justify-center mt-3" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Quick Capture → Actions: what your voice commands did on the phone (alarms, timers, directions, messages,
 * calls, Do Not Disturb, flashlight, apps). Kept for 7 days by default. Runs/undoes on the phone; the web is read-only.
 */
export default function ActionsPage() {
  const { lite } = useLayout();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('');
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [choosing, setChoosing] = useState(null);
  const [toast, setToast] = useState(null);
  const focus = params.get('focus') || params.get('choose');

  const load = useCallback(() => getActions(filter || undefined).then(l => { setList(l); setError(''); }).catch(err => setError(err.message || 'Couldn’t load actions')), [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onQuickChanged(() => load()), [load]);

  // From a notification: "Who should I message? Tap to choose" → open the chooser
  const chooseId = params.get('choose');
  const chooser = choosing || (canRunActions && chooseId && list ? list.find(x => x.id === chooseId) || null : null);
  const closeChooser = () => { setChoosing(null); if (chooseId) setParams({}, { replace: true }); };
  useEffect(() => {
    if (focus && list) requestAnimationFrame(() => document.getElementById(`ac-${focus}`)?.scrollIntoView({ block: 'center' }));
  }, [focus, list]);

  const actionOf = e => ({ id: e.id, noteId: e.parentId, title: e.title, icon: e.icon, ...e.action });

  async function run(e, choice = null) {
    setBusy(e.id);
    try {
      const out = await runPhoneAction(actionOf(e), choice);
      if (out?.status === 'needs_choice') setChoosing(e);
      else if (out) setToast({ id: Date.now(), icon: out.icon || '⚡', text: out.text, detail: out.detail, tone: out.status === 'failed' ? 'review' : 'success' });
    } finally { setBusy(null); setTimeout(load, 800); }
  }
  async function undo(e) {
    setBusy(e.id);
    try {
      const out = await undoPhoneAction(actionOf(e));
      if (out) setToast({ id: Date.now(), icon: '↩️', text: out.text, detail: out.detail, tone: 'queued', duration: 8000 });
      await reportActionResult(e.id, { status: 'undone', result: out?.text || 'Undone' });
    } catch (err) { setToast({ id: Date.now(), icon: '⚠️', text: err.message || 'Couldn’t undo', tone: 'review' }); }
    finally { setBusy(null); load(); }
  }
  async function remove(e) {
    setBusy(e.id);
    try { await deleteAction(e.id); setList(l => l.filter(x => x.id !== e.id)); } finally { setBusy(null); }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-28">
      <QuickToast toast={toast} onDismiss={() => setToast(null)} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">{lite ? 'Actions' : 'Quick Capture'}</h1>
        <QuickTabs />
      </div>
      <p className="text-sm text-navy-500 dark:text-white/50 mb-3">
        Alarms, timers, directions, messages and other phone commands you said. They’re kept here, not in your Inbox.
        {!canRunActions && <> <Smartphone size={13} className="inline -mt-0.5" /> Open the Android app to run or undo them.</>}
      </p>

      <div className="overflow-x-auto -mx-1 px-1 mb-4">
        <div className="tab-bar w-max">
          {ACTION_FILTERS.map(f => (
            <button key={f.key} className={`tab-item shrink-0 ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
      {!list ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="quick-card h-16 animate-pulse" />)}</div>
      ) : list.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <Zap size={28} className="mx-auto mb-2 text-navy-200 dark:text-white/20" />
          <p className="text-sm text-navy-600 dark:text-white/50">No actions{filter ? ' here' : ''} yet. Try “wake me at 6:30” or “set a timer for 10 minutes”.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map(e => {
            const st = e.action?.status || 'pending';
            const canUndo = canRunActions && st === 'done' && UNDOABLE.has(e.action.kind) && !(e.action.kind === 'flashlight' && !e.action.on);
            return (
              <li key={e.id} id={`ac-${e.id}`} className={`quick-card px-4 py-3 ${focus === e.id ? 'quick-card-highlight' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className="text-xl leading-none mt-0.5" aria-hidden="true">{e.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-navy-900 dark:text-white break-words">{e.title}</p>
                    <p className={`text-xs mt-0.5 ${st === 'failed' ? 'text-red-500' : st === 'done' ? 'text-emerald-600 dark:text-emerald-400' : st === 'undone' ? 'text-navy-400 dark:text-white/40' : 'text-amber-700 dark:text-amber-300'}`}>
                      {e.action?.result && st !== 'pending' ? e.action.result : STATUS[st] || st}
                      {e.action?.detail ? ` · ${e.action.detail}` : ''}
                    </p>
                    <p className="text-xs text-navy-400 dark:text-white/40 mt-0.5">{timeAgo(e.capturedAt)}{e.transcript ? ` · “${e.transcript.slice(0, 80)}”` : ''}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 pl-8">
                  {canRunActions && ['pending', 'tap', 'failed', 'needs_permission'].includes(st) && (
                    <button className="btn-white text-xs py-1.5 px-3" onClick={() => run(e)} disabled={busy === e.id}>{busy === e.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run now</button>
                  )}
                  {canRunActions && st === 'needs_choice' && (
                    <button className="btn-gold text-xs py-1.5 px-3" onClick={() => setChoosing(e)}><Users size={13} /> Choose</button>
                  )}
                  {canUndo && <button className="btn-white text-xs py-1.5 px-3" onClick={() => undo(e)} disabled={busy === e.id}><Undo2 size={13} /> Undo</button>}
                  {e.parentId && <Link to={`/quick/${e.parentId}`} className="btn-ghost text-xs py-1.5 px-3"><FileText size={13} /> Open note</Link>}
                  <button className="btn-ghost text-xs py-1.5 px-3 ml-auto text-red-500 dark:text-red-400" onClick={() => remove(e)} disabled={busy === e.id} aria-label={`Delete ${e.title}`}><Trash2 size={13} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {chooser && <Chooser entry={chooser} onClose={closeChooser} onPick={c => { const e = chooser; closeChooser(); run(e, c); }} />}
    </div>
  );
}
