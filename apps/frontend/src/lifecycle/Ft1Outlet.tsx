import React from 'react';
import { confirmFt2 } from 'api/lifecycle';
import { useShopLifecycle } from './ShopLifecycleContext';
import { Ft1ChecklistSurface } from 'ui/src/ui/ft1-checklist/Ft1ChecklistSurface';

/**
 * FT1 Promotion Surface (Snapshot-Driven)
 * ----------------------------------------
 * - No eligibility evaluation at render-time.
 * - Backend is sole authority for FT2 readiness.
 * - Confirm button delegates validation to backend.
 */

export function Ft1Outlet() {
  const { phase } = useShopLifecycle();
  const isFt1 = phase === 'FT1_READY';

  const [confirming, setConfirming] = React.useState(false);

  if (!isFt1) {
    return null;
  }

  return (
    <>
      <Ft1ChecklistSurface />

      <div style={{ padding: 24 }}>
        <p>When ready, unlock your insights below.</p>

        <button
          disabled={confirming}
          onClick={async () => {
            setConfirming(true);

            try {
              await confirmFt2();

              window.dispatchEvent(
                new CustomEvent('lifecycle:ft2-confirmed')
              );
            } catch (err) {
              console.error('[FT2][CONFIRM][FAILED]', err);
              setConfirming(false);
            }
          }}
        >
          Unlock insights
        </button>
      </div>
    </>
  );
}