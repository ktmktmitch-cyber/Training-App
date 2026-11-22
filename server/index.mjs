// Zero-dependency server:
//   * serves the built app from /dist
//   * multi-user accounts: log in with your intervals.icu account (API key, or OAuth when
//     INTERVALS_CLIENT_ID/SECRET are set). Each user's credentials are stored encrypted and
//     their plan/settings/journal follow them across devices.
//   * proxies /api/icu/*  ->  intervals.icu/api/v1/*  with the logged-in user's credentials
//   * optional Strava OAuth (per user) under /api/strava/*
// Run: `npm run build && npm start`  (or `npm run dev` for hot reload)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAccounts } from './accounts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
loadDotEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 8787);
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const STRAVA_TOKEN_FILE = path.join(DATA_DIR, 'strava-tokens.json');
const ICU_BASE = (process.env.ICU_BASE || 'https://intervals.icu/api/v1').replace(/\/$/, '');
const ICU_WEB = (process.env.ICU_WEB || 'https://intervals.icu').replace(/\/$/, '');
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SECURE = PUBLIC_URL.startsWith('https://');
const ACCOUNTS = !/^(0|off|false|no)$/i.test(process.env.ACCOUNTS || 'on');
const OAUTH = Boolean(process.env.INTERVALS_CLIENT_ID && process.env.INTERVALS_CLIENT_SECRET);
const COACH_IDS = new Set((process.env.COACH_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
const accounts = ACCOUNTS ? createAccounts({ dataDir: DATA_DIR, secret: process.env.SESSION_SECRET }) : null;

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

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, ...headers });
  res.end();
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  try {
    return JSON.parse(buf.toString('utf8') || 'null');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

// ---------- intervals.icu helpers ----------
const basic = (key) => 'Basic ' + Buffer.from('API_KEY:' + key).toString('base64');

async function icu(pathname, authorization) {
  const r = await fetch(ICU_BASE + pathname, { headers: { accept: 'application/json', authorization } });
  if (!r.ok) return { status: r.status, data: null };
  return { status: r.status, data: await r.json() };
}

async function detectRole(id, authorization) {
  if (COACH_IDS.has(id)) return 'coach';
  try {
    const r = await icu('/athletes', authorization);
    const list = Array.isArray(r.data) ? r.data : (r.data?.athletes ?? r.data?.list ?? []);
    if (list.some((a) => String(a?.id ?? a?.athlete_id ?? '') && String(a?.id ?? a?.athlete_id) !== id)) return 'coach';
  } catch {
    /* not a coach */
  }
  return 'athlete';
}

// ---------- auth routes ----------
async function handleAuth(req, res, url) {
  const route = url.pathname.replace(/^\/api\/auth/, '');
  if (route === '/key' && req.method === 'POST') {
    const body = await readJson(req, 10_000);
    let key = String(body?.apiKey ?? '').trim().replace(/^["']|["']$/g, '');
    if (/^API_KEY:/i.test(key)) key = key.slice(8);
    if (key.length < 10 || key.length > 200) return sendJson(res, 400, { error: 'That doesn’t look like an intervals.icu API key.' });
    const auth = basic(key);
    let me;
    try {
      me = await icu('/athlete/0', auth);
    } catch (e) {
      return sendJson(res, 502, { error: 'Could not reach intervals.icu: ' + e.message });
    }
    if (!me.data?.id) return sendJson(res, 401, { error: 'intervals.icu didn’t accept that API key. Copy it again from intervals.icu → Settings → Developer Settings.' });
    const id = String(me.data.id);
    const role = await detectRole(id, auth);
    const user = accounts.upsert({ id, name: me.data.name || me.data.firstname || id, credType: 'apikey', credSecret: key, role });
    return sendJson(res, 200, { user: accounts.publicUser(user), state: user.state }, { 'set-cookie': accounts.sessionCookie(user, SECURE) });
  }
  if (route === '/oauth/start') {
    if (!OAUTH) return sendJson(res, 400, { error: 'OAuth is not configured on this server.' });
    const state = accounts.sign({ t: 'oauth', n: crypto.randomBytes(12).toString('hex'), exp: Date.now() + 10 * 60_000 });
    const q = new URLSearchParams({
      client_id: process.env.INTERVALS_CLIENT_ID,
      redirect_uri: `${PUBLIC_URL}/api/auth/oauth/callback`,
      scope: 'ACTIVITY:READ,WELLNESS:READ,CALENDAR:WRITE,SETTINGS:READ',
      state,
    });
    return redirect(res, `${ICU_WEB}/oauth/authorize?${q}`, { 'set-cookie': accounts.cookie('ta_oauth', state, 600, SECURE) });
  }
  if (route === '/oauth/callback') {
    const clear = accounts.cookie('ta_oauth', '', 0, SECURE);
    const state = url.searchParams.get('state');
    const saved = accounts.cookies(req).ta_oauth;
    if (url.searchParams.get('error')) return redirect(res, '/#/login?error=denied', { 'set-cookie': clear });
    if (!state || state !== saved || !accounts.verify(state)) return redirect(res, '/#/login?error=state', { 'set-cookie': clear });
    try {
      const r = await fetch(`${ICU_WEB}/api/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ client_id: process.env.INTERVALS_CLIENT_ID, client_secret: process.env.INTERVALS_CLIENT_SECRET, code: url.searchParams.get('code') || '' }),
      });
      if (!r.ok) throw new Error(`token exchange ${r.status}`);
      const tok = await r.json();
      const token = tok.access_token;
      let athlete = tok.athlete;
      if (!athlete?.id) athlete = (await icu('/athlete/0', `Bearer ${token}`)).data;
      if (!token || !athlete?.id) throw new Error('no athlete in token response');
      const id = String(athlete.id);
      const user = accounts.upsert({ id, name: athlete.name || id, credType: 'oauth', credSecret: token, role: COACH_IDS.has(id) ? 'coach' : 'athlete' });
      res.writeHead(302, { location: '/#/week', 'set-cookie': [accounts.sessionCookie(user, SECURE), clear] });
      return res.end();
    } catch (e) {
      console.error('OAuth error:', e.message);
      return redirect(res, '/#/login?error=oauth', { 'set-cookie': clear });
    }
  }
  if (route === '/logout' && req.method === 'POST') {
    const body = await readJson(req, 1000).catch(() => null);
    const u = accounts.sessionUser(req);
    if (u && body?.everywhere) accounts.logoutEverywhere(u);
    return sendJson(res, 200, { ok: true }, { 'set-cookie': accounts.clearSession(SECURE) });
  }
  return sendJson(res, 404, { error: 'Unknown auth route' });
}

async function handleMe(req, res) {
  const u = accounts.sessionUser(req);
  if (!u) return sendJson(res, 401, { error: 'Not logged in' });
  if (req.method === 'GET') return sendJson(res, 200, { user: accounts.publicUser(u), state: u.state });
  if (req.method === 'PUT') {
    const state = await readJson(req, 3_000_000);
    if (!state || typeof state !== 'object' || Array.isArray(state)) return sendJson(res, 400, { error: 'State must be an object' });
    if (state.settings?.connection) state.settings.connection = { ...state.settings.connection, apiKey: '', appPassword: '' };
    accounts.setState(u, state);
    return sendJson(res, 200, { ok: true, updated: u.stateUpdated });
  }
  if (req.method === 'DELETE') {
    accounts.remove(u.id);
    return sendJson(res, 200, { ok: true }, { 'set-cookie': accounts.clearSession(SECURE) });
  }
  return sendJson(res, 405, { error: 'Method not allowed' });
}

// ---------- intervals.icu proxy ----------
async function proxyIntervals(req, res, url) {
  const sub = url.pathname.replace(/^\/api\/icu/, '');
  const target = ICU_BASE + sub + url.search;
  const headers = { accept: 'application/json' };
  const user = accounts?.sessionUser(req);
  if (user) headers.authorization = accounts.authHeader(user);
  else if (req.headers.authorization) headers.authorization = req.headers.authorization;
  else if (!ACCOUNTS && process.env.ICU_API_KEY) headers.authorization = basic(process.env.ICU_API_KEY);
  else return sendJson(res, 401, { error: ACCOUNTS ? 'Log in with your intervals.icu account first.' : 'No intervals.icu API key. Add it in Settings or set ICU_API_KEY in .env.' });
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await readBody(req);
    headers['content-type'] = req.headers['content-type'] || 'application/json';
  }
  try {
    const r = await fetch(target, { method: req.method, headers, body });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
    res.end(buf);
  } catch (e) {
    sendJson(res, 502, { error: 'Could not reach intervals.icu: ' + e.message });
  }
}

// ---------- Strava (per user when accounts are on) ----------
const stravaConfigured = () => Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);

function readTokens(user) {
  if (ACCOUNTS) return user?.strava ? JSON.parse(accounts.decrypt(user.strava)) : null;
  try {
    return JSON.parse(fs.readFileSync(STRAVA_TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function writeTokens(user, t) {
  if (ACCOUNTS) {
    if (t) user.strava = accounts.encrypt(JSON.stringify(t));
    else delete user.strava;
    accounts.persist();
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (t) fs.writeFileSync(STRAVA_TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
  else fs.rmSync(STRAVA_TOKEN_FILE, { force: true });
}

async function stravaToken(params) {
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, ...params }),
  });
  if (!r.ok) throw new Error(`Strava token error ${r.status}: ${await r.text()}`);
  return r.json();
}

async function validAccessToken(user) {
  let t = readTokens(user);
  if (!t) return null;
  if (t.expires_at * 1000 < Date.now() + 60_000) {
    const fresh = await stravaToken({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    t = { ...t, ...fresh };
    writeTokens(user, t);
  }
  return t.access_token;
}

async function handleStrava(req, res, url) {
  const route = url.pathname.replace(/^\/api\/strava/, '');
  const user = accounts?.sessionUser(req) ?? null;
  if (route === '/status') {
    const t = ACCOUNTS && !user ? null : readTokens(user);
    return sendJson(res, 200, {
      configured: stravaConfigured(),
      connected: Boolean(t),
      athlete: t?.athlete ? { id: t.athlete.id, name: `${t.athlete.firstname ?? ''} ${t.athlete.lastname ?? ''}`.trim() } : null,
    });
  }
  if (!stravaConfigured()) return sendJson(res, 400, { error: 'Strava is not configured on the server (.env).' });
  if (ACCOUNTS && !user) return sendJson(res, 401, { error: 'Log in first.' });

  if (route === '/login') {
    const q = new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      redirect_uri: `${PUBLIC_URL}/api/strava/callback`,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'read,activity:read_all',
    });
    return redirect(res, `https://www.strava.com/oauth/authorize?${q}`);
  }
  if (route === '/callback') {
    const code = url.searchParams.get('code');
    if (!code) return redirect(res, '/#/settings?strava=denied');
    try {
      writeTokens(user, await stravaToken({ grant_type: 'authorization_code', code }));
      return redirect(res, '/#/settings?strava=connected');
    } catch (e) {
      console.error(e);
      return redirect(res, '/#/settings?strava=error');
    }
  }
  if (route === '/disconnect' && req.method === 'POST') {
    writeTokens(user, null);
    return sendJson(res, 200, { ok: true });
  }
  if (route === '/activities') {
    try {
      const token = await validAccessToken(user);
      if (!token) return sendJson(res, 401, { error: 'Strava not connected' });
      const after = url.searchParams.get('after') || String(Math.floor(Date.now() / 1000) - 90 * 86400);
      const all = [];
      for (let page = 1; page <= 5; page++) {
        const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${encodeURIComponent(after)}&per_page=100&page=${page}`, {
          headers: { authorization: `Bearer ${token}` },
        });
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
  return sendJson(res, 404, { error: 'Unknown Strava route' });
}

// ---------- static ----------
function serveStatic(req, res, url) {
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(DIST, p));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
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

// ---------- optional site password (in front of everything) ----------
function passwordOk(req) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return true;
  if (req.headers['x-app-password'] === pw) return true;
  return (req.headers.cookie || '').split(/;\s*/).some((c) => c === `app_pw=${encodeURIComponent(pw)}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/health') {
      const ok = passwordOk(req);
      const user = ok ? accounts?.sessionUser(req) : null;
      return sendJson(res, 200, {
        ok: true,
        proxy: true,
        accounts: ACCOUNTS,
        oauth: ACCOUNTS && OAUTH,
        user: user ? accounts.publicUser(user) : null,
        authRequired: Boolean(process.env.APP_PASSWORD),
        authed: ok,
        serverIcuKey: ok && !ACCOUNTS && Boolean(process.env.ICU_API_KEY),
        serverAthleteId: ok && !ACCOUNTS ? process.env.ICU_ATHLETE_ID || null : null,
        strava: stravaConfigured(),
      });
    }
    if (url.pathname.startsWith('/api/')) {
      if (!passwordOk(req)) return sendJson(res, 401, { error: 'Site password required.' });
      // CSRF: state-changing API calls must carry a custom header (forces a CORS preflight cross-site)
      if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-ta'] !== '1') return sendJson(res, 403, { error: 'Missing x-ta header' });
      if (url.pathname.startsWith('/api/auth/')) {
        if (!ACCOUNTS) return sendJson(res, 404, { error: 'Accounts are turned off on this server (ACCOUNTS=off).' });
        return await handleAuth(req, res, url);
      }
      if (url.pathname === '/api/me') {
        if (!ACCOUNTS) return sendJson(res, 404, { error: 'Accounts are turned off on this server.' });
        return await handleMe(req, res);
      }
      if (url.pathname.startsWith('/api/icu/')) return await proxyIntervals(req, res, url);
      if (url.pathname.startsWith('/api/strava/')) return await handleStrava(req, res, url);
      return sendJson(res, 404, { error: 'Not found' });
    }
    serveStatic(req, res, url);
  } catch (e) {
    if (e?.status) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Training App server on http://localhost:${PORT}`);
  console.log(ACCOUNTS ? `  accounts: on (data in ${DATA_DIR}${OAUTH ? ', intervals.icu OAuth enabled' : ''})` : '  accounts: off (single-user mode)');
  if (ACCOUNTS && process.env.ICU_API_KEY) console.log('  note: ICU_API_KEY is ignored while accounts are on — each user logs in with their own intervals.icu account.');
  if (!stravaConfigured()) console.log('  (Strava disabled — set STRAVA_CLIENT_ID/SECRET in .env to enable)');
});
