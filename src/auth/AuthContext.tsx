import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, SESSION_EXPIRED } from '../api/client';
import type { AuthStatus, User } from '../api/types';

type Auth = {
  loading: boolean;
  user: User | null;
  status: AuthStatus | null; // unauthenticated details (LDAP/OIDC flags, initialised)
  isAdmin: boolean;
  signedIn: (u: User) => void;
  logout: () => Promise<void>;
  expired: boolean;   // the session ended under the user (engine restart): the sign-in page says so
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const onExpired = () => setUser((u) => {
      if (u) setExpired(true);
      return null;
    });
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, []);

  useEffect(() => {
    let alive = true;
    api.authStatus()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        setUser(s.authenticated ? s.user : null);
      })
      .catch(() => alive && setStatus({ authenticated: false }))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const signedIn = useCallback((u: User) => { setExpired(false); setUser(u); }, []);
  const logout = useCallback(async () => {
    await api.logout();
    setExpired(false);
    setUser(null);
    setStatus(await api.authStatus().catch(() => ({ authenticated: false } as AuthStatus)));
  }, []);

  return (
    <AuthContext.Provider value={{ loading, user, status, isAdmin: user?.role === 'admin', signedIn, logout, expired }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
