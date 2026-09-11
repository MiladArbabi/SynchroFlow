/**
 * OPS-RESOLVE-API-01 — ADDRESS RESOLUTION SESSION SOURCE.
 *
 * Product invariant under protection:
 *   The Guided Resolution Session (Address pilot) must be able to enumerate
 *   EVERY order in the current tenant carrying an active
 *   customer / incomplete_address constraint — and that membership must NOT
 *   depend on which constraint would win the Order Flow election.
 *
 * WHY /orders/constrained CANNOT BE THE SOURCE (the defect this protects):
 *   orders.constrained.controller.ts builds its rows from
 *     DISTINCT ON (lasyncro_order_id) ... ORDER BY
 *       CASE constraint_type WHEN 'operational' THEN 0
 *                            WHEN 'customer'    THEN 1
 *                            WHEN 'inventory'   THEN 2 END
 *   aliased `.as('oc')`, then applies `?constraint_type=` against that
 *   POST-election alias (`query.where('oc.constraint_type', constraintType)`).
 *   An order holding BOTH an active operational constraint and an active
 *   customer/incomplete_address constraint is therefore elected 'operational'
 *   and vanishes from ?constraint_type=customer — while still genuinely needing
 *   an address correction. Case A below is exactly that order.
 *
 *   That election is load-bearing for Flow's mutually exclusive blocked
 *   buckets, so this suite neither touches nor asserts against
 *   /orders/constrained. It asserts a separate, unelected read.
 *
 * Intended smallest route (NOT YET IMPLEMENTED — this suite is RED by design):
 *   GET /api/v1/orders/address-resolution
 *
 * FIXTURE MATRIX — one tenant unless stated, one compact assertion:
 *   A   active operational (returned_undelivered) + active customer/
 *       incomplete_address on the SAME order              -> INCLUDED
 *   A2  active customer/incomplete_address only           -> INCLUDED
 *   B   active customer constraint, non-address block_type -> EXCLUDED
 *   C   customer/incomplete_address that has been resolved -> EXCLUDED
 *   D   active customer/incomplete_address, ANOTHER tenant -> EXCLUDED
 *
 * Fixture provenance, kept canonical wherever production code allows it:
 *   - tenant bootstrap via createTenantShop + setTenantContext (RLS-safe),
 *     mirroring tests/integration/returns/returned-undelivered-contract.test.ts;
 *   - customer/incomplete_address is derived by the REAL evaluator chain
 *     (evaluateOrderConstraints -> projectOrderConstraints) from missing
 *     orders.shipping_address* fields — never hand-written;
 *   - case C is resolved by re-running that same real chain after the address is
 *     completed, not by hand-flipping is_active;
 *   - the active operational constraint in case A is produced by the real
 *     createUndeliveredReturnJob service, the only live writer of
 *     operational/returned_undelivered, with a real undelivered_reason_type
 *     enum value ('wrong_address', migration 0008).
 *
 *   Case B is the ONE deliberate exception. customerConstraintEvaluator.ts can
 *   only ever emit blockType 'incomplete_address' (it returns
 *   `isIncompleteAddress ? 'incomplete_address' : null`), so a customer row with
 *   any other block_type is not reachable through any evaluator today. It is
 *   inserted directly, under the same transaction-local projection guard the
 *   production writer uses, purely to pin the block_type FILTER: block_type is a
 *   text column and the evaluator documents future additions (carrier
 *   validation, customer confirmation), so the filter must be proven now rather
 *   than inferred from today's coincidence.
 *
 * order_constraints is projection-single-writer guarded
 * (enforce_projection_writer_order_constraints, migration 0076) and
 * projectOrderConstraints does NOT set that guard itself — the caller must,
 * exactly as materialiseInventoryConstraint does in
 * tests/integration/orders/inventory-decision-contract.test.ts. Every guard here
 * is transaction-local; nothing becomes a production bypass.
 *
 * Disposable synchroflow_test_* DB only (`npm run test:integration`).
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { createUndeliveredReturnJob } from 'api-src/services/returns/returnJobs.service';
import { evaluateOrderConstraints } from 'api-src/services/constraints/constraintEngine';
import { projectOrderConstraints } from 'api-src/projections/orderConstraintProjection';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

const ADDRESS_RESOLUTION_ROUTE = '/api/v1/orders/address-resolution';

/** A complete address — the evaluator reports NO customer block for these. */
const COMPLETE_ADDRESS = {
  shipping_address1: '221B Baker Street',
  shipping_city: 'London',
  shipping_zip: 'NW1 6XE',
  shipping_country_code: 'GB',
};

/** Missing all four required fields — the evaluator derives incomplete_address. */
const INCOMPLETE_ADDRESS = {
  shipping_address1: null,
  shipping_city: null,
  shipping_zip: null,
  shipping_country_code: null,
};

async function createShop(label: string): Promise<{
  shopId: number;
  userId: number;
  token: string;
}> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `${label}-${unique}@test.example`,
        password_hash: 'not-a-real-hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    const id = Number(row.id ?? row);
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: id, role: 'owner' });
    return id;
  });

  return { shopId, userId, token: issueTestToken({ userId, shopId }) };
}

