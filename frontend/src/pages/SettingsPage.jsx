import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useLayout } from '../lib/layout';
import { useApp } from '../context/AppContext';
import { isNative } from '../lib/platform';
import { offlineCapable } from '../lib/offline/native';
import { CATEGORIES, CATEGORY_NAME, visibleCategories, categoryOf, lastCategory, rememberCategory } from '../lib/settingsCategories';
import { useSettingsSummaries } from '../lib/settingsSummaries';
import { findSettingElement, revealSetting, entryByKey } from '../lib/settingsIndex';
import PlacesSettings from '../components/PlacesSettings';
import SmartAppendSettings from '../components/SmartAppendSettings';
import DocumentSettings from '../components/DocumentSettings';
import AppearanceSettings from '../components/AppearanceSettings';
import RecordingSettings from '../components/RecordingSettings';
import PhoneActionsSettings from '../components/PhoneActionsSettings';
import NotificationSettings from '../components/NotificationSettings';
import ReminderAlerts from '../components/settings/ReminderAlerts';
import { AboutSection } from '../components/WhatsNew';
import SecuritySettings from '../components/SecuritySettings';
import CalendarSettings from '../components/CalendarSettings';
import SharingSettings from '../components/SharingSettings';
import UsersAdmin from '../components/UsersAdmin';
import SettingsSearch from '../components/SettingsSearch';
import OfflineSettings from '../components/offline/OfflineSettings';
import { ServerStatus, SyncInstructions } from '../components/settings/ServerSettings';
import { LayoutOnDevice, WelcomeTour, Advanced } from '../components/settings/SmallSettings';

const WIDE = '(min-width: 900px)';
function useWide() {
  return useSyncExternalStore(
    fn => { const m = window.matchMedia(WIDE); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); },
    () => window.matchMedia(WIDE).matches,
  );
}

/** What each category screen shows (every setting lives in exactly one) */
function CategoryContent({ id, lite, archive, isAdmin }) {
  switch (id) {
    case 'account': return <SecuritySettings />;
    case 'recording': return <><RecordingSettings /><PhoneActionsSettings /></>;
    case 'notes': return <><AppearanceSettings part="notes" />{!lite && <SmartAppendSettings />}</>;
    case 'places': return <><PlacesSettings /><ReminderAlerts /><CalendarSettings /></>;
    case 'documents': return <DocumentSettings />;
    case 'sharing': return <><SharingSettings /><NotificationSettings /></>;
    case 'offline': return <OfflineSettings />;
    case 'appearance': return <>{isAdmin && <LayoutOnDevice />}<AppearanceSettings part="app" /></>;
    case 'watch': return <RecordingSettings part="watch" />;
    case 'admin': return <>{!lite && <UsersAdmin />}{archive && <ServerStatus />}{archive && <Advanced><SyncInstructions /></Advanced>}</>;
    case 'about': return <><AboutSection /><Advanced><WelcomeTour /></Advanced></>;
    default: return null;
  }
}

