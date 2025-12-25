/**
 * IntegrationContext
 * ------------------
 *
 * MODEL A — PRE-FT1 STRUCTURAL CONTEXT
 *
 * PURPOSE:
 * - Determine whether an integration exists
 * - Determine whether backend sync is running or complete
 *
 * NON-GOALS (DO NOT USE FOR):
 * - UI readiness
 * - Feature availability
 * - Dashboard or module rendering decisions
 *
 * LIFECYCLE RULES:
 * - 404  → integration does NOT exist
 * - 401/403 → auth churn (MUST NOT mutate lifecycle)
 * - COMPLETED → sync finished, readiness handled elsewhere
 *
 * AFTER FT1_READY:
 * - Components MUST NOT read this context directly
 * - ShopLifecycleContext becomes authoritative
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-refresh/only-export-components */

import React, {
  createContext,
  useContext,
  ReactNode,
  useMemo,
  useCallback,
} from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { axiosInstance } from 'api/axiosConfig';
import { useAuth } from './AuthContext';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface SyncStatus {
  status:
    | 'PENDING'
    | 'SYNCING_PRODUCTS'
    | 'SYNCING_ORDERS'
    | 'SYNCING_LINE_ITEMS'
    | 'SYNCING_INVENTORY'
    | 'SYNCING_SHOP'
    | 'COMPLETING'
    | 'COMPLETED'
    | 'FAILED'
    | 'NOT_FOUND';

  progress: {
    current: number;
    total: number;
    percentage: number;
  };

  lastError: string | null;
}

interface IntegrationContextType {
  /* -------- Authoritative (Model A) -------- */
  isLoading: boolean;
  syncStatus: SyncStatus['status'];
  hasIntegrationRecord: boolean;
  isSyncComplete: boolean;
  progress: SyncStatus['progress'];
  lastError: string | null;
  refreshIntegrationStatus: () => void;

  /* -------- Legacy (DO NOT USE FOR NEW LOGIC) -------- */
  hasIntegrations: boolean;
  isFirstTimeSync: boolean;

  /* Escape hatch (temporary) */
  [x: string]: any;
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

const IntegrationContext =
  createContext<IntegrationContextType | undefined>(undefined);

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

const fetchSyncStatus = async (): Promise<SyncStatus> => {
  const { data } = await axiosInstance.get('/api/v1/integrations/sync-status');
  return data;
};

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export const IntegrationProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<SyncStatus, AxiosError>({
    queryKey: ['integration-status'],
    queryFn: fetchSyncStatus,
    enabled: isLoggedIn,

    /* Poll ONLY while syncing */
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return false;

      return [
        'PENDING',
        'SYNCING_PRODUCTS',
        'SYNCING_ORDERS',
        'SYNCING_LINE_ITEMS',
        'SYNCING_INVENTORY',
        'SYNCING_SHOP',
        'COMPLETING',
      ].includes(status)
        ? 2000
        : false;
    },

    refetchOnWindowFocus: true,

    retry: (failureCount, err) => {
      const status = err.response?.status;

      if (status === 404) return false;
      if (status === 401 || status === 403) return false;

      return failureCount < 3;
    },
  });

  const refreshIntegrationStatus = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['integration-status'] });
  }, [queryClient]);

  /* ------------------------------------------------------------------------ */
  /* Derivation (Model A)                                                      */
  /* ------------------------------------------------------------------------ */

  const value = useMemo<IntegrationContextType>(() => {
    const statusCode = error?.response?.status;

    let status: SyncStatus['status'] = 'NOT_FOUND';
    let hasIntegrationRecord = false;
    let isSyncComplete = false;

    if (data) {
      status = data.status;
      hasIntegrationRecord = status !== 'NOT_FOUND';
      isSyncComplete = status === 'COMPLETED';
    } else if (statusCode === 404) {
      status = 'NOT_FOUND';
      hasIntegrationRecord = false;
      isSyncComplete = false;
    } else if (statusCode === 401 || statusCode === 403) {
      /**
       * 🚨 AUTH CHURN RULE (CRITICAL)
       *
       * Auth refresh MUST NOT mutate lifecycle.
       * Preserve last known backend state if present.
       */
      if (data) {
        status = data.status;
        hasIntegrationRecord = data.status !== 'NOT_FOUND';
        isSyncComplete = data.status === 'COMPLETED';
      } else {
        status = 'NOT_FOUND';
        hasIntegrationRecord = false;
        isSyncComplete = false;
      }

      if (import.meta.env.DEV) {
        console.warn(
          '[IntegrationContext] Auth churn — lifecycle preserved',
          { lastKnownStatus: data?.status }
        );
      }
    } else if (statusCode) {
      status = 'FAILED';
      hasIntegrationRecord = false;
      isSyncComplete = false;
    }

    const progress =
      data?.progress ?? { current: 0, total: 0, percentage: 0 };

    const lastError =
      data?.lastError ??
      (statusCode &&
      ![401, 403, 404].includes(statusCode)
        ? `Sync status error (${statusCode})`
        : null) ??
      error?.message ??
      null;

    if (import.meta.env.DEV) {
      console.debug('[IntegrationContext]', {
        status,
        hasIntegrationRecord,
        isSyncComplete,
        progress,
      });
    }

    return {
      /* -------- Core truth -------- */
      isLoading: isLoading && isLoggedIn,
      syncStatus: status,
      hasIntegrationRecord,
      isSyncComplete,
      progress,
      lastError,
      refreshIntegrationStatus,

      /* -------- ⚠️ Legacy -------- */
      hasIntegrations: hasIntegrationRecord && isSyncComplete,
      isFirstTimeSync: hasIntegrationRecord && !isSyncComplete,
    };
  }, [data, error, isLoading, isLoggedIn, refreshIntegrationStatus]);

  return (
    <IntegrationContext.Provider value={value}>
      {children}
    </IntegrationContext.Provider>
  );
};

/* -------------------------------------------------------------------------- */
/* Hooks                                                                      */
/* -------------------------------------------------------------------------- */

export const useIntegration = (): IntegrationContextType => {
  const ctx = useContext(IntegrationContext);
  if (!ctx) {
    throw new Error(
      'useIntegration must be used within IntegrationProvider'
    );
  }
  return ctx;
};

export function useIntegrationSyncStatus() {
  const ctx = useContext(IntegrationContext);
  if (!ctx) {
    throw new Error(
      'useIntegrationSyncStatus must be used within IntegrationProvider'
    );
  }

  return {
    status: ctx.syncStatus,
    isLoading: ctx.isLoading,
  };
}
