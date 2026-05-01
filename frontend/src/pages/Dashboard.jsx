import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Layers, Headphones, Sparkles,
  Star, LayoutGrid, List, AlertCircle, Mic2,
} from 'lucide-react';
import { getRecordings, getStats } from '../lib/api';
import { useApp } from '../context/AppContext';
import TimelineView, { TimelineSkeletonRows } from '../components/TimelineView';

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color, loading }) {
  return (
    <div className="glass-card p-5 flex items-center gap-4">
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
        style={{ background: color.bg }}
      >
        <Icon size={22} style={{ color: color.icon }} />
      </div>
      <div>
        <p className="text-sm text-navy-600 dark:text-white/60 font-medium">{label}</p>
        {loading
          ? <div className="h-7 w-10 rounded bg-navy-100 dark:bg-white/10 animate-pulse mt-1" />
          : <p className="text-2xl font-bold text-navy-900 dark:text-white">{value ?? '—'}</p>
        }
      </div>
    </div>
  );
}

// ── Recording Card (grid) ─────────────────────────────────────────────────────

function RecordingCard({ rec, isFav, onToggleFav, onClick }) {
  return (
    <div
      className="glass-card p-5 cursor-pointer animate-slide-up"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="badge badge-gold">{rec.date}</span>
        <button
          className="text-lg transition-colors"
          style={{ color: isFav ? '#F59E0B' : '#CBD5E1' }}
          onClick={e => { e.stopPropagation(); onToggleFav(rec.id); }}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={17} fill={isFav ? '#F59E0B' : 'none'} />
        </button>
      </div>

      <h3 className="font-semibold text-navy-900 dark:text-white text-sm leading-snug mb-4 line-clamp-2">
        {rec.title}
      </h3>

      <div className="flex flex-wrap gap-1.5">
        {rec.hasAudio   && <span className="badge badge-green">Audio</span>}
        {rec.hasAiNotes && <span className="badge badge-blue">AI Notes</span>}
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="glass-card p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="h-5 w-20 rounded-full bg-navy-100 dark:bg-white/10 animate-pulse" />
        <div className="h-5 w-5 rounded-full bg-navy-100 dark:bg-white/10 animate-pulse" />
      </div>
      <div className="h-4 w-3/4 rounded bg-navy-100 dark:bg-white/10 animate-pulse mb-2" />
      <div className="h-4 w-1/2 rounded bg-navy-100 dark:bg-white/10 animate-pulse mb-4" />
      <div className="flex gap-1.5">
        <div className="h-5 w-14 rounded-full bg-navy-100 dark:bg-white/10 animate-pulse" />
        <div className="h-5 w-14 rounded-full bg-navy-100 dark:bg-white/10 animate-pulse" />
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'all',       label: 'All'          },
  { key: 'audio',     label: 'Has Audio'    },
  { key: 'ai',        label: 'Has AI Notes' },
  { key: 'favorites', label: 'Favorites'    },
];

