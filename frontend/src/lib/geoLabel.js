/** "When you get home" / "When you get to Work" / "When you leave the gym" */
export function geoLabel(geo) {
  if (!geo) return '';
  const name = geo.placeId === 'home' ? 'home' : (geo.name || geo.query);
  if (geo.when === 'leave') return `When you leave ${name}`;
  return geo.placeId === 'home' ? 'When you get home' : `When you get to ${name}`;
}
