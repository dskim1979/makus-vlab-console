import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ALL_GROUPS, featuresApi, type FeatureGroup, type Features, type SiteProfile } from './api/features';
import { useAuth } from './auth/AuthContext';

// Which feature groups this site uses: the menus, tabs and portal links of a group that is
// off are not shown. Until the engine answers, everything counts as on (no flicker of a
// missing menu on a slow start).
type Ctx = Features & {
  loaded: boolean;
  on: (g?: FeatureGroup | FeatureGroup[]) => boolean;
  save: (profile: SiteProfile, groups: FeatureGroup[]) => Promise<void>;
  reload: () => void;
};

const FeaturesCtx = createContext<Ctx | null>(null);

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [f, setF] = useState<Features>({ profile: null, groups: [...ALL_GROUPS], chosen: true });
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!user) { setLoaded(false); return; }
    let live = true;
    featuresApi.get().then((x) => { if (live) { setF(x); setLoaded(true); } }).catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [user, tick]);

  const on = useCallback((g?: FeatureGroup | FeatureGroup[]) => {
    if (!g) return true;
    const list = Array.isArray(g) ? g : [g];
    return list.length === 0 || list.some((x) => f.groups.includes(x));
  }, [f.groups]);

  const save = useCallback(async (profile: SiteProfile, groups: FeatureGroup[]) => {
    setF(await featuresApi.save(profile, groups));
  }, []);

  return (
    <FeaturesCtx.Provider value={{ ...f, loaded, on, save, reload: () => setTick((n) => n + 1) }}>
      {children}
    </FeaturesCtx.Provider>
  );
}

export function useFeatures(): Ctx {
  const c = useContext(FeaturesCtx);
  if (c) return c;
  // outside the provider (tests, the kiosk): everything on
  return { profile: null, groups: [...ALL_GROUPS], chosen: true, loaded: true, on: () => true, save: async () => {}, reload: () => {} };
}
