import { useState, useEffect } from 'react';
import {
  HardDrive, RefreshCw, Headphones, Sparkles,
  FileText, Info, Folder, CheckCircle2, XCircle, Lock,
} from 'lucide-react';
import { getStats, getHealth, changePassword } from '../lib/api';

function StatRow({ label, value, icon, accent }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-navy-50/50 dark:bg-white/5">
      <span className="text-sm text-navy-600 dark:text-white/60 flex items-center gap-2">
        {icon && <span style={{ color: accent }}>{icon}</span>}
        {label}
      </span>
      <span className="font-bold text-navy-900 dark:text-white">{value ?? '—'}</span>
    </div>
  );
}

function ChangePasswordSection() {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    if (newPw.length < 8) { setError('New password must be at least 8 characters'); return; }
    if (newPw !== confirmPw) { setError('New passwords do not match'); return; }
    setSaving(true);
    try {
      await changePassword(currentPw, newPw);
      setSuccess(true);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-navy-50/50 dark:bg-white/5 border border-navy-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-gold-400/50';

  return (
    <div className="glass-panel p-6 mb-4">
      <div className="flex items-center gap-2 mb-5">
        <Lock size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Change Password</h2>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input type="password" placeholder="Current password" value={currentPw}
          onChange={e => setCurrentPw(e.target.value)} required className={inputCls} />
        <input type="password" placeholder="New password (min 8 chars)" value={newPw}
          onChange={e => setNewPw(e.target.value)} required className={inputCls} />
        <input type="password" placeholder="Confirm new password" value={confirmPw}
          onChange={e => setConfirmPw(e.target.value)} required className={inputCls} />
        {error   && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
        {success && <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={14} /> Password changed successfully</p>}
        <button type="submit" disabled={saving || !currentPw || !newPw || !confirmPw}
          className="btn-gold disabled:opacity-60 disabled:cursor-not-allowed">
          {saving ? <><RefreshCw size={13} className="animate-spin" /> Saving…</> : 'Change Password'}
        </button>
      </form>
    </div>
  );
}

export default function SettingsPage() {
  const [stats, setStats]     = useState(null);
  const [health, setHealth]   = useState(null);
  const [loading, setLoading] = useState(true);

  function refresh() {
    setLoading(true);
    Promise.all([getStats(), getHealth()])
      .then(([s, h]) => { setStats(s); setHealth(h); })
      .catch(() => setHealth(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, []);

  const isConnected = health?.ok === true;

  return (
    <div className="p-6 max-w-2xl mx-auto animate-slide-up">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Settings</h1>
        <p className="text-sm text-navy-600 dark:text-white/60 mt-1">Archive configuration and backend status</p>
      </div>

      {/* ── Backend status ──────────────────────────────────────────────────── */}
      <div className="glass-card p-5 mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="w-2.5 h-2.5 rounded-full bg-navy-200 dark:bg-white/20 animate-pulse" />
          ) : isConnected ? (
            <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
          ) : (
            <XCircle size={18} className="text-red-400 shrink-0" />
          )}
          <div>
            <p className="font-semibold text-navy-900 dark:text-white text-sm">
              {loading ? 'Connecting…' : isConnected ? 'Backend connected' : 'Backend not reachable'}
            </p>
            <p className="text-xs text-navy-400 dark:text-white/40 mt-0.5">
              Express API on <code className="font-mono">http://localhost:3001</code>
            </p>
          </div>
        </div>
        <button className="btn-ghost shrink-0" onClick={refresh} title="Refresh status">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── Archive info ────────────────────────────────────────────────────── */}
      <div className="glass-panel p-6 mb-4">
        <div className="flex items-center gap-2 mb-5">
          <HardDrive size={18} className="text-gold-500" />
          <h2 className="font-bold text-navy-900 dark:text-white">Archive</h2>
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="h-10 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" />
            <div className="grid grid-cols-2 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-12 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" />)}
            </div>
          </div>
        ) : stats ? (
          <>
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-4 font-mono text-xs text-navy-600 dark:text-white/60 break-all bg-navy-50/60 dark:bg-white/5">
              <Folder size={13} className="text-navy-400 dark:text-white/40 shrink-0" />
              {stats.archivePath}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatRow label="Total recordings" value={stats.total}          icon={<Info size={13} />}       accent="#6366F1" />
              <StatRow label="With audio"        value={stats.withAudio}     icon={<Headphones size={13} />} accent="#F59E0B" />
              <StatRow label="AI Notes"          value={stats.withAiNotes}   icon={<Sparkles size={13} />}   accent="#8B5CF6" />
              <StatRow label="Transcripts"       value={stats.withTranscript} icon={<FileText size={13} />}  accent="#10B981" />
            </div>
          </>
        ) : (
          <p className="text-sm text-red-500">
            Could not load archive stats. Make sure the backend is running.
          </p>
        )}
      </div>

      <ChangePasswordSection />

      {/* ── Sync ────────────────────────────────────────────────────────────── */}
      <div className="glass-panel p-6">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw size={18} className="text-gold-500" />
          <h2 className="font-bold text-navy-900 dark:text-white">Syncing Recordings</h2>
        </div>
        <p className="text-sm text-navy-600 dark:text-white/60 mb-4 leading-relaxed">
          New recordings from Hey Pocket are imported by running the Python sync
          script. It downloads audio, transcripts, original notes, and generates
          AI-enhanced summaries via Claude.
        </p>
        <div
          className="rounded-xl px-5 py-4 mb-3 font-mono text-sm"
          style={{ background: '#0F172A', color: '#4ADE80' }}
        >
          <span style={{ color: '#475569' }}>$ </span>
          python pocket_sync.py
        </div>
        <div
          className="rounded-xl px-5 py-4 font-mono text-sm"
          style={{ background: '#0F172A', color: '#4ADE80' }}
        >
          <span style={{ color: '#475569' }}>$ </span>
          python pocket_sync.py --dry-run
          <span style={{ color: '#475569', marginLeft: 12 }}># preview without downloading</span>
        </div>
        <p className="text-xs text-navy-400 dark:text-white/40 mt-3">
          After syncing, refresh the Dashboard to see new recordings appear.
          The script lives in{' '}
          <code className="font-mono bg-navy-100 dark:bg-white/10 px-1.5 py-0.5 rounded text-navy-700 dark:text-white/70">
            PocketSync_Project/
          </code>
          {' '}inside the archive folder.
        </p>
      </div>
    </div>
  );
}
