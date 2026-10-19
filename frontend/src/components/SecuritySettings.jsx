import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  ShieldCheck, KeyRound, Monitor, Smartphone, Watch, LogOut, RefreshCw, Copy, Check, AlertTriangle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { appVersionLine } from '../lib/appUpdate';
import {
  changePassword, setup2fa, confirm2fa, disable2fa, getSessions, revokeSession, revokeDevice, signOutEverywhere,
} from '../lib/api';

const INPUT = 'w-full bg-navy-50/50 dark:bg-white/5 border border-navy-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-gold-400/50';
const errMsg = (err, fb) => err.response?.data?.error || fb;
const when = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

function browserName(ua = '') {
  if (/wv\)|; wv/.test(ua)) return 'Android app (web view)';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}

export function PasswordBlock() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (next.length < 8) return setMsg({ error: 'Password must be at least 8 characters' });
    setBusy(true);
    try {
      await changePassword(cur, next);
      setCur(''); setNext('');
      setMsg({ ok: 'Password changed. Other browsers were signed out; this one and your phone stay signed in.' });
    } catch (err) {
      setMsg({ error: errMsg(err, 'Could not change the password') });
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/40 flex items-center gap-1.5"><KeyRound size={13} /> Password</h3>
      <input type="password" className={INPUT} placeholder="Current password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" aria-label="Current password" />
      <input type="password" className={INPUT} placeholder="New password (min 8 characters)" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" aria-label="New password" />
      <button className="btn-gold text-sm" disabled={busy || !cur || !next}>{busy ? 'Saving…' : 'Change password'}</button>
      {msg && <p className={`text-xs ${msg.error ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`} role="status">{msg.error || msg.ok}</p>}
    </form>
  );
}

export function TwoFactorBlock() {
  const { user, refreshUser } = useApp();
  const [setup, setSetup] = useState(null);  // { uri, secret, qr }
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);  // backup codes, shown once
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const on = !!user?.twoFactor;

  async function start() {
    setMsg(null); setBusy(true);
    try {
      const s = await setup2fa();
      const qr = await QRCode.toDataURL(s.uri, { margin: 1, width: 220 });
      setSetup({ ...s, qr });
    } catch (err) { setMsg({ error: errMsg(err, 'Could not start setup') }); } finally { setBusy(false); }
  }
  async function confirm(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await confirm2fa(code.trim());
      setCodes(r.backupCodes); setSetup(null); setCode('');
      await refreshUser();
    } catch (err) { setMsg({ error: errMsg(err, 'That code didn’t work') }); } finally { setBusy(false); }
  }
  async function turnOff(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try { await disable2fa(pw); setPw(''); await refreshUser(); setMsg({ ok: 'Two-step verification is off.' }); }
    catch (err) { setMsg({ error: errMsg(err, 'Could not turn it off') }); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/40 flex items-center gap-1.5"><ShieldCheck size={13} /> Two-step verification</h3>
      <p className="text-sm text-navy-600 dark:text-white/60">
        {on ? `On — sign-in asks for a code from your authenticator app. ${user.backupCodesLeft ?? 0} backup codes left.`
          : 'Off. Turn it on to also ask for a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 2FAS, Aegis…) when you sign in.'}
      </p>
      {codes && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-900/20 p-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1.5"><AlertTriangle size={14} /> Save these backup codes now</p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">Each works once if you lose your phone. They won’t be shown again.</p>
          <div className="grid grid-cols-2 gap-1 font-mono text-sm text-navy-900 dark:text-white">{codes.map(c => <span key={c}>{c}</span>)}</div>
          <button type="button" className="btn-white text-xs mt-2" onClick={() => { navigator.clipboard?.writeText(codes.join('\n')); setCopied(true); }}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy codes'}
          </button>
          <button type="button" className="btn-ghost text-xs mt-2" onClick={() => setCodes(null)}>I saved them</button>
        </div>
      )}
      {!on && !setup && !codes && <button type="button" className="btn-white text-sm" onClick={start} disabled={busy}>Turn on two-step verification</button>}
      {setup && (
        <form onSubmit={confirm} className="rounded-xl bg-navy-50/60 dark:bg-white/5 p-3 space-y-2">
          <p className="text-sm text-navy-700 dark:text-white/80">1. Scan this with your authenticator app:</p>
          <img src={setup.qr} alt="QR code for your authenticator app" className="w-44 h-44 rounded-lg bg-white p-1" />
          <p className="text-xs text-navy-500 dark:text-white/50 break-all">Or enter this key: <span className="font-mono text-navy-800 dark:text-white/85">{setup.secret.match(/.{1,4}/g).join(' ')}</span></p>
          <p className="text-sm text-navy-700 dark:text-white/80">2. Enter the 6-digit code it shows:</p>
          <input className={INPUT} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={e => setCode(e.target.value)} aria-label="Code from your authenticator app" />
          <div className="flex gap-2">
            <button className="btn-gold text-sm" disabled={busy || code.trim().length < 6}>{busy ? 'Checking…' : 'Turn on'}</button>
            <button type="button" className="btn-ghost text-sm" onClick={() => setSetup(null)}>Cancel</button>
          </div>
        </form>
      )}
      {on && !codes && (
        <form onSubmit={turnOff} className="flex flex-col sm:flex-row gap-2">
          <input type="password" className={INPUT} placeholder="Password to turn it off" value={pw} onChange={e => setPw(e.target.value)} aria-label="Password to turn off two-step verification" />
          <button className="btn-white text-sm shrink-0" disabled={busy || !pw}>Turn off</button>
        </form>
      )}
      {msg && <p className={`text-xs ${msg.error ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`} role="status">{msg.error || msg.ok}</p>}
    </div>
  );
}

