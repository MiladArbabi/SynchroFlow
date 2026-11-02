// tests/contract/shopify-recovery-inventory-sync-i4.contract.test.ts
//
// S4-5 I4 — structural boundaries of the Shopify recovery sync.
// PURE / CONTRACT layer: reads source as text (opening-inventory-cutover-routes
// convention). No DB, no server, no provider.
//
//   S1 I3 recovery Stow never synchronises with Shopify; I4 never writes the
//      ledger, truth or I3 tables; recount is not wired into I4 (#1277).
//   S2 the ordinary inbound Stow push gate is unchanged.
//   S3 CB1 runs inside the freeze transaction, before the 'frozen' update.
//   S4 CB2 runs inside the canonical authority capture, after the fingerprint
//      check, and turns a recovery-credit difference into drift.
//   S5 the recovery adjustment request shape (OD5) and stable identity.
//   S6 0228: FORCE RLS on all three tables, sf_app grants without DELETE,
//      23-hour cutoff and maintenance-only expiry exit.
//   S7 the worker is supervised and lists tenants through the 0228 function.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const I3 = 'apps/backend/src/services/wms/receiveHeldRecoveryStow.service.ts';
const SYNC = 'apps/backend/src/services/wms/shopifyRecoveryInventorySync.service.ts';
const CAPTURE = 'apps/backend/src/services/wms/openingInventoryRecoveryCapture.service.ts';
const GENERATION = 'apps/backend/src/services/wms/openingInventoryCutoverGeneration.service.ts';
const EXECUTION = 'apps/backend/src/services/wms/openingInventoryCutoverExecution.service.ts';
const CONTROLLER = 'apps/backend/src/api/wms/wms.controller.ts';
const RECOUNT = 'apps/backend/src/services/wms/inventoryRecount.service.ts';
const WORKER = 'apps/backend/src/workers/shopifyRecoveryInventorySync.worker.ts';
const BOOTSTRAP = 'apps/backend/src/bootstrap/workers.ts';
const MIGRATION = 'apps/backend/migrations/20261101120000_0228_shopify_recovery_inventory_sync.ts';

