// GH-1223 / TIER-08 — Order execution authorization boundary.
//
// Ratified contract (commercial and RBAC authority stay independent):
//
// 1. POST /api/v1/orders/:orderId/execute
//      authenticateToken → requireCapability('orders.core')
//      → requireAction('orders:execute') → fail-closed USER-executable
//      action admission → controller.
//    orders:execute — owner/admin allow, operator deny, LOCKED.
// 2. Generic USER-executable admission: ALLOW resolve_operational_block only.
//    DENY proceed_fulfillment, resolve_inventory_block, resolve_customer_block,
//    open_return_job, open_sourcing, unknown and missing action types.
//    Execution-registry membership is NOT user authorization.
// 3. PATCH /api/v1/orders/:orderId/shipping-address
//      authenticateToken → requireCapability('orders.core')
//      → requireAction('orders:shipping-address:write') → controller.
// 4. No blanket Orders API gate — read routes keep their existing behaviour.
//
// Every rejection proves zero mutation (queue/command rows for execute;
// canonical address + direct side-effect rows for shipping correction).
//
// Pattern: GH-1222 (warehouse-role-boundaries-gh1222.test.ts) — real
// createApp(), real disposable Postgres, real middleware chain, real tenant +
// memberships, authoritative tier via transitionShopSubscription. No worker,
// no provider call. Operator authority is the canonical default policy: no
// shop_role_permissions rows are seeded.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(30000);

const app = createApp();

type Tier = 'starter' | 'core' | 'growth' | 'scale';
type Role = 'owner' | 'admin' | 'operator';

let SHOP_ID: number;
const USER_IDS: Partial<Record<Role, number>> = {};

async function createMember(shopId: number, unique: string, role: Role): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `order-exec-1223-${role}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: role,
        role,
      })
      .returning('id');
    const userId = row.id as number;

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role,
      revoked_at: null,
    });

    return userId;
  });
}

async function seedShop(): Promise<void> {
  const unique = crypto.randomBytes(6).toString('hex');

  SHOP_ID = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `order-exec-1223-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  USER_IDS.owner = await createMember(SHOP_ID, unique, 'owner');
  USER_IDS.admin = await createMember(SHOP_ID, unique, 'admin');
  USER_IDS.operator = await createMember(SHOP_ID, unique, 'operator');
}

/** GH-1136 — authoritative tier via the canonical transition path. */
async function setCurrentTier(tier: Tier): Promise<void> {
  await withTenant(SHOP_ID, (trx) =>
    transitionShopSubscription(
      {
        shopId: SHOP_ID,
        to: { tier, status: 'active', billingProvider: 'shopify' },
        source: 'gh1223_order_execution_authorization_test',
        reason: 'test_tier_fixture',
        actorType: 'shopify',
        actingProvider: 'shopify',
      },
      trx,
    ),
  );
}

function tokenFor(role: Role, tier: Tier): string {
  return issueTestToken({
    userId: USER_IDS[role] as number,
    shopId: SHOP_ID,
    tier,
    roles: [role],
  });
}

const asRole = (role: Role, tier: Tier) => ({ Authorization: `Bearer ${tokenFor(role, tier)}` });

// ---------------------------------------------------------------------------
// Order / constraint / decision fixtures (fresh per behavioural case)
// ---------------------------------------------------------------------------

type ConstraintSpec = { constraint_type: string; block_type: string };

const OPERATIONAL: ConstraintSpec = { constraint_type: 'operational', block_type: 'manual_hold' };
const RETURNED_UNDELIVERED: ConstraintSpec = { constraint_type: 'operational', block_type: 'returned_undelivered' };
const INVENTORY: ConstraintSpec = { constraint_type: 'inventory', block_type: 'oversell' };
const CUSTOMER_ADDRESS: ConstraintSpec = { constraint_type: 'customer', block_type: 'incomplete_address' };

/**
 * Minimal paid order (inventory-decision-contract.test.ts orders insert shape)
 * with an INCOMPLETE shipping address and a Shopify identity mapping so the
 * shipping-address controller exercises its full direct-write path.
 */
async function seedOrder(): Promise<string> {
  const orderId = crypto.randomUUID();
  const now = new Date();

  await withTenant(SHOP_ID, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: SHOP_ID,
      aggregate_version: 1,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      shipping_address1: null,
      shipping_city: 'Stockholm',
      shipping_zip: null,
      shipping_country_code: 'SE',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: SHOP_ID,
      platform: 'shopify',
      external_order_id:
        String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    });
  });

  return orderId;
}

