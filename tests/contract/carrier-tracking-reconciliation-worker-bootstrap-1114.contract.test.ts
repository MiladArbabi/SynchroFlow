// tests/contract/carrier-tracking-reconciliation-worker-bootstrap-1114.contract.test.ts
//
// #1114 STEP 8D — permanent architecture/static contract proving the carrier
// tracking reconciliation worker is registered in the canonical worker
// bootstrap. Plain source-text scan, matching this repo's existing
// tests/contract/stock-protection-slice4-worker-architecture.contract.test.ts
// convention (AST is not needed here).
// ===========================================================================
// REQUIRED RED (at authoring time): bootstrap/workers.ts already exists (and
// is separately, legitimately modified by an earlier #1114 Decision Feed
// slice — that existing diff is untouched here) but contains NO reference
// to the carrier tracking reconciliation worker yet. Every assertion below
// therefore fails on a genuine content mismatch inside a file that DOES
// exist and DOES parse — never a missing-file/module-resolution/TypeScript
// error.
//
// This file asserts ONLY this worker's wiring. It never snapshots the whole
// bootstrap file and never requires any other worker (including
// return-resolution-decision-sync, registered by the earlier #1114 slice)
// to be removed, reordered, or reformatted.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const BOOTSTRAP_WORKERS_PATH = path.join(REPO, 'apps/backend/src/bootstrap/workers.ts');

function readBootstrapSource(): string {
  // bootstrap/workers.ts already exists — a read failure here would be a
  // genuine test-setup problem, not the RED this file exists to prove, so
  // it is allowed to throw its own natural ENOENT rather than being masked.
  return fs.readFileSync(BOOTSTRAP_WORKERS_PATH, 'utf8');
}

describe('#1114 STEP 8D — carrier tracking reconciliation worker bootstrap wiring', () => {
  it('A: dynamically imports the carrier tracking reconciliation worker module', () => {
    const source = readBootstrapSource();
    expect(source).toMatch(/await\s+import\(\s*['"]\.\.\/workers\/carrier-tracking-reconciliation\.worker\.js['"]\s*\)/);
  });

  it('B: registers the worker through the existing superviseWorker supervisor, not a bespoke start path', () => {
    const source = readBootstrapSource();
    expect(source).toMatch(/superviseWorker\(\s*['"]carrier-tracking-reconciliation['"]/);
  });

  it('C: invokes startCarrierTrackingReconciliationWorker', () => {
    const source = readBootstrapSource();
    expect(source).toMatch(/startCarrierTrackingReconciliationWorker\(\)/);
  });

  it('D: registers stopCarrierTrackingReconciliationWorker into workerStopFns', () => {
    const source = readBootstrapSource();
    // Attributive: proves THIS worker's stop function specifically is
    // pushed, not merely that `workerStopFns.push` appears somewhere in the
    // file (which is already true today for every other registered worker).
    expect(source).toMatch(/workerStopFns\.push\(\s*async\s*\(\)\s*=>\s*[a-zA-Z0-9_]+\.stopCarrierTrackingReconciliationWorker\(\)\s*\)/);
  });

  it('E: logs a bootstrap success message identifying the carrier tracking reconciliation worker as started/registered', () => {
    const source = readBootstrapSource();
    expect(source).toMatch(/\[bootstrap\/workers\][^'"`]*[Cc]arrier[^'"`]*[Tt]racking[^'"`]*[Rr]econciliation[^'"`]*(started|registered)/);
  });

  it('does not require removing or modifying the existing return-resolution-decision-sync worker registration', () => {
    // BASELINE-GREEN GUARD: proves this contract's scope is additive only.
    const source = readBootstrapSource();
    expect(source).toMatch(/startReturnResolutionDecisionSyncWorker/);
    expect(source).toMatch(/stopReturnResolutionDecisionSyncWorker/);
  });
});
