/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-refresh/only-export-components */
// apps/frontend/src/contexts/EntitlementsContext.tsx

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { axiosInstance } from 'api/axiosConfig';
import { useAuth } from './AuthContext';

// --- Backend payload shape ---
interface EntitlementsResponse {
  shopId: number | null;
  modules: string[];
  flags: string[];
}

// --- Context shape exposed to UI ---
interface EntitlementsContextValue {
  shopId: number | null;
  modules: string[];
  flags: string[];
  isLoading: boolean;
  hasResolved: boolean;
  error: string | null;
  hasModule: (moduleId: string) => boolean;
  hasFlag: (flagId: string) => boolean;
  refresh: () => void;
}

const EntitlementsContext = createContext<EntitlementsContextValue | undefined>(
  undefined
);

interface EntitlementsProviderProps {
  children: ReactNode;
}

export const EntitlementsProvider: React.FC<EntitlementsProviderProps> = ({
  children,
}) => {
  const { isLoggedIn, accessToken } = useAuth();

  const [shopId, setShopId] = useState<number | null>(null);
  const [modules, setModules] = useState<string[]>([]);
  const [flags, setFlags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasResolved, setHasResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Preserve last known good entitlement snapshot (for auth refresh churn) ---
  const lastGoodSnapshotRef = React.useRef<{
    shopId: number | null;
    modules: string[];
    flags: string[];
  } | null>(null);

  // simple invalidation token to force re-fetch
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => {
    setRefreshToken((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !accessToken) {
      // logged out → clear entitlements
      setShopId(null);
      setModules([]);
      setFlags([]);
      setError(null);
      setIsLoading(false);
      setHasResolved(true); // ✅ CRITICAL: resolve entitlement state for logged-out users

      // keep global snapshot consistent
      (window as any)._lasyncroEntitlements = { modules: [], flags: [] };

      if (import.meta.env.DEV) {
        console.debug('[Entitlements] resolved (logged out)');
      }

      return;
    }

    let cancelled = false;
    setIsLoading(true);

    axiosInstance
      .get<EntitlementsResponse>('/api/v1/entitlements/me')
      .then((res) => {
        if (cancelled) return;

        const payload = res.data || ({} as Partial<EntitlementsResponse>);
        const nextShopId =
          typeof payload.shopId === 'number' ? payload.shopId : null;

        if (import.meta.env.DEV) {
          console.debug('[Entitlements] token-auth snapshot', {
            shopId: payload.shopId,
            modules: payload.modules,
            flags: payload.flags
          });
        }

        /**
         * TEMPORARY DEV OVERRIDE
         * ----------------------
         * Force-enable `order-nexus` module on the frontend until
         * backend entitlements fully support dynamic module rollout.
         *
         * Why:
         * - Orders UI is implemented as a dynamic module
         * - Backend `/entitlements/me` does not yet return `order-nexus`
         * - Without this, ProtectedRoute will redirect `/orders` → `/dashboard`
         *
         * Removal condition:
         * - Backend returns `order-nexus` in `modules[]`
         *
         * IMPORTANT:
         * - This does NOT bypass entitlement checks
         * - It only augments the entitlement snapshot during development
         */
        const nextModules = Array.isArray(payload.modules)
          ? payload.modules
          : [];

        const nextFlags = Array.isArray(payload.flags) ? payload.flags : [];

        /* if (import.meta.env.DEV) {
          console.groupCollapsed('[Entitlements] resolved snapshot');
          console.log('shopId:', nextShopId);
          console.log('backend modules:', payload.modules);
          console.log('effective modules:', nextModules);
          console.log('flags:', nextFlags);
          console.groupEnd();
        } */

        setShopId(nextShopId);
        setModules(nextModules);
        setFlags(nextFlags);
        setError(null);
        setHasResolved(true);

        // --- Persist last known good snapshot ---
        lastGoodSnapshotRef.current = {
          shopId: nextShopId,
          modules: nextModules,
          flags: nextFlags
        };

        // expose snapshot for modules that call host APIs during init()
        (window as any)._lasyncroEntitlements = { modules: nextModules, flags: nextFlags };

        if (import.meta.env.DEV) {
          console.debug('[Entitlements] snapshot committed', lastGoodSnapshotRef.current);
        }

      })
      .catch((err: any) => {
        if (cancelled) return;

        if (import.meta.env.DEV) {
        console.warn(
          '[Entitlements] fetch failed – attempting fallback',
          err?.message
        );
      }

      // --- Fallback to last known good snapshot if available ---
      if (lastGoodSnapshotRef.current) {
        const snap = lastGoodSnapshotRef.current;

        if (import.meta.env.DEV) {
          console.info('[Entitlements] restored snapshot from memory', snap);
        }

        setShopId(snap.shopId);
        setModules(snap.modules);
        setFlags(snap.flags);
        setError(null);
        setHasResolved(true);

        // keep global snapshot in sync
        (window as any)._lasyncroEntitlements = {
          modules: snap.modules,
          flags: snap.flags
        };

        return;
      }

      // --- Hard failure only if no snapshot exists ---
      setShopId(null);
      setModules([]);
      setFlags([]);
      setError(err?.message || 'Failed to load entitlements');
      setHasResolved(true);

      // reflect cleared state to modules
      (window as any)._lasyncroEntitlements = null;

      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, accessToken, refreshToken]);

  const hasModule = useCallback(
    (moduleId: string) => modules.includes(moduleId),
    [modules]
  );

  const hasFlag = useCallback(
    (flagId: string) => flags.includes(flagId),
    [flags]
  );

  const value: EntitlementsContextValue = {
    shopId,
    modules,
    flags,
    isLoading,
    hasResolved,
    error,
    hasModule,
    hasFlag,
    refresh,
  };

  return (
    <EntitlementsContext.Provider value={value}>
      {children}
    </EntitlementsContext.Provider>
  );
};

export const useEntitlements = (): EntitlementsContextValue => {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) {
    throw new Error('useEntitlements must be used within an EntitlementsProvider');
  }
  return ctx;
};