const STAT_COLORS = {
  total:      { bg: 'rgba(99,102,241,0.12)',  icon: '#6366F1' },
  withAudio:  { bg: 'rgba(245,158,11,0.12)',  icon: '#F59E0B' },
  withAiNote: { bg: 'rgba(168,85,247,0.12)',  icon: '#A855F7' },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { favorites, toggleFavorite, viewMode, setViewMode, darkMode, syncVersion } = useApp();

  const [recordings, setRecordings] = useState([]);
  const [stats, setStats]           = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [activeTab, setActiveTab]   = useState('all');
  const [search, setSearch]         = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);
    async function load() {
      try {
        const [recs, st] = await Promise.all([getRecordings(), getStats()]);
        setRecordings(recs);
        setStats(st);
      } catch (err) {
        setError(err.message || 'Failed to load recordings');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [syncVersion]);

  const filtered = useMemo(() => {
    let list = recordings;
    if (activeTab === 'audio')     list = list.filter(r => r.hasAudio);
    if (activeTab === 'ai')        list = list.filter(r => r.hasAiNotes);
    if (activeTab === 'favorites') list = list.filter(r => favorites.includes(r.id));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r => r.title.toLowerCase().includes(q));
    }
    return list;
  }, [recordings, activeTab, search, favorites]);

  const toggleBg      = darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.05)';
  const activeBtnBg   = darkMode ? 'rgba(255,255,255,0.13)' : 'white';
  const activeBtnClr  = darkMode ? 'rgba(255,255,255,0.95)' : '#0F172A';
  const activeBtnShdw = darkMode ? '0 1px 4px rgba(0,0,0,0.25)' : '0 1px 4px rgba(15,23,42,0.08)';

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Your Recordings</h1>
        {stats && (
          <p className="text-sm text-navy-600 dark:text-white/60 mt-1">
            {stats.total} recording{stats.total !== 1 ? 's' : ''} in archive
          </p>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard icon={Layers}     label="Total"      value={stats?.total}       color={STAT_COLORS.total}      loading={loading} />
        <StatCard icon={Headphones} label="With Audio" value={stats?.withAudio}   color={STAT_COLORS.withAudio}  loading={loading} />
        <StatCard icon={Sparkles}   label="AI Notes"   value={stats?.withAiNotes} color={STAT_COLORS.withAiNote} loading={loading} />
      </div>

      {/* Toolbar: tabs + search + view toggle */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-5">
        <div className="overflow-x-auto shrink-0 -mx-1 px-1">
          <div className="tab-bar w-max">
            {TABS.map(t => (
              <button
                key={t.key}
                className={`tab-item shrink-0 ${activeTab === t.key ? 'active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
                {t.key === 'favorites' && favorites.length > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gold-500 text-white text-[10px] font-bold">
                    {favorites.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="relative flex-1 min-w-0">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400 dark:text-white/40"
              width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              className="search-input"
              placeholder="Filter by title..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="flex gap-1 p-1 rounded-xl shrink-0" style={{ background: toggleBg }}>
            <button
              className="p-2.5 rounded-lg transition-all"
              style={{
                background: viewMode === 'grid' ? activeBtnBg : 'transparent',
                color:      viewMode === 'grid' ? activeBtnClr : '#94A3B8',
                boxShadow:  viewMode === 'grid' ? activeBtnShdw : 'none',
              }}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className="p-2.5 rounded-lg transition-all"
              style={{
                background: viewMode === 'list' ? activeBtnBg : 'transparent',
                color:      viewMode === 'list' ? activeBtnClr : '#94A3B8',
                boxShadow:  viewMode === 'list' ? activeBtnShdw : 'none',
              }}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="glass-card p-6 flex items-center gap-4 border-red-200 mb-4">
          <AlertCircle size={24} className="text-red-500 shrink-0" />
          <div>
            <p className="font-semibold text-navy-900 dark:text-white">Could not load recordings</p>
            <p className="text-sm text-navy-600 dark:text-white/60 mt-0.5">{error}</p>
            <p className="text-xs text-navy-400 dark:text-white/40 mt-1">Make sure the backend is running on port 3001.</p>
          </div>
        </div>
      )}

      {/* Grid view */}
      {!error && viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {loading
            ? Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)
            : filtered.length === 0
              ? <EmptyState tab={activeTab} search={search} />
              : filtered.map(rec => (
                  <RecordingCard
                    key={rec.id}
                    rec={rec}
                    isFav={favorites.includes(rec.id)}
                    onToggleFav={toggleFavorite}
                    onClick={() => navigate(`/recordings/${rec.id}`)}
                  />
                ))
          }
        </div>
      )}

      {/* List view — timeline grouped by date */}
      {!error && viewMode === 'list' && (
        <div>
          {loading
            ? <TimelineSkeletonRows count={10} />
            : filtered.length === 0
              ? <EmptyState tab={activeTab} search={search} />
              : <TimelineView
                  recordings={filtered}
                  favorites={favorites}
                  onToggleFav={toggleFavorite}
                  onClickRec={id => navigate(`/recordings/${id}`)}
                />
          }
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab, search }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-3xl bg-gold-gradient flex items-center justify-center mb-4 shadow-gold">
        <Mic2 size={28} className="text-white" />
      </div>
      <p className="font-semibold text-navy-900 dark:text-white text-lg mb-1">
        {search ? 'No matches found' : tab === 'favorites' ? 'No favorites yet' : 'No recordings'}
      </p>
      <p className="text-sm text-navy-600 dark:text-white/60 max-w-xs">
        {search
          ? `No recordings match "${search}". Try a different term.`
          : tab === 'favorites'
            ? 'Star any recording to save it here.'
            : 'Run pocket_sync.py to export recordings to the archive.'}
      </p>
    </div>
  );
}
