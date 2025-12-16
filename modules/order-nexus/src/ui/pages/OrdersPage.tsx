import React, { useState } from 'react';
import { useIntegration } from 'contexts/IntegrationContext';
import ActivationSurfacePage from 'activation/ActivationSurfacePage';
import { orderNexusActivationConfig } from 'activation/configs/orderNexus';
import { ConnectStoreModal } from 'components/ConnectStoreModal';

export default function OrdersPage() {
  const { hasIntegrations } = useIntegration();
  const [open, setOpen] = useState(false);

  if (!hasIntegrations) {
    return (
      <>
        <ActivationSurfacePage
          config={orderNexusActivationConfig}
          onActivate={() => setOpen(true)}
        />
        <ConnectStoreModal
          isOpen={open}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }

  return (
    <div>
      Orders live content goes here
    </div>
  );
}
