import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { isNative } from './lib/platform'
import { initNativeSession } from './native/nativeSession'
import { startOfflineStatus } from './lib/offline/status'

// Android app without a connection (2.9.0): Capacitor opens its error page — which is these same screens, bundled
// in the app (scripts/android-config.mjs) — at the NAS address. Go back to where the user was (or the start).
if (window.location.pathname === '/offline.html') {
  let last = '/';
  try { last = sessionStorage.getItem('pa_lastPath') || '/'; } catch { /* ignore */ }
  window.history.replaceState(null, '', last.startsWith('/') && last !== '/offline.html' ? last : '/');
}
// These screens came with the app (offline start), not from the NAS
window.PA_BUNDLED = import.meta.env.MODE === 'android';

// In the Android app, load the stored device token and the offline copy's status before the first request
Promise.all([initNativeSession(), Promise.race([startOfflineStatus(), new Promise(r => setTimeout(r, 400))])]).finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})

// Service worker (installable PWA + offline app shell). Browsers only allow
// it on HTTPS or localhost; skipped in dev so Vite's HMR isn't cached, and in
// the Android app, whose pages are bundled locally.
if (import.meta.env.PROD && !isNative && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