function SessionsBlock() {
  const { logout } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { getSessions().then(setData).catch(err => setError(errMsg(err, 'Could not load sessions'))); }, []);
  useEffect(() => { load(); }, [load]);

  const items = data ? [
    ...data.sessions.map(s => ({ key: `s-${s.id}`, id: s.id, kind: 'session', icon: s.kind === 'app' ? Smartphone : Monitor, title: browserName(s.userAgent), sub: `Signed in ${when(s.createdAt)} · last active ${when(s.lastSeenAt)}`, current: s.current })),
    ...data.devices.map(d => ({ key: `d-${d.id}`, id: d.id, kind: 'device', icon: /watch/i.test(d.name) ? Watch : Smartphone, title: d.name, sub: [`Signed in ${when(d.createdAt)} · last used ${when(d.lastUsedAt)}`, appVersionLine(d)].filter(Boolean).join(' · '), current: d.current })),
  ] : [];

  async function revoke(item) {
    try {
      if (item.kind === 'session') await revokeSession(item.id); else await revokeDevice(item.id);
      if (item.current) await logout(); else load();
    } catch (err) { setError(errMsg(err, 'Could not sign it out')); }
  }
  async function everywhere() {
    if (!window.confirm('Sign out on every browser, phone and watch — including this one?')) return;
    try { await signOutEverywhere(); } catch { /* signed out anyway */ }
    await logout();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/40">Where you’re signed in</h3>
        <button type="button" className="btn-ghost text-xs py-1" onClick={load}><RefreshCw size={12} /> Refresh</button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!data ? <div className="h-12 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" /> : (
        <ul className="space-y-1.5">
          {items.map(it => (
            <li key={it.key} className="flex items-center gap-3 rounded-xl bg-navy-50/50 dark:bg-white/5 px-3 py-2.5">
              <it.icon size={16} className="text-navy-500 dark:text-white/60 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-navy-900 dark:text-white truncate">{it.title}{it.current && <span className="ml-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">THIS DEVICE</span>}</span>
                <span className="block text-xs text-navy-500 dark:text-white/50">{it.sub}</span>
              </span>
              <button type="button" className="btn-ghost text-xs text-red-600 dark:text-red-400 shrink-0" onClick={() => revoke(it)}><LogOut size={13} /> Sign out</button>
            </li>
          ))}
          {!items.length && <li className="text-sm text-navy-500">No sessions.</li>}
        </ul>
      )}
      <button type="button" className="btn-white text-sm text-red-600 dark:text-red-400" onClick={everywhere}><LogOut size={14} /> Sign out everywhere</button>
    </div>
  );
}

/** Settings → Security: password, two-step verification, sessions & devices */
export default function SecuritySettings() {
  const { user } = useApp();
  return (
    <div id="security" className="glass-panel p-6 mb-4 scroll-mt-20 space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={18} className="text-gold-500" />
          <h2 className="font-bold text-navy-900 dark:text-white">Security</h2>
        </div>
        <p className="text-sm text-navy-600 dark:text-white/60">Signed in as <strong>{user?.displayName}</strong> ({user?.username}{user?.role === 'admin' ? ', admin' : ''}).</p>
      </div>
      <PasswordBlock />
      <TwoFactorBlock />
      <SessionsBlock />
    </div>
  );
}
