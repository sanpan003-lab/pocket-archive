import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const MIME = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif' };

/**
 * Android app: system camera ('camera') or photo picker ('photos').
 * explain(kind) shows why the permission is needed and resolves true to continue.
 * Returns a Blob, or null when cancelled.
 */
export async function pickNativePhoto(source, explain) {
  const key = source === 'camera' ? 'camera' : 'photos';
  let state = 'granted';
  try { state = (await Camera.checkPermissions())[key]; } catch { /* web fallback: no permission API */ }
  if (state !== 'granted' && state !== 'limited') {
    if (!(await explain(key))) return null;
    const res = await Camera.requestPermissions({ permissions: [key] });
    if (res[key] !== 'granted' && res[key] !== 'limited') {
      throw Object.assign(new Error(key === 'camera'
        ? 'Camera access is off — allow it in Android Settings → Apps → Pocket Archive → Permissions'
        : 'Photo access is off — allow it in Android Settings → Apps → Pocket Archive → Permissions'), { code: 'DENIED' });
    }
  }
  try {
    const photo = await Camera.getPhoto({
      source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      resultType: CameraResultType.Base64,
      quality: 85,
      width: 2400,
      correctOrientation: true,
      saveToGallery: false,
    });
    const mime = MIME[(photo.format || 'jpeg').toLowerCase()] || 'image/jpeg';
    return base64ToBlob(photo.base64String, mime);
  } catch (err) {
    if (/cancel/i.test(err?.message || '')) return null;
    throw err;
  }
}
