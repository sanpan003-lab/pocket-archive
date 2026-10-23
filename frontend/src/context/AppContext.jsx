import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  authStatus, authLogin, authLogout, deviceLogin, revokeCurrentDevice, fetchMediaToken, getMe,
} from '../lib/api';
import { isInstalledApp } from '../lib/pwa';
import { signInWithPasskey } from '../lib/passkeys';
import { AppearanceProvider } from './AppearanceContext';
import { isNative } from '../lib/platform';
import {
  saveDeviceToken, clearDeviceToken, startMediaTokens, deviceName, syncNativeUser,
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
// Who is signed in (name, role, plan) — cached so the app opens offline with the right layout
const USER_KEY = 'pa_user';
function rememberUser(u) {
  try { if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
}
function cachedUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
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
  const [user, setUser]                       = useState(() => cachedUser());
  const [maintenance, setMaintenance]         = useState(null); // server waiting for the accounts migration

  // Check session on mount
  useEffect(() => {
    authStatus()
      .then(async data => {
        // App: media URLs need a token before any page renders audio
        if (isNative && data.authenticated) await startMediaTokens(fetchMediaToken);
        setIsAuthenticated(data.authenticated);
        rememberAuth(data.authenticated);
        rememberUser(data.authenticated ? data.user : null);
        setUser(data.authenticated ? data.user : null);
        if (isNative && data.authenticated && data.user?.id) syncNativeUser(data.user.id);
      })
      // No response at all (offline): trust the last known sign-in
      .catch(err => {
        if (err.response?.data?.maintenance) setMaintenance(err.response.data.error);
        setIsAuthenticated(!err.response && lastKnownAuth());
      })
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

  /** → { twoFactorRequired } (ask for a code, call again) or { mustChangePassword, user } */
  async function login(username, password, code) {
    if (isNative) {
      // App: 90-day device token for this user, stored in Keystore-backed native storage
      const data = await deviceLogin(username, password, deviceName(), code);
      if (data.twoFactorRequired) return data;
      await saveDeviceToken(data.token, data.userId);
      await startMediaTokens(fetchMediaToken);
      signedIn(data.user);
      return data;
    }
    const data = await authLogin(username, password, isInstalledApp(), code);
    if (data.twoFactorRequired) return data;
    signedIn(data.user);
    return data;
  }

  /** Web: sign in with a passkey (no 2FA code needed) */
  async function loginWithPasskey() {
    const data = await signInWithPasskey(isInstalledApp());
    signedIn(data.user);
    return data;
  }

  function signedIn(u) {
    setIsAuthenticated(true);
    rememberAuth(true);
    rememberUser(u);
    setUser(u);
  }

  /** After a password change, profile edit or 2FA change */
  const refreshUser = useCallback(async () => {
    try { const u = await getMe(); setUser(u); rememberUser(u); return u; } catch { return null; }
  }, []);

  async function logout() {
    if (isNative) {
      try { await revokeCurrentDevice(); } catch { /* offline: still sign out locally */ }
      await clearDeviceToken();
      setIsAuthenticated(false);
      rememberAuth(false);
      rememberUser(null);
      setUser(null);
      return;
    }
    await authLogout();
    setIsAuthenticated(false);
    rememberAuth(false);
    rememberUser(null);
    setUser(null);
  }

  return (
    <AppContext.Provider value={{
      favorites, toggleFavorite,
      viewMode, setViewMode,
      sidebarOpen, setSidebarOpen,
      syncVersion, triggerRefresh,
      isAuthenticated, isCheckingAuth,
      login, loginWithPasskey, logout, user, refreshUser, maintenance,
      isAdmin: user?.role === 'admin',
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
