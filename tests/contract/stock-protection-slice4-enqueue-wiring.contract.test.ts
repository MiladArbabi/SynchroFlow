// tests/contract/stock-protection-slice4-enqueue-wiring.contract.test.ts
//
// STOCK-PROTECT-03 Slice 4 — FUNCTION-SCOPED enqueueShopSnapshotJob(...)
// wiring contract. PERMANENT regression contract.
// ===========================================================================
// Every ratified operation is checked in ISOLATION — extracting that named
// function's own source region and counting calls strictly within it — so a
// whole-file count (e.g. "suppliers.controller.ts contains 6 calls total")
// can never satisfy this contract; each of the six handlers in that file
// must independently contain its own call.
//
// REQUIRED RED items: the named function currently contains ZERO
// enqueueShopSnapshotJob(...) calls (the helper doesn't exist yet and no
// call site has been added) — expected count 1, actual count 0.
// BASELINE-GREEN items: the named function/file currently and correctly
// contains ZERO such calls — expected count 0, actual count 0, must stay 0.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const CALL_PATTERN = /enqueueShopSnapshotJob\s*\(/g;

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO, relPath), 'utf8');
}

/**
 * Extracts one named top-level function's source region: from its
 * declaration (either `export async function NAME(` or
 * `export const NAME = async`) to the next top-level `export`, or EOF.
 * Sufficient for this repo's controller/service style — one handler per
 * top-level export, no nested exports inside a handler body.
 */
function extractFunctionSource(source: string, name: string): string {
  const declPattern = new RegExp(
    `export\\s+(?:async\\s+function\\s+${name}\\s*\\(|const\\s+${name}\\s*=\\s*async)`,
  );
  const match = declPattern.exec(source);
  if (!match) {
    throw new Error(`[TEST SETUP] Could not locate function "${name}" — source may have moved.`);
  }
  const start = match.index;
  const rest = source.slice(start + match[0].length);
  const nextExport = /\n\s*export\s/.exec(rest);
  const end = nextExport ? start + match[0].length + nextExport.index : source.length;
  return source.slice(start, end);
}

function countEnqueueCalls(source: string, functionName: string): number {
  const region = extractFunctionSource(source, functionName);
  return (region.match(CALL_PATTERN) ?? []).length;
}

