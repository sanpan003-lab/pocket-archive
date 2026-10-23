import { useEffect, useState } from 'react';
import { ScanText } from 'lucide-react';
import { getDocumentSettings, saveDocumentSettings } from '../lib/api';
import { DOC_TYPES } from '../lib/documents';

function Switch({ label, hint, checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className="w-full flex items-center gap-3 py-2 text-left disabled:opacity-50" onClick={() => onChange(!checked)}>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-navy-900 dark:text-white">{label}</span>
        {hint && <span className="block text-xs text-navy-500 dark:text-white/50">{hint}</span>}
      </span>
      <span className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${checked ? 'bg-gold-500' : 'bg-navy-200 dark:bg-white/20'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

/** Settings → Documents: read photos, scans and PDFs automatically (and which kinds) */
export default function DocumentSettings() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { getDocumentSettings().then(setS).catch(err => setError(err.response?.data?.error || 'Could not load')); }, []);

  async function save(patch) {
    setS(prev => ({ ...prev, ...patch, types: { ...prev.types, ...(patch.types || {}) } }));
    try { const next = await saveDocumentSettings(patch); setS(prev => ({ ...prev, ...next })); setError(''); }
    catch (err) { setError(err.response?.data?.error || 'Could not save'); }
  }

  return (
    <div id="documents" className="glass-panel p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <ScanText size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Documents</h2>
      </div>
      <p className="text-sm text-navy-500 dark:text-white/50 mb-3">
        Photos, scans and PDFs are read by AI: what kind of document it is, the details (store, total, due date…), and the text so you can search for it.
        Card, bank account and ID numbers keep only their last 4 digits. Nothing is sent or created without a tap.
      </p>
      {!s && !error && <div className="h-24 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" />}
      {s && (
        <>
          <Switch label="Organize documents automatically" hint="New photo and scan notes, and photos/PDFs you attach to notes" checked={s.auto} onChange={v => save({ auto: v })} />
          <p className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mt-3 mb-1">Kinds of documents</p>
          <div className="grid sm:grid-cols-2 gap-x-4">
            {Object.entries(DOC_TYPES).filter(([k]) => k !== 'other').map(([k, t]) => (
              <Switch key={k} label={`${t.icon} ${t.label}`} checked={s.types?.[k] !== false} disabled={!s.auto} onChange={v => save({ types: { [k]: v } })} />
            ))}
          </div>
          <p className="text-xs text-navy-500 dark:text-white/50 mt-2">A kind that’s off is still read for search, without its details card. “Reprocess” on a note reads it again (your edits are kept).</p>
        </>
      )}
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
    </div>
  );
}
