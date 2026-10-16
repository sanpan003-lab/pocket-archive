import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  authStatus, authLogin, authLogout, deviceLogin, revokeCurrentDevice, fetchMediaToken,
} from '../lib/api';
import { isInstalledApp } from '../lib/pwa';
import { AppearanceProvider } from './AppearanceContext';
import { isNative } from '../lib/platform';
import {
  saveDeviceToken, clearDeviceToken, startMediaTokens, deviceName,
} from '../native/nativeSession';

// Remembers the last known sign-in so the app still opens (and Quick Capture
// can queue recordings) when it launches with no signal
const WAS_AUTHED_KEY = 'pa_wasAuthed';
function rememberAuth(value) {
  try { localStorage.setItem(WAS_AUTHED_KEY, value ? '1' : '0'); } catch { /* ignore */ }
}
function lastKnownAuth() {
  try { return localStorage.getItem(WAS_AUTHED_KEY) === '1'; } catch { return false; }
}

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
  const [sidebarOpen, setSidebarOpen] = useLocalStorage('pa_sidebarOpen', true);
  const [syncVersion, setSyncVersion]         = useState(0);
  const triggerRefresh = useCallback(() => setSyncVersion(v => v + 1), []);

  // Mobile sidebar overlay — not persisted
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth]   = useState(true);

  // Check session on mount
  useEffect(() => {
    authStatus()
      .then(async data => {
        // App: media URLs need a token before any page renders audio
        if (isNative && data.authenticated) await startMediaTokens(fetchMediaToken);
        setIsAuthenticated(data.authenticated);
        rememberAuth(data.authenticated);
      })
      // No response at all (offline): trust the last known sign-in
      .catch(err => setIsAuthenticated(!err.response && lastKnownAuth()))
      .finally(() => setIsCheckingAuth(false));
  }, []);

  // App: device token revoked or expired → sign in again
  useEffect(() => {
    if (!isNative) return;
    const onUnauthorized = () => {
      clearDeviceToken();
      setIsAuthenticated(false);
      rememberAuth(false);
    };
    window.addEventListener('pa:unauthorized', onUnauthorized);
    return () => window.removeEventListener('pa:unauthorized', onUnauthorized);
  }, []);

  function toggleFavorite(id) {
    setFavorites(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  async function login(password) {
    if (isNative) {
      // App: 90-day device token, stored in Keystore-backed native storage
      const data = await deviceLogin(password, deviceName());
      await saveDeviceToken(data.token);
      await startMediaTokens(fetchMediaToken);
      setIsAuthenticated(true);
      rememberAuth(true);
      return data; // includes mustChangePassword
    }
    const data = await authLogin(password, isInstalledApp());
    setIsAuthenticated(true);
    rememberAuth(true);
    return data; // includes mustChangePassword
  }

  async function logout() {
    if (isNative) {
      try { await revokeCurrentDevice(); } catch { /* offline: still sign out locally */ }
      await clearDeviceToken();
      setIsAuthenticated(false);
      rememberAuth(false);
      return;
    }
    await authLogout();
    setIsAuthenticated(false);
    rememberAuth(false);
  }

  return (
    <AppContext.Provider value={{
      favorites, toggleFavorite,
      viewMode, setViewMode,
      sidebarOpen, setSidebarOpen,
      syncVersion, triggerRefresh,
      isAuthenticated, isCheckingAuth,
      login, logout,
      mobileMenuOpen, setMobileMenuOpen,
    }}>
      {/* Theme, accent, layout… (shared settings load once signed in) */}
      <AppearanceProvider authenticated={isAuthenticated}>{children}</AppearanceProvider>
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
