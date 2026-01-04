/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/runtime/ModuleBootstrap.tsx
import React from 'react';
import { loadAllModules } from './moduleLoader';
import { _setRoutesChangeNotifier } from './registerRoute';
import { useRuntimeRoutes } from './useRuntimeRoutes';

export default function ModuleBootstrap() {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;

    loadAllModules().then(() => {
      if (mounted) setReady(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  return null;
}