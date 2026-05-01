import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { createRecording } from '../lib/api';

const TODAY = new Date().toISOString().slice(0, 10);

const TABS = [
  { key: 'manual', label: 'Manual Entry', icon: FileText },
  { key: 'upload', label: 'Upload Audio', icon: Upload },
];

export default function CreateRecordingPage() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('manual');
  const [title, setTitle]         = useState('');
  const [date, setDate]           = useState(TODAY);
  const [notes, setNotes]         = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [error, setError]         = useState(null);
  const fileInputRef              = useRef(null);

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (f) setAudioFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) setAudioFile(f);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setError('Title is required.'); return; }
    if (activeTab === 'upload' && !audioFile) { setError('Please select an audio file.'); return; }

    setError(null);
    setUploading(true);
    setProgress(0);

    const form = new FormData();
    form.append('title', trimmedTitle);
    form.append('date', date);
    if (notes.trim()) form.append('notes', notes.trim());
    if (activeTab === 'upload' && audioFile) form.append('audioFile', audioFile);

    try {
      const result = await createRecording(form, pct => setProgress(pct));
      navigate(`/recordings/${result.id}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create recording');
      setUploading(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <button className="btn-ghost mb-5" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} /> Back
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">New Recording</h1>
        <p className="text-sm text-navy-600 dark:text-white/60 mt-1">
          Create a manual entry or upload an audio file.
        </p>
      </div>

      <form className="glass-panel p-6 space-y-5" onSubmit={handleSubmit}>

        {/* Tab selector */}
        <div className="tab-bar w-full">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`tab-item flex items-center gap-1.5 flex-1 justify-center ${activeTab === key ? 'active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-navy-700 dark:text-white/70 mb-1.5">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            className="w-full bg-black/5 dark:bg-white/10 border border-navy-200 dark:border-white/20 rounded-xl px-4 py-2.5 text-sm text-navy-900 dark:text-white outline-none focus:ring-2 focus:ring-gold-400/50"
            placeholder="Enter a title for this recording"
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={uploading}
            required
          />
        </div>

        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-navy-700 dark:text-white/70 mb-1.5">
            Date
          </label>
          <input
            type="date"
            className="w-full bg-black/5 dark:bg-white/10 border border-navy-200 dark:border-white/20 rounded-xl px-4 py-2.5 text-sm text-navy-900 dark:text-white outline-none focus:ring-2 focus:ring-gold-400/50"
            value={date}
            onChange={e => setDate(e.target.value)}
            disabled={uploading}
          />
        </div>

        {/* Notes (manual) */}
        <div>
          <label className="block text-sm font-medium text-navy-700 dark:text-white/70 mb-1.5">
            Notes <span className="text-navy-400 dark:text-white/40 font-normal">(optional)</span>
          </label>
          <textarea
            className="w-full min-h-[140px] bg-black/5 dark:bg-white/10 border border-navy-200 dark:border-white/20 rounded-xl px-4 py-3 text-sm text-navy-900 dark:text-white outline-none focus:ring-2 focus:ring-gold-400/50 resize-y font-mono leading-relaxed"
            placeholder="Add any notes, transcription, or content…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={uploading}
          />
        </div>

        {/* Audio upload (upload tab only) */}
        {activeTab === 'upload' && (
          <div>
            <label className="block text-sm font-medium text-navy-700 dark:text-white/70 mb-1.5">
              Audio File <span className="text-red-400">*</span>
            </label>

            <div
              className="border-2 border-dashed border-navy-200 dark:border-white/20 rounded-xl p-6 text-center cursor-pointer transition-colors hover:border-gold-400/60 hover:bg-gold-50/30 dark:hover:bg-gold-500/5"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
            >
              {audioFile ? (
                <div className="flex items-center justify-center gap-3">
                  <CheckCircle size={18} className="text-emerald-500 shrink-0" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-navy-900 dark:text-white truncate max-w-xs">
                      {audioFile.name}
                    </p>
                    <p className="text-xs text-navy-400 dark:text-white/40">
                      {(audioFile.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ml-2 text-xs text-navy-400 dark:text-white/40 hover:text-red-400 transition-colors"
                    onClick={e => { e.stopPropagation(); setAudioFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <Upload size={24} className="text-navy-300 dark:text-white/30 mx-auto mb-2" />
                  <p className="text-sm text-navy-600 dark:text-white/60">
                    Drop an audio file here or <span className="text-gold-600 dark:text-gold-400 font-medium">browse</span>
                  </p>
                  <p className="text-xs text-navy-400 dark:text-white/40 mt-1">MP3, M4A, WAV, OGG — max 100 MB</p>
                </>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.m4a,.wav,.ogg,audio/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* Upload progress */}
        {uploading && activeTab === 'upload' && audioFile && (
          <div>
            <div className="flex justify-between text-xs text-navy-500 dark:text-white/50 mb-1">
              <span>Uploading…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-navy-100 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#F59E0B,#D97706)' }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-500 dark:text-red-400">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          className="btn-gold w-full justify-center"
          disabled={uploading}
        >
          {uploading ? 'Creating…' : 'Create Recording'}
        </button>
      </form>
    </div>
  );
}
