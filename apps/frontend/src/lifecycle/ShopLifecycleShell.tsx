import React from 'react';
import { useShopLifecycle } from './ShopLifecycleContext';
import { Ft1Outlet } from './Ft1Outlet';

/**
 * ShopLifecycleShell
 * ------------------
 * Pure lifecycle renderer.
 *
 * HARD RULES:
 * - NO data fetching
 * - NO lifecycle derivation
 * - NO state
 */
export function ShopLifecycleShell({ children }: { children: React.ReactNode }) {
  const { phase } = useShopLifecycle();

  return (
    <>
      {children}

      {/* FT1-only global surfaces */}
      {phase === 'FT1_READY' && <Ft1Outlet />}
    </>
  );
}
