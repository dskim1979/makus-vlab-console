import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { AuthStatus, User } from '../api/types';

type Auth = {
  loading: boolean;
  user: User | null;
  status: AuthStatus | null; // unauthenticated details (LDAP/OIDC flags, initialised)
  isAdmin: boolean;
  signedIn: (u: User) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus | null>(null);

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

  const signedIn = useCallback((u: User) => setUser(u), []);
  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setStatus(await api.authStatus().catch(() => ({ authenticated: false } as AuthStatus)));
  }, []);

  return (
    <AuthContext.Provider value={{ loading, user, status, isAdmin: user?.role === 'admin', signedIn, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