async function seedPaidOrder(
  shopId: number,
  address: Record<string, string | null>,
): Promise<string> {
  const orderId = crypto.randomUUID();
  const externalOrderId =
    String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  const now = new Date();

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
      ...address,
    });

    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    });

    // order_fulfillment_status is projection-owned; same transaction-local guard
    // the production writer sets. Fixture prerequisite only.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: now,
    });
  });

  return orderId;
}

/** Runs the REAL evaluator + projection so constraint truth is never hand-made. */
async function reevaluate(shopId: number, orderId: string): Promise<void> {
  await withTenant(shopId, async (trx) => {
    const evaluations = await evaluateOrderConstraints(trx, orderId, shopId);
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await projectOrderConstraints(trx, orderId, shopId, 1, new Date(), evaluations);
  });
}

async function activeConstraints(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('order_constraints')
      .where({ lasyncro_order_id: orderId, is_active: true })
      .select('constraint_type', 'block_type', 'is_active'),
  );
}

describe('OPS-RESOLVE-API-01 — every active customer/incomplete_address order is session-visible', () => {
  it('returns multi-blocked and single-blocked address orders, and excludes non-address, resolved and cross-tenant rows', async () => {
    const primary = await createShop('addr-session');
    const other = await createShop('addr-session-other');

    // ── A: operational + customer on the SAME order ─────────────────────────
    const orderA = await seedPaidOrder(primary.shopId, INCOMPLETE_ADDRESS);
    await reevaluate(primary.shopId, orderA);
    await createUndeliveredReturnJob({
      shopId: primary.shopId,
      lasyncroOrderId: orderA,
      // Real undelivered_reason_type enum value (migration 0008).
      undeliveredReason: 'wrong_address',
      operatorId: primary.userId,
    });

    // Fixture precondition: BOTH constraints are genuinely active, and the Flow
    // election would pick 'operational' (precedence 0) over 'customer' (1).
    const aConstraints = await activeConstraints(primary.shopId, orderA);
    expect(aConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_type: 'customer', block_type: 'incomplete_address' }),
        expect.objectContaining({ constraint_type: 'operational', block_type: 'returned_undelivered' }),
      ]),
    );

    // ── A2: customer only ───────────────────────────────────────────────────
    const orderA2 = await seedPaidOrder(primary.shopId, INCOMPLETE_ADDRESS);
    await reevaluate(primary.shopId, orderA2);

    // ── B: active customer, NON-address block_type ──────────────────────────
    // Not reachable via any evaluator (see the header note); inserted under the
    // production writer's own projection guard to pin the block_type filter.
    const orderB = await seedPaidOrder(primary.shopId, COMPLETE_ADDRESS);
    await withTenant(primary.shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await trx('order_constraints').insert({
        constraint_id: crypto.randomUUID(),
        lasyncro_order_id: orderB,
        constraint_type: 'customer',
        block_type: 'awaiting_customer_confirmation',
        target_id: null,
        started_at: new Date(),
        resolved_at: null,
        is_active: true,
        write_source: 'test:ops-resolve-api-01-non-address-block',
        created_at: new Date(),
      });
    });

    // ── C: customer/incomplete_address, then genuinely resolved ─────────────
    const orderC = await seedPaidOrder(primary.shopId, INCOMPLETE_ADDRESS);
    await reevaluate(primary.shopId, orderC);
    expect(await activeConstraints(primary.shopId, orderC)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_type: 'customer', block_type: 'incomplete_address' }),
      ]),
    );
    await withTenant(primary.shopId, (trx) =>
      trx('orders').where({ lasyncro_order_id: orderC }).update(COMPLETE_ADDRESS),
    );
    await reevaluate(primary.shopId, orderC);
    // Resolved by the real evaluator, not by hand.
    expect(
      (await activeConstraints(primary.shopId, orderC)).filter(
        (c) => c.constraint_type === 'customer',
      ),
    ).toEqual([]);

    // ── D: another tenant's active address block ────────────────────────────
    const orderD = await seedPaidOrder(other.shopId, INCOMPLETE_ADDRESS);
    await reevaluate(other.shopId, orderD);
    expect(await activeConstraints(other.shopId, orderD)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_type: 'customer', block_type: 'incomplete_address' }),
      ]),
    );

    // ── THE CONTRACT ────────────────────────────────────────────────────────
    const res = await request(app)
      .get(ADDRESS_RESOLUTION_ROUTE)
      .set('Authorization', `Bearer ${primary.token}`);

    expect(res.status).toBe(200);

    const returnedIds: string[] = (res.body?.data ?? res.body?.orders ?? []).map(
      (row: Record<string, unknown>) =>
        String(row.lasyncro_order_id ?? row.orderId ?? row.order_id),
    );

    // A is the decisive case: included DESPITE losing the Flow election.
    expect(returnedIds).toContain(orderA);
    expect(returnedIds).toContain(orderA2);

    expect(returnedIds).not.toContain(orderB);
    expect(returnedIds).not.toContain(orderC);
    expect(returnedIds).not.toContain(orderD);

    // Fixture-scoped, so unrelated rows in the same DB cannot mask a miss.
    expect(returnedIds.filter((id) => id === orderA)).toHaveLength(1);
  }, 180_000);
});
