/**
 * OPS-CONSOLE-HISTORY-01 — HISTORY V1 REGRESSION CONTRACT.
 *
 * RATIFIED CONTRACT:
 *   HISTORY means the EXACT eligible operational episode became canonically
 *   verified resolved: order_constraints.resolved_at is set AND
 *   interventionOutcome.service.ts's canonical deriveOutcome() derives
 *   outcome.status === 'verified_resolved' for the winning intervention
 *   against that episode.
 *
 *   V1 eligible treatments (same allowlist/pairing as WAITING V1):
 *     address_correction        <-> customer/incomplete_address
 *     inventory_reorder_intent  <-> inventory/oversell
 *
 *   Explicitly excluded: pending_verification, unknown, resolved alerts,
 *   decisions.status alone, execution success alone, Returns outcomes.
 *
 *   One merchant-facing HISTORY item per resolved constraint episode, not
 *   per intervention attempt (readCurrentHistoryV1Records() collapses to the
 *   winning — latest occurredAt, greatest interventionId tie-break —
 *   intervention). 30-day retention. Ordered by canonical
 *   constraintResolvedAt DESC, interventionId DESC tie-break.
 *
 * ENDPOINT — GET /api/v1/operations/history -> { items: HistoryItem[] }.
 * Response ONLY ever contains outcome='verified_resolved' items.
 *
 * COPY IS NOT RATIFIED. HISTORY-ORDER-ENTITY-01 — routing is
 * { kind: 'order_entity', lasyncroOrderId } for EVERY V1 treatment, never a
 * route string, and never /alerts: HISTORY opens the canonical Order Entity
 * Modal, not a page. routing.kind and routing.lasyncroOrderId ARE ratified.
 *
 * HARNESS — fixture helpers duplicated verbatim from
 * tests/integration/decisions/ops-console-waiting-v1-contract.test.ts, per
 * that file's own established convention of file-local fixture functions
 * (no shared fixture builder module exists for this seam). Constraints and
 * interventions are materialised through the REAL evaluator +
 * projectOrderConstraints path and the REAL authenticated routes (PATCH
 * shipping-address, POST reorder-requests) — never hand-written — with one
 * narrow, explicitly-labelled exception (HISTORY-08's occurredAt-tie
 * sentinel pair), mirroring WAITING-10/24's own established sentinel-row
 * precedent for states the real lifecycle cannot conveniently reproduce on
 * demand.
 *
 * Disposable synchroflow_test_* DB only (`npm run test:integration`).
 */
import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import { evaluateInventoryConstraint } from 'api-src/services/constraints/evaluators/inventoryConstraintEvaluator';
import { evaluateCustomerConstraint } from 'api-src/services/constraints/evaluators/customerConstraintEvaluator';
import { projectOrderConstraints } from 'api-src/projections/orderConstraintProjection';
import { revalidateOrdersForReceivedVariants } from 'api-src/services/wms/receiveJob.service';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const PICK_BIN = 'A-1';

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

const HISTORY_ENDPOINT = '/api/v1/operations/history';
const getHistory = (token: string) =>
  request(app).get(HISTORY_ENDPOINT).set('Authorization', `Bearer ${token}`);

const patchAddress = (token: string, orderId: string, body: Record<string, unknown>) =>
  request(app)
    .patch(`/api/v1/orders/${orderId}/shipping-address`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const postReorder = (token: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/v1/suppliers/reorder-requests')
    .set('Authorization', `Bearer ${token}`)
    .send(body);

/** Structural-only copy check — presentation copy is explicitly NOT ratified. */
const NON_EMPTY_STRING = expect.stringMatching(/\S/);

// ── canonical fixtures (duplicated from ops-console-waiting-v1-contract.test.ts) ──

async function provisionTenant(
  label: string
): Promise<{ shopId: number; userId: number; token: string }> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `history-v1-${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `history-v1+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');
    return Number(row.id ?? row);
  });

  const rootCode = `WH-${shopId}-ROOT`;
  const warehouseId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: userId, role: 'owner' });
    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'growth',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'History V1 warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: PICK_BIN,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);
  });

  return { shopId, userId, token: issueTestToken({ userId, shopId, tier: 'growth' }) };
}

type Catalogue = { productId: string; variantId: string };

