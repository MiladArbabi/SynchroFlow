// apps/frontend/src/runtime/EntitlementBoundary.tsx

import React from 'react';
import { useEntitlements } from 'contexts/EntitlementsContext';

interface EntitlementBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const EntitlementBoundary: React.FC<EntitlementBoundaryProps> = ({
  children,
  fallback = null
}) => {
  const { hasResolved } = useEntitlements();

  if (!hasResolved) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};