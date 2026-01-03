/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { evaluateFt2, confirmFt2, getLifecycle } from 'api/lifecycle';
import { useShopLifecycle } from './ShopLifecycleContext';

/**
 * Ft1Outlet
 * ---------
 * Explicit FT1 → FT2 promotion surface.
 *
 * HARD RULES:
 * - Eligibility ≠ promotion
 * - Promotion is user-initiated ONLY
 * - No auto-confirm
 * - No background promotion
 *
 * Hooks MUST always execute unconditionally.
 * Lifecycle gating is done via rendering, not hook execution.
 */
export function Ft1Outlet() {
  const { phase } = useShopLifecycle();
  const isFt1 = phase === 'FT1_READY';

  // Hooks — ALWAYS executed
  const [evaluation, setEvaluation] = React.useState<any | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [confirming, setConfirming] = React.useState(false);

  /**
   * Fetch FT2 eligibility (READ-ONLY)
   * Runs ONLY while in FT1, but hook is unconditional.
   */
  React.useEffect(() => {
    if (!isFt1) {
      return;
    }

    let alive = true;

    console.info('[FT1] evaluating FT2 eligibility');

    evaluateFt2()
      .then(result => {
        if (!alive) return;

        console.info('[FT1] evaluator result', {
          eligible: result.eligible,
          blockers: result.blockers,
          ts: performance.now(),
        });

        setEvaluation(result);
        setLoading(false);
      })
      .catch(err => {
        console.error('[FT1] evaluator failed', err);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [isFt1]);

  // Render gating (safe)
  if (!isFt1) {
    return null;
  }

  /**
   * STATE — Loading / Preparing
   */
  if (loading || !evaluation) {
    return (
      <Ft1Panel>
        <p>We are preparing your data visualizations.</p>
        <p>Completing the checklist will speed things up.</p>
      </Ft1Panel>
    );
  }

  const hasDataCoverageBlockers =
    evaluation.blockers?.some(
      (b: any) => b.category === 'DATA_COVERAGE'
    );

  /**
   * STATE — Eligible (Confirm visible)
   */
  if (evaluation.eligible === true) {
    return (
      <Ft1Panel>
        <p>We now have enough data to unlock your insights.</p>

        <button
          disabled={confirming}
          onClick={async () => {
            setConfirming(true);

            console.info('[FT1] user confirmed FT2 promotion');

            try {
              await confirmFt2();

              // Lifecycle shell will refetch on next render
              await getLifecycle();

              console.info('[FT1] FT2 confirmed successfully');
            } catch (err) {
              console.error('[FT1] FT2 confirm failed', err);
              setConfirming(false);
            }
          }}
        >
          Unlock insights
        </button>
      </Ft1Panel>
    );
  }

  /**
   * STATE — Insufficient data (explicit blockers)
   */
  if (hasDataCoverageBlockers) {
    return (
      <Ft1Panel>
        <p>We still need more data to unlock insights.</p>
        <p>Please complete the checklist below.</p>
      </Ft1Panel>
    );
  }

  /**
   * STATE — Preparing (default)
   */
  return (
    <Ft1Panel>
      <p>We are preparing your data visualizations.</p>
      <p>Completing the checklist will speed things up.</p>
    </Ft1Panel>
  );
}

/**
 * Structural wrapper — no logic
 */
function Ft1Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 24 }}>
      {children}
    </div>
  );
}
