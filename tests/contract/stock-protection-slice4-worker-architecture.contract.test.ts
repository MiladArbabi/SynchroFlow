// tests/contract/stock-protection-slice4-worker-architecture.contract.test.ts
//
// STOCK-PROTECT-03 Slice 4 — permanent structural/architecture contracts for
// the periodic reconciliation worker and the dispatcher's lifecycle
// registration. Plain source-text scans, matching this repo's existing
// *-planning-authority.contract.test.ts convention (AST is not needed here).
// ===========================================================================
// Each test below is explicitly classified in its own description as one of:
//   REQUIRED RED        — Slice 4 behavior/file does not exist yet
//   BASELINE-GREEN GUARD — already true today, must stay true
// A missing-file case throws a clear, intentional message (not a raw ENOENT
// stack) so the RED reason is unambiguous.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const RECONCILIATION_WORKER_PATH = 'apps/backend/src/workers/stockProtectionReconciliation.worker.ts';
const BOOTSTRAP_WORKERS_PATH = 'apps/backend/src/bootstrap/workers.ts';
const MIGRATIONS_DIR = 'apps/backend/migrations';

function readSourceOrExpectedRed(relPath: string): string {
  const abs = path.join(REPO, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `[EXPECTED RED] ${relPath} does not exist yet — Slice 4 has not been implemented. ` +
      `This failure is intentional until the file is created.`,
    );
  }
  return fs.readFileSync(abs, 'utf8');
}

function listMigrationFiles(): string[] {
  const dir = path.join(REPO, MIGRATIONS_DIR);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => path.join(MIGRATIONS_DIR, f));
}

function findMigrationDefining(fnOrTableName: string): string | null {
  for (const relPath of listMigrationFiles()) {
    const source = fs.readFileSync(path.join(REPO, relPath), 'utf8');
    if (source.includes(fnOrTableName)) return relPath;
  }
  return null;
}

describe('Slice 4 — reconciliation worker structural contracts', () => {
  describe('REQUIRED RED — reconciliation worker does not exist yet', () => {
    it('worker imports canonical commercial-policy primitives (evaluateAccess + CAPABILITY_REQUIREMENTS), never hand-rolled tier logic', () => {
      const source = readSourceOrExpectedRed(RECONCILIATION_WORKER_PATH);
      expect(source).toMatch(/evaluateAccess/);
      expect(source).toMatch(/CAPABILITY_REQUIREMENTS/);
      expect(source).not.toMatch(/tierAtLeast\s*\(/); // must delegate via evaluateAccess, not re-derive
    });

    it('worker NEVER directly imports the canonical alert aggregator or Stock Protection evaluators', () => {
      const source = readSourceOrExpectedRed(RECONCILIATION_WORKER_PATH);
      expect(source).not.toMatch(/aggregateAlertsForShop/);
      expect(source).not.toMatch(/stockProtectionMonitoring/);
      expect(source).not.toMatch(/computeVariantPlanning/);
      expect(source).not.toMatch(/deriveStockProtectionTreatment|resolveAlertAction/);
    });

    it('worker performs cross-tenant discovery ONLY via the approved SECURITY DEFINER function, never a bare cross-tenant shop_subscriptions read', () => {
      const source = readSourceOrExpectedRed(RECONCILIATION_WORKER_PATH);
      expect(source).toMatch(/list_stock_protection_reconciliation_tenants/);
      // No bare cross-tenant table query bypassing the function.
      expect(source).not.toMatch(/systemQuery\([^)]*trx\(['"]shop_subscriptions['"]\)/);
      expect(source).not.toMatch(/db\(['"]shop_subscriptions['"]\)(?!.*list_stock_protection_reconciliation_tenants)/);
    });

    it('worker stop function is registered in bootstrap/workers.ts workerStopFns', () => {
      const source = readSourceOrExpectedRed(BOOTSTRAP_WORKERS_PATH);
      // This assertion targets bootstrap/workers.ts, which DOES exist today —
      // so this fails on assertion mismatch, not a missing-file throw, once
      // the worker file check above has already established RED.
      expect(source).toMatch(/stopStockProtectionReconciliationWorker/);
      expect(source).toMatch(/workerStopFns\.push/);
    });

    it('bootstrap supervises reconciliation startup while the worker owns its long-lived loop', () => {
      const bootstrap = readSourceOrExpectedRed(BOOTSTRAP_WORKERS_PATH);
      const worker = readSourceOrExpectedRed(RECONCILIATION_WORKER_PATH);

      expect(bootstrap).toMatch(
        /superviseWorker\(\s*['"]stock-protection-reconciliation['"]\s*,\s*\(\)\s*=>\s*stockProtectionReconciliation\.startStockProtectionReconciliationWorker\(\)\s*\)/s,
      );

      expect(worker).toMatch(/if\s*\(running\)\s*return\s*;/);
      expect(worker).toMatch(/loopPromise\s*=\s*runLoop\(\)/);
    });
  });

  describe('REQUIRED RED — dispatcher stop registration (bootstrap/workers.ts exists, content is missing)', () => {
    it('shopSnapshotJob dispatcher stop function is registered in workerStopFns', () => {
      const source = fs.readFileSync(path.join(REPO, BOOTSTRAP_WORKERS_PATH), 'utf8');
      expect(source).toMatch(/stopShopSnapshotJobDispatcher/);
    });
  });

  describe('BASELINE-GREEN GUARD — already true today, must never regress', () => {
    it('only one canonical file references list_due_shop_snapshot_tenants (no second dispatcher)', () => {
      const workersDir = path.join(REPO, 'apps/backend/src/workers');
      const matches: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!entry.name.endsWith('.ts')) continue;
          const source = fs.readFileSync(full, 'utf8');
          if (source.includes('list_due_shop_snapshot_tenants')) {
            matches.push(path.relative(REPO, full));
          }
        }
      };
      walk(workersDir);
      expect(matches).toEqual(['apps/backend/src/workers/projections/shopSnapshotJob.dispatcher.ts']);
    });

    it('no second job-queue table exists alongside shop_snapshot_jobs', () => {
      const queueLikeTables = new Set<string>();
      for (const relPath of listMigrationFiles()) {
        const source = fs.readFileSync(path.join(REPO, relPath), 'utf8');
        const matches = source.matchAll(/createTable\(['"]([a-z_]*snapshot[a-z_]*jobs?)['"]/g);
        for (const m of matches) queueLikeTables.add(m[1]);
      }
      expect([...queueLikeTables]).toEqual(['shop_snapshot_jobs']);
    });
  });

  describe('FUTURE REGRESSION GUARD — meaningless until the new migration exists', () => {
    it('list_stock_protection_reconciliation_tenants() contains no hardcoded tier/capability logic', () => {
      const migrationPath = findMigrationDefining('list_stock_protection_reconciliation_tenants');
      if (!migrationPath) {
        throw new Error(
          '[EXPECTED RED / FUTURE] No migration defining list_stock_protection_reconciliation_tenants() ' +
          'exists yet — this contract has no meaning until Slice 4 adds that migration.',
        );
      }
      const source = fs.readFileSync(path.join(REPO, migrationPath), 'utf8');
      const fnBodyMatch = source.match(/list_stock_protection_reconciliation_tenants[\s\S]*?\$\$/);
      const fnBody = fnBodyMatch ? fnBodyMatch[0] : source;
      expect(fnBody.toLowerCase()).not.toMatch(/'growth'|'scale'|'core'|demand\.forecasting/);
      expect(fnBody).toMatch(/status IN \('active', ?'trialing'\)|status = ANY/i);
    });
  });
});
