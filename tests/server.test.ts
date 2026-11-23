// Integration tests for the multi-user server against a mock intervals.icu.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const KEYS: Record<string, { id: string; name: string }> = {
  keyAlice1234567: { id: 'iA', name: 'Alice' },
  keyBob123456789: { id: 'iB', name: 'Bob' },
  keyCoach1234567: { id: 'iC', name: 'Coach' },
};
let mock: http.Server;
let srv: ChildProcess;
let base = '';
let mockBase = '';
let dataDir = '';
const seen: string[] = [];

function who(auth: string | undefined) {
  if (!auth) return null;
  if (auth.startsWith('Bearer ')) return auth === 'Bearer tokOlivia' ? { id: 'iO', name: 'Olivia' } : null;
  const decoded = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString();
  return KEYS[decoded.replace(/^API_KEY:/, '')] ?? null;
}

beforeAll(async () => {
  mock = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    seen.push(`${req.method} ${req.url} ${auth ?? ''}`);
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/api/oauth/token' && req.method === 'POST') return send(200, { token_type: 'Bearer', access_token: 'tokOlivia', athlete: { id: 'iO', name: 'Olivia' } });
    const u = who(auth);
    if (!u) return send(403, { error: 'forbidden' });
    if (req.url === '/api/v1/athlete/0') return send(200, { id: u.id, name: u.name });
    if (req.url === '/api/v1/athletes') return send(200, u.id === 'iC' ? [{ id: 'iA' }, { id: 'iB' }] : []);
    if (req.url?.startsWith('/api/v1/athlete/')) return send(200, { echo: auth });
    return send(404, {});
  });
  await new Promise<void>((r) => mock.listen(0, r));
  mockBase = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-test-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      ICU_BASE: `${mockBase}/api/v1`,
      ICU_WEB: mockBase,
      PUBLIC_URL: base,
      INTERVALS_CLIENT_ID: 'client',
      INTERVALS_CLIENT_SECRET: 'secret',
      SESSION_SECRET: 'test-secret',
      ICU_API_KEY: '',
      APP_PASSWORD: '',
      STRAVA_CLIENT_ID: '',
      STRAVA_CLIENT_SECRET: '',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}, 15000);

