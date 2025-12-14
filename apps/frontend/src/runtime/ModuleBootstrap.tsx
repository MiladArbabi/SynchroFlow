/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/runtime/ModuleBootstrap.tsx
import React from 'react';
import { loadAllModules } from './moduleLoader';
import { _setRoutesChangeNotifier } from './registerRoute';
import { useRuntimeRoutes } from './useRuntimeRoutes';
import { useEntitlements } from 'contexts/EntitlementsContext';

export default function ModuleBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const { bump } = useRuntimeRoutes();

  const { hasResolved } = useEntitlements();

  React.useEffect(() => {
    if (!hasResolved) {
      if (import.meta.env.DEV) {
        console.debug('[ModuleBootstrap] waiting for entitlements to resolve');
      }
      return;
    }

    let mounted = true;

    loadAllModules().then(() => {
      if (mounted) setReady(true);
    });

    return () => {
      mounted = false;
    };
  }, [hasResolved]);

  if (!ready) return null;

  return <>{children}</>;
}