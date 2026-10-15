// Android app session: the device token (kept in Keystore-backed native
// storage, mirrored in memory for API calls) and a short-lived media token
// for <audio>/attachment URLs. No-ops in the browser.
import { isNative, API_ORIGIN } from '../lib/platform';
import { QuickRecorder } from './quickRecorder';

let deviceToken = null;
let mediaToken = null;
let mediaTimer = null;

export const getDeviceToken = () => deviceToken;
export const getMediaToken  = () => mediaToken;

function pref(key) {
  try { return localStorage.getItem(key) !== 'false'; } catch { return true; }
}

/** Before the app renders: point native uploads at the server and load the stored token. */
export async function initNativeSession() {
  if (!isNative) return;
  try {
    await QuickRecorder.configure({
      apiBase: API_ORIGIN,
      feedback: pref('pa_quickFeedback'),
      volumeStop: pref('pa_volumeStop'),
      launcherToggle: pref('pa_launcherToggle'),
    });
    deviceToken = (await QuickRecorder.getToken()).token || null;
  } catch {
    deviceToken = null;
  }
}

export async function saveDeviceToken(token) {
  deviceToken = token;
  await QuickRecorder.setToken({ token });
}

export async function clearDeviceToken() {
  deviceToken = null;
  mediaToken = null;
  clearInterval(mediaTimer);
  mediaTimer = null;
  try { await QuickRecorder.clearToken(); } catch { /* ignore */ }
}

/** Fetch a media token now and every 6 h (tokens last 12 h). */
export async function startMediaTokens(fetchMediaToken) {
  if (!isNative) return;
  const refresh = async () => {
    try { mediaToken = (await fetchMediaToken()).token; } catch { /* keep the old one */ }
  };
  await refresh();
  clearInterval(mediaTimer);
  mediaTimer = setInterval(refresh, 6 * 60 * 60 * 1000);
}

/** "Sound & vibration" setting → native recorder cues. */
export function syncFeedbackPref(enabled) {
  if (isNative) QuickRecorder.configure({ feedback: enabled }).catch(() => {});
}

/** Android-only recorder settings: { volumeStop } or { launcherToggle } */
export function syncRecorderPref(values) {
  if (isNative) QuickRecorder.configure(values).catch(() => {});
}

/** Friendly name shown under Settings → Devices, e.g. "Android app · SM-S938U". */
export function deviceName() {
  // "...Android 16; SM-S938U Build/BP2A.250605.031; wv)..." → "SM-S938U"
  const model = navigator.userAgent.match(/Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/)?.[1]?.trim();
  return model && model !== 'K' ? `Android app · ${model}` : 'Android app';
}
