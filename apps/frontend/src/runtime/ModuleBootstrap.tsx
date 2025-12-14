/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/runtime/ModuleBootstrap.tsx
import React from 'react';
import { loadAllModules } from './moduleLoader';
import { _setRoutesChangeNotifier } from './registerRoute';
import { useRuntimeRoutes } from './useRuntimeRoutes';

export default function ModuleBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const { bump } = useRuntimeRoutes();

  React.useEffect(() => {
  let mounted = true;

  loadAllModules().then(() => {
    if (mounted) setReady(true);
  });

  return () => {
    mounted = false;
  };
}, []);

  if (!ready) return null;

  return <>{children}</>;
}