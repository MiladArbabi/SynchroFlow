//apps/frontend/src/lifecycle/ShopLifecycleContext.ts
import React from 'react';
import { UILifecyclePhase } from './types';

export interface ShopLifecycleContextValue {
  phase: UILifecyclePhase;
  /**
   * GLOBAL READINESS (FT2 eligibility)
   * -----------------------------------
   * Source: LifecycleProvider
   * Contract:
   * - null → not yet resolved
   * - { ready: false } → FT1 NOT READY
   * - { ready: true } → FT1 READY
   *
   * MUST NOT be re-fetched outside lifecycle layer.
   */
  readiness: null | { ready: boolean };

  /**
   * BOOT STATE (Lifecycle initialization)
   * ---------------------------------------
   * true  → lifecycle snapshot not yet resolved
   * false → lifecycle fully resolved
   *
   * Used ONLY for gating initial render.
   */
  isBooting: boolean;
}

export const ShopLifecycleContext =
  React.createContext<ShopLifecycleContextValue | null>(null);

export function useShopLifecycle(): ShopLifecycleContextValue {
  const ctx = React.useContext(ShopLifecycleContext);

  if (!ctx) {
    throw new Error(
      'useShopLifecycle must be used inside ShopLifecycleShell'
    );
  }

  if (import.meta.env.DEV && !ctx.phase) {
    throw new Error(
      '[Lifecycle Violation] ShopLifecycleContext resolved without a phase'
    );
  }

  return ctx;
}
