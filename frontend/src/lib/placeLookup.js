// Address lookups: OpenStreetMap on the server first; in the Android app, the phone's built-in
// Geocoder (free, no API key) is the fallback when OpenStreetMap finds nothing or can't be reached.
import { searchPlaces, reversePlace, setHomeLocation } from './api';
import { isNative } from './platform';
import { QuickRecorder } from '../native/quickRecorder';

function distanceM(a, b) {
  const R = 6371000;
  const rad = x => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Android Geocoder: [{ name, address, lat, lng, source: 'device' }] (empty outside the app / when unavailable) */
export async function deviceGeocode(query, near) {
  if (!isNative || !query?.trim()) return [];
  try {
    const r = await QuickRecorder.geocode({ query: query.trim(), ...(near ? { nearLat: near.lat, nearLng: near.lng } : {}) });
    return (r.results || []).map(x => ({ ...x, distanceM: near ? distanceM(near, x) : null }));
  } catch {
    return [];
  }
}

export async function deviceReverse(lat, lng) {
  if (!isNative) return null;
  try { return (await QuickRecorder.reverseGeocode({ lat, lng })).address || null; } catch { return null; }
}

/**
 * Place search → { home, results, fallback }. fallback = true when the results came from the phone.
 * near: home ({ lat, lng }) to sort the phone's results by distance.
 */
export async function findPlaces(query, near = null) {
  let data = null;
  let error = null;
  try { data = await searchPlaces(query); } catch (err) { error = err; }
  if (data?.results?.length) return { ...data, fallback: false };
  const device = await deviceGeocode(query, near);
  if (device.length) return { home: data?.home ?? !!near, results: device, fallback: true };
  if (error) throw error;
  return { ...(data || { results: [] }), fallback: false };
}

/** Nearest street address for a GPS spot: server (OpenStreetMap) first, then the phone. */
export async function findAddress(lat, lng) {
  let found = null;
  try { found = await reversePlace(lat, lng); } catch { /* try the phone */ }
  if (found?.address) return found;
  const address = await deviceReverse(lat, lng);
  return address ? { address, fallback: true } : (found || { address: null, error: "Couldn't look up the address" });
}

/**
 * Home from a typed address: the server tries OpenStreetMap → US Census → ZIP center. If none
 * of them can find it (or the server can't reach them), the app asks the phone's Geocoder and
 * saves those coordinates with the address as typed.
 */
export async function setHomeFromAddress(address) {
  try {
    return await setHomeLocation(address);
  } catch (err) {
    const status = err.response?.status;
    if (!isNative || (status && status !== 404 && status !== 503 && status !== 502)) throw err;
    const [hit] = await deviceGeocode(address);
    if (!hit) throw err;
    return setHomeLocation({ lat: hit.lat, lng: hit.lng, source: 'geocoder', address: address.trim() });
  }
}
