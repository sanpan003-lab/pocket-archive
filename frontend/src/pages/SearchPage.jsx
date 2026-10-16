import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, AlertCircle, StickyNote, Image as ImageIcon, ListChecks } from 'lucide-react';
import { searchRecordings, searchQuickNotes } from '../lib/api';
import { QUICK_TYPES, cardTime } from '../components/quick/quickMeta';
import { useApp } from '../context/AppContext';
import TimelineView, { TimelineSkeletonRows } from '../components/TimelineView';

export default function SearchPage() {
  const navigate = useNavigate();
  const { favorites, toggleFavorite } = useApp();

  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [quick, setQuick]       = useState([]);       // quick notes (typed, voice, photos, lists)
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError]       = useState(null);

  const runSearch = useCallback(async (q) => {
    if (q.length < 2) { setResults([]); setQuick([]); setSearched(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [data, notes] = await Promise.all([searchRecordings(q), searchQuickNotes(q).catch(() => [])]);
      setResults(data);
      setQuick(notes);
      setSearched(true);
    } catch (err) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const timer = useRef(null);
  const debouncedSearch = useCallback(q => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(q), 350);
  }, [runSearch]);

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    debouncedSearch(q);
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Search</h1>
        <p className="text-sm text-navy-600 dark:text-white/60 mt-1">
          Full-text search across all notes, transcripts, and AI summaries
        </p>
      </div>

      {/* Search box */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-navy-400 dark:text-white/40" size={18} />
        <input
          className="search-input pl-11 text-base"
          placeholder="Search recordings and notes..."
          value={query}
          onChange={handleChange}
          autoFocus
        />
      </div>

      {/* Error */}
      {error && (
        <div className="glass-card p-4 flex items-center gap-3 mb-4">
          <AlertCircle size={20} className="text-red-400 shrink-0" />
          <p className="text-sm text-navy-700 dark:text-white/70">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && <TimelineSkeletonRows count={4} />}

      {/* Results */}
      {!loading && searched && (
        results.length === 0 && quick.length === 0 ? (
          <div className="glass-card p-10 text-center">
            <Search size={32} className="text-navy-300 dark:text-white/30 mx-auto mb-3" />
            <p className="font-semibold text-navy-900 dark:text-white">No results for &quot;{query}&quot;</p>
            <p className="text-sm text-navy-500 dark:text-white/50 mt-1">
              Try different keywords or a shorter search term.
            </p>
          </div>
        ) : (
          <div>
            {quick.length > 0 && (
              <section className="mb-6" aria-label="Quick notes">
                <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-navy-400 dark:text-white/40">
                  Quick notes · {quick.length}
                </h2>
                <div className="flex flex-col gap-2">
                  {quick.map(n => {
                    const meta = QUICK_TYPES[n.type] || QUICK_TYPES.note;
                    const Icon = n.hasMedia ? ImageIcon : n.format === 'list' ? ListChecks : meta.icon || StickyNote;
                    return (
                      <button key={n.id} type="button" onClick={() => navigate(`/quick/${n.id}`)}
                        className="quick-card text-left flex items-start gap-3 px-4 py-3 hover:border-gold-300">
                        <Icon size={17} className="shrink-0 mt-0.5" style={{ color: meta.color }} />
                        <span className="flex-1 min-w-0">
                          <span className="block font-semibold text-navy-900 dark:text-white break-words">{n.title}</span>
                          {n.snippet && <span className="block text-sm text-navy-600 dark:text-white/60 line-clamp-2 break-words">{n.snippet}</span>}
                        </span>
                        <span className="shrink-0 text-xs text-navy-400 dark:text-white/45">{cardTime(n.capturedAt)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {results.length > 0 && <TimelineView
              recordings={results}
              favorites={favorites}
              onToggleFav={toggleFavorite}
              onClickRec={id => navigate(`/recordings/${id}`)}
            />}
            <p className="text-xs text-navy-400 dark:text-white/40 text-center py-4">
              {results.length + quick.length} result{results.length + quick.length !== 1 ? 's' : ''} for &quot;{query}&quot;
            </p>
          </div>
        )
      )}

      {/* Idle state */}
      {!loading && !searched && !error && (
        <div className="glass-card p-12 text-center">
          <Search size={36} className="text-navy-200 dark:text-white/20 mx-auto mb-4" />
          <p className="text-navy-600 dark:text-white/60 font-medium">
            Type at least 2 characters to search
          </p>
        </div>
      )}
    </div>
  );
}
