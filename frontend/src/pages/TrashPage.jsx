import { useState, useEffect } from 'react';
import { Trash2, RotateCcw, AlertCircle, Mic2 } from 'lucide-react';
import { getDeletedRecordings, restoreRecording, permanentDeleteRecording } from '../lib/api';

function ConfirmModal({ message, confirmLabel, confirmStyle, onConfirm, onCancel, busy, error }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
      <div className="glass-panel p-6 max-w-sm w-full animate-slide-up">
        <p className="font-semibold text-navy-900 dark:text-white mb-1">{message}</p>
        {error && <p className="text-sm text-red-500 mt-2 mb-2">{error}</p>}
        <div className="flex gap-2 justify-end mt-4">
          <button className="btn-ghost text-sm" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
            style={confirmStyle}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TrashPage() {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [restoring, setRestoring] = useState(null);
  const [confirm, setConfirm]     = useState(null); // { id, title }
  const [permDeleting, setPermDeleting] = useState(false);
  const [permDelError, setPermDelError] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getDeletedRecordings();
      setItems(data);
    } catch (err) {
      setError(err.message || 'Failed to load trash');
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(id) {
    setRestoring(id);
    try {
      await restoreRecording(id);
      setItems(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Restore failed');
    } finally {
      setRestoring(null);
    }
  }

  async function handlePermDelete() {
    if (!confirm) return;
    setPermDeleting(true);
    setPermDelError(null);
    try {
      await permanentDeleteRecording(confirm.id);
      setItems(prev => prev.filter(r => r.id !== confirm.id));
      setConfirm(null);
    } catch (err) {
      setPermDelError(err.response?.data?.error || err.message || 'Delete failed');
    } finally {
      setPermDeleting(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {confirm && (
        <ConfirmModal
          message={`Permanently delete "${confirm.title}"? This cannot be undone.`}
          confirmLabel="Delete Forever"
          confirmStyle={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)', boxShadow: '0 4px 12px rgba(239,68,68,0.25)' }}
          onConfirm={handlePermDelete}
          onCancel={() => { setConfirm(null); setPermDelError(null); }}
          busy={permDeleting}
          error={permDelError}
        />
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Trash</h1>
        <p className="text-sm text-navy-600 dark:text-white/60 mt-1">
          Recordings moved to trash. Restore or delete them permanently.
        </p>
      </div>

      {error && (
        <div className="glass-card p-5 flex items-center gap-4 mb-4">
          <AlertCircle size={22} className="text-red-500 shrink-0" />
          <p className="text-sm text-navy-700 dark:text-white/70">{error}</p>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="glass-card p-4 flex items-center gap-4">
              <div className="h-5 w-24 rounded-full bg-navy-100 dark:bg-white/10 animate-pulse" />
              <div className="h-5 flex-1 rounded bg-navy-100 dark:bg-white/10 animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(148,163,184,0.12)' }}>
            <Mic2 size={28} className="text-navy-300 dark:text-white/30" />
          </div>
          <p className="font-semibold text-navy-900 dark:text-white text-lg mb-1">Trash is empty</p>
          <p className="text-sm text-navy-500 dark:text-white/50">Deleted recordings will appear here.</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="glass-card p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-navy-900 dark:text-white truncate">{item.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-navy-500 dark:text-white/50">{item.date}</span>
                  {item.deletedAt && (
                    <span className="text-xs text-navy-400 dark:text-white/40">
                      · deleted {new Date(item.deletedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: 'linear-gradient(135deg,#F59E0B,#D97706)',
                    color: 'white',
                    boxShadow: restoring === item.id ? 'none' : '0 2px 8px rgba(245,158,11,0.3)',
                    opacity: restoring === item.id ? 0.7 : 1,
                  }}
                  onClick={() => handleRestore(item.id)}
                  disabled={restoring === item.id}
                  title="Restore"
                >
                  <RotateCcw size={12} className={restoring === item.id ? 'animate-spin' : ''} />
                  {restoring === item.id ? 'Restoring…' : 'Restore'}
                </button>

                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  onClick={() => setConfirm({ id: item.id, title: item.title })}
                  title="Delete Forever"
                >
                  <Trash2 size={12} />
                  Delete Forever
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