function CategoryList({ cats, summaries, selected, onOpen }) {
  return (
    <nav aria-label="Settings categories">
      <ul className="glass-panel p-1.5 divide-y divide-navy-100/70 dark:divide-white/5" data-settings-categories="">
        {cats.map(c => (
          <li key={c.id}>
            <button type="button" onClick={() => onOpen(c.id)} data-category={c.id} aria-current={selected === c.id ? 'page' : undefined}
              className={`w-full min-h-[64px] flex items-center gap-3 px-3 py-2.5 text-left rounded-xl transition-colors ${selected === c.id ? 'bg-gold-500/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/5'}`}>
              <span className="w-10 h-10 shrink-0 rounded-xl bg-gold-500/10 flex items-center justify-center text-gold-600 dark:text-gold-400"><c.icon size={19} /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-semibold text-navy-900 dark:text-white">{c.name}</span>
                <span className="block text-xs text-navy-500 dark:text-white/50 truncate" data-summary="">{summaries[c.id] || ' '}</span>
              </span>
              <ChevronRight size={17} className="shrink-0 text-navy-300 dark:text-white/30" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Settings (2.11.0), like a phone's settings menu: search + categories with a live summary; a category opens its own
 * screen (back arrow; Android Back / swipe-back go back too). From 900 px: categories on the left, the category on the
 * right. The last category opened is remembered on this device. Old links (/settings#places …) land in the right
 * category, and search results open their category and light the setting up.
 */
export default function SettingsPage() {
  const { category } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const wide = useWide();
  const { isAdmin, user } = useApp();
  const { lite, archive } = useLayout();
  const { summaries, watchKnown } = useSettingsSummaries({ user, isAdmin, lite, archive });
  const ctx = useMemo(() => ({ lite, archive, isAdmin, isNative, offline: offlineCapable(), watch: watchKnown }), [lite, archive, isAdmin, watchKnown]);
  const cats = visibleCategories(ctx);
  // A direct link to Watch works before we know a watch was seen
  const allowed = id => visibleCategories({ ...ctx, watch: true }).some(c => c.id === id);

  // /settings#places (old links, notifications, fix-its) → /settings/places#places
  useEffect(() => {
    const section = location.hash.slice(1);
    if (!section) return;
    const cat = categoryOf(section);
    if (cat && cat !== category) navigate(`/settings/${cat}${location.hash}`, { replace: true, state: location.state });
  }, [location.hash, category, navigate, location.state]);

  // Unknown or not for this account → the list
  useEffect(() => {
    if (category && !allowed(category)) navigate('/settings', { replace: true });
  });  

  // Wide screens always show a category: the last one opened here, else the first
  useEffect(() => {
    if (!wide || category || location.hash) return;
    const last = lastCategory();
    navigate(`/settings/${last && allowed(last) ? last : cats[0]?.id || 'account'}`, { replace: true });
  });  

  useEffect(() => { if (category && allowed(category)) rememberCategory(category); });  

  // After opening a category: the setting from a search result, or the #section from a link
  useEffect(() => {
    if (!category) return undefined;
    const want = location.state?.reveal ? entryByKey(location.state.reveal) : null;
    const section = location.hash.slice(1);
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (want) {
        if (findSettingElement(want)) { clearInterval(t); revealSetting(want); }
      } else if (section) {
        const el = document.getElementById(section);
        if (el) { clearInterval(t); el.scrollIntoView({ block: 'start' }); }
      } else { clearInterval(t); window.scrollTo(0, 0); }
      if (tries > 40) { // settings that load from the phone can take a moment
        clearInterval(t);
        if (want) window.dispatchEvent(new CustomEvent('pa:settings-missing', { detail: { title: want.title } }));
      }
    }, 120);
    return () => clearInterval(t);
  }, [category, location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = id => navigate(`/settings/${id}`, { replace: wide && !!category });
  const back = () => {
    if ((window.history.state?.idx ?? 0) > 0 && !wide) navigate(-1);
    else navigate('/settings', { replace: true });
  };
  const current = category && allowed(category) ? category : null;

  const header = current && (
    <div className="flex items-center gap-2 mb-3">
      {!wide && (
        <button type="button" onClick={back} aria-label="Back to Settings" data-settings-back=""
          className="w-11 h-11 -ml-2 shrink-0 flex items-center justify-center rounded-xl text-navy-700 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10">
          <ArrowLeft size={21} />
        </button>
      )}
      <h1 className="text-xl sm:text-2xl font-bold text-navy-900 dark:text-white">{CATEGORY_NAME[current]}</h1>
    </div>
  );
  const body = current && <CategoryContent id={current} lite={lite} archive={archive} isAdmin={isAdmin} />;
  const subtitle = archive ? 'Your account, app and server settings' : 'Your account and app settings';
  const search = <SettingsSearch categories={cats.map(c => c.id)} />;

  if (wide) {
    return (
      <div className="p-6 max-w-6xl mx-auto" data-settings-wide="">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white mb-1">Settings</h1>
        <p className="text-sm text-navy-600 dark:text-white/60 mb-3">{subtitle}</p>
        {search}
        <div className="grid grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-6 items-start">
          <div className="sticky top-[8.5rem]"><CategoryList cats={cats} summaries={summaries} selected={current} onOpen={open} /></div>
          {current && <section key={current} aria-label={CATEGORY_NAME[current]} className="min-w-0" data-category-screen={current}>{header}{body}</section>}
        </div>
      </div>
    );
  }

  // Phone: the list, or one category (back arrow + title on top, then the search, then its settings)
  if (current) {
    return (
      <section key={current} aria-label={CATEGORY_NAME[current]} className="p-4 sm:p-6 max-w-2xl mx-auto note-anim-right" data-settings-narrow="" data-category-screen={current}>
        {header}
        {search}
        {body}
      </section>
    );
  }
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto" data-settings-narrow="">
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Settings</h1>
        <p className="text-sm text-navy-600 dark:text-white/60 mt-1">{subtitle}</p>
      </div>
      {search}
      <CategoryList cats={cats} summaries={summaries} selected={null} onOpen={open} />
    </div>
  );
}

export { CATEGORIES };
