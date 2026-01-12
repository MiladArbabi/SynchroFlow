/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { evaluateFt2, confirmFt2, confirmFt1 } from 'api/lifecycle';
import { useShopLifecycle } from './ShopLifecycleContext';
import { Ft1ChecklistSurface } from 'ui/src/ui/ft1-checklist/Ft1ChecklistSurface';

/**
 * Ft1Outlet
 * ---------
 * Explicit FT1 → FT2 promotion surface.
 *
 * CRITICAL ARCHITECTURAL INVARIANT:
 * - All FT1-global surfaces (e.g. checklist drawers) MUST be mounted
 *   in a STABLE position that does NOT change across FT1 render states.
 *
 * WHY:
 * - Conditional returns cause subtree destruction
 * - Subtree destruction kills effects
 * - Killed effects unregister event listeners
 * - Result: events silently fail
 *
 * This component therefore:
 * - Mounts Ft1ChecklistSurface ONCE per FT1 session
 * - Delegates all conditional UI to Ft1OutletContent
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

  /* console.log('[FT1][OUTLET][RENDER]', {
    phase,
    ts: performance.now(),
  }); */

  // ─────────────────────────────────────────────
  // STATE (always mounted while FT1 subtree exists)
  // ─────────────────────────────────────────────
  const [evaluation, setEvaluation] = React.useState<any | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [confirming, setConfirming] = React.useState(false);

  /**
   * Fetch FT2 eligibility (READ-ONLY)
   *
   * IMPORTANT:
   * - Hook executes unconditionally
   * - Side-effect gated by isFt1
   * - No lifecycle inference
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

  // ─────────────────────────────────────────────
  // RENDER GATE — FT1 ONLY
  // ─────────────────────────────────────────────
  if (!isFt1) {
    return null;
  }

  /**
   * CRITICAL:
   * - Ft1ChecklistSurface is mounted HERE
   * - This position is STABLE across all FT1 states
   * - It will NOT be unmounted when loading/evaluation changes
   */
  return (
    <>
      {/* FT1-global onboarding checklist (stable mount) */}
      <Ft1ChecklistSurface />

      {/* FT1 conditional content */}
      <Ft1OutletContent
        loading={loading}
        evaluation={evaluation}
        confirming={confirming}
        setConfirming={setConfirming}
      />
    </>
  );
}

/**
 * Ft1OutletContent
 * ----------------
 * Pure FT1 UI state machine.
 *
 * IMPORTANT:
 * - No global surfaces
 * - No event listeners
 * - Safe to remount
 *
 * This component is intentionally allowed to re-render and remount.
 */
function Ft1OutletContent({
  loading,
  evaluation,
  confirming,
  setConfirming,
}: {
  loading: boolean;
  evaluation: any;
  confirming: boolean;
  setConfirming: (v: boolean) => void;
}) {

  const [confirmingFt1, setConfirmingFt1] = React.useState(false);

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
        <p>Your onboarding is complete.</p>

        {/* FT1 CONFIRM — explicit lifecycle transition */}
        <button
          disabled={confirmingFt1}
          onClick={async () => {
            setConfirmingFt1(true);

            console.info('[FT1][CONFIRM][CLICKED]');

            try {
              await confirmFt1();
              console.info('[FT1][CONFIRM][SUCCESS]');
            } catch (err) {
              console.error('[FT1][CONFIRM][FAILED]', err);
              setConfirmingFt1(false);
              return;
            }
          }}
        >
          Continue
        </button>

        <hr style={{ margin: '16px 0' }} />

        {/* FT2 CONFIRM — now valid ONLY after FT1 snapshot updates */}
        <button
          disabled={confirming}
          onClick={async () => {
            setConfirming(true);

            console.info('[FT2][CONFIRM][CLICKED]');

            try {
              await confirmFt2();

              window.dispatchEvent(
                new CustomEvent('lifecycle:ft2-confirmed')
              );

              console.info('[FT2][CONFIRM][SUCCESS]');
            } catch (err) {
              console.error('[FT2][CONFIRM][FAILED]', err);
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
   * STATE — Insufficient data
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
   * STATE — Preparing (fallback)
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