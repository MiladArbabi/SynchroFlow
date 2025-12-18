/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/activation/CommerceActivationGate.tsx
import React, { useState } from 'react';
import { useIntegration } from 'contexts/IntegrationContext';
import { ConnectStoreModal } from 'components/ConnectStoreModal';
import { registerActivationAction } from './activationActions';

import { orderNexusActivationConfig } from './configs/orders';
import { customersActivationConfig } from './configs/customers';
import { productsActivationConfig } from './configs/products';
import { analyticsActivationConfig } from './configs/analytics';
import { financesActivationConfig } from './configs/finances';

import { axiosInstance } from 'api/axiosConfig';
import { useAuth } from 'contexts/AuthContext';
import ActivationSurfacePage from './ActivationSurfacePage';
import SyncSurfacePage from './SyncSurfacePage';

interface ActivationGateProps {
  moduleId: string;
  children: React.ReactNode;
}

const activationConfigs: Record<string, any> = {
  'order-nexus': orderNexusActivationConfig,
  'customers': customersActivationConfig,
  'products': productsActivationConfig,
  'analytics': analyticsActivationConfig,
  'finances': financesActivationConfig,
};

export function CommerceActivationGate({
  moduleId,
  children,
}: ActivationGateProps) {
  const { hasIntegrations, syncStatus, progress } = useIntegration();
  const [open, setOpen] = useState(false);
  const { accessToken } = useAuth();

  React.useEffect(() => {
    registerActivationAction(moduleId, () => setOpen(true));
  }, [moduleId]);

  // FT-1 — No integration exists
  if (!hasIntegrations) {
    const baseConfig = activationConfigs[moduleId];

    if (!baseConfig) {
      throw new Error(
        `No ActivationSurface config found for moduleId: ${moduleId}`
      );
    }

    const handleOpenConnectModal = async () => {
      console.log('[ActivationGate] handleOpenConnectModal called');

      try {
        console.log('[ActivationGate] running pre-flight check');
        await axiosInstance.get('/api/v1/integrations/pre-flight', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        console.log('[ActivationGate] pre-flight OK → opening modal');
        setOpen(true);
      } catch (err) {
        console.error('[ActivationGate] Pre-flight failed', err);
      }
    };

    return (
      <>
        <ActivationSurfacePage
          config={baseConfig}
          onActivate={handleOpenConnectModal}
        />
        <ConnectStoreModal
          isOpen={open}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }

  // FT-0 — Integration exists, but initial sync not completed
  if (hasIntegrations && syncStatus !== 'COMPLETED') {
    return (
      <SyncSurfacePage
        moduleTitle={activationConfigs[moduleId]?.identity?.title ?? 'Preparing data'}
        syncStatus={syncStatus}
        progress={progress}
      />
    );
  }

return <>{children}</>;

}
