//apps/frontend/src/runtime/ModuleAccessGate.tsx
import React from 'react';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { ModuleLifecycleShell } from 'lifecycle/ModuleLifecycleShell';
import { PaywallSurface } from 'lifecycle/PaywallSurface';

export function ModuleAccessGate({
  moduleId,
  children,
}: {
  moduleId: string;
  children: React.ReactNode;
}) {
  const { hasModule } = useEntitlements();
  const isEntitled = hasModule(moduleId);

  if (!isEntitled) {
    return <PaywallSurface moduleId={moduleId} />;
  }

  return (
    <ModuleLifecycleShell moduleId={moduleId}>
      {children}
    </ModuleLifecycleShell>
  );
}