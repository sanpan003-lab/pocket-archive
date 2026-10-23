import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { isNative } from './platform';
import { passkeyRegisterOptions, savePasskey, passkeyLoginOptions, passkeyLoginVerify } from './api';

// Passkeys on the web (2.7.0): fingerprint, Windows Hello, a phone… verified by your own server (WebAuthn).
// Not in the Android app's WebView (it uses the app lock instead).

export const passkeysSupported = () => !isNative && typeof window !== 'undefined' && browserSupportsWebAuthn();

/** A sensible default name: "Windows Hello · Edge", "iPhone · Safari", "Android · Chrome" */
export function defaultPasskeyName(ua = navigator.userAgent) {
  const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows Hello'
    : /Mac OS X/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'This device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

/** Friendly words for the browser's WebAuthn errors */
export function passkeyError(err, fallback = 'The passkey didn’t work') {
  const name = err?.name || err?.cause?.name;
  if (name === 'NotAllowedError' || /cancel|abort|timed out/i.test(err?.message || '')) return null; // cancelled
  if (name === 'InvalidStateError') return 'This device already has a passkey for your account';
  if (name === 'SecurityError') return 'Passkeys need the server’s https address';
  return err?.response?.data?.error || fallback;
}

/** Settings → Security → "Add a passkey" */
export async function addPasskey(name) {
  const optionsJSON = await passkeyRegisterOptions();
  const response = await startRegistration({ optionsJSON });
  return savePasskey(response, name);
}

/** Sign-in page → "Sign in with a passkey" → { user, mustChangePassword } (a session cookie is set) */
export async function signInWithPasskey(installed = false) {
  const optionsJSON = await passkeyLoginOptions();
  const response = await startAuthentication({ optionsJSON });
  return passkeyLoginVerify(response, installed);
}
