import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic2, Eye, EyeOff, Lock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { changePassword } from '../lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useApp();

  const [password, setPassword]         = useState('');
  const [showPw, setShowPw]             = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  // Change-password step (mustChangePassword flow)
  const [mustChange, setMustChange]     = useState(false);
  const [newPw, setNewPw]               = useState('');
  const [confirmPw, setConfirmPw]       = useState('');
  const [changingPw, setChangingPw]     = useState(false);
  const [changeError, setChangeError]   = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(password);
      if (result.mustChangePassword) {
        setMustChange(true);
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid password');
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setChangeError('');
    if (newPw.length < 8) {
      setChangeError('Password must be at least 8 characters');
      return;
    }
    if (newPw !== confirmPw) {
      setChangeError('Passwords do not match');
      return;
    }
    setChangingPw(true);
    try {
      await changePassword(password, newPw);
      navigate('/', { replace: true });
    } catch (err) {
      setChangeError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setChangingPw(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 dark:bg-black flex items-center justify-center p-4">
      <div className="backdrop-blur-xl bg-white/40 dark:bg-white/5 border border-white/60 dark:border-white/10 rounded-3xl p-10 shadow-2xl w-full max-w-md">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gold-gradient flex items-center justify-center shadow-gold mb-4">
            <Mic2 size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white tracking-tight">Pocket Archive</h1>
          <p className="text-sm text-navy-500 dark:text-white/50 mt-1">Your personal voice archive</p>
        </div>

        {/* ── Login form ── */}
        {!mustChange && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400 dark:text-white/40 pointer-events-none" />
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="Enter password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
                required
                className="w-full bg-white/50 dark:bg-white/10 border border-white/40 dark:border-white/20 rounded-xl pl-10 pr-11 py-3 text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/40 outline-none focus:ring-2 focus:ring-gold-400/50 text-sm"
              />
              <button
                type="button"
                tabIndex={-1}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-navy-400 dark:text-white/40 hover:text-navy-600 dark:hover:text-white/60 transition-colors"
                onClick={() => setShowPw(v => !v)}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {error && (
              <p className="text-sm text-red-500 dark:text-red-400 text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="btn-gold w-full justify-center py-3 rounded-xl text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2 justify-center">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : 'Sign In'}
            </button>
          </form>
        )}

        {/* ── Must change password ── */}
        {mustChange && (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 px-4 py-3 mb-2">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Set a new password</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                You're using the default password. Please choose a new one before continuing.
              </p>
            </div>

            <input
              type="password"
              placeholder="New password (min 8 chars)"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              autoFocus
              required
              className="w-full bg-white/50 dark:bg-white/10 border border-white/40 dark:border-white/20 rounded-xl px-4 py-3 text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/40 outline-none focus:ring-2 focus:ring-gold-400/50 text-sm"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              required
              className="w-full bg-white/50 dark:bg-white/10 border border-white/40 dark:border-white/20 rounded-xl px-4 py-3 text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/40 outline-none focus:ring-2 focus:ring-gold-400/50 text-sm"
            />

            {changeError && (
              <p className="text-sm text-red-500 dark:text-red-400 text-center">{changeError}</p>
            )}

            <button
              type="submit"
              disabled={changingPw || !newPw || !confirmPw}
              className="btn-gold w-full justify-center py-3 rounded-xl text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {changingPw ? (
                <span className="flex items-center gap-2 justify-center">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Saving…
                </span>
              ) : 'Set Password & Continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
