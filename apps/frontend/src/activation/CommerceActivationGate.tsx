// apps/frontend/src/activation/CommerceActivationGate.tsx
import React, { useState } from 'react';
import { ActivationSurface } from '@lasyncro/shared/ui';
import { useIntegration } from 'contexts/IntegrationContext';
import { ConnectStoreBanner } from 'components/ConnectStoreBanner';
import { ConnectStoreModal } from 'components/ConnectStoreModal';

interface ActivationGateProps {
  moduleId: string;
  children: React.ReactNode;
}

export function CommerceActivationGate({
  moduleId,
  children,
}: ActivationGateProps) {
  const { hasIntegrations } = useIntegration();
  const [open, setOpen] = useState(false);

  if (!hasIntegrations) {
     return (
       <>
         <ActivationSurface 
          moduleId={moduleId}
          headline={`Activate ${moduleId}`} 
          description="Connect your store to unlock insights and automation."
          integrationCTA={
             <ConnectStoreBanner onOpenModal={() => setOpen(true)} />
          }
        />
       <ConnectStoreModal isOpen={open} onClose={() => setOpen(false)} />
      </>
     ); 
  }

  return <>{children}</>;
}