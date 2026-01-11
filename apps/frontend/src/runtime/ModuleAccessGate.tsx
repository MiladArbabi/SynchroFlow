// ModuleAccessGate
// ----------------
// Runtime-level entitlement guard.
//
// Responsibilities:
// - Enforce module access based on resolved entitlement snapshot
// - Gate rendering behind paywall when module is not entitled
//
// Forbidden:
// - Must NOT infer lifecycle phase
// - Must NOT mutate entitlement state
// - Must NOT perform async loading


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

  const { snapshot } = useEntitlements();
  if (!snapshot) {
    // Entitlements unresolved — rendering is deferred to EntitlementBoundary
    return null;
  }

  const isEntitled = snapshot.modules.has(moduleId);

  if (!isEntitled) {
    return <PaywallSurface moduleId={moduleId} />;
  }

  return (
    <ModuleLifecycleShell moduleId={moduleId}>
      {children}
    </ModuleLifecycleShell>
  );
}