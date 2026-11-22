// Tiny zero-dependency server:
//   * serves the built app from /dist
//   * proxies /api/icu/*  ->  https://intervals.icu/api/v1/*   (avoids CORS, can hold the API key server-side)
//   * optional Strava OAuth + activity fetch under /api/strava/*
// Run: `npm run build && npm start`  (or `npm run dev` for hot reload)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
loadDotEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 8787);
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = path.join(ROOT, 'data');
const STRAVA_TOKEN_FILE = path.join(DATA_DIR, 'strava-tokens.json');
const ICU_BASE = 'https://intervals.icu/api/v1';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- intervals.icu proxy ----------
async function proxyIntervals(req, res, url) {
  const sub = url.pathname.replace(/^\/api\/icu/, '');
  const target = ICU_BASE + sub + url.search;
  const headers = { accept: 'application/json' };
  if (req.headers.authorization) {
    headers.authorization = req.headers.authorization;
  } else if (process.env.ICU_API_KEY) {
    headers.authorization = 'Basic ' + Buffer.from('API_KEY:' + process.env.ICU_API_KEY).toString('base64');
  } else {
    return sendJson(res, 401, { error: 'No intervals.icu API key. Add it in Settings or set ICU_API_KEY in .env.' });
  }
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await readBody(req);
    headers['content-type'] = req.headers['content-type'] || 'application/json';
  }
  try {
    const r = await fetch(target, { method: req.method, headers, body });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, {
      'content-type': r.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    });
    res.end(buf);
  } catch (e) {
    sendJson(res, 502, { error: 'Could not reach intervals.icu: ' + e.message });
  }
}

// ---------- Strava ----------
const stravaConfigured = () => Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);

function readTokens() {
  try {
    return JSON.parse(fs.readFileSync(STRAVA_TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function writeTokens(t) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STRAVA_TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
}

async function stravaToken(params) {
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      ...params,
    }),
  });
  if (!r.ok) throw new Error(`Strava token error ${r.status}: ${await r.text()}`);
  return r.json();
}

async function validAccessToken() {
  let t = readTokens();
  if (!t) return null;
  if (t.expires_at * 1000 < Date.now() + 60_000) {
    const fresh = await stravaToken({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    t = { ...t, ...fresh };
    writeTokens(t);
  }
  return t.access_token;
}

async function handleStrava(req, res, url) {
  const route = url.pathname.replace(/^\/api\/strava/, '');
  if (route === '/status') {
    const t = readTokens();
    return sendJson(res, 200, {
      configured: stravaConfigured(),
      connected: Boolean(t),
      athlete: t?.athlete ? { id: t.athlete.id, name: `${t.athlete.firstname ?? ''} ${t.athlete.lastname ?? ''}`.trim() } : null,
    });
  }
  if (!stravaConfigured()) return sendJson(res, 400, { error: 'Strava is not configured on the server (.env).' });

  if (route === '/login') {
    const redirect = `${PUBLIC_URL}/api/strava/callback`;
    const q = new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      redirect_uri: redirect,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'read,activity:read_all',
    });
    res.writeHead(302, { location: `https://www.strava.com/oauth/authorize?${q}` });
    return res.end();
  }
  if (route === '/callback') {
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(302, { location: '/#/settings?strava=denied' });
      return res.end();
    }
    try {
      const t = await stravaToken({ grant_type: 'authorization_code', code });
      writeTokens(t);
      res.writeHead(302, { location: '/#/settings?strava=connected' });
    } catch (e) {
      console.error(e);
      res.writeHead(302, { location: '/#/settings?strava=error' });
    }
    return res.end();
  }
  if (route === '/disconnect' && req.method === 'POST') {
    try {
      fs.unlinkSync(STRAVA_TOKEN_FILE);
    } catch {
      /* already gone */
    }
    return sendJson(res, 200, { ok: true });
  }
  if (route === '/activities') {
    try {
      const token = await validAccessToken();
      if (!token) return sendJson(res, 401, { error: 'Strava not connected' });
      const after = url.searchParams.get('after') || String(Math.floor(Date.now() / 1000) - 90 * 86400);
      const all = [];
      for (let page = 1; page <= 5; page++) {
        const r = await fetch(
          `https://www.strava.com/api/v3/athlete/activities?after=${encodeURIComponent(after)}&per_page=100&page=${page}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        if (!r.ok) return sendJson(res, r.status, { error: await r.text() });
        const batch = await r.json();
        all.push(...batch);
        if (batch.length < 100) break;
      }
      return sendJson(res, 200, all);
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }
  sendJson(res, 404, { error: 'Unknown Strava route' });
}

// ---------- static ----------
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(DIST, p));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(DIST, 'index.html');
  if (!fs.existsSync(target)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('App not built yet. Run `npm run build` (or use `npm run dev`).');
  }
  const ext = path.extname(target);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(target).pipe(res);
}

// ---------- optional password gate (set APP_PASSWORD when the server is reachable by others) ----------
function isAuthed(req) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return true;
  if (req.headers['x-app-password'] === pw) return true;
  const cookie = req.headers.cookie || '';
  return cookie.split(/;\s*/).some((c) => c === `app_pw=${encodeURIComponent(pw)}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/health') {
      const authed = isAuthed(req);
      return sendJson(res, 200, {
        ok: true,
        proxy: true,
        authRequired: Boolean(process.env.APP_PASSWORD),
        authed,
        serverIcuKey: authed && Boolean(process.env.ICU_API_KEY),
        serverAthleteId: authed ? process.env.ICU_ATHLETE_ID || null : null,
        strava: stravaConfigured(),
      });
    }
    if (url.pathname.startsWith('/api/') && !isAuthed(req)) {
      return sendJson(res, 401, { error: 'Server password required (Settings → Connection).' });
    }
    if (url.pathname.startsWith('/api/icu/')) return await proxyIntervals(req, res, url);
    if (url.pathname.startsWith('/api/strava/')) return await handleStrava(req, res, url);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Training App server on http://localhost:${PORT}`);
  if (!process.env.ICU_API_KEY) console.log('  (no ICU_API_KEY in .env — the app will ask for it in Settings)');
  if (!stravaConfigured()) console.log('  (Strava disabled — set STRAVA_CLIENT_ID/SECRET in .env to enable)');
});
