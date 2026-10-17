import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2, Move } from 'lucide-react';
import { getMapStatus, setHomeLocation, setPlaceRadius, updateSavedPlace } from '../../lib/api';
import { findAddress } from '../../lib/placeLookup';
import { RADIUS_OPTIONS, MIN_RADIUS_M, MAX_RADIUS_M, formatRadius } from '../../lib/radius';
import { syncErrands } from '../../native/errands';

const MapView = lazy(() => import('./MapView'));

/** Radius shown for a mode (Auto = the place's OpenStreetMap area, at least 150 m / home 100 m) */
function metersFor(mode, custom, autoM) {
  if (mode === 'custom') return custom;
  const preset = RADIUS_OPTIONS.find(o => o.value === mode)?.meters;
  return preset || autoM;
}

/**
 * Adjust a place on the map: drag the pin, set the reminder radius (slider or Small / Medium /
 * Large / Extra large / Auto). place: { id: 'home' | saved id, lat, lng, address, radiusMode, radiusM, autoRadiusM }
 */
export default function PlaceAdjust({ place, onSaved, onCancel }) {
  const home = place.id === 'home';
  const autoM = Math.max(home ? 100 : 150, place.autoRadiusM || 0);
  const [status, setStatus] = useState(null);
  const [pos, setPos] = useState({ lat: place.lat, lng: place.lng });
  const [mode, setMode] = useState(place.radiusMode || 'auto');
  const [custom, setCustom] = useState(place.radiusMode === 'custom' && place.radiusM ? place.radiusM : metersFor(place.radiusMode || 'auto', 0, autoM));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const meters = metersFor(mode, custom, autoM);
  const moved = Math.abs(pos.lat - place.lat) > 0.00002 || Math.abs(pos.lng - place.lng) > 0.00002;

  useEffect(() => { getMapStatus().then(setStatus).catch(() => setStatus({ available: false })); }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (moved) {
        let address = place.address || null;
        try { address = (await findAddress(pos.lat, pos.lng)).address || address; } catch { /* keep the old one */ }
        if (home) await setHomeLocation({ lat: pos.lat, lng: pos.lng, source: 'browser', address });
        else await updateSavedPlace(place.id, { lat: pos.lat, lng: pos.lng, address });
      }
      if (mode !== (place.radiusMode || 'auto') || (mode === 'custom' && custom !== place.radiusM)) {
        await setPlaceRadius(place.id, mode === 'custom' ? { radiusMode: 'custom', radiusM: custom } : { radiusMode: mode });
      }
      syncErrands(); // the phone re-arms with the new circle
      onSaved?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2.5" data-no-swipe>
      {status?.available ? (
        <Suspense fallback={<div className="h-56 rounded-2xl bg-navy-100 dark:bg-white/10 animate-pulse" />}>
          <MapView mapName={status.default} height={230} edit={{ lat: pos.lat, lng: pos.lng, radiusM: meters, color: '#EF4444', onMove: setPos }} />
        </Suspense>
      ) : status ? (
        <p className="text-xs text-navy-500 dark:text-white/50">The map isn’t installed on the server, so the pin can’t be dragged — the radius still works.</p>
      ) : (
        <div className="h-56 rounded-2xl bg-navy-100 dark:bg-white/10 animate-pulse" />
      )}
      {status?.available && <p className="text-xs text-navy-500 dark:text-white/50 inline-flex items-center gap-1"><Move size={12} /> Drag the pin to the right spot (e.g. the entrance or where you park).</p>}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor={`radius-${place.id}`} className="text-xs font-semibold text-navy-600 dark:text-white/60">Reminder radius</label>
          <span className="text-xs font-bold text-navy-900 dark:text-white">{formatRadius(meters)}{mode === 'auto' ? ' · Auto' : ''}</span>
        </div>
        <input
          id={`radius-${place.id}`}
          type="range" min={MIN_RADIUS_M} max={MAX_RADIUS_M} step={50}
          value={meters}
          onChange={e => { setMode('custom'); setCustom(Number(e.target.value)); }}
          className="w-full accent-gold-500"
        />
        <div className="flex flex-wrap gap-1.5 mt-1.5" role="radiogroup" aria-label="Radius size">
          {RADIUS_OPTIONS.map(o => (
            <button key={o.value} type="button" role="radio" aria-checked={mode === o.value}
              className={`text-xs px-2.5 py-1 rounded-full border ${mode === o.value ? 'bg-gold-500 text-white border-gold-500' : 'border-navy-200 dark:border-white/20 text-navy-700 dark:text-white/75'}`}
              onClick={() => setMode(o.value)}>
              {o.label} {o.meters ? formatRadius(o.meters) : `(${formatRadius(autoM)})`}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-navy-500 dark:text-white/45 mt-1">
          Auto fits the place: big places like airports, campuses and malls get a bigger circle (up to 2 km).
        </p>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-gold text-sm" onClick={save} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : null} Save</button>
        {onCancel && <button type="button" className="btn-ghost text-sm" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
