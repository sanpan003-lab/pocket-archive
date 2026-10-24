import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderKanban, Plus, Archive, Sparkles } from 'lucide-react';
import { getProjects, createProject } from '../lib/api';
import NoteSearch from '../components/search/NoteSearch';

// Projects page search: projects first, and notes found by their project's name
const PROJECT_SEARCH = { types: ['projects', 'notes', 'lists', 'documents'] };
import { summaryPreview, timeAgo } from '../components/quick/quickMeta';

/** Projects: named groups of quick notes, each with a living summary. */
export default function ProjectsPage() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState('');
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getProjects().then(list => { setProjects(list); setError(''); })
      .catch(err => setError(err.response?.data?.error || 'Could not load projects'));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createProject(name.trim());
      setName('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create the project');
    } finally {
      setBusy(false);
    }
  }

  const visible = (projects || []).filter(p => (showArchived ? p.status === 'archived' : p.status !== 'archived'));
  const archivedCount = (projects || []).filter(p => p.status === 'archived').length;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Projects</h1>
        {archivedCount > 0 && (
          <button className="btn-ghost text-sm" onClick={() => setShowArchived(a => !a)} aria-pressed={showArchived}>
            <Archive size={15} /> {showArchived ? 'Active projects' : `Archived (${archivedCount})`}
          </button>
        )}
      </div>
      <p className="text-sm text-navy-600 dark:text-white/60 mb-4">
        Group quick notes by project. Say “start a project called …”, or “for the … project: …” to add to one.
      </p>

      <NoteSearch preset={PROJECT_SEARCH} placeholder="Search projects and their notes…" onActiveChange={setSearching} />

      <div hidden={searching}>

      {!showArchived && (
        <form onSubmit={add} className="flex gap-2 mb-5">
          <input
            className="flex-1 min-w-0 h-11 rounded-xl px-3 text-sm bg-white/70 dark:bg-white/5 border border-navy-200 dark:border-white/10 text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-gold-400/50"
            placeholder="New project name"
            value={name}
            onChange={e => setName(e.target.value)}
            aria-label="New project name"
          />
          <button type="submit" className="btn-gold shrink-0" disabled={busy || !name.trim()}>
            <Plus size={16} /> Create
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-500 dark:text-red-400 mb-3">{error}</p>}

      {projects === null ? (
        <div className="grid gap-4">{[0, 1].map(i => <div key={i} className="quick-card h-32 animate-pulse" />)}</div>
      ) : visible.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <FolderKanban size={30} className="mx-auto mb-2 text-navy-200 dark:text-white/20" />
          <p className="text-sm text-navy-600 dark:text-white/50">{showArchived ? 'No archived projects.' : 'No projects yet.'}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {visible.map(p => (
            <Link key={p.id} to={`/projects/${p.id}`} className="quick-card p-4 block hover:border-gold-400/60 transition-colors min-w-0">
              <span className="quick-card-accent" style={{ background: '#F59E0B' }} aria-hidden="true" />
              <div className="pl-2">
                <div className="flex items-center gap-2 mb-1">
                  <FolderKanban size={16} className="text-gold-600 dark:text-gold-400 shrink-0" />
                  <h2 className="font-bold text-navy-900 dark:text-white truncate">{p.name}</h2>
                </div>
                <p className="text-xs text-navy-500 dark:text-white/50 mb-2">
                  {p.noteCount} note{p.noteCount === 1 ? '' : 's'} · updated {timeAgo(p.updatedAt)}
                  {p.aliases?.length > 0 && ` · also “${p.aliases[0]}”`}
                </p>
                {p.livingSummaryStatus === 'pending' && !p.livingSummary ? (
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-gold-600 dark:text-gold-400">
                    <Sparkles size={12} className="animate-pulse" /> Writing the summary…
                  </p>
                ) : (
                  <p className="text-sm text-navy-700 dark:text-white/70 line-clamp-3 break-words">
                    {p.livingSummary ? summaryPreview({ summary: p.livingSummary, title: p.name }) : 'No notes yet.'}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
