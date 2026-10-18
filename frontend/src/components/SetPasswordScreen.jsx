import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { changePassword } from '../lib/api';

const INPUT = 'w-full bg-white/50 dark:bg-white/10 border border-navy-200 dark:border-white/20 rounded-xl px-4 py-3 text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/40 outline-none focus:ring-2 focus:ring-gold-400/50 text-sm';

/** Signed in with a temporary password (e.g. the app was reopened mid sign-in): set your own first. */
export default function SetPasswordScreen() {
  const { user, refreshUser, logout } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError('Password must be at least 8 characters');
    if (next !== confirm) return setError('Passwords do not match');
    setSaving(true);
    try {
      await changePassword(current, next);
      await refreshUser();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not change the password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 dark:bg-none dark:bg-black">
      <form onSubmit={submit} className="glass-panel p-8 w-full max-w-md space-y-3" aria-label="Set your password">
        <div className="flex items-center gap-2">
          <KeyRound size={18} className="text-gold-500" />
          <h1 className="font-bold text-lg text-navy-900 dark:text-white">Set your password</h1>
        </div>
        <p className="text-sm text-navy-600 dark:text-white/60">
          Hi {user?.displayName || user?.username}! You’re using a temporary password. Choose your own to continue.
        </p>
        <input type="password" className={INPUT} placeholder="Temporary password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required aria-label="Temporary password" />
        <input type="password" className={INPUT} placeholder="New password (min 8 characters)" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" required aria-label="New password" />
        <input type="password" className={INPUT} placeholder="Confirm new password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required aria-label="Confirm new password" />
        {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
        <button type="submit" className="btn-gold w-full justify-center py-3" disabled={saving || !current || !next}>{saving ? 'Saving…' : 'Save password'}</button>
        <button type="button" className="btn-ghost w-full justify-center text-xs" onClick={logout}>Sign out</button>
      </form>
    </div>
  );
}
