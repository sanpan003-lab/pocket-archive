import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, X } from 'lucide-react';
import { useAppUpdate } from '../lib/appUpdate';
import { UpdateNotes } from './AppUpdatePanel';

const LATER_KEY = 'pa_updateLater';
const laterFor = () => { try { return Number(localStorage.getItem(LATER_KEY)) || 0; } catch { return 0; } };

/** Android app: "Update 2.4.0 available · What's new" — Update / Later (Later hides it until the next version) */
export default function UpdateBanner() {
  const { state: s, start } = useAppUpdate();
  const navigate = useNavigate();
  const [later, setLater] = useState(laterFor);
  const [notes, setNotes] = useState(false);
  const latest = s?.latest;
  if (!s || !latest || latest.versionCode <= s.currentCode || later >= latest.versionCode) return null;
  if (!['available', 'downloading', 'ready', 'deferred', 'failed'].includes(s.status)) return null;
  const hide = () => { try { localStorage.setItem(LATER_KEY, String(latest.versionCode)); } catch { /* ignore */ } setLater(latest.versionCode); };

  return (
    <>
      <div className="mx-4 sm:mx-6 mt-3 rounded-2xl border border-gold-400/50 bg-gold-500/10 px-3 py-2.5 flex flex-wrap items-center gap-2" role="status">
        <Download size={16} className="text-gold-600 dark:text-gold-400 shrink-0" />
        <p className="flex-1 min-w-0 text-sm text-navy-900 dark:text-white">
          {s.status === 'downloading' ? `Downloading ${latest.versionName}… ${s.progress}%`
            : s.status === 'deferred' ? `Update ${latest.versionName} installs after this recording`
              : <>Update {latest.versionName} available · <button className="underline font-semibold" onClick={() => setNotes(true)}>What’s new</button></>}
        </p>
        {s.status !== 'downloading' && s.status !== 'deferred' && (
          <>
            <button className="btn-gold text-xs py-1.5 px-3" onClick={s.canInstall ? start : () => navigate('/settings#about')}>Update</button>
            <button className="btn-ghost text-xs py-1.5 px-2" onClick={hide} aria-label="Later"><X size={14} /> Later</button>
          </>
        )}
      </div>
      {notes && <UpdateNotes latest={latest} onClose={() => setNotes(false)} />}
    </>
  );
}
