import { useState, useEffect, useRef } from 'react';
import { Paperclip, Upload, Trash2, Download, File, X } from 'lucide-react';
import { getAttachments, uploadAttachment, deleteAttachment, attachmentUrl } from '../lib/api';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']);

function isImage(filename) {
  return IMAGE_EXTS.has(filename.split('.').pop().toLowerCase());
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentsTab({ id }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [progress, setProgress]       = useState(0);
  const [dragging, setDragging]       = useState(false);
  const [error, setError]             = useState(null);
  const fileInput = useRef(null);

  useEffect(() => {
    getAttachments(id)
      .then(setAttachments)
      .catch(() => setAttachments([]))
      .finally(() => setLoading(false));
  }, [id]);

  async function upload(file) {
    if (!file || uploading) return;
    setUploading(true);
    setProgress(0);
    setError(null);
    try {
      const result = await uploadAttachment(id, file, pct => setProgress(pct));
      setAttachments(prev => [result, ...prev]);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Upload failed');
    } finally {
      setUploading(false);
      setProgress(0);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove(filename) {
    try {
      await deleteAttachment(id, filename);
      setAttachments(prev => prev.filter(a => a.filename !== filename));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Delete failed');
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-2xl p-8 text-center mb-6 transition-all cursor-pointer ${
          dragging
            ? 'border-gold-400 bg-amber-50 dark:bg-yellow-900/20'
            : 'border-navy-200 dark:border-white/20 hover:border-gold-300 dark:hover:border-gold-400/50 hover:bg-amber-50/40 dark:hover:bg-yellow-900/10'
        }`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileInput.current?.click()}
      >
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={e => upload(e.target.files[0])}
        />
        {uploading ? (
          <div>
            <div className="w-full h-2 rounded-full bg-navy-100 dark:bg-white/10 mb-3 overflow-hidden">
              <div
                className="h-full bg-gold-gradient rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-navy-600 dark:text-white/60">Uploading… {progress}%</p>
          </div>
        ) : (
          <>
            <Upload size={28} className="mx-auto mb-3 text-navy-300 dark:text-white/30" />
            <p className="font-medium text-navy-700 dark:text-white/70 text-sm">
              Drop a file here or <span className="text-gold-500">click to upload</span>
            </p>
            <p className="text-xs text-navy-400 dark:text-white/40 mt-1">Up to 50 MB</p>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm mb-4">
          <X size={16} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* File list */}
      {attachments.length === 0 ? (
        <div className="text-center py-10">
          <Paperclip size={28} className="mx-auto mb-2 text-navy-200 dark:text-white/20" />
          <p className="text-sm text-navy-500 dark:text-white/40">No attachments yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {attachments.map(a => (
            <div
              key={a.filename}
              className="flex items-center gap-3 p-3 rounded-xl bg-navy-50/50 dark:bg-white/5"
            >
              {isImage(a.filename) ? (
                <img
                  src={attachmentUrl(id, a.filename)}
                  alt={a.filename}
                  className="w-12 h-12 rounded-lg object-cover shrink-0 border border-navy-100 dark:border-white/10"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 bg-navy-100 dark:bg-white/10">
                  <File size={20} className="text-navy-400 dark:text-white/40" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-navy-900 dark:text-white truncate">{a.filename}</p>
                <p className="text-xs text-navy-400 dark:text-white/40">{formatBytes(a.size)}</p>
              </div>
              <a
                href={attachmentUrl(id, a.filename)}
                download={a.filename}
                className="p-2 rounded-lg text-navy-400 dark:text-white/40 hover:text-navy-700 dark:hover:text-white/80 hover:bg-navy-100 dark:hover:bg-white/10 transition-colors"
                onClick={e => e.stopPropagation()}
                title="Download"
              >
                <Download size={16} />
              </a>
              <button
                className="p-2 rounded-lg text-navy-400 dark:text-white/40 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                onClick={() => remove(a.filename)}
                title="Delete"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
