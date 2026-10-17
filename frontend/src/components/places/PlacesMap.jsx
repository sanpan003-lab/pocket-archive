import { lazy, Suspense, useEffect, useState } from 'react';
import { Map as MapIcon, ChevronDown } from 'lucide-react';
import { getMapStatus, getLocationReminders, getActiveErrands } from '../../lib/api';
import { formatRadius } from '../../lib/radius';

const MapView = lazy(() => import('./MapView'));

const COLORS = { home: '#F59E0B', work: '#0EA5E9', place: '#8B5CF6', store: '#10B981', reminder: '#EF4444' };

/**
 * Settings → Places & errands → Map: home, saved places, stores of active
 * errands and location reminders (with their radius) on the self-hosted map.
 */
export default function PlacesMap({ places }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [errands, setErrands] = useState([]);

  useEffect(() => {
    if (!open) return;
    getMapStatus().then(setStatus).catch(() => setStatus({ available: false }));
    getLocationReminders().then(setReminders).catch(() => {});
    getActiveErrands().then(d => setErrands(d.errands || [])).catch(() => {});
  }, [open]);

  const markers = [];
  const circles = [];
  if (places?.home && Number.isFinite(places.home.lat)) {
    markers.push({ id: 'home', lat: places.home.lat, lng: places.home.lng, label: 'Home', sub: places.home.address, color: COLORS.home });
  }
  for (const p of places?.saved || []) {
    if (!Number.isFinite(p.lat)) continue;
    markers.push({ id: p.id, lat: p.lat, lng: p.lng, label: p.kind === 'work' ? 'Work' : p.name, sub: [p.address, (p.aliases || []).join(', ')].filter(Boolean).join(' · '), color: p.kind === 'work' ? COLORS.work : p.kind === 'other' ? COLORS.place : COLORS.store });
  }
  for (const r of reminders) {
    if (r.status !== 'active' || !Number.isFinite(r.lat)) continue;
    circles.push({ lat: r.lat, lng: r.lng, radiusM: r.radiusM || 150, color: COLORS.reminder, label: formatRadius(r.radiusM || 150) });
    markers.push({ id: `r-${r.id}`, lat: r.lat, lng: r.lng, label: r.title, sub: `${r.when === 'leave' ? 'Leaving' : 'Arriving at'} ${r.place}`, color: COLORS.reminder });
  }
  for (const e of errands) {
    if (e.kind === 'reminder') continue;
    for (const b of (e.branches || []).slice(0, 5)) {
      markers.push({ id: `${e.id}-${b.key}`, lat: b.lat, lng: b.lng, label: b.name || e.placeName || e.title, sub: `${e.title}${b.address ? ` · ${b.address}` : ''}`, color: COLORS.store });
    }
  }

  return (
    <div className="mt-5">
      <button type="button" className="w-full flex items-center gap-2 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <MapIcon size={15} className="text-gold-500" />
        <span className="flex-1 text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/40">Map</span>
        <ChevronDown size={15} className={`text-navy-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2">
          {status && !status.available ? (
            <p className="text-sm text-navy-500 dark:text-white/55 rounded-xl bg-navy-50/50 dark:bg-white/5 p-3">
              The map file isn’t installed on the server yet (ARCHIVE/09_Maps/florida.pmtiles). See docs/maps.md for the one-time download.
            </p>
          ) : status ? (
            <Suspense fallback={<div className="h-80 rounded-2xl bg-navy-100 dark:bg-white/10 animate-pulse" />}>
              <MapView mapName={status.default} markers={markers} circles={circles} height={340} />
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-navy-500 dark:text-white/55">
                {[['Home', COLORS.home], ['Work', COLORS.work], ['Places', COLORS.place], ['Stores', COLORS.store], ['Reminders', COLORS.reminder]].map(([l, c]) => (
                  <span key={l} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{l}</span>
                ))}
              </div>
            </Suspense>
          ) : (
            <div className="h-80 rounded-2xl bg-navy-100 dark:bg-white/10 animate-pulse" />
          )}
        </div>
      )}
    </div>
  );
}
