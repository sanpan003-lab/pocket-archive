import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu, Moon, Sun } from 'lucide-react';
import Sidebar from './Sidebar';
import { useApp } from '../context/AppContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function AppLayout() {
  const {
    sidebarOpen, darkMode, setDarkMode,
    mobileMenuOpen, setMobileMenuOpen,
  } = useApp();
  const isMobile = useIsMobile();

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
        className="flex-1 overflow-auto min-w-0 transition-all duration-300"
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
            Pocket Archive
          </span>
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
        </div>

        <Outlet />
      </main>
    </div>
  );
}
