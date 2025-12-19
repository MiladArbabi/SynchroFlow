/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

import { 
  mapActivationVerdictToUIState,
  ActivationUIState
} from '@lasyncro/shared/src/ui/activation/activation-mapper';

import { ModuleActivationBoundary } from '@lasyncro/shared/ui';

import { orderNexusActivationConfig } from './configs/orders';
import { customersActivationConfig } from './configs/customers';
import { productsActivationConfig } from './configs/products';
import { analyticsActivationConfig } from './configs/analytics';
import { financesActivationConfig } from './configs/finances';
import { OnboardingUIActionsContext } from 'contexts/OnboardingUIActionsContext';
import { ActivationSurfaceAdapter } from './ActivationSurfaceAdapter';

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
      return res.data;
    },
    staleTime: 30_000,
  });

  const uiActions = React.useMemo(() => ({
    openModal: (id: string) => {
      if (id === 'connect-store') {
        // 🔑 this must trigger the SAME flow as Dashboard
        // either:
        // 1) emit a global event
        // 2) call a modal store
        // 3) navigate to /dashboard?connect=1
        window.dispatchEvent(new CustomEvent('open-connect-store'));
      }
    },
    navigate: (path: string) => {
      window.location.assign(path);
    },
  }), []);


  if (isLoading || !verdict) {
    return null; // or a lightweight skeleton if you want
  }

  const activation: ActivationUIState =
    mapActivationVerdictToUIState(verdict, surfaceConfig);

  if (import.meta.env.DEV) {
    console.debug('[ActivationGate]', {
      moduleId,
      verdict,
      activationState: activation.state,
    });
  }

  return (
    <OnboardingUIActionsContext.Provider value={uiActions}>
      <ModuleActivationBoundary
        activation={activation}
        renderBlocked={(surface) => (
          <ActivationSurfaceAdapter
            surface={surface}
            onAction={(actionId) => surface.onAction?.(actionId)}
          />
        )}
      >
        {children}
      </ModuleActivationBoundary>
    </OnboardingUIActionsContext.Provider>
  );
}