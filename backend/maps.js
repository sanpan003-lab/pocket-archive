// Self-hosted OpenStreetMap map (Protomaps PMTiles) for the in-app maps.
//
//   ARCHIVE/09_Maps/<name>.pmtiles   the map (e.g. florida.pmtiles) — served with HTTP range requests
//   ARCHIVE/09_Maps/assets/…         map fonts (glyphs) and icon sprites, fetched once from the
//                                    Protomaps basemaps-assets site and then served from here
//
// Update / replace the map: see docs/maps.md. The map file is never in git.
const fs = require('fs');
const path = require('path');

const ASSETS_BASE = 'https://protomaps.github.io/basemaps-assets';
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/i;
const FONT_RE = /^[A-Za-z0-9 ]{1,40}$/;
const RANGE_RE = /^\d{1,5}-\d{1,5}$/;
const SPRITE_RE = /^(light|dark|white|grayscale|black)(@2x)?\.(json|png)$/;

function createMaps({ archivePath }) {
  const dir = path.join(archivePath, '09_Maps');
  const assets = path.join(dir, 'assets');

  function list() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.pmtiles'))
      .map(f => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f.replace(/\.pmtiles$/, ''), file: f, bytes: st.size, updatedAt: st.mtime.toISOString() };
      });
  }

  // Fetch an asset once, keep it under 09_Maps/assets (fonts/sprites are a few KB each)
  async function cached(rel, url, res, type) {
    const file = path.join(assets, rel);
    if (!fs.existsSync(file)) {
      const r = await fetch(url, { headers: { 'User-Agent': 'PocketArchive/1.1 (self-hosted map)' } });
      if (!r.ok) return res.status(r.status === 404 ? 404 : 502).end();
      const buf = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
    }
    res.set('Cache-Control', 'private, max-age=2592000');
    if (type) res.type(type);
    res.sendFile(path.resolve(file));
  }

  function register(app) {
    // GET /api/maps/status — which map files are installed
    app.get('/api/maps/status', (_req, res) => {
      const maps = list();
      res.json({ available: maps.length > 0, maps, default: maps.find(m => m.name === 'florida')?.name || maps[0]?.name || null });
    });

    // GET /api/maps/tiles/<name>.pmtiles — byte ranges (MapLibre + the pmtiles library)
    app.get('/api/maps/tiles/:file', (req, res) => {
      const name = String(req.params.file).replace(/\.pmtiles$/, '');
      if (!NAME_RE.test(name)) return res.status(400).json({ error: 'Bad map name' });
      const file = path.join(dir, `${name}.pmtiles`);
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'Map not installed — see docs/maps.md' });
      res.set('Cache-Control', 'private, max-age=86400');
      res.sendFile(path.resolve(file), { acceptRanges: true, headers: { 'Content-Type': 'application/octet-stream' } });
    });

    // GET /api/maps/fonts/<stack>/<range>.pbf
    app.get('/api/maps/fonts/:stack/:range', async (req, res) => {
      const stack = String(req.params.stack);
      const range = String(req.params.range).replace(/\.pbf$/, '');
      if (!FONT_RE.test(stack) || !RANGE_RE.test(range)) return res.status(400).end();
      try {
        await cached(path.join('fonts', stack, `${range}.pbf`), `${ASSETS_BASE}/fonts/${encodeURIComponent(stack)}/${range}.pbf`, res, 'application/x-protobuf');
      } catch (err) {
        res.status(502).json({ error: err.message });
      }
    });

    // GET /api/maps/sprites/<flavor>[@2x].json|png
    app.get('/api/maps/sprites/:file', async (req, res) => {
      const file = String(req.params.file);
      if (!SPRITE_RE.test(file)) return res.status(400).end();
      try {
        await cached(path.join('sprites', file), `${ASSETS_BASE}/sprites/v4/${file}`, res, file.endsWith('.png') ? 'image/png' : 'application/json');
      } catch (err) {
        res.status(502).json({ error: err.message });
      }
    });
  }

  return { register, list };
}

module.exports = { createMaps };
