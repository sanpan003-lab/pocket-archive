import { useCallback, useEffect, useState } from 'react';
import { Users, X, Trash2, LogOut, Check } from 'lucide-react';
import { getShareInfo, getSharePeople, shareItem, unshareItem } from '../../lib/api';
import { loadPeople } from '../../lib/sharing';
import { useApp } from '../../context/AppContext';
import { notifyQuickChanged } from '../../lib/uiBus';
import { PersonDot } from './SharedBadge';

const ROLES = [
  { key: 'edit', label: 'Can edit' },
  { key: 'view', label: 'Can view' },
];

function RoleSwitch({ value, onChange, disabled, name }) {
  return (
    <div className="inline-flex rounded-xl bg-black/[0.04] dark:bg-white/5 p-0.5 shrink-0" role="radiogroup" aria-label={`Access for ${name}`}>
      {ROLES.map(r => (
        <button
          key={r.key}
          type="button"
          role="radio"
          aria-checked={value === r.key}
          disabled={disabled}
          onClick={() => onChange(r.key)}
          className={`h-9 px-2.5 rounded-[10px] text-xs font-semibold whitespace-nowrap transition-colors ${value === r.key
            ? 'bg-white dark:bg-white/15 text-navy-900 dark:text-white shadow-sm'
            : 'text-navy-500 dark:text-white/55'}`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Share a note/list or a project with people on this server.
 * Owner: add people (Can edit / Can view), change access, remove. Recipient: who shared it + Leave.
 * kind: 'note' | 'project'
 */
export default function ShareSheet({ kind, id, title, onClose, onChanged, onLeft }) {
  const { user } = useApp();
  const [info, setInfo] = useState(null);
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([getShareInfo(kind, id), getSharePeople()])
      .then(([i, p]) => { setInfo(i); setPeople(p); })
      .catch(err => setError(err.response?.data?.error || 'Could not load sharing'));
  }, [kind, id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  async function run(key, fn) {
    setBusy(key);
    setError('');
    try {
      await fn();
      load();
      loadPeople(true);
      onChanged?.();
      notifyQuickChanged();
    } catch (err) {
      setError(err.response?.data?.error || 'That didn’t work');
    } finally {
      setBusy(null);
    }
  }

  const leave = () => run('leave', async () => {
    if (!window.confirm(`Leave “${title}”? You won’t see it any more unless ${info.owner?.name || 'the owner'} shares it again.`)) return;
    await unshareItem(kind, id, user.id);
    onLeft?.();
    onClose();
  });

  const withAccess = new Set((info?.people || []).map(p => p.id));
  const others = people.filter(p => !withAccess.has(p.id));
  const what = kind === 'project' ? 'project' : 'note';

  return (
    <div className="fixed inset-0 z-[230] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="share-sheet-title">
      <div className="glass-panel w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 rounded-b-none sm:rounded-b-2xl animate-slide-up pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 id="share-sheet-title" className="font-bold text-navy-900 dark:text-white flex items-center gap-2 min-w-0">
            <Users size={18} className="text-gold-500 shrink-0" /> <span className="truncate">Share “{title}”</span>
          </h2>
          <button className="w-10 h-10 -mt-2 -mr-2 rounded-xl flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10" onClick={onClose} aria-label="Close">
            <X size={18} className="text-navy-600 dark:text-white/60" />
          </button>
        </div>

        {!info && !error && <div className="h-24 animate-pulse rounded-xl bg-black/5 dark:bg-white/5 mt-3" />}

        {info && !info.isOwner && (
          <>
            <div className="flex items-center gap-3 mt-3 p-3 rounded-xl bg-black/[0.03] dark:bg-white/5">
              <PersonDot person={info.owner} size={36} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-navy-900 dark:text-white">Shared by {info.owner?.name}</p>
                <p className="text-xs text-navy-500 dark:text-white/50">
                  {info.people.find(p => p.id === user?.id)?.role === 'view'
                    ? 'You can view it.'
                    : 'You can add, check off and edit items and text.'}
                  {' '}Only {info.owner?.name} can delete it or change who it’s shared with.
                </p>
              </div>
            </div>
            <button className="btn-ghost w-full justify-center mt-4 text-red-600 dark:text-red-400" onClick={leave} disabled={!!busy}>
              <LogOut size={15} /> {busy === 'leave' ? 'Leaving…' : `Leave this ${what}`}
            </button>
          </>
        )}

        {info?.isOwner && (
          <>
            <p className="text-xs text-navy-500 dark:text-white/50 mb-3">
              People with <b>Can edit</b> can add, check off and edit items and text. Only you can delete, combine, move it or change sharing.
              {kind === 'project' ? ' Sharing a project shares its notes.' : ''}
            </p>

            {info.people.length > 0 && (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wider text-navy-400 dark:text-white/40 mb-1.5">Shared with</p>
                <ul className="space-y-1.5 mb-4">
                  {info.people.map(p => (
                    <li key={p.id} className="flex items-center gap-2.5 p-2 rounded-xl border border-navy-100 dark:border-white/10">
                      <PersonDot person={p} size={30} />
                      <span className="flex-1 min-w-0 text-sm font-semibold text-navy-900 dark:text-white truncate">{p.name}</span>
                      <RoleSwitch name={p.name} value={p.role} disabled={!!busy} onChange={role => run(`role-${p.id}`, () => shareItem(kind, id, p.id, role))} />
                      <button
                        className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-red-500 dark:text-red-400 hover:bg-red-500/10"
                        onClick={() => run(`rm-${p.id}`, () => unshareItem(kind, id, p.id))}
                        disabled={!!busy}
                        aria-label={`Remove ${p.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="text-[11px] font-bold uppercase tracking-wider text-navy-400 dark:text-white/40 mb-1.5">Add people</p>
            {others.length === 0 ? (
              <p className="text-sm text-navy-500 dark:text-white/50">
                {people.length === 0 ? 'Nobody else has an account on this server yet. The admin adds people in Settings → Users.' : `Everyone already has access.`}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {others.map(p => (
                  <li key={p.id} className="flex items-center gap-2.5 p-2 rounded-xl bg-black/[0.03] dark:bg-white/5">
                    <PersonDot person={p} size={30} />
                    <span className="flex-1 min-w-0 text-sm font-semibold text-navy-900 dark:text-white truncate">{p.name}</span>
                    {ROLES.map(r => (
                      <button
                        key={r.key}
                        className={`h-9 px-2.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 ${r.key === 'edit'
                          ? 'bg-gold-500 text-white'
                          : 'bg-white dark:bg-white/10 text-navy-800 dark:text-white border border-navy-200 dark:border-white/15'}`}
                        onClick={() => run(`add-${p.id}`, () => shareItem(kind, id, p.id, r.key))}
                        disabled={!!busy}
                        aria-label={`Share with ${p.name}: ${r.label}`}
                      >
                        {busy === `add-${p.id}` ? <Check size={14} /> : r.label}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-500 dark:text-red-400 mt-3">{error}</p>}
      </div>
    </div>
  );
}
