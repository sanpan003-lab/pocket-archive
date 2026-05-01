import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
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
  const { isAuthenticated, isCheckingAuth } = useApp();
  if (isCheckingAuth)    return <FullScreenSpinner />;
  if (!isAuthenticated)  return <Navigate to="/login" replace />;
  return children;
}

function LoginRoute() {
  const { isAuthenticated, isCheckingAuth } = useApp();
  if (isCheckingAuth)   return <FullScreenSpinner />;
  if (isAuthenticated)  return <Navigate to="/" replace />;
  return <LoginPage />;
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
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
            <Route index element={<Dashboard />} />
            <Route path="recordings/:id" element={<RecordingDetail />} />
            <Route path="search"    element={<SearchPage />} />
            <Route path="favorites" element={<FavoritesPage />} />
            <Route path="settings"  element={<SettingsPage />} />

            <Route path="ai-notes" element={
              <FilteredListPage
                filterFn={r => r.hasAiNotes}
                title="AI Notes"
                description="Recordings with AI-generated notes and visualizations"
                emptyMessage="No recordings have AI notes yet. Run pocket_sync.py to generate them."
              />
            } />
            <Route path="recordings-list" element={
              <FilteredListPage
                filterFn={r => r.hasAudio}
                title="Recordings"
                description="All recordings with audio files"
                emptyMessage="No audio files found. Run pocket_sync.py to download them."
              />
            } />
            <Route path="summaries" element={
              <FilteredListPage
                filterFn={r => r.hasOriginalNotes}
                title="Hey Pocket"
                description="Recordings with original Hey Pocket summaries"
                emptyMessage="No original summaries found. Run pocket_sync.py to import them."
              />
            } />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="trash"   element={<TrashPage />} />
            <Route path="new"     element={<CreateRecordingPage />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
