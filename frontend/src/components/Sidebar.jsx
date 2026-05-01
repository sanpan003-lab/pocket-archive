import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Mic2, LayoutDashboard, Search, Star, Settings,
  ChevronLeft, ChevronRight, Moon, Sun, RefreshCw, Check, AlertCircle,
  Sparkles, Mic, Calendar, BookOpen, LogOut, Trash2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { getStats, triggerSync, getSyncStatus } from '../lib/api';

// ── Top nav (always visible) ──────────────────────────────────────────────
const TOP_NAV = [
  { to: '/',          icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/search',    icon: Search,           label: 'Search'              },
  { to: '/favorites', icon: Star,             label: 'Favorites'           },
];

// ── Library nav (filter pages) ────────────────────────────────────────────
const LIBRARY_NAV = [
  { to: '/ai-notes',        icon: Sparkles,  label: 'AI Notes',    countKey: 'withAiNotes'       },
  { to: '/recordings-list', icon: Mic,       label: 'Recordings',  countKey: 'withAudio'         },
  { to: '/calendar',        icon: Calendar,  label: 'Calendar',    countKey: null                },
  { to: '/summaries',       icon: BookOpen,  label: 'Hey Pocket',  countKey: 'withOriginalNotes' },
];

function CountBadge({ count, visible }) {
  if (!visible || !count) return null;
  return (
    <span
      className="ml-auto text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0"
      style={{ background: 'rgba(245,158,11,0.15)', color: '#D97706', minWidth: 20, textAlign: 'center' }}
    >
      {count}
    </span>
  );
}

function timeAgo(date) {
  if (!date) return null;
  const mins = Math.floor((Date.now() - date) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hr ago' : `${hrs} hrs ago`;
}

// ── Sync button: fire-and-forget + polling ────────────────────────────────
// state machine: 'idle' | 'loading' | 'success' | 'error'
function useSyncButton(triggerRefresh) {
  const [state, setState]               = useState('idle');
  const [errMsg, setErrMsg]             = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const pollRef    = useRef(null);
  const timeoutRef = useRef(null);

  function stopPolling() {
    if (pollRef.current)    { clearInterval(pollRef.current);  pollRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }

  useEffect(() => () => stopPolling(), []);

  function startPolling() {
    pollRef.current = setInterval(async () => {
      try {
        const status = await getSyncStatus();
        if (!status.running) {
          stopPolling();
          if (status.lastResult === 'success') {
            setLastSyncedAt(new Date());
            setState('success');
            setTimeout(() => { setState('idle'); triggerRefresh(); }, 3000);
          } else {
            setErrMsg(status.lastError || 'Sync failed');
            setState('error');
          }
        }
      } catch {
        // network hiccup — keep polling until timeout fires
      }
    }, 3000);

    timeoutRef.current = setTimeout(() => {
      stopPolling();
      setErrMsg('Sync is taking longer than expected — check server logs');
      setState('error');
    }, 10 * 60 * 1000);
  }

  async function run() {
    setState('loading');
    setErrMsg('');
    try {
      await triggerSync();
      startPolling();
    } catch (err) {
      setErrMsg(err.response?.data?.error || err.message || 'Sync failed to start');
      setState('error');
    }
  }

  return { state, errMsg, run, clearError: () => setState('idle'), lastSyncedAt };
}

export default function Sidebar() {
  const {
    sidebarOpen, setSidebarOpen,
    darkMode, setDarkMode,
    triggerRefresh, logout,
    mobileMenuOpen, setMobileMenuOpen,
  } = useApp();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [counts, setCounts] = useState({});
  const sync = useSyncButton(triggerRefresh);

  useEffect(() => {
    getStats()
      .then(s => setCounts(s))
      .catch(() => {});
  }, []);

  const W = isMobile ? 280 : (sidebarOpen ? 224 : 64);
  const showLabels = isMobile ? true : sidebarOpen;

  function closeMobileMenu() {
    if (isMobile) setMobileMenuOpen(false);
  }

  // Mobile: frosted glass overlay; Desktop: uses glass-sidebar CSS class
  const mobileGlassStyle = isMobile ? {
    background: darkMode ? 'rgba(10,10,10,0.85)' : 'rgba(255,255,255,0.88)',
    backdropFilter: 'blur(40px) saturate(200%)',
    WebkitBackdropFilter: 'blur(40px) saturate(200%)',
    borderRight: '1px solid rgba(255,255,255,0.15)',
  } : {};

  return (
    <aside
      className="glass-sidebar fixed top-0 left-0 h-full flex flex-col overflow-hidden transition-all duration-300"
      style={{
        width: W,
        zIndex: 50,
        transform: isMobile
          ? (mobileMenuOpen ? 'translateX(0)' : 'translateX(-100%)')
          : 'none',
        ...mobileGlassStyle,
      }}
    >
      {/* ── Branding ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-5 shrink-0">
        <div className="w-8 h-8 rounded-xl bg-gold-gradient flex items-center justify-center shrink-0 shadow-gold">
          <Mic2 size={16} className="text-white" />
        </div>
        {showLabels && (
          <span className="font-bold text-navy-900 dark:text-white text-sm leading-tight whitespace-nowrap animate-fade-in">
            Pocket<br />Archive
          </span>
        )}
      </div>

      <div className="divider mx-3 mb-2" />

      {/* ── Scrollable nav area ────────────────────────────────────────────── */}
      <nav className="flex flex-col gap-0.5 px-2 flex-1 overflow-y-auto">
        {TOP_NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title={!showLabels ? label : undefined}
            onClick={closeMobileMenu}
          >
            <Icon size={18} className="shrink-0" />
            {showLabels && <span className="animate-fade-in">{label}</span>}
          </NavLink>
        ))}

        {showLabels && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-navy-400 dark:text-white/30 px-3 pt-4 pb-1 animate-fade-in">
            Library
          </p>
        )}
        {!showLabels && <div className="divider mx-2 my-2" />}

        {LIBRARY_NAV.map(({ to, icon: Icon, label, countKey }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title={!showLabels ? label : undefined}
            onClick={closeMobileMenu}
          >
            <Icon size={18} className="shrink-0" />
            {showLabels && (
              <>
                <span className="animate-fade-in flex-1">{label}</span>
                <CountBadge count={countKey ? counts[countKey] : null} visible={showLabels} />
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Bottom actions ─────────────────────────────────────────────────── */}
      <div className="px-2 pb-4 flex flex-col gap-1.5 shrink-0">
        <div className="divider mb-1" />

        {/* Sync Now */}
        <button
          className="btn-gold w-full justify-center transition-all"
          style={{
            padding: showLabels ? '9px 18px' : '9px 0',
            ...(sync.state === 'success' ? {
              background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
              boxShadow: '0 4px 12px rgba(16,185,129,0.30)',
            } : {}),
          }}
          title={
            sync.state === 'loading' ? 'Syncing…' :
            sync.state === 'success' ? 'Synced!' :
            sync.state === 'error'   ? sync.errMsg :
            'Run pocket_sync.py'
          }
          onClick={sync.state === 'idle' || sync.state === 'error' ? sync.run : undefined}
          disabled={sync.state === 'loading'}
        >
          {sync.state === 'loading' && <RefreshCw size={15} className="shrink-0 animate-spin" />}
          {sync.state === 'success' && <Check size={15} className="shrink-0" />}
          {sync.state === 'error'   && <AlertCircle size={15} className="shrink-0" />}
          {sync.state === 'idle'    && <RefreshCw size={15} className="shrink-0" />}
          {showLabels && (
            <span className="animate-fade-in truncate">
              {sync.state === 'loading' ? 'Syncing…' :
               sync.state === 'success' ? 'Synced!' :
               sync.state === 'error'   ? 'Retry Sync' :
               'Sync Now'}
            </span>
          )}
        </button>

        {/* Indeterminate progress bar while syncing */}
        {sync.state === 'loading' && showLabels && (
          <div>
            <div className="sync-progress-bar mx-1 mt-0.5" />
            <p className="text-[10px] text-navy-400 dark:text-white/40 px-1 mt-1.5 leading-snug animate-pulse-text">
              Fetching recordings from Hey Pocket...
            </p>
          </div>
        )}

        {/* Last synced time */}
        {(sync.state === 'idle' || sync.state === 'success') && showLabels && sync.lastSyncedAt && (
          <p className="text-[10px] text-navy-400 dark:text-white/40 px-1">
            Last synced: {timeAgo(sync.lastSyncedAt)}
          </p>
        )}

        {/* Error message */}
        {sync.state === 'error' && showLabels && (
          <p className="text-[11px] text-red-400 px-1 leading-snug line-clamp-2" title={sync.errMsg}>
            {sync.errMsg}
          </p>
        )}

        <div className="divider" />

        {/* Dark mode toggle */}
        <button
          className="nav-item w-full"
          onClick={() => setDarkMode(d => !d)}
          title={darkMode ? 'Light mode' : 'Dark mode'}
        >
          {darkMode
            ? <Sun size={18} className="shrink-0 text-gold-500" />
            : <Moon size={18} className="shrink-0" />
          }
          {showLabels && (
            <span className="animate-fade-in">
              {darkMode ? 'Light mode' : 'Dark mode'}
            </span>
          )}
        </button>

        {/* Settings */}
        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Settings"
          onClick={closeMobileMenu}
        >
          <Settings size={18} className="shrink-0" />
          {showLabels && <span className="animate-fade-in">Settings</span>}
        </NavLink>

        <div className="divider" />

        {/* Collapse — desktop only */}
        {!isMobile && (
          <button
            className="nav-item w-full"
            onClick={() => setSidebarOpen(o => !o)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen
              ? <ChevronLeft size={18} className="shrink-0" />
              : <ChevronRight size={18} className="shrink-0" />
            }
            {sidebarOpen && <span className="animate-fade-in">Collapse</span>}
          </button>
        )}

        {/* Trash */}
        <NavLink
          to="/trash"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          title="Trash"
          onClick={closeMobileMenu}
          style={({ isActive }) => isActive ? {} : { color: '#94A3B8' }}
        >
          <Trash2 size={18} className="shrink-0" />
          {showLabels && <span className="animate-fade-in">Trash</span>}
        </NavLink>

        {/* Sign Out */}
        <button
          className="nav-item w-full"
          style={{ color: '#F87171' }}
          onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
          onMouseLeave={e => e.currentTarget.style.color = '#F87171'}
          onClick={async () => {
            closeMobileMenu();
            await logout();
            navigate('/login', { replace: true });
          }}
          title="Sign Out"
        >
          <LogOut size={18} className="shrink-0" />
          {showLabels && <span className="animate-fade-in">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}