describe('Slice 4 — enqueueShopSnapshotJob function-scoped wiring', () => {
  describe('REQUIRED RED — outermost-transaction operations, expected exactly one call each', () => {
    const suppliersControllerPath = 'apps/backend/src/api/suppliers/suppliers.controller.ts';
    it.each([
      'httpUpdateSupplier',
      'httpDeleteSupplier',
      'httpCreatePurchaseOrder',
      'httpPatchPurchaseOrder',
      'httpUpdatePoStatus',
    ])('suppliers.controller.ts: %s contains exactly one enqueue call', (fnName) => {
      const source = readSource(suppliersControllerPath);
      expect(countEnqueueCalls(source, fnName)).toBe(1);
    });

    const reorderRequestsControllerPath = 'apps/backend/src/api/suppliers/reorderRequests.controller.ts';
    it.each([
      'httpCreateReorderRequest',
      'httpDeleteReorderRequest',
      'httpConvertReorderRequests',
    ])('reorderRequests.controller.ts: %s contains exactly one enqueue call', (fnName) => {
      const source = readSource(reorderRequestsControllerPath);
      expect(countEnqueueCalls(source, fnName)).toBe(1);
    });

    const wmsControllerPath = 'apps/backend/src/api/wms/wms.controller.ts';
    it.each([
      ['httpReleaseBatch', 'batch release handler'],
      ['httpCancelBatch', 'unclaimed batch cancel handler'],
      ['httpConfirmPickScan', 'pick confirm/scan handler'],
      ['httpResolveProblemTask', 'shared discard/write-off handler'],
    ])('wms.controller.ts: %s (%s) contains exactly one enqueue call', (fnName) => {
      const source = readSource(wmsControllerPath);
      expect(countEnqueueCalls(source, fnName)).toBe(1);
    });

    it('receiveJob.service.ts: closeReceiveJob contains exactly one enqueue call', () => {
      const source = readSource('apps/backend/src/services/wms/receiveJob.service.ts');
      expect(countEnqueueCalls(source, 'closeReceiveJob')).toBe(1);
    });

    it('demand.controller.ts: httpUpsertStockProtectionPolicy contains exactly one enqueue call', () => {
      const source = readSource('apps/backend/src/api/demand/demand.controller.ts');
      expect(countEnqueueCalls(source, 'httpUpsertStockProtectionPolicy')).toBe(1);
    });

    it('inventoryRecount.service.ts: commitRecount contains exactly one enqueue call', () => {
      const source = readSource('apps/backend/src/services/wms/inventoryRecount.service.ts');
      expect(countEnqueueCalls(source, 'commitRecount')).toBe(1);
    });

    it('stow.service.ts: confirmStow contains exactly one enqueue call (the inventory-credit branch — conditional correctness proven separately by the DB-backed stow contract test)', () => {
      const source = readSource('apps/backend/src/services/wms/stow.service.ts');
      expect(countEnqueueCalls(source, 'confirmStow')).toBe(1);
    });
  });


  describe('RETIRED RECEIVE ROUTE — handoff fence must not enqueue', () => {
    it('httpReceiveShipment refuses direct receipt instead of publishing a snapshot', () => {
      const source = readSource('apps/backend/src/api/suppliers/suppliers.controller.ts');
      const handler = extractFunctionSource(source, 'httpReceiveShipment');

      expect(handler).toContain('RECEIVE_SESSION_REQUIRED');
      expect(countEnqueueCalls(source, 'httpReceiveShipment')).toBe(0);
    });
  });

  describe('BASELINE-GREEN GUARD — nested low-level writers must NOT independently enqueue (the outer transaction owner does)', () => {
    it('receiveJob.service.ts: createReceiveJob contains zero enqueue calls', () => {
      const source = readSource('apps/backend/src/services/wms/receiveJob.service.ts');
      expect(countEnqueueCalls(source, 'createReceiveJob')).toBe(0);
    });

    it('receiveJob.service.ts: inspectReceiveJobLine contains zero enqueue calls', () => {
      const source = readSource('apps/backend/src/services/wms/receiveJob.service.ts');
      expect(countEnqueueCalls(source, 'inspectReceiveJobLine')).toBe(0);
    });

    it('pickBatch.service.ts: releaseBatch (the service function, not the controller handler) contains zero enqueue calls', () => {
      const source = readSource('apps/backend/src/services/wms/pickBatch.service.ts');
      expect(countEnqueueCalls(source, 'releaseBatch')).toBe(0);
    });

    it('batchCancellation.service.ts: cancelUnclaimedBatch (the service function) contains zero enqueue calls', () => {
      const source = readSource('apps/backend/src/services/wms/batchCancellation.service.ts');
      expect(countEnqueueCalls(source, 'cancelUnclaimedBatch')).toBe(0);
    });

    it('pickScan.service.ts: confirmPickScan (the service function) contains zero enqueue calls', () => {
      const source = readSource('apps/backend/src/services/wms/pickScan.service.ts');
      expect(countEnqueueCalls(source, 'confirmPickScan')).toBe(0);
    });

    it('stockProtectionPolicy.service.ts: upsertStockProtectionPolicy (the service function) contains zero enqueue calls', () => {
      const source = readSource('apps/backend/src/services/inventory/stockProtectionPolicy.service.ts');
      expect(countEnqueueCalls(source, 'upsertStockProtectionPolicy')).toBe(0);
    });

    it('reorderRequests.controller.ts: httpListReorderRequests (read-only) contains zero enqueue calls', () => {
      const source = readSource('apps/backend/src/api/suppliers/reorderRequests.controller.ts');
      expect(countEnqueueCalls(source, 'httpListReorderRequests')).toBe(0);
    });
  });

  describe('BASELINE-GREEN GUARD — already covered by the existing order-entity-event enqueue, must never gain a duplicate call', () => {
    it('cancellationUnwind.service.ts: unwindCancelledOrder contains zero enqueue calls (already covered via orders/cancelled)', () => {
      const source = readSource('apps/backend/src/services/wms/cancellationUnwind.service.ts');
      expect(countEnqueueCalls(source, 'unwindCancelledOrder')).toBe(0);
    });

    it('fulfillmentPhysicalRemoval.service.ts: applyFulfillmentPhysicalRemoval contains zero enqueue calls (already covered via orders/fulfilled)', () => {
      const source = readSource('apps/backend/src/services/wms/fulfillmentPhysicalRemoval.service.ts');
      expect(countEnqueueCalls(source, 'applyFulfillmentPhysicalRemoval')).toBe(0);
    });
  });
});
