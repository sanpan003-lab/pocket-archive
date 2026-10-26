import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { useAppearance } from './context/appearanceStore';
import { returnPath } from './lib/returnPath';
import AppLayout from './components/AppLayout';
import Dashboard from './pages/Dashboard';
import RecordingDetail from './pages/RecordingDetail';
import SearchPage from './pages/SearchPage';
import FavoritesPage from './pages/FavoritesPage';
import SettingsPage from './pages/SettingsPage';
import FilteredListPage from './pages/FilteredListPage';
import CalendarPage from './pages/CalendarPage';
import LoginPage from './pages/LoginPage';
import TrashPage from './pages/TrashPage';
import CreateRecordingPage from './pages/CreateRecordingPage';
import QuickCapturePage from './pages/QuickCapturePage';
import QuickInboxPage from './pages/QuickInboxPage';
import ActionsPage from './pages/ActionsPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import NativeBridge from './native/NativeBridge';
import PermissionGate from './native/PermissionGate';
import SetPasswordScreen from './components/SetPasswordScreen';
import Welcome from './components/Welcome';
import { useLayout } from './lib/layout';

// ── Full-screen spinner (shown while checking session cookie) ─────────────────

function FullScreenSpinner() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 dark:bg-black flex items-center justify-center">
      <div className="w-10 h-10 rounded-full border-4 border-amber-200 border-t-amber-500 animate-spin" />
    </div>
  );
}

// ── Route guards ──────────────────────────────────────────────────────────────

function ProtectedRoute({ children }) {
  const { isAuthenticated, isCheckingAuth, user } = useApp();
  const location = useLocation();
  if (isCheckingAuth)    return <FullScreenSpinner />;
  if (!isAuthenticated)  return <Navigate to="/login" replace state={{ from: location }} />;
  // Temporary password (e.g. the app was reopened mid sign-in): set your own first
  if (user?.mustChangePassword) return <SetPasswordScreen />;
  return <>{children}<Welcome /></>;
}

/** The Hey Pocket archive pages: the admin only (Full layout). Others go home. */
function ArchiveRoute({ children }) {
  const { archive } = useLayout();
  return archive ? children : <Navigate to="/" replace />;
}

function LoginRoute() {
  const { isAuthenticated, isCheckingAuth, user } = useApp();
  const location = useLocation();
  if (isCheckingAuth)   return <FullScreenSpinner />;
  // Stay on the login page for its 'Set your password' step after a temporary password
  if (isAuthenticated && !user?.mustChangePassword) return <Navigate to={returnPath(location)} replace />;
  return <LoginPage />;
}

// Settings → Behavior → "Default screen": only when the app was opened on "/", once
const OPENED_ON_HOME = window.location.pathname === '/';
let launchHandled = false;
const DEFAULT_SCREENS = { quick: '/quick', inbox: '/quick/inbox', projects: '/projects' };

function Home() {
  const { settings } = useAppearance();
  const { archive } = useLayout();
  const target = OPENED_ON_HOME && !launchHandled ? DEFAULT_SCREENS[settings.behavior.defaultScreen] : null;
  useEffect(() => { launchHandled = true; }, []);
  if (target) return <Navigate to={target} replace />;
  // No archive (Lite, members): home is Capture, or the screen chosen in Settings
  if (!archive) return <Navigate to={DEFAULT_SCREENS[settings.behavior.defaultScreen] || '/quick'} replace />;
  return <Dashboard />;
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        {/* Android app only: back button + shortcut routes, first-launch permissions */}
        <NativeBridge />
        <PermissionGate>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Home />} />
            <Route path="quick"       element={<QuickCapturePage />} />
            <Route path="quick/inbox" element={<QuickInboxPage />} />
            <Route path="quick/actions" element={<ActionsPage />} />
            {/* One note, opened over the inbox (deep links, widget, Back button) */}
            <Route path="quick/:id"   element={<QuickInboxPage />} />
            <Route path="shared"       element={<QuickInboxPage key="shared" sharedOnly />} />
            <Route path="lists"        element={<QuickInboxPage key="lists" listsOnly />} />
            <Route path="projects"     element={<ProjectsPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="recordings/:id" element={<ArchiveRoute><RecordingDetail /></ArchiveRoute>} />
            <Route path="search"    element={<SearchPage />} />
            <Route path="favorites" element={<ArchiveRoute><FavoritesPage /></ArchiveRoute>} />
            <Route path="settings"  element={<SettingsPage />} />
            <Route path="settings/:category" element={<SettingsPage />} />

            <Route path="ai-notes" element={<ArchiveRoute>
              <FilteredListPage
                filterFn={r => r.hasAiNotes}
                title="AI Notes"
                description="Recordings with AI-generated notes and visualizations"
                emptyMessage="No recordings have AI notes yet. Run pocket_sync.py to generate them."
              />
            </ArchiveRoute>
            } />
            <Route path="recordings-list" element={<ArchiveRoute>
              <FilteredListPage
                filterFn={r => r.hasAudio}
                title="Recordings"
                description="All recordings with audio files"
                emptyMessage="No audio files found. Run pocket_sync.py to download them."
              />
            </ArchiveRoute>
            } />
            <Route path="summaries" element={<ArchiveRoute>
              <FilteredListPage
                filterFn={r => r.hasOriginalNotes}
                title="Hey Pocket"
                description="Recordings with original Hey Pocket summaries"
                emptyMessage="No original summaries found. Run pocket_sync.py to import them."
              />
            </ArchiveRoute>
            } />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="trash"   element={<ArchiveRoute><TrashPage /></ArchiveRoute>} />
            <Route path="new"     element={<ArchiveRoute><CreateRecordingPage /></ArchiveRoute>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        </PermissionGate>
      </BrowserRouter>
    </AppProvider>
  );
}
