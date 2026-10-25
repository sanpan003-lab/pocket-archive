import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FolderKanban, Pencil, Archive, ArchiveRestore, Trash2, Sparkles, Combine, X, Check, RotateCcw, Users } from 'lucide-react';
import {
  getProject, updateProject, removeNoteFromProject, resummarizeProject, deleteProject, mergeProject, quickAudioUrl,
} from '../lib/api';
import MarkdownRenderer from '../components/MarkdownRenderer';
import QuickAudio from '../components/quick/QuickAudio';
import { TranscriptToggle } from '../components/quick/QuickSummary';
import UpdatesTimeline from '../components/quick/UpdatesTimeline';
import TargetPicker from '../components/quick/TargetPicker';
import ShareSheet from '../components/quick/ShareSheet';
import { onQuickChanged } from '../lib/uiBus';
import SharedBadge from '../components/quick/SharedBadge';
import { KeepOfflineButton } from '../components/offline/OfflineNote';
import { QUICK_TYPES, cardTime, summaryPreview } from '../components/quick/quickMeta';

/** Project: living summary on top, then the notes (newest first). */
export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', aliases: '' });
  const [merging, setMerging] = useState(false);
  const [busy, setBusy] = useState(null);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(() => {
    getProject(id).then(p => { setProject(p); setError(''); })
      .catch(err => setError(err.response?.data?.error || 'Project not found'));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onQuickChanged(() => load()), [load]); // live changes (shared projects)

  // The living summary is written in the background: poll while it's pending
  useEffect(() => {
    if (project?.livingSummaryStatus !== 'pending') return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [project?.livingSummaryStatus, load]);

  async function act(kind, fn) {
    setBusy(kind);
    setError('');
    try { await fn(); } catch (err) { setError(err.response?.data?.error || 'Something went wrong'); } finally { setBusy(null); }
  }

  const save = () => act('save', async () => {
    setProject(await updateProject(id, { name: draft.name, aliases: draft.aliases.split(',').map(a => a.trim()).filter(Boolean) }));
    setEditing(false);
  });

  if (error && !project) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-red-500 mb-3">{error}</p>
        <Link to="/projects" className="text-sm font-semibold text-gold-600 dark:text-gold-400">← All projects</Link>
      </div>
    );
  }
  if (!project) return <div className="p-6 max-w-3xl mx-auto"><div className="quick-card h-40 animate-pulse" /></div>;

  const archived = project.status === 'archived';

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <Link to="/projects" className="inline-flex items-center gap-1 text-sm font-medium text-navy-500 dark:text-white/50 mb-3">
        <ArrowLeft size={15} /> Projects
      </Link>

      {/* Header */}
      {editing ? (
        <div className="glass-panel p-4 mb-4 space-y-2">
          <input className="w-full h-11 rounded-xl px-3 text-base font-bold bg-white/70 dark:bg-white/5 border border-navy-200 dark:border-white/10 text-navy-900 dark:text-white" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} aria-label="Project name" />
          <label className="block text-xs font-semibold text-navy-600 dark:text-white/60" htmlFor="aliases">Aliases (what you might call it out loud, comma-separated)</label>
          <input id="aliases" className="w-full h-11 rounded-xl px-3 text-sm bg-white/70 dark:bg-white/5 border border-navy-200 dark:border-white/10 text-navy-900 dark:text-white" value={draft.aliases} onChange={e => setDraft(d => ({ ...d, aliases: e.target.value }))} />
          <div className="flex gap-2">
            <button className="btn-gold" onClick={save} disabled={busy === 'save' || !draft.name.trim()}><Check size={15} /> Save</button>
            <button className="btn-ghost" onClick={() => setEditing(false)}><X size={15} /> Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <div className="flex items-start gap-2">
            <FolderKanban size={22} className="text-gold-600 dark:text-gold-400 shrink-0 mt-1" />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold text-navy-900 dark:text-white break-words">{project.name}</h1>
              <p className="text-xs text-navy-500 dark:text-white/50 mt-0.5">
                {project.notes.length} note{project.notes.length === 1 ? '' : 's'}
                {project.aliases?.length > 0 && ` · also called ${project.aliases.join(', ')}`}
                {archived && ' · archived'}
              </p>
              {(project.sharedFrom || project.sharedWith?.length > 0) && <div className="mt-1.5"><SharedBadge note={project} /></div>}
            </div>
          </div>
          {project.sharedFrom ? (
            <div className="flex flex-wrap gap-1 mt-2">
              <button className="btn-ghost text-xs" onClick={() => setSharing(true)}><Users size={13} /> Sharing</button>
            </div>
          ) : (
          <div className="flex flex-wrap gap-1 mt-2">
            <button className="btn-ghost text-xs" onClick={() => setSharing(true)}><Users size={13} /> Share with…</button>
            <button className="btn-ghost text-xs" onClick={() => { setDraft({ name: project.name, aliases: (project.aliases || []).join(', ') }); setEditing(true); }}><Pencil size={13} /> Rename / aliases</button>
            <button className="btn-ghost text-xs" onClick={() => act('archive', async () => setProject(await updateProject(id, { status: archived ? 'active' : 'archived' })))}>
              {archived ? <><ArchiveRestore size={13} /> Unarchive</> : <><Archive size={13} /> Archive</>}
            </button>
            <button className="btn-ghost text-xs" onClick={() => setMerging(true)}><Combine size={13} /> Merge into…</button>
            <KeepOfflineButton id={id} />
            <button
              className="btn-ghost text-xs text-red-500 dark:text-red-400"
              onClick={() => window.confirm(`Move “${project.name}” to Trash? Its notes stay in the Inbox.`) && act('delete', async () => { await deleteProject(id); navigate('/projects'); })}
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
          )}
        </div>
      )}
      {sharing && (
        <ShareSheet kind="project" id={id} title={project.name} onClose={() => setSharing(false)} onChanged={load} onLeft={() => navigate('/shared')} />
      )}
      {error && <p className="text-sm text-red-500 dark:text-red-400 mb-3">{error}</p>}

      {/* Living summary */}
      <section className="quick-card p-4 sm:p-5 mb-6">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gold-600 dark:text-gold-400 flex items-center gap-1.5">
            <Sparkles size={13} /> Living summary
          </h2>
          {!project.sharedFrom && <button className="btn-ghost text-xs" onClick={() => act('resum', async () => setProject({ ...project, ...(await resummarizeProject(id)) }))} disabled={project.livingSummaryStatus === 'pending' || !project.notes.length}>
            <RotateCcw size={13} className={project.livingSummaryStatus === 'pending' ? 'animate-spin' : ''} /> Refresh
          </button>}
        </div>
        {project.livingSummaryStatus === 'pending' && !project.livingSummary ? (
          <div className="space-y-2"><div className="h-3 w-11/12 rounded bg-navy-100 dark:bg-white/10 animate-pulse" /><div className="h-3 w-3/4 rounded bg-navy-100 dark:bg-white/10 animate-pulse" /></div>
        ) : project.livingSummary ? (
          <div className="quick-summary break-words"><MarkdownRenderer content={project.livingSummary} /></div>
        ) : (
          <p className="text-sm text-navy-500 dark:text-white/50">
            {project.livingSummaryStatus === 'failed' ? 'Summary unavailable — try Refresh.' : 'Add notes to this project to get a summary.'}
          </p>
        )}
      </section>

      {/* Timeline */}
      <h2 className="mb-2.5 px-1 text-xs font-semibold uppercase tracking-wider text-navy-400 dark:text-white/40">Notes</h2>
      {project.notes.length === 0 ? (
        <p className="text-sm text-navy-500 dark:text-white/50 px-1">No notes yet. Use “Add to project…” on a note in the Inbox, or say “for the {project.name} project: …”.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {project.notes.map(n => {
            const meta = QUICK_TYPES[n.type] || QUICK_TYPES.note;
            return (
              <li key={n.id} className="quick-card p-4 min-w-0">
                <span className="quick-card-accent" style={{ background: meta.color }} aria-hidden="true" />
                <div className="pl-2">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className={`badge ${meta.badge}`}><meta.icon size={11} /> {meta.label}</span>
                    {(n.updates || []).length > 0 && <span className="badge badge-slate">Updated {n.updates.length}×</span>}
                    <span className="ml-auto text-xs text-navy-400 dark:text-white/45">{cardTime(n.capturedAt || n.createdAt)}</span>
                  </div>
                  <Link to={`/quick/${n.id}`} className="font-semibold text-navy-900 dark:text-white break-words hover:underline">{n.title}</Link>
                  {n.summaryStatus === 'done' && n.summary && (
                    <p className="text-sm text-navy-700 dark:text-white/70 mt-1 line-clamp-3 break-words">{summaryPreview(n)}</p>
                  )}
                  <TranscriptToggle transcript={n.transcript} />
                  {n.audioFile && <QuickAudio src={quickAudioUrl(n.id)} durationSec={n.durationSec} />}
                  <UpdatesTimeline note={n} />
                  {!project.sharedFrom && (
                    <button
                      className="btn-ghost text-xs mt-2 text-red-500 dark:text-red-400"
                      onClick={() => act(`rm:${n.id}`, async () => setProject(await removeNoteFromProject(id, n.id)))}
                      disabled={busy === `rm:${n.id}`}
                    >
                      <X size={13} /> Remove from project
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {merging && (
        <TargetPicker
          title={`Merge “${project.name}” into…`}
          types={['project']}
          onClose={() => setMerging(false)}
          onPick={dest => act('merge', async () => {
            if (dest.targetId === id) return;
            const into = await mergeProject(id, dest.targetId);
            setMerging(false);
            navigate(`/projects/${into.id}`);
          })}
        />
      )}
    </div>
  );
}
