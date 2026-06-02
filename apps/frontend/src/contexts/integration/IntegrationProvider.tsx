/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/contexts/integration/IntegrationProvider.tsx

import React, { ReactNode, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { axiosInstance } from 'api/axiosConfig';
import { useAuth } from '../AuthContext';

import {
  IntegrationContext,
  IntegrationContextValue,
  IntegrationExistence,
  IntegrationSyncState,
} from './_internal/IntegrationContext';

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

interface SyncStatus {
  integrationId: number | null;
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
  }

const fetchSyncStatus = async (): Promise<SyncStatus> => {
  const { data } = await axiosInstance.get(
    '/api/v1/integrations/sync-status'
  );
  return data;
};

function mapSyncState(
  status: SyncStatus['status']
): IntegrationSyncState {
  switch (status) {
    case 'COMPLETED':
      return 'COMPLETED';
    case 'PENDING':
      return 'PENDING';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'SYNCING';
  }
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export function IntegrationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  const bootResolvedRef = useRef(false);
  const lastExistenceRef =
    useRef<IntegrationExistence | null>(null);
  const lastSyncRef =
    useRef<IntegrationSyncState | null>(null);

  const { data, error, isLoading } = useQuery<
    SyncStatus,
    AxiosError
  >({
    queryKey: ['integration-status'],
    queryFn: fetchSyncStatus,
    enabled: isLoggedIn,
    retry: false,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['integration-status'],
    });
  }, [queryClient]);

    const value = useMemo<IntegrationContextValue>(() => {
    // DEV debug: surface ordering info and FT1 seal if present
    if (import.meta.env?.DEV) {
      try {
        const ft1Seal = localStorage.getItem('ft1_seal'); // generic key — update if yours differs
        console.debug('[IntegrationProvider][DEV]', {
          bootResolvedRef: bootResolvedRef.current,
          lastExistence: lastExistenceRef.current,
          lastSync: lastSyncRef.current,
          isLoading,
          data,
          ft1Seal,
        });
      } catch (err) {
        console.debug('[IntegrationProvider][DEV] localStorage read failed', err);
      }
    }

    if (!bootResolvedRef.current && isLoading) {
      return {
        bootState: 'BOOTING',
        existence: lastExistenceRef.current,
        syncState: lastSyncRef.current,
        hasIntegration: lastExistenceRef.current === 'EXISTS',
        isSyncComplete: lastSyncRef.current === 'COMPLETED',
        integrationId: null,
        refresh,
      };
    }

    if (data) {
      bootResolvedRef.current = true;

      if (data.status === 'NOT_FOUND') {
        lastExistenceRef.current = 'NONE';
        lastSyncRef.current = null;

        return {
          bootState: 'READY',
          existence: 'NONE',
          syncState: null,
          hasIntegration: false,
          isSyncComplete: false,
          integrationId: null,
          refresh,
        };
      }

      const syncState = mapSyncState(data.status);

      lastExistenceRef.current = 'EXISTS';
      lastSyncRef.current = syncState;

      return {
        bootState: 'READY',
        existence: 'EXISTS',
        syncState,
        hasIntegration: true,
        isSyncComplete: syncState === 'COMPLETED',
        integrationId: data.integrationId ?? null,
        refresh,
      };
    };

    // auth churn → preserve last known truth
    return {
      bootState: bootResolvedRef.current ? 'READY' : 'BOOTING',
      existence: lastExistenceRef.current,
      syncState: lastSyncRef.current,
      hasIntegration: lastExistenceRef.current === 'EXISTS',
      isSyncComplete: lastSyncRef.current === 'COMPLETED',
      integrationId: null,
      refresh,
    };
  }, [data, isLoading, refresh]);

  return (
    <IntegrationContext.Provider value={value}>
      {children}
    </IntegrationContext.Provider>
  );
}