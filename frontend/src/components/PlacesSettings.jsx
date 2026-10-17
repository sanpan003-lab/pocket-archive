import { useCallback, useEffect, useState } from 'react';
import { MapPin, Home, Search, Trash2, Store, RefreshCw, CheckCircle2, BellRing, LocateFixed, Briefcase, Map as MapIcon } from 'lucide-react';
import {
  getPlaces, setHomeLocation, clearHomeLocation, searchPlaces,
  addSavedPlace, updateSavedPlace, deleteSavedPlace, updateErrandSettings, reversePlace, setWorkLocation,
} from '../lib/api';
import { radiusLabel } from '../lib/radius';
import PlaceAdjust from './places/PlaceAdjust';
import { isNative } from '../lib/platform';
import { currentPosition } from '../lib/geolocate';
import LocationReminders from './places/LocationReminders';
import PlacesMap from './places/PlacesMap';

/** Reminder radius of a place as the server computes it (places.js radiusFor) */
function effectiveRadius(p, home = false) {
  const presets = { small: 100, medium: 250, large: 500, xl: 1000 };
  if (p?.radiusMode === 'custom' && p.radiusM) return p.radiusM;
  if (presets[p?.radiusMode]) return presets[p.radiusMode];
  return Math.max(home ? 100 : 150, p?.autoRadiusM || 0);
}

const INPUT = 'w-full bg-navy-50/50 dark:bg-white/5 border border-navy-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-gold-400/50';

const miles = m => (Number.isFinite(m) ? `${(m / 1609.34).toFixed(m < 16093 ? 1 : 0)} mi` : '');
const errMsg = (err, fallback) => err.response?.data?.error
  || (err.request && !err.response ? "Can't reach your Pocket Archive server — check your connection" : fallback);

// Which lookup found the home location
const HOME_SOURCE = {
  openstreetmap: 'OpenStreetMap',
  census:        'US Census Bureau',
  zip:           'ZIP code center',
  phone:         'phone location',
  browser:       'browser location',
};

const GEO_ERRORS = {
  1: isNative
    ? 'Location permission is off — allow it for Pocket Archive in Android Settings → Apps.'
    : "Location access is blocked — allow it in your browser's site settings.",
  2: "Your location isn't available right now — check that location is on and try again.",
  3: 'Finding your location timed out — try again.',
};

