//packages/ui/src/contexts/IntegrationContext.tsx
/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, ReactNode, useMemo, useCallback } from 'react';
import axios, { AxiosError } from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext'; // We need auth state

// --- Define State Shape ---
// This is the shape of the data from our new API endpoint
interface SyncStatus {
  status: 'PENDING' | 'SYNCING_PRODUCTS' | 'SYNCING_ORDERS' | 'SYNCING_FINANCES' | 'COMPLETED' | 'FAILED' | 'NOT_FOUND';
  progress: {
    current: number;
    total: number;
    percentage: number;
  };
  lastError: string | null;
}

// --- Define Context Shape ---
interface IntegrationContextType {
  isLoading: boolean;
  syncStatus: SyncStatus['status'];
  hasIntegrations: boolean;
  isFirstTimeSync: boolean; // For the "Aha!" moment
  progress: SyncStatus['progress'];
  lastError: string | null;
  refreshIntegrationStatus: () => void;
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
    refetchOnWindowFocus: true,
    retry: (failureCount, err) => {
      // A 404 is not an "error", it's a "state": NOT_FOUND. Don't retry.
      if (err.response?.status === 404) {
        return false;
      }
      // Otherwise, retry 3 times
      return failureCount < 3;
    },
  });

  // Function to allow any component to refresh this state
  const refreshIntegrationStatus = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['integration-status'] });
  }, [queryClient]);

  // Derive our clean state from the raw API data
  const value = useMemo((): IntegrationContextType => {
    const is404 = error?.response?.status === 404;
    const status = data?.status || (is404 ? 'NOT_FOUND' : 'PENDING');

    const hasIntegrations = status !== 'NOT_FOUND';
    
    // "First Time Sync" is any state that isn't 'COMPLETED'
    // (assuming they just connected)
    const isFirstTimeSync = hasIntegrations && status !== 'COMPLETED';

    return {
      isLoading: isLoading && isLoggedIn,
      syncStatus: status,
      hasIntegrations,
      isFirstTimeSync,
      progress: data?.progress || { current: 0, total: 0, percentage: 0 },
      lastError: data?.lastError || error?.message || null,
      refreshIntegrationStatus,
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