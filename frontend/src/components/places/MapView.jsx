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

/** Bounds of a circle (for framing) */
function circleBounds(c) {
  const dLat = c.radiusM / 111320;
  const dLng = c.radiusM / (111320 * Math.cos((c.lat * Math.PI) / 180));
  return [[c.lng - dLng, c.lat - dLat], [c.lng + dLng, c.lat + dLat]];
}

/** Small "250 m" chip at the top edge of a circle */
function radiusChip(text, color) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `font:600 11px/1 Inter,system-ui,sans-serif;color:#fff;background:${color};padding:3px 6px;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none;white-space:nowrap`;
  return el;
}
const chipPos = c => [c.lng, c.lat + c.radiusM / 111320];
const fmt = m => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${Math.round(m)} m`);

/**
 * Self-hosted OpenStreetMap (Protomaps). markers: [{ id, lat, lng, label, color, sub?, onClick? }],
 * circles: [{ lat, lng, radiusM, color, label? }] (label: show the size on the map).
 * edit: { lat, lng, radiusM, color, onMove({lat,lng}) } — a draggable pin with a live circle
 * (radius changes update in place, no map rebuild). Frames all markers and circles.
 */
export default function MapView({ mapName, markers = [], circles = [], height = 320, interactive = true, edit = null }) {
  const box = useRef(null);
  const map = useRef(null);
  const editState = useRef(null);   // { marker, chip }
  const editRef = useRef(edit);
  const { darkMode } = useAppearance();
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(0);

  useEffect(() => { editRef.current = edit; });

  useEffect(() => {
    if (!box.current) return undefined;
    ensureProtocol();
    const first = editRef.current || markers[0];
    const m = new maplibregl.Map({
      container: box.current,
      style: style(mapName, darkMode),
      center: first ? [first.lng, first.lat] : [-81.5, 28.1],
      zoom: first ? 13 : 6,
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
    for (const c of circles) {
      if (c.label) new maplibregl.Marker({ element: radiusChip(c.label, c.color || '#F59E0B'), anchor: 'bottom' }).setLngLat(chipPos(c)).addTo(m);
    }

    // Draggable pin (Change → adjust on the map)
    const edit0 = editRef.current;
    if (edit0) {
      const el = document.createElement('div');
      el.setAttribute('aria-label', 'Drag to move the place');
      el.style.cssText = `width:26px;height:26px;border-radius:999px;background:${edit0.color || '#EF4444'};border:4px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.45);cursor:grab`;
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([edit0.lng, edit0.lat]).addTo(m);
      const chip = new maplibregl.Marker({ element: radiusChip(fmt(edit0.radiusM), edit0.color || '#EF4444'), anchor: 'bottom' }).setLngLat(chipPos(edit0)).addTo(m);
      editState.current = { marker, chip };
      const live = () => {
        const p = marker.getLngLat();
        const cur = { ...editRef.current, lat: p.lat, lng: p.lng };
        m.getSource('edit')?.setData(circle(cur.lat, cur.lng, cur.radiusM));
        chip.setLngLat(chipPos(cur));
      };
      marker.on('drag', live);
      marker.on('dragend', () => { const p = marker.getLngLat(); editRef.current?.onMove?.({ lat: p.lat, lng: p.lng }); });
    }

    // Frame everything: markers, circles (a 2 km airport circle shouldn't be cut off) and the edited place
    const boxes = [...markers.map(mk => [[mk.lng, mk.lat], [mk.lng, mk.lat]]), ...circles.map(circleBounds), ...(edit0 ? [circleBounds(edit0)] : [])];
    if (boxes.length) {
      const b = new maplibregl.LngLatBounds();
      boxes.forEach(([sw, ne]) => { b.extend(sw); b.extend(ne); });
      const single = boxes.length === 1 && boxes[0][0][0] === boxes[0][1][0];
      if (single) m.jumpTo({ center: boxes[0][0], zoom: 15 });
      else m.fitBounds(b, { padding: 36, maxZoom: 16, duration: 0 });
    }

    m.on('load', () => {
      if (circles.length) {
        m.addSource('fences', { type: 'geojson', data: { type: 'FeatureCollection', features: circles.map(c => ({ ...circle(c.lat, c.lng, c.radiusM), properties: { color: c.color || '#F59E0B' } })) } });
        m.addLayer({ id: 'fences-fill', type: 'fill', source: 'fences', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 } });
        m.addLayer({ id: 'fences-line', type: 'line', source: 'fences', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.7 } });
      }
      const e = editRef.current;
      if (e) {
        m.addSource('edit', { type: 'geojson', data: circle(e.lat, e.lng, e.radiusM) });
        m.addLayer({ id: 'edit-fill', type: 'fill', source: 'edit', paint: { 'fill-color': e.color || '#EF4444', 'fill-opacity': 0.16 } });
        m.addLayer({ id: 'edit-line', type: 'line', source: 'edit', paint: { 'line-color': e.color || '#EF4444', 'line-width': 2, 'line-dasharray': [2, 1] } });
      }
      setLoaded(n => n + 1);
    });
    return () => { m.remove(); map.current = null; editState.current = null; };
    // Rebuild when the data or theme changes (not for edits: those update in place below)
  }, [mapName, darkMode, interactive, !!edit, JSON.stringify(markers), JSON.stringify(circles)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Radius slider / pin moved from outside: update the circle, the pin and the size chip in place
  useEffect(() => {
    const m = map.current;
    const st = editState.current;
    if (!m || !st || !edit) return;
    st.marker.setLngLat([edit.lng, edit.lat]);
    st.chip.setLngLat(chipPos(edit));
    st.chip.getElement().textContent = fmt(edit.radiusM);
    m.getSource('edit')?.setData(circle(edit.lat, edit.lng, edit.radiusM));
    // A new size (not a drag): frame the circle so 100 m and 2 km both stay visible
    if (st.radiusM !== undefined && st.radiusM !== edit.radiusM) {
      const [sw, ne] = circleBounds(edit);
      m.fitBounds([sw, ne], { padding: 40, maxZoom: 17, duration: 300 });
    }
    st.radiusM = edit.radiusM;
  }, [edit?.lat, edit?.lng, edit?.radiusM, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

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
