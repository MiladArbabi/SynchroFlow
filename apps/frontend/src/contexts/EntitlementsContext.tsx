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
import axios from 'axios';
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
  const [error, setError] = useState<string | null>(null);

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
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    axios
      .get<EntitlementsResponse>('/api/v1/entitlements/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
      .then((res) => {
        if (cancelled) return;

        const payload = res.data || ({} as Partial<EntitlementsResponse>);
        const nextShopId =
          typeof payload.shopId === 'number' ? payload.shopId : null;
        const nextModules = Array.isArray(payload.modules)
          ? payload.modules
          : [];
        const nextFlags = Array.isArray(payload.flags) ? payload.flags : [];

        setShopId(nextShopId);
        setModules(nextModules);
        setFlags(nextFlags);
        setError(null);
      })
      .catch((err: any) => {
        if (cancelled) return;

        setShopId(null);
        setModules([]);
        setFlags([]);
        setError(err?.message || 'Failed to load entitlements');
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