/** Search nearby places and pick one (used to add a place or change the preferred store). */
function PlacePicker({ initialQuery = '', onPick, onCancel, busy }) {
  const [query, setQuery]     = useState(initialQuery);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(!!initialQuery);
  const [error, setError]     = useState('');

  // Sets state only once the request settles (also used for the initial search)
  const search = useCallback(q => searchPlaces(q)
    .then(data => {
      setResults(data.results);
      setError(data.home ? '' : 'Tip: set your home location first to see the stores closest to you.');
    })
    .catch(err => setError(errMsg(err, 'Search failed')))
    .finally(() => setLoading(false)), []);

  function run(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    search(query.trim());
  }

  // Changing the store: show the nearby results straight away
  useEffect(() => { if (initialQuery) search(initialQuery); }, [initialQuery, search]);

  return (
    <div className="mt-3 p-3 rounded-xl bg-navy-50/60 dark:bg-white/5">
      <form onSubmit={run} className="flex gap-2">
        <input className={INPUT} value={query} onChange={e => setQuery(e.target.value)} placeholder="Store or place, e.g. Publix" aria-label="Search places" />
        <button type="submit" className="btn-gold shrink-0" disabled={loading || !query.trim()} aria-label="Search">
          {loading ? <RefreshCw size={15} className="animate-spin" /> : <Search size={15} />}
        </button>
      </form>
      {error && <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">{error}</p>}
      {results && (
        results.length === 0 ? (
          <p className="text-sm text-navy-500 dark:text-white/50 mt-3">Nothing found nearby.</p>
        ) : (
          <ul className="mt-3 max-h-72 overflow-y-auto space-y-1.5">
            {results.map(r => (
              <li key={`${r.lat},${r.lng}`}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2.5 rounded-xl bg-white dark:bg-white/5 hover:bg-gold-500/10 border border-navy-100 dark:border-white/10 flex items-center gap-3 disabled:opacity-50"
                  onClick={() => onPick(r, query.trim())}
                  disabled={busy}
                >
                  <Store size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-navy-900 dark:text-white break-words">{r.name}</span>
                    <span className="block text-xs text-navy-500 dark:text-white/50 break-words">{r.address || 'Address unknown'}</span>
                  </span>
                  <span className="text-xs tabular-nums text-navy-400 dark:text-white/40 shrink-0">{miles(r.distanceM)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      <button type="button" className="btn-ghost text-xs mt-2" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="w-full flex items-center gap-3 py-2 text-left"
      onClick={() => onChange(!checked)}
    >
      <BellRing size={18} className="shrink-0 text-navy-500 dark:text-white/60" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-navy-900 dark:text-white">{label}</span>
        {hint && <span className="block text-xs text-navy-500 dark:text-white/50">{hint}</span>}
      </span>
      <span className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${checked ? 'bg-gold-500' : 'bg-navy-200 dark:bg-white/20'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

/** Settings → Places & errands: home location, errand options, My Places. */
export default function PlacesSettings() {
  const [data, setData]       = useState(null);
  const [error, setError]     = useState('');
  const [address, setAddress] = useState('');
  const [editingHome, setEditingHome] = useState(false);
  const [busy, setBusy]       = useState(null);
  const [picker, setPicker]   = useState(null);   // { mode: 'add' } | { mode: 'change', place }
  const [draft, setDraft]     = useState(null);   // picked result waiting for aliases
  const [saved, setSaved]     = useState('');
  const [located, setLocated] = useState(null);   // { lat, lng, accuracy, address, error } waiting for confirmation
  const [adjusting, setAdjusting] = useState(null); // 'home' | saved place id: pin + radius on the map

  const load = useCallback(() => {
    getPlaces().then(d => { setData(d); setError(''); }).catch(err => setError(errMsg(err, 'Could not load places')));
  }, []);
  useEffect(() => { load(); }, [load]);

  function flash(text) {
    setSaved(text);
    setTimeout(() => setSaved(''), 2500);
  }

  async function act(kind, fn, done) {
    setBusy(kind);
    setError('');
    try {
      await fn();
      load();
      if (done) flash(done);
    } catch (err) {
      setError(errMsg(err, 'Something went wrong'));
    } finally {
      setBusy(null);
    }
  }

  const saveHome = e => {
    e.preventDefault();
    act('home', async () => { await setHomeLocation(address.trim()); setEditingHome(false); setAddress(''); }, 'Home location saved');
  };

  // "Use my current location": phone GPS in the app (WebView geolocation), browser location on the web
  function locate() {
    setError('');
    setLocated(null);
    if (!navigator.geolocation) {
      setError(window.isSecureContext ? "This browser can't share its location." : 'Location needs a secure (https) connection.');
      return;
    }
    setBusy('locate');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        reversePlace(lat, lng)
          .then(found => setLocated({ lat, lng, accuracy, address: found.address, error: found.error }))
          .catch(err => setLocated({ lat, lng, accuracy, address: null, error: errMsg(err, "Couldn't look up the address") }))
          .finally(() => setBusy(null));
      },
      err => {
        setBusy(null);
        setError(GEO_ERRORS[err.code] || 'Could not get your location.');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  const saveLocated = () => act('home', async () => {
    await setHomeLocation({
      lat: located.lat, lng: located.lng, accuracyM: located.accuracy,
      source: isNative ? 'phone' : 'browser', address: located.address,
    });
    setLocated(null);
    setEditingHome(false);
    setAddress('');
  }, 'Home location saved');

  const locateButton = (short = false) => (
    <button type="button" className="btn-ghost text-xs" onClick={locate} disabled={busy === 'locate' || busy === 'home'}>
      <LocateFixed size={14} className={busy === 'locate' ? 'animate-pulse' : ''} />
      {busy === 'locate' ? 'Finding you…' : short ? 'Use current location' : 'Use my current location'}
    </button>
  );

  const setSetting = patch => act('settings', () => updateErrandSettings(patch));

  function picked(result, query) {
    if (picker?.mode === 'change') {
      const p = picker.place;
      act('place', async () => {
        await updateSavedPlace(p.id, { name: result.name, address: result.address, lat: result.lat, lng: result.lng, autoRadiusM: result.areaRadiusM || 0 });
        setPicker(null);
      }, `${p.aliases?.[0] || p.name} → ${result.address || result.name}`);
    } else {
      setDraft({ ...result, aliases: query, chain: query, kind: picker?.kind || 'store' });
      setPicker(null);
    }
  }

  const saveDraft = e => {
    e.preventDefault();
    act('place', async () => {
      await addSavedPlace({
        name: draft.label?.trim() || draft.name, address: draft.address, lat: draft.lat, lng: draft.lng,
        aliases: draft.aliases, chain: draft.kind === 'store' ? draft.chain : null, kind: draft.kind,
        autoRadiusM: draft.areaRadiusM || 0,
      });
      setDraft(null);
    }, 'Place saved');
  };

  // "Set Work to my current location": creates Work or moves it to where you stand
  async function workHere() {
    setBusy('work');
    setError('');
    try {
      const pos = await currentPosition();
      let address = null;
      try { address = (await reversePlace(pos.lat, pos.lng)).address || null; } catch { /* save the spot anyway */ }
      await setWorkLocation({ lat: pos.lat, lng: pos.lng, address });
      load();
      flash(`Work set to your current location${pos.accuracy ? ` (±${Math.round(pos.accuracy)} m)` : ''}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  // "Save where I am now": current GPS spot as a new personal place
  async function addHere() {
    setBusy('here');
    setError('');
    try {
      const pos = await currentPosition();
      let address = null;
      try { address = (await reversePlace(pos.lat, pos.lng)).address || null; } catch { /* save the spot anyway */ }
      setDraft({ name: address || 'Current location', address, lat: pos.lat, lng: pos.lng, aliases: '', chain: null, kind: 'other', label: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const home = data?.home;
  const settings = data?.errandSettings;

  return (
    <div id="places" className="glass-panel p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <MapPin size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Places &amp; errands</h2>
      </div>
      <p className="text-sm text-navy-600 dark:text-white/60 mb-4">
        Stores for your errand lists are found near home with OpenStreetMap. Your home address stays on your server.
      </p>
      {error && <p className="text-sm text-red-500 dark:text-red-400 mb-3">{error}</p>}
      {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400 mb-3 flex items-center gap-1.5"><CheckCircle2 size={14} /> {saved}</p>}

      {/* Home */}
      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/40 mb-2">Home location</h3>
      {data === null && !error ? (
        <div className="h-12 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" />
      ) : home && !editingHome ? (
        <div className="px-4 py-3 rounded-xl bg-navy-50/50 dark:bg-white/5">
          <div className="flex items-start gap-3">
            <Home size={16} className="mt-0.5 text-navy-500 dark:text-white/60 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-navy-900 dark:text-white break-words">{home.address}</p>
              {home.displayName && home.displayName !== home.address && (
                <p className="text-xs text-navy-500 dark:text-white/50 break-words">Found: {home.displayName}</p>
              )}
              {HOME_SOURCE[home.source] && (
                <p className="text-xs text-navy-500 dark:text-white/50 mt-0.5">
                  Matched by {HOME_SOURCE[home.source]}
                  {Number.isFinite(home.accuracyM) ? ` (±${home.accuracyM} m)` : ''}
                </p>
              )}
              <p className="text-xs text-navy-500 dark:text-white/50 mt-0.5">Reminders fire within {radiusLabel(home.radiusMode || 'auto', effectiveRadius(home, true))}</p>
              {home.approximate && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  Approximate — stores are found around your ZIP code’s center. Use your current location for a precise spot.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-start mt-1.5 pl-7">
            <div className="flex flex-wrap gap-1">
              <button className="btn-ghost text-xs" onClick={() => { setAddress(home.address); setEditingHome(true); }}>Change</button>
              <button className="btn-ghost text-xs" onClick={() => setAdjusting(a => (a === 'home' ? null : 'home'))}><MapIcon size={13} /> Pin &amp; radius</button>
              <button
                className="btn-ghost text-xs text-red-500 dark:text-red-400"
                onClick={() => window.confirm('Remove your home location? Chain stores can no longer be found nearby.') && act('home', clearHomeLocation)}
              >
                <Trash2 size={13} /> Remove
              </button>
            </div>
            {locateButton(true)}
          </div>
          {adjusting === 'home' && (
            <PlaceAdjust place={{ id: 'home', lat: home.lat, lng: home.lng, address: home.address, radiusMode: home.radiusMode, radiusM: home.radiusM, autoRadiusM: home.autoRadiusM }}
              onSaved={() => { setAdjusting(null); load(); flash('Home updated'); }} onCancel={() => setAdjusting(null)} />
          )}
        </div>
      ) : (
        <form onSubmit={saveHome} className="flex flex-col sm:flex-row gap-2">
          <input
            className={INPUT}
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Street, city, state"
            autoComplete="street-address"
            aria-label="Home address"
          />
          <div className="flex gap-2 shrink-0">
            <button type="submit" className="btn-gold" disabled={!address.trim() || busy === 'home'}>
              {busy === 'home' ? 'Finding…' : 'Save'}
            </button>
            {home && <button type="button" className="btn-ghost" onClick={() => setEditingHome(false)}>Cancel</button>}
          </div>
        </form>
      )}
      {(!home || editingHome) && data !== null && <div className="mt-1">{locateButton()}</div>}

      {/* Confirm the GPS spot before saving it */}
      {located && (
        <div className="mt-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5" role="group" aria-label="Confirm current location">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-1">Your current location</p>
          <p className="text-sm font-semibold text-navy-900 dark:text-white break-words">
            {located.address ? `Nearest address: ${located.address}` : 'No street address found nearby'}
          </p>
          <p className="text-xs text-navy-500 dark:text-white/50 mt-0.5">
            Accuracy about {Math.max(1, Math.round(located.accuracy || 0))} m
            {located.error ? ` · ${located.error} (the location can still be saved)` : ''}
          </p>
          <p className="text-xs text-navy-500 dark:text-white/50 mt-1">Save this spot as home? Nearby stores are found around it.</p>
          <div className="flex gap-2 mt-2">
            <button type="button" className="btn-gold text-sm" onClick={saveLocated} disabled={busy === 'home'}>
              {busy === 'home' ? 'Saving…' : 'Save as home'}
            </button>
            <button type="button" className="btn-ghost text-sm" onClick={() => setLocated(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Errand options */}
      {settings && (
        <div className="mt-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/40 mb-1">Errands</h3>
          <Toggle
            label="Remind me on arrival for store errands"
            hint="A dated store trip also reminds you when you get there (Android app)"
            checked={settings.arrivalForStoreErrands}
            onChange={v => setSetting({ arrivalForStoreErrands: v })}
            disabled={busy === 'settings'}
          />
          <label className="flex items-center gap-3 py-2 text-sm">
            <span className="flex-1 text-navy-700 dark:text-white/80">Arrival reminders expire after</span>
            <select
              className="bg-navy-50/50 dark:bg-white/5 border border-navy-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-navy-900 dark:text-white"
              value={settings.arrivalExpiryDays}
              onChange={e => setSetting({ arrivalExpiryDays: Number(e.target.value) })}
              disabled={busy === 'settings'}
            >
              {[7, 14, 30, 60].map(d => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
        </div>
      )}

      {/* My Places */}
      <div className="mt-5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/40 mb-1">My Places</h3>
        <p className="text-xs text-navy-500 dark:text-white/50 mb-2">
          Work, school, the gym, your usual stores. Say a name or alias (“my son’s school”, “Publix”) and the app knows where it is.
        </p>
        {data?.saved?.length > 0 && (
          <ul className="space-y-2">
            {data.saved.map(p => (
              <li key={p.id} className="px-4 py-3 rounded-xl bg-navy-50/50 dark:bg-white/5">
                <div className="flex items-start gap-3">
                  {p.kind === 'work' ? <Briefcase size={16} className="mt-0.5 shrink-0 text-sky-600 dark:text-sky-400" />
                    : p.kind === 'other' ? <MapPin size={16} className="mt-0.5 shrink-0 text-violet-600 dark:text-violet-400" />
                      : <Store size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-navy-900 dark:text-white break-words">
                      {p.kind === 'work' ? 'Work' : p.name}{p.aliases?.length ? <span className="font-normal text-navy-500 dark:text-white/50"> · {p.aliases.join(', ')}</span> : null}
                    </p>
                    <p className="text-xs text-navy-500 dark:text-white/50 break-words">{p.name}{p.address ? ` · ${p.address}` : ''}</p>
                    {p.kind !== 'store' && (
                      <p className="text-xs text-navy-500 dark:text-white/50">Reminders fire within {radiusLabel(p.radiusMode || 'auto', effectiveRadius(p))}{p.autoRadiusM && (p.radiusMode || 'auto') === 'auto' ? ' — large place' : ''}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 mt-1.5 pl-7">
                  <button className="btn-ghost text-xs" onClick={() => setPicker({ mode: 'change', place: p })}>{p.kind && p.kind !== 'store' ? 'Change place' : 'Change store'}</button>
                  {p.kind !== 'store' && (
                    <button className="btn-ghost text-xs" onClick={() => setAdjusting(a => (a === p.id ? null : p.id))}><MapIcon size={13} /> Pin &amp; radius</button>
                  )}
                  {p.kind === 'work' && (
                    <button className="btn-ghost text-xs" onClick={workHere} disabled={busy === 'work'}><LocateFixed size={13} className={busy === 'work' ? 'animate-pulse' : ''} /> {busy === 'work' ? 'Finding you…' : 'Set to my current location'}</button>
                  )}
                  <button
                    className="btn-ghost text-xs text-red-500 dark:text-red-400"
                    onClick={() => window.confirm(`Remove “${p.aliases?.[0] || p.name}”?`) && act('place', () => deleteSavedPlace(p.id))}
                  >
                    Remove
                  </button>
                </div>
                {adjusting === p.id && (
                  <PlaceAdjust place={{ id: p.id, lat: p.lat, lng: p.lng, address: p.address, radiusMode: p.radiusMode, radiusM: p.radiusM, autoRadiusM: p.autoRadiusM }}
                    onSaved={() => { setAdjusting(null); load(); flash(`${p.kind === 'work' ? 'Work' : p.name} updated`); }} onCancel={() => setAdjusting(null)} />
                )}
                {picker?.mode === 'change' && picker.place.id === p.id && (
                  <PlacePicker initialQuery={p.chain || p.aliases?.[0] || p.name} onPick={picked} onCancel={() => setPicker(null)} busy={busy === 'place'} />
                )}
              </li>
            ))}
          </ul>
        )}

        {draft ? (
          <form onSubmit={saveDraft} className="mt-3 p-3 rounded-xl bg-navy-50/60 dark:bg-white/5 space-y-2">
            <p className="text-sm font-semibold text-navy-900 dark:text-white break-words">{draft.name}</p>
            <p className="text-xs text-navy-500 dark:text-white/50 break-words">{draft.address || 'Address unknown'}</p>
            {draft.kind !== 'store' && (
              <>
                <label className="block text-xs font-semibold text-navy-600 dark:text-white/60" htmlFor="place-label">Name</label>
                <input id="place-label" className={INPUT} value={draft.label ?? ''} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder={draft.kind === 'work' ? 'Work' : 'e.g. Lincoln Elementary'} />
              </>
            )}
            <label className="block text-xs font-semibold text-navy-600 dark:text-white/60" htmlFor="place-aliases">
              Call it (aliases, comma-separated)
            </label>
            <input id="place-aliases" className={INPUT} value={draft.aliases} onChange={e => setDraft(d => ({ ...d, aliases: e.target.value }))} />
            <div className="flex gap-2">
              <button type="submit" className="btn-gold" disabled={!draft.aliases.trim() || busy === 'place'}>
                {busy === 'place' ? 'Saving…' : 'Save place'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </form>
        ) : picker?.mode === 'add' ? (
          <PlacePicker onPick={picked} onCancel={() => setPicker(null)} busy={busy === 'place'} />
        ) : (
          <div className="flex flex-wrap gap-1 mt-2">
            {!data?.saved?.some(p => p.kind === 'work') && (
              <>
                <button className="btn-ghost text-sm" onClick={() => setPicker({ mode: 'add', kind: 'work' })}><Briefcase size={15} /> Add Work</button>
                <button className="btn-ghost text-sm" onClick={workHere} disabled={busy === 'work'}><LocateFixed size={15} className={busy === 'work' ? 'animate-pulse' : ''} /> {busy === 'work' ? 'Finding you…' : 'Set Work to my current location'}</button>
              </>
            )}
            <button className="btn-ghost text-sm" onClick={() => setPicker({ mode: 'add', kind: 'other' })}><MapPin size={15} /> Add a place</button>
            <button className="btn-ghost text-sm" onClick={() => setPicker({ mode: 'add', kind: 'store' })}><Store size={15} /> Add a store</button>
            <button className="btn-ghost text-sm" onClick={addHere} disabled={busy === 'here'}><LocateFixed size={15} className={busy === 'here' ? 'animate-pulse' : ''} /> {busy === 'here' ? 'Finding you…' : 'Save where I am now'}</button>
          </div>
        )}
      </div>

      <LocationReminders />
      <PlacesMap places={data} />
    </div>
  );
}