describe('S4-5 I4 recovery sync — structural contract', () => {
  it('S1 I3 has no Shopify path; I4 writes no ledger, truth or I3 rows; recount stays separate', () => {
    const i3 = code(read(I3));
    expect(i3).not.toMatch(/shopify/i);

    const sync = code(read(SYNC)) + code(read(CAPTURE));
    for (const table of [
      'inventory_movements',
      'inventory_truth',
      'receive_held_recovery_events',
      'inventory_units',
      'stow_tasks',
      'problem_center_tasks',
    ]) {
      const writes = new RegExp(`trx\\(\\s*'${table}'[^)]*\\)[\\s\\S]{0,200}?\\.(insert|update|del|merge)\\(`);
      expect(sync).not.toMatch(writes);
    }
    expect(code(read(RECOUNT))).not.toMatch(/RecoveryInventorySync|shopifyRecovery/);
  });

  it('S2 the ordinary Stow push stays gated to inbound_stock', () => {
    const controller = read(CONTROLLER);
    expect(controller).toMatch(/stowedTask\?\.trigger === 'inbound_stock' &&/);
    expect(code(controller)).not.toMatch(/shopifyRecoveryInventorySync/);
  });

  it('S3 CB1 is inside the freeze transaction, before the frozen update', () => {
    const src = code(read(GENERATION));
    const capture = src.indexOf('await captureRecoveryCreditsForGeneration(');
    const frozen = src.indexOf("'frozen',", capture);
    const isolation = src.indexOf("'repeatable read'", capture);
    expect(capture).toBeGreaterThan(0);
    expect(src.indexOf('await captureRecoveryCreditsForGeneration(', capture + 1)).toBe(-1);
    expect(frozen).toBeGreaterThan(capture);
    expect(isolation).toBeGreaterThan(frozen);
    const fn = src.lastIndexOf('async function freezeOpeningInventoryCutoverGeneration(', capture);
    expect(fn).toBeGreaterThan(0);
    const next = src.indexOf('async function ', fn + 1);
    expect(next === -1 ? src.length : next).toBeGreaterThan(isolation);
  });

  it('S4 CB2 is in the canonical capture, after the fingerprint check, as drift', () => {
    const src = code(read(EXECUTION));
    const start = src.indexOf('async function captureCurrentAuthorityInTrx(');
    const end = src.indexOf('\nasync function ', start + 1);
    const body = src.slice(start, end);
    const fingerprint = body.indexOf("return drift('PHYSICAL_TARGET_CHANGED')");
    const compare = body.indexOf('compareRecoveryCreditsWithCapture(');
    expect(fingerprint).toBeGreaterThan(0);
    expect(compare).toBeGreaterThan(fingerprint);
    expect(body).toMatch(/recoveryCapture\.kind === 'changed'\)\s*\{\s*return drift\('RECOVERY_CREDITS_CHANGED'\)/);
    expect(src.split('compareRecoveryCreditsWithCapture(').length - 1).toBe(1);
  });

  it('S5 one +1 correction to available with a stable key and recovery URI', () => {
    const sync = read(SYNC);
    expect(sync).toMatch(/inventoryAdjustQuantities\(input: \$input\)\s*@idempotent\(key: \$idempotencyKey\)/);
    expect(sync).toMatch(/reason: 'correction',\s*name: 'available',\s*referenceDocumentUri:/);
    expect(sync).toMatch(/delta: 1,\s*changeFromQuantity: null,/);
    expect(sync).toMatch(/idempotencyKey: `lasyncro:receive-recovery:\$\{shopId\}:\$\{creditMovementId\}`/);
    expect(sync).toMatch(/gid:\/\/lasyncro\/ReceiveRecoveryCredit\/shop-\$\{shopId\}-movement-\$\{creditMovementId\}/);
    expect(sync).toMatch(/RETRY_CUTOFF_HOURS = 23;/);
  });

  it('S6 0228 isolates tenants, withholds DELETE and enforces the retry window', () => {
    const migration = read(MIGRATION);
    for (const table of [
      'opening_inventory_recovery_capture_headers',
      'opening_inventory_recovery_capture_credits',
      'shopify_recovery_inventory_syncs',
    ]) {
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`REVOKE ALL ON ${table} FROM sf_app;`);
      expect(migration).not.toMatch(new RegExp(`GRANT [A-Z, ]*DELETE[A-Z, ]* ON ${table}`));
    }
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE ON shopify_recovery_inventory_syncs TO sf_app;");
    expect(migration).toContain("now() >= OLD.first_dispatched_at + interval '23 hours'");
    expect(migration).toContain("session_user <> 'sf_app' AND NEW.status IN ('succeeded', 'rejected')");
    expect(migration).toContain('RECOVERY_SYNC_PUSH_OF_INCLUDED_CREDIT');
    expect(migration).toContain('RECOVERY_SYNC_SKIP_WITHOUT_INCLUSION');
  });

  it('S7 the worker is supervised and discovers tenants through 0228', () => {
    expect(read(WORKER)).toContain("public.list_shopify_recovery_inventory_sync_tenants()");
    expect(read(BOOTSTRAP)).toMatch(/superviseWorker\(\s*'shopify-recovery-inventory-sync'/);
  });

  it('S8 default OFF: bootstrap registers the worker only behind the exact-"true" flag', () => {
    const bootstrap = code(read(BOOTSTRAP));
    const gate = bootstrap.indexOf('if (!recoveryInventorySync.isShopifyRecoveryInventorySyncEnabled())');
    const supervise = bootstrap.indexOf("'shopify-recovery-inventory-sync'");
    expect(gate).toBeGreaterThan(0);
    expect(supervise).toBeGreaterThan(gate);
    expect(bootstrap.slice(gate, supervise)).toMatch(/\}\s*else if \(/);

    const worker = code(read(WORKER));
    expect(worker).toMatch(/return env\[SHOPIFY_RECOVERY_INVENTORY_SYNC_FLAG\] === 'true';/);
    for (const fn of ['runShopifyRecoveryInventorySyncCycle', 'startShopifyRecoveryInventorySyncWorker']) {
      const body = worker.slice(worker.indexOf(`export async function ${fn}(`));
      expect(body.split('\n').slice(0, 2).join('\n')).toContain('if (!isShopifyRecoveryInventorySyncEnabled()) return;');
    }
  });
});
