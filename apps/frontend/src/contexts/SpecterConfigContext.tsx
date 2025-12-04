/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-refresh/only-export-components */
// apps/frontend/src/contexts/SpecterConfigContext.tsx

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import {
  fetchSpecterConfig,
  upsertSpecterConfig,
  SpecterConfigShape,
} from 'api/specter';

export interface SpecterConfigContextValue {
  shopId: number | null;
  config: SpecterConfigShape | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  // --- derived onboarding state (Slice 3) ---
  /**
   * True when the shop has never saved a Specter config row.
   * Used to drive "first-run tutoring" experiences.
   */
  isFirstRun: boolean;

  /**
   * Central flag for whether Specter nudges should be shown in the UI.
   * Defaults to TRUE on first-run, and respects the config toggle afterwards.
   */
  shouldShowOnboardingNudges: boolean;

  refresh: () => void;
  saveConfig: (nextConfig: SpecterConfigShape) => Promise<void>;
}

const SpecterConfigContext = createContext<SpecterConfigContextValue | undefined>(
  undefined
);

interface SpecterConfigProviderProps {
  children: ReactNode;
}

export const SpecterConfigProvider: React.FC<SpecterConfigProviderProps> = ({
  children,
}) => {
  const { isLoggedIn, accessToken } = useAuth();

  const [shopId, setShopId] = useState<number | null>(null);
  const [config, setConfig] = useState<SpecterConfigShape | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // simple invalidation token to re-fetch on demand
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  // Fetch config whenever auth state or version changes
  useEffect(() => {
    if (!isLoggedIn || !accessToken) {
      // logged out → clear config
      setShopId(null);
      setConfig(null);
      setError(null);
      setIsLoading(false);
      setIsSaving(false); 
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchSpecterConfig(accessToken)
      .then((result) => {
        if (cancelled) return;

        const nextShopId =
          typeof result.shopId === 'number' ? result.shopId : null;
        const nextConfig =
          result.config && typeof result.config === 'object'
            ? result.config
            : null;

        setShopId(nextShopId);
        setConfig(nextConfig);
        setError(null);
      })
      .catch((err: any) => {
        if (cancelled) return;

        setShopId(null);
        setConfig(null);
        setError(
          err?.message || 'Failed to load Specter configuration'
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, accessToken, version]);

  const saveConfig = useCallback(
    async (nextConfig: SpecterConfigShape) => {
      if (!accessToken) {
        // No token – nothing to do; keep this silent for now
        return;
      }

      setIsLoading(true);
      setIsSaving(true);
      setError(null);

      try {
        const result = await upsertSpecterConfig(accessToken, nextConfig);

        const nextShopId =
          typeof result.shopId === 'number' ? result.shopId : null;
        const persistedConfig =
          result.config && typeof result.config === 'object'
            ? result.config
            : nextConfig;

        setShopId(nextShopId);
        setConfig(persistedConfig);
      } catch (err: any) {
        setError(
          err?.message || 'Failed to save Specter configuration'
        );
        throw err; // let callers show their own UI if needed
      } finally {
        setIsLoading(false);
        setIsSaving(false);
      }
    },
    [accessToken]
  );

  const isFirstRun = config === null;

  const shouldShowOnboardingNudges =
    isFirstRun
      ? true
      : config?.enableOnboardingNudges !== false;

  const value: SpecterConfigContextValue = {
    shopId,
    config,
    isLoading,
    isSaving,
    error,
    refresh,
    saveConfig,

    isFirstRun,
    shouldShowOnboardingNudges,
  };

  return (
    <SpecterConfigContext.Provider value={value}>
      {children}
    </SpecterConfigContext.Provider>
  );
};

export const useSpecterConfig = (): SpecterConfigContextValue => {
  const ctx = useContext(SpecterConfigContext);
  if (!ctx) {
    throw new Error(
      'useSpecterConfig must be used within a SpecterConfigProvider'
    );
  }
  return ctx;
};