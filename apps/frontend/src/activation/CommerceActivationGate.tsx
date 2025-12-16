/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/activation/CommerceActivationGate.tsx
import React, { useState } from 'react';
import { useIntegration } from 'contexts/IntegrationContext';
import { ConnectStoreModal } from 'components/ConnectStoreModal';

import { orderNexusActivationConfig } from './configs/orderNexus';
import ActivationSurfacePage from './ActivationSurfacePage';

interface ActivationGateProps {
  moduleId: string;
  children: React.ReactNode;
}

const activationConfigs: Record<string, any> = {
  'order-nexus': orderNexusActivationConfig,
};

export function CommerceActivationGate({
  moduleId,
  children,
}: ActivationGateProps) {
  const { hasIntegrations } = useIntegration();
  const [open, setOpen] = useState(false);

  if (!hasIntegrations) {
    const baseConfig = activationConfigs[moduleId];

    if (!baseConfig) {
      throw new Error(
        `No ActivationSurface config found for moduleId: ${moduleId}`
      );
    }

    return (
      <>
        <ActivationSurfacePage
          config={baseConfig}
          onActivate={() => setOpen(true)}
        />
        <ConnectStoreModal
          isOpen={open}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }

  return <>{children}</>;
}