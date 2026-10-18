// Places for errands: home location, saved places ("My Places" with aliases),
// and store lookups using free OpenStreetMap services (no Google Maps billing).
//
// - Nominatim (geocoding): https://operations.osmfoundation.org/policies/nominatim/
//   real User-Agent, at most 1 request/second, results cached.
// - Overpass (chain stores near home, by brand/name tags), cached for 30 days.
//
// Home + saved places live in config.json (CONFIG_PATH, never in git); the
// lookup cache sits next to it in places-cache.json.

const fs   = require('fs');
const path = require('path');

const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
// Public Overpass servers are often busy: try each, then fall back to Nominatim
const OVERPASS_URLS = (process.env.OVERPASS_URL
  || 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter')
  .split(',').map(u => u.trim()).filter(Boolean);
// Home address fallbacks: US Census Bureau geocoder (free, no key; often knows
// new streets before OpenStreetMap does), then the ZIP code's center
const CENSUS_URL    = process.env.CENSUS_GEOCODER_URL || 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const ZIP_URL       = process.env.ZIP_LOOKUP_URL || 'https://api.zippopotam.us/us';
const USER_AGENT    = process.env.PLACES_USER_AGENT
  || 'PocketArchive/1.0 (self-hosted personal voice-note archive; errand reminders)';

const CHAIN_RADIUS_M   = 24140;              // 15 miles
const MAX_BRANCHES     = 20;
const CACHE_DAYS       = 30;
const NOMINATIM_GAP_MS = 1100;               // > 1 request/second
const DEFAULT_ERRAND_SETTINGS = { arrivalForStoreErrands: true, arrivalExpiryDays: 14 };

// ── Geometry ────────────────────────────────────────────────────────────────

function distanceM(a, b) {
  const R = 6371000;
  const rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const round5 = n => Math.round(n * 1e5) / 1e5;

// Location-reminder radius per place: Auto (default) = the OpenStreetMap area of the place
// (airport, campus, mall, park…) from its bounding box, at least 150 m (home 100 m), at most 2 km.
const RADIUS_PRESETS = { small: 100, medium: 250, large: 500, xl: 1000 };
const RADIUS_MODES = ['auto', ...Object.keys(RADIUS_PRESETS), 'custom'];
const MIN_RADIUS_M = 100;
const MAX_RADIUS_M = 2000;
const clampRadius = m => Math.round(Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, m)));

/** Nominatim boundingbox [south, north, west, east] → radius (m) that covers it from the point, or null for point-like results. */
function areaRadiusFromBox(box, point) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [s, n, w, e] = box.map(Number);
  if (![s, n, w, e].every(Number.isFinite)) return null;
  const corners = [{ lat: s, lng: w }, { lat: s, lng: e }, { lat: n, lng: w }, { lat: n, lng: e }];
  const center = { lat: (s + n) / 2, lng: (w + e) / 2 };
  // Half the box diagonal = the size of the area; also make sure the circle around the pin reaches most of it
  const half = distanceM(center, corners[3]);
  if (half < 120) return null; // a building or an address: the normal radius is right
  const fromPin = point ? Math.max(...corners.map(c => distanceM(point, c))) * 0.8 : half;
  return clampRadius(Math.max(half, fromPin));
}

/** Effective radius for a personal place (home or saved) */
function radiusFor(place, { home = false } = {}) {
  const mode = RADIUS_MODES.includes(place?.radiusMode) ? place.radiusMode : 'auto';
  if (mode === 'custom' && Number.isFinite(place.radiusM)) return clampRadius(place.radiusM);
  if (RADIUS_PRESETS[mode]) return RADIUS_PRESETS[mode];
  const auto = Number.isFinite(place?.autoRadiusM) && place.autoRadiusM > 0 ? place.autoRadiusM : 0;
  return clampRadius(Math.max(home ? 100 : 150, auto));
}

/** { radiusMode, radiusM } from a request body (null = leave unchanged) */
function cleanRadius(body = {}) {
  if (body.radiusMode === undefined && body.radiusM === undefined) return null;
  const mode = RADIUS_MODES.includes(body.radiusMode) ? body.radiusMode : (Number.isFinite(Number(body.radiusM)) ? 'custom' : 'auto');
  return { radiusMode: mode, radiusM: mode === 'custom' ? clampRadius(Number(body.radiusM)) : null };
}
/** Stable id for a store location (also the Android geofence request id). */
const branchKey = p => `${round5(p.lat).toFixed(5)},${round5(p.lng).toFixed(5)}`;

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The lookup service couldn't answer (offline, timeout, 5xx) — as opposed to "no match". */
class LookupUnavailable extends Error {}

