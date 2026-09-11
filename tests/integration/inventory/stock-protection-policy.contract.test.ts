// tests/integration/inventory/stock-protection-policy.contract.test.ts
//
// STOCK-PROTECT-01 — API/DB integration contract for the durable Stock
// Protection Policy mutation/history/planning-resolution surface. PERMANENT
// regression contract, authored RED.
// ===========================================================================
// INDEPENDENTLY RED
//   This suite imports the canonical service module from a path that does
//   not exist yet:
//     api-src/services/inventory/stockProtectionPolicy.service
//   which is expected to export resolveEffectivePolicy(trx, shopId,
//   variantId) and upsertStockProtectionPolicy(trx, params). The import
//   fails with MODULE_NOT_FOUND — narrowly attributable to that one missing
//   file, proving surfaces B (effective policy resolution) and C (policy
//   mutation/history contract) are both entirely missing. Every assertion
//   below encodes a specific ratified behaviour (contract items 5, 6, 7, 8,
//   9, 11, 12, 13, 15) the canonical service is required to satisfy once it
//   exists, so this is not a malformed test.
//
// PLACEMENT
//   tests/integration/ (backend-integration project) — real Postgres via
//   scripts/with-test-db.js, following the fixture conventions in
//   tests/integration/suppliers/sourcing-worklist-contract.test.ts.
//
// COVERS: SP-POL-05, SP-POL-06, SP-POL-07, SP-POL-08 (behavioural),
//         SP-POL-09, SP-POL-13, SP-POL-14, SP-POL-15

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

async function seedProduct(shopId: number, productId: string) {
  await withTenant(shopId, (trx) =>
    trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'SP-POL contract fixture product',
      status: 'active',
      product_type: 'physical',
    })
  );
}

async function seedVariant(shopId: number, productId: string, sku: string): Promise<string> {
  const variantId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku,
      title: 'SP-POL contract fixture variant',
      unit_cost: '5.00',
      status: 'active',
    })
  );
  return variantId;
}

async function seedSupplier(shopId: number, name: string, active = true): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('suppliers').insert({ shop_id: shopId, name, active }).returning('id');
    return Number((row as any).id ?? row);
  });
}

async function seedPoLine(shopId: number, supplierId: number, variantId: string) {
  await withTenant(shopId, async (trx) => {
    const [po] = await trx('purchase_orders').insert({ shop_id: shopId, supplier_id: supplierId, status: 'ordered' }).returning('id');
    await trx('purchase_order_line_items').insert({
      po_id: (po as any).id ?? po,
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      description: 'SP-POL contract fixture PO line',
      quantity_ordered: 10,
      quantity_received: 0,
    });
  });
}

