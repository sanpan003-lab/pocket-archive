import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic2 } from 'lucide-react';
import { getRecordings } from '../lib/api';
import { useApp } from '../context/AppContext';
import TimelineView, { TimelineSkeletonRows } from '../components/TimelineView';

export default function FilteredListPage({ filterFn, title, description, emptyMessage }) {
  const navigate = useNavigate();
  const { favorites, toggleFavorite, syncVersion } = useApp();

  const [allRecordings, setAllRecordings] = useState([]);
  const [loading, setLoading]             = useState(true);

  useEffect(() => {
    setLoading(true);
    getRecordings()
      .then(setAllRecordings)
      .finally(() => setLoading(false));
  }, [syncVersion]);

  const recordings = useMemo(
    () => (filterFn ? allRecordings.filter(filterFn) : allRecordings),
    [allRecordings, filterFn]
  );

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">{title}</h1>
        <div className="flex items-center gap-3 mt-1">
          {description && (
            <p className="text-sm text-navy-600 dark:text-white/60">{description}</p>
          )}
          {!loading && (
            <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-navy-100 dark:bg-white/10 text-navy-500 dark:text-white/50">
              {recordings.length} of {allRecordings.length}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <TimelineSkeletonRows count={8} />
      ) : recordings.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <div className="w-16 h-16 rounded-3xl bg-gold-gradient flex items-center justify-center mx-auto mb-4 shadow-gold">
            <Mic2 size={28} className="text-white" />
          </div>
          <p className="font-bold text-navy-900 dark:text-white text-lg mb-2">Nothing here yet</p>
          <p className="text-sm text-navy-600 dark:text-white/60 max-w-xs mx-auto">
            {emptyMessage || 'No recordings match this filter.'}
          </p>
        </div>
      ) : (
        <TimelineView
          recordings={recordings}
          favorites={favorites}
          onToggleFav={toggleFavorite}
          onClickRec={id => navigate(`/recordings/${id}`)}
        />
      )}
    </div>
  );
}
