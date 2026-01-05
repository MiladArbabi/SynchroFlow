//apps/frontend/src/lifecycle/Ft2Outlet.tsx
import React from 'react';
import { useShopLifecycle } from './ShopLifecycleContext';

export function Ft2Outlet() {
  const { phase } = useShopLifecycle();

  if (phase !== 'FT2_READY') return null;

  return (
    <div style={{ padding: 24 }}>
      <h2>FT2 outlet is finally here</h2>
    </div>
  );
}
