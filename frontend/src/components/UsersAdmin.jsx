import { useCallback, useEffect, useState } from 'react';
import { Users, UserPlus, KeyRound, ShieldOff, Lock, Unlock, Download, Trash2, RefreshCw, Ban, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import AppUpdatesAdmin from './AppUpdatesAdmin';
import { appVersionLine } from '../lib/appUpdate';
import {
  adminUsers, adminCreateUser, adminUpdateUser, adminResetPassword, adminReset2fa, adminUnlock, adminExportUser, adminDeleteUser,
} from '../lib/api';

const INPUT = 'w-full bg-navy-50/50 dark:bg-white/5 border border-navy-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-gold-400/50';
const errMsg = (err, fb) => err.response?.data?.error || fb;
const day = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'never');

/** A readable temporary password, e.g. "maple-river-4821" */
function tempPassword() {
  const words = ['maple', 'river', 'cedar', 'stone', 'cloud', 'amber', 'harbor', 'meadow', 'willow', 'ember', 'falcon', 'coral'];
  const r = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  return `${words[r(words.length)]}-${words[r(words.length)]}-${1000 + r(9000)}`;
}

function Avatar({ u }) {
  return <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: u.color || '#8B5CF6' }}>{u.initials || '?'}</span>;
}

function CreateUser({ onCreated }) {
  const [f, setF] = useState(() => ({ username: '', displayName: '', plan: 'lite', password: tempPassword() }));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const u = await adminCreateUser(f);
      setMsg({ ok: `Created ${u.displayName}. Temporary password: ${f.password} — they’ll choose their own at first sign-in.` });
      setF({ username: '', displayName: '', plan: 'lite', password: tempPassword() });
      onCreated();
    } catch (err) { setMsg({ error: errMsg(err, 'Could not create the user') }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="rounded-xl bg-navy-50/60 dark:bg-white/5 p-3 space-y-2" aria-label="Create user">
      <p className="text-sm font-semibold text-navy-900 dark:text-white flex items-center gap-1.5"><UserPlus size={14} /> New user</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <input className={INPUT} placeholder="Username (sign-in name)" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} autoCapitalize="none" aria-label="Username" required />
        <input className={INPUT} placeholder="Display name" value={f.displayName} onChange={e => setF({ ...f, displayName: e.target.value })} aria-label="Display name" />
      </div>
      <div className="flex flex-wrap gap-2 items-center" role="radiogroup" aria-label="Plan">
        {[['lite', 'Lite', 'note-taking, lists, sharing'], ['full', 'Full', 'everything except your archive']].map(([v, l, h]) => (
          <button key={v} type="button" role="radio" aria-checked={f.plan === v} onClick={() => setF({ ...f, plan: v })}
            className={`text-left rounded-xl border px-3 py-2 ${f.plan === v ? 'border-gold-500 bg-gold-500/10' : 'border-navy-200 dark:border-white/15'}`}>
            <span className="block text-sm font-semibold text-navy-900 dark:text-white">{l}</span>
            <span className="block text-[11px] text-navy-500 dark:text-white/50">{h}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <input className={INPUT} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} aria-label="Temporary password" />
        <button type="button" className="btn-ghost text-xs shrink-0" onClick={() => setF({ ...f, password: tempPassword() })}><RefreshCw size={12} /> New</button>
      </div>
      <button className="btn-gold text-sm" disabled={busy || !f.username.trim() || f.password.length < 8}>{busy ? 'Creating…' : 'Create user'}</button>
      {msg && <p className={`text-xs ${msg.error ? 'text-red-500' : 'text-emerald-700 dark:text-emerald-400'}`} role="status">{msg.error || msg.ok}</p>}
    </form>
  );
}

function UserRow({ u, me, onChanged }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const run = async (key, fn, ok) => {
    setBusy(key); setMsg(null);
    try { const r = await fn(); setMsg({ ok: typeof ok === 'function' ? ok(r) : ok }); onChanged(); } catch (err) { setMsg({ error: errMsg(err, 'Failed') }); } finally { setBusy(null); }
  };
  const self = u.id === me.id;
  return (
    <li className="rounded-xl bg-navy-50/50 dark:bg-white/5 px-3 py-2.5">
      <button type="button" className="w-full flex items-center gap-3 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Avatar u={u} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-navy-900 dark:text-white truncate">
            {u.displayName} <span className="font-normal text-navy-500 dark:text-white/50">@{u.username}</span>
          </span>
          <span className="block text-xs text-navy-500 dark:text-white/50">
            {u.role === 'admin' ? 'Admin' : u.plan === 'lite' ? 'Lite' : 'Full'}
            {u.twoFactor ? ' · 2FA on' : ''}{u.disabled ? ' · disabled' : ''}{u.locked ? ' · locked' : ''}
            {' · '}{u.usage?.today?.captures ?? 0} captures today, {u.usage?.last30?.captures ?? 0} in 30 days
          </span>
        </span>
        {u.disabled ? <Ban size={14} className="text-red-500" /> : <CheckCircle2 size={14} className="text-emerald-500" />}
      </button>
      {open && (
        <div className="mt-2.5 pl-12 space-y-2">
          <p className="text-xs text-navy-500 dark:text-white/50">Created {day(u.createdAt)} · last sign-in {day(u.lastLoginAt)} · {u.devices} device(s) · AI summaries 30 days: {u.usage?.last30?.summaries ?? 0}</p>
          {(u.deviceList || []).length > 0 && (
            <ul className="text-xs text-navy-600 dark:text-white/60 space-y-0.5">
              {u.deviceList.map(d => <li key={d.id}>📱 {d.name}{appVersionLine(d) ? ` — ${appVersionLine(d)}` : ' — version not reported yet'}</li>)}
            </ul>
          )}
          {!self && (
            <div className="flex flex-wrap gap-1.5">
              {['lite', 'full'].map(p => (
                <button key={p} type="button" className={`text-xs px-2.5 py-1 rounded-full border ${u.plan === p ? 'bg-gold-500 text-white border-gold-500' : 'border-navy-200 dark:border-white/20'}`}
                  onClick={() => run('plan', () => adminUpdateUser(u.id, { plan: p }), `Plan: ${p === 'lite' ? 'Lite' : 'Full'}`)}>{p === 'lite' ? 'Lite' : 'Full'}</button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-navy-600 dark:text-white/60">
            Daily capture limit
            <select className="bg-navy-50/50 dark:bg-white/5 border border-navy-200 dark:border-white/10 rounded-lg px-2 py-1 text-xs" value={u.dailyCap || ''}
              onChange={e => run('cap', () => adminUpdateUser(u.id, { dailyCap: e.target.value ? Number(e.target.value) : null }), 'Limit saved')}>
              <option value="">Off</option>
              {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n} per day</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn-white text-xs" disabled={!!busy} onClick={() => {
              const pw = tempPassword();
              run('pw', () => adminResetPassword(u.id, pw), `New temporary password: ${pw}${self ? '' : ' — they were signed out everywhere'}`);
            }}><KeyRound size={12} /> Reset password</button>
            {u.twoFactor && <button type="button" className="btn-white text-xs" disabled={!!busy} onClick={() => run('2fa', () => adminReset2fa(u.id), 'Two-step verification turned off')}><ShieldOff size={12} /> Reset 2FA</button>}
            {u.locked && <button type="button" className="btn-white text-xs" disabled={!!busy} onClick={() => run('unlock', () => adminUnlock(u.id), 'Unlocked')}><Unlock size={12} /> Unlock</button>}
            {!self && <button type="button" className="btn-white text-xs" disabled={!!busy} onClick={() => run('dis', () => adminUpdateUser(u.id, { disabled: !u.disabled }), u.disabled ? 'Enabled' : 'Disabled and signed out')}>{u.disabled ? <Unlock size={12} /> : <Lock size={12} />} {u.disabled ? 'Enable' : 'Disable'}</button>}
            <button type="button" className="btn-white text-xs" disabled={!!busy} onClick={() => run('export', () => adminExportUser(u.id), r => `Exported ${r.files} files to ARCHIVE/${r.file}`)}><Download size={12} /> Export data</button>
            {!self && <button type="button" className="btn-white text-xs text-red-600 dark:text-red-400" disabled={!!busy} onClick={() => {
              const typed = window.prompt(`Delete ${u.displayName}? Their notes and lists are exported to a zip in ARCHIVE/_exports first, then removed.\n\nType the username "${u.username}" to confirm:`);
              if (typed) run('del', () => adminDeleteUser(u.id, typed), r => `Deleted. Export: ARCHIVE/${r.export?.file}`);
            }}><Trash2 size={12} /> Delete</button>}
          </div>
          {msg && <p className={`text-xs ${msg.error ? 'text-red-500' : 'text-emerald-700 dark:text-emerald-400'} break-words`} role="status">{msg.error || msg.ok}</p>}
        </div>
      )}
    </li>
  );
}

/** Settings → Users (admin only). The admin never sees other users' notes here. */
export default function UsersAdmin() {
  const { user, isAdmin } = useApp();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { adminUsers().then(setList).catch(err => setError(errMsg(err, 'Could not load users'))); }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);
  if (!isAdmin) return null;
  return (
    <div id="users" className="glass-panel p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Users size={18} className="text-gold-500" />
        <h2 className="flex-1 font-bold text-navy-900 dark:text-white">Users</h2>
        <button type="button" className="btn-ghost text-xs py-1" onClick={load}><RefreshCw size={12} /> Refresh</button>
      </div>
      <p className="text-sm text-navy-600 dark:text-white/60 mb-3">Everyone has their own private notes, lists and places. You can manage accounts here, not read their notes.</p>
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      {!list ? <div className="h-14 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" /> : (
        <ul className="space-y-2 mb-3">{list.map(u => <UserRow key={u.id} u={u} me={user} onChanged={load} />)}</ul>
      )}
      <CreateUser onCreated={load} />
      <AppUpdatesAdmin />
    </div>
  );
}
