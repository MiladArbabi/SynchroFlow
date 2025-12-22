/* eslint-disable @typescript-eslint/no-explicit-any */
//apps/frontend/src/activation/CommerceActivationGate.tsx
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

import {
  mapActivationSurfaceToUIState,
  ActivationUIState
} from '@lasyncro/shared/ui/activation';

import { ModuleActivationBoundary } from '@lasyncro/shared/ui';

import { orderNexusActivationConfig } from './configs/orders';
import { customersActivationConfig } from './configs/customers';
import { productsActivationConfig } from './configs/products';
import { analyticsActivationConfig } from './configs/analytics';
import { financesActivationConfig } from './configs/finances';
import { OnboardingUIActionsContext } from 'contexts/OnboardingUIActionsContext';
import { ActivationSurfaceAdapter } from './ActivationSurfaceAdapter';

import { DataSyncingModal } from 'components/DataSyncingModal';

interface ActivationGateProps {
  moduleId: string;
  children: React.ReactNode;
}

const activationConfigs: Record<string, any> = {
  'order-nexus': orderNexusActivationConfig,
  customers: customersActivationConfig,
  products: productsActivationConfig,
  analytics: analyticsActivationConfig,
  finances: financesActivationConfig,
};

export function CommerceActivationGate({
  moduleId,
  children,
}: ActivationGateProps) {
  const surfaceConfig = activationConfigs[moduleId];

  if (!surfaceConfig) {
    throw new Error(
      `[ActivationGate] Missing activation config for moduleId: ${moduleId}`
    );
  }

  const { data: verdict, isLoading } = useQuery({
    queryKey: ['activation-verdict'],
    queryFn: async () => {
      const res = await axiosInstance.get('/api/v1/activation/verdict');
      return res.data.activationSurface;
    },
    staleTime: 30_000,
  });

  const uiActions = React.useMemo(() => ({
    openModal: (id: string) => {
      console.log('[uiActions.openModal] fired', id);

      if (id === 'connect-store') {
        window.dispatchEvent(
          new CustomEvent('ui:connect-store')
        );
      }
    },
    navigate: (path: string) => {
      window.location.assign(path);
    },
  }), []);

  if (isLoading || !verdict) {
    return null; // or a lightweight skeleton if you want
  }

  const isBlocking = verdict.ft0?.isBlocking === true;

  const activation: ActivationUIState =
    mapActivationSurfaceToUIState(
      verdict,
      surfaceConfig,
      moduleId
    );

  if (import.meta.env.DEV) {
    console.debug('[ActivationGate]', {
      moduleId,
      verdict,
      activationState: activation.state,
    });
  }

  return (
    <>
      {isBlocking && (
        <DataSyncingModal
          open
          isBlocking={true}
          onClose={() => {
            // NO-OP: modal auto-closes on phase transition
          }}
        />
      )}

      <OnboardingUIActionsContext.Provider value={uiActions}>
        <ModuleActivationBoundary
          activation={activation}
          renderBlocked={(surface) => (
            <ActivationSurfaceAdapter
              surface={surface}
              onAction={(actionId) => uiActions.openModal(actionId)}
            />
          )}
        >
          {children}
        </ModuleActivationBoundary>
      </OnboardingUIActionsContext.Provider>
    </>
  );
}