/**
 * OUTCOME-ATTR-01 — DECISION INTERVENTION PROVENANCE + VERIFIED OUTCOME.
 * Pilot scope: customer / incomplete_address address correction.
 *
 * THE DISTINCTION UNDER PROTECTION
 *   execution success  !=  treatment success  !=  operational outcome
 *
 *   A queue row reaching 'success' means a handler ran. A merchant saving an
 *   address means a treatment was applied. Neither is evidence that the
 *   merchant's problem is gone. Only canonical constraint truth
 *   (order_constraints.is_active / resolved_at) says that, and only after the
 *   real correction event has been projected.
 *
 *   Canonical outcome authority therefore remains order_constraints. These
 *   contracts exist to stop a future implementation from quietly promoting
 *   decision.status or decision_execution_queue.status into the outcome answer.
 *
 *   OUTCOME-ADDR-01  a corrected address writes exactly ONE durable intervention,
 *                    naming the EXACT active constraint_id, with actor / source /
 *                    correction provenance.
 *   OUTCOME-ADDR-02  immediately after the PATCH and BEFORE the emitted event is
 *                    processed, that intervention must not claim resolution —
 *                    the constraint is still active, so the outcome is pending
 *                    verification.
 *   OUTCOME-ADDR-03  after the real orders/shipping_address_corrected event runs
 *                    through the existing projection seam, the SAME constraint_id
 *                    becomes is_active=false with resolved_at set, and the outcome
 *                    reads verified_resolved FROM that canonical truth — while no
 *                    successful execution-queue row and no resolved decision exist
 *                    to have supplied the answer.
 *   OUTCOME-ADDR-04  with a coexisting inventory blocker, only the customer
 *                    constraint is attributed. The inventory blocker stays active
 *                    and no inventory intervention or outcome is manufactured.
 *   OUTCOME-ADDR-05  correcting an address on an order with no active
 *                    customer/incomplete_address constraint manufactures no
 *                    intervention and no outcome at all.
 *
 * WHAT THIS SLICE DOES NOT ASSERT
 *   Nothing here claims AI resolution, automatic correction, prevented revenue,
 *   or reduced operator review. A correction is an operator action; provenance
 *   records how the operator arrived at the value, nothing more.
 *
 * FROZEN BOUNDARY (the only implementation detail these contracts depend on)
 *   module : apps/backend/src/services/decision/interventionOutcome.service.ts
 *   export : readOrderInterventionOutcomes({ shopId, lasyncroOrderId })
 *
 *   Returns one entry per durable intervention:
 *     {
 *       constraintId, shopId, lasyncroOrderId,
 *       treatment,            // treatment/action identity
 *       actorUserId,          // actor identity where available
 *       sourceSurface,        // where the operator acted
 *       correctionSource,     // 'manual' | 'historical_address_assist'
 *       occurredAt,
 *       metadata,
 *       outcome: {
 *         status,             // 'pending_verification' | 'verified_resolved'
 *         constraintIsActive,
 *         constraintResolvedAt,
 *       }
 *     }
 *
 *   `outcome` is DERIVED at read time from order_constraints, not stored as a
 *   claim. Persistence shape beyond "a durable intervention exists with this
 *   provenance" is deliberately not prescribed here.
 *
 * HARNESS
 *   Identical canonical path to
 *   tests/integration/orders/address-customer-decision-contract.test.ts:
 *   HMAC Shopify install -> seedFreshInstall -> FT2 confirm; orders/create +
 *   orders/paid through processDomainEvent; the REAL authenticated PATCH route;
 *   the same event pump for the correction event. No order_constraints row is
 *   ever hand-inserted or hand-cleared, no outcome row is ever hand-seeded, and
 *   the canonical resolution lifecycle is never mocked.
 *
 *   Disposable synchroflow_test_* DB only (`npm run test:integration`).
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  systemQuery,
  withTenant,
  runWithTenantContext,
} from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { issueTestToken } from '../../unit/helpers/auth';
import { encrypt } from 'api-src/security/encryption.service';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── the frozen read seam ────────────────────────────────────────────────────

interface InterventionOutcome {
  constraintId: string;
  shopId: number;
  lasyncroOrderId: string;
  treatment: string;
  actorUserId: number | null;
  sourceSurface: string;
  correctionSource: string;
  occurredAt: string | Date;
  metadata: Record<string, unknown> | null;
  outcome: {
    status: 'pending_verification' | 'verified_resolved' | 'unknown';
    constraintIsActive: boolean;
    constraintResolvedAt: string | Date | null;
    resolutionLatencyMs: number | null;
  };
}

/**
 * Loaded lazily so the absence of the capability is one explicit failure per
 * contract rather than a file-level collection error.
 */
