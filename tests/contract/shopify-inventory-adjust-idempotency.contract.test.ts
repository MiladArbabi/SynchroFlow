import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Shopify inventory adjustment idempotency contract', () => {
  const service = readFileSync(
    resolve(
      process.cwd(),
      'apps/backend/src/services/wms/shopifyInventorySync.service.ts'
    ),
    'utf8'
  );

  const controller = readFileSync(
    resolve(
      process.cwd(),
      'apps/backend/src/api/wms/wms.controller.ts'
    ),
    'utf8'
  );

  it('uses Shopify native idempotency for inventoryAdjustQuantities', () => {
    expect(service).toMatch(/\$idempotencyKey:\s*String!/);
    expect(service).toMatch(
      /inventoryAdjustQuantities\(input:\s*\$input\)\s*@idempotent\(key:\s*\$idempotencyKey\)/
    );
    expect(service).toMatch(
      /variables:\s*\{\s*idempotencyKey,\s*input:/
    );
  });

  it('explicitly opts out of quantity CAS for additive Stow deltas', () => {
    expect(service).toMatch(
      /delta:\s*quantityDelta,\s*changeFromQuantity:\s*null/
    );
  });

  it('requires an explicit deterministic idempotency key', () => {
    expect(service).toContain('idempotencyKey: string;');
    expect(service).toContain(
      "[SHOPIFY_INV_SYNC] idempotencyKey is required"
    );
  });

  it('keys each committed Stow placement from task identity and cumulative quantity', () => {
    expect(controller).toContain(
      '`lasyncro:stow:${shopId}:${taskId}:${confirmResult.quantityPlaced}`'
    );
    expect(controller).toContain(
      'idempotencyKey: stowShopifyIdempotencyKey'
    );
    expect(controller).toContain(
      'quantityDelta: confirmResult.placedNow'
    );
  });
});
