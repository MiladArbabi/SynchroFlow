// tests/integration/lifecycle/manual-recovery-from-failed.test.ts
//
// SHOP-REVIEW-MANUAL-SYNC-CANONICAL-PATH-07 — backend integration.
//
// Manual recovery for an integration stuck at sync_status='FAILED' must drive
// the CANONICAL apps/backend performInitialSync, which walks the DB-enforced
// state machine (FAILED -> SYNCING_PRODUCTS -> SYNCING_ORDERS -> COMPLETED) and
// emits integration/sync_completed atomically via updateIntegrationStatus.
//
// The previously mis-wired backend-core stub wrote sync_status='COMPLETED'
// directly, which the enforce_sync_status_transition trigger rejects from
// FAILED ("Illegal sync_status transition: FAILED -> COMPLETED").
//
// This test starts from FAILED and asserts a clean COMPLETED. Because the DB
// trigger remains enabled and would reject a direct FAILED -> COMPLETED edge,
// a successful COMPLETED here is itself proof the function used the legal
// progression and never attempted the forbidden edge.
//
// Refund-backfill isolation and the deterministic zero-entity Shopify client
// mirror tests/integration/lifecycle/zero-product-initial-sync.test.ts.

jest.mock('api-src/services/shopify/shopifyRefundBackfill.service', () => ({
  backfillShopifyRefunds: jest
    .fn()
    .mockResolvedValue({ shopId: 0, refundsBackfilled: 0 }),
}));

import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { performInitialSync } from 'api-src/services/shopify.service';

const app = createApp();

/** Fresh HMAC install — same pattern as zero-product-initial-sync.test.ts. */
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

/**
 * Offline integrations fixture seeded directly at sync_status='FAILED' — the
 * exact stuck state manual recovery must resolve (mirrors shop 5 / integration
 * 2). INSERT is not covered by the enforce_sync_status_transition trigger
 * (migration 0024, BEFORE UPDATE), so seeding this state is valid; it is NOT a
 * status mutation and does not prepare an illegal edge.
 */
async function insertFailedIntegration(shopId: number, shopDomain: string) {
  const [row] = await withTenant(shopId, (trx) =>
    trx('integrations')
      .insert({
        shop_id: shopId,
        platform: 'shopify',
        platform_shop_name: shopDomain,
        access_token_encrypted: 'offline-test-token-no-network-call',
        sync_status: 'FAILED',
        sync_last_error: "Cannot read properties of undefined (reading 'node')",
        updated_at: new Date(),
      })
      .returning(['id'])
  );
  return row.id as number;
}

/** Deterministic zero-entity Shopify responses for every query the sync issues. */
function makeEmptyStoreClient() {
  return {
    request: jest.fn(async (query: string) => {
      if (query.includes('orders(')) {
        return {
          data: {
            orders: {
              edges: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }
      return {
        data: {
          products: { edges: [] },
          shop: {
            id: 'gid://shopify/Shop/1',
            name: 'X',
            email: 'x@example.com',
            currencyCode: 'USD',
          },
        },
      };
    }),
  };
}

describe('SHOP-REVIEW-MANUAL-SYNC-CANONICAL-PATH-07 — manual recovery from FAILED', () => {
  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET =
      process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
    process.env.SHOPIFY_API_KEY =
      process.env.SHOPIFY_API_KEY || 'test_shopify_key';
    process.env.API_URL = process.env.API_URL || 'https://api.test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  });

  it('canonical performInitialSync recovers a FAILED integration to COMPLETED via the legal state machine', async () => {
    const shopDomain = `manual-recovery-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);

    // Refund-backfill poll short-circuit (infra / RLS-exempt table -> systemQuery).
    await systemQuery(
      db('projection_cursors')
        .insert({
          projection_name: 'orders_projection',
          last_processed_event_id: '9223372036854775807',
        })
        .onConflict('projection_name')
        .ignore()
    );

    const integrationId = await insertFailedIntegration(shopId, shopDomain);

    // Precondition: genuinely starts FAILED.
    const before = await withTenant(shopId, (trx) =>
      trx('integrations').where({ id: integrationId, shop_id: shopId }).first()
    );
    expect(before.sync_status).toBe('FAILED');

    const shopifyClient = makeEmptyStoreClient();

    // Canonical owner, invoked directly with the -06 seam. Must NOT throw
    // "Illegal sync_status transition: FAILED -> COMPLETED".
    await expect(
      performInitialSync('test-token', shopDomain, shopId, integrationId, {
        shopifyClient,
      })
    ).resolves.toBeUndefined();

    // --- integration terminal state ---
    const integration = await withTenant(shopId, (trx) =>
      trx('integrations').where({ id: integrationId, shop_id: shopId }).first()
    );
    expect(integration.sync_status).toBe('COMPLETED');
    expect(integration.sync_last_error).toBeNull();
    expect(Number(integration.sync_progress_current)).toBe(0);
    expect(Number(integration.sync_progress_total)).toBe(0);

    // --- zero entity writes (fixture-scoped) ---
    const countFor = async (table: string) => {
      const row = await withTenant(shopId, (trx) =>
        trx(table)
          .where({ shop_id: shopId })
          .count<{ count: string }>('* as count')
          .first()
      );
      return Number(row?.count ?? 0);
    };
    expect(await countFor('products')).toBe(0);
    expect(await countFor('variants')).toBe(0);
    expect(await countFor('external_product_identity_map')).toBe(0);
    expect(await countFor('inventory_movements')).toBe(0);
    expect(await countFor('inventory_truth')).toBe(0);
    expect(await countFor('orders')).toBe(0);
    expect(await countFor('customers')).toBe(0);

    // --- exactly one authoritative completion event + its owned outbox row ---
    const completedEvents = await withTenant(shopId, (trx) =>
      trx('domain_events')
        .where({ shop_id: shopId, event_type: 'integration/sync_completed' })
        .select('id')
    );
    expect(completedEvents).toHaveLength(1);

    const outboxRows = await withTenant(shopId, (trx) =>
      trx('domain_event_outbox')
        .where({ domain_event_id: completedEvents[0].id })
        .select('id')
    );
    expect(outboxRows).toHaveLength(1);

    // --- no fake order/product ingestion events ---
    const ingestionEvents = await withTenant(shopId, (trx) =>
      trx('domain_events')
        .where({ shop_id: shopId })
        .whereIn('event_type', ['orders/create', 'orders/sync', 'products/create'])
        .select('id')
    );
    expect(ingestionEvents).toHaveLength(0);
  }, 60000);
});
