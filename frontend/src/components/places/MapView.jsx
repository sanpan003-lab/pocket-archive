import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import { layers, namedFlavor } from '@protomaps/basemaps';
import { mapUrl } from '../../lib/api';
import { useAppearance } from '../../context/appearanceStore';

// pmtiles:// → HTTP range requests to our own server (registered once)
let protocolAdded = false;
function ensureProtocol() {
  if (protocolAdded) return;
  // MapLibre 6 ships its worker as a separate ES module; Vite bundles it (?worker&url)
  maplibregl.setWorkerUrl(workerUrl);
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  protocolAdded = true;
}

function style(mapName, dark) {
  const flavor = dark ? 'dark' : 'light';
  const glyphs = mapUrl('fonts/{fontstack}/{range}.pbf');
  return {
    version: 8,
    glyphs,
    sprite: mapUrl(`sprites/${flavor}`).replace(/\?mt=.*$/, ''),
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${mapUrl(`tiles/${mapName}.pmtiles`)}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers('protomaps', namedFlavor(flavor), { lang: 'en' }),
  };
}

/** Circle polygon (meters) for geofence radii */
function circle(lat, lng, radiusM, steps = 48) {
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dLat = (radiusM / 111320) * Math.sin(a);
    const dLng = (radiusM / (111320 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a);
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

/**
 * Self-hosted OpenStreetMap (Protomaps). markers: [{ id, lat, lng, label, color, sub?, onClick? }],
 * circles: [{ lat, lng, radiusM, color }]. Fits all markers; one marker → zoom 15.
 */
export default function MapView({ mapName, markers = [], circles = [], height = 320, interactive = true }) {
  const box = useRef(null);
  const map = useRef(null);
  const { darkMode } = useAppearance();
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!box.current) return undefined;
    ensureProtocol();
    const m = new maplibregl.Map({
      container: box.current,
      style: style(mapName, darkMode),
      center: markers[0] ? [markers[0].lng, markers[0].lat] : [-81.5, 28.1],
      zoom: markers.length ? 13 : 6,
      attributionControl: { compact: true },
      interactive,
      // Sprites need the media token too (MapLibre appends .json/.png itself)
      transformRequest: url => (url.includes('/maps/sprites/') && !url.includes('mt=') ? { url: mapUrl(`sprites/${url.split('/maps/sprites/')[1]}`) } : { url }),
    });
    map.current = m;
    if (interactive) m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('error', e => { if (/pmtiles|404|Map not installed/i.test(e?.error?.message || '')) setError('The map file isn’t installed on the server yet.'); });

    // Markers and framing don't need the style; add them right away
    for (const mk of markers) {
      const el = document.createElement('button');
      el.type = 'button';
      el.setAttribute('aria-label', mk.label);
      el.style.cssText = `width:18px;height:18px;border-radius:999px;background:${mk.color || '#F59E0B'};border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35);cursor:pointer;padding:0`;
      const popup = new maplibregl.Popup({ offset: 14, closeButton: false })
        .setHTML(`<strong style="color:#0F172A">${escape(mk.label)}</strong>${mk.sub ? `<br><span style="color:#475569;font-size:12px">${escape(mk.sub)}</span>` : ''}`);
      new maplibregl.Marker({ element: el }).setLngLat([mk.lng, mk.lat]).setPopup(popup).addTo(m);
      if (mk.onClick) el.addEventListener('dblclick', mk.onClick);
    }
    if (markers.length > 1) {
      const b = new maplibregl.LngLatBounds();
      markers.forEach(mk => b.extend([mk.lng, mk.lat]));
      m.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 });
    } else if (markers.length === 1) {
      m.jumpTo({ center: [markers[0].lng, markers[0].lat], zoom: 15 });
    }
    m.on('load', () => {
      if (circles.length) {
        m.addSource('fences', { type: 'geojson', data: { type: 'FeatureCollection', features: circles.map(c => ({ ...circle(c.lat, c.lng, c.radiusM), properties: { color: c.color || '#F59E0B' } })) } });
        m.addLayer({ id: 'fences-fill', type: 'fill', source: 'fences', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 } });
        m.addLayer({ id: 'fences-line', type: 'line', source: 'fences', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.7 } });
      }
    });
    return () => { m.remove(); map.current = null; };
    // Rebuild when the data or theme changes
  }, [mapName, darkMode, interactive, JSON.stringify(markers), JSON.stringify(circles)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative rounded-2xl overflow-hidden border border-navy-100 dark:border-white/10" style={{ height }}>
      {/* Inline: maplibre-gl.css sets .maplibregl-map { position: relative }, which beats Tailwind's absolute */}
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {error && <div className="absolute inset-0 flex items-center justify-center bg-navy-50/90 dark:bg-black/70 text-sm text-navy-600 dark:text-white/70 p-4 text-center">{error}</div>}
    </div>
  );
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
