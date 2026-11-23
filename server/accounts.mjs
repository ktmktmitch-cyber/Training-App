// User accounts for the bundled server (zero dependencies).
//
//  * Identity comes from intervals.icu: you log in with your intervals.icu API key (or
//    OAuth token). The server asks intervals.icu who owns it — no separate passwords.
//  * Credentials are encrypted at rest with AES-256-GCM. The master key comes from
//    SESSION_SECRET, or is generated once into DATA_DIR/secret.key (mode 600).
//  * Sessions are HMAC-signed, HttpOnly, SameSite=Lax cookies (30 days).
//  * Each user's app state (settings, weekly availability, journal, …) is stored with
//    their account so it follows them across devices.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SESSION_DAYS = 30;

export function createAccounts({ dataDir, secret }) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const keyFile = path.join(dataDir, 'secret.key');
  let master;
  if (secret) master = crypto.createHash('sha256').update(String(secret)).digest();
  else if (fs.existsSync(keyFile)) master = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  else {
    master = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, master.toString('hex'), { mode: 0o600 });
  }
  const encKey = crypto.createHmac('sha256', master).update('training-app:enc').digest();
  const macKey = crypto.createHmac('sha256', master).update('training-app:mac').digest();

  const usersFile = path.join(dataDir, 'users.json');
  let users = {};
  try {
    users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  } catch {
    users = {};
  }
  const persist = () => {
    const tmp = `${usersFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(users, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, usersFile);
  };

  const encrypt = (plain) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
  };
  const decrypt = (blob) => {
    const [iv, tag, ct] = String(blob).split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  };

  const sign = (payload) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = crypto.createHmac('sha256', macKey).update(body).digest('base64url');
    return `${body}.${mac}`;
  };
  const verify = (token) => {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, mac] = token.split('.');
    const expected = crypto.createHmac('sha256', macKey).update(body).digest('base64url');
    if (!mac || mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (p.exp && p.exp < Date.now()) return null;
      return p;
    } catch {
      return null;
    }
  };
  const cookies = (req) =>
    Object.fromEntries(
      (req.headers.cookie || '')
        .split(/;\s*/)
        .filter((c) => c.includes('='))
        .map((c) => {
          const i = c.indexOf('=');
          try {
            return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
          } catch {
            return [c.slice(0, i), ''];
          }
        }),
    );
  const cookie = (name, value, maxAge, secure) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  return {
    users,
    persist,
    encrypt,
    decrypt,
    sign,
    verify,
    cookies,
    cookie,
    sessionUser(req) {
      const p = verify(cookies(req).ta_sid);
      if (!p || p.t !== 'sid') return null;
      const u = users[p.id];
      if (!u || (u.sessionVersion ?? 0) !== (p.v ?? 0)) return null;
      return u;
    },
    sessionCookie(user, secure) {
      return cookie('ta_sid', sign({ t: 'sid', id: user.id, v: user.sessionVersion ?? 0, exp: Date.now() + SESSION_DAYS * 86400e3 }), SESSION_DAYS * 86400, secure);
    },
    clearSession(secure) {
      return cookie('ta_sid', '', 0, secure);
    },
    upsert({ id, name, credType, credSecret, role }) {
      const now = new Date().toISOString();
      const u = users[id] ?? { id, createdAt: now, state: null, sessionVersion: 0 };
      u.name = name || u.name || id;
      u.role = role;
      u.cred = { type: credType, enc: encrypt(credSecret) };
      u.lastLogin = now;
      users[id] = u;
      persist();
      return u;
    },
    authHeader(u) {
      const secretValue = decrypt(u.cred.enc);
      return u.cred.type === 'oauth' ? `Bearer ${secretValue}` : 'Basic ' + Buffer.from('API_KEY:' + secretValue).toString('base64');
    },
    publicUser(u) {
      return { id: u.id, name: u.name, role: u.role, authType: u.cred?.type ?? null };
    },
    setState(u, state) {
      u.state = state;
      u.stateUpdated = new Date().toISOString();
      persist();
    },
    logoutEverywhere(u) {
      u.sessionVersion = (u.sessionVersion ?? 0) + 1;
      persist();
    },
    remove(id) {
      delete users[id];
      persist();
    },
  };
}
