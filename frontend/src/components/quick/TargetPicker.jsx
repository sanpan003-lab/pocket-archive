import { useEffect, useRef, useState } from 'react';
import { X, Search, FolderKanban, ShoppingCart, StickyNote, CalendarClock, Bell, FilePlus2, FolderPlus } from 'lucide-react';
import { searchQuickTargets, createProject } from '../../lib/api';

const ICONS = { project: FolderKanban, errand: ShoppingCart, note: StickyNote, event: CalendarClock, reminder: Bell };

/**
 * Searchable picker for "Other…", Move, Merge into… and Add to project….
 * onPick({ targetType, targetId, title }) or onPick({ new: true })
 * types: limit to some target types (e.g. ['project'])
 */
export default function TargetPicker({ title = 'Choose where', exclude, types, allowNewNote = false, allowNewProject = false, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Debounced search (sets state only in the async callbacks)
  useEffect(() => {
    const t = setTimeout(() => {
      searchQuickTargets(q.trim(), exclude)
        .then(list => setResults(types ? list.filter(r => types.includes(r.type)) : list))
        .catch(err => setError(err.response?.data?.error || 'Search failed'));
    }, 200);
    return () => clearTimeout(t);
  }, [q, exclude, types]);

  async function newProject() {
    const name = q.trim();
    if (!name) { inputRef.current?.focus(); return; }
    setCreating(true);
    try {
      const p = await createProject(name);
      onPick({ targetType: 'project', targetId: p.id, title: p.name });
    } catch (err) {
      const existing = err.response?.data?.project;
      if (existing) onPick({ targetType: 'project', targetId: existing.id, title: existing.name });
      else setError(err.response?.data?.error || 'Could not create the project');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="glass-panel w-full sm:max-w-md max-h-[85vh] flex flex-col p-4 sm:p-5 rounded-b-none sm:rounded-b-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-navy-900 dark:text-white">{title}</h2>
          <button className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10" onClick={onClose} aria-label="Close">
            <X size={18} className="text-navy-600 dark:text-white/60" />
          </button>
        </div>
        <label className="flex items-center gap-2 px-3 h-11 rounded-xl bg-black/5 dark:bg-white/5 border border-navy-100 dark:border-white/10 mb-3">
          <Search size={16} className="text-navy-400 dark:text-white/40 shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/30"
            placeholder={types?.length === 1 && types[0] === 'project' ? 'Project name' : 'Search notes, lists, projects…'}
            value={q}
            onChange={e => setQ(e.target.value)}
            aria-label="Search"
          />
        </label>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1.5">
          {allowNewNote && (
            <button className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left hover:bg-gold-500/10" onClick={() => onPick({ new: true })}>
              <FilePlus2 size={18} className="text-gold-600 dark:text-gold-400 shrink-0" />
              <span className="text-sm font-semibold text-navy-900 dark:text-white">Keep as its own note</span>
            </button>
          )}
          {allowNewProject && (
            <button className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left hover:bg-gold-500/10 disabled:opacity-50" onClick={newProject} disabled={creating}>
              <FolderPlus size={18} className="text-gold-600 dark:text-gold-400 shrink-0" />
              <span className="text-sm font-semibold text-navy-900 dark:text-white">
                {q.trim() ? `New project “${q.trim()}”` : 'New project… (type a name)'}
              </span>
            </button>
          )}
          {error && <p className="text-sm text-red-500 dark:text-red-400 px-1">{error}</p>}
          {results === null ? (
            [0, 1, 2].map(i => <div key={i} className="h-12 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" />)
          ) : results.length === 0 ? (
            <p className="text-sm text-navy-500 dark:text-white/50 px-1 py-2">Nothing found.</p>
          ) : results.map(r => {
            const Icon = ICONS[r.type] || StickyNote;
            return (
              <button
                key={`${r.type}:${r.id}`}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left bg-white/60 dark:bg-white/5 border border-navy-100 dark:border-white/10 hover:bg-gold-500/10"
                onClick={() => onPick({ targetType: r.type, targetId: r.id, title: r.title })}
              >
                <Icon size={17} className="shrink-0 text-navy-500 dark:text-white/60" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-navy-900 dark:text-white truncate">{r.title}</span>
                  <span className="block text-xs text-navy-500 dark:text-white/50">{r.subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
