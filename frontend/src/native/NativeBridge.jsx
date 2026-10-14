import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { isNative } from '../lib/platform';
import { QuickRecorder } from './quickRecorder';

/**
 * Android-only glue: hardware back button navigates back in the app, and
 * launches from shortcuts / notifications ("/quick", "/quick/inbox") open the
 * right page. Renders nothing; does nothing in the browser.
 */
export default function NativeBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    const handles = [];
    const keep = promise => promise.then(h => (cancelled ? h.remove() : handles.push(h)));

    keep(CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else CapApp.minimizeApp();
    }));
    keep(QuickRecorder.addListener('navigate', ({ route }) => {
      if (route) navigate(route);
    }));
    QuickRecorder.getLaunchRoute()
      .then(({ route }) => { if (route && !cancelled) navigate(route, { replace: true }); })
      .catch(() => {});

    return () => {
      cancelled = true;
      handles.forEach(h => h.remove());
    };
  }, [navigate]);

  return null;
}
