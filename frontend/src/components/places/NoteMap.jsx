import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigation } from 'lucide-react';
import { getMapStatus } from '../../lib/api';
import { directionsUrl } from '../quick/quickMeta';

const MapView = lazy(() => import('./MapView'));

let statusPromise = null;
const mapStatus = () => (statusPromise ||= getMapStatus().catch(() => ({ available: false })));

/** Small map in an errand / location-reminder note: the place (+ reminder radius). Directions → Google Maps. */
export default function NoteMap({ note }) {
  const [status, setStatus] = useState(null);
  const geo = note.geo && Number.isFinite(note.geo.lat) ? note.geo : null;
  const place = !geo && note.type === 'errand' && note.place?.resolved && Number.isFinite(note.place.lat) ? note.place : null;
  const target = geo || place;

  useEffect(() => {
    if (target) mapStatus().then(setStatus);
  }, [target]);

  if (!target || !status?.available || note.undone) return null;
  const markers = [{ id: 'p', lat: target.lat, lng: target.lng, label: target.name || target.query, sub: target.address, color: geo ? '#EF4444' : '#10B981' }];
  const circles = geo ? [{ lat: geo.lat, lng: geo.lng, radiusM: geo.radiusM || 150, color: '#EF4444' }] : [];
  const directions = directionsUrl({ name: target.name, address: target.address, lat: target.lat, lng: target.lng });

  return (
    <div className="mb-3">
      <Suspense fallback={<div className="h-44 rounded-2xl bg-navy-100 dark:bg-white/10 animate-pulse" />}>
        <MapView mapName={status.default} markers={markers} circles={circles} height={176} interactive />
      </Suspense>
      {directions && (
        <a href={directions} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <Navigation size={12} /> Directions (Google Maps)
        </a>
      )}
    </div>
  );
}
