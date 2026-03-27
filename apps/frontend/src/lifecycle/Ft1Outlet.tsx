/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { confirmFt2 } from 'api/lifecycle';
import { useShopLifecycle } from './ShopLifecycleContext';
import { Ft1ChecklistSurface } from 'ui/src/ui/ft1-checklist/Ft1ChecklistSurface';
import { getFt2Readiness } from 'api/lifecycle';
import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';

/**
 * FT1 Promotion Surface (Snapshot-Driven)
 * ----------------------------------------
 * - No eligibility evaluation at render-time.
 * - Backend is sole authority for FT2 readiness.
 * - Confirm button delegates validation to backend.
 */

export function Ft1Outlet() {
  const { phase } = useShopLifecycle();
  console.log('[FT1_OUTLET_RENDER]', { phase });

  /**
   * FT1 must render from lifecycle alone.
   * Readiness only affects inner UI (not mount).
   */
  const isFt1 = phase === 'FT1' || phase === 'FT1_READY';

  const [confirming, setConfirming] = React.useState(false);
  const [readiness, setReadiness] = React.useState<null | any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
  let cancelled = false;

  async function load() {
  const res = await getFt2Readiness();

  if (!cancelled) {
      setReadiness(res);
      setLoading(false);
    }
  }

  load();
  const i = setInterval(load, 3000);

  return () => {
    cancelled = true;
    clearInterval(i);
  };
}, []);

  if (!isFt1) return null;

  const isReady = readiness?.ready === true;

  /**
   * 🔥 UNIFIED LOADING SURFACE
   * --------------------------
   * Covers:
   * - initial fetch
   * - readiness false
   *
   * Prevents blank UI
   */
  if (loading || !isReady) {
    return <EmptyDashboardState />;
  }

  return (
    <>
      <Ft1ChecklistSurface />

      <div style={{ padding: 24 }}>

        {isReady && (
          <>
            <p>When ready, unlock your insights below.</p>

            <button
              disabled={confirming}
              onClick={async () => {
                setConfirming(true);

                try {
                  const readiness = await getFt2Readiness();

                  if (!readiness.ready) {
                    console.warn('[FT2_BLOCKED_NOT_READY]', {
                      readiness,
                    });
                    setConfirming(false);
                    return;
                  }

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
          </>
        )}
      </div>
    </>
  );
}