/** order_constraints is projection-single-writer guarded (migration 0076). */
async function addActiveConstraint(orderId: string, spec: ConstraintSpec): Promise<void> {
  await withTenant(SHOP_ID, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_constraints').insert({
      constraint_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      constraint_type: spec.constraint_type,
      block_type: spec.block_type,
      is_active: true,
      started_at: new Date(),
      write_source: 'gh1223_order_execution_authorization_test_fixture',
      created_at: new Date(),
    });
  });
}

/** Pending decision row (execution.smoke.test.ts decisions insert shape). */
async function addPendingDecision(
  orderId: string,
  recommendedAction: Record<string, unknown>,
): Promise<string> {
  const decisionId = crypto.randomUUID();

  await withTenant(SHOP_ID, (trx) =>
    trx('decisions').insert({
      id: decisionId,
      type: 'operational',
      entity_id: orderId,
      shop_id: SHOP_ID,
      aggregate_version: 1,
      priority: 10,
      score_breakdown: trx.raw('?::jsonb', [JSON.stringify({})]),
      reason: 'GH-1223 authorization fixture',
      signals: trx.raw('?::jsonb', [JSON.stringify({ test: true })]),
      recommended_action: trx.raw('?::jsonb', [JSON.stringify(recommendedAction)]),
      actions: trx.raw('?::jsonb', [JSON.stringify([])]),
      status: 'pending',
      lifecycle: trx.raw('?::jsonb', [JSON.stringify({})]),
      created_at: new Date(),
      updated_at: new Date(),
    }),
  );

  return decisionId;
}

const actionOf = (type: string) => ({ type, payload: {}, execution_mode: 'manual' });

async function seedDecisionCase(
  recommendedAction: Record<string, unknown>,
  constraint: ConstraintSpec | null,
): Promise<{ orderId: string; decisionId: string }> {
  const orderId = await seedOrder();
  if (constraint) await addActiveConstraint(orderId, constraint);
  const decisionId = await addPendingDecision(orderId, recommendedAction);
  return { orderId, decisionId };
}

async function executionMutations(decisionId: string): Promise<{ queue: number; commands: number }> {
  return withTenant(SHOP_ID, async (trx) => {
    const queue = await trx('decision_execution_queue')
      .where({ decision_id: decisionId })
      .count<{ count: string }[]>('* as count');
    const commands = await trx('commands')
      .where({ shop_id: SHOP_ID, type: 'EXECUTE_DECISION' })
      .whereRaw(`payload->>'decisionId' = ?`, [decisionId])
      .count<{ count: string }[]>('* as count');
    return { queue: Number(queue[0].count), commands: Number(commands[0].count) };
  });
}

const execute = (orderId: string, role: Role, tier: Tier) =>
  request(app).post(`/api/v1/orders/${orderId}/execute`).set(asRole(role, tier)).send({});

/** Status and denial identity together, so a RED run shows WHICH gate denied. */
const denialIdentity = (res: request.Response) => ({
  status: res.status,
  error: res.body?.error,
  capabilityId: res.body?.capabilityId,
  action: res.body?.action,
});

beforeAll(async () => {
  await seedShop();
});

afterAll(async () => {
  await db.destroy();
});

// ---------------------------------------------------------------------------
// A1 — POST /execute commercial / role middleware order
// ---------------------------------------------------------------------------

