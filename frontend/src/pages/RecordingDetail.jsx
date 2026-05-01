import { useState, useEffect, useRef } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Star, Headphones, Sparkles,
  StickyNote, AlertCircle, Mic2, RefreshCw, Paperclip,
  Pencil, CheckCircle, X, Trash2,
} from 'lucide-react';
import {
  getRecording, audioUrl, regenerateAiNotes, saveAiNotes,
  updateTitle, updateDate, updateOriginalNotes, deleteRecording,
} from '../lib/api';
import { useApp } from '../context/AppContext';
import AudioPlayer from '../components/AudioPlayer';
import MarkdownRenderer from '../components/MarkdownRenderer';
import AttachmentsTab from '../components/AttachmentsTab';

// ── Loading skeleton ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="h-8 w-24 rounded-lg bg-navy-100 dark:bg-white/10 animate-pulse mb-6" />
      <div className="glass-panel p-6 mb-4">
        <div className="h-5 w-20 rounded-full bg-navy-100 dark:bg-white/10 animate-pulse mb-3" />
        <div className="h-7 w-2/3 rounded bg-navy-100 dark:bg-white/10 animate-pulse mb-4" />
        <div className="flex gap-2">
          {[60, 72, 80].map(w => (
            <div key={w} className="h-5 rounded-full bg-navy-100 dark:bg-white/10 animate-pulse" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="glass-panel p-6">
        <div className="flex gap-2 mb-6">
          {[80, 90, 100].map(w => (
            <div key={w} className="h-8 rounded-lg bg-navy-100 dark:bg-white/10 animate-pulse" style={{ width: w }} />
          ))}
        </div>
        {[100, 90, 80, 75, 85, 70].map((w, i) => (
          <div key={i} className="h-4 rounded bg-navy-100 dark:bg-white/10 animate-pulse mb-3" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

// ── Empty content placeholder ─────────────────────────────────────────────────

function NoContent({ label }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Mic2 size={36} className="text-navy-200 dark:text-white/20 mb-3" />
      <p className="font-semibold text-navy-700 dark:text-white/70">{label} not available</p>
      <p className="text-sm text-navy-400 dark:text-white/40 mt-1 max-w-xs">
        This file was not found in the archive. Run pocket_sync.py to populate it.
      </p>
    </div>
  );
}

// ── Delete confirmation modal ─────────────────────────────────────────────────

function DeleteModal({ onConfirm, onCancel, deleting, error }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
      <div className="glass-panel p-6 max-w-sm w-full animate-slide-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(239,68,68,0.12)' }}>
            <Trash2 size={18} className="text-red-500" />
          </div>
          <div>
            <p className="font-semibold text-navy-900 dark:text-white">Move to Trash?</p>
            <p className="text-sm text-navy-500 dark:text-white/50 mt-0.5">
              You can restore it from the Trash later.
            </p>
          </div>
        </div>
        {error && (
          <p className="text-sm text-red-500 mb-3">{error}</p>
        )}
        <div className="flex gap-2 justify-end">
          <button className="btn-ghost text-sm" onClick={onCancel} disabled={deleting}>
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)', boxShadow: '0 4px 12px rgba(239,68,68,0.25)' }}
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? 'Moving…' : 'Move to Trash'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RecordingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { favorites, toggleFavorite } = useApp();
  const isMobile = useIsMobile();

  const [rec, setRec]               = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [activeTab, setActiveTab]   = useState('ai');
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError]     = useState(null);

  // AI Notes edit
  const [editing, setEditing]     = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveToast, setSaveToast] = useState(false);
  const textareaRef  = useRef(null);
  const jumpToEndRef = useRef(false);

  // Original Notes edit
  const [origEditing, setOrigEditing]   = useState(false);
  const [origDraft, setOrigDraft]       = useState('');
  const [origSaving, setOrigSaving]     = useState(false);
  const [origSaveError, setOrigSaveError] = useState(null);
  const [origSaveToast, setOrigSaveToast] = useState(false);
  const origTextareaRef = useRef(null);

  // Title inline edit
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft]     = useState('');
  const [titleSaving, setTitleSaving]   = useState(false);
  const [titleError, setTitleError]     = useState(null);
  const titleInputRef = useRef(null);

  // Date inline edit
  const [dateEditing, setDateEditing] = useState(false);
  const [dateDraft, setDateDraft]     = useState('');
  const [dateSaving, setDateSaving]   = useState(false);
  const [dateError, setDateError]     = useState(null);
  const dateInputRef = useRef(null);

  // Delete
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [deleteError, setDeleteError]     = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getRecording(id)
      .then(data => {
        setRec(data);
        if      (data.aiNotes)       setActiveTab('ai');
        else if (data.originalNotes) setActiveTab('original');
        else                         setActiveTab('attachments');
      })
      .catch(err => setError(err.message || 'Failed to load recording'))
      .finally(() => setLoading(false));
  }, [id]);

  // Focus AI Notes textarea
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      if (jumpToEndRef.current) {
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
        textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
        jumpToEndRef.current = false;
      }
    }
  }, [editing]);

  // Focus Original Notes textarea
  useEffect(() => {
    if (origEditing && origTextareaRef.current) {
      origTextareaRef.current.focus();
    }
  }, [origEditing]);

  // Focus title input
  useEffect(() => {
    if (titleEditing && titleInputRef.current) {
      titleInputRef.current.select();
    }
  }, [titleEditing]);

  // Focus date input
  useEffect(() => {
    if (dateEditing && dateInputRef.current) {
      dateInputRef.current.showPicker?.();
    }
  }, [dateEditing]);

  // ── AI Notes handlers ──

  async function handleRegenerate() {
    setRegenerating(true);
    setRegenError(null);
    try {
      const updated = await regenerateAiNotes(id);
      setRec(updated);
    } catch (err) {
      setRegenError(err.response?.data?.error || err.message || 'Regeneration failed');
    } finally {
      setRegenerating(false);
    }
  }

  function handleEdit(jumpToEnd = false) {
    jumpToEndRef.current = jumpToEnd;
    setEditDraft(rec.aiNotes || '');
    setSaveError(null);
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setEditDraft('');
    setSaveError(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await saveAiNotes(id, editDraft);
      setRec(updated);
      setEditing(false);
      setEditDraft('');
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 2500);
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Original Notes handlers ──

  function handleOrigEdit() {
    setOrigDraft(rec.originalNotes || '');
    setOrigSaveError(null);
    setOrigEditing(true);
  }

  function handleOrigCancel() {
    setOrigEditing(false);
    setOrigDraft('');
    setOrigSaveError(null);
  }

  async function handleOrigSave() {
    setOrigSaving(true);
    setOrigSaveError(null);
    try {
      const updated = await updateOriginalNotes(id, origDraft);
      setRec(r => ({ ...r, originalNotes: updated.originalNotes }));
      setOrigEditing(false);
      setOrigDraft('');
      setOrigSaveToast(true);
      setTimeout(() => setOrigSaveToast(false), 2500);
    } catch (err) {
      setOrigSaveError(err.response?.data?.error || err.message || 'Save failed');
    } finally {
      setOrigSaving(false);
    }
  }

  // ── Title handlers ──

  function startTitleEdit() {
    setTitleDraft(rec.title);
    setTitleError(null);
    setTitleEditing(true);
  }

  async function saveTitleEdit() {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === rec.title) { setTitleEditing(false); return; }
    setTitleSaving(true);
    setTitleError(null);
    try {
      const updated = await updateTitle(id, trimmed);
      setRec(r => ({ ...r, title: updated.title }));
      setTitleEditing(false);
    } catch (err) {
      setTitleError(err.response?.data?.error || err.message || 'Save failed');
    } finally {
      setTitleSaving(false);
    }
  }

  // ── Date handlers ──

  function startDateEdit() {
    setDateDraft(rec.date);
    setDateError(null);
    setDateEditing(true);
  }

  async function saveDateEdit() {
    if (!dateDraft || dateDraft === rec.date) { setDateEditing(false); return; }
    setDateSaving(true);
    setDateError(null);
    try {
      const updated = await updateDate(id, dateDraft);
      setRec(r => ({ ...r, date: updated.date }));
      setDateEditing(false);
    } catch (err) {
      setDateError(err.response?.data?.error || err.message || 'Save failed');
    } finally {
      setDateSaving(false);
    }
  }

  // ── Delete handler ──

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRecording(id);
      navigate('/', { state: { toast: 'Recording moved to Trash.' } });
    } catch (err) {
      setDeleteError(err.response?.data?.error || err.message || 'Delete failed');
      setDeleting(false);
    }
  }

  function handleTabChange(key) {
    if (editing) { setEditing(false); setEditDraft(''); setSaveError(null); }
    if (origEditing) { setOrigEditing(false); setOrigDraft(''); setOrigSaveError(null); }
    setActiveTab(key);
  }

  if (loading) return <Skeleton />;

  if (error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button className="btn-ghost mb-6" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="glass-card p-8 flex items-center gap-4">
          <AlertCircle size={28} className="text-red-400 shrink-0" />
          <div>
            <p className="font-semibold text-navy-900 dark:text-white">Could not load recording</p>
            <p className="text-sm text-navy-600 dark:text-white/60 mt-1">{error}</p>
            <p className="text-xs text-navy-400 dark:text-white/40 mt-1">Make sure the backend is running on port 3001.</p>
          </div>
        </div>
      </div>
    );
  }

  const isFav = favorites.includes(id);

  const TABS = [
    { key: 'ai',          label: 'AI Notes',       mobileLabel: 'AI Notes', icon: Sparkles,   available: !!rec.aiNotes,       content: rec.aiNotes },
    { key: 'original',    label: 'Original Notes', mobileLabel: 'Original', icon: StickyNote, available: !!rec.originalNotes, content: rec.originalNotes },
    { key: 'attachments', label: 'Attachments',    mobileLabel: 'Attach',   icon: Paperclip,  available: true,                content: null },
  ];

  const visibleTabs   = TABS.filter(t => t.available);
  const activeContent = TABS.find(t => t.key === activeTab)?.content ?? null;
  const vizCount      = rec.visualizations?.length ?? 0;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto animate-slide-up">
      {confirmDelete && (
        <DeleteModal
          onConfirm={handleDelete}
          onCancel={() => { setConfirmDelete(false); setDeleteError(null); }}
          deleting={deleting}
          error={deleteError}
        />
      )}

      {/* Back */}
      <button className="btn-ghost mb-5" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} /> Back
      </button>

      {/* ── Header card ──────────────────────────────────────────────────────── */}
      <div className="glass-panel p-6 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">

            {/* Date badge — click to edit */}
            {dateEditing ? (
              <div className="flex items-center gap-2 mb-3">
                <input
                  ref={dateInputRef}
                  type="date"
                  className="text-xs font-semibold px-2 py-1 rounded-lg border border-gold-400 bg-white dark:bg-white/10 text-navy-900 dark:text-white outline-none focus:ring-2 focus:ring-gold-400/50"
                  value={dateDraft}
                  onChange={e => setDateDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveDateEdit(); if (e.key === 'Escape') setDateEditing(false); }}
                  onBlur={saveDateEdit}
                  disabled={dateSaving}
                />
                {dateError && <p className="text-xs text-red-500">{dateError}</p>}
              </div>
            ) : (
              <button
                className="badge badge-gold mb-3 cursor-pointer hover:opacity-75 transition-opacity flex items-center gap-1"
                onClick={startDateEdit}
                title="Edit date"
              >
                {rec.date}
                <Pencil size={9} />
              </button>
            )}

            {/* Title — click pencil to edit */}
            {titleEditing ? (
              <div className="flex items-center gap-2 mb-3">
                <input
                  ref={titleInputRef}
                  className="flex-1 min-w-0 text-xl font-bold text-navy-900 dark:text-white bg-black/5 dark:bg-white/10 border border-navy-200 dark:border-white/20 rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-gold-400/50"
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveTitleEdit(); if (e.key === 'Escape') setTitleEditing(false); }}
                  disabled={titleSaving}
                />
                <button
                  className="btn-ghost text-xs flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
                  onClick={saveTitleEdit}
                  disabled={titleSaving}
                >
                  <CheckCircle size={13} className={titleSaving ? 'animate-pulse' : ''} />
                  {titleSaving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn-ghost text-xs" onClick={() => setTitleEditing(false)} disabled={titleSaving}>
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div className="flex items-start gap-2 mb-3">
                <h1 className="text-xl font-bold text-navy-900 dark:text-white leading-snug flex-1 min-w-0">
                  {rec.title}
                </h1>
                <button
                  className="shrink-0 mt-1 text-navy-300 dark:text-white/30 hover:text-navy-600 dark:hover:text-white/60 transition-colors"
                  onClick={startTitleEdit}
                  title="Edit title"
                >
                  <Pencil size={14} />
                </button>
              </div>
            )}
            {titleError && <p className="text-xs text-red-500 mb-2">{titleError}</p>}

            <div className="flex flex-wrap gap-2">
              {rec.hasAudio      && <span className="badge badge-green"><Headphones size={11} /> Audio</span>}
              {rec.aiNotes       && (
                <span className="badge badge-blue">
                  <Sparkles size={11} /> AI Notes
                  {vizCount > 0 && ` · ${vizCount} chart${vizCount !== 1 ? 's' : ''}`}
                </span>
              )}
              {rec.originalNotes && <span className="badge badge-slate"><StickyNote size={11} /> Original Notes</span>}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Favorite */}
            <button
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
              style={{
                color:      isFav ? '#F59E0B' : '#CBD5E1',
                background: isFav ? 'rgba(245,158,11,0.08)' : 'transparent',
              }}
              onClick={() => toggleFavorite(id)}
              title={isFav ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star size={20} fill={isFav ? '#F59E0B' : 'none'} />
            </button>

            {/* Delete */}
            <button
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all text-navy-300 dark:text-white/30 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
              onClick={() => setConfirmDelete(true)}
              title="Move to Trash"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Audio player ─────────────────────────────────────────────────────── */}
      {rec.hasAudio && <AudioPlayer src={audioUrl(rec.audioFilename)} />}

      {/* ── Content panel ────────────────────────────────────────────────────── */}
      <div className="glass-panel p-4 sm:p-6">

        {/* Tab bar + action button row — stacks vertically on mobile */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          {visibleTabs.length > 1 ? (
            <div className="overflow-x-auto -mx-1 px-1">
              <div className="tab-bar w-max">
                {visibleTabs.map(({ key, label, mobileLabel, icon: Icon }) => (
                  <button
                    key={key}
                    className={`tab-item flex items-center gap-1.5 shrink-0 ${activeTab === key ? 'active' : ''}`}
                    onClick={() => handleTabChange(key)}
                  >
                    <Icon size={13} />
                    {isMobile ? mobileLabel : label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div />
          )}

          {/* AI Notes tab actions */}
          {activeTab === 'ai' && (
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {saveToast && (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle size={12} /> Saved
                </span>
              )}
              {editing ? (
                <>
                  {saveError && (
                    <p className="text-xs text-red-500 dark:text-red-400 max-w-[180px] truncate" title={saveError}>
                      {saveError}
                    </p>
                  )}
                  <button
                    className="btn-ghost text-xs flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    <CheckCircle size={13} className={saving ? 'animate-pulse' : ''} />
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    className="btn-ghost text-xs flex items-center gap-1.5"
                    onClick={handleCancel}
                    disabled={saving}
                  >
                    <X size={13} />
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {regenError && (
                    <p className="text-xs text-red-500 dark:text-red-400">{regenError}</p>
                  )}
                  <button
                    className="btn-ghost text-xs flex items-center gap-1.5"
                    onClick={() => handleEdit(false)}
                    title="Edit AI Notes"
                  >
                    <Pencil size={13} />
                    Edit
                  </button>
                  <button
                    className="btn-ghost text-xs flex items-center gap-1.5"
                    onClick={handleRegenerate}
                    disabled={regenerating}
                  >
                    <RefreshCw size={13} className={regenerating ? 'animate-spin' : ''} />
                    {regenerating ? 'Regenerating…' : 'Regenerate'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Original Notes tab actions */}
          {activeTab === 'original' && (
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {origSaveToast && (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle size={12} /> Saved
                </span>
              )}
              {origEditing ? (
                <>
                  {origSaveError && (
                    <p className="text-xs text-red-500 dark:text-red-400 max-w-[180px] truncate" title={origSaveError}>
                      {origSaveError}
                    </p>
                  )}
                  <button
                    className="btn-ghost text-xs flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"
                    onClick={handleOrigSave}
                    disabled={origSaving}
                  >
                    <CheckCircle size={13} className={origSaving ? 'animate-pulse' : ''} />
                    {origSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    className="btn-ghost text-xs flex items-center gap-1.5"
                    onClick={handleOrigCancel}
                    disabled={origSaving}
                  >
                    <X size={13} />
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="btn-ghost text-xs flex items-center gap-1.5"
                  onClick={handleOrigEdit}
                  title="Edit Original Notes"
                >
                  <Pencil size={13} />
                  Edit
                </button>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        {activeTab === 'attachments' ? (
          <AttachmentsTab id={id} />
        ) : editing && activeTab === 'ai' ? (
          <div className="min-h-40">
            <textarea
              ref={textareaRef}
              className="w-full min-h-[400px] font-mono text-sm text-navy-900 dark:text-white bg-black/5 dark:bg-white/5 border border-navy-200 dark:border-white/20 rounded-xl p-4 resize-y outline-none focus:ring-2 focus:ring-gold-400/50 leading-relaxed"
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              spellCheck={false}
            />
          </div>
        ) : origEditing && activeTab === 'original' ? (
          <div className="min-h-40">
            <textarea
              ref={origTextareaRef}
              className="w-full min-h-[400px] font-mono text-sm text-navy-900 dark:text-white bg-black/5 dark:bg-white/5 border border-navy-200 dark:border-white/20 rounded-xl p-4 resize-y outline-none focus:ring-2 focus:ring-gold-400/50 leading-relaxed"
              value={origDraft}
              onChange={e => setOrigDraft(e.target.value)}
              spellCheck={false}
            />
          </div>
        ) : activeContent ? (
          <div className="min-h-40">
            <MarkdownRenderer content={activeContent} />
            {activeTab === 'ai' && (
              <button
                className="mt-5 text-xs text-navy-400 dark:text-white/35 hover:text-navy-600 dark:hover:text-white/60 transition-colors flex items-center gap-1"
                onClick={() => handleEdit(true)}
              >
                <Pencil size={11} />
                + Add to notes
              </button>
            )}
          </div>
        ) : (
          <NoContent label={TABS.find(t => t.key === activeTab)?.label ?? 'Content'} />
        )}
      </div>
    </div>
  );
}