async function seedCatalogue(shopId: number): Promise<Catalogue> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const unique = crypto.randomBytes(4).toString('hex');

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'History V1 product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `HIST-V1-${unique}`,
      title: 'History V1 variant',
      unit_cost: '5.00',
      status: 'active',
    });
  });

  return { productId, variantId };
}

async function seedOrder(
  shopId: number,
  catalogue: Catalogue,
  quantity: number,
  opts: { completeAddress?: boolean } = {}
): Promise<{ orderId: string; externalOrderId: string }> {
  const orderId = crypto.randomUUID();
  const complete = opts.completeAddress ?? true;
  const stamp = new Date();
  const externalOrderId =
    String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

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
      shipping_name: 'Jane Doe',
      shipping_address1: complete ? '221B Baker Street' : null,
      shipping_city: complete ? 'London' : null,
      shipping_zip: complete ? 'NW1 6XE' : null,
      shipping_country_code: complete ? 'GB' : null,
      order_created_at: stamp,
      order_updated_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    });

    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    });

    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: catalogue.productId,
      lasyncro_variant_id: catalogue.variantId,
      sku: null,
      title: 'History V1 line',
      quantity,
      fulfilled_quantity: 0,
      unit_price: '100.00',
      line_total: (100 * quantity).toFixed(2),
      estimated_unit_cost: '5.00',
    });

    await trx('order_line_items').insert({
      lasyncro_line_item_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: catalogue.productId,
      lasyncro_variant_id: catalogue.variantId,
      sku: null,
      title: 'History V1 line',
      quantity,
      unit_price: '100.00',
      line_total: (100 * quantity).toFixed(2),
      created_at: stamp,
      updated_at: stamp,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    });
  });

  return { orderId, externalOrderId };
}

async function setStock(shopId: number, variantId: string, location: string, available: number) {
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    const existing = await trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: location })
      .first('lasyncro_variant_id');

    if (existing) {
      await trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: location })
        .update({
          on_hand_quantity: available,
          available_quantity: available,
          last_evaluated_at: new Date(),
        });
      return;
    }

    await trx('inventory_truth').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      location_code: location,
      on_hand_quantity: available,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: available,
      last_evaluated_at: new Date(),
    });
  });
}

async function materialiseInventoryConstraint(shopId: number, orderId: string, anchor: Date) {
  await withTenant(shopId, async (trx) => {
    const evaluations = await evaluateInventoryConstraint(trx, orderId, shopId);
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await projectOrderConstraints(trx, orderId, shopId, 1, anchor, evaluations);
  });
}

async function materialiseCustomerConstraint(shopId: number, orderId: string, anchor: Date) {
  await withTenant(shopId, async (trx) => {
    const evaluation = await evaluateCustomerConstraint(trx, orderId, shopId);
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await projectOrderConstraints(trx, orderId, shopId, 1, anchor, [evaluation]);
  });
}

async function canonicalRevalidate(shopId: number, variantId: string) {
  await withTenant(shopId, (trx) => revalidateOrdersForReceivedVariants(trx, shopId, [variantId]));
}

async function constraintsFor(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('order_constraints')
      .where({ lasyncro_order_id: orderId })
      .select(
        'constraint_id',
        'constraint_type',
        'block_type',
        'target_id',
        'is_active',
        'started_at',
        'resolved_at'
      )
  );
}

async function activeInventoryConstraint(shopId: number, orderId: string, variantId: string) {
  const rows = await constraintsFor(shopId, orderId);
  const match = rows.filter(
    (c) =>
      c.is_active &&
      c.constraint_type === 'inventory' &&
      c.block_type === 'oversell' &&
      c.target_id === variantId
  );
  expect(match).toHaveLength(1);
  return match[0];
}

async function activeCustomerConstraint(shopId: number, orderId: string) {
  const rows = await constraintsFor(shopId, orderId);
  const match = rows.filter(
    (c) => c.is_active && c.constraint_type === 'customer' && c.block_type === 'incomplete_address'
  );
  expect(match).toHaveLength(1);
  return match[0];
}

async function seedSupplier(shopId: number, name: string): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('suppliers').insert({ shop_id: shopId, name, active: true }).returning('id');
    return Number(row.id ?? row);
  });
}

// ── HISTORY-01 — address_correction verified_resolved item ─────────────────

