/**
 * PROJECTION-CURSOR-STALL-08 — DB projection worker seam + canonical-contract quarantine.
 *
 * Slice 1: the VALID-EVENT baseline — proves the pure refactor that extracted
 * `processNextProjectionEventOnce()` out of `startDbProjectionWorker()`'s loop
 * did not change behaviour for a valid event.
 *
 * Slice 2: CanonicalContractError is quarantined at runtime —
 *  A  poison at head → recorded + cursor advances → N+1 projects
 *  D  a pre-existing failure row is not rewritten (ON CONFLICT IGNORE)
 *  B  concurrent seam calls → exactly one failure row, cursor advances once
 *  E  recordCanonicalQuarantineAndAdvance: failure row + cursor advance are atomic
 *  C  a non-canonical handler failure still halts the worker (typed, narrow boundary)
 *
 * Fixture conventions (fresh HMAC install, ghost owner) mirror
 * tests/integration/lifecycle/zero-order-sync-completion.test.ts. Runs only
 * against a disposable synchroflow_test_* database via scripts/with-test-db.js
 * (`npm run test:integration`).
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  runWithTenantContext,
  setTenantContext,
  systemQuery,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import {
  processNextProjectionEventOnce,
  recordCanonicalQuarantineAndAdvance,
} from 'api-src/workers/projection.db.worker';
import { CanonicalContractError } from 'api-src/services/mappers/canonicalContractError';

const app = createApp();

/** Fresh HMAC install — same pattern as zero-order-sync-completion.test.ts. */
async function installFreshShop(shopDomain: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key as keyof typeof params]}`)
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

  const ghostEmail = `shopify-install+${shopDomain}@lasyncro.internal`;
  const ghostLookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [ghostEmail])
  );
  const ghostUser = ghostLookup.rows?.[0]?.value;
  expect(ghostUser).toBeTruthy();

  return { shopId: ghostUser.shop_id as number, ghostUser };
}

/** Mapper-valid orders/create payload (Shopify REST snake_case), zero line items. */
function buildValidOrderPayload(shopId: number) {
  return {
    id: `${shopId}${Date.now()}`,
    currency: 'USD',
    total_price: 10,
    subtotal_price: 10,
    total_tax: 0,
    line_items: [] as unknown[],
  };
}

/**
 * Obsolete canonical-poison payload: bare camelCase scalar monetary fields.
 * The canonical mapper reads only Shopify REST (`total_price`) / GraphQL
 * (`totalPriceSet.shopMoney.amount`) shapes, so this deterministically throws
 * CanonicalContractError(tag='CANONICAL_ORDER_TOTAL_MISSING') before the
 * orders/create handler runs. This is the exact shape a superseded revision of
 * zero-order-sync-completion.test.ts's buildMinimalOrderPayload left in the
 * shared dev DB as event 182 (PROJECTION-CURSOR-STALL-08).
 */
function buildCanonicalPoisonPayload(shopId: number) {
  return {
    id: `${shopId}${Date.now()}`,
    currency: 'USD',
    totalPrice: 10,
    subtotalPrice: 10,
    totalTax: 0,
    lineItems: [] as unknown[],
  };
}

async function insertOrdersCreateEvent(
  shopId: number,
  payload: Record<string, unknown>
): Promise<number> {
  const [row] = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'orders/create',
        event_payload: payload,
        event_time: new Date(),
        event_version: 1,
        external_event_id: `test:orders/create:${shopId}:${Date.now()}:${Math.random()}`,
      })
      .returning(['id'])
  );
  return Number(row.id);
}

async function workerState(): Promise<{ cursor: number; max: number }> {
  const res = await systemQuery(
    db.raw('SELECT * FROM public.get_projection_worker_state()')
  );
  return {
    cursor: Number(res.rows[0]?.last_processed_event_id ?? 0),
    max: Number(res.rows[0]?.max_event_id ?? 0),
  };
}

async function readCursor(): Promise<number> {
  return (await workerState()).cursor;
}

/**
 * Drive the seam until the global cursor sits at exactly `targetId - 1`, i.e.
 * the next seam call will act on `targetId`. Processes every lower event
 * (including stray lifecycle/first_insight_delivered rows that FirstInsightService
 * inserts post-commit from earlier cases). Deterministic because this test's
 * domain_events ids are contiguous.
 */
async function drainUpTo(targetId: number): Promise<void> {
  for (let i = 0; i < 3000; i++) {
    const { cursor } = await workerState();
    if (cursor === targetId - 1) return;
    if (cursor > targetId - 1) {
      throw new Error(`drainUpTo(${targetId}): cursor already at ${cursor}`);
    }
    const step = await processNextProjectionEventOnce();
    if (step.status === 'idle') {
      throw new Error(
        `drainUpTo(${targetId}): reached idle at cursor ${cursor}`
      );
    }
  }
  throw new Error(`drainUpTo(${targetId}): did not converge`);
}

/** Drive the seam until it reports on `targetId`, ignoring earlier events. */
async function advanceToEvent(targetId: number) {
  for (let i = 0; i < 3000; i++) {
    const step = await processNextProjectionEventOnce();
    if (step.status === 'idle') {
      throw new Error(`advanceToEvent(${targetId}): reached idle first`);
    }
    if ('domainEventId' in step && step.domainEventId === targetId) {
      return step;
    }
  }
  throw new Error(`advanceToEvent(${targetId}): never reached`);
}

describe('PROJECTION-CURSOR-STALL-08 — processNextProjectionEventOnce()', () => {
  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
    process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
    process.env.API_URL = process.env.API_URL || 'https://api.test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  });

  it('VALID EVENT — projects normally and advances the cursor atomically (Slice 1 refactor baseline)', async () => {
    const shopDomain = `stall08-valid-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);

    const eventId = await insertOrdersCreateEvent(
      shopId,
      buildValidOrderPayload(shopId)
    );

    const result = await advanceToEvent(eventId);
    expect(result).toEqual({ status: 'projected', domainEventId: eventId });

    const orderCount = await withTenant(shopId, (trx) =>
      trx('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first()
    );
    expect(Number(orderCount?.count ?? 0)).toBeGreaterThanOrEqual(1);

    const snapshot = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first('phase')
    );
    expect(snapshot?.phase).toBe('FT0');

    const failure = await withTenant(shopId, (trx) =>
      trx('domain_event_projection_failures')
        .where({ domain_event_id: eventId })
        .first()
    );
    expect(failure).toBeUndefined();

    expect(await readCursor()).toBe(eventId);
  }, 60000);

  it('CASE A — canonical poison at head is quarantined (cursor advances), then N+1 projects', async () => {
    const shopDomain = `stall08-poison-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);

    const poisonId = await insertOrdersCreateEvent(
      shopId,
      buildCanonicalPoisonPayload(shopId)
    );
    const validId = await insertOrdersCreateEvent(
      shopId,
      buildValidOrderPayload(shopId)
    );

    // ---- the poison event N ----
    // (console.error is globally mocked in tests/setup/jest.shared.js; spy on it
    //  to prove the loud [PROJECTION_EVENT_QUARANTINED] signal is emitted.)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const first = await advanceToEvent(poisonId);
    expect(first).toEqual({
      status: 'quarantined',
      domainEventId: poisonId,
      errorTag: 'CANONICAL_ORDER_TOTAL_MISSING',
    });
    expect(errSpy).toHaveBeenCalledWith(
      '[PROJECTION_EVENT_QUARANTINED]',
      expect.objectContaining({
        domain_event_id: poisonId,
        shop_id: shopId,
        event_type: 'orders/create',
        tag: 'CANONICAL_ORDER_TOTAL_MISSING',
      })
    );
    errSpy.mockRestore();

    // poison event produced no projection writes
    const orderCountAfterPoison = await withTenant(shopId, (trx) =>
      trx('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first()
    );
    expect(Number(orderCountAfterPoison?.count ?? 0)).toBe(0);

    const snapshotAfterPoison = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(snapshotAfterPoison).toBeUndefined();

    // exactly one durable failure row, recorded correctly
    const failures = await withTenant(shopId, (trx) =>
      trx('domain_event_projection_failures').where({ domain_event_id: poisonId })
    );
    expect(failures).toHaveLength(1);
    expect(Number(failures[0].domain_event_id)).toBe(poisonId); // bigint → string from pg
    expect(failures[0]).toMatchObject({
      shop_id: shopId,
      event_type: 'orders/create',
      error_tag: 'CANONICAL_ORDER_TOTAL_MISSING',
    });
    expect(String(failures[0].error_message)).toContain('totalPrice missing');
    expect(new Date(failures[0].failed_at).getTime()).toBeGreaterThan(
      Date.now() - 5 * 60 * 1000
    );

    // cursor advanced past the poison event, atomically with the failure row
    expect(await readCursor()).toBe(poisonId);

    // ---- the valid event N+1 projects normally ----
    const second = await advanceToEvent(validId);
    expect(second).toEqual({ status: 'projected', domainEventId: validId });

    const orderCountAfterValid = await withTenant(shopId, (trx) =>
      trx('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first()
    );
    expect(Number(orderCountAfterValid?.count ?? 0)).toBe(1);

    expect(await readCursor()).toBe(validId);
  }, 60000);

  it('CASE D — a pre-existing failure row is not rewritten (ON CONFLICT IGNORE)', async () => {
    const shopDomain = `stall08-preexist-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);

    const poisonId = await insertOrdersCreateEvent(
      shopId,
      buildCanonicalPoisonPayload(shopId)
    );

    // A failure row for the SAME event already exists, with recognisable values.
    const sentinelFailedAt = new Date('2020-01-02T03:04:05.000Z');
    await withTenant(shopId, (trx) =>
      trx('domain_event_projection_failures').insert({
        domain_event_id: poisonId,
        shop_id: shopId,
        event_type: 'orders/create',
        error_tag: 'PREEXISTING_SENTINEL_TAG',
        error_message: 'preexisting sentinel message',
        failed_at: sentinelFailedAt,
      })
    );

    const result = await advanceToEvent(poisonId);
    expect(result).toEqual({
      status: 'quarantined',
      domainEventId: poisonId,
      errorTag: 'CANONICAL_ORDER_TOTAL_MISSING',
    });
    expect(await readCursor()).toBe(poisonId);

    const failures = await withTenant(shopId, (trx) =>
      trx('domain_event_projection_failures').where({ domain_event_id: poisonId })
    );
    expect(failures).toHaveLength(1);
    // pre-existing row untouched — ON CONFLICT (domain_event_id) DO NOTHING
    expect(failures[0].error_tag).toBe('PREEXISTING_SENTINEL_TAG');
    expect(failures[0].error_message).toBe('preexisting sentinel message');
    expect(new Date(failures[0].failed_at).toISOString()).toBe(
      sentinelFailedAt.toISOString()
    );
  }, 60000);

  it('CASE B — concurrent seam calls on the same poison event: one failure row, cursor advances once', async () => {
    const shopDomain = `stall08-concurrent-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);

    const poisonId = await insertOrdersCreateEvent(
      shopId,
      buildCanonicalPoisonPayload(shopId)
    );
    // make the poison event the immediate head for BOTH concurrent calls
    await drainUpTo(poisonId);
    expect(await readCursor()).toBe(poisonId - 1);

    const [a, b] = await Promise.all([
      processNextProjectionEventOnce(),
      processNextProjectionEventOnce(),
    ]);

    // both resolve; neither rejects because the other won
    for (const r of [a, b]) {
      expect(['quarantined', 'skipped', 'noop', 'idle']).toContain(r.status);
    }
    // at least one observed the quarantine of this exact event
    expect(
      [a, b].some(
        (r) => r.status === 'quarantined' && r.domainEventId === poisonId
      )
    ).toBe(true);

    // final DB truth
    const failures = await withTenant(shopId, (trx) =>
      trx('domain_event_projection_failures').where({ domain_event_id: poisonId })
    );
    expect(failures).toHaveLength(1);
    expect(await readCursor()).toBe(poisonId);

    const orderCount = await withTenant(shopId, (trx) =>
      trx('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first()
    );
    expect(Number(orderCount?.count ?? 0)).toBe(0);
  }, 60000);

  it('CASE E — recordCanonicalQuarantineAndAdvance: failure row + cursor advance are one atomic unit', async () => {
    const shopDomain = `stall08-atomic-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);

    // A real domain_events row so the cursor can legitimately advance to it
    // without tripping the cursor-invariant guard on later seam calls.
    const eventId = await insertOrdersCreateEvent(
      shopId,
      buildCanonicalPoisonPayload(shopId)
    );
    await drainUpTo(eventId);
    const cursorBefore = await readCursor();
    expect(cursorBefore).toBe(eventId - 1);

    const err = new CanonicalContractError(
      'CANONICAL_ORDER_TOTAL_MISSING',
      '[CANONICAL_ORDER] totalPrice missing'
    );

    // 1. The production helper runs, then the caller's transaction is rolled
    //    back by a TEST-OWNED throw. No production fault hook involved.
    await expect(
      runWithTenantContext(shopId, () =>
        db.transaction(async (trx) => {
          await setTenantContext(trx, shopId);
          await trx('projection_cursors')
            .where({ projection_name: 'orders_projection' })
            .forUpdate()
            .first();

          await recordCanonicalQuarantineAndAdvance(trx, {
            domainEventId: eventId,
            shopId,
            eventType: 'orders/create',
            error: err,
          });

          throw new Error('TEST_FORCE_RECOVERY_ROLLBACK');
        })
      )
    ).rejects.toThrow('TEST_FORCE_RECOVERY_ROLLBACK');

    // rollback took BOTH writes with it
    const failuresAfterRollback = await withTenant(shopId, (trx) =>
      trx('domain_event_projection_failures').where({ domain_event_id: eventId })
    );
    expect(failuresAfterRollback).toHaveLength(0);
    expect(await readCursor()).toBe(cursorBefore);

    // 2. Same helper, committed transaction.
    await runWithTenantContext(shopId, () =>
      db.transaction(async (trx) => {
        await setTenantContext(trx, shopId);
        await trx('projection_cursors')
          .where({ projection_name: 'orders_projection' })
          .forUpdate()
          .first();

        await recordCanonicalQuarantineAndAdvance(trx, {
          domainEventId: eventId,
          shopId,
          eventType: 'orders/create',
          error: err,
        });
      })
    );

    const failuresAfterCommit = await withTenant(shopId, (trx) =>
      trx('domain_event_projection_failures').where({ domain_event_id: eventId })
    );
    expect(failuresAfterCommit).toHaveLength(1);
    expect(await readCursor()).toBe(eventId);
  }, 60000);

  it('CASE C — a non-canonical handler failure still halts the worker (typed, narrow boundary)', async () => {
    const shopDomain = `stall08-noncanon-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);

    // Mapper-valid payload, but a line item references a variant with no
    // external_product_identity_map row → handleOrdersCreate throws a plain
    // Error('[ORDER_LINE_ITEM_VARIANT_IDENTITY_MISSING] ...').
    const eventId = await insertOrdersCreateEvent(shopId, {
      id: `${shopId}${Date.now()}`,
      currency: 'USD',
      total_price: 10,
      subtotal_price: 10,
      total_tax: 0,
      line_items: [{ variant_id: '999999', quantity: 1, price: '5.00' }],
    });
    await drainUpTo(eventId);
    const cursorBefore = await readCursor();
    expect(cursorBefore).toBe(eventId - 1);

    let caught: unknown;
    try {
      await processNextProjectionEventOnce();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(CanonicalContractError);
    expect(String((caught as Error).message)).toContain(
      'ORDER_LINE_ITEM_VARIANT_IDENTITY_MISSING'
    );

    // fail-hard: cursor unchanged, no quarantine row, no partial order state
    expect(await readCursor()).toBe(cursorBefore);

    const failures = await withTenant(shopId, (trx) =>
      trx('domain_event_projection_failures').where({ domain_event_id: eventId })
    );
    expect(failures).toHaveLength(0);

    const orderCount = await withTenant(shopId, (trx) =>
      trx('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first()
    );
    expect(Number(orderCount?.count ?? 0)).toBe(0);
  }, 60000);
});
