import { useEffect, useState } from 'react';
import { MapPin, LocateFixed, Search, Home, Briefcase, Loader2, X, ArrowLeftRight, Map as MapIcon } from 'lucide-react';
import { getPlaces, searchPlaces, reversePlace, setGeoPlace } from '../../lib/api';
import { currentPosition } from '../../lib/geolocate';
import { syncErrands } from '../../native/errands';
import { geoLabel } from '../../lib/geoLabel';
import { radiusLabel, formatRadius } from '../../lib/radius';
import PlaceAdjust from './PlaceAdjust';

const INPUT = 'w-full text-sm text-navy-900 dark:text-white bg-black/5 dark:bg-white/5 border border-navy-200 dark:border-white/20 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-gold-400/50';

/**
 * Location reminder on a note: the place it's tied to, or — for a place the app
 * doesn't know yet — "Where is <place>?" with current location / address search /
 * a saved place. The answer is saved as a place (the spoken words become an alias).
 */
export default function GeoPlacePrompt({ note, onChanged }) {
  const geo = note.geo;
  const [mode, setMode] = useState(null);       // null | 'search' | 'saved' | 'adjust'
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [places, setPlaces] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const ask = geo?.status === 'needs_place';
  const [open, setOpen] = useState(ask);

  useEffect(() => {
    if (open && !places) getPlaces().then(setPlaces).catch(() => {});
  }, [open, places]);

  if (!geo || note.undone) return null;

  async function save(body, kind) {
    setBusy(kind);
    setError(null);
    try {
      onChanged?.(await setGeoPlace(note.id, body));
      syncErrands(); // the phone arms the geofence now
      setOpen(false);
      setMode(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not save the place');
    } finally {
      setBusy(null);
    }
  }

  async function useHere() {
    setBusy('here');
    setError(null);
    try {
      const pos = await currentPosition();
      let address = null;
      try { address = (await reversePlace(pos.lat, pos.lng)).address || null; } catch { /* still save the spot */ }
      // Where you stand is a point: a normal-size circle (change it on the map if needed)
      await save({ lat: pos.lat, lng: pos.lng, address, name: titleCase(geo.query) }, 'here');
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  }

  async function runSearch(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy('search');
    try { setResults((await searchPlaces(q.trim())).results || []); }
    catch (err) { setError(err.response?.data?.error || 'Search failed'); }
    finally { setBusy(null); }
  }

  // Fresh pin + radius after "Adjust on the map" (the note keeps a copy of the place)
  async function adjusted() {
    setMode(null);
    await save({ placeId: geo.placeId }, 'adjust');
  }
  const savedPlace = geo.placeId && geo.placeId !== 'home' ? (places?.saved || []).find(p => p.id === geo.placeId) : null;
  const adjustable = geo.status === 'active' && geo.placeId && Number.isFinite(geo.lat);

  const status = geo.status === 'done' ? 'Done' : geo.status === 'active' ? 'Active' : geo.status === 'needs_place' ? 'Needs a place' : geo.status;

  return (
    <div className={`rounded-2xl px-3 py-2.5 mb-3 ${ask ? 'border border-amber-400/50 bg-amber-500/10' : 'bg-navy-50 dark:bg-white/5'}`}>
      <div className="flex items-center gap-2">
        <MapPin size={16} className={ask ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-400'} />
        <p className="flex-1 min-w-0 text-sm font-semibold text-navy-900 dark:text-white">
          {ask ? `Where is “${geo.query}”?` : geoLabel(geo)}
        </p>
        <span className={`badge ${geo.status === 'active' ? 'badge-green' : ask ? 'badge-orange' : 'badge-slate'} !text-[10px]`}>{status}</span>
        {!ask && <button className="btn-ghost text-xs py-1" onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Change'}</button>}
      </div>
      {ask && <p className="text-xs text-navy-600 dark:text-white/65 mt-1">{geo.error || 'Tell me once — it’s saved, so next time I know.'}</p>}
      {!ask && geo.address && <p className="text-xs text-navy-500 dark:text-white/50 mt-0.5 pl-6 break-words">{geo.address}</p>}
      {!ask && Number.isFinite(geo.radiusM) && (
        <p className="text-xs text-navy-500 dark:text-white/50 pl-6">Fires within {radiusLabel(geo.radiusMode || 'auto', geo.radiusM)} of the pin</p>
      )}

      {open && (
        <div className="mt-2.5 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-white text-xs py-1.5 px-3" onClick={useHere} disabled={!!busy}>
              {busy === 'here' ? <Loader2 size={13} className="animate-spin" /> : <LocateFixed size={13} />} Use my current location
            </button>
            <button type="button" className={`btn-white text-xs py-1.5 px-3 ${mode === 'search' ? 'ring-2 ring-gold-400/50' : ''}`} onClick={() => setMode(m => (m === 'search' ? null : 'search'))}>
              <Search size={13} /> Search an address
            </button>
            <button type="button" className={`btn-white text-xs py-1.5 px-3 ${mode === 'saved' ? 'ring-2 ring-gold-400/50' : ''}`} onClick={() => setMode(m => (m === 'saved' ? null : 'saved'))}>
              <Home size={13} /> Pick a saved place
            </button>
            {adjustable && (
              <button type="button" className={`btn-white text-xs py-1.5 px-3 ${mode === 'adjust' ? 'ring-2 ring-gold-400/50' : ''}`} onClick={() => setMode(m => (m === 'adjust' ? null : 'adjust'))}>
                <MapIcon size={13} /> Adjust on the map
              </button>
            )}
            {!ask && (
              <button type="button" className="btn-ghost text-xs" onClick={() => save({ when: geo.when === 'leave' ? 'arrive' : 'leave', placeId: geo.placeId }, 'when')} disabled={!!busy || !geo.placeId}>
                <ArrowLeftRight size={13} /> Remind when I {geo.when === 'leave' ? 'arrive' : 'leave'} instead
              </button>
            )}
            <button type="button" className="btn-ghost text-xs text-red-600 dark:text-red-400" onClick={() => save({ remove: true }, 'remove')} disabled={!!busy}>
              <X size={13} /> Remove location
            </button>
          </div>

          {mode === 'search' && (
            <div>
              <form onSubmit={runSearch} className="flex gap-2">
                <input className={INPUT} value={q} onChange={e => setQ(e.target.value)} placeholder={`Address or name of “${geo.query}”`} aria-label="Search an address" autoFocus />
                <button className="btn-gold text-sm" disabled={!q.trim() || busy === 'search'}>{busy === 'search' ? '…' : 'Search'}</button>
              </form>
              {results && (
                <ul className="mt-2 space-y-1 max-h-52 overflow-y-auto">
                  {results.length === 0 && <li className="text-xs text-navy-500">No matches — try a fuller address.</li>}
                  {results.slice(0, 8).map((r, i) => (
                    <li key={i}>
                      <button type="button" className="w-full text-left rounded-xl px-3 py-2 hover:bg-gold-500/10" onClick={() => save({ lat: r.lat, lng: r.lng, address: r.address, name: r.name || titleCase(geo.query), areaRadiusM: r.areaRadiusM || null }, 'pick')}>
                        <span className="block text-sm font-semibold text-navy-900 dark:text-white">{r.name}</span>
                        <span className="block text-xs text-navy-500 dark:text-white/50">{r.address}{Number.isFinite(r.distanceM) ? ` · ${(r.distanceM / 1609).toFixed(1)} mi` : ''}{r.areaRadiusM ? ` · large place, ${formatRadius(r.areaRadiusM)} circle` : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {mode === 'saved' && places && (
            <ul className="space-y-1">
              {places.home && (
                <li><button type="button" className="w-full text-left rounded-xl px-3 py-2 hover:bg-gold-500/10 flex items-center gap-2" onClick={() => save({ placeId: 'home' }, 'pick')}>
                  <Home size={14} /> <span className="text-sm font-semibold">Home</span><span className="text-xs text-navy-500 truncate">{places.home.address}</span>
                </button></li>
              )}
              {(places.saved || []).map(p => (
                <li key={p.id}><button type="button" className="w-full text-left rounded-xl px-3 py-2 hover:bg-gold-500/10 flex items-center gap-2" onClick={() => save({ placeId: p.id }, 'pick')}>
                  {p.kind === 'work' ? <Briefcase size={14} /> : <MapPin size={14} />}
                  <span className="text-sm font-semibold">{p.name}</span>
                  <span className="text-xs text-navy-500 truncate">{(p.aliases || []).join(', ')}</span>
                </button></li>
              ))}
              {!places.home && !(places.saved || []).length && <li className="text-xs text-navy-500">No saved places yet.</li>}
            </ul>
          )}
          {mode === 'adjust' && adjustable && (
            <PlaceAdjust
              key={geo.placeId}
              place={{ id: geo.placeId, lat: geo.lat, lng: geo.lng, address: geo.address, radiusMode: geo.radiusMode || savedPlace?.radiusMode || 'auto',
                radiusM: savedPlace?.radiusM ?? (geo.radiusMode === 'custom' ? geo.radiusM : null), autoRadiusM: savedPlace?.autoRadiusM ?? (geo.placeId === 'home' ? places?.home?.autoRadiusM : null) }}
              onSaved={adjusted}
              onCancel={() => setMode(null)}
            />
          )}
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

function titleCase(s) {
  return String(s || '').replace(/^(my|the)\s+/i, '').replace(/\b\w/g, c => c.toUpperCase()) || 'Place';
}