describe('HISTORY-01 — address_correction: real intervention + canonical resolution => verified_resolved HISTORY item', () => {
  it('appears in the shop-wide HISTORY read with a backend-presentation-ready shape and the locked /overview?resolution=address route', async () => {
    const { shopId, token } = await provisionTenant('addr-one');
    const catalogue = await seedCatalogue(shopId);
    const { orderId, externalOrderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopId, orderId);

    const patch = await patchAddress(token, orderId, {
      address1: '221B Baker Street',
      city: 'London',
      zip: 'NW1 6XE',
      countryCode: 'GB',
      correctionSource: 'manual',
    });
    expect(patch.status).toBe(200);

    // RED-first: before canonical resolution is projected, HISTORY must NOT
    // contain this episode yet — proves the endpoint does not fabricate
    // resolution from the intervention alone.
    const beforeRes = await getHistory(token);
    expect(beforeRes.status).toBe(200);
    expect((beforeRes.body.items ?? []).find((r: any) => r.constraintId === constraint.constraint_id))
      .toBeUndefined();

    // Real re-evaluation against the now-complete order row resolves the constraint.
    await materialiseCustomerConstraint(shopId, orderId, new Date(Date.now() + 1000));
    const resolved = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === constraint.constraint_id
    )!;
    expect(resolved.is_active).toBe(false);
    expect(resolved.resolved_at).toBeTruthy();

    const res = await getHistory(token);
    expect(res.status).toBe(200);
    const item = (res.body.items ?? []).find((r: any) => r.constraintId === constraint.constraint_id);
    expect(item).toEqual(
      expect.objectContaining({
        interventionId: expect.any(String),
        treatment: 'address_correction',
        lasyncroOrderId: orderId,
        externalOrderId,
        constraintId: constraint.constraint_id,
        constraintType: 'customer',
        blockType: 'incomplete_address',
        occurredAt: expect.any(String),
        resolvedAt: new Date(resolved.resolved_at as unknown as string).toISOString(),
        outcome: 'verified_resolved',
        presentation: expect.objectContaining({
          title: NON_EMPTY_STRING,
          subtitle: NON_EMPTY_STRING,
          actionLabel: NON_EMPTY_STRING,
        }),
        // [1] address HISTORY returns order_entity + exact lasyncroOrderId.
        routing: { kind: 'order_entity', lasyncroOrderId: orderId },
      })
    );
    // [3] no generic address route survives on this item.
    expect(item.routing).not.toHaveProperty('route');
  }, 180_000);
});

// ── HISTORY-02 — inventory_reorder_intent verified_resolved item ───────────

describe('HISTORY-02 — inventory_reorder_intent: real intervention + canonical resolution => verified_resolved HISTORY item', () => {
  it('appears in the shop-wide HISTORY read with routing.kind="order_entity" and the exact lasyncroOrderId, and routing never points at /alerts', async () => {
    const { shopId, token } = await provisionTenant('inv-one');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'History V1 Mills Ltd');
    const { orderId, externalOrderId } = await seedOrder(shopId, catalogue, 10);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const constraint = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const reorder = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 10,
      source: 'alert',
      originating_order_id: orderId,
    });
    expect(reorder.status).toBe(201);

    // Real re-evaluation: stock arrives, canonical resolution follows.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 10);
    await canonicalRevalidate(shopId, catalogue.variantId);
    const resolved = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === constraint.constraint_id
    )!;
    expect(resolved.is_active).toBe(false);
    expect(resolved.resolved_at).toBeTruthy();

    const res = await getHistory(token);
    expect(res.status).toBe(200);
    const item = (res.body.items ?? []).find((r: any) => r.constraintId === constraint.constraint_id);
    expect(item).toEqual(
      expect.objectContaining({
        treatment: 'inventory_reorder_intent',
        lasyncroOrderId: orderId,
        externalOrderId,
        constraintId: constraint.constraint_id,
        constraintType: 'inventory',
        blockType: 'oversell',
        outcome: 'verified_resolved',
        // [2] inventory HISTORY returns order_entity + exact lasyncroOrderId.
        routing: { kind: 'order_entity', lasyncroOrderId: orderId },
      })
    );
    // [3] no generic inventory route survives on this item, and there is no
    // `route` field of any kind to point at /alerts.
    expect(item.routing).not.toHaveProperty('route');
    expect(JSON.stringify(item.routing)).not.toMatch(/\/alerts/);
  }, 180_000);
});

