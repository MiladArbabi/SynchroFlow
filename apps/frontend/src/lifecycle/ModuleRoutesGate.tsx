// apps/frontend/src/lifecycle/ModuleRoutesGate.tsx

import { Outlet } from 'react-router-dom';
import { useShopLifecycle } from './ShopLifecycleContext';

export function ModuleRoutesGate() {
  const { phase } = useShopLifecycle();

  if (phase !== 'FT1_READY') {
    return null; // modules do not exist pre-FT1
  }

  return <Outlet />;
}
