import {
  FileText, FileImage, FileAudio, FileVideo, FileSpreadsheet, Presentation, FileArchive, File as FileIcon, ScanLine,
} from 'lucide-react';
import { isNative, API_BASE } from './platform';
import { QuickRecorder } from '../native/quickRecorder';
import { uploadNoteAttachment, attachmentFileUrl } from './api';
import { NOTE_UPDATED } from './opsQueue';

// Attachments on notes: picking (photo library, camera, document scan, files), thumbnails,
// uploading with progress, and opening (web: browser tab; app: the right Android app).

export const MAX_BYTES = 25 * 1024 * 1024;
const READ_KEY = 'pa_attachRead';

export const KIND_ICON = {
  image: FileImage, pdf: FileText, audio: FileAudio, video: FileVideo, doc: FileText, sheet: FileSpreadsheet,
  slides: Presentation, archive: FileArchive, text: FileText, other: FileIcon, scan: ScanLine,
};
export const KIND_COLOR = {
  pdf: 'text-red-500', doc: 'text-blue-500', sheet: 'text-emerald-600', slides: 'text-orange-500', audio: 'text-violet-500',
  video: 'text-pink-500', image: 'text-teal-500', archive: 'text-amber-600', text: 'text-navy-500', other: 'text-navy-400',
};

export function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;
}

/** "Read text with AI" (remembered on this device; on by default) */
export function readPref() {
  try { return localStorage.getItem(READ_KEY) !== '0'; } catch { return true; }
}
export function setReadPref(on) {
  try { localStorage.setItem(READ_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

/** Browsers can show these images directly (HEIC usually not) */
export const browserImage = att => att.kind === 'image' && !/hei[cf]/.test(att.mime || '');

export function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** A small JPEG preview of a photo (null when the browser can't decode it, e.g. HEIC) */
export async function imageThumb(blob, max = 480) {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    return await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.8));
  } catch {
    return null;
  }
}

/** A hidden <input type=file> → the chosen File[] ([] when cancelled) */
export function pickFiles({ accept = '', multiple = true, capture } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture);
    input.style.display = 'none';
    let done = false;
    const finish = files => { if (done) return; done = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => finish([...(input.files || [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** App only: Google ML Kit document scanner (on-device, auto-crop, multi-page) → { file, thumb, pages } or null */
export async function scanDocument() {
  if (!isNative) return null;
  const r = await QuickRecorder.scanDocument({ pageLimit: 30 });
  if (!r?.pdf) return null;
  const file = new File([base64ToBlob(r.pdf, 'application/pdf')], r.name || 'Scan.pdf', { type: 'application/pdf' });
  const thumb = r.thumb ? base64ToBlob(r.thumb, 'image/jpeg') : null;
  return { file, thumb, pages: r.pages || 1 };
}

/**
 * Upload files one after another. items: [{ file, thumb?, source, pages? }].
 * onProgress({ index, name, percent }) · returns { note, errors: [{ name, error }] }
 */
export async function attachToNote(noteId, items, { read = readPref(), onProgress } = {}) {
  let note = null;
  const errors = [];
  for (const [index, item] of items.entries()) {
    const name = item.file.name || `Attachment ${index + 1}`;
    if (item.file.size > MAX_BYTES) { errors.push({ name, error: 'Over 25 MB' }); continue; }
    let thumb = item.thumb || null;
    if (!thumb && /^image\//.test(item.file.type)) thumb = await imageThumb(item.file);
    try {
      note = await uploadNoteAttachment(noteId, item.file, { name, thumb, source: item.source, pages: item.pages, read },
        percent => onProgress?.({ index, name, percent }));
      window.dispatchEvent(new CustomEvent(NOTE_UPDATED, { detail: note }));
    } catch (err) {
      errors.push({ name, error: err.response?.data?.error || (err.response?.status === 413 ? 'Over 25 MB' : 'Upload failed') });
    }
  }
  return { note, errors };
}

/** Open an attachment: web → new tab (PDF, audio, images inline; others download); app → the right app */
export async function openAttachment(note, att) {
  if (isNative) {
    try {
      await QuickRecorder.openFile({ url: new URL(`${API_BASE}/quick/${note.id}/attachments/${att.id}`, window.location.origin).href, name: att.name, mime: att.mime });
      return null;
    } catch (err) {
      return err?.message || 'No app can open this file';
    }
  }
  window.open(attachmentFileUrl(note.id, att.id), '_blank', 'noopener');
  return null;
}