const HOME_SOURCES = {
  openstreetmap: 'OpenStreetMap',
  census:        'US Census Bureau',
  zip:           'ZIP code center (approximate)',
  phone:         'Phone location',
  browser:       'Browser location',
  geocoder:      "Phone's address lookup (Android Geocoder)",
};

// Last 5-digit group, e.g. "…, Orlando, FL 32801-1234" → "32801"
function zipOf(address) {
  const all = String(address || '').match(/\b\d{5}(?:-\d{4})?\b/g);
  return all ? all[all.length - 1].slice(0, 5) : null;
}

/**
 * For logs: city and ZIP only — never the street. "Orlando, FL 32801" → 'city "Orlando", ZIP 32801'
 */
function logArea(address) {
  const parts = String(address || '').split(',').map(x => x.trim()).filter(Boolean);
  const zip = zipOf(address);
  // City = the part before "FL 32801" / "FL" / "32801" (only when there's a street part before it)
  const tail = parts.findIndex((x, i) => i > 0 && /^([A-Za-z]{2}|[A-Za-z .]+)?\s*\d{5}(-\d{4})?$|^[A-Za-z]{2}$/.test(x));
  const city = tail > 1 ? parts[tail - 1] : (parts.length >= 3 ? parts[parts.length - 2] : null);
  const bits = [city && !/\d/.test(city) ? `city "${city}"` : null, zip ? `ZIP ${zip}` : null].filter(Boolean);
  return bits.length ? bits.join(', ') : 'area unknown';
}

const titleCase = s => String(s || '').toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase())
  .replace(/\b(Ne|Nw|Se|Sw|Fl|Ga|Al|Sc|Nc|Tx|Ca|Ny)\b/g, m => m.toUpperCase());

async function httpJson(url, label, timeoutMs = 12000) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new LookupUnavailable(err.name === 'TimeoutError' ? `${label} timed out` : `${label} unreachable`);
  }
  if (res.status === 404) return null; // e.g. unknown ZIP
  if (!res.ok) throw new LookupUnavailable(`${label} HTTP ${res.status}`);
  try { return await res.json(); }
  catch { throw new LookupUnavailable(`${label} sent an invalid response`); }
}

// ── OSM helpers ─────────────────────────────────────────────────────────────

