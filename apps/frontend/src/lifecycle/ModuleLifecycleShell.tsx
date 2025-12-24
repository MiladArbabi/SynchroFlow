// apps/frontend/src/lifecycle/ModuleLifecycleShell.tsx

import React from 'react';

import { useActivationSurface } from 'activation/useActivationSurface';
import { ActivationSurfaceAdapter } from 'activation/ActivationSurfaceAdapter';
import { DataSyncingModal } from 'components/DataSyncingModal';
import {
  analyticsActivationConfig,
  customersActivationConfig,
  productsActivationConfig,
  orderNexusActivationConfig,
  financesActivationConfig,
} from 'activation/configs';
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

const ACTIVATION_CONFIGS: Record<string, ActivationSurfaceProps> = {
    analytics: analyticsActivationConfig,
    customers: customersActivationConfig,
    products: productsActivationConfig,
    'order-nexus': orderNexusActivationConfig,
    finances: financesActivationConfig,
};

interface ModuleLifecycleShellProps {
  moduleId: string;
  children: React.ReactNode;
}

/**
 * ModuleLifecycleShell
 * -------------------
 * Owns activation gating for a single module.
 *
 * HARD RULES:
 * - No lifecycle derivation
 * - No FT logic
 * - No onboarding semantics
 * - No UI decisions beyond delegation
 */

export function ModuleLifecycleShell({
  moduleId,
  children,
}: ModuleLifecycleShellProps) {
  const { surface, isLoading, dismissFT0Modal } = useActivationSurface({ moduleId });

    const config = ACTIVATION_CONFIGS[moduleId];

    // 1️⃣ Still resolving activation
    if (isLoading || !surface) {
        return null;
    }

    if (!config) {
        console.warn(
        `[ModuleLifecycleShell] Missing activation config for moduleId: ${moduleId}`
        );
        return null;
    }

  // 2️⃣ FT0 syncing modal (session UX)
  if (surface.state === 'SYNC_IN_PROGRESS') {
    return (
      <DataSyncingModal
        open
        onClose={dismissFT0Modal}
      />
    );
  }

  // 3️⃣ Not active → show activation surface
    if (surface.state !== 'ACTIVE') {
    return (
        <ActivationSurfaceAdapter
        surface={config}
        onAction={(actionId) => {
            window.dispatchEvent(
            new CustomEvent('activation:action', {
                detail: { moduleId, actionId },
            })
            );
        }}
        />
    );
    }

  // 4️⃣ ACTIVE → render module
  return <>{children}</>;
}