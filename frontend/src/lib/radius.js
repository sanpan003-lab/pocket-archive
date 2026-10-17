// Location-reminder radius per place (server: places.js radiusFor). Auto = the place's
// OpenStreetMap area (airport, campus, mall…), at least 150 m (home 100 m), at most 2 km.
export const RADIUS_OPTIONS = [
  { value: 'auto', label: 'Auto', hint: 'Fits the place' },
  { value: 'small', label: 'Small', meters: 100 },
  { value: 'medium', label: 'Medium', meters: 250 },
  { value: 'large', label: 'Large', meters: 500 },
  { value: 'xl', label: 'Extra large', meters: 1000 },
];
export const MIN_RADIUS_M = 100;
export const MAX_RADIUS_M = 2000;

/** "150 m", "1.2 km" */
export function formatRadius(m) {
  if (!Number.isFinite(m)) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

/** Distance for "from you now": "350 m", "2.4 mi" (US) */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return '';
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1609.34).toFixed(m < 16000 ? 1 : 0)} mi`;
}

export function radiusLabel(mode, meters) {
  const opt = RADIUS_OPTIONS.find(o => o.value === mode);
  if (mode === 'custom') return `${formatRadius(meters)} (custom)`;
  if (!opt || mode === 'auto') return `${formatRadius(meters)} (Auto)`;
  return `${formatRadius(meters)} (${opt.label})`;
}
