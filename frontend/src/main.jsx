import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { isNative } from './lib/platform'
import { initNativeSession } from './native/nativeSession'

// In the Android app, load the stored device token before the first request
initNativeSession().finally(() => {
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