async function readInterventions(input: {
  shopId: number;
  lasyncroOrderId: string;
}): Promise<InterventionOutcome[]> {
  let mod: Record<string, unknown>;
  try {
    mod = await import('api-src/services/decision/interventionOutcome.service');
  } catch (err) {
    throw new Error(
      '[OUTCOME-ATTR-01] durable intervention/outcome capability is absent: ' +
        'apps/backend/src/services/decision/interventionOutcome.service.ts ' +
        '(expected export readOrderInterventionOutcomes). ' +
        `Underlying resolution error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const fn = mod.readOrderInterventionOutcomes;
  if (typeof fn !== 'function') {
    throw new Error(
      '[OUTCOME-ATTR-01] interventionOutcome.service does not export readOrderInterventionOutcomes'
    );
  }
  return (fn as (i: typeof input) => Promise<InterventionOutcome[]>)(input);
}

// ── canonical helpers (same shapes as the sibling address contract) ─────────

const provisionedShopIds: number[] = [];

async function hmacInstall(shopDomain: string): Promise<{ shopId: number; userId: number }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k as keyof typeof params]}`)
    .join('&');
  const hmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex');

  const install = await request(app)
    .get('/api/v1/integrations/shopify/install')
    .query({ ...params, hmac })
    .redirects(0);
  expect(install.status).toBe(302);

  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [
      `shopify-install+${shopDomain}@lasyncro.internal`,
    ])
  );
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number };
}

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId })
      .andWhere('id', '>', afterId)
      .orderBy('id', 'asc')
      .select('id')
  );
  for (const row of rows) {
    await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  }
  return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
}

