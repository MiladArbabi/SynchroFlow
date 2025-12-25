// apps/frontend/src/lifecycle/ShopLifecycleDevHUD.tsx

import React from 'react';
import { useShopLifecycle } from './ShopLifecycleContext';

export function ShopLifecycleDevHUD() {
  const { phase } = useShopLifecycle(); // ✅ ALWAYS called

  if (!import.meta.env.DEV) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        padding: '8px 12px',
        background: '#111827',
        color: '#e5e7eb',
        fontSize: 12,
        borderRadius: 6,
        zIndex: 9999,
        fontFamily: 'monospace',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <div style={{ opacity: 0.6 }}>ShopLifecycle</div>
      <div style={{ fontWeight: 600 }}>{phase}</div>
    </div>
  );
}
