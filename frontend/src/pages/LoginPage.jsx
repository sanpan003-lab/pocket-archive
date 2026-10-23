import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Mic2, Eye, EyeOff, Lock, User, ShieldCheck, Wrench, Fingerprint } from 'lucide-react';
import { passkeysSupported, passkeyError } from '../lib/passkeys';
import { useApp } from '../context/AppContext';
import { changePassword } from '../lib/api';
import { returnPath } from '../lib/returnPath';

const LAST_USER_KEY = 'pa_lastUsername';
const lastUsername = () => { try { return localStorage.getItem(LAST_USER_KEY) || ''; } catch { return ''; } };

const INPUT = 'w-full bg-white/50 dark:bg-white/10 border border-white/40 dark:border-white/20 rounded-xl py-3 text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/40 outline-none focus:ring-2 focus:ring-gold-400/50 text-sm';

function Spinner({ label }) {
  return (
    <span className="flex items-center gap-2 justify-center">
      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
      {label}
    </span>
  );
}

/**
 * Sign in: username + password → (2FA code if on) → ("Set your password" after a temporary one).
 * No public sign-up: the admin creates accounts (Settings → Users).
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loginWithPasskey, refreshUser, maintenance } = useApp();
  // e.g. back to /quick?autostart=1 when the installed app sent you here
  const nextPath = returnPath(location);

  const [username, setUsername]   = useState(lastUsername);
  const [password, setPassword]   = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [code, setCode]           = useState('');
  const [step, setStep]           = useState('credentials'); // credentials | code | newPassword
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  async function submitLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username.trim(), password, step === 'code' ? code.trim() : undefined);
      if (result.twoFactorRequired) {
        setStep('code');
        return;
      }
      try { localStorage.setItem(LAST_USER_KEY, username.trim()); } catch { /* ignore */ }
      if (result.mustChangePassword) setStep('newPassword');
      else navigate(nextPath, { replace: true });
    } catch (err) {
      const data = err.response?.data;
      setError(data?.error || (err.response ? 'Sign-in failed' : "Can't reach your Pocket Archive server"));
      if (data?.twoFactorRequired) setCode('');
    } finally {
      setLoading(false);
    }
  }

  /** Passkey: fingerprint / Windows Hello / phone — no password, no 2FA code */
  async function passkey() {
    setError('');
    setLoading(true);
    try {
      await loginWithPasskey();
      navigate(nextPath, { replace: true });
    } catch (err) {
      const msg = passkeyError(err, 'Sign-in with a passkey didn’t work — use your password');
      if (msg) setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function submitNewPassword(e) {
    e.preventDefault();
    setError('');
    if (newPw.length < 8) return setError('Password must be at least 8 characters');
    if (newPw !== confirmPw) return setError('Passwords do not match');
    setLoading(true);
    try {
      await changePassword(password, newPw);
      await refreshUser();
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 dark:bg-none dark:bg-black flex items-center justify-center p-4">
      <div className="backdrop-blur-xl bg-white/40 dark:bg-white/5 border border-white/60 dark:border-white/10 rounded-3xl p-8 sm:p-10 shadow-2xl w-full max-w-md">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-brand-gradient flex items-center justify-center shadow-brand mb-4">
            <Mic2 size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white tracking-tight">Pocket Archive</h1>
          <p className="text-sm text-navy-500 dark:text-white/50 mt-1">Sign in to your account</p>
        </div>

        {maintenance && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 px-4 py-3 mb-4 flex gap-2.5" role="status">
            <Wrench size={16} className="text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-200">{maintenance}</p>
          </div>
        )}

        {step === 'credentials' && (
          <form onSubmit={submitLogin} className="space-y-3" aria-label="Sign in">
            <div className="relative">
              <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400 dark:text-white/40 pointer-events-none" />
              <input
                type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)}
                autoFocus={!username} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required
                aria-label="Username" className={`${INPUT} pl-10 pr-4`}
              />
            </div>
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400 dark:text-white/40 pointer-events-none" />
              <input
                type={showPw ? 'text' : 'password'} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
                autoFocus={!!username} autoComplete="current-password" required aria-label="Password"
                className={`${INPUT} pl-10 pr-11`}
              />
              <button type="button" tabIndex={-1} aria-label={showPw ? 'Hide password' : 'Show password'}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-navy-400 dark:text-white/40 hover:text-navy-600 dark:hover:text-white/60 transition-colors"
                onClick={() => setShowPw(v => !v)}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {error && <p className="text-sm text-red-500 dark:text-red-400 text-center" role="alert">{error}</p>}
            <button type="submit" disabled={loading || !username.trim() || !password}
              className="btn-gold w-full justify-center py-3 rounded-xl text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? <Spinner label="Signing in…" /> : 'Sign In'}
            </button>
            {passkeysSupported() && (
              <>
                <div className="flex items-center gap-3 py-1" aria-hidden="true">
                  <span className="flex-1 h-px bg-navy-200 dark:bg-white/15" /><span className="text-xs text-navy-400 dark:text-white/40">or</span><span className="flex-1 h-px bg-navy-200 dark:bg-white/15" />
                </div>
                <button type="button" onClick={passkey} disabled={loading}
                  className="btn-white w-full justify-center py-3 rounded-xl text-sm font-semibold disabled:opacity-60">
                  <Fingerprint size={16} /> Sign in with a passkey
                </button>
              </>
            )}
            <p className="text-xs text-center text-navy-500 dark:text-white/45 pt-1">No account? Ask the person who runs this Pocket Archive.</p>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={submitLogin} className="space-y-3" aria-label="Two-step verification">
            <div className="rounded-xl bg-navy-50/70 dark:bg-white/5 px-4 py-3 flex gap-2.5">
              <ShieldCheck size={16} className="text-gold-600 dark:text-gold-400 shrink-0 mt-0.5" />
              <p className="text-xs text-navy-700 dark:text-white/75">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
            </div>
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code}
              onChange={e => setCode(e.target.value)} autoFocus required aria-label="Verification code"
              className={`${INPUT} px-4 text-center text-lg tracking-[0.3em]`}
            />
            {error && <p className="text-sm text-red-500 dark:text-red-400 text-center" role="alert">{error}</p>}
            <button type="submit" disabled={loading || code.trim().length < 6}
              className="btn-gold w-full justify-center py-3 rounded-xl text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? <Spinner label="Checking…" /> : 'Verify'}
            </button>
            <button type="button" className="btn-ghost w-full justify-center text-xs" onClick={() => { setStep('credentials'); setCode(''); setError(''); }}>Back</button>
          </form>
        )}

        {step === 'newPassword' && (
          <form onSubmit={submitNewPassword} className="space-y-3" aria-label="Set your password">
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 px-4 py-3 mb-1">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Set your password</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">You signed in with a temporary password. Choose your own to continue.</p>
            </div>
            <input type="password" placeholder="New password (min 8 characters)" value={newPw} onChange={e => setNewPw(e.target.value)}
              autoFocus required autoComplete="new-password" aria-label="New password" className={`${INPUT} px-4`} />
            <input type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              required autoComplete="new-password" aria-label="Confirm new password" className={`${INPUT} px-4`} />
            {error && <p className="text-sm text-red-500 dark:text-red-400 text-center" role="alert">{error}</p>}
            <button type="submit" disabled={loading || !newPw || !confirmPw}
              className="btn-gold w-full justify-center py-3 rounded-xl text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? <Spinner label="Saving…" /> : 'Set Password & Continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
