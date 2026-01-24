// apps/frontend/src/lifecycle/ModuleLifecycleShell.tsx

import React from 'react';
import { ModuleContentHost } from './ModuleContentHost';
import { useModuleLifecycle } from './useModuleLifecycle';

// FT2 pages (explicit, additive)
import OrdersFT2Page from 'pages/ft2-pages/OrdersFT2Page';

interface ModuleLifecycleShellProps {
  moduleId: string;
  children: React.ReactNode;
}

export function ModuleLifecycleShell({
  moduleId,
  children,
}: ModuleLifecycleShellProps) {
  const { phase } = useModuleLifecycle();

  return (
    <>
      {children}

      <ModuleContentHost
        moduleId={moduleId}
        phase={phase}
      />

      {/* FT2 additive capability surfaces */}
      {phase === 'FT2_READY' && moduleId === 'orders' && (
        <OrdersFT2Page />
      )}
    </>
  );
}