function addressFromTags(t = {}) {
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const cityLine = [t['addr:city'], [t['addr:state'], t['addr:postcode']].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [street, cityLine].filter(Boolean).join(', ') || null;
}

// Nominatim result → short US-style address ("123 Main St, Springfield, IL 62701")
function addressFromNominatim(r) {
  const a = r.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.hamlet || a.suburb;
  const state = a['ISO3166-2-lvl4']?.split('-')[1] || a.state;
  const cityLine = [city, [state, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [street, cityLine].filter(Boolean).join(', ') || r.display_name || null;
}

// One request queue for the whole server (every user's places share Nominatim's 1 request/second limit)
let nominatimChain = Promise.resolve();
let lastNominatimAt = 0;

function createPlaces({ getConfig, saveConfig, cacheFile }) {
  // quickCapture updates its reminders when a place moves or its radius changes
  const placesListeners = [];
  const onPlacesChanged = () => placesListeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
  const onChange = fn => { placesListeners.push(fn); };

  // ── Cache (places-cache.json) ────────────────────────────────────────────
  let cache = null;
  function loadCache() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { cache = {}; }
    return cache;
  }
  function cacheGet(key, maxAgeDays = CACHE_DAYS) {
    const hit = loadCache()[key];
    if (!hit) return null;
    if (Date.now() - new Date(hit.at).getTime() > maxAgeDays * 86400000) return null;
    return hit.value;
  }
  function cacheSet(key, value) {
    const c = loadCache();
    c[key] = { at: new Date().toISOString(), value };
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(c), 'utf8');
    } catch (err) {
      console.warn(`[places] Could not write cache: ${err.message}`);
    }
  }

  // ── Nominatim: one request at a time, ≥ 1.1 s apart ──────────────────────
  function nominatim(pathAndQuery) {
    const run = async () => {
      const wait = lastNominatimAt + NOMINATIM_GAP_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lastNominatimAt = Date.now();
      const email = process.env.NOMINATIM_EMAIL ? `&email=${encodeURIComponent(process.env.NOMINATIM_EMAIL)}` : '';
      let res;
      try {
        res = await fetch(`${NOMINATIM_URL}${pathAndQuery}${email}`, {
          headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
          signal: AbortSignal.timeout(10000),
        });
      } catch (err) {
        throw new LookupUnavailable(err.name === 'TimeoutError' ? 'OpenStreetMap timed out' : 'OpenStreetMap unreachable');
      }
      if (!res.ok) throw new LookupUnavailable(`OpenStreetMap HTTP ${res.status}`);
      return res.json();
    };
    const p = nominatimChain.then(run, run);
    nominatimChain = p.catch(() => {});
    return p;
  }

  /** Address/place → [{ name, address, lat, lng }] (cached). */
  async function geocode(query, { near, limit = 5 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const nearKey = near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '';
    const key = `geo:${norm(q)}:${nearKey}:${limit}`;
    const cached = cacheGet(key, 180);
    if (cached) return cached;

    let params = `format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(q)}`;
    if (near) {
      // Prefer results around home (≈ 30 km box), but don't exclude others
      const d = 0.3;
      params += `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}&bounded=0`;
    }
    const results = (await nominatim(`/search?${params}`)).map(r => ({
      name:    r.name || r.display_name?.split(',')[0] || q,
      address: addressFromNominatim(r),
      lat:     Number(r.lat),
      lng:     Number(r.lon),
      osm:     r.osm_type && r.osm_id ? `${r.osm_type[0]}${r.osm_id}` : null,
      areaRadiusM: areaRadiusFromBox(r.boundingbox, { lat: Number(r.lat), lng: Number(r.lon) }),
      kind:    r.category || r.class || null,
      // Street-level (not just a city or ZIP area)
      street:  !!(r.address?.road || r.address?.house_number || r.address?.building || r.address?.amenity || r.address?.shop),
    })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    if (near) results.sort((a, b) => distanceM(near, a) - distanceM(near, b));
    cacheSet(key, results);
    return results;
  }

  async function reverseAddress(p) {
    const key = `rev:${branchKey(p)}`;
    const cached = cacheGet(key, 180);
    if (cached !== null) return cached;
    try {
      const r = await nominatim(`/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${p.lat}&lon=${p.lng}`);
      const address = r && !r.error ? addressFromNominatim(r) : null;
      cacheSet(key, address);
      return address;
    } catch (err) {
      console.warn(`[places] Reverse geocode failed: ${err.message}`);
      return null;
    }
  }

  // ── A brand's stores near home (cached 30 days) ──────────────────────────

  // Bounding box around home (cheaper for Overpass than "around")
  function boxAround(home, radiusM) {
    const dLat = radiusM / 111320;
    const dLng = radiusM / (111320 * Math.cos((home.lat * Math.PI) / 180));
    return { s: home.lat - dLat, w: home.lng - dLng, n: home.lat + dLat, e: home.lng + dLng };
  }

  async function overpassStores(brand, box) {
    const esc = brand.replace(/[\^$.*+?()[\]{}|"]/g, '\$&');
    const bbox = `(${box.s.toFixed(4)},${box.w.toFixed(4)},${box.n.toFixed(4)},${box.e.toFixed(4)})`;
    // Stores only (shop=*), matched by name or brand, case-insensitive
    // ("The Home Depot" should match "Home Depot", so no ^ anchor)
    const query = `[out:json][timeout:15];(nwr["shop"]["name"~"${esc}",i]${bbox};nwr["shop"]["brand"~"${esc}",i]${bbox};);out center tags;`;
    let lastErr;
    for (const url of OVERPASS_URLS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
        const data = await res.json();
        return (data.elements || []).map(el => ({
          tags: el.tags || {},
          lat: el.lat ?? el.center?.lat,
          lng: el.lon ?? el.center?.lon,
        }));
      } catch (err) {
        lastErr = err;
        console.warn(`[places] ${new URL(url).host}: ${err.message}`);
      }
    }
    throw lastErr || new Error('Overpass unavailable');
  }

  // Fallback: Nominatim name search limited to the box around home
  async function nominatimStores(brand, box) {
    const params = `format=jsonv2&addressdetails=1&limit=40&bounded=1&q=${encodeURIComponent(brand)}`
      + `&viewbox=${box.w},${box.n},${box.e},${box.s}`;
    const wanted = norm(brand);
    return (await nominatim(`/search?${params}`))
      .filter(r => norm(r.name || '').includes(wanted) || norm(r.address?.shop || '').includes(wanted))
      .map(r => ({ name: r.name, address: addressFromNominatim(r), lat: Number(r.lat), lng: Number(r.lon), shop: true }));
  }

  async function chainBranches(brand, home) {
    const key = `chain:${norm(brand)}:${home.lat.toFixed(3)},${home.lng.toFixed(3)}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const box = boxAround(home, CHAIN_RADIUS_M);
    let found;
    try {
      found = (await overpassStores(brand, box)).map(e => ({
        name: e.tags.name || e.tags.brand || brand, address: addressFromTags(e.tags), lat: e.lat, lng: e.lng,
        shop: !!e.tags.shop && !/pharmacy|fuel|liquor|alcohol/.test(e.tags.shop),
      }));
    } catch {
      found = [];
    }
    if (!found.length) found = await nominatimStores(brand, box); // Overpass down or empty

    const stores = [];
    for (const f of found) {
      if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) continue;
      const p = { name: f.name, address: f.address, lat: round5(f.lat), lng: round5(f.lng), main: f.shop };
      // Pharmacy / liquor store / gas station of the same branch → one location
      const dup = stores.find(s => distanceM(s, p) < 200);
      if (dup) {
        if (p.main && !dup.main) Object.assign(dup, p, { address: p.address || dup.address });
        else if (!dup.address && p.address) dup.address = p.address;
        continue;
      }
      stores.push(p);
    }
    const nearest = stores
      .map(s => ({ name: s.name, address: s.address, lat: s.lat, lng: s.lng, distanceM: distanceM(home, s) }))
      .filter(s => s.distanceM <= CHAIN_RADIUS_M)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, MAX_BRANCHES);
    if (nearest.length) cacheSet(key, nearest); // don't cache a miss caused by a flaky server
    return nearest;
  }

  // ── Config: home, saved places, errand settings ──────────────────────────
  const placesConfig = () => getConfig().places || {};

  function updatePlacesConfig(fn) {
    const config = getConfig();
    config.places = fn({ ...(config.places || {}) });
    saveConfig(config);
    return config.places;
  }

  const getHome = () => placesConfig().home || null;
  const keepRadius = place => (place?.radiusMode ? { radiusMode: place.radiusMode, radiusM: place.radiusM ?? null } : {});
  const getSaved = () => placesConfig().saved || [];
  const getErrandSettings = () => ({ ...DEFAULT_ERRAND_SETTINGS, ...(placesConfig().errandSettings || {}) });

  /**
   * Address → home coordinates: OpenStreetMap → US Census Bureau → ZIP code center.
   * Throws 404 (no source matched) or 503 (no source could be reached).
   * Logs only city/ZIP, never the street.
   */
  async function geocodeHome(address) {
    const outcomes = []; // "openstreetmap: no match", "census: timed out", …
    let reachedAny = false;
    const tryIt = async (source, fn) => {
      try {
        const hit = await fn();
        reachedAny = true;
        if (hit) return { ...hit, source };
        outcomes.push(`${source}: no match`);
      } catch (err) {
        if (!(err instanceof LookupUnavailable)) throw err;
        outcomes.push(`${source}: ${err.message}`);
      }
      return null;
    };

    const hit =
      await tryIt('openstreetmap', async () => {
        const [h] = await geocode(address, { limit: 1 });
        // "1234 New Street, …" matching only the city/ZIP area isn't good enough — let Census try
        if (h && /^\s*\d/.test(address) && h.street === false) return null;
        return h && { lat: h.lat, lng: h.lng, displayName: h.address || h.name };
      })
      || await tryIt('census', async () => {
        const data = await httpJson(`${CENSUS_URL}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`, 'US Census', 15000);
        const m = data?.result?.addressMatches?.[0];
        return m && Number.isFinite(m.coordinates?.y) && { lat: m.coordinates.y, lng: m.coordinates.x, displayName: titleCase(m.matchedAddress) };
      })
      || await (async () => {
        const zip = zipOf(address);
        if (!zip) { outcomes.push('zip: no ZIP code in the address'); return null; }
        return tryIt('zip', async () => {
          const data = await httpJson(`${ZIP_URL}/${zip}`, 'ZIP lookup');
          const place = data?.places?.[0];
          const lat = Number(place?.latitude);
          const lng = Number(place?.longitude);
          return place && Number.isFinite(lat) && Number.isFinite(lng) && {
            lat, lng, approximate: true,
            displayName: `${place['place name']}, ${place['state abbreviation']} ${zip}`,
          };
        });
      })();

    if (hit) {
      if (outcomes.length) console.log(`[places] Home matched via ${hit.source} after ${outcomes.join('; ')} (${logArea(address)})`);
      return hit;
    }
    console.warn(`[places] Home geocode failed (${logArea(address)}): ${outcomes.join('; ')}`);
    if (!reachedAny) {
      throw Object.assign(new Error("Can't reach the address lookup service — try again"), { status: 503 });
    }
    const hint = zipOf(address)
      ? 'check the street and ZIP code, or use your current location'
      : 'add the ZIP code, or use your current location';
    throw Object.assign(new Error(`Address not found — ${hint}`), { status: 404 });
  }

  async function setHome(address) {
    const hit = await geocodeHome(String(address).trim());
    const home = {
      address: String(address).trim(), displayName: hit.displayName || null,
      lat: round5(hit.lat), lng: round5(hit.lng),
      source: hit.source, approximate: !!hit.approximate, geocodedAt: new Date().toISOString(),
    };
    updatePlacesConfig(p => ({ ...p, home: { ...keepRadius(p.home), ...home } }));
    onPlacesChanged();
    return getHome();
  }

  /** "Use my current location": save the coordinates as they are (no geocoding). */
  function setHomeFromCoords({ lat, lng, accuracyM, source, address }) {
    const home = {
      address: String(address || '').trim().slice(0, 200) || 'Current location',
      displayName: address ? String(address).trim().slice(0, 200) : null,
      lat: round5(lat), lng: round5(lng),
      accuracyM: Number.isFinite(accuracyM) ? Math.round(accuracyM) : null,
      source, approximate: false, geocodedAt: new Date().toISOString(),
    };
    updatePlacesConfig(p => ({ ...p, home: { ...keepRadius(p.home), ...home } }));
    console.log(`[places] Home set from ${source} location`);
    onPlacesChanged();
    return getHome();
  }

  /** Nearest street address to a point (for confirming "Use my current location"). */
  async function nearestAddress(lat, lng) {
    const r = await nominatim(`/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`);
    return r && !r.error ? addressFromNominatim(r) : null;
  }

  /** Saved place whose name or aliases match the query (case/punctuation-insensitive). */
  function findAlias(query) {
    const q = norm(query);
    if (!q) return null;
    return getSaved().find(p => [p.name, ...(p.aliases || [])].some(a => norm(a) === q))
      || (/^(work|my work|the office|office|my office|my job)$/.test(q) ? getSaved().find(p => p.kind === 'work') : null)
      || null;
  }

  const HOME_WORDS = /^(home|my home|my house|the house|house|my place|my apartment|the apartment)$/;

  /**
   * A personal place for a location reminder ("when I get home", "when I leave work",
   * "at my son's school"): home, a saved place (name / alias / Work), or null = ask the user.
   * Returns { placeId, name, address, lat, lng, radiusM } or null.
   */
  function personalPlace(query, placeId) {
    const home = getHome();
    if (placeId === 'home' || HOME_WORDS.test(norm(query))) {
      return home ? { placeId: 'home', name: 'Home', address: home.address || null, lat: home.lat, lng: home.lng,
        radiusM: radiusFor(home, { home: true }), radiusMode: home.radiusMode || 'auto' } : null;
    }
    const saved = (placeId && getSaved().find(p => p.id === placeId)) || findAlias(query);
    return saved ? { placeId: saved.id, name: saved.name, address: saved.address || null, lat: saved.lat, lng: saved.lng,
      radiusM: radiusFor(saved), radiusMode: saved.radiusMode || 'auto' } : null;
  }

  /** Short list for the classifier: id | name | aliases */
  function placesForPrompt() {
    const lines = [];
    const home = getHome();
    lines.push(home ? 'home | Home | my house, the house' : '(home not set)');
    for (const p of getSaved()) lines.push(`${p.id} | ${p.name}${p.kind === 'work' ? ' (work)' : ''} | ${(p.aliases || []).join(', ') || '-'}`);
    return lines.join('\n');
  }

  /**
   * Nearby search for the Settings picker: a brand's stores (Overpass)
   * plus geocoder results, nearest to home first.
   */
  async function search(query) {
    const home = getHome();
    const q = String(query || '').trim();
    if (!q) return [];
    const out = [];
    if (home) {
      try { out.push(...(await chainBranches(q, home))); }
      catch (err) { console.warn(`[places] Overpass search failed: ${err.message}`); }
    }
    if (out.length < 3) {
      const geo = await geocode(q, { near: home || undefined, limit: 5 });
      for (const g of geo) {
        // Same place from both lookups: keep one, but keep the area size (Auto radius) from OpenStreetMap
        const dup = out.find(o => distanceM(o, g) < 200);
        if (dup) { if (g.areaRadiusM && !dup.areaRadiusM) dup.areaRadiusM = g.areaRadiusM; continue; }
        out.push({ ...g, distanceM: home ? distanceM(home, g) : null });
      }
    }
    // Fill in missing street addresses for the first few (reverse geocode, rate limited)
    for (const r of out.slice(0, 5)) {
      if (!r.address) r.address = await reverseAddress(r);
    }
    return out.slice(0, MAX_BRANCHES);
  }

  /**
   * spec: { query, kind: 'chain'|'specific'|null } from the classifier →
   * { query, kind, name, address, lat, lng, source, savedPlaceId, branches[], resolved, error }
   * Never throws: unresolved places are kept with an error message.
   */
  async function resolve(spec) {
    const query = String(spec?.query || '').trim();
    const kind = spec?.kind === 'chain' || spec?.kind === 'specific' ? spec.kind : null;
    if (!query) return null;
    const base = { query, kind, name: query, address: null, lat: null, lng: null, source: null, savedPlaceId: null, branches: [], resolved: false, error: null };
    const home = getHome();

    try {
      const alias = findAlias(query);
      let branches = [];
      if (kind === 'chain' && home) {
        try { branches = await chainBranches(alias?.chain || query, home); }
        catch (err) { console.warn(`[places] Chain lookup failed for "${query}": ${err.message}`); }
      }

      if (alias) {
        // My usual store: calendar location; all nearby branches still trigger
        const own = { name: alias.name, address: alias.address, lat: alias.lat, lng: alias.lng, distanceM: home ? distanceM(home, alias) : null };
        if (!branches.some(b => distanceM(b, own) < 200)) branches = [own, ...branches].slice(0, MAX_BRANCHES);
        return withKeys({ ...base, name: alias.name, address: alias.address, lat: alias.lat, lng: alias.lng, source: 'saved', savedPlaceId: alias.id, branches, resolved: true });
      }

      if (kind === 'chain') {
        if (!home) return { ...base, error: 'Set your home location in Settings to find nearby stores' };
        if (!branches.length) return { ...base, error: `No ${query} stores found within 15 miles of home` };
        const nearest = { ...branches[0] };
        if (!nearest.address) nearest.address = await reverseAddress(nearest);
        branches[0] = nearest;
        return withKeys({ ...base, name: nearest.name || query, address: nearest.address, lat: nearest.lat, lng: nearest.lng, source: 'osm', branches, resolved: true });
      }

      // Specific place (or unknown kind): geocode, near home when known
      const [hit] = await geocode(query, { near: home || undefined, limit: 3 });
      if (!hit) return { ...base, error: `Couldn't find "${query}"` };
      const place = { name: hit.name, address: hit.address, lat: hit.lat, lng: hit.lng, distanceM: home ? distanceM(home, hit) : null };
      return withKeys({ ...base, ...place, source: 'nominatim', branches: [place], resolved: true });
    } catch (err) {
      console.warn(`[places] Resolve failed for "${query}": ${err.message}`);
      return { ...base, error: `Place lookup failed: ${err.message}` };
    }
  }

  function withKeys(place) {
    place.branches = (place.branches || []).slice(0, MAX_BRANCHES).map(b => ({ ...b, key: branchKey(b) }));
    return place;
  }

  // ── Routes (all behind the /api auth guard) ───────────────────────────────
  function register(app) {
    app.get('/api/places', (_req, res) => {
      res.json({ home: getHome(), saved: getSaved(), errandSettings: getErrandSettings() });
    });

    // PUT /api/places/home
    //   { address }                                   → geocode (OpenStreetMap → Census → ZIP center)
    //   { lat, lng, accuracyM?, source, address? }    → "Use my current location" (saved as is)
    app.put('/api/places/home', async (req, res) => {
      const body = req.body || {};
      if (body.lat !== undefined || body.lng !== undefined) {
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          return res.status(400).json({ error: 'lat/lng are invalid' });
        }
        // geocoder = the app found the typed address with Android's Geocoder (OpenStreetMap couldn't)
        const source = ['phone', 'geocoder'].includes(body.source) ? body.source : 'browser';
        return res.json(setHomeFromCoords({ lat, lng, accuracyM: Number(body.accuracyM), source, address: body.address }));
      }
      const address = String(body.address || '').trim().slice(0, 200);
      if (!address) return res.status(400).json({ error: 'address is required' });
      try {
        res.json(await setHome(address));
      } catch (err) {
        if (!err.status) console.warn(`[places] Home lookup error: ${err.message}`);
        res.status(err.status || 502).json({ error: err.status ? err.message : "Can't reach the address lookup service — try again" });
      }
    });

    // GET /api/places/reverse?lat=&lng= — nearest address, to confirm a GPS location
    app.get('/api/places/reverse', async (req, res) => {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return res.status(400).json({ error: 'lat/lng are invalid' });
      }
      try {
        res.json({ address: await nearestAddress(lat, lng) });
      } catch (err) {
        console.warn(`[places] Reverse lookup failed: ${err.message}`);
        // The location can still be saved without an address
        res.json({ address: null, error: "Can't reach the address lookup service" });
      }
    });

    app.delete('/api/places/home', (_req, res) => {
      updatePlacesConfig(p => ({ ...p, home: null }));
      res.json({ success: true });
    });

    // GET /api/places/search?q=Publix — nearby results to pick a store from
    app.get('/api/places/search', async (req, res) => {
      const q = String(req.query.q || '').trim().slice(0, 100);
      if (!q) return res.status(400).json({ error: 'q is required' });
      try {
        res.json({ home: !!getHome(), results: await search(q) });
      } catch (err) {
        res.status(502).json({ error: `Place search failed: ${err.message}` });
      }
    });

    // POST /api/places/saved { name, aliases[], address, lat, lng, chain? }
    app.post('/api/places/saved', (req, res) => {
      const place = cleanSaved(req.body);
      if (place.error) return res.status(400).json({ error: place.error });
      place.id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      updatePlacesConfig(p => ({ ...p, saved: [...(p.saved || []), place] }));
      res.json(place);
    });

    // PUT /api/places/saved/:id — rename, change aliases, or pick another store
    app.put('/api/places/saved/:id', (req, res) => {
      const existing = getSaved().find(p => p.id === req.params.id);
      if (!existing) return res.status(404).json({ error: 'Place not found' });
      const place = cleanSaved({ ...existing, ...req.body });
      if (place.error) return res.status(400).json({ error: place.error });
      place.id = existing.id;
      updatePlacesConfig(p => ({ ...p, saved: (p.saved || []).map(s => (s.id === place.id ? place : s)) }));
      onPlacesChanged();
      res.json({ ...place, effectiveRadiusM: radiusFor(place) });
    });

    app.delete('/api/places/saved/:id', (req, res) => {
      if (!getSaved().some(p => p.id === req.params.id)) return res.status(404).json({ error: 'Place not found' });
      updatePlacesConfig(p => ({ ...p, saved: (p.saved || []).filter(s => s.id !== req.params.id) }));
      res.json({ success: true });
    });

    // POST /api/places/work { lat, lng, address?, accuracyM? } — "Set Work to my current location"
    // (creates the Work place or moves it; a point, so Auto = 150 m unless a radius is chosen)
    app.post('/api/places/work', (req, res) => {
      const b = req.body || {};
      const work = getSaved().find(p => p.kind === 'work');
      const place = cleanSaved({
        ...(work || { name: 'Work', aliases: ['work', 'the office', 'my work'] }),
        lat: b.lat, lng: b.lng, address: b.address || (work ? null : 'Current location'),
        kind: 'work', autoRadiusM: null, autoCheckedAt: new Date().toISOString(),
        ...(cleanRadius(b) || {}),
      });
      if (place.error) return res.status(400).json({ error: place.error });
      place.id = work?.id || `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      updatePlacesConfig(p => ({ ...p, saved: work ? (p.saved || []).map(s => (s.id === place.id ? place : s)) : [...(p.saved || []), place] }));
      onPlacesChanged();
      res.json({ ...place, effectiveRadiusM: radiusFor(place) });
    });

    // PUT /api/places/radius/:id { radiusMode: auto|small|medium|large|xl|custom, radiusM? } (:id = home or a saved place)
    app.put('/api/places/radius/:id', (req, res) => {
      const r = cleanRadius(req.body);
      if (!r) return res.status(400).json({ error: 'radiusMode or radiusM is required' });
      if (req.params.id === 'home') {
        if (!getHome()) return res.status(404).json({ error: 'Set your home location first' });
        updatePlacesConfig(p => ({ ...p, home: { ...p.home, ...r } }));
        onPlacesChanged();
        return res.json({ id: 'home', ...r, effectiveRadiusM: radiusFor(getHome(), { home: true }) });
      }
      const existing = getSaved().find(p => p.id === req.params.id);
      if (!existing) return res.status(404).json({ error: 'Place not found' });
      const next = { ...existing, ...r };
      updatePlacesConfig(p => ({ ...p, saved: (p.saved || []).map(s => (s.id === next.id ? next : s)) }));
      onPlacesChanged();
      res.json({ id: next.id, ...r, effectiveRadiusM: radiusFor(next) });
    });

    // Saved places from before 1.2.0 have no area size: look them up once (in the background)
    setTimeout(() => backfillAreas().catch(err => console.warn(`[places] Area backfill failed: ${err.message}`)), 15000).unref?.();

    // GET/PUT /api/errands/settings
    app.get('/api/errands/settings', (_req, res) => res.json(getErrandSettings()));
    app.put('/api/errands/settings', (req, res) => {
      const body = req.body || {};
      const next = { ...getErrandSettings() };
      if (typeof body.arrivalForStoreErrands === 'boolean') next.arrivalForStoreErrands = body.arrivalForStoreErrands;
      if (body.arrivalExpiryDays !== undefined) {
        const days = parseInt(body.arrivalExpiryDays, 10);
        if (!(days >= 1 && days <= 90)) return res.status(400).json({ error: 'arrivalExpiryDays must be 1–90' });
        next.arrivalExpiryDays = days;
      }
      updatePlacesConfig(p => ({ ...p, errandSettings: next }));
      res.json(next);
    });
  }

  function cleanSaved(body = {}) {
    const name = String(body.name || '').trim().slice(0, 80);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!name) return { error: 'name is required' };
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { error: 'Pick a place from the search results' };
    }
    const aliases = (Array.isArray(body.aliases) ? body.aliases : String(body.aliases || '').split(','))
      .map(a => String(a).trim().slice(0, 60)).filter(Boolean);
    return {
      name,
      aliases: [...new Set(aliases)],
      address: body.address ? String(body.address).trim().slice(0, 200) : null,
      lat: round5(lat), lng: round5(lng),
      chain: body.chain ? String(body.chain).trim().slice(0, 60) : null,
      kind: body.kind === 'work' ? 'work' : body.kind === 'store' ? 'store' : 'other',
      radiusMode: RADIUS_MODES.includes(body.radiusMode) ? body.radiusMode : 'auto',
      radiusM: body.radiusMode === 'custom' && Number.isFinite(Number(body.radiusM)) ? clampRadius(Number(body.radiusM)) : null,
      // OpenStreetMap area size (Auto radius); null = a point (address, current location, dragged pin)
      autoRadiusM: Number.isFinite(Number(body.autoRadiusM)) && Number(body.autoRadiusM) > 0 ? clampRadius(Number(body.autoRadiusM)) : null,
      autoCheckedAt: body.autoCheckedAt || (body.autoRadiusM !== undefined ? new Date().toISOString() : null),
    };
  }

  /** Save a place the user just told us about ("Where is my son's school?") with the spoken words as an alias */
  function savePlace(body) {
    const place = cleanSaved(body);
    if (place.error) return place;
    const existing = getSaved().find(p => Math.abs(p.lat - place.lat) < 0.0002 && Math.abs(p.lng - place.lng) < 0.0002);
    if (existing) {
      const merged = { ...existing, aliases: [...new Set([...(existing.aliases || []), ...place.aliases])] };
      updatePlacesConfig(p => ({ ...p, saved: (p.saved || []).map(s => (s.id === existing.id ? merged : s)) }));
      return merged;
    }
    place.id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    updatePlacesConfig(p => ({ ...p, saved: [...(p.saved || []), place] }));
    return place;
  }

  /**
   * Saved places without an area size (saved before 1.2.0): geocode the name near the pin
   * and take the OpenStreetMap area of the match within 1.5 km. Runs once per place.
   */
  async function backfillAreas() {
    let changed = 0;
    for (const place of getSaved()) {
      if (place.autoCheckedAt || place.kind === 'store') continue;
      let area = null;
      try {
        const hits = await geocode(place.name, { near: place, limit: 5 });
        const hit = hits.find(h => distanceM(h, place) < 1500 && h.areaRadiusM);
        area = hit ? hit.areaRadiusM : null;
      } catch (err) {
        if (!(err instanceof LookupUnavailable)) console.warn(`[places] Area lookup failed: ${err.message}`);
        continue; // try again next start
      }
      updatePlacesConfig(p => ({ ...p, saved: (p.saved || []).map(s => (s.id === place.id ? { ...s, autoRadiusM: area, autoCheckedAt: new Date().toISOString() } : s)) }));
      if (area) { changed++; console.log(`[places] "${place.name}" is an area: Auto radius ${area} m`); }
    }
    if (changed) onPlacesChanged();
  }



  return { register, resolve, search, geocode, getHome, getSaved, getErrandSettings, distanceM, branchKey, personalPlace, placesForPrompt, savePlace, radiusFor, backfillAreas, onChange };
}

module.exports = {
  createPlaces, HOME_SOURCES,
  RADIUS_PRESETS, MAX_RADIUS_M,
  _internal: { distanceM, branchKey, areaRadiusFromBox, radiusFor, cleanRadius, addressFromTags, addressFromNominatim, zipOf, logArea, titleCase },
};
