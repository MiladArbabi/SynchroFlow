// tests/integration/lifecycle/zero-product-initial-sync.test.ts
//
// SHOP-REVIEW-ZERO-PRODUCT-SYNC-06 — T5.
//
// End-to-end proof, against a real disposable Postgres DB, that the REAL
// performInitialSync reaches an authoritative COMPLETED for a genuinely empty
// Shopify store (zero products, zero orders) — exercising both fixed root
// causes (A: seedShopifyOpeningBalances first-edge probe; B: paginateShopify
// empty terminal page) — with zero entity writes and exactly one
// integration/sync_completed domain event + its owned outbox row.
//
// The only seam used is the approved optional `deps.shopifyClient` on
// performInitialSync — no NODE_ENV branch, no production caller changes.
//
// The post-completion refund backfill (a fire-and-forget, non-fatal side
// effect that runs AFTER sync_status = COMPLETED) is mocked so this test does
// not poll for 60s / attempt a provider REST call. Webhook registration
// is also mocked because this fixture now contains canonical credentials
// and must never contact the Shopify provider.

jest.mock('api-src/services/shopify/shopifyWebhook.service', () => ({
  registerWebhooksForShop: jest.fn().mockResolvedValue(undefined),
}));

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
import { seedOfflineShopifySyncAuthority } from './shopify-sync-authority.fixture';

const app = createApp();

afterAll(async () => {
  await db.destroy();
});

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

/**
 * Offline pre-sync integrations fixture. INSERT is not covered by the
 * integrations_sync_transition_guard trigger (migration 0024, BEFORE UPDATE),
 * so seeding directly is valid. 'PENDING' is the earliest legal pre-sync
 * status and the column default; performInitialSync then drives the real
 * PENDING -> SYNCING_PRODUCTS -> SYNCING_ORDERS -> COMPLETED path.
 */
async function insertPendingIntegration(shopId: number, shopDomain: string) {
  const [row] = await withTenant(shopId, (trx) =>
    trx('integrations')
      .insert({
        shop_id: shopId,
        platform: 'shopify',
        platform_shop_name: shopDomain,
        sync_status: 'PENDING',
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
      // GET_PRODUCTS_QUERY and the opening-balance products query
      return {
        data: {
          products: {
            edges: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
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

describe('SHOP-REVIEW-ZERO-PRODUCT-SYNC-06 — zero-product / zero-order performInitialSync', () => {
  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET =
      process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
    process.env.SHOPIFY_API_KEY =
      process.env.SHOPIFY_API_KEY || 'test_shopify_key';
    process.env.API_URL = process.env.API_URL || 'https://api.test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  });

  it('reaches authoritative COMPLETED with zero writes and exactly one sync_completed event', async () => {
    const shopDomain = `zero-product-sync-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);

    // Refund-backfill poll short-circuit: mark the orders projection cursor as
    // already ahead of anything this test will emit (infra table, INSERT is
    // unguarded; the monotonic trigger is BEFORE UPDATE only).
    await systemQuery(
      db('projection_cursors')
        .insert({
          projection_name: 'orders_projection',
          last_processed_event_id: '9223372036854775807',
        })
        .onConflict('projection_name')
        .ignore()
    );

    const integrationId = await insertPendingIntegration(shopId, shopDomain);
    const shopifyClient = makeEmptyStoreClient();
    const executionAuthority =
      await seedOfflineShopifySyncAuthority(shopId, shopDomain);

    await performInitialSync('test-token', shopDomain, shopId, integrationId, {
      shopifyClient,
      executionAuthority,
    });

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
        trx(table).where({ shop_id: shopId }).count<{ count: string }>('* as count').first()
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

    // --- exactly one authoritative completion event, no sync_requested ---
    const completedEvents = await withTenant(shopId, (trx) =>
      trx('domain_events')
        .where({ shop_id: shopId, event_type: 'integration/sync_completed' })
        .select('id')
    );
    expect(completedEvents).toHaveLength(1);

    const requestedEvents = await withTenant(shopId, (trx) =>
      trx('domain_events')
        .where({ shop_id: shopId, event_type: 'integration/sync_requested' })
        .select('id')
    );
    expect(requestedEvents).toHaveLength(0);

    // --- exactly one owned outbox row for that event ---
    const outboxRows = await withTenant(shopId, (trx) =>
      trx('domain_event_outbox')
        .where({ domain_event_id: completedEvents[0].id })
        .select('id')
    );
    expect(outboxRows).toHaveLength(1);

    // --- no order-ingestion events leaked from the empty terminal page ---
    const orderEvents = await withTenant(shopId, (trx) =>
      trx('domain_events')
        .where({ shop_id: shopId })
        .whereIn('event_type', ['orders/create', 'orders/sync'])
        .select('id')
    );
    expect(orderEvents).toHaveLength(0);
  }, 60000);
});
