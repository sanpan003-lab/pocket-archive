import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Images, RefreshCw, ShieldCheck } from 'lucide-react';
import { createMediaNote } from '../../lib/api';
import { isNative } from '../../lib/platform';
import { pickNativePhoto } from '../../native/camera';
import ComposerShell, { AiToggle } from './ComposerShell';

const MAX_BYTES = 20 * 1024 * 1024;
const newClientId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

/** Why the app asks, shown before Android's permission prompt */
function PermissionExplainer({ kind, onAnswer }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6 bg-black/40 rounded-t-3xl sm:rounded-3xl">
      <div className="note-surface rounded-2xl p-5 max-w-sm shadow-xl">
        <ShieldCheck size={24} className="text-gold-500 mb-2" />
        <p className="font-semibold text-navy-900 dark:text-white">{kind === 'camera' ? 'Allow the camera?' : 'Allow your photos?'}</p>
        <p className="text-sm text-navy-600 dark:text-white/65 mt-1">
          {kind === 'camera'
            ? 'Pocket Archive uses the camera only when you take a photo for a note. Photos go to your own server, nowhere else.'
            : 'Pocket Archive opens your gallery only to pick the photo you choose. It goes to your own server, nowhere else.'}
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" onClick={() => onAnswer(false)}>Not now</button>
          <button className="btn-gold" onClick={() => onAnswer(true)}>Continue</button>
        </div>
      </div>
    </div>
  );
}

/** Photo note: take a photo or pick one, optional caption; Gemini reads it when AI is on */
export default function ImageComposer({ onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState('');
  const [ai, setAi] = useState(true);
  const [color, setColor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [explain, setExplain] = useState(null);     // { kind, resolve }
  const cameraInput = useRef(null);
  const galleryInput = useRef(null);
  const clientId = useRef(newClientId());

  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  function accept(blob) {
    if (!blob) return;
    if (blob.size > MAX_BYTES) { setError('That image is over 20 MB — pick a smaller one'); return; }
    if (blob.type && !blob.type.startsWith('image/')) { setError('Pick an image file'); return; }
    setError(null);
    setFile(blob);
  }

  async function choose(source) {
    setError(null);
    if (!isNative) {
      (source === 'camera' ? cameraInput : galleryInput).current?.click();
      return;
    }
    try {
      const blob = await pickNativePhoto(source, kind => new Promise(resolve => setExplain({ kind, resolve })));
      accept(blob);
    } catch (err) {
      setError(err.message || 'Could not open the camera');
    }
  }

  async function save() {
    if (!file || saving) return;
    setSaving(true);
    setError(null);
    const form = new FormData();
    const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    form.append('file', file, file.name || `photo.${ext}`);
    form.append('kind', 'image');
    form.append('caption', caption);
    form.append('aiOrganize', String(ai));
    form.append('clientId', clientId.current);
    if (color) form.append('color', color);
    try {
      onSaved(await createMediaNote(form, setProgress));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Upload failed — check your connection');
      setSaving(false);
    }
  }

  function close() {
    if (file && !saving && !window.confirm('Discard this photo?')) return;
    onClose();
  }

  return (
    <ComposerShell
      title="New photo note"
      onClose={close}
      onSave={save}
      saving={saving}
      savingLabel={progress < 100 ? `Uploading ${progress}%` : ai ? 'Reading…' : 'Saving…'}
      canSave={!!file}
      color={color}
      onColor={c => setColor(c === 'default' ? null : c)}
      error={error}
      footer={<AiToggle value={ai} onChange={setAi} hint={ai ? 'Reads text (receipts, whiteboards, labels), files and summarizes it' : 'Saves the photo and caption as they are'} />}
    >
      {explain && (
        <PermissionExplainer kind={explain.kind} onAnswer={ok => { explain.resolve(ok); setExplain(null); }} />
      )}
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => accept(e.target.files?.[0])} />
      <input ref={galleryInput} type="file" accept="image/*" className="hidden" onChange={e => accept(e.target.files?.[0])} />

      {url ? (
        <div>
          <img src={url} alt="Selected" className="w-full max-h-[45vh] object-contain rounded-2xl bg-black/5 dark:bg-white/5" />
          <div className="flex gap-2 mt-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => choose('camera')}><RefreshCw size={13} /> Retake</button>
            <button type="button" className="btn-ghost text-xs" onClick={() => choose('photos')}><Images size={13} /> Choose another</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => choose('camera')} className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-navy-200 dark:border-white/15 py-10 hover:border-gold-400 hover:bg-gold-500/5">
            <Camera size={28} className="text-gold-500" />
            <span className="text-sm font-semibold text-navy-800 dark:text-white/85">Take photo</span>
          </button>
          <button type="button" onClick={() => choose('photos')} className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-navy-200 dark:border-white/15 py-10 hover:border-gold-400 hover:bg-gold-500/5">
            <Images size={28} className="text-gold-500" />
            <span className="text-sm font-semibold text-navy-800 dark:text-white/85">From gallery</span>
          </button>
        </div>
      )}

      <textarea
        className="mt-4 w-full bg-transparent outline-none text-[0.95rem] text-navy-900 dark:text-white placeholder:text-navy-300 dark:placeholder:text-white/30 resize-none min-h-[5rem]"
        placeholder="Caption (optional) — e.g. “Receipt for the Tesla drawer parts”"
        value={caption}
        onChange={e => setCaption(e.target.value)}
        aria-label="Caption"
      />
    </ComposerShell>
  );
}
