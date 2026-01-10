import React from 'react';

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
  return <>{children}</>;
}