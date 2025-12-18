/* eslint-disable @typescript-eslint/no-explicit-any */
//apps/frontend/src/contexts/IntegrationContext.tsx
/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, ReactNode, useMemo, useCallback } from 'react';
import axios, { AxiosError } from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext'; // We need auth state

// --- Define State Shape ---
// This is the shape of the data from our new API endpoint
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

// --- Define Context Shape ---
interface IntegrationContextType {
  // --- Core contract (authoritative) ---
  isLoading: boolean;
  syncStatus: SyncStatus['status'];
  hasIntegrationRecord: boolean;
  isSyncComplete: boolean;
  progress: SyncStatus['progress'];
  lastError: string | null;
  refreshIntegrationStatus: () => void;

  // --- Legacy / transitional (DO NOT USE FOR NEW LOGIC) ---
  hasIntegrations: boolean;
  isFirstTimeSync: boolean;

  // escape hatch (legacy usage audit later)
  [x: string]: any;
}

// --- Create Context ---
const IntegrationContext = createContext<IntegrationContextType | undefined>(undefined);

// --- Create Provider Component ---
interface IntegrationProviderProps {
  children: ReactNode;
}

// --- API Fetcher ---
const fetchSyncStatus = async (accessToken: string | null): Promise<SyncStatus> => {
  if (!accessToken) {
    // This should not happen if `enabled` is set correctly, but as a safeguard:
    throw new Error('Not authenticated');
  }
  const { data } = await axios.get('/api/v1/integrations/sync-status', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return data;
};

export const IntegrationProvider: React.FC<IntegrationProviderProps> = ({ children }) => {
  const { isLoggedIn, accessToken } = useAuth();
  const queryClient = useQueryClient();

  // This is the "brain"
  // It fetches the status *only* if the user is logged in
  const { data, isLoading, error } = useQuery<SyncStatus, AxiosError>({
    queryKey: ['integration-status'],
    queryFn: () => fetchSyncStatus(accessToken),
    enabled: isLoggedIn && !!accessToken, // Only run when logged in

    // --- POLLING LOGIC ---
    // Poll every 2 seconds *only if* the sync is actively in progress.
    // Update the polling logic to match our simplified steps:
refetchInterval: (query) => {
      const data = query.state.data as SyncStatus | undefined;
      const status = data?.status;

      if (!status) return false;

      const inProgressStatuses: SyncStatus['status'][] = [
        'PENDING',
        'SYNCING_PRODUCTS',
        'SYNCING_ORDERS',
        'SYNCING_LINE_ITEMS',
        'SYNCING_INVENTORY',
        'SYNCING_SHOP',
        'COMPLETING',
      ];

      return inProgressStatuses.includes(status) ? 2000 : false;
    },
    

    refetchOnWindowFocus: true,
      retry: (failureCount, err) => {
      const status = err.response?.status;

      // A 404 is not an "error", it's a "state": NOT_FOUND. Don't retry.
      if (status === 404) {
        return false;
      }

      // Auth errors (401/403) are also not "integration" errors.
      // Let the global auth layer deal with them; don't hammer this endpoint.
      if (status === 401 || status === 403) {
        return false;
      }

      // Otherwise, retry a few times for transient issues.
      return failureCount < 3;
    },
  });

  // Function to allow any component to refresh this state
  const refreshIntegrationStatus = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['integration-status'] });
  }, [queryClient]);

  // Derive our clean state from the raw API data
    // Derive our clean state from the raw API data
  const value = useMemo((): IntegrationContextType => {
    const statusCode = error?.response?.status;

    let status: SyncStatus['status'] = 'PENDING';
    let hasIntegrationRecord = false;
    let isSyncComplete = false;

    if (data) {
      status = data.status;

      // Any real backend response except NOT_FOUND means an integration record exists
      hasIntegrationRecord = status !== 'NOT_FOUND';
      isSyncComplete = status === 'COMPLETED';

    } else if (statusCode === 404) {
      status = 'NOT_FOUND';
      hasIntegrationRecord = false;
      isSyncComplete = false;

    } else if (statusCode === 401 || statusCode === 403) {
      hasIntegrationRecord = false;
      isSyncComplete = false;

    } else if (statusCode) {
      status = 'FAILED';
      hasIntegrationRecord = false;
      isSyncComplete = false;
    }
    const progress = data?.progress || { current: 0, total: 0, percentage: 0 };

    const lastError =
      data?.lastError ||
      (statusCode &&
        statusCode !== 404 &&
        statusCode !== 401 &&
        statusCode !== 403
        ? `Sync status error (${statusCode})`
        : null) ||
      error?.message ||
      null;

   /*  console.log('[IntegrationContext] derived state', {
      rawData: data,
      statusCode,
      status,
      hasIntegrationRecord,
      isSyncComplete,
      progress,
      lastError,
    }); */

    return {
      // --- core truth ---
      isLoading: isLoading && isLoggedIn,
      syncStatus: status,
      hasIntegrationRecord,
      isSyncComplete,
      progress,
      lastError,
      refreshIntegrationStatus,

      // --- legacy compatibility layer ---
      hasIntegrations: hasIntegrationRecord && isSyncComplete,
      isFirstTimeSync: hasIntegrationRecord && !isSyncComplete,
    };
  }, [data, isLoading, error, isLoggedIn, refreshIntegrationStatus]);

  return <IntegrationContext.Provider value={value}>{children}</IntegrationContext.Provider>;
};

// --- Create Hook for easy access ---
export const useIntegration = (): IntegrationContextType => {
  const context = useContext(IntegrationContext);
  if (context === undefined) {
    throw new Error('useIntegration must be used within an IntegrationProvider');
  }
  return context;
};