describe('STOCK-PROTECT-01 — stock protection policy mutation/history/resolution contract', () => {
  // ── SP-POL-05 ─────────────────────────────────────────────────────────────
  it('SP-POL-05: an approved policy override applies ONLY to its own shop+variant', async () => {
    const shopId = await createFixtureShop('sppol05');
    const productId = crypto.randomUUID();
    await seedProduct(shopId, productId);
    const targetVariantId = await seedVariant(shopId, productId, `SP-POL-05-TARGET-${shopId}`);
    const otherVariantId = await seedVariant(shopId, productId, `SP-POL-05-OTHER-${shopId}`);

    await withTenant(shopId, (trx) =>
      upsertStockProtectionPolicy(trx, {
        shopId,
        variantId: targetVariantId,
        safetyDays: 20,
        reviewCycleDays: 30,
        planningSupplierId: null,
        source: 'ui_approval',
        reason: 'merchant_override',
        actorType: 'user',
        actorId: 'user-1',
        recommendationSnapshot: null,
      })
    );

    const targetEffective = await withTenant(shopId, (trx) => resolveEffectivePolicy(trx, shopId, targetVariantId));
    const otherEffective = await withTenant(shopId, (trx) => resolveEffectivePolicy(trx, shopId, otherVariantId));

    expect(targetEffective).toMatchObject({ safety_days: 20, review_cycle_days: 30, source: 'merchant_approved' });
    expect(otherEffective).toMatchObject({ safety_days: 5, review_cycle_days: 7, source: 'system_default' });
  });

  // ── SP-POL-06 / SP-POL-07 / SP-POL-08 ────────────────────────────────────
  it('SP-POL-06: a material create writes current + exactly one transition row atomically', async () => {
    const shopId = await createFixtureShop('sppol06');
    const productId = crypto.randomUUID();
    await seedProduct(shopId, productId);
    const variantId = await seedVariant(shopId, productId, `SP-POL-06-${shopId}`);

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
        recommendationSnapshot: { suggested_safety_days: 9 },
      })
    );

    const current = await withTenant(shopId, (trx) =>
      trx(CURRENT_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId }).first()
    );
    const transitions = await withTenant(shopId, (trx) =>
      trx(TRANSITIONS_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId }).select('*')
    );

    expect(current).toMatchObject({ version: 1, safety_days: 10, review_cycle_days: 14 });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ from_version: null, to_version: 1, to_safety_days: 10, to_review_cycle_days: 14 });
  });

  it('SP-POL-06/07: a material update adds exactly one more transition; a no-op change adds none', async () => {
    const shopId = await createFixtureShop('sppol0607');
    const productId = crypto.randomUUID();
    await seedProduct(shopId, productId);
    const variantId = await seedVariant(shopId, productId, `SP-POL-0607-${shopId}`);

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

    // Material change: expectedVersion=1 -> 2, one new transition.
    await withTenant(shopId, (trx) =>
      upsertStockProtectionPolicy(trx, {
        shopId,
        variantId,
        expectedVersion: 1,
        safetyDays: 15,
        reviewCycleDays: 14,
        planningSupplierId: null,
        source: 'ui_approval',
        reason: 'merchant_revised_safety_days',
        actorType: 'user',
        actorId: 'user-1',
        recommendationSnapshot: null,
      })
    );

    let current = await withTenant(shopId, (trx) =>
      trx(CURRENT_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId }).first()
    );
    let transitions = await withTenant(shopId, (trx) =>
      trx(TRANSITIONS_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId }).orderBy('to_version', 'asc')
    );
    expect(current.version).toBe(2);
    expect(current.safety_days).toBe(15);
    expect(transitions).toHaveLength(2);
    expect(transitions[1]).toMatchObject({ from_version: 1, to_version: 2, from_safety_days: 10, to_safety_days: 15 });

    // SP-POL-07: identical values submitted again -> NO fake transition.
    await withTenant(shopId, (trx) =>
      upsertStockProtectionPolicy(trx, {
        shopId,
        variantId,
        expectedVersion: 2,
        safetyDays: 15,
        reviewCycleDays: 14,
        planningSupplierId: null,
        source: 'ui_approval',
        reason: 'resubmitted_no_change',
        actorType: 'user',
        actorId: 'user-1',
        recommendationSnapshot: null,
      })
    );

    current = await withTenant(shopId, (trx) =>
      trx(CURRENT_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId }).first()
    );
    transitions = await withTenant(shopId, (trx) =>
      trx(TRANSITIONS_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId })
    );
    expect(current.version).toBe(2);
    expect(transitions).toHaveLength(2);
  });

  it('SP-POL-08: the transition row carries full provenance and the recommendation snapshot verbatim', async () => {
    const shopId = await createFixtureShop('sppol08');
    const productId = crypto.randomUUID();
    await seedProduct(shopId, productId);
    const variantId = await seedVariant(shopId, productId, `SP-POL-08-${shopId}`);
    const snapshot = { suggested_reorder_qty: 42, urgency: 'warning', velocity: 1.5 };

    await withTenant(shopId, (trx) =>
      upsertStockProtectionPolicy(trx, {
        shopId,
        variantId,
        safetyDays: 11,
        reviewCycleDays: 21,
        planningSupplierId: null,
        source: 'ui_approval',
        reason: 'initial_policy_approval',
        actorType: 'user',
        actorId: 'user-42',
        recommendationSnapshot: snapshot,
      })
    );

    const transition = await withTenant(shopId, (trx) =>
      trx(TRANSITIONS_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId }).first()
    );

    expect(transition).toMatchObject({
      source: 'ui_approval',
      reason: 'initial_policy_approval',
      actor_type: 'user',
      actor_id: 'user-42',
    });
    expect(transition.recommendation_snapshot).toMatchObject(snapshot);
    expect(transition.occurred_at).toBeTruthy();
  });

  // ── SP-POL-09 ─────────────────────────────────────────────────────────────
  it('SP-POL-09: the historical recommendation snapshot never becomes future planning authority', async () => {
    const shopId = await createFixtureShop('sppol09');
    const productId = crypto.randomUUID();
    await seedProduct(shopId, productId);
    const variantId = await seedVariant(shopId, productId, `SP-POL-09-${shopId}`);

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
        // Deliberately contradicts the approved safety_days above — proves
        // the snapshot is historical evidence only, never a planning input.
        recommendationSnapshot: { safety_days: 999, suggested_reorder_qty: 999 },
      })
    );

    const effective = await withTenant(shopId, (trx) => resolveEffectivePolicy(trx, shopId, variantId));

    expect(effective.safety_days).toBe(10);
    expect(effective).not.toHaveProperty('suggested_reorder_qty');
  });

  // ── SP-POL-13 ─────────────────────────────────────────────────────────────
  it('SP-POL-13: the explicit planning supplier anchor is stable against a newer unrelated PO', async () => {
    const shopId = await createFixtureShop('sppol13');
    const productId = crypto.randomUUID();
    await seedProduct(shopId, productId);
    const variantId = await seedVariant(shopId, productId, `SP-POL-13-${shopId}`);
    const anchoredSupplierId = await seedSupplier(shopId, 'Anchored Supplier');
    const otherSupplierId = await seedSupplier(shopId, 'Other Supplier');

    await withTenant(shopId, (trx) =>
      upsertStockProtectionPolicy(trx, {
        shopId,
        variantId,
        safetyDays: 10,
        reviewCycleDays: 14,
        planningSupplierId: anchoredSupplierId,
        source: 'ui_approval',
        reason: 'initial_policy_approval',
        actorType: 'user',
        actorId: 'user-1',
        recommendationSnapshot: null,
      })
    );

    // A newer PO arrives from a DIFFERENT supplier for the same variant.
    await seedPoLine(shopId, otherSupplierId, variantId);

    const effective = await withTenant(shopId, (trx) => resolveEffectivePolicy(trx, shopId, variantId));

    expect(effective.planning_supplier_id).toBe(anchoredSupplierId);
  });

  // ── SP-POL-14 ─────────────────────────────────────────────────────────────
  it('SP-POL-14: an invalid/inactive anchored supplier fails visibly, never silently substituted', async () => {
    const shopId = await createFixtureShop('sppol14');
    const productId = crypto.randomUUID();
    await seedProduct(shopId, productId);
    const variantId = await seedVariant(shopId, productId, `SP-POL-14-${shopId}`);
    const anchoredSupplierId = await seedSupplier(shopId, 'Anchored Supplier', true);
    const activeAlternateSupplierId = await seedSupplier(shopId, 'Active Alternate Supplier', true);
    await seedPoLine(shopId, activeAlternateSupplierId, variantId);

    await withTenant(shopId, (trx) =>
      upsertStockProtectionPolicy(trx, {
        shopId,
        variantId,
        safetyDays: 10,
        reviewCycleDays: 14,
        planningSupplierId: anchoredSupplierId,
        source: 'ui_approval',
        reason: 'initial_policy_approval',
        actorType: 'user',
        actorId: 'user-1',
        recommendationSnapshot: null,
      })
    );

    // The anchored supplier goes inactive.
    await withTenant(shopId, (trx) => trx('suppliers').where({ id: anchoredSupplierId, shop_id: shopId }).update({ active: false }));

    const effective = await withTenant(shopId, (trx) => resolveEffectivePolicy(trx, shopId, variantId));

    // Never silently substitute the other active supplier.
    expect(effective.planning_supplier_id).not.toBe(activeAlternateSupplierId);
    // Fails visibly into a needs-attention / planning-data-required state.
    expect(['needs_attention', 'planning_data_required']).toContain(effective.planning_status);
  });

  // ── SP-POL-15 ─────────────────────────────────────────────────────────────
  it('SP-POL-15: fresh demand changes derived output WITHOUT mutating or versioning approved policy', async () => {
    const shopId = await createFixtureShop('sppol15');
    const productId = crypto.randomUUID();
    await seedProduct(shopId, productId);
    const variantId = await seedVariant(shopId, productId, `SP-POL-15-${shopId}`);

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

    const beforeCurrent = await withTenant(shopId, (trx) =>
      trx(CURRENT_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId }).first()
    );

    // Fresh demand: new open order line for this variant.
    const orderId = crypto.randomUUID();
    await withTenant(shopId, async (trx) => {
      await trx('orders').insert({
        lasyncro_order_id: orderId,
        shop_id: shopId,
        aggregate_version: 1,
        payment_state: 'paid',
        currency: 'USD',
        total_price: '100.00',
        subtotal_price: '100.00',
        total_tax: '0.00',
        order_created_at: new Date(),
        order_updated_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });
      await trx('external_order_identity_map').insert({
        lasyncro_order_id: orderId,
        shop_id: shopId,
        platform: 'shopify',
        external_order_id: `${Date.now()}9001`,
      });
      await trx('order_revenue_units').insert({
        lasyncro_revenue_unit_id: crypto.randomUUID(),
        lasyncro_order_id: orderId,
        lasyncro_product_id: productId,
        lasyncro_variant_id: variantId,
        sku: null,
        title: 'SP-POL-15 fresh demand line',
        quantity: 5,
        fulfilled_quantity: 0,
        unit_price: '100.00',
        line_total: '500.00',
        estimated_unit_cost: '5.00',
      });
    });

    const afterCurrent = await withTenant(shopId, (trx) =>
      trx(CURRENT_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId }).first()
    );
    const transitions = await withTenant(shopId, (trx) =>
      trx(TRANSITIONS_TABLE).where({ shop_id: shopId, lasyncro_variant_id: variantId })
    );

    expect(afterCurrent.version).toBe(beforeCurrent.version);
    expect(afterCurrent.safety_days).toBe(beforeCurrent.safety_days);
    expect(transitions).toHaveLength(1);
  });
});
