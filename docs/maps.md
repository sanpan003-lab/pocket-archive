# Self-hosted map

The maps in Pocket Archive (Settings → Places & errands → **Map**, and the small maps in reminder
and errand notes) use **OpenStreetMap** data in the [Protomaps](https://protomaps.com) format. Everything
is served by your own server; the browser and the app never contact a map company.
*Directions* still opens Google Maps.

| What | Where |
|---|---|
| Map file | `ARCHIVE/09_Maps/florida.pmtiles` (≈ 1.1 GB, Florida, zoom 0–15). On the PC: `P:\09_Maps\florida.pmtiles` |
| Fonts and icons | `ARCHIVE/09_Maps/assets/`, fetched once from `protomaps.github.io/basemaps-assets` and then served locally |
| Server | `maps.js`: `GET /api/maps/status`, `/api/maps/tiles/<name>.pmtiles` (HTTP range requests), `/api/maps/fonts/…`, `/api/maps/sprites/…`. Signed-in only; the app uses its media token (`?mt=`). |
| Web/app | `src/components/places/MapView.jsx` (MapLibre GL + `pmtiles` + `@protomaps/basemaps`, loaded only when a map is shown) |

**The map file is never committed to git** (it's large and it's data, not code). It lives only in the archive.

## Updating the map

OpenStreetMap changes every day; refreshing the map every few months is plenty.

1. Download the `pmtiles` command-line tool for Windows from
   <https://github.com/protomaps/go-pmtiles/releases> (`go-pmtiles_*_Windows_x86_64.zip`) and unzip it
   into an empty folder.
2. Pick a daily planet build from <https://maps.protomaps.com/builds/> (file names look like
   `20261016.pmtiles`). Extract Florida (only the needed parts are downloaded, about 1 GB):

   ```bat
   pmtiles.exe extract https://build.protomaps.com/20261016.pmtiles florida.pmtiles ^
     --bbox=-87.64,24.39,-79.97,31.01 --maxzoom=15
   ```

3. Check it: `pmtiles.exe show florida.pmtiles` (bounds, max zoom 15, tile type MVT).
4. Copy it over the old one: `copy /Y florida.pmtiles P:\09_Maps\florida.pmtiles`.
   No restart or rebuild is needed; reload the page.

## Another area

- Change `--bbox` (west,south,east,north in degrees; <https://boundingbox.klokantech.com> → CSV) and
  the file name, for example `georgia.pmtiles`. Lower `--maxzoom` (e.g. 14) for a smaller file.
- The app shows the map named `florida` when it exists, otherwise the first `.pmtiles` file in
  `09_Maps` (see `/api/maps/status`).
- Several areas can sit side by side; only one is shown at a time.

## Troubleshooting

- *"The map file isn't installed on the server yet."* → `09_Maps/florida.pmtiles` is missing or
  unreadable; check `GET /api/maps/status`.
- Map area stays blank but markers show → the browser couldn't start the map worker or WebGL is
  off. Check the browser console. The Vite build bundles MapLibre's worker
  (`maplibre-gl-worker-*.js` in `dist/assets`).
- No labels → the server couldn't fetch the fonts once from `protomaps.github.io`; check internet
  access from the NAS, or copy `09_Maps/assets/` from a machine that has them.
