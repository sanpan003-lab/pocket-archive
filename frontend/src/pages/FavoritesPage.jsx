import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star } from 'lucide-react';
import { getRecordings } from '../lib/api';
import { useApp } from '../context/AppContext';
import TimelineView, { TimelineSkeletonRows } from '../components/TimelineView';

export default function FavoritesPage() {
  const navigate = useNavigate();
  const { favorites, toggleFavorite } = useApp();

  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    getRecordings()
      .then(setRecordings)
      .finally(() => setLoading(false));
  }, []);

  const favRecs = recordings.filter(r => favorites.includes(r.id));

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Favorites</h1>
        <p className="text-sm text-navy-600 dark:text-white/60 mt-1">
          {favorites.length} starred recording{favorites.length !== 1 ? 's' : ''}
        </p>
      </div>

      {loading ? (
        <TimelineSkeletonRows count={6} />
      ) : favRecs.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4"
               style={{ background: 'rgba(245,158,11,0.10)' }}>
            <Star size={30} className="text-gold-500" />
          </div>
          <p className="font-bold text-navy-900 dark:text-white text-lg mb-2">No favorites yet</p>
          <p className="text-sm text-navy-600 dark:text-white/60 max-w-xs mx-auto">
            Star recordings from the Dashboard to save them here for quick access.
          </p>
        </div>
      ) : (
        <TimelineView
          recordings={favRecs}
          favorites={favorites}
          onToggleFav={toggleFavorite}
          onClickRec={id => navigate(`/recordings/${id}`)}
        />
      )}
    </div>
  );
}
