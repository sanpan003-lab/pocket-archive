import { useCallback, useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import {
  X, Check, ChevronLeft, ChevronRight, KeyRound, ShieldCheck, Home, Smartphone, CalendarDays, Sparkles,
  Mic, Bell, MapPin, Crosshair, BatteryFull, LayoutGrid, Users, BellRing, Loader2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useLayout } from '../lib/layout';
import { isNative } from '../lib/platform';
import { updateMe, getPlaces, setHomeLocation } from '../lib/api';
import { setHomeFromAddress, findAddress } from '../lib/placeLookup';
import { currentPosition } from '../lib/geolocate';
import { QuickRecorder } from '../native/quickRecorder';
import { syncErrands } from '../native/errands';
import { PasswordBlock, TwoFactorBlock } from './SecuritySettings';
import CalendarSettings from './CalendarSettings';
import { OPEN_WELCOME as OPEN_EVENT } from '../lib/uiBus';


const INPUT = 'w-full bg-navy-50/50 dark:bg-white/5 border border-navy-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-gold-400/50';

function StepTitle({ icon: Icon, title, optional, children }) {
  return (
    <div className="mb-4">
      <h2 className="flex items-center gap-2 text-xl font-bold text-navy-900 dark:text-white">
        <Icon size={22} className="text-gold-500 shrink-0" /> {title}
        {optional && <span className="text-xs font-semibold text-navy-400 dark:text-white/40 uppercase tracking-wider">optional</span>}
      </h2>
      {children && <p className="text-sm text-navy-600 dark:text-white/60 mt-1.5">{children}</p>}
    </div>
  );
}

// ── 1. Password ──────────────────────────────────────────────────────────
function PasswordStep() {
  const [change, setChange] = useState(false);
  return (
    <>
      <StepTitle icon={KeyRound} title="Your password">Only you know it. The admin can reset it, but never see it.</StepTitle>
      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400 mb-3"><Check size={17} /> Your own password is set.</p>
      {change ? <PasswordBlock /> : <button className="btn-ghost text-sm" onClick={() => setChange(true)}>Change it</button>}
    </>
  );
}

// ── 2. Two-step verification ─────────────────────────────────────────────
function TwoFactorStep() {
  return (
    <>
      <StepTitle icon={ShieldCheck} title="Two-step verification" optional>
        Extra protection for your account. You can also turn it on later in Settings → Security.
      </StepTitle>
      <TwoFactorBlock />
    </>
  );
}

// ── 3. Home ──────────────────────────────────────────────────────────────
function HomeStep() {
  const [home, setHome] = useState(undefined);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { getPlaces().then(p => setHome(p.home || null)).catch(() => setHome(null)); }, []);

  async function run(kind, fn) {
    setBusy(kind); setMsg(null);
    try { await fn(); const p = await getPlaces(); setHome(p.home || null); setAddress(''); setMsg({ ok: 'Home saved.' }); syncErrands(); }
    catch (err) { setMsg({ error: err.response?.data?.error || err.message || 'Could not save' }); }
    finally { setBusy(null); }
  }
  const useMyLocation = () => run('gps', async () => {
    const pos = await currentPosition();
    let found = null;
    try { found = (await findAddress(pos.lat, pos.lng)).address || null; } catch { /* save the spot anyway */ }
    await setHomeLocation({ lat: pos.lat, lng: pos.lng, accuracyM: pos.accuracy, source: isNative ? 'phone' : 'browser', address: found });
  });

  return (
    <>
      <StepTitle icon={Home} title="Your home">
        So “the Publix” means the one near you, and “when I get home” reminders work. It stays on your account; nobody else sees it.
      </StepTitle>
      {home && <p className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400 mb-3"><Check size={17} className="shrink-0 mt-0.5" /> <span className="break-words">{home.address || 'Home is set'}</span></p>}
      <form className="flex gap-2 mb-2" onSubmit={e => { e.preventDefault(); if (address.trim()) run('address', () => setHomeFromAddress(address.trim())); }}>
        <input className={INPUT} placeholder="Street address or ZIP code" value={address} onChange={e => setAddress(e.target.value)} aria-label="Home address" />
        <button className="btn-gold text-sm shrink-0" disabled={!address.trim() || !!busy}>{busy === 'address' ? 'Saving…' : 'Save'}</button>
      </form>
      <button className="btn-white text-sm" onClick={useMyLocation} disabled={!!busy}>
        {busy === 'gps' ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />} Use my current location
      </button>
      {msg && <p className={`text-xs mt-2 ${msg.error ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`} role="status">{msg.error || msg.ok}</p>}
    </>
  );
}

// ── 4. Permissions (Android app) ─────────────────────────────────────────
function PermRow({ icon: Icon, title, text, ok, action, onAction }) {
  return (
    <li className="flex items-start gap-3 p-3 rounded-xl border border-navy-100 dark:border-white/10">
      <Icon size={19} className={`shrink-0 mt-0.5 ${ok ? 'text-emerald-500' : 'text-gold-500'}`} />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-navy-900 dark:text-white">{title}</span>
        <span className="block text-xs text-navy-500 dark:text-white/50">{text}</span>
      </span>
      {ok ? <Check size={18} className="text-emerald-500 shrink-0 mt-0.5" aria-label="Allowed" />
        : <button className="btn-gold text-xs shrink-0" onClick={onAction}>{action}</button>}
    </li>
  );
}

function PermissionsStep() {
  const [p, setP] = useState(null);
  const load = useCallback(() => {
    Promise.all([QuickRecorder.checkPermissions(), QuickRecorder.getLocationStatus()])
      .then(([perm, loc]) => setP({ ...perm, loc }))
      .catch(() => setP(null));
  }, []);
  useEffect(() => {
    if (!isNative) return undefined;
    load();
    const sub = CapApp.addListener('resume', load);
    return () => { sub.then(h => h.remove()); };
  }, [load]);

  if (!isNative) {
    return (
      <>
        <StepTitle icon={Smartphone} title="On your phone">
          Install the Android app and sign in there. It asks for the microphone, notifications, location “all the time”, precise location and an unrestricted battery, so voice notes, the widget and arrival reminders work.
        </StepTitle>
      </>
    );
  }
  const after = fn => async () => { try { await fn(); } catch { /* user said no */ } setTimeout(load, 600); };
  const loc = p?.loc || {};
  return (
    <>
      <StepTitle icon={Smartphone} title="Permissions">Tap each one. Location never leaves your phone; it only arms reminders.</StepTitle>
      {!p ? <div className="h-40 rounded-xl bg-black/5 dark:bg-white/5 animate-pulse" /> : (
        <ul className="space-y-2">
          <PermRow icon={Mic} title="Microphone" text="Voice notes, also from the widget, tile and side key." ok={p.microphone === 'granted'} action="Allow"
            onAction={after(async () => { const r = await QuickRecorder.requestPermissions(); if (r.microphone !== 'granted') await QuickRecorder.openAppSettings(); })} />
          <PermRow icon={Bell} title="Notifications" text="“Saved”, arrival reminders and changes on shared lists." ok={p.notifications === 'granted'} action="Allow"
            onAction={after(async () => { const r = await QuickRecorder.requestNotifications(); if (r.notifications !== 'granted') await QuickRecorder.openNotificationSettings({}); })} />
          <PermRow icon={MapPin} title="Location: Allow all the time" text="Reminders when you arrive at a store or get home." ok={loc.location?.foreground === 'granted' && loc.location?.background === 'granted'} action="Allow"
            onAction={after(async () => {
              let s = await QuickRecorder.requestLocation();
              if (s.foreground === 'granted' && s.background !== 'granted') s = await QuickRecorder.requestBackgroundLocation();
              if (s.foreground !== 'granted' && s.foreground !== 'prompt') await QuickRecorder.openAppSettings();
              syncErrands();
            })} />
          <PermRow icon={Crosshair} title="Precise location" text="Small places (a store, your home) need it. App settings → Location → Use precise location." ok={!!loc.precise} action="Open"
            onAction={after(() => QuickRecorder.openAppSettings())} />
          <PermRow icon={BatteryFull} title="Battery: Unrestricted" text="So Android doesn’t pause reminders and uploads. App settings → Battery → Unrestricted." ok={!!loc.batteryUnrestricted} action="Open"
            onAction={after(() => QuickRecorder.openShortcutSetup({ target: 'battery' }))} />
        </ul>
      )}
    </>
  );
}

// ── 5. Google Calendar ───────────────────────────────────────────────────
function CalendarStep() {
  return (
    <>
      <StepTitle icon={CalendarDays} title="Google Calendar" optional>
        Events and dated reminders you capture can go to your own Google Calendar. Share your calendar with the address below, paste its ID, and tap Test.
      </StepTitle>
      <div className="-mx-1"><CalendarSettings /></div>
    </>
  );
}

// ── 6. Tour ──────────────────────────────────────────────────────────────
const CARDS = [
  { icon: Mic, title: 'Capture', text: 'Tap the mic and just talk: “I need milk and eggs from Publix”, “dentist Tuesday at 3”, “remind me to call Mom tonight”. It becomes a list, an event or a reminder by itself. Or tap + to type, make a checklist, take a photo or draw.' },
  { icon: LayoutGrid, title: 'Widget & tile', text: 'Long-press your home screen → Widgets → Pocket for one-tap recording and your latest notes. Swipe down twice → edit tiles → add “Quick Capture” to record from anywhere, even the lock screen.' },
  { icon: Users, title: 'Lists & sharing', text: 'Open a list → Share with… → Can edit. You both add and check things off and see each other’s changes right away. Say “add yogurt to the Publix list” and it lands on the shared list.' },
  { icon: BellRing, title: 'Location reminders', text: 'Say “when I get to Target remind me to buy batteries” or “when I get home…”. Your phone reminds you when you arrive, with your list. Lists for a store pop up there too.' },
];
function TourStep() {
  const [i, setI] = useState(0);
  const c = CARDS[i];
  return (
    <>
      <StepTitle icon={Sparkles} title="Quick tour" />
      <div className="rounded-2xl p-5 bg-gold-500/10 border border-gold-400/40 min-h-[13rem]">
        <c.icon size={28} className="text-gold-500 mb-2" />
        <p className="font-bold text-lg text-navy-900 dark:text-white mb-1">{c.title}</p>
        <p className="text-sm text-navy-700 dark:text-white/75 leading-relaxed">{c.text}</p>
      </div>
      <div className="flex items-center justify-between mt-3">
        <button className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30" onClick={() => setI(i - 1)} disabled={i === 0} aria-label="Previous card"><ChevronLeft size={20} /></button>
        <div className="flex gap-1.5" aria-label={`Card ${i + 1} of ${CARDS.length}`}>
          {CARDS.map((_, k) => <span key={k} className={`w-2 h-2 rounded-full ${k === i ? 'bg-gold-500' : 'bg-navy-200 dark:bg-white/20'}`} />)}
        </div>
        <button className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30" onClick={() => setI(i + 1)} disabled={i === CARDS.length - 1} aria-label="Next card"><ChevronRight size={20} /></button>
      </div>
    </>
  );
}

const STEPS = [
  { key: 'password', label: 'Password', C: PasswordStep },
  { key: '2fa', label: 'Two-step', C: TwoFactorStep },
  { key: 'home', label: 'Home', C: HomeStep },
  { key: 'permissions', label: 'Permissions', C: PermissionsStep },
  { key: 'calendar', label: 'Calendar', C: CalendarStep },
  { key: 'tour', label: 'Tour', C: TourStep },
];

/**
 * First sign-in walkthrough (new accounts, Lite and Full): password, optional 2FA, home, permissions,
 * optional Google Calendar, a 4-card tour. Skippable; Settings → Welcome tour opens it again.
 */
export default function Welcome() {
  const { user, refreshUser } = useApp();
  const { appName } = useLayout();
  const [manual, setManual] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [step, setStep] = useState(-1); // -1 = hello
  const open = manual || (!!user?.welcomePending && !dismissed);

  useEffect(() => {
    const onOpen = () => { setStep(-1); setManual(true); };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  async function finish() {
    setManual(false);
    setDismissed(true);
    if (user?.welcomePending) {
      try { await updateMe({ welcomeDone: true }); await refreshUser(); } catch { /* shows again next time */ }
    }
  }

  if (!open) return null;
  const S = step >= 0 ? STEPS[step] : null;
  const first = (user?.displayName || user?.username || '').split(' ')[0];

  return (
    <div className="fixed inset-0 z-[260] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="glass-panel w-full sm:max-w-lg h-[92dvh] sm:h-auto sm:max-h-[90vh] flex flex-col rounded-b-none sm:rounded-b-2xl animate-slide-up">
        <div className="flex items-center gap-2 px-5 pt-4 pb-2">
          {S ? (
            <div className="flex-1 flex gap-1" aria-label={`Step ${step + 1} of ${STEPS.length}: ${S.label}`}>
              {STEPS.map((x, k) => <span key={x.key} className={`h-1.5 flex-1 rounded-full ${k <= step ? 'bg-gold-500' : 'bg-navy-200 dark:bg-white/15'}`} />)}
            </div>
          ) : <span className="flex-1" />}
          <button className="h-10 px-3 rounded-xl text-sm font-semibold text-navy-500 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10" onClick={finish} aria-label="Skip the welcome tour">
            Skip <X size={15} className="inline -mt-0.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {S ? <S.C /> : (
            <div className="pt-6 text-center">
              <div className="w-16 h-16 rounded-3xl bg-brand-gradient flex items-center justify-center shadow-brand mx-auto mb-4">
                <Mic size={30} className="text-white" />
              </div>
              <h2 className="text-2xl font-bold text-navy-900 dark:text-white mb-2">Welcome to {appName}{first ? `, ${first}` : ''}!</h2>
              <p className="text-sm text-navy-600 dark:text-white/60 max-w-sm mx-auto">
                A few steps to set things up: your password, optional two-step verification, your home, your phone’s permissions, optional Google Calendar, and a quick tour. Skip anything; it’s all in Settings later.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-navy-100 dark:border-white/10">
          {step >= 0 && <button className="btn-ghost" onClick={() => setStep(step - 1)}><ChevronLeft size={16} /> Back</button>}
          {step < STEPS.length - 1
            ? <button className="btn-gold flex-1 justify-center" onClick={() => setStep(step + 1)}>{step < 0 ? 'Get started' : 'Next'} <ChevronRight size={16} /></button>
            : <button className="btn-gold flex-1 justify-center" onClick={finish}><Check size={16} /> Done</button>}
        </div>
      </div>
    </div>
  );
}
