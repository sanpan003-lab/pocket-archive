import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authStatus, authLogin, authLogout } from '../lib/api';

const AppContext = createContext(null);

function useLocalStorage(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

export function AppProvider({ children }) {
  const [favorites, setFavorites]     = useLocalStorage('pa_favorites', []);
  const [viewMode, setViewMode]       = useLocalStorage('pocket:viewMode', 'list');
  const [darkMode, setDarkMode]       = useLocalStorage('pa_darkMode', false);
  const [sidebarOpen, setSidebarOpen] = useLocalStorage('pa_sidebarOpen', true);
  const [syncVersion, setSyncVersion]         = useState(0);
  const triggerRefresh = useCallback(() => setSyncVersion(v => v + 1), []);

  // Mobile sidebar overlay — not persisted
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth]   = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Check session on mount
  useEffect(() => {
    authStatus()
      .then(data => setIsAuthenticated(data.authenticated))
      .catch(() => setIsAuthenticated(false))
      .finally(() => setIsCheckingAuth(false));
  }, []);

  function toggleFavorite(id) {
    setFavorites(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  async function login(password) {
    const data = await authLogin(password);
    setIsAuthenticated(true);
    return data; // includes mustChangePassword
  }

  async function logout() {
    await authLogout();
    setIsAuthenticated(false);
  }

  return (
    <AppContext.Provider value={{
      favorites, toggleFavorite,
      viewMode, setViewMode,
      darkMode, setDarkMode,
      sidebarOpen, setSidebarOpen,
      syncVersion, triggerRefresh,
      isAuthenticated, isCheckingAuth,
      login, logout,
      mobileMenuOpen, setMobileMenuOpen,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