// ── HISTORY-03 — still-pending episode excluded ─────────────────────────────

describe('HISTORY-03 — a pending_verification episode is absent from HISTORY', () => {
  it('address_correction: no HISTORY item exists while the constraint remains active', async () => {
    const { shopId, token } = await provisionTenant('addr-pending');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopId, orderId);

    const patch = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
    });
    expect(patch.status).toBe(200);

    // Canonical resolution never projected — still pending_verification.
    const stillActive = await activeCustomerConstraint(shopId, orderId);
    expect(stillActive.constraint_id).toBe(constraint.constraint_id);

    const res = await getHistory(token);
    expect(res.status).toBe(200);
    expect((res.body.items ?? []).find((r: any) => r.constraintId === constraint.constraint_id))
      .toBeUndefined();
  }, 180_000);
});

// ── HISTORY-04 — re-raised episode mismatch excluded ────────────────────────

describe('HISTORY-04 — a re-raised episode never lets the OLD intervention claim a resolved HISTORY item for the wrong episode', () => {
  it('the stale intervention is absent from HISTORY even though the reused constraint row now carries a DIFFERENT active (unresolved) episode', async () => {
    const { shopId, token } = await provisionTenant('inv-reraise');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'History V1 Mills Ltd');
    const { orderId } = await seedOrder(shopId, catalogue, 10);

    // Episode A: intervened, then resolved.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const episodeA = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const reorder = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 10,
      source: 'alert',
      originating_order_id: orderId,
    });
    expect(reorder.status).toBe(201);

    await setStock(shopId, catalogue.variantId, PICK_BIN, 10);
    await canonicalRevalidate(shopId, catalogue.variantId);
    const resolvedA = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === episodeA.constraint_id
    )!;
    expect(resolvedA.is_active).toBe(false);

    // Sanity: episode A's own resolution IS eligible HISTORY before re-raise.
    const beforeReraise = await getHistory(token);
    expect((beforeReraise.body.items ?? []).map((r: any) => r.constraintId)).toContain(
      episodeA.constraint_id
    );

    // Episode B: the SAME deterministic constraint row is re-raised and left
    // ACTIVE — the episode-anchor hazard.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date(Date.now() + 1000));
    const episodeB = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);
    expect(episodeB.constraint_id).toBe(episodeA.constraint_id);
    expect(episodeB.is_active).toBe(true);

    // The row is now active again (unresolved) — canonical resolved_at is
    // stale/absent for the CURRENT episode, so it must not appear as HISTORY.
    const res = await getHistory(token);
    expect(res.status).toBe(200);
    expect((res.body.items ?? []).find((r: any) => r.constraintId === episodeB.constraint_id))
      .toBeUndefined();
  }, 180_000);
});

// ── HISTORY-05 — invalid pairing excluded ───────────────────────────────────

describe('HISTORY-05 — sentinel treatment_key=address_correction against a resolved inventory/oversell constraint is an invalid V1 pairing', () => {
  it('is absent from HISTORY even though the underlying constraint canonically resolved', async () => {
    const { shopId, token } = await provisionTenant('addr-invalid-pair');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 10);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const constraint = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    // Sentinel row — the only invalid dimension is the pairing (mirrors
    // WAITING-26's own established precedent for a state the real lifecycle
    // cannot organically produce).
    await withTenant(shopId, (trx) =>
      trx('decision_interventions').insert({
        id: crypto.randomUUID(),
        shop_id: shopId,
        entity_type: 'order',
        entity_id: orderId,
        constraint_id: constraint.constraint_id,
        decision_id: null,
        treatment_key: 'address_correction',
        action_key: 'update_shipping_address',
        actor_type: 'user',
        source_surface: 'test:history-v1-invalid-pair-sentinel',
        occurred_at: new Date(),
        metadata: JSON.stringify({ correction_source: 'manual' }),
      })
    );

    // Resolve the real episode.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 10);
    await canonicalRevalidate(shopId, catalogue.variantId);
    const resolved = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === constraint.constraint_id
    )!;
    expect(resolved.is_active).toBe(false);

    const res = await getHistory(token);
    expect(res.status).toBe(200);
    expect((res.body.items ?? []).find((r: any) => r.constraintId === constraint.constraint_id))
      .toBeUndefined();
  }, 180_000);
});