async function provisionFt2Shop(
  label: string
): Promise<{ shopId: number; userId: number; token: string }> {
  const shopDomain = `addr-out-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  provisionedShopIds.push(shopId);

  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId,
      platform: 'shopify',
      platform_shop_name: shopDomain,
      access_token_encrypted: encrypt('offline-test-token-no-network-call'),
      sync_status: 'COMPLETED',
      updated_at: new Date(),
    })
  );

  let cursor = 0;
  cursor = await pumpEvents(shopId, cursor);
  cursor = await pumpEvents(shopId, cursor);
  cursor = await pumpEvents(shopId, cursor);

  const token = issueTestToken({ userId, shopId });
  const confirm = await request(app)
    .post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);

  return { shopId, userId, token };
}

async function seededVariantNumericId(shopId: number): Promise<string> {
  const row = await withTenant(shopId, (trx) =>
    trx('external_product_identity_map')
      .where({ shop_id: shopId, platform: 'shopify' })
      .whereNotNull('external_variant_id')
      .first('external_variant_id')
  );
  expect(row?.external_variant_id).toBeTruthy();
  const gid: string = row!.external_variant_id;
  return gid.startsWith('gid://') ? gid.split('/').pop()! : gid;
}

/** Deterministic canonical order id — identical derivation to orders.create.ts. */
function lasyncroOrderIdFor(shopId: number, externalOrderId: string): string {
  const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  return crypto
    .createHash('sha1')
    .update(`${NS}:${shopId}:shopify:${externalOrderId}`)
    .digest('hex')
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
}

async function insertEvent(
  shopId: number,
  eventType: string,
  payload: Record<string, unknown>
): Promise<number> {
  const [row] = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .insert({
        shop_id: shopId,
        event_type: eventType,
        event_payload: payload,
        event_time: new Date(),
        event_version: 1,
        external_event_id: `test:addr-out:${shopId}:${eventType}:${crypto.randomUUID()}`,
      })
      .returning(['id'])
  );
  return Number(row.id);
}

const projectEvent = (shopId: number, eventId: number) =>
  runWithTenantContext(shopId, () => processDomainEvent(eventId));

async function ingestPaidOrder(input: {
  shopId: number;
  shippingAddress: Record<string, unknown> | null;
}): Promise<{ orderId: string; externalOrderId: string }> {
  const { shopId, shippingAddress } = input;
  const externalOrderId = `${shopId}${Date.now()}${Math.floor(Math.random() * 1e4)}`;

  const createId = await insertEvent(shopId, 'orders/create', {
    id: externalOrderId,
    currency: 'USD',
    total_price: 42,
    subtotal_price: 42,
    total_tax: 0,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    shipping_address: shippingAddress,
    line_items: [
      {
        id: `${Date.now()}`,
        quantity: 1,
        price: '42.00',
        variant_id: await seededVariantNumericId(shopId),
      },
    ],
  });
  await projectEvent(shopId, createId);

  const paidId = await insertEvent(shopId, 'orders/paid', { id: externalOrderId });
  await projectEvent(shopId, paidId);

  const orderId = lasyncroOrderIdFor(shopId, externalOrderId);

  const order = await withTenant(shopId, (trx) =>
    trx('orders').where({ lasyncro_order_id: orderId }).first('payment_state')
  );
  expect(order?.payment_state).toBe('paid');

  return { orderId, externalOrderId };
}

const INCOMPLETE_ADDRESS = {
  name: 'Jane Doe',
  address1: '9 Partial Way',
  city: null,
  zip: null,
  country_code: null,
};
const COMPLETE_PATCH = {
  address1: '221B Baker Street',
  city: 'London',
  zip: 'NW1 6XE',
  countryCode: 'GB',
};

/** Full constraint rows INCLUDING id — attribution is by exact constraint_id. */
async function constraintsFor(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('order_constraints')
      .where({ lasyncro_order_id: orderId })
      .select('constraint_id', 'constraint_type', 'block_type', 'is_active', 'resolved_at')
  );
}

const activeOf = <T extends { is_active: boolean }>(rows: T[]) => rows.filter((r) => r.is_active);

async function activeCustomerConstraint(shopId: number, orderId: string) {
  const rows = await constraintsFor(shopId, orderId);
  const match = activeOf(rows).filter(
    (c) => c.constraint_type === 'customer' && c.block_type === 'incomplete_address'
  );
  expect(match).toHaveLength(1);
  return match[0];
}

async function maxEventId(shopId: number): Promise<number> {
  const row = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).max('id as max').first()
  );
  return Number(row?.max ?? 0);
}

async function correctionEvents(shopId: number, afterId: number) {
  return withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId, event_type: 'orders/shipping_address_corrected' })
      .andWhere('id', '>', afterId)
      .orderBy('id', 'asc')
      .select('id', 'event_payload')
  );
}

const patchAddress = (token: string, orderId: string, body: Record<string, unknown>) =>
  request(app)
    .patch(`/api/v1/orders/${orderId}/shipping-address`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

// ── OUTCOME-ADDR-01 / 02 / 03 ──────────────────────────────────────────────

describe('OUTCOME-ADDR-01/02/03 — provenance, pending verification, then canonical verified outcome', () => {
  it('attributes the exact constraint_id, withholds resolution until the real event is projected, then verifies from constraint truth', async () => {
    const { shopId, userId, token } = await provisionFt2Shop('one');
    const { orderId } = await ingestPaidOrder({
      shopId,
      shippingAddress: INCOMPLETE_ADDRESS,
    });

    // The exact constraint this correction must be attributed to.
    const constraint = await activeCustomerConstraint(shopId, orderId);

    const watermark = await maxEventId(shopId);
    const patch = await patchAddress(token, orderId, {
      ...COMPLETE_PATCH,
      correctionSource: 'historical_address_assist',
    });
    expect(patch.status).toBe(200);

    // ── OUTCOME-ADDR-01 — exactly one durable intervention, fully attributed.
    const afterPatch = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(afterPatch).toHaveLength(1);
    expect(afterPatch[0]).toEqual(
      expect.objectContaining({
        constraintId: constraint.constraint_id,
        shopId,
        lasyncroOrderId: orderId,
        actorUserId: userId,
        correctionSource: 'historical_address_assist',
      })
    );
    // Treatment and surface identity are recorded, whatever their vocabulary.
    expect(typeof afterPatch[0].treatment).toBe('string');
    expect(afterPatch[0].treatment.length).toBeGreaterThan(0);
    expect(typeof afterPatch[0].sourceSurface).toBe('string');
    expect(afterPatch[0].sourceSurface.length).toBeGreaterThan(0);
    expect(afterPatch[0].occurredAt).toBeTruthy();

    // ── OUTCOME-ADDR-02 — the correction event has NOT been processed yet, so
    // the constraint is still active and no resolution may be claimed.
    const stillActive = await activeCustomerConstraint(shopId, orderId);
    expect(stillActive.constraint_id).toBe(constraint.constraint_id);
    expect(afterPatch[0].outcome).toEqual(
      expect.objectContaining({
        status: 'pending_verification',
        constraintIsActive: true,
        constraintResolvedAt: null,
      })
    );

    // ── OUTCOME-ADDR-03 — process the REAL emitted event through the existing
    // projection seam. Canonical resolution is done by the system, not by us.
    const emitted = await correctionEvents(shopId, watermark);
    expect(emitted).toHaveLength(1);
    await projectEvent(shopId, Number(emitted[0].id));

    const resolvedRow = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === constraint.constraint_id
    );
    expect(resolvedRow).toBeTruthy();
    expect(resolvedRow!.is_active).toBe(false);
    expect(resolvedRow!.resolved_at).toBeTruthy();

    // The outcome now reads verified — and reads it from canonical truth.
    const afterProjection = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(afterProjection).toHaveLength(1);
    expect(afterProjection[0].constraintId).toBe(constraint.constraint_id);
    expect(afterProjection[0].outcome).toEqual(
      expect.objectContaining({
        status: 'verified_resolved',
        constraintIsActive: false,
      })
    );
    expect(afterProjection[0].outcome.constraintResolvedAt).toBeTruthy();

    // The intervention itself was not duplicated by the verification.
    expect(afterProjection[0].occurredAt).toEqual(afterPatch[0].occurredAt);

    /**
     * …and neither execution nor decision lifecycle could have supplied that
     * answer: there is no successful execution-queue row and no resolved
     * decision for this order at all. Canonical outcome authority is
     * order_constraints, and this proves nothing else stood in for it.
     */
    const successfulExecutions = await withTenant(shopId, (trx) =>
      trx('decision_execution_queue as q')
        .joinRaw('INNER JOIN decisions as d ON d.id::text = q.decision_id')
        .where('d.entity_id', orderId)
        .andWhere('q.status', 'success')
        .select('q.decision_id')
    );
    expect(successfulExecutions).toEqual([]);

    const resolvedDecisions = await withTenant(shopId, (trx) =>
      trx('decisions')
        .where({ entity_id: orderId, status: 'resolved' })
        .select('id')
    );
    expect(resolvedDecisions).toEqual([]);
  }, 180_000);
});

// ── OUTCOME-ADDR-04 ────────────────────────────────────────────────────────

describe('OUTCOME-ADDR-04 — a coexisting inventory blocker is never attributed', () => {
  it('attributes only the customer constraint and manufactures no inventory intervention or outcome', async () => {
    const { shopId, token } = await provisionFt2Shop('four');
    const { orderId, externalOrderId } = await ingestPaidOrder({
      shopId,
      shippingAddress: INCOMPLETE_ADDRESS,
    });

    // Genuine oversell derived from inventory_truth — the same canonical
    // fixture shape the sibling address contract uses. No constraint row is
    // hand-written.
    await withTenant(shopId, async (trx) => {
      const variants = await trx('order_revenue_units')
        .where({ lasyncro_order_id: orderId })
        .distinct('lasyncro_variant_id')
        .pluck('lasyncro_variant_id');
      expect(variants.length).toBeGreaterThanOrEqual(1);
      await trx('inventory_truth')
        .where({ shop_id: shopId })
        .whereIn('lasyncro_variant_id', variants)
        .update({ available_quantity: 0 });
    });

    const reeval = await insertEvent(shopId, 'orders/constraints_reevaluated', {
      id: externalOrderId,
    });
    await projectEvent(shopId, reeval);

    const before = activeOf(await constraintsFor(shopId, orderId));
    expect(before).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_type: 'customer', block_type: 'incomplete_address' }),
        expect.objectContaining({ constraint_type: 'inventory', block_type: 'oversell' }),
      ])
    );

    const customerConstraint = await activeCustomerConstraint(shopId, orderId);
    const inventoryConstraintIds = before
      .filter((c) => c.constraint_type === 'inventory')
      .map((c) => c.constraint_id);
    expect(inventoryConstraintIds.length).toBeGreaterThanOrEqual(1);

    const watermark = await maxEventId(shopId);
    const patch = await patchAddress(token, orderId, {
      ...COMPLETE_PATCH,
      correctionSource: 'manual',
    });
    expect(patch.status).toBe(200);

    const emitted = await correctionEvents(shopId, watermark);
    expect(emitted).toHaveLength(1);
    await projectEvent(shopId, Number(emitted[0].id));

    // Canonical reevaluation: customer resolved, inventory still blocking.
    const after = await constraintsFor(shopId, orderId);
    const customerAfter = after.find((c) => c.constraint_id === customerConstraint.constraint_id)!;
    expect(customerAfter.is_active).toBe(false);
    expect(customerAfter.resolved_at).toBeTruthy();
    expect(activeOf(after)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_type: 'inventory', block_type: 'oversell', is_active: true }),
      ])
    );

    // Attribution names the customer constraint and nothing else. A correction
    // that clears one blocker must never claim credit for another.
    const interventions = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(interventions).toHaveLength(1);
    expect(interventions[0].constraintId).toBe(customerConstraint.constraint_id);
    expect(inventoryConstraintIds).not.toContain(interventions[0].constraintId);
    expect(interventions[0].outcome).toEqual(
      expect.objectContaining({ status: 'verified_resolved', constraintIsActive: false })
    );
  }, 180_000);
});

// ── OUTCOME-ADDR-05 ────────────────────────────────────────────────────────

describe('OUTCOME-ADDR-05 — no active customer blocker means no intervention at all', () => {
  it('does not manufacture an intervention or outcome when the order was never customer-blocked', async () => {
    const { shopId, token } = await provisionFt2Shop('five');

    // Ingested COMPLETE from the start — no customer/incomplete_address ever.
    const { orderId } = await ingestPaidOrder({
      shopId,
      shippingAddress: {
        name: 'Jane Doe',
        address1: '1 Complete Road',
        city: 'Leeds',
        zip: 'LS1 1AA',
        country_code: 'GB',
      },
    });

    const before = await constraintsFor(shopId, orderId);
    expect(
      activeOf(before).filter((c) => c.constraint_type === 'customer')
    ).toEqual([]);

    const watermark = await maxEventId(shopId);
    const patch = await patchAddress(token, orderId, {
      ...COMPLETE_PATCH,
      correctionSource: 'manual',
    });
    expect(patch.status).toBe(200);

    // The address write itself is legitimate and still happens…
    const updated = await withTenant(shopId, (trx) =>
      trx('orders').where({ lasyncro_order_id: orderId }).first('shipping_address1')
    );
    expect(updated?.shipping_address1).toBe(COMPLETE_PATCH.address1);

    const emitted = await correctionEvents(shopId, watermark);
    expect(emitted).toHaveLength(1);
    await projectEvent(shopId, Number(emitted[0].id));

    // …but there was no problem to solve, so the Decision Engine records no
    // intervention and no outcome. Editing data is not a treatment.
    expect(await readInterventions({ shopId, lasyncroOrderId: orderId })).toEqual([]);
  }, 180_000);
});


// ── OUTCOME-ADDR-07 ────────────────────────────────────────────────────────

/**
 * CHRONOLOGY IS NOT NEGOTIABLE.
 *
 * An intervention recorded AFTER the constraint had already resolved cannot
 * have caused that resolution. Crediting it would be the single cheapest way
 * to manufacture a flattering outcome number — every late, duplicate or
 * replayed write would inherit someone else's win.
 *
 * PRODUCTION EVIDENCE (2026-09-08) that motivates the precision rule:
 *   occurred_at  2026-09-08 16:24:38.318964+00
 *   resolved_at  2026-09-08 16:24:38.318+00
 *   raw Postgres delta -0.964 ms
 * Both collapse to the SAME JavaScript millisecond, which is the precision the
 * read model actually evaluates at — so that case is legitimately
 * verified_resolved, and it is NOT what this contract targets.
 *
 * This contract targets a genuine, unambiguous inversion: half a second of
 * real time, after canonical resolution. There is no tolerance under which
 * that may be credited.
 *
 * The sentinel row below is a DIAGNOSTIC probe of the read model's impossible-
 * chronology branch. It is the only hand-written row in this file, it is an
 * intervention (never a constraint), and order_constraints is neither mutated
 * nor hand-cleared anywhere here — the constraint it points at was resolved by
 * the real canonical lifecycle above it.
 */
describe('OUTCOME-ADDR-07 — an intervention recorded after resolution is never credited', () => {
  it('returns unknown, not verified_resolved, for an intervention that post-dates canonical resolution', async () => {
    const { shopId, token } = await provisionFt2Shop('seven');
    const { orderId } = await ingestPaidOrder({
      shopId,
      shippingAddress: INCOMPLETE_ADDRESS,
    });

    const constraint = await activeCustomerConstraint(shopId, orderId);

    // Real correction, real event, real canonical resolution.
    const watermark = await maxEventId(shopId);
    const patch = await patchAddress(token, orderId, {
      ...COMPLETE_PATCH,
      correctionSource: 'manual',
    });
    expect(patch.status).toBe(200);

    const emitted = await correctionEvents(shopId, watermark);
    expect(emitted).toHaveLength(1);
    await projectEvent(shopId, Number(emitted[0].id));

    const resolvedRow = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === constraint.constraint_id
    );
    expect(resolvedRow).toBeTruthy();
    expect(resolvedRow!.is_active).toBe(false);
    expect(resolvedRow!.resolved_at).toBeTruthy();

    // The genuine intervention still verifies — the sentinel must not change that.
    const realOutcomes = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(realOutcomes).toHaveLength(1);
    expect(realOutcomes[0].outcome.status).toBe('verified_resolved');

    /**
     * Sentinel: same shop, same order, same EXACT constraint_id — but recorded
     * 500ms after that constraint had already resolved.
     */
    const SENTINEL_SURFACE = 'test chronology sentinel';
    const resolvedAt = new Date(resolvedRow!.resolved_at as unknown as string);
    const sentinelOccurredAt = new Date(resolvedAt.getTime() + 500);

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
        source_surface: SENTINEL_SURFACE,
        occurred_at: sentinelOccurredAt,
        metadata: JSON.stringify({ correction_source: 'manual' }),
      })
    );

    const outcomes = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(outcomes).toHaveLength(2);

    const sentinel = outcomes.find((o) => o.sourceSurface === SENTINEL_SURFACE);
    expect(sentinel).toBeTruthy();
    expect(sentinel!.constraintId).toBe(constraint.constraint_id);

    // Canonical truth is still reported faithfully — the constraint DID resolve.
    // What is refused is the causal credit, not the fact.
    expect(sentinel!.outcome.status).toBe('unknown');
    expect(sentinel!.outcome.constraintIsActive).toBe(false);
    expect(sentinel!.outcome.constraintResolvedAt).toBeTruthy();
    expect(sentinel!.outcome.resolutionLatencyMs).toBeNull();

    // And the genuine intervention is untouched by the sentinel's presence.
    const real = outcomes.find((o) => o.sourceSurface !== SENTINEL_SURFACE);
    expect(real!.outcome.status).toBe('verified_resolved');
  }, 180_000);
});
