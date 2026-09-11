// tests/integration/inventory/stock-protection-policy-concurrency.test.ts
//
// STOCK-PROTECT-01 — CONCURRENCY contract for optimistic-concurrency control
// on the Stock Protection Policy mutation path. PERMANENT regression
// contract, authored RED.
// ===========================================================================
// INDEPENDENTLY RED
//   Imports the same canonical service module as
//   stock-protection-policy.contract.test.ts:
//     api-src/services/inventory/stockProtectionPolicy.service
//   which does not exist yet. MODULE_NOT_FOUND is narrowly attributable to
//   that one missing file and proves surface D (concurrency guard) is
//   entirely absent — there is no expected_version enforcement to exercise.
//
// REQUIRED BEHAVIOUR (contract item 14)
//   Two writers both read version 1. Writer A submits expected_version=1 and
//   succeeds, moving version 1 -> 2 with exactly one new transition. Writer
//   B then submits its own change with the SAME stale expected_version=1 and
//   is rejected as a conflict — writing NO transition, leaving current
//   version at 2. No lost update. No duplicate history. No partial
//   current/history write.
//
// REAL POSTGRES — via scripts/with-test-db.js / npm run test:integration.
//
// COVERS: SP-POL-16

import crypto from 'crypto';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  resolveEffectivePolicy,
  upsertStockProtectionPolicy,
} from 'api-src/services/inventory/stockProtectionPolicy.service';

const CURRENT_TABLE = 'stock_protection_policies';
const TRANSITIONS_TABLE = 'stock_protection_policy_transitions';

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedVariant(shopId: number): Promise<string> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'SP-POL concurrency fixture product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `SP-POL-CONC-${variantId.slice(0, 8)}`,
      title: 'SP-POL concurrency fixture variant',
      unit_cost: '5.00',
      status: 'active',
    });
  });
  return variantId;
}

describe('STOCK-PROTECT-01 — optimistic-concurrency guard (SP-POL-16)', () => {
  it('expected_version is mandatory for modifying an existing policy', async () => {
    const shopId = await createFixtureShop('sppol16-mandatory');
    const variantId = await seedVariant(shopId);

    await withTenant(shopId, (trx) =>
      upsertStockProtectionPolicy(trx, {
        shopId,
        variantId,
        safetyDays: 10,
        reviewCycleDays: 14,
        planningSupplierId: null,
        source: 'ui_approval',
        reason: 'initial_policy_approval',
        actorType: 'user',
        actorId: 'user-1',
        recommendationSnapshot: null,
      })
    );

    // Modifying an EXISTING policy without expected_version must be rejected.
    await expect(
      withTenant(shopId, (trx) =>
        upsertStockProtectionPolicy(trx, {
          shopId,
          variantId,
          // expectedVersion intentionally omitted
          safetyDays: 20,
          reviewCycleDays: 14,
          planningSupplierId: null,
          source: 'ui_approval',
          reason: 'missing_expected_version',
          actorType: 'user',
          actorId: 'user-1',
          recommendationSnapshot: null,
        } as any)
      )
    ).rejects.toBeDefined();
  });

  it('two concurrent writers reading version 1: the first succeeds, the stale second is rejected with no lost update and no duplicate history', async () => {
    const shopId = await createFixtureShop('sppol16-concurrent');
    const variantId = await seedVariant(shopId);

    // Both writers "read" version 1 by establishing the initial approved policy.
    await withTenant(shopId, (trx) =>
      upsertStockProtectionPolicy(trx, {
        shopId,
        variantId,
        safetyDays: 10,
        reviewCycleDays: 14,
        planningSupplierId: null,
        source: 'ui_approval',
        reason: 'initial_policy_approval',
        actorType: 'user',
        actorId: 'user-1',
        recommendationSnapshot: null,
      })
    );

    const writerA = withTenant(shopId, (trx) =>
      upsertStockProtectionPolicy(trx, {
        shopId,
        variantId,
        expectedVersion: 1,
        safetyDays: 25,
        reviewCycleDays: 14,
        planningSupplierId: null,
        source: 'ui_approval',
        reason: 'writer_a_update',
        actorType: 'user',
        actorId: 'user-a',
        recommendationSnapshot: null,
      })
    );

    const writerB = withTenant(shopId, (trx) =>
      upsertStockProtectionPolicy(trx, {
        shopId,
        variantId,
        expectedVersion: 1,
        safetyDays: 30,
        reviewCycleDays: 14,
        planningSupplierId: null,
        source: 'ui_approval',
        reason: 'writer_b_update',
        actorType: 'user',
        actorId: 'user-b',
        recommendationSnapshot: null,
      })
    );

    const results = await Promise.allSettled([writerA, writerB]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const current = await withTenant(shopId, (trx) =>
      trx(CURRENT_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId }).first()
    );
    const transitions = await withTenant(shopId, (trx) =>
      trx(TRANSITIONS_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId }).orderBy('to_version', 'asc')
    );

    // No lost update: resulting version is exactly 2, never a third writer's ghost value.
    expect(current.version).toBe(2);
    expect([25, 30]).toContain(current.safety_days);

    // No duplicate history: exactly 2 transitions total (create + the one winner), never 3.
    expect(transitions).toHaveLength(2);
    expect(transitions[1].to_version).toBe(2);

    // No partial write: resolveEffectivePolicy reflects the same winning state as `current`.
    const effective = await withTenant(shopId, (trx) => resolveEffectivePolicy(trx, shopId, variantId));
    expect(effective.safety_days).toBe(current.safety_days);
    expect(effective.version).toBe(2);
  });
});
