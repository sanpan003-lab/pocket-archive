// Runs after `cap sync android` (see "build:android" in package.json).
//
// Points the Android app at the NAS: the WebView loads the app's screens from
// the server (server.url), so `deploy-to-nas.bat` updates the app's UI without
// a new APK. If the server can't be reached, Capacitor shows the bundled
// offline.html (server.errorPath) with a Retry button.
//
// The server address comes from .env.android (gitignored), so it never ends
// up in the committed capacitor.config.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env.android');
const assets = join(root, 'android', 'app', 'src', 'main', 'assets');
const configFile = join(assets, 'capacitor.config.json');

function fail(message) {
  console.error(`android-config: ${message}`);
  process.exit(1);
}

if (!existsSync(envFile)) fail('.env.android is missing (copy .env.android.example and set VITE_API_BASE_URL)');
const match = readFileSync(envFile, 'utf8').match(/^\s*VITE_API_BASE_URL\s*=\s*["']?([^"'\r\n]+?)["']?\s*$/m);
if (!match) fail('VITE_API_BASE_URL is not set in .env.android');

let origin;
try {
  origin = new URL(match[1]).origin; // same URL as the API, without /api or a trailing slash
} catch {
  fail(`VITE_API_BASE_URL is not a valid URL: ${match[1]}`);
}
if (!origin.startsWith('https://')) fail('VITE_API_BASE_URL must use https://');
if (!existsSync(configFile)) fail('run `npx cap sync android` first');

const config = JSON.parse(readFileSync(configFile, 'utf8'));
config.server = { ...config.server, url: origin, errorPath: 'offline.html' };
writeFileSync(configFile, `${JSON.stringify(config, null, '\t')}\n`);

// offline.html reads this to know where "Retry" goes
writeFileSync(join(assets, 'public', 'server-url.js'), `window.PA_SERVER_URL = ${JSON.stringify(`${origin}/`)};\n`);

// Offline (2.9.0): Capacitor's error page IS the app — the screens bundled here, opened at the NAS address when it
// can't be reached (the app then runs on its offline copy). The app shell (ShellClient) also serves them directly.
const publicDir = join(assets, 'public');
writeFileSync(join(publicDir, 'offline.html'), readFileSync(join(publicDir, 'index.html')));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
writeFileSync(join(publicDir, 'bundle-version.json'), `${JSON.stringify({ version, builtAt: new Date().toISOString() })}\n`);

console.log(`android-config: app loads ${origin}; bundled screens ${version} (offline: offline.html = the app)`);
