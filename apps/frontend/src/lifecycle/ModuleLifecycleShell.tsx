// apps/frontend/src/lifecycle/ModuleLifecycleShell.tsx

import React from 'react';
import { ModuleContentHost } from './ModuleContentHost';
import { useModuleLifecycle } from './useModuleLifecycle';

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
    </>
  );
}