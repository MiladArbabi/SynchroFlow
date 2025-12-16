// apps/frontend/src/activation/FT1ActivationGate.tsx
import React from 'react';
import { ActivationSurface } from '@lasyncro/shared/ui';
import { useIntegration } from 'contexts/IntegrationContext';

interface FT1ActivationGateProps {
  moduleId: string;
  children: React.ReactNode;
}

export function CommerceFT1Gate({
  moduleId,
  children,
}: FT1ActivationGateProps) {
  const { hasIntegrations } = useIntegration();

  if (!hasIntegrations) {
    return <ActivationSurface moduleId={moduleId} />;
  }

  return <>{children}</>;
}