import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { ArrivalPermissionPrompt } from '../native/arrival';
import { Menu, Moon, Sun, Search } from 'lucide-react';
import Sidebar from './Sidebar';
import CreateMenu from './create/CreateMenu';
import { WhatsNewSheet } from './WhatsNew';
import { useApp } from '../context/AppContext';
import { useAppearance } from '../context/appearanceStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { startQueueFlusher } from '../lib/quickQueue';
import { startOpsFlusher } from '../lib/opsQueue';
import { startLiveEvents } from '../lib/liveEvents';
import { useLayout } from '../lib/layout';
import LiveToast from './LiveToast';
import UpdateBanner from './UpdateBanner';
import SearchOverlay from './search/SearchOverlay';
import { openSearch } from '../lib/uiBus';

export default function AppLayout() {
  const {
    sidebarOpen,
    mobileMenuOpen, setMobileMenuOpen,
  } = useApp();
  const { darkMode, setDarkMode } = useAppearance();
  const isMobile = useIsMobile();
  const { appName } = useLayout();
  useEffect(() => { document.title = appName; }, [appName]);

  // Send Quick Capture recordings that were queued while offline
  useEffect(() => startQueueFlusher(), []);
  // Checklist changes made offline; live updates from other people (shared lists)
  useEffect(() => startOpsFlusher(), []);
  useEffect(() => startLiveEvents(), []);

  // Toasts sit right of the sidebar (index.css .toast-stack)
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', `${isMobile ? 0 : (sidebarOpen ? 224 : 64)}px`);
  }, [isMobile, sidebarOpen]);

  // Close mobile menu when viewport becomes desktop-size
  useEffect(() => {
    if (!isMobile) setMobileMenuOpen(false);
  }, [isMobile, setMobileMenuOpen]);

  return (
    <div className="flex min-h-screen">

      {/* Mobile backdrop — blurs content behind sidebar overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar />

      <main
        className="flex-1 overflow-x-clip min-w-0 transition-all duration-300"
        style={{ marginLeft: isMobile ? 0 : (sidebarOpen ? 224 : 64) }}
      >
        {/* Mobile top bar — hidden on desktop */}
        <div className="md:hidden sticky top-0 z-30 h-14 flex items-center justify-between px-4 backdrop-blur-md bg-white/70 dark:bg-black/70 border-b border-white/20 dark:border-white/10">
          <button
            className="w-11 h-11 flex items-center justify-center text-navy-700 dark:text-white/80 rounded-xl"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={22} />
          </button>
          <span className="font-bold text-navy-900 dark:text-white text-sm tracking-tight">
            {appName}
          </span>
          <span className="flex items-center">
            <button
              className="w-11 h-11 flex items-center justify-center text-navy-600 dark:text-white/70 rounded-xl"
              onClick={openSearch}
              aria-label="Search"
              data-header-search=""
            >
              <Search size={19} />
            </button>
            <button
              className="w-11 h-11 flex items-center justify-center text-navy-600 dark:text-white/60 rounded-xl"
              onClick={() => setDarkMode(d => !d)}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode
                ? <Sun size={18} className="text-amber-500" />
                : <Moon size={18} />
              }
            </button>
          </span>
        </div>

        {/* Desktop header: global search */}
        <div className="hidden md:flex sticky top-0 z-30 h-14 items-center justify-end px-6 backdrop-blur-md bg-white/60 dark:bg-black/60 border-b border-white/20 dark:border-white/10">
          <button type="button" onClick={openSearch} data-header-search=""
            className="flex items-center gap-2 w-72 h-10 px-3.5 rounded-xl border border-navy-200 dark:border-white/15 bg-white/70 dark:bg-white/5 text-sm text-navy-400 dark:text-white/45 hover:border-gold-300">
            <Search size={16} />
            <span className="flex-1 text-left">Search everything…</span>
            <kbd className="text-[11px] rounded-md border border-navy-200 dark:border-white/15 px-1.5 py-0.5">Ctrl K</kbd>
          </button>
        </div>

        <UpdateBanner />
        <Outlet />
        <CreateMenu />
        <WhatsNewSheet />
        <ArrivalPermissionPrompt />
        <LiveToast />
        <SearchOverlay />
      </main>
    </div>
  );
}