// ── HISTORY-06 — collapse + latest-provenance ───────────────────────────────

describe('HISTORY-06 — repeated interventions against the SAME episode collapse to exactly one HISTORY row, keyed to the latest', () => {
  it('address_correction: two corrections before resolution produce one HISTORY item whose interventionId is the LATER one', async () => {
    const { shopId, token } = await provisionTenant('addr-repeat');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopId, orderId);

    const first = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
      correctionSource: 'manual',
    });
    expect(first.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
      correctionSource: 'manual',
    });
    expect(second.status).toBe(200);

    const interventions = await withTenant(shopId, (trx) =>
      trx('decision_interventions')
        .where({ shop_id: shopId, entity_id: orderId, constraint_id: constraint.constraint_id })
        .orderBy('occurred_at', 'asc')
    );
    expect(interventions).toHaveLength(2);
    const latest = interventions[1];
    expect(new Date(latest.occurred_at).getTime()).toBeGreaterThan(
      new Date(interventions[0].occurred_at).getTime()
    );

    await materialiseCustomerConstraint(shopId, orderId, new Date(Date.now() + 5000));
    const resolved = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === constraint.constraint_id
    )!;
    expect(resolved.is_active).toBe(false);

    const res = await getHistory(token);
    expect(res.status).toBe(200);
    const matches = (res.body.items ?? []).filter((r: any) => r.constraintId === constraint.constraint_id);
    expect(matches).toHaveLength(1);
    expect(matches[0].interventionId).toBe(latest.id);
  }, 180_000);
});

// ── HISTORY-07 — occurredAt tie -> greatest interventionId wins ────────────

describe('HISTORY-07 — an occurredAt tie between two interventions against the same resolved episode is broken by the greater interventionId', () => {
  it('picks the intervention with the lexicographically greater id as the HISTORY winner', async () => {
    const { shopId, token } = await provisionTenant('addr-tie');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopId, orderId);

    // Real correction first, so the episode legitimately resolves.
    const patch = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
      correctionSource: 'manual',
    });
    expect(patch.status).toBe(200);

    await materialiseCustomerConstraint(shopId, orderId, new Date(Date.now() + 1000));
    const resolved = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === constraint.constraint_id
    )!;
    expect(resolved.is_active).toBe(false);
    expect(resolved.resolved_at).toBeTruthy();

    const real = await withTenant(shopId, (trx) =>
      trx('decision_interventions')
        .where({ shop_id: shopId, entity_id: orderId, constraint_id: constraint.constraint_id })
        .first()
    );

    // Sentinel row sharing the EXACT SAME occurred_at as the real
    // intervention — an occurredAt tie cannot be reproduced through the real
    // lifecycle (DB-assigned timestamps differ per call), so this mirrors
    // WAITING-10/HISTORY-05's own established sentinel precedent for a
    // deterministic-tie-break probe. Ids are deliberately chosen so the
    // sentinel is the lexicographically GREATER of the two.
    const tiedOccurredAt = new Date(real.occurred_at);
    const winnerId = real.id < 'ffffffff-ffff-ffff-ffff-ffffffffffff'
      ? 'ffffffff-ffff-ffff-ffff-ffffffffffff'
      : '00000000-0000-0000-0000-000000000000';
    expect(winnerId > real.id).toBe(true);

    await withTenant(shopId, (trx) =>
      trx('decision_interventions').insert({
        id: winnerId,
        shop_id: shopId,
        entity_type: 'order',
        entity_id: orderId,
        constraint_id: constraint.constraint_id,
        decision_id: null,
        treatment_key: 'address_correction',
        action_key: 'update_shipping_address',
        actor_type: 'user',
        source_surface: 'test:history-v1-occurred-at-tie-sentinel',
        occurred_at: tiedOccurredAt,
        metadata: JSON.stringify({ correction_source: 'manual' }),
      })
    );

    const res = await getHistory(token);
    expect(res.status).toBe(200);
    const matches = (res.body.items ?? []).filter((r: any) => r.constraintId === constraint.constraint_id);
    expect(matches).toHaveLength(1);
    expect(matches[0].interventionId).toBe(winnerId);
  }, 180_000);
});

