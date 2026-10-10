/**
 * SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02, Slice 1.
 *
 * A genuinely fresh Shopify merchant with zero products/variants/orders/
 * inventory (one warehouse root, zero bins) must be able to leave implicit
 * FT_MINUS_ONE once sync completes — orders/create never fires for a
 * zero-order store, so nothing in the pre-existing chain ever advances
 * lifecycle for it. See docs/playbooks/lifecycle_playbook.md §2a.
 *
 * Ladder driven here, real code throughout — no manually hand-inserted
 * completion event as the sole proof (that would only prove the handler,
 * not the emitter/durability contract):
 *
 *   install (HMAC)              -> shop, ghost owner, WH-{shopId}-ROOT, zero bins
 *   integrations row (PENDING)  -> hand-inserted (offline fixture — the real
 *                                   OAuth callback cannot run offline; same
 *                                   justification as fresh-install-release-path)
 *   updateIntegrationStatus     -> REAL call, drives the atomic
 *                                   integration/sync_completed emission
 *   integration/sync_completed  -> lifecycle.sync_completed handler
 *   FT_MINUS_ONE -> FT0 -> FT1  -> via the shared FT0/FT1 materializer
 *
 * Uses the exact same fixture/tenant/event-pumping conventions as
 * fresh-install-release-path.test.ts — no dev_seed, no shared shop_id=1,
 * every shop created fresh per test via the real HMAC install endpoint.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { updateIntegrationStatus } from 'api-src/services/shopify/shopifyIntegrationStatus.service';

const app = createApp();

/** Drains every unprocessed domain event for the shop, oldest first. */
async function pumpEvents(shopId: number, afterId = 0) {
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

/** Fresh HMAC install — same pattern as fresh-install-release-path.test.ts. */
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

/** Hand-inserts an integrations row mid-sync — the OAuth callback cannot
 *  run offline, so this offline fixture mirrors fresh-install-release-
 *  path's own precedent. Status is intentionally NOT 'COMPLETED' — that
 *  transition is driven for real via updateIntegrationStatus below.
 *
 *  MECHANICAL FIXTURE CORRECTION: an initial insert of 'PENDING' is
 *  rejected by the integrations_sync_transition_guard trigger
 *  (migration 0024) when updateIntegrationStatus later tries to move it
 *  to 'COMPLETED' — PENDING -> COMPLETED is not a legal direct
 *  transition. 'SYNCING_ORDERS' -> 'COMPLETED' is (the same edge the
 *  real sync orchestrator uses), so the fixture starts there instead.
 *  The insert itself (unlike UPDATE) is not guarded by the trigger, so
 *  seeding directly into this state is the correct, minimal fixture. */
async function insertPendingIntegration(shopId: number, shopDomain: string) {
  const [row] = await withTenant(shopId, (trx) =>
    trx('integrations')
      .insert({
        shop_id: shopId,
        platform: 'shopify',
        platform_shop_name: shopDomain,
        sync_status: 'SYNCING_ORDERS',
        updated_at: new Date(),
      })
      .returning(['id'])
  );
  return row.id as number;
}

/**
 * Inserts a raw `orders` row directly — bypassing the orders/create
 * projection handler entirely. This is the narrowest deterministic
 * fixture for "the orders table has ≥1 row" independent of "the
 * orders.create lifecycle projection has run": in the real system the
 * two facts are normally produced by the same handler in one step
 * (lifecycle anchoring happens BEFORE the INSERT INTO orders in that
 * handler's own body), so there is no way to reach "row present,
 * projection not yet processed" by running a real orders/create event
 * through processDomainEvent — the anchoring would already have
 * happened as part of that same call. Isolating the raw fact this way
 * exercises exactly the condition integration.sync_completed.ts's own
 * guard checks (a live COUNT(*) on `orders`), without misrepresenting
 * how the row actually gets there in production.
 */
async function rawInsertOrder(shopId: number) {
  const lasyncroOrderId = crypto.randomUUID();
  const now = new Date();
  await withTenant(shopId, (trx) =>
    trx('orders').insert({
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      currency: 'USD',
      total_price: 10,
      subtotal_price: 10,
      total_tax: 0,
      order_created_at: now,
      order_updated_at: now,
      payment_state: 'unpaid',
      aggregate_version: 1,
      created_at: now,
      updated_at: now,
    })
  );
  return lasyncroOrderId;
}

describe('SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02 — zero-order sync completion', () => {
  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
    process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
    process.env.API_URL = process.env.API_URL || 'https://api.test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  });

  it('CASE 1 — authoritative zero-order completion reaches FT1, anchored to the founding owner', async () => {
    const shopDomain = `zero-order-test-${Date.now()}.myshopify.com`;
    const { shopId, ghostUser } = await installFreshShop(shopDomain);

    const preSnapshot = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(preSnapshot).toBeUndefined();

    const integrationId = await insertPendingIntegration(shopId, shopDomain);

    // Drive the REAL emitter — proves the emission contract, not just the handler.
    await updateIntegrationStatus({
      integrationId,
      shopId,
      status: 'COMPLETED',
      error: null,
    });

    const integration = await withTenant(shopId, (trx) =>
      trx('integrations').where({ id: integrationId }).first()
    );
    expect(integration.sync_status).toBe('COMPLETED');
    expect(integration.sync_last_error).toBeNull();

    const completionEvent = await withTenant(shopId, (trx) =>
      trx('domain_events')
        .where({ shop_id: shopId, event_type: 'integration/sync_completed' })
        .first()
    );
    expect(completionEvent).toBeDefined();

    const outboxRow = await withTenant(shopId, (trx) =>
      trx('domain_event_outbox').where({ domain_event_id: completionEvent.id }).first()
    );
    expect(outboxRow).toBeDefined();

    await pumpEvents(shopId);

    const atFt1 = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(atFt1?.phase).toBe('FT1');
    expect(atFt1?.user_id).toBe(ghostUser.id);

    const ft0State = await withTenant(shopId, (trx) =>
      trx('ft0_state').where({ shop_id: shopId }).first()
    );
    expect(ft0State).toBeDefined();

    const readiness = await withTenant(shopId, (trx) =>
      trx('system_readiness_state').where({ shop_id: shopId }).first()
    );
    expect(readiness).toBeDefined();

    const firstInsightEvent = await withTenant(shopId, (trx) =>
      trx('domain_events')
        .where({ shop_id: shopId, event_type: 'lifecycle/first_insight_delivered' })
        .first()
    );
    expect(firstInsightEvent).toBeUndefined();
  }, 60000);

  it('CASE 2 — PCD-fallback-shaped completion must not emit sync_completed', async () => {
    const shopDomain = `zero-order-pcd-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);

    const integrationId = await insertPendingIntegration(shopId, shopDomain);

    // Direct write mirroring shopify-fallback.service.ts's own pattern —
    // bypasses updateIntegrationStatus entirely, exactly as the real
    // PCD-fallback path does.
    await withTenant(shopId, (trx) =>
      trx('integrations').where({ id: integrationId, shop_id: shopId }).update({
        sync_status: 'COMPLETED',
        sync_last_error: 'PCD access required for orders and customers',
      })
    );

    await pumpEvents(shopId);

    const completionEvent = await withTenant(shopId, (trx) =>
      trx('domain_events')
        .where({ shop_id: shopId, event_type: 'integration/sync_completed' })
        .first()
    );
    expect(completionEvent).toBeUndefined();

    const snapshot = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(snapshot).toBeUndefined();

    const phaseRes = await request(app)
      .get('/api/v1/lifecycle')
      .set(
        'Authorization',
        `Bearer ${await issueTokenFor(shopId)}`
      );
    expect(phaseRes.body.phase).toBe('FT_MINUS_ONE');
  }, 60000);

  it('CASE 3 — duplicate completion is a no-op once FT1 is reached', async () => {
    const shopDomain = `zero-order-dup-${Date.now()}.myshopify.com`;
    const { shopId, ghostUser } = await installFreshShop(shopDomain);
    const integrationId = await insertPendingIntegration(shopId, shopDomain);

    await updateIntegrationStatus({ integrationId, shopId, status: 'COMPLETED', error: null });
    let cursor = await pumpEvents(shopId);

    const afterFirst = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(afterFirst?.phase).toBe('FT1');

    // A second legitimate completion for the same shop (e.g. a resync) —
    // recurring by design, not deduplicated at the producer.
    await updateIntegrationStatus({ integrationId, shopId, status: 'COMPLETED', error: null });
    cursor = await pumpEvents(shopId, cursor);

    const snapshots = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId })
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].phase).toBe('FT1');
    expect(snapshots[0].user_id).toBe(ghostUser.id);
  }, 60000);

  it('CASE 4a — snapshot already anchored: sync_completed handler no-ops', async () => {
    const shopDomain = `zero-order-race-anchored-${Date.now()}.myshopify.com`;
    const { shopId, ghostUser } = await installFreshShop(shopDomain);
    const integrationId = await insertPendingIntegration(shopId, shopDomain);

    // The real order is inserted and pumped FIRST — domain_events.id
    // ordering is what pumpEvents drains by, so this deterministically
    // constructs "order arrives, and the orders.create projection has
    // already anchored the snapshot before the completion event is ever
    // drained" rather than relying on timing.
    await withTenant(shopId, (trx) =>
      trx('domain_events').insert({
        shop_id: shopId,
        event_type: 'orders/create',
        event_payload: buildMinimalOrderPayload(shopId),
        event_time: new Date(),
        event_version: 1,
        external_event_id: `test:orders/create:${shopId}:${Date.now()}`,
      })
    );

    const cursorAfterOrder = await pumpEvents(shopId);

    const afterOrder = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(afterOrder?.phase).toBe('FT0');
    expect(afterOrder?.user_id).toBe(ghostUser.id);

    // NOW the completion event is emitted and drained — the new handler
    // must see the snapshot orders.create already anchored and no-op.
    await updateIntegrationStatus({ integrationId, shopId, status: 'COMPLETED', error: null });
    await pumpEvents(shopId, cursorAfterOrder);

    const snapshots = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId })
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].user_id).toBe(ghostUser.id);
  }, 60000);

  it('CASE 4b — snapshot absent but live orders > 0: handler no-ops on the order-count guard, not the snapshot guard, then orders.create owns FT0', async () => {
    const shopDomain = `zero-order-race-ordercount-${Date.now()}.myshopify.com`;
    const { shopId, ghostUser } = await installFreshShop(shopDomain);
    const integrationId = await insertPendingIntegration(shopId, shopDomain);

    // 1. An order ROW exists (raw insert — see rawInsertOrder's header for
    //    why a real orders/create event can't produce this state alone),
    //    but no lifecycle snapshot exists yet, and no orders.create event
    //    has been queued or processed at all.
    await rawInsertOrder(shopId);

    const preSnapshot = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(preSnapshot).toBeUndefined();

    const preOrderCount = await withTenant(shopId, (trx) =>
      trx('orders').where({ shop_id: shopId }).count<{ count: string }>('* as count').first()
    );
    expect(Number(preOrderCount?.count ?? 0)).toBeGreaterThan(0);

    // 2. Emit and process integration/sync_completed while BOTH hold:
    //    snapshot absent AND live orders count > 0.
    await updateIntegrationStatus({ integrationId, shopId, status: 'COMPLETED', error: null });
    const cursorAfterCompletion = await pumpEvents(shopId);

    // 3. Prove the zero-order materializer did NOT run — no-opped on the
    //    order-count guard, not the (absent) snapshot guard.
    const afterCompletion = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(afterCompletion).toBeUndefined();

    const ft0StateAfterCompletion = await withTenant(shopId, (trx) =>
      trx('ft0_state').where({ shop_id: shopId }).first()
    );
    expect(ft0StateAfterCompletion).toBeUndefined();

    const readinessAfterCompletion = await withTenant(shopId, (trx) =>
      trx('system_readiness_state').where({ shop_id: shopId }).first()
    );
    expect(readinessAfterCompletion).toBeUndefined();

    // 4. Now queue and process a real orders/create event — the
    //    pre-existing INGESTION-DRIVEN path must still own FT0 entry.
    await withTenant(shopId, (trx) =>
      trx('domain_events').insert({
        shop_id: shopId,
        event_type: 'orders/create',
        event_payload: buildMinimalOrderPayload(shopId),
        event_time: new Date(),
        event_version: 1,
        external_event_id: `test:orders/create:${shopId}:${Date.now()}`,
      })
    );

    await pumpEvents(shopId, cursorAfterCompletion);

    const afterOrdersCreate = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(afterOrdersCreate?.phase).toBe('FT0');
    expect(afterOrdersCreate?.user_id).toBe(ghostUser.id);

    const snapshots = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId })
    );
    expect(snapshots).toHaveLength(1);
  }, 60000);

  it('CASE 5 — a real order after zero-order FT1 ingests without lifecycle regression', async () => {
    const shopDomain = `zero-order-then-order-${Date.now()}.myshopify.com`;
    const { shopId, ghostUser } = await installFreshShop(shopDomain);
    const integrationId = await insertPendingIntegration(shopId, shopDomain);

    await updateIntegrationStatus({ integrationId, shopId, status: 'COMPLETED', error: null });
    let cursor = await pumpEvents(shopId);

    const atFt1 = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(atFt1?.phase).toBe('FT1');

    // First real order arrives after the zero-order path already reached FT1.
    await withTenant(shopId, (trx) =>
      trx('domain_events').insert({
        shop_id: shopId,
        event_type: 'orders/create',
        event_payload: buildMinimalOrderPayload(shopId),
        event_time: new Date(),
        event_version: 1,
        external_event_id: `test:orders/create:${shopId}:${Date.now()}`,
      })
    );

    await expect(pumpEvents(shopId, cursor)).resolves.not.toThrow();

    const order = await withTenant(shopId, (trx) =>
      trx('orders').where({ shop_id: shopId }).first()
    );
    expect(order).toBeDefined();

    const snapshots = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId })
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].user_id).toBe(ghostUser.id);
    // Lifecycle must not regress below where it already was.
    expect(['FT1', 'FT2']).toContain(snapshots[0].phase);
  }, 60000);

  it('CASE 6 — multi-member shop anchors to the canonical earliest owner, not iteration order', async () => {
    const shopDomain = `zero-order-multimember-${Date.now()}.myshopify.com`;
    const { shopId, ghostUser } = await installFreshShop(shopDomain);

    // A second owner-role member, added AFTER the founding (ghost) owner.
    // If lifecycle anchoring ever regressed to iterating shop_memberships
    // without the canonical created_at/id ordering, this member — added
    // later but potentially returned first by an unordered query — would
    // wrongly become the anchor.
    const [laterOwner] = await withTenant(shopId, (trx) =>
      trx('users')
        .insert({
          shop_id: shopId,
          email: `later-owner-${Date.now()}@example.com`,
          password_hash: 'test-hash',
        })
        .returning(['id'])
    );

    await withTenant(shopId, (trx) =>
      trx('shop_memberships').insert({
        shop_id: shopId,
        user_id: laterOwner.id,
        role: 'owner',
        created_at: new Date(Date.now() + 60_000), // strictly later
      })
    );

    const integrationId = await insertPendingIntegration(shopId, shopDomain);
    await updateIntegrationStatus({ integrationId, shopId, status: 'COMPLETED', error: null });
    await pumpEvents(shopId);

    const atFt1 = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(atFt1?.phase).toBe('FT1');
    expect(atFt1?.user_id).toBe(ghostUser.id);
    expect(atFt1?.user_id).not.toBe(laterOwner.id);
  }, 60000);
});

async function issueTokenFor(shopId: number) {
  const { issueTestToken } = await import('../../unit/helpers/auth');
  const owner = await withTenant(shopId, (trx) =>
    trx('shop_memberships').where({ shop_id: shopId, role: 'owner' }).first('user_id')
  );
  return issueTestToken({ userId: owner.user_id, shopId });
}

/** Minimal payload shape mapShopifyOrderNodeToCanonical accepts — flat
 *  snake_case fields, per its own fallback chains (shopify-to-canonical-
 *  order.ts). projection.engine.ts derives canonical_payload from this
 *  raw event_payload at projection time, before handleOrdersCreate runs. */
function buildMinimalOrderPayload(shopId: number) {
  const n = Date.now();
  return {
    id: `${shopId}${n}`,
    currency: 'USD',
    total_price: 10,
    subtotal_price: 10,
    total_tax: 0,
    line_items: [],
  };
}
