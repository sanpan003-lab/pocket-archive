import { useEffect, useState } from 'react';
import { Check, Info, Mic, Square } from 'lucide-react';
import { useAppearance } from '../context/appearanceStore';
import { isNative } from '../lib/platform';
import { QuickRecorder } from '../native/quickRecorder';

const TILES = [
  { value: 'dark', label: 'Dark', hint: 'Default' },
  { value: 'light', label: 'Light', hint: 'Soft purple glow' },
  { value: 'amoled', label: 'AMOLED', hint: 'Pure black' },
];

// Generic neighbors on the pretend home screen
const NEIGHBORS = ['#22C55E', '#3B82F6', '#F97316'];

/**
 * Settings → Appearance & layout → App icon: the Purple Neon Bolt on a Dark, Light or AMOLED tile,
 * with a live home-screen preview. In the Android app it switches the launcher icon (and the Quick
 * Record / Stop Recording icons); on the web it changes the browser tab icon.
 */
export default function AppIconPicker() {
  const { settings, update } = useAppearance();
  const [nativeTile, setNativeTile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const tile = (isNative && nativeTile) || settings.icon?.tile || 'dark';

  useEffect(() => {
    if (!isNative) return;
    QuickRecorder.getAppIcon().then(r => setNativeTile(r.tile)).catch(() => {});
  }, []);

  async function choose(value) {
    if (value === tile || busy) return;
    setMsg(null);
    update('icon', 'tile', value); // the browser tab icon follows
    if (!isNative) return;
    setBusy(true);
    try {
      const r = await QuickRecorder.setAppIcon({ tile: value });
      setNativeTile(r.tile);
      setMsg('Icon changed. If the old icon is still on your home screen, remove it and add Pocket Archive again from the app drawer. If your side key or a Routine opens Quick Record or Stop Recording, pick them again there.');
    } catch (err) {
      setMsg(err.message || 'Could not change the icon');
    } finally {
      setBusy(false);
    }
  }

  const wallpaper = 'linear-gradient(160deg, #1E1B4B 0%, #312E81 45%, #0F172A 100%)';

  return (
    <div className="pt-2">
      {/* Live home-screen preview */}
      <div className="rounded-2xl p-4 mb-3" style={{ background: wallpaper }} aria-label="Home screen preview">
        <div className="grid grid-cols-4 gap-3 max-w-xs mx-auto">
          {NEIGHBORS.map(c => (
            <div key={c} className="flex flex-col items-center gap-1" aria-hidden="true">
              <span className="w-12 h-12 rounded-[14px] opacity-80" style={{ background: c }} />
              <span className="h-1.5 w-8 rounded bg-white/30" />
            </div>
          ))}
          <div className="flex flex-col items-center gap-1">
            <img src={`/icons/app-icon-${tile}-192.png`} alt="Pocket Archive icon" className="w-12 h-12" />
            <span className="text-[10px] font-medium text-white/90 truncate max-w-[4.5rem]">Pocket Archive</span>
          </div>
        </div>
        <div className="flex justify-center gap-6 mt-4" aria-hidden="true">
          <span className="relative">
            <img src={`/icons/app-icon-${tile}-192.png`} alt="" className="w-10 h-10" />
            <span className="absolute -right-1 -bottom-1 w-4 h-4 rounded-full bg-white flex items-center justify-center"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /></span>
          </span>
          <span className="relative">
            <img src={`/icons/app-icon-${tile}-192.png`} alt="" className="w-10 h-10" />
            <span className="absolute -right-1 -bottom-1 w-4 h-4 rounded-full bg-white flex items-center justify-center"><Square size={8} className="fill-navy-900 text-navy-900" /></span>
          </span>
        </div>
        <p className="text-center text-[10px] text-white/55 mt-1.5 inline-flex w-full justify-center gap-1"><Mic size={10} /> Quick Record · Stop Recording</p>
      </div>

      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="App icon tile">
        {TILES.map(t => {
          const selected = tile === t.value;
          return (
            <button key={t.value} type="button" role="radio" aria-checked={selected} disabled={busy}
              onClick={() => choose(t.value)}
              className={`relative rounded-2xl border p-2.5 flex flex-col items-center gap-1.5 transition-colors ${selected ? 'border-gold-500 ring-2 ring-gold-400/40 bg-gold-500/5' : 'border-navy-100 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'}`}>
              <img src={`/icons/app-icon-${t.value}-192.png`} alt="" className="w-14 h-14" />
              <span className="text-sm font-semibold text-navy-900 dark:text-white">{t.label}</span>
              <span className="text-[11px] text-navy-500 dark:text-white/50">{t.hint}</span>
              {selected && <Check size={14} className="absolute top-2 right-2 text-gold-600 dark:text-gold-400" />}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-navy-500 dark:text-white/50 mt-2 inline-flex gap-1.5">
        <Info size={13} className="shrink-0 mt-0.5" />
        {isNative
          ? 'Changes the home screen icon, Quick Record and Stop Recording. Your launcher may need a moment to update.'
          : 'Changes the browser tab icon. In the Android app it also changes the home screen icon.'}
      </p>
      {msg && <p className="mt-2 text-xs rounded-xl bg-gold-500/10 px-3 py-2 text-navy-800 dark:text-white/85" role="status">{msg}</p>}
    </div>
  );
}