describe('GH-1223 A1 — POST /orders/:orderId/execute commercial → role gates', () => {
  it('A1a EXPECTED RED: owner @ Starter -> 403 COMMERCIAL_ACCESS_DENIED on orders.core, zero queue/command mutation', async () => {
    await setCurrentTier('starter');
    const { orderId, decisionId } = await seedDecisionCase(actionOf('resolve_operational_block'), OPERATIONAL);

    const res = await execute(orderId, 'owner', 'starter');

    expect(denialIdentity(res)).toEqual({
      status: 403,
      error: 'COMMERCIAL_ACCESS_DENIED',
      capabilityId: 'orders.core',
      action: undefined,
    });
    expect(await executionMutations(decisionId)).toEqual({ queue: 0, commands: 0 });
  });

  it('A1b EXPECTED RED: operator @ Core -> 403 ACTION_FORBIDDEN on orders:execute, zero queue/command mutation', async () => {
    await setCurrentTier('core');
    const { orderId, decisionId } = await seedDecisionCase(actionOf('resolve_operational_block'), OPERATIONAL);

    const res = await execute(orderId, 'operator', 'core');

    expect(denialIdentity(res)).toEqual({
      status: 403,
      error: 'ACTION_FORBIDDEN',
      capabilityId: undefined,
      action: 'orders:execute',
    });
    expect(await executionMutations(decisionId)).toEqual({ queue: 0, commands: 0 });
  });

  it.each(['owner', 'admin'] as const)(
    'A1c/A1d GREEN CONTROL: %s @ Core -> 202 Execution queued, one queue row + one EXECUTE_DECISION command',
    async (role) => {
      await setCurrentTier('core');
      const { orderId, decisionId } = await seedDecisionCase(actionOf('resolve_operational_block'), OPERATIONAL);

      const res = await execute(orderId, role, 'core');

      expect(res.status).toBe(202);
      expect(res.body.message).toBe('Execution queued');
      expect(res.body.action_type).toBe('resolve_operational_block');
      expect(res.body.decision_id).toBe(decisionId);
      expect(await executionMutations(decisionId)).toEqual({ queue: 1, commands: 1 });
    },
  );

  it('A1e EXPECTED RED / ORDERING: operator @ Starter -> COMMERCIAL_ACCESS_DENIED on orders.core (commercial before role), zero mutation', async () => {
    await setCurrentTier('starter');
    const { orderId, decisionId } = await seedDecisionCase(actionOf('resolve_operational_block'), OPERATIONAL);

    const res = await execute(orderId, 'operator', 'starter');

    expect(denialIdentity(res)).toEqual({
      status: 403,
      error: 'COMMERCIAL_ACCESS_DENIED',
      capabilityId: 'orders.core',
      action: undefined,
    });
    expect(await executionMutations(decisionId)).toEqual({ queue: 0, commands: 0 });
  });
});

// ---------------------------------------------------------------------------
// A2 — fail-closed USER-executable action admission
// ---------------------------------------------------------------------------

describe('GH-1223 A2 — generic execution admits only USER-executable actions (fail closed)', () => {
  it('A2 ALLOW CONTROL: resolve_operational_block + active operational constraint, owner @ Core -> 202 with queue + command', async () => {
    await setCurrentTier('core');
    const { orderId, decisionId } = await seedDecisionCase(actionOf('resolve_operational_block'), OPERATIONAL);

    const res = await execute(orderId, 'owner', 'core');

    expect(res.status).toBe(202);
    expect(res.body.action_type).toBe('resolve_operational_block');
    expect(await executionMutations(decisionId)).toEqual({ queue: 1, commands: 1 });
  });

  // Every mapped action is seeded with its matching ACTIVE constraint so a
  // refusal cannot be explained by staleness.
  const DENY_CASES: Array<{ label: string; action: Record<string, unknown>; constraint: ConstraintSpec | null }> = [
    { label: 'proceed_fulfillment', action: actionOf('proceed_fulfillment'), constraint: null },
    { label: 'resolve_inventory_block (active inventory)', action: actionOf('resolve_inventory_block'), constraint: INVENTORY },
    { label: 'resolve_customer_block (active customer)', action: actionOf('resolve_customer_block'), constraint: CUSTOMER_ADDRESS },
    { label: 'open_return_job (active operational)', action: actionOf('open_return_job'), constraint: RETURNED_UNDELIVERED },
    { label: 'open_sourcing (active inventory)', action: actionOf('open_sourcing'), constraint: INVENTORY },
    { label: 'unknown action gh1223_unknown_action', action: actionOf('gh1223_unknown_action'), constraint: null },
    { label: 'missing action type', action: { payload: {}, execution_mode: 'manual' }, constraint: null },
  ];

  it.each(DENY_CASES)(
    'A2 DENY: $label, owner @ Core -> 400 "No actionable decision found for this order", zero queue/command mutation',
    async ({ action, constraint }) => {
      await setCurrentTier('core');
      const { orderId, decisionId } = await seedDecisionCase(action, constraint);

      const res = await execute(orderId, 'owner', 'core');

      expect({ status: res.status, error: res.body?.error }).toEqual({
        status: 400,
        error: 'No actionable decision found for this order',
      });
      expect(await executionMutations(decisionId)).toEqual({ queue: 0, commands: 0 });
    },
  );
});

// ---------------------------------------------------------------------------
// A3 — PATCH /shipping-address authority
// ---------------------------------------------------------------------------

const COMPLETE_PATCH = {
  address1: '221B Baker Street',
  city: 'London',
  zip: 'NW1 6XE',
  countryCode: 'GB',
};