afterAll(() => {
  srv?.kill();
  mock?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const H = { 'x-ta': '1', 'content-type': 'application/json' };
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0];
async function login(key: string) {
  const r = await fetch(`${base}/api/auth/key`, { method: 'POST', headers: H, body: JSON.stringify({ apiKey: key }) });
  return { r, cookie: cookieOf(r), body: await r.json() };
}

describe('multi-user server', () => {
  it('reports accounts and OAuth in health', async () => {
    const h = await (await fetch(`${base}/api/health`)).json();
    expect(h).toMatchObject({ accounts: true, oauth: true, user: null, serverIcuKey: false });
  });

  it('refuses the proxy without a login and state changes without the CSRF header', async () => {
    expect((await fetch(`${base}/api/icu/athlete/0`)).status).toBe(401);
    expect((await fetch(`${base}/api/auth/key`, { method: 'POST', body: '{}' })).status).toBe(403);
  });

  it('rejects keys intervals.icu does not accept', async () => {
    const { r } = await login('notARealKey12345');
    expect(r.status).toBe(401);
  });

  it('logs users in with their own intervals.icu key and keeps their data separate', async () => {
    const a = await login('keyAlice1234567');
    expect(a.r.status).toBe(200);
    expect(a.body.user).toMatchObject({ id: 'iA', name: 'Alice', role: 'athlete', authType: 'apikey' });
    expect(a.cookie).toMatch(/^ta_sid=/);
    expect(a.r.headers.get('set-cookie')).toMatch(/HttpOnly/);

    const put = await fetch(`${base}/api/me`, { method: 'PUT', headers: { ...H, cookie: a.cookie }, body: JSON.stringify({ settings: { connection: { apiKey: 'leak' }, usualHours: 11 }, journal: { '2026-11-21': ['cannabis'] } }) });
    expect(put.status).toBe(200);
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: a.cookie } })).json();
    expect(me.user.id).toBe('iA');
    expect(me.state.settings.usualHours).toBe(11);
    expect(me.state.settings.connection.apiKey).toBe('');

    // proxy uses Alice's own key, regardless of anything the browser sends
    const prox = await (await fetch(`${base}/api/icu/athlete/iA/wellness`, { headers: { cookie: a.cookie, authorization: 'Basic bogus' } })).json();
    expect(Buffer.from(prox.echo.replace('Basic ', ''), 'base64').toString()).toBe('API_KEY:keyAlice1234567');

    const b = await login('keyBob123456789');
    expect(b.body.user.id).toBe('iB');
    expect(b.body.state).toBeNull();
    const meB = await (await fetch(`${base}/api/me`, { headers: { cookie: b.cookie } })).json();
    expect(meB.state).toBeNull();
  });

  it('detects coaches', async () => {
    const c = await login('keyCoach1234567');
    expect(c.body.user.role).toBe('coach');
  });

  it('stores credentials encrypted, never in plain text', () => {
    const raw = fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8');
    expect(raw).not.toContain('keyAlice1234567');
    expect(raw).not.toContain('keyBob123456789');
    expect(JSON.parse(raw).iA.cred.enc).toMatch(/^[\w+/=]+\.[\w+/=]+\.[\w+/=]+$/);
  });

  it('rejects tampered session cookies and supports logout everywhere', async () => {
    const a = await login('keyAlice1234567');
    const [name, val] = a.cookie.split('=');
    const tampered = `${name}=${val.slice(0, -3)}abc`;
    expect((await fetch(`${base}/api/me`, { headers: { cookie: tampered } })).status).toBe(401);
    const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { ...H, cookie: a.cookie }, body: JSON.stringify({ everywhere: true }) });
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await fetch(`${base}/api/me`, { headers: { cookie: a.cookie } })).status).toBe(401);
  });

  it('logs in with intervals.icu OAuth', async () => {
    const start = await fetch(`${base}/api/auth/oauth/start`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(`${mockBase}/oauth/authorize`);
    expect(loc.searchParams.get('scope')).toBe('ACTIVITY:READ,WELLNESS:READ,CALENDAR:WRITE,SETTINGS:READ');
    const state = loc.searchParams.get('state')!;
    const stateCookie = cookieOf(start);
    // wrong state is refused
    const bad = await fetch(`${base}/api/auth/oauth/callback?code=x&state=nope`, { headers: { cookie: stateCookie }, redirect: 'manual' });
    expect(bad.headers.get('location')).toMatch(/error=state/);
    const cb = await fetch(`${base}/api/auth/oauth/callback?code=abc&state=${encodeURIComponent(state)}`, { headers: { cookie: stateCookie }, redirect: 'manual' });
    expect(cb.headers.get('location')).toBe('/#/week');
    const sid = (cb.headers.getSetCookie?.() ?? [cb.headers.get('set-cookie') ?? '']).find((c) => c.startsWith('ta_sid='))!.split(';')[0];
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: sid } })).json();
    expect(me.user).toMatchObject({ id: 'iO', name: 'Olivia', authType: 'oauth' });
    const prox = await (await fetch(`${base}/api/icu/athlete/iO/wellness`, { headers: { cookie: sid } })).json();
    expect(prox.echo).toBe('Bearer tokOlivia');
  });

  it('blocks path traversal on static files', async () => {
    const get = (p: string) =>
      new Promise<{ status: number; body: string }>((resolve) => {
        http
          .get(`${base}${p}`, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          })
          .on('error', () => resolve({ status: 0, body: '' }));
      });
    const encodedSlash = await get('/..%2fpackage.json');
    expect(encodedSlash.status).toBe(403);
    for (const p of ['/%2e%2e/package.json', '/..%2f..%2fserver%2faccounts.mjs', '/..%2fdata%2fusers.json']) {
      const r = await get(p);
      expect(r.body).not.toContain('devDependencies');
      expect(r.body).not.toContain('createAccounts');
      expect(r.body).not.toContain('"cred"');
    }
  });
});