// ── HISTORY-08 — 30-day retention ───────────────────────────────────────────

describe('HISTORY-08 — a verified_resolved episode older than the 30-day retention window is excluded', () => {
  it('address_correction: a resolution timestamped 31 days ago is absent from HISTORY', async () => {
    const { shopId, token } = await provisionTenant('addr-stale');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });

    const anchor = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await materialiseCustomerConstraint(shopId, orderId, anchor);
    const constraint = await activeCustomerConstraint(shopId, orderId);

    const patch = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
      correctionSource: 'manual',
    });
    expect(patch.status).toBe(200);

    // Resolve at the same stale anchor time (order row's own history, not
    // "now") so resolved_at genuinely falls outside the 30-day window.
    await materialiseCustomerConstraint(shopId, orderId, new Date(anchor.getTime() + 1000));
    const resolved = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === constraint.constraint_id
    )!;
    expect(resolved.is_active).toBe(false);
    expect(new Date(resolved.resolved_at as unknown as string).getTime()).toBeLessThan(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    );

    const res = await getHistory(token);
    expect(res.status).toBe(200);
    expect((res.body.items ?? []).find((r: any) => r.constraintId === constraint.constraint_id))
      .toBeUndefined();
  }, 180_000);
});

// ── HISTORY-09 — ordering newest resolvedAt first ───────────────────────────

describe('HISTORY-09 — HISTORY is ordered by canonical constraintResolvedAt DESC (newest first)', () => {
  it('two independently resolved episodes on the same shop appear newest-first', async () => {
    const { shopId, token } = await provisionTenant('addr-order');
    const catalogue = await seedCatalogue(shopId);
    const { orderId: orderA } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    const { orderId: orderB } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });

    await materialiseCustomerConstraint(shopId, orderA, new Date());
    const constraintA = await activeCustomerConstraint(shopId, orderA);
    const patchA = await patchAddress(token, orderA, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
    });
    expect(patchA.status).toBe(200);
    await materialiseCustomerConstraint(shopId, orderA, new Date(Date.now() + 1000));

    await new Promise((resolve) => setTimeout(resolve, 20));

    await materialiseCustomerConstraint(shopId, orderB, new Date());
    const constraintB = await activeCustomerConstraint(shopId, orderB);
    const patchB = await patchAddress(token, orderB, {
      address1: '10 Downing Street', city: 'London', zip: 'SW1A 2AA', countryCode: 'GB',
    });
    expect(patchB.status).toBe(200);
    await materialiseCustomerConstraint(shopId, orderB, new Date(Date.now() + 2000));

    const res = await getHistory(token);
    expect(res.status).toBe(200);
    const ids = (res.body.items ?? [])
      .map((r: any) => r.constraintId)
      .filter((id: string) => id === constraintA.constraint_id || id === constraintB.constraint_id);
    // B resolved strictly after A — newest first means B precedes A.
    expect(ids).toEqual([constraintB.constraint_id, constraintA.constraint_id]);
  }, 180_000);
});

// ── HISTORY-10 — cross-shop / tenant isolation ─────────────────────────────

describe('HISTORY-10 — cross-shop / tenant isolation', () => {
  it('shop B never sees shop A verified_resolved intervention through the shop-wide HISTORY read', async () => {
    const shopA = await provisionTenant('tenant-a');
    const shopB = await provisionTenant('tenant-b');

    const catalogue = await seedCatalogue(shopA.shopId);
    const { orderId } = await seedOrder(shopA.shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopA.shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopA.shopId, orderId);

    const patch = await patchAddress(shopA.token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
    });
    expect(patch.status).toBe(200);
    await materialiseCustomerConstraint(shopA.shopId, orderId, new Date(Date.now() + 1000));

    const resA = await getHistory(shopA.token);
    expect(resA.status).toBe(200);
    expect((resA.body.items ?? []).map((r: any) => r.constraintId)).toContain(constraint.constraint_id);

    const resB = await getHistory(shopB.token);
    expect(resB.status).toBe(200);
    expect((resB.body.items ?? []).map((r: any) => r.constraintId)).not.toContain(
      constraint.constraint_id
    );
    expect(resB.body.items ?? []).toEqual([]);
  }, 180_000);
});
