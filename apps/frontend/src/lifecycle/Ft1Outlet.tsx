/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { confirmFt2 } from 'api/lifecycle';
import { useShopLifecycle } from './ShopLifecycleContext';
import { Ft1ChecklistSurface } from 'ui/src/ui/ft1-checklist/Ft1ChecklistSurface';
import { getFt2Readiness } from 'api/lifecycle';

/**
 * FT1 Promotion Surface (Snapshot-Driven)
 * ----------------------------------------
 * - No eligibility evaluation at render-time.
 * - Backend is sole authority for FT2 readiness.
 * - Confirm button delegates validation to backend.
 */

export function Ft1Outlet() {
  const { phase } = useShopLifecycle();
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

    async function loadReadiness() {
      console.info('[FT2_READINESS_FETCH_START]');

      try {
        const res = await getFt2Readiness();

        console.info('[FT2_READINESS_FETCH_SUCCESS]', res);

        if (!cancelled) {
          setReadiness(res);
        }
      } catch (err) {
        console.error('[FT2_READINESS_FETCH_FAILED]', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadReadiness();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isFt1) {
    return null;
  }

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <h3>Connecting your store…</h3>

        <p style={{ opacity: 0.7 }}>
          We’ve started syncing your data. This usually takes under a minute.
        </p>

        <div style={{ marginTop: 16, fontSize: 12, opacity: 0.5 }}>
          Establishing connection → Fetching orders → Preparing insights
        </div>
      </div>
    );
  }

  const isReady = readiness?.ready === true;

  return (
    <>
      <Ft1ChecklistSurface />

      <div style={{ padding: 24 }}>
        {!isReady && (
          <>
            <h3>Processing your data…</h3>
            <p>Your data is still syncing. This can take a minute.</p>

            <pre style={{ fontSize: 12, opacity: 0.6 }}>
              {JSON.stringify(readiness?.progress ?? {}, null, 2)}
            </pre>
          </>
        )}

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