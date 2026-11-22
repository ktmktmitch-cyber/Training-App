// Authentication: detects the bundled server, and when it runs with accounts, handles
// logging in with an intervals.icu account (API key or OAuth), logging out, and syncing
// each user's app state to the server.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface PublicUser {
  id: string;
  name: string;
  role: 'coach' | 'athlete';
  authType: 'apikey' | 'oauth' | null;
}

export interface ServerInfo {
  proxy: boolean;
  accounts: boolean;
  oauth: boolean;
  user: PublicUser | null;
  authRequired: boolean;
  authed: boolean;
  serverIcuKey: boolean;
  serverAthleteId: string | null;
  strava: boolean;
}

interface AuthCtx {
  status: 'checking' | 'ready';
  server: ServerInfo | null;
  user: PublicUser | null;
  remoteState: Record<string, unknown> | null;
  guest: boolean;
  setGuest: (g: boolean) => void;
  loginWithKey: (apiKey: string) => Promise<void>;
  logout: (everywhere?: boolean) => Promise<void>;
  deleteAccount: () => Promise<void>;
  saveRemote: (state: Record<string, unknown>) => void;
  syncState: 'idle' | 'saving' | 'saved' | 'error';
  setSitePassword: (pw: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside provider');
  return c;
}

const H = { 'x-ta': '1', 'content-type': 'application/json' };

async function readError(r: Response): Promise<string> {
  try {
    const j = await r.json();
    return j.error || r.statusText;
  } catch {
    return r.statusText;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'ready'>('checking');
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [remoteState, setRemoteState] = useState<Record<string, unknown> | null>(null);
  const [guest, setGuestState] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('ta.guest') === '1';
    } catch {
      return false;
    }
  });
  const [syncState, setSyncState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null);

  const refresh = useCallback(async () => {
    let info: ServerInfo | null = null;
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      info = j && j.proxy ? (j as ServerInfo) : null;
    } catch {
      info = null;
    }
    setServer(info);
    if (info?.accounts && info.user) {
      try {
        const me = await fetch('api/me', { cache: 'no-store' });
        if (me.ok) {
          const j = await me.json();
          setUser(j.user);
          setRemoteState(j.state ?? null);
        } else setUser(null);
      } catch {
        setUser(null);
      }
    } else setUser(null);
    setStatus('ready');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setGuest = useCallback((g: boolean) => {
    setGuestState(g);
    try {
      if (g) sessionStorage.setItem('ta.guest', '1');
      else sessionStorage.removeItem('ta.guest');
    } catch {
      /* ignore */
    }
  }, []);

  const loginWithKey = useCallback(async (apiKey: string) => {
    const r = await fetch('api/auth/key', { method: 'POST', headers: H, body: JSON.stringify({ apiKey }) });
    if (!r.ok) throw new Error(await readError(r));
    const j = await r.json();
    setRemoteState(j.state ?? null);
    setUser(j.user);
    setGuest(false);
  }, [setGuest]);

  const flush = useCallback(async () => {
    if (!pending.current) return;
    const body = pending.current;
    pending.current = null;
    setSyncState('saving');
    try {
      const r = await fetch('api/me', { method: 'PUT', headers: H, body: JSON.stringify(body) });
      setSyncState(r.ok ? 'saved' : 'error');
    } catch {
      setSyncState('error');
    }
  }, []);

  const saveRemote = useCallback(
    (state: Record<string, unknown>) => {
      pending.current = state;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 1200);
    },
    [flush],
  );

  // Don't lose the last edit when the tab closes
  useEffect(() => {
    const f = () => {
      if (pending.current) fetch('api/me', { method: 'PUT', headers: H, body: JSON.stringify(pending.current), keepalive: true }).catch(() => {});
    };
    window.addEventListener('pagehide', f);
    return () => window.removeEventListener('pagehide', f);
  }, []);

  const logout = useCallback(
    async (everywhere = false) => {
      await flush();
      await fetch('api/auth/logout', { method: 'POST', headers: H, body: JSON.stringify({ everywhere }) }).catch(() => {});
      setUser(null);
      setRemoteState(null);
      setGuest(false);
    },
    [flush, setGuest],
  );

  const deleteAccount = useCallback(async () => {
    const r = await fetch('api/me', { method: 'DELETE', headers: H });
    if (!r.ok) throw new Error(await readError(r));
    setUser(null);
    setRemoteState(null);
  }, []);

  const setSitePassword = useCallback(
    async (pw: string) => {
      document.cookie = `app_pw=${encodeURIComponent(pw)}; path=/; max-age=31536000; SameSite=Lax`;
      await refresh();
    },
    [refresh],
  );

  return (
    <Ctx.Provider value={{ status, server, user, remoteState, guest, setGuest, loginWithKey, logout, deleteAccount, saveRemote, syncState, setSitePassword, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
