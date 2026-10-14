import { useEffect, useState } from 'react';
import { Mic, Bell, Mic2, Settings } from 'lucide-react';
import { isNative } from '../lib/platform';
import { QuickRecorder } from './quickRecorder';

const INTRO_DONE_KEY = 'pa_permissionsIntroDone';

function introDone() {
  try { return localStorage.getItem(INTRO_DONE_KEY) === '1'; } catch { return false; }
}
function markIntroDone() {
  try { localStorage.setItem(INTRO_DONE_KEY, '1'); } catch { /* ignore */ }
}

function Reason({ icon: Icon, title, text }) {
  return (
    <div className="flex gap-3 text-left">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(245,158,11,0.15)' }}>
        <Icon size={20} className="text-gold-500" />
      </div>
      <div>
        <p className="font-semibold text-white">{title}</p>
        <p className="text-sm text-white/60 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

/**
 * First launch of the Android app: explain and request microphone +
 * notification permissions before showing the app. Browser: renders children.
 */
export default function PermissionGate({ children }) {
  const [state, setState] = useState(() => (isNative && !introDone() ? 'checking' : 'done'));
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (state !== 'checking') return;
    QuickRecorder.checkPermissions()
      .then(p => setState(p.microphone === 'granted' && p.notifications === 'granted' ? 'done' : 'ask'))
      .catch(() => setState('done'));
  }, [state]);

  async function allow() {
    try {
      const p = await QuickRecorder.requestPermissions();
      if (p.microphone === 'granted') {
        markIntroDone();
        setState('done');
      } else {
        setDenied(true);
      }
    } catch {
      setDenied(true);
    }
  }

  function skip() {
    markIntroDone();
    setState('done');
  }

  if (state === 'done') return children;
  if (state === 'checking') return <div className="min-h-screen" style={{ background: '#0F172A' }} />;

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0F172A' }}>
      <div className="w-full max-w-sm text-center animate-slide-up">
        <div className="w-16 h-16 rounded-3xl bg-gold-gradient flex items-center justify-center shadow-gold mx-auto mb-5">
          <Mic2 size={30} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Welcome to Pocket Archive</h1>
        <p className="text-sm text-white/60 mb-7">Two quick permissions so voice notes work hands-free:</p>

        <div className="space-y-5 mb-8">
          <Reason icon={Mic} title="Microphone" text="To record voice notes — even with the screen off or from the widget and Quick Settings tile." />
          <Reason icon={Bell} title="Notifications" text="To show “Recording… tap to stop” and confirm when a note is saved." />
        </div>

        {denied && (
          <p className="text-sm text-amber-300 mb-4">
            Microphone access is off. You can turn it on in Android settings anytime.
          </p>
        )}

        <button className="btn-gold w-full justify-center py-3.5 text-base font-semibold rounded-2xl" onClick={denied ? () => QuickRecorder.openAppSettings() : allow}>
          {denied ? <><Settings size={18} /> Open settings</> : 'Allow'}
        </button>
        <button className="w-full mt-3 py-3 text-sm font-medium text-white/60 hover:text-white/90" onClick={skip}>
          {denied ? 'Continue' : 'Not now'}
        </button>
      </div>
    </div>
  );
}
