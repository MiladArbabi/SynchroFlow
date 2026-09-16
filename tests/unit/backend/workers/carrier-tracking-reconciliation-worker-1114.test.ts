// tests/unit/backend/workers/carrier-tracking-reconciliation-worker-1114.test.ts
//
// #1114 STEP 8B — carrier tracking reconciliation worker lifecycle contract.
// PERMANENT regression contract, authored RED.
// ===========================================================================
// REQUIRED RED (at authoring time): apps/backend/src/workers/
// carrier-tracking-reconciliation.worker.ts does not exist yet — the static
// import below fails module resolution, narrowly attributable to the
// missing STEP 8B worker file, matching the exact precedent already
// established in this repo for an authored-before-implementation worker
// contract (see tests/unit/workers/shop-snapshot-job-dispatcher.lifecycle.test.ts
// for the guard-testing conventions this file follows, and
// tests/integration/workers/stock-protection-reconciliation.worker.contract.test.ts
// for the "static import of a not-yet-existing worker module is the accepted
// RED shape" precedent).
//
// Pure unit test: no disposable Postgres, no real timers. The reconciliation
// SERVICE (apps/backend/src/services/wms/carrierTrackingReconciliation.service.ts)
// already exists and is fully covered by Step 7 — it is mocked here so this
// file proves ONLY interval/guard/lifecycle scaffolding, never provider
// behavior, DB selection, tenant isolation, status mapping, alerts, Return
// Jobs, or credentials.

import {
  startCarrierTrackingReconciliationWorker,
  stopCarrierTrackingReconciliationWorker,
} from 'api-src/workers/carrier-tracking-reconciliation.worker';
import { runCarrierTrackingReconciliationCycle } from 'api-src/services/wms/carrierTrackingReconciliation.service';

jest.mock('api-src/services/wms/carrierTrackingReconciliation.service');

const mockRunCycle = runCarrierTrackingReconciliationCycle as jest.MockedFunction<
  typeof runCarrierTrackingReconciliationCycle
>;

const CADENCE_MS = 1_800_000; // 30 minutes — the ratified worker cadence.

const EMPTY_CYCLE_RESULT = { candidates: 0, reconciled: 0, skipped: 0, failed: 0 };

/** Flushes the microtask queue so an already-resolved/rejected timer callback's async body completes. */
async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('carrier tracking reconciliation worker — lifecycle contract', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRunCycle.mockReset();
    mockRunCycle.mockResolvedValue(EMPTY_CYCLE_RESULT);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    // Module-level worker state (the interval handle / in-flight guard)
    // must never leak into the next test.
    await stopCarrierTrackingReconciliationWorker();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function allLoggedTags(): string[] {
    return [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call) => call[0])
      .filter((tag): tag is string => typeof tag === 'string');
  }

  // ── A. START = IMMEDIATE FIRST CYCLE ─────────────────────────────────
  it('A: starting the worker triggers one reconciliation cycle immediately, with no wait for the interval', async () => {
    await startCarrierTrackingReconciliationWorker();

    expect(mockRunCycle).toHaveBeenCalledTimes(1);
    expect(allLoggedTags()).toContain('[CARRIER_RECONCILIATION_WORKER_STARTED]');
  });

  // ── B. CADENCE = EXACTLY 30 MINUTES ──────────────────────────────────
  it('B: the recurring cadence is exactly 1,800,000ms — advancing 30 minutes after the first cycle settles triggers the next cycle', async () => {
    await startCarrierTrackingReconciliationWorker();
    await flush();
    expect(mockRunCycle).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(CADENCE_MS);
    await flush();
    expect(mockRunCycle).toHaveBeenCalledTimes(2);
  });

  // ── C. NO OVERLAPPING CYCLES ──────────────────────────────────────────
  it('C: an overlapping tick is skipped while the first cycle is still in flight, and a later tick proceeds once it resolves', async () => {
    let resolveFirstCycle!: () => void;
    const firstCycleGate = new Promise((resolve) => {
      resolveFirstCycle = () => resolve(EMPTY_CYCLE_RESULT);
    });
    mockRunCycle.mockReturnValueOnce(firstCycleGate as any);

    await startCarrierTrackingReconciliationWorker(); // immediate cycle starts, hangs on the gate
    await flush();
    expect(mockRunCycle).toHaveBeenCalledTimes(1);

    // A 30-minute tick fires while the first cycle is still unresolved.
    jest.advanceTimersByTime(CADENCE_MS);
    await flush();

    // Load-bearing: the overlapping tick must NOT start a second cycle.
    expect(mockRunCycle).toHaveBeenCalledTimes(1);
    expect(allLoggedTags()).toContain('[CARRIER_RECONCILIATION_CYCLE_SKIPPED_OVERLAP]');

    // The first cycle now resolves...
    resolveFirstCycle();
    await flush();

    // ...and a later tick may proceed normally.
    jest.advanceTimersByTime(CADENCE_MS);
    await flush();
    expect(mockRunCycle).toHaveBeenCalledTimes(2);
  });

  // ── D. CYCLE FAILURE DOES NOT KILL THE WORKER ────────────────────────
  it('D: a rejected cycle is contained and logged — the worker keeps polling on schedule afterward', async () => {
    mockRunCycle.mockRejectedValueOnce(new Error('fixture cycle failure'));

    await startCarrierTrackingReconciliationWorker();
    await flush();

    expect(mockRunCycle).toHaveBeenCalledTimes(1);
    expect(allLoggedTags()).toContain('[CARRIER_RECONCILIATION_WORKER_CYCLE_FAILED]');

    // No unhandled rejection should have propagated out of the worker —
    // the next scheduled tick must still be able to call the service.
    mockRunCycle.mockResolvedValueOnce(EMPTY_CYCLE_RESULT);
    jest.advanceTimersByTime(CADENCE_MS);
    await flush();

    expect(mockRunCycle).toHaveBeenCalledTimes(2);
  });

  // ── E. STOP CLEARS FUTURE POLLING ─────────────────────────────────────
  it('E: stopping the worker prevents any further scheduled cycles', async () => {
    await startCarrierTrackingReconciliationWorker();
    await flush();
    expect(mockRunCycle).toHaveBeenCalledTimes(1);

    await stopCarrierTrackingReconciliationWorker();

    jest.advanceTimersByTime(CADENCE_MS * 3);
    await flush();

    expect(mockRunCycle).toHaveBeenCalledTimes(1); // unchanged — no further ticks fired
  });

  // ── F. REPEATED START MUST NOT CREATE MULTIPLE INTERVALS ─────────────
  it('F: calling start() twice does not create duplicate recurring timers or duplicate cycles', async () => {
    await startCarrierTrackingReconciliationWorker();
    await startCarrierTrackingReconciliationWorker();
    await flush();

    // Two duplicate immediate-fire pollers would each have run their own
    // first cycle here — the guard must keep this at exactly one.
    expect(mockRunCycle).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(CADENCE_MS);
    await flush();

    // A duplicated interval would produce 3 (1 immediate + 2 duplicate
    // ticks) instead of 2.
    expect(mockRunCycle).toHaveBeenCalledTimes(2);
  });
});