async function shippingState(orderId: string) {
  return withTenant(SHOP_ID, async (trx) => {
    const address = await trx('orders')
      .where({ shop_id: SHOP_ID, lasyncro_order_id: orderId })
      .first(
        'shipping_address1',
        'shipping_city',
        'shipping_zip',
        'shipping_country_code',
        'aggregate_version',
      );
    const count = async (q: any) => Number((await q.count('* as count'))[0].count);
    return {
      address,
      history: await count(
        trx('order_fulfillment_history').where({ lasyncro_order_id: orderId, status: 'address_corrected' }),
      ),
      reconciliationIntents: await count(
        trx('order_reconciliation_intents').where({ shop_id: SHOP_ID, lasyncro_order_id: orderId }),
      ),
      interventions: await count(
        trx('decision_interventions').where({ shop_id: SHOP_ID, entity_type: 'order', entity_id: orderId }),
      ),
      domainEvents: await count(
        trx('domain_events').where({ shop_id: SHOP_ID, event_type: 'orders/shipping_address_corrected' }),
      ),
    };
  });
}

async function seedAddressCase(): Promise<string> {
  const orderId = await seedOrder();
  await addActiveConstraint(orderId, CUSTOMER_ADDRESS);
  return orderId;
}

const patchAddress = (orderId: string, role: Role, tier: Tier) =>
  request(app)
    .patch(`/api/v1/orders/${orderId}/shipping-address`)
    .set(asRole(role, tier))
    .send(COMPLETE_PATCH);

describe('GH-1223 A3 — PATCH /orders/:orderId/shipping-address commercial → role gates', () => {
  it('A3a EXPECTED RED: owner @ Starter -> 403 COMMERCIAL_ACCESS_DENIED on orders.core, zero mutation', async () => {
    await setCurrentTier('starter');
    const orderId = await seedAddressCase();
    const before = await shippingState(orderId);

    const res = await patchAddress(orderId, 'owner', 'starter');

    expect(denialIdentity(res)).toEqual({
      status: 403,
      error: 'COMMERCIAL_ACCESS_DENIED',
      capabilityId: 'orders.core',
      action: undefined,
    });
    expect(await shippingState(orderId)).toEqual(before);
  });

  it('A3b EXPECTED RED: operator @ Core -> 403 ACTION_FORBIDDEN on orders:shipping-address:write, zero mutation', async () => {
    await setCurrentTier('core');
    const orderId = await seedAddressCase();
    const before = await shippingState(orderId);

    const res = await patchAddress(orderId, 'operator', 'core');

    expect(denialIdentity(res)).toEqual({
      status: 403,
      error: 'ACTION_FORBIDDEN',
      capabilityId: undefined,
      action: 'orders:shipping-address:write',
    });
    expect(await shippingState(orderId)).toEqual(before);
  });

  it.each(['owner', 'admin'] as const)(
    'A3c/A3d GREEN CONTROL: %s @ Core -> 200, existing correction behaviour retained',
    async (role) => {
      await setCurrentTier('core');
      const orderId = await seedAddressCase();
      const before = await shippingState(orderId);

      const res = await patchAddress(orderId, role, 'core');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Shipping address updated');
      const after = await shippingState(orderId);
      expect(after.address).toEqual({
        shipping_address1: COMPLETE_PATCH.address1,
        shipping_city: COMPLETE_PATCH.city,
        shipping_zip: COMPLETE_PATCH.zip,
        shipping_country_code: COMPLETE_PATCH.countryCode,
        aggregate_version: before.address.aggregate_version + 1,
      });
      expect(after.history).toBe(before.history + 1);
      expect(after.reconciliationIntents).toBe(before.reconciliationIntents + 1);
      expect(after.interventions).toBe(before.interventions + 1);
      expect(after.domainEvents).toBe(before.domainEvents + 1);
    },
  );
});

// ---------------------------------------------------------------------------
// A4 — no blanket Orders lockdown
// ---------------------------------------------------------------------------

describe('GH-1223 A4 — Orders read routes are outside the GH-1223 write boundaries', () => {
  it('A4 GREEN CONTROL: operator @ Core GET /orders/:orderId/decision keeps existing behaviour (200, decision returned)', async () => {
    await setCurrentTier('core');
    const { orderId, decisionId } = await seedDecisionCase(actionOf('resolve_operational_block'), OPERATIONAL);

    const res = await request(app).get(`/api/v1/orders/${orderId}/decision`).set(asRole('operator', 'core'));

    expect(denialIdentity(res)).toEqual({
      status: 200,
      error: undefined,
      capabilityId: undefined,
      action: undefined,
    });
    expect(res.body.decision?.id).toBe(decisionId);
  });
});
