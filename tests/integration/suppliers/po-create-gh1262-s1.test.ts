// GH-1262 S1 — Canonical PO creation (RED regression)
//
// Real-DB API contracts for the two PO creation entrypoints:
//   E1 POST /api/v1/suppliers/purchase-orders
//   E2 POST /api/v1/suppliers/reorder-requests/convert
//
// Catalog lifecycle is read from its actual representation: products.status,
// written from Shopify's product status (active / draft / unlisted / archived,
// normalizeShopifyRestProduct.ts) and soft-deleted to 'deleted' by
// handleProductDeleted.ts. Connection state is whatever
// classifyShopifyConnection derives from shopify_app_installations +
// shopify_admin_credentials.
//
// Ratified E1 wire contract (S1 RED correction brief):
//   - supplier_id XOR new_supplier {…}; both together is invalid
//   - Idempotency-Key header is REQUIRED and tenant-scoped
//   - same key + identical request → original purchase_order (200/201)
//   - same key + different request → 409, original PO unchanged
//   - response envelope stays { purchase_order }
// The reorder-conversion transport (E2) is unchanged: no key is sent there.
//
// Causality (C1): a rejection only counts when it is a business rejection —
// not 401/403, not an auth/entitlement code, not an idempotency complaint —
// and the SAME fixture accepts the corrected request immediately afterwards.
// Error-message wording and exact business status codes are not ratified, so
// neither is asserted beyond that.
//
// Environment (C7): credential fixtures need ENCRYPTION_KEY. The disposable
// harness (scripts/with-test-db.js) provides a synthetic key; otherwise this
// suite falls back to a synthetic test-only key and restores the prior value,
// following stow-shopify-push-trigger-contract.test.ts. No root .env is read.
//
// Isolation: the suite refuses to run unless the disposable harness marked
// the target (SYNCHROFLOW_DISPOSABLE_TEST_DB=1, synchroflow_test_* database).
// Safe pre-import environment setup and outbound-network isolation are the
// verified test runner's responsibility, not this file's; the Shopify client
// mock below is a regression assertion, not the network boundary.

const mockRequest = jest.fn();
const mockCreateShopifyGraphQLClient = jest.fn(() => ({ request: mockRequest }));

jest.mock('api-src/services/shopify/shopifyClient.service', () => ({
  createShopifyGraphQLClient: (...args: any[]) => mockCreateShopifyGraphQLClient(...args),
}));

import crypto from 'crypto';
import knexLib from 'knex';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { encrypt } from 'api-src/security/encryption.service';
import {
  SHOPIFY_REQUIRED_SCOPE_STRING,
  normalizeAndValidateShopifyGrantedScopes,
} from 'api-src/services/shopify/shopifyScopes';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

jest.setTimeout(180_000);

const PO_PATH = '/api/v1/suppliers/purchase-orders';
const CONVERT_PATH = '/api/v1/suppliers/reorder-requests/convert';
const SYNTHETIC_ENCRYPTION_KEY = 'gh1262-s1-synthetic-test-only-encryption-key-not-a-secret';

/** Auth / entitlement codes a business rejection must never be confused with. */
const ACCESS_ERRORS = [
  'MISSING_ROLES_CLAIM',
  'NO_ROLE_ASSIGNED',
  'ACTION_FORBIDDEN',
  'TIER_INSUFFICIENT',
  'COMMERCIAL_ACCESS_DENIED',
  'Unauthorized',
];

const previousEncryptionKey = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  expect(process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB).toBe('1');
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || SYNTHETIC_ENCRYPTION_KEY;
});

afterAll(() => {
  if (previousEncryptionKey === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = previousEncryptionKey;
  }
});

beforeEach(() => {
  mockRequest.mockReset();
  mockCreateShopifyGraphQLClient.mockClear();
});

// ── FIXTURES ───────────────────────────────────────────────────────────────

type Tier = 'core' | 'growth';
type Role = 'owner' | 'operator';

type Tenant = { shopId: number; ownerToken: string; ownerId: number };

async function createShop(prefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function createMember(shopId: number, role: Role): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `gh1262-s1-${role}-${crypto.randomUUID()}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'GH1262 S1',
        role,
      })
      .returning('id');

    await trx('shop_memberships').insert({ shop_id: shopId, user_id: row.id, role });
    // Lifecycle state is shop-scoped, not member-scoped.
    if (role === 'owner') {
      await trx('user_lifecycle_snapshot').insert({
        shop_id: shopId,
        user_id: row.id,
        phase: 'FT2',
        since: new Date(),
        last_event_id: crypto.randomUUID(),
      });
    }
    return row.id as number;
  });
}

/** A live installation with an ACTIVE, usable credential (CONNECTED). */
async function connectShopify(shopId: number): Promise<void> {
  await withTenant(shopId, async (trx) => {
    const [installation] = await trx('shopify_app_installations')
      .insert({
        shop_id: shopId,
        shop_domain: `gh1262-s1-${crypto.randomBytes(5).toString('hex')}.myshopify.com`,
        scopes: 'read_products',
      })
      .returning('id');

    const now = Date.now();
    await trx('shopify_admin_credentials').insert({
      shop_id: shopId,
      installation_id: installation.id,
      access_token_encrypted: encrypt('gh1262-s1-offline-token-no-network-call'),
      refresh_token_encrypted: encrypt('gh1262-s1-refresh-token-no-network-call'),
      access_expires_at: new Date(now + 86_400_000),
      refresh_expires_at: new Date(now + 2_592_000_000),
      granted_scopes: normalizeAndValidateShopifyGrantedScopes(SHOPIFY_REQUIRED_SCOPE_STRING),
      credential_generation: '1',
      credential_state: 'ACTIVE',
    });
  });
}

/**
 * Connection transitions from a previously valid installation, using the
 * same direct state transitions the existing connection suites use
 * (shopify-admin-credential-resolution-red3b.test.ts:111,
 * gh1068-t3-reconnect-executor.test.ts:441).
 */
async function requireReauth(shopId: number): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('shopify_admin_credentials').where({ shop_id: shopId }).update({ credential_state: 'REAUTH_REQUIRED' }),
  );
}

async function uninstallShopify(shopId: number): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('shopify_app_installations')
      .where({ shop_id: shopId })
      .whereNull('uninstalled_at')
      .update({ uninstalled_at: trx.fn.now() }),
  );
}

async function createTenant(prefix: string, options: { tier?: Tier } = {}): Promise<Tenant> {
  const tier = options.tier ?? 'growth';
  const shopId = await createShop(prefix);
  const ownerId = await createMember(shopId, 'owner');

  await withTenant(shopId, (trx) =>
    trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier,
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    }),
  );
  await connectShopify(shopId);

  const ownerToken = issueTestToken({ userId: ownerId, shopId, tier, roles: ['owner'] });
  return { shopId, ownerId, ownerToken };
}

async function createSupplier(shopId: number, overrides: Record<string, unknown> = {}): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('suppliers')
      .insert({
        shop_id: shopId,
        name: `GH1262 S1 Supplier ${crypto.randomUUID()}`,
        lead_time_days: 3,
        ...overrides,
      })
      .returning('id');
    return row.id as number;
  });
}

/**
 * A canonical Shopify variant: product + variant + the variant-grained
 * external identity mapping the catalog writer (shopifyProducts.core.ts)
 * creates. `productStatus` is the persisted Shopify lifecycle.
 */
async function createShopifyVariant(
  shopId: number,
  productStatus: 'active' | 'draft' | 'unlisted' | 'archived' | 'deleted' = 'active',
  identity: { externalVariantId?: string | null } = {},
): Promise<string> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: `GH1262 S1 Product ${productStatus}`,
      status: productStatus,
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `GH1262-S1-${variantId.slice(0, 8)}`,
      title: 'Default Title',
      unit_cost: '1.00',
      status: 'active',
    });
    await trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      platform: 'shopify',
      external_product_id: `gid://shopify/Product/${crypto.randomInt(1_000_000, 9_999_999)}`,
      external_variant_id: 'externalVariantId' in identity
        ? identity.externalVariantId
        : `gid://shopify/ProductVariant/${crypto.randomInt(1_000_000, 9_999_999)}`,
      external_inventory_item_id: null,
    });
  });

  return variantId;
}

function line(variantId: string, overrides: Record<string, unknown> = {}) {
  return {
    description: 'GH1262 S1 line',
    quantity_ordered: 2,
    lasyncro_variant_id: variantId,
    ...overrides,
  };
}

function newKey(): string {
  return `gh1262-s1-${crypto.randomUUID()}`;
}

/** E1 with the required Idempotency-Key; pass `null` only to omit it deliberately. */
function postPo(token: string, body: Record<string, unknown>, idempotencyKey: string | null = newKey()) {
  const req = request(app).post(PO_PATH).set({ Authorization: `Bearer ${token}` });
  if (idempotencyKey !== null) req.set('Idempotency-Key', idempotencyKey);
  return req.send(body);
}

function convert(token: string, body: Record<string, unknown>) {
  return request(app).post(CONVERT_PATH).set({ Authorization: `Bearer ${token}` }).send(body);
}

/**
 * Purchasing state scoped to one fixture shop, including its coalesced
 * shop_snapshot_jobs row (one row per shop, re-scheduled on every write by
 * enqueueShopSnapshotJob — so the row itself, not a global count, is compared).
 */
async function purchasingState(shopId: number) {
  return withTenant(shopId, async (trx) => {
    const count = async (table: string) =>
      Number((await trx(table).where({ shop_id: shopId }).count<{ count: string }[]>('* as count'))[0].count);
    const snapshotJobs = await trx('shop_snapshot_jobs').where({ shop_id: shopId }).select('*');
    return {
      suppliers: await count('suppliers'),
      purchaseOrders: await count('purchase_orders'),
      lines: await count('purchase_order_line_items'),
      idempotencyKeys: await count('purchase_order_idempotency_keys'),
      reorderRequests: await trx('reorder_requests')
        .where({ shop_id: shopId })
        .orderBy('id')
        .select('id', 'status', 'converted_po_id'),
      snapshotJobs: snapshotJobs.map((row: any) => ({ ...row })),
    };
  });
}

/** Inventory / Stow / Receive state that PO creation must never touch (R9). */
async function inventoryState(shopId: number) {
  return withTenant(shopId, async (trx) => {
    const count = async (table: string) =>
      Number((await trx(table).where({ shop_id: shopId }).count<{ count: string }[]>('* as count'))[0].count);
    return {
      inventoryMovements: await count('inventory_movements'),
      inventoryUnits: await count('inventory_units'),
      inventoryTruth: await count('inventory_truth'),
      stowTasks: await count('stow_tasks'),
      receiveJobs: await count('receive_jobs'),
    };
  });
}

/**
 * A business rejection: 4xx, not an access/entitlement denial and not an
 * idempotency-header complaint, carried in the existing { error } envelope.
 */
function expectBusinessRejection(res: request.Response) {
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  expect([401, 403]).not.toContain(res.status);
  expect(typeof res.body.error).toBe('string');
  expect(ACCESS_ERRORS).not.toContain(res.body.error);
  expect(res.body.error).not.toMatch(/idempotency/i);
}

/**
 * Rejection with causal control: the varied input is rejected with zero
 * side effects, then the SAME tenant, token and supplier accept the corrected
 * request — so the rejection cannot come from fixture, auth, entitlement or
 * header problems.
 */
async function expectCausalRejection(
  tenant: Tenant,
  rejectedBody: Record<string, unknown>,
  controlBody: Record<string, unknown>,
) {
  const before = await purchasingState(tenant.shopId);

  const rejected = await postPo(tenant.ownerToken, rejectedBody);
  expectBusinessRejection(rejected);
  expect(await purchasingState(tenant.shopId)).toEqual(before);

  const control = await postPo(tenant.ownerToken, controlBody);
  expect(control.status).toBe(201);
  expect(control.body.purchase_order.id).toEqual(expect.any(String));
}

async function queueReorder(token: string, supplierId: number, variantId: string, qty: number) {
  const res = await request(app)
    .post('/api/v1/suppliers/reorder-requests')
    .set({ Authorization: `Bearer ${token}` })
    .send({ lasyncro_variant_id: variantId, supplier_id: supplierId, qty_requested: qty, source: 'manual' });
  expect(res.status).toBe(201);
}

/** Upper bound for any single in-flight request in the concurrent cases. */
const REQUEST_DEADLINE_MS = 30_000;

// ── R1 — CANONICAL IDENTITY AND LIFECYCLE ──────────────────────────────────

describe('GH-1262 S1 R1 — canonical tenant-owned Shopify identity', () => {
  it('S1-R1-01: a foreign-tenant variant is rejected with zero side effects', async () => {
    const tenant = await createTenant('s1-r1-foreign');
    const other = await createTenant('s1-r1-other');
    const supplierId = await createSupplier(tenant.shopId);
    const ownVariant = await createShopifyVariant(tenant.shopId);
    const foreignVariant = await createShopifyVariant(other.shopId);
    const otherBefore = await purchasingState(other.shopId);

    await expectCausalRejection(
      tenant,
      { supplier_id: supplierId, line_items: [line(foreignVariant)] },
      { supplier_id: supplierId, line_items: [line(ownVariant)] },
    );
    expect(await purchasingState(other.shopId)).toEqual(otherBefore);
  });

  it.each(['archived', 'deleted'] as const)(
    'S1-R1-02: a variant of a %s product is not eligible for a new PO',
    async (status) => {
      const tenant = await createTenant(`s1-r1-${status}`);
      const supplierId = await createSupplier(tenant.shopId);
      const ineligible = await createShopifyVariant(tenant.shopId, status);
      const eligible = await createShopifyVariant(tenant.shopId, 'active');

      await expectCausalRejection(
        tenant,
        { supplier_id: supplierId, line_items: [line(ineligible)] },
        { supplier_id: supplierId, line_items: [line(eligible)] },
      );
    },
  );

  it.each(['active', 'draft', 'unlisted'] as const)(
    'S1-R1-03: a variant of a %s product is eligible and persists its canonical link',
    async (status) => {
      const tenant = await createTenant(`s1-r1-ok-${status}`);
      const supplierId = await createSupplier(tenant.shopId);
      const variantId = await createShopifyVariant(tenant.shopId, status);

      const res = await postPo(tenant.ownerToken, {
        supplier_id: supplierId,
        line_items: [line(variantId)],
      });

      expect(res.status).toBe(201);
      const lines = await withTenant(tenant.shopId, (trx) =>
        trx('purchase_order_line_items')
          .where({ po_id: res.body.purchase_order.id })
          .select('lasyncro_variant_id', 'quantity_ordered'),
      );
      expect(lines).toEqual([{ lasyncro_variant_id: variantId, quantity_ordered: 2 }]);
    },
  );

  it.each([
    ['missing', undefined],
    ['null', null],
    ['not a UUID', 'not-a-variant'],
    ['an unknown UUID', '00000000-0000-4000-8000-000000000000'],
  ])('S1-R1-04: a line whose variant identity is %s is rejected with zero side effects', async (_label, identity) => {
    const tenant = await createTenant('s1-r1-identity');
    const supplierId = await createSupplier(tenant.shopId);
    const eligible = await createShopifyVariant(tenant.shopId);

    await expectCausalRejection(
      tenant,
      {
        supplier_id: supplierId,
        line_items: [{ description: 'Unlinked line', quantity_ordered: 2, lasyncro_variant_id: identity }],
      },
      { supplier_id: supplierId, line_items: [line(eligible)] },
    );
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['not a GID', '12345'],
    ['a product-level GID', 'gid://shopify/Product/12345'],
    ['a non-canonical variant GID', 'gid://shopify/ProductVariant/0'],
  ])('S1-R1-05: a Shopify mapping whose variant identity is %s is rejected with zero side effects', async (_label, externalVariantId) => {
    const tenant = await createTenant('s1-r1-mapping');
    const supplierId = await createSupplier(tenant.shopId);
    const incomplete = await createShopifyVariant(tenant.shopId, 'active', { externalVariantId });
    const eligible = await createShopifyVariant(tenant.shopId);

    await expectCausalRejection(
      tenant,
      { supplier_id: supplierId, line_items: [line(incomplete)] },
      { supplier_id: supplierId, line_items: [line(eligible)] },
    );
  });
});

// ── R2 — CONNECTION TRANSITIONS FROM A VERIFIED INSTALLATION ───────────────

describe('GH-1262 S1 R2 — connection authority', () => {
  it('S1-R2-01: after a verified connected PO, REAUTH_REQUIRED still permits a draft PO for that variant', async () => {
    const tenant = await createTenant('s1-r2-reauth');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId, 'active');

    // Verified while CONNECTED: the identity is accepted under full authority.
    const verified = await postPo(tenant.ownerToken, { supplier_id: supplierId, line_items: [line(variantId)] });
    expect(verified.status).toBe(201);

    await requireReauth(tenant.shopId);

    const disconnected = await postPo(tenant.ownerToken, {
      supplier_id: supplierId,
      line_items: [line(variantId, { quantity_ordered: 4 })],
    });

    expect(disconnected.status).toBe(201);
    expect(disconnected.body.purchase_order.status).toBe('draft');
    expect(disconnected.body.purchase_order.id).not.toBe(verified.body.purchase_order.id);
    expect(mockCreateShopifyGraphQLClient).not.toHaveBeenCalled();
  });

  it('S1-R2-02: uninstalling a previously valid installation blocks new Shopify-linked POs', async () => {
    const tenant = await createTenant('s1-r2-uninstalled');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId, 'active');

    // Control first: the same tenant, token, supplier and variant are valid.
    const verified = await postPo(tenant.ownerToken, { supplier_id: supplierId, line_items: [line(variantId)] });
    expect(verified.status).toBe(201);

    await uninstallShopify(tenant.shopId);
    const before = await purchasingState(tenant.shopId);

    const res = await postPo(tenant.ownerToken, {
      supplier_id: supplierId,
      line_items: [line(variantId, { quantity_ordered: 4 })],
    });

    expectBusinessRejection(res);
    expect(await purchasingState(tenant.shopId)).toEqual(before);
  });
});

// ── R3 — QUANTITIES, PRICES AND DISTINCT IDENTITIES ────────────────────────

describe('GH-1262 S1 R3 — quantities, unit costs and distinct variants', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['a numeric string', '2'],
  ])('S1-R3-01: a %s quantity is rejected with zero side effects', async (_label, quantity) => {
    const tenant = await createTenant('s1-r3-qty');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);

    await expectCausalRejection(
      tenant,
      { supplier_id: supplierId, line_items: [line(variantId, { quantity_ordered: quantity })] },
      { supplier_id: supplierId, line_items: [line(variantId, { quantity_ordered: 2 })] },
    );
  });

  it.each([
    ['negative', -100],
    ['fractional cents', 12.5],
    ['a string', 'free'],
  ])('S1-R3-02: a %s unit cost is rejected with zero side effects', async (_label, cost) => {
    const tenant = await createTenant('s1-r3-cost');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);

    await expectCausalRejection(
      tenant,
      { supplier_id: supplierId, line_items: [line(variantId, { unit_cost_cents: cost })] },
      { supplier_id: supplierId, line_items: [line(variantId, { unit_cost_cents: 1250 })] },
    );
  });

  it('S1-R3-03: an unknown unit cost stays distinguishable from an explicit zero', async () => {
    const tenant = await createTenant('s1-r3-unknown-cost');
    const supplierId = await createSupplier(tenant.shopId);
    const unknownCostVariant = await createShopifyVariant(tenant.shopId);
    const freeVariant = await createShopifyVariant(tenant.shopId);

    const res = await postPo(tenant.ownerToken, {
      supplier_id: supplierId,
      line_items: [line(unknownCostVariant), line(freeVariant, { unit_cost_cents: 0 })],
    });

    expect(res.status).toBe(201);
    const costs = await withTenant(tenant.shopId, (trx) =>
      trx('purchase_order_line_items')
        .where({ po_id: res.body.purchase_order.id })
        .select('lasyncro_variant_id', 'unit_cost_cents'),
    );
    const byVariant = Object.fromEntries(costs.map((c: any) => [c.lasyncro_variant_id, c.unit_cost_cents]));
    expect(byVariant[unknownCostVariant]).toBeNull();
    expect(Number(byVariant[freeVariant])).toBe(0);
  });

  it('S1-R3-04: the same canonical variant twice in one PO is rejected, not silently duplicated', async () => {
    const tenant = await createTenant('s1-r3-duplicate');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);

    await expectCausalRejection(
      tenant,
      {
        supplier_id: supplierId,
        line_items: [line(variantId, { quantity_ordered: 2 }), line(variantId, { quantity_ordered: 3 })],
      },
      { supplier_id: supplierId, line_items: [line(variantId, { quantity_ordered: 5 })] },
    );
  });

  // Schema limits: expected_delivery_date DATE, document_url varchar(1024),
  // description varchar(1024), notes text (0095/0096).
  it.each([
    ['an impossible date', { expected_delivery_date: '2026-02-30' }],
    ['a month out of range', { expected_delivery_date: '2026-13-01' }],
    ['a non-ISO date', { expected_delivery_date: '21-10-2026' }],
    ['an empty date', { expected_delivery_date: '' }],
    ['a numeric date', { expected_delivery_date: 20261021 }],
    ['a numeric document_url', { document_url: 123 }],
    ['an over-long document_url', { document_url: `https://example.test/${'x'.repeat(1010)}` }],
    ['object notes', { notes: { text: 'x' } }],
  ])('S1-R3-05: %s in the PO header is rejected with zero side effects', async (_label, header) => {
    const tenant = await createTenant('s1-r3-header');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);

    await expectCausalRejection(
      tenant,
      { supplier_id: supplierId, ...header, line_items: [line(variantId)] },
      { supplier_id: supplierId, line_items: [line(variantId)] },
    );
  });

  it('S1-R3-06: an over-long line description is rejected with zero side effects', async () => {
    const tenant = await createTenant('s1-r3-description');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);

    await expectCausalRejection(
      tenant,
      { supplier_id: supplierId, line_items: [line(variantId, { description: 'x'.repeat(1025) })] },
      { supplier_id: supplierId, line_items: [line(variantId, { description: 'x'.repeat(1024) })] },
    );
  });

  it('S1-R3-07: absent/null header values stay null and a real date is stored', async () => {
    const tenant = await createTenant('s1-r3-header-ok');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);

    const nulls = await postPo(tenant.ownerToken, {
      supplier_id: supplierId,
      expected_delivery_date: null,
      notes: null,
      document_url: null,
      line_items: [line(variantId)],
    });
    const dated = await postPo(tenant.ownerToken, {
      supplier_id: supplierId,
      expected_delivery_date: '2028-02-29',
      line_items: [line(variantId)],
    });

    expect(nulls.status).toBe(201);
    expect(dated.status).toBe(201);
    const rows = await withTenant(tenant.shopId, (trx) =>
      trx('purchase_orders')
        .whereIn('id', [nulls.body.purchase_order.id, dated.body.purchase_order.id])
        .select('id', 'notes', 'document_url', trx.raw("to_char(expected_delivery_date, 'YYYY-MM-DD') as eta")),
    );
    const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]));
    expect(byId[nulls.body.purchase_order.id]).toMatchObject({ notes: null, document_url: null, eta: null });
    expect(byId[dated.body.purchase_order.id].eta).toBe('2028-02-29');
  });
});

// ── R4 — ATOMIC SUPPLIER CREATION ──────────────────────────────────────────

describe('GH-1262 S1 R4 — atomic new supplier + PO', () => {
  it('S1-R4-01: new supplier details create the supplier and the PO together', async () => {
    const tenant = await createTenant('s1-r4-create');
    const variantId = await createShopifyVariant(tenant.shopId);
    const name = `GH1262 Inline Supplier ${crypto.randomUUID()}`;

    const res = await postPo(tenant.ownerToken, {
      new_supplier: { name },
      line_items: [line(variantId)],
    });

    expect(res.status).toBe(201);
    const supplier = await withTenant(tenant.shopId, (trx) =>
      trx('suppliers').where({ shop_id: tenant.shopId, name }).first('id'),
    );
    expect(supplier).toBeDefined();
    expect(Number(res.body.purchase_order.supplier_id)).toBe(Number(supplier.id));
  });

  /**
   * PENDING GUARD (C5). Pre-fix this passes trivially: E1 rejects the missing
   * supplier_id before any write. Post-fix it proves the new supplier does not
   * survive a rejected line only if the implementation inserts the supplier
   * before line validation fails; when validation runs first, it proves only
   * the absence of writes. No legitimate failure after the supplier insert is
   * forceable from the public API without a production hook or an artificial
   * database error, and neither is used. S1-R5-03 does NOT close this gap:
   * its losing request may be deduplicated before any supplier insert, so it
   * proves only that no duplicate supplier survives. Genuine post-insert
   * rollback is proven separately by S1-R4-04.
   */
  it('S1-R4-02: a rejected PO leaves neither the new supplier nor a partial PO (pending guard)', async () => {
    const tenant = await createTenant('s1-r4-rollback');
    const other = await createTenant('s1-r4-rollback-other');
    const ownVariant = await createShopifyVariant(tenant.shopId);
    const foreignVariant = await createShopifyVariant(other.shopId);
    const name = `GH1262 Rolled Back Supplier ${crypto.randomUUID()}`;

    await expectCausalRejection(
      tenant,
      { new_supplier: { name }, line_items: [line(foreignVariant)] },
      { new_supplier: { name }, line_items: [line(ownVariant)] },
    );
    const suppliers = await withTenant(tenant.shopId, (trx) =>
      trx('suppliers').where({ shop_id: tenant.shopId, name }).select('id'),
    );
    // Exactly the control's supplier: the rejected attempt left no orphan,
    // which would otherwise also have collided with the control's name.
    expect(suppliers).toHaveLength(1);
  });

  it('S1-R4-03: supplier_id and new_supplier together are rejected with zero side effects', async () => {
    const tenant = await createTenant('s1-r4-both');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);

    await expectCausalRejection(
      tenant,
      {
        supplier_id: supplierId,
        new_supplier: { name: `GH1262 Ambiguous Supplier ${crypto.randomUUID()}` },
        line_items: [line(variantId)],
      },
      { supplier_id: supplierId, line_items: [line(variantId)] },
    );
  });

  /**
   * GENUINE POST-INSERT ROLLBACK (C3). A test-scoped trigger, installed in the
   * disposable database through the migration role (precedent:
   * reservation-unwind-batch-cancel-concurrency-r0v1.test.ts), fails the
   * ledger INSERT for this fixture's key only — the last write, after the new
   * supplier, PO and lines exist in the request transaction. Before raising,
   * it records what that transaction could see into a test-owned sequence
   * (setval is non-transactional, so the observation survives the rollback).
   * The request itself still runs as restricted sf_app under FORCE RLS.
   */
  it('S1-R4-04: a failure after the supplier, PO and lines are inserted rolls all of them back', async () => {
    const tenant = await createTenant('s1-r4-post-insert');
    const variantId = await createShopifyVariant(tenant.shopId);
    const key = newKey();
    const name = `GH1262 Post Insert Supplier ${crypto.randomUUID()}`;
    const body = { new_supplier: { name }, line_items: [line(variantId)] };
    expect(key).toMatch(/^[a-z0-9-]+$/);
    expect(name).toMatch(/^[A-Za-z0-9 -]+$/);

    const uniq = crypto.randomUUID().replace(/-/g, '');
    const fnName = `gh1262_s1_c3_fail_ledger_${uniq}`;
    const trgName = `gh1262_s1_c3_fail_ledger_trg_${uniq}`;
    const probe = `gh1262_s1_c3_probe_${uniq}`;
    const admin = knexLib({
      client: 'pg',
      connection: {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGMIGRATION_USER,
        password: String(process.env.PGMIGRATION_PASSWORD || ''),
        database: process.env.PGDATABASE,
      },
      pool: { min: 0, max: 1 },
    });

    const before = await purchasingState(tenant.shopId);
    let failed: request.Response;
    let observed: number;
    try {
      const who = await admin.raw('SELECT current_database() AS db');
      expect(who.rows[0].db).toBe(process.env.PGDATABASE);

      await admin.raw(`CREATE SEQUENCE ${probe} MINVALUE 0 START 0`);
      await admin.raw(`GRANT USAGE, SELECT, UPDATE ON SEQUENCE ${probe} TO sf_app`);
      await admin.raw(
        `CREATE FUNCTION ${fnName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ` +
        `PERFORM setval('${probe}', 1000` +
        ` + 100 * (SELECT count(*) FROM suppliers WHERE shop_id = NEW.shop_id AND name = '${name}')` +
        ` + 10 * (SELECT count(*) FROM purchase_orders WHERE id = NEW.purchase_order_id)` +
        ` + (SELECT count(*) FROM purchase_order_line_items WHERE po_id = NEW.purchase_order_id)); ` +
        `RAISE EXCEPTION 'gh1262 s1 injected post-insert failure'; END; $$;`,
      );
      await admin.raw(
        `CREATE TRIGGER ${trgName} BEFORE INSERT ON purchase_order_idempotency_keys FOR EACH ROW ` +
        `WHEN (NEW.shop_id = ${Number(tenant.shopId)} AND NEW.idempotency_key = '${key}') ` +
        `EXECUTE FUNCTION ${fnName}();`,
      );

      failed = await postPo(tenant.ownerToken, body, key);
      observed = Number((await admin.raw(`SELECT last_value FROM ${probe}`)).rows[0].last_value);
    } finally {
      try { await admin.raw(`DROP TRIGGER IF EXISTS ${trgName} ON purchase_order_idempotency_keys`); } catch { /* reported below */ }
      try { await admin.raw(`DROP FUNCTION IF EXISTS ${fnName}()`); } catch { /* reported below */ }
      try { await admin.raw(`DROP SEQUENCE IF EXISTS ${probe}`); } catch { /* reported below */ }
      const residual = await admin.raw(
        `SELECT tgname FROM pg_trigger WHERE tgname LIKE 'gh1262_s1_c3_%'`,
      );
      await admin.destroy();
      expect(residual.rows).toEqual([]);
    }

    // Inside the failing transaction: 1 new supplier, 1 PO, 1 line existed.
    expect(observed).toBe(1111);
    // A genuine database failure, not a business rejection.
    expect(failed.status).toBe(500);
    // Supplier, PO, lines, ledger and snapshot all rolled back.
    expect(await purchasingState(tenant.shopId)).toEqual(before);
    expect(
      await withTenant(tenant.shopId, (trx) => trx('suppliers').where({ shop_id: tenant.shopId, name }).select('id')),
    ).toEqual([]);

    // The key was not consumed: the same request now succeeds exactly once.
    const retry = await postPo(tenant.ownerToken, body, key);
    expect(retry.status).toBe(201);
    const after = await purchasingState(tenant.shopId);
    expect(after).toMatchObject({
      suppliers: before.suppliers + 1,
      purchaseOrders: before.purchaseOrders + 1,
      lines: before.lines + 1,
      idempotencyKeys: before.idempotencyKeys + 1,
    });
  });
});

// ── R5 — SAFE RETRIES ──────────────────────────────────────────────────────

describe('GH-1262 S1 R5 — tenant-scoped idempotent PO creation', () => {
  it('S1-R5-00: a create without the required Idempotency-Key is rejected with zero side effects', async () => {
    const tenant = await createTenant('s1-r5-no-key');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);
    const body = { supplier_id: supplierId, line_items: [line(variantId)] };
    const before = await purchasingState(tenant.shopId);

    const res = await postPo(tenant.ownerToken, body, null);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect([401, 403]).not.toContain(res.status);
    expect(await purchasingState(tenant.shopId)).toEqual(before);

    const control = await postPo(tenant.ownerToken, body);
    expect(control.status).toBe(201);
  });

  it('S1-R5-01: replaying the same key and request returns the same PO without duplicating it', async () => {
    const tenant = await createTenant('s1-r5-replay');
    const other = await createTenant('s1-r5-replay-other');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);
    const otherSupplierId = await createSupplier(other.shopId);
    const otherVariantId = await createShopifyVariant(other.shopId);
    const key = newKey();
    const body = { supplier_id: supplierId, line_items: [line(variantId)] };

    const first = await postPo(tenant.ownerToken, body, key);
    expect(first.status).toBe(201);
    const afterFirst = await purchasingState(tenant.shopId);

    const replay = await postPo(tenant.ownerToken, body, key);

    expect([200, 201]).toContain(replay.status);
    expect(replay.body.purchase_order.id).toBe(first.body.purchase_order.id);
    expect(afterFirst).toMatchObject({ purchaseOrders: 1, lines: 1 });
    // Complete tenant-scoped purchasing state is identical after the replay,
    // including the coalesced shop_snapshot_jobs row: a replay that re-ran the
    // write path would re-schedule it (enqueueShopSnapshotJob merges
    // scheduled_at = now()).
    expect(await purchasingState(tenant.shopId)).toEqual(afterFirst);

    // The key is tenant-scoped: another shop using it gets its own PO.
    const otherRes = await postPo(
      other.ownerToken,
      { supplier_id: otherSupplierId, line_items: [line(otherVariantId)] },
      key,
    );
    expect(otherRes.status).toBe(201);
    expect(otherRes.body.purchase_order.id).not.toBe(first.body.purchase_order.id);
  });

  it('S1-R5-02: the same key with a different request is rejected 409 and the original PO is unchanged', async () => {
    const tenant = await createTenant('s1-r5-conflict');
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);
    const key = newKey();

    const first = await postPo(tenant.ownerToken, { supplier_id: supplierId, line_items: [line(variantId)] }, key);
    expect(first.status).toBe(201);
    const afterFirst = await purchasingState(tenant.shopId);
    const originalLines = await withTenant(tenant.shopId, (trx) =>
      trx('purchase_order_line_items')
        .where({ po_id: first.body.purchase_order.id })
        .select('lasyncro_variant_id', 'quantity_ordered', 'unit_cost_cents'),
    );

    const conflicting = await postPo(
      tenant.ownerToken,
      { supplier_id: supplierId, line_items: [line(variantId, { quantity_ordered: 9 })] },
      key,
    );

    expect(conflicting.status).toBe(409);
    expect(await purchasingState(tenant.shopId)).toEqual(afterFirst);
    expect(
      await withTenant(tenant.shopId, (trx) =>
        trx('purchase_order_line_items')
          .where({ po_id: first.body.purchase_order.id })
          .select('lasyncro_variant_id', 'quantity_ordered', 'unit_cost_cents'),
      ),
    ).toEqual(originalLines);
  });

  /**
   * Black-box concurrent regression (dispatch overlap, interleaving not
   * controlled). Proves the business outcome only: one PO, one line, one new
   * supplier. It does not prove a losing transaction inserted and rolled back
   * a supplier (deduplication may happen first), and the single coalesced
   * shop_snapshot_jobs row cannot show how many times enqueue ran.
   */
  it('S1-R5-03: concurrent identical requests with one key resolve to one PO and one new supplier', async () => {
    const tenant = await createTenant('s1-r5-concurrent');
    const variantId = await createShopifyVariant(tenant.shopId);
    const key = newKey();
    const name = `GH1262 Concurrent Supplier ${crypto.randomUUID()}`;
    const body = { new_supplier: { name }, line_items: [line(variantId)] };
    const before = await purchasingState(tenant.shopId);

    const settled = await Promise.allSettled([
      postPo(tenant.ownerToken, body, key).timeout({ deadline: REQUEST_DEADLINE_MS }).then((res) => res),
      postPo(tenant.ownerToken, body, key).timeout({ deadline: REQUEST_DEADLINE_MS }).then((res) => res),
    ]);
    const [a, b] = settled.map((outcome) => {
      if (outcome.status === 'rejected') throw outcome.reason;
      return outcome.value;
    });

    for (const res of [a, b]) expect([200, 201]).toContain(res.status);
    expect(a.body.purchase_order.id).toBe(b.body.purchase_order.id);

    const after = await purchasingState(tenant.shopId);
    expect(after.purchaseOrders).toBe(before.purchaseOrders + 1);
    expect(after.lines).toBe(before.lines + 1);
    expect(after.suppliers).toBe(before.suppliers + 1);
    const named = await withTenant(tenant.shopId, (trx) =>
      trx('suppliers').where({ shop_id: tenant.shopId, name }).select('id'),
    );
    expect(named).toHaveLength(1);
    // Coalesced queue shape only — not evidence of a single enqueue.
    expect(after.snapshotJobs).toHaveLength(1);
  });

  it('S1-R5-04: a key stays consumed after its PO is deleted; the retry is refused with zero writes', async () => {
    const tenant = await createTenant('s1-r5-deleted');
    const other = await createTenant('s1-r5-deleted-other');
    const variantId = await createShopifyVariant(tenant.shopId);
    const otherVariantId = await createShopifyVariant(other.shopId);
    const key = newKey();
    const body = { new_supplier: { name: `GH1262 Retained Key Supplier ${crypto.randomUUID()}` }, line_items: [line(variantId)] };

    const first = await postPo(tenant.ownerToken, body, key);
    expect(first.status).toBe(201);
    const poId = first.body.purchase_order.id;
    const ledger = () =>
      withTenant(tenant.shopId, (trx) =>
        trx('purchase_order_idempotency_keys')
          .where({ shop_id: tenant.shopId, idempotency_key: key })
          .select('purchase_order_id'),
      );
    expect(await ledger()).toEqual([{ purchase_order_id: poId }]);

    // Disposable DB only: physically delete exactly the fixture PO (its lines cascade).
    const deleted = await withTenant(tenant.shopId, (trx) =>
      trx('purchase_orders').where({ id: poId, shop_id: tenant.shopId }).del(),
    );
    expect(deleted).toBe(1);
    expect(await ledger()).toEqual([{ purchase_order_id: null }]);
    const before = await purchasingState(tenant.shopId);
    const otherBefore = await purchasingState(other.shopId);

    const retry = await postPo(tenant.ownerToken, body, key);

    expect(retry.status).toBe(409);
    expect(await purchasingState(tenant.shopId)).toEqual(before);
    expect(await ledger()).toEqual([{ purchase_order_id: null }]);
    expect(await purchasingState(other.shopId)).toEqual(otherBefore);

    // Tenant isolation: the same key is independent in another shop.
    const otherRes = await postPo(
      other.ownerToken,
      { new_supplier: { name: `GH1262 Other Tenant Supplier ${crypto.randomUUID()}` }, line_items: [line(otherVariantId)] },
      key,
    );
    expect(otherRes.status).toBe(201);
    expect(await ledger()).toEqual([{ purchase_order_id: null }]);
  });
});

// ── R6 / R7 — REORDER CONVERSION AND OPTIONAL SUPPLIER DATA ────────────────

describe('GH-1262 S1 R6 — reorder conversion concurrency', () => {
  /**
   * BLACK-BOX CONCURRENT REGRESSION — NOT A DETERMINISTIC INTERLEAVING PROOF.
   *
   * Both conversions are dispatched before either is awaited, so they overlap
   * in wall-clock time, but whether their transactions interleave at the
   * critical read/claim is not controlled. Forcing that interleaving needs
   * either a production test hook or test-side observation of server
   * transaction progress (lock state / pg_stat_activity), which would couple
   * the test to one locking strategy and count sessions it does not own.
   * Neither is used. A pass is therefore evidence, not certification, of
   * concurrency safety; a single failure is a real duplicate-claim defect.
   *
   * The outcome is implementation-neutral: any strategy (blocking locks,
   * SKIP LOCKED, advisory locks, conditional claim, …) passes if exactly one
   * PO exists and every request is claimed by it exactly once. The second
   * conversion may legitimately report "nothing pending" (4xx) or return the
   * same PO; it may never return a different PO or a 5xx.
   *
   * Both requests carry a deadline, and allSettled ensures neither is left
   * in flight if the other rejects.
   */
  it('S1-R6-01: overlapping conversions create exactly one PO and claim each request once', async () => {
    const tenant = await createTenant('s1-r6-concurrent');
    const supplierId = await createSupplier(tenant.shopId, { moq: null });
    const variantA = await createShopifyVariant(tenant.shopId);
    const variantB = await createShopifyVariant(tenant.shopId);
    await queueReorder(tenant.ownerToken, supplierId, variantA, 3);
    await queueReorder(tenant.ownerToken, supplierId, variantB, 4);
    const before = await inventoryState(tenant.shopId);

    const dispatch = () =>
      convert(tenant.ownerToken, { supplier_id: supplierId })
        .timeout({ deadline: REQUEST_DEADLINE_MS })
        .then((res) => res);
    const settled = await Promise.allSettled([dispatch(), dispatch()]);

    const responses = settled.map((outcome) => {
      if (outcome.status === 'rejected') throw outcome.reason;
      return outcome.value;
    });

    for (const res of responses) {
      expect(res.status).toBeLessThan(500);
      expect([401, 403]).not.toContain(res.status);
    }
    const created = responses.filter((res) => res.status === 201);
    expect(created.length).toBeGreaterThanOrEqual(1);

    const state = await withTenant(tenant.shopId, async (trx) => ({
      pos: await trx('purchase_orders').where({ shop_id: tenant.shopId, supplier_id: supplierId }).pluck('id'),
      lines: await trx('purchase_order_line_items')
        .where({ shop_id: tenant.shopId })
        .select('lasyncro_variant_id', 'quantity_ordered'),
      requests: await trx('reorder_requests')
        .where({ shop_id: tenant.shopId, supplier_id: supplierId })
        .select('status', 'converted_po_id'),
    }));

    expect(state.pos).toHaveLength(1);
    // Every successful conversion names the one PO that exists.
    for (const res of created) expect(res.body.po_id).toBe(state.pos[0]);
    expect(state.lines).toHaveLength(2);
    expect(state.lines).toEqual(
      expect.arrayContaining([
        { lasyncro_variant_id: variantA, quantity_ordered: 3 },
        { lasyncro_variant_id: variantB, quantity_ordered: 4 },
      ]),
    );
    expect(state.requests).toHaveLength(2);
    for (const r of state.requests) {
      expect(r).toEqual({ status: 'converted', converted_po_id: state.pos[0] });
    }
    expect(await inventoryState(tenant.shopId)).toEqual(before);
  });
});

describe('GH-1262 S1 R7 — optional lead time, MOQ and delivery estimate', () => {
  // Approved correction (SF-GH1262-S1-BACKEND-IMPLEMENT-001): conversion keeps
  // the established SRC-01a hard gate — no lead time means no PO (422).
  it('S1-R7-01: converting for a supplier without a lead time is blocked by the hard gate with zero side effects', async () => {
    const tenant = await createTenant('s1-r7-no-lead-time');
    const supplierId = await createSupplier(tenant.shopId, { lead_time_days: null, moq: null });
    const variantId = await createShopifyVariant(tenant.shopId);
    await queueReorder(tenant.ownerToken, supplierId, variantId, 2);
    const before = await purchasingState(tenant.shopId);

    const res = await convert(tenant.ownerToken, { supplier_id: supplierId });

    expect(res.status).toBe(422);
    expectBusinessRejection(res);
    const after = await purchasingState(tenant.shopId);
    expect(after).toEqual(before);
    expect(after.purchaseOrders).toBe(0);
    expect(after.reorderRequests).toEqual([expect.objectContaining({ status: 'pending', converted_po_id: null })]);
  });

  it('S1-R7-02: an explicit below-MOQ override is recorded on the PO', async () => {
    const tenant = await createTenant('s1-r7-moq');
    const supplierId = await createSupplier(tenant.shopId, { moq: 50 });
    const variantId = await createShopifyVariant(tenant.shopId);
    await queueReorder(tenant.ownerToken, supplierId, variantId, 5);

    const res = await convert(tenant.ownerToken, { supplier_id: supplierId, override_moq: true });

    expect(res.status).toBe(201);
    const po = await withTenant(tenant.shopId, (trx) =>
      trx('purchase_orders').where({ id: res.body.po_id }).first('notes'),
    );
    expect(po.notes).toMatch(/below moq/i);
    expect(po.notes).toMatch(/5\s*\/\s*50/);
  });
});

// ── R8 — AUTHORIZATION (published-main policy preserved) ───────────────────

describe('GH-1262 S1 R8 — capability, role and tenant authority', () => {
  it('S1-R8-01: below Growth, purchasing capabilities deny both create and convert', async () => {
    const tenant = await createTenant('s1-r8-core', { tier: 'core' });
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);
    const before = await purchasingState(tenant.shopId);

    const manual = await postPo(tenant.ownerToken, { supplier_id: supplierId, line_items: [line(variantId)] });
    const conversion = await convert(tenant.ownerToken, { supplier_id: supplierId });

    expect(manual.status).toBe(403);
    expect(manual.body).toMatchObject({ error: 'COMMERCIAL_ACCESS_DENIED', capabilityId: 'purchasing.core' });
    expect(conversion.status).toBe(403);
    expect(conversion.body).toMatchObject({ error: 'COMMERCIAL_ACCESS_DENIED', capabilityId: 'purchasing.sourcing' });
    expect(await purchasingState(tenant.shopId)).toEqual(before);
  });

  it('S1-R8-02: an operator cannot create or convert purchase orders', async () => {
    const tenant = await createTenant('s1-r8-operator');
    const operatorId = await createMember(tenant.shopId, 'operator');
    const operatorToken = issueTestToken({
      userId: operatorId,
      shopId: tenant.shopId,
      tier: 'growth',
      roles: ['operator'],
    });
    const supplierId = await createSupplier(tenant.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);
    await queueReorder(tenant.ownerToken, supplierId, variantId, 2);
    const before = await purchasingState(tenant.shopId);

    const manual = await postPo(operatorToken, { supplier_id: supplierId, line_items: [line(variantId)] });
    const conversion = await convert(operatorToken, { supplier_id: supplierId });

    expect(manual.status).toBe(403);
    expect(manual.body).toMatchObject({ error: 'ACTION_FORBIDDEN' });
    expect(conversion.status).toBe(403);
    expect(conversion.body).toMatchObject({ error: 'ACTION_FORBIDDEN' });
    expect(await purchasingState(tenant.shopId)).toEqual(before);
  });

  it('S1-R8-03: a foreign-tenant supplier cannot be ordered from', async () => {
    const tenant = await createTenant('s1-r8-foreign-supplier');
    const other = await createTenant('s1-r8-foreign-supplier-other');
    const ownSupplierId = await createSupplier(tenant.shopId);
    const foreignSupplierId = await createSupplier(other.shopId);
    const variantId = await createShopifyVariant(tenant.shopId);
    const otherBefore = await purchasingState(other.shopId);

    await expectCausalRejection(
      tenant,
      { supplier_id: foreignSupplierId, line_items: [line(variantId)] },
      { supplier_id: ownSupplierId, line_items: [line(variantId)] },
    );
    expect(await purchasingState(other.shopId)).toEqual(otherBefore);
  });
});

// ── R9 — NO INVENTORY SIDE EFFECTS ─────────────────────────────────────────

describe('GH-1262 S1 R9 — PO creation has no inventory side effects', () => {
  it('S1-R9-01: manual creation and conversion credit no inventory, issue no LSUs, create no Receive/Stow work and publish nothing', async () => {
    const tenant = await createTenant('s1-r9-no-inventory');
    const supplierId = await createSupplier(tenant.shopId, { moq: null });
    const manualVariant = await createShopifyVariant(tenant.shopId);
    const queuedVariant = await createShopifyVariant(tenant.shopId);
    await queueReorder(tenant.ownerToken, supplierId, queuedVariant, 3);
    const before = await inventoryState(tenant.shopId);

    const manual = await postPo(tenant.ownerToken, {
      supplier_id: supplierId,
      line_items: [line(manualVariant)],
    });
    const conversion = await convert(tenant.ownerToken, { supplier_id: supplierId });

    expect(manual.status).toBe(201);
    expect(conversion.status).toBe(201);
    expect(await inventoryState(tenant.shopId)).toEqual(before);
    expect(mockCreateShopifyGraphQLClient).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ── H1 — VARIANT PICKER OFFERS ONLY PO-ELIGIBLE VARIANTS ───────────────────

const SEARCH_PATH = '/api/v1/suppliers/variants/search';

function searchVariants(token: string, q?: string) {
  const req = request(app).get(SEARCH_PATH).set({ Authorization: `Bearer ${token}` });
  return q === undefined ? req : req.query({ q });
}

async function searchIds(token: string, q?: string): Promise<string[]> {
  const res = await searchVariants(token, q);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.variants)).toBe(true);
  return res.body.variants.map((v: any) => v.lasyncro_variant_id);
}

/** Overrides the searchable catalog text of a fixture variant. */
async function relabelVariant(
  shopId: number,
  variantId: string,
  fields: { sku?: string; title?: string; productTitle?: string },
): Promise<void> {
  await withTenant(shopId, async (trx) => {
    const patch: Record<string, string> = {};
    if (fields.sku !== undefined) patch.sku = fields.sku;
    if (fields.title !== undefined) patch.title = fields.title;
    if (Object.keys(patch).length) {
      await trx('variants').where({ shop_id: shopId, lasyncro_variant_id: variantId }).update(patch);
    }
    if (fields.productTitle !== undefined) {
      const { lasyncro_product_id } = await trx('variants')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .first('lasyncro_product_id');
      await trx('products')
        .where({ shop_id: shopId, lasyncro_product_id })
        .update({ title: fields.productTitle });
    }
  });
}

describe('GH-1262 S1 H1 — PO variant picker eligibility', () => {
  it('R-H1-01: variants of active, draft and unlisted products appear', async () => {
    const tenant = await createTenant('s1-h1-eligible');
    const ids = await Promise.all(
      (['active', 'draft', 'unlisted'] as const).map((s) => createShopifyVariant(tenant.shopId, s)),
    );

    expect((await searchIds(tenant.ownerToken)).sort()).toEqual([...ids].sort());
  });

  it('R-H1-02: variants of archived and deleted products are excluded', async () => {
    const tenant = await createTenant('s1-h1-lifecycle');
    const eligible = await createShopifyVariant(tenant.shopId, 'active');
    await createShopifyVariant(tenant.shopId, 'archived');
    await createShopifyVariant(tenant.shopId, 'deleted');

    expect(await searchIds(tenant.ownerToken)).toEqual([eligible]);
  });

  it('R-H1-03: a variant without a Shopify identity mapping is excluded', async () => {
    const tenant = await createTenant('s1-h1-unmapped');
    const eligible = await createShopifyVariant(tenant.shopId);
    const unmapped = await createShopifyVariant(tenant.shopId);
    const otherPlatform = await createShopifyVariant(tenant.shopId);
    await withTenant(tenant.shopId, async (trx) => {
      await trx('external_product_identity_map')
        .where({ shop_id: tenant.shopId, lasyncro_variant_id: unmapped })
        .del();
      await trx('external_product_identity_map')
        .where({ shop_id: tenant.shopId, lasyncro_variant_id: otherPlatform })
        .update({ platform: 'amazon' });
    });

    expect(await searchIds(tenant.ownerToken)).toEqual([eligible]);
  });

  it('R-H1-04: malformed Shopify variant or product identities are excluded; multiple mappings yield one row', async () => {
    const tenant = await createTenant('s1-h1-malformed');
    const eligible = await createShopifyVariant(tenant.shopId);
    await createShopifyVariant(tenant.shopId, 'active', { externalVariantId: null });
    await createShopifyVariant(tenant.shopId, 'active', { externalVariantId: '' });
    await createShopifyVariant(tenant.shopId, 'active', { externalVariantId: '12345' });
    await createShopifyVariant(tenant.shopId, 'active', { externalVariantId: 'gid://shopify/ProductVariant/0' });
    const badProduct = await createShopifyVariant(tenant.shopId);
    await withTenant(tenant.shopId, async (trx) => {
      await trx('external_product_identity_map')
        .where({ shop_id: tenant.shopId, lasyncro_variant_id: badProduct })
        .update({ external_product_id: '987654' });
      // A second valid mapping for the eligible variant must not duplicate it.
      await trx('external_product_identity_map').insert({
        id: crypto.randomUUID(),
        shop_id: tenant.shopId,
        lasyncro_variant_id: eligible,
        platform: 'shopify',
        external_product_id: `gid://shopify/Product/${crypto.randomInt(1_000_000, 9_999_999)}`,
        external_variant_id: `gid://shopify/ProductVariant/${crypto.randomInt(1_000_000, 9_999_999)}`,
        external_inventory_item_id: null,
      });
    });

    expect(await searchIds(tenant.ownerToken)).toEqual([eligible]);
  });

  it('R-H1-05: another tenant\'s eligible variants are excluded', async () => {
    const tenant = await createTenant('s1-h1-tenant');
    const other = await createTenant('s1-h1-tenant-other');
    const own = await createShopifyVariant(tenant.shopId);
    const foreign = await createShopifyVariant(other.shopId);
    await relabelVariant(other.shopId, foreign, { sku: 'H1-SHARED-FOREIGN' });
    await relabelVariant(tenant.shopId, own, { sku: 'H1-SHARED-OWN' });

    expect(await searchIds(tenant.ownerToken, 'H1-SHARED')).toEqual([own]);
    expect(await searchIds(other.ownerToken, 'H1-SHARED')).toEqual([foreign]);
  });

  it('R-H1-06: SKU/title/product-title search, nonempty SKU, ordering and the 30 limit survive, with eligibility before LIMIT', async () => {
    const tenant = await createTenant('s1-h1-search');

    const bySku = await createShopifyVariant(tenant.shopId);
    const byTitle = await createShopifyVariant(tenant.shopId);
    const byProduct = await createShopifyVariant(tenant.shopId);
    const emptySku = await createShopifyVariant(tenant.shopId);
    await relabelVariant(tenant.shopId, bySku, { sku: 'H1-C-NEEDLE-SKU' });
    await relabelVariant(tenant.shopId, byTitle, { sku: 'H1-B', title: 'Blue needle variant' });
    await relabelVariant(tenant.shopId, byProduct, { sku: 'H1-A', productTitle: 'Needle Product' });
    await relabelVariant(tenant.shopId, emptySku, { sku: '', title: 'needle without sku' });

    expect(await searchIds(tenant.ownerToken, 'needle')).toEqual([byProduct, byTitle, bySku]);

    // 31 ineligible variants sort ahead of 31 eligible ones; a LIMIT applied
    // before eligibility would return none of the eligible variants.
    for (let i = 0; i < 31; i += 1) {
      const archived = await createShopifyVariant(tenant.shopId, 'archived');
      await relabelVariant(tenant.shopId, archived, { sku: `H1-LIM-0-${String(i).padStart(2, '0')}` });
    }
    const eligible: string[] = [];
    for (let i = 0; i < 31; i += 1) {
      const id = await createShopifyVariant(tenant.shopId);
      await relabelVariant(tenant.shopId, id, { sku: `H1-LIM-1-${String(i).padStart(2, '0')}` });
      eligible.push(id);
    }

    const res = await searchVariants(tenant.ownerToken, 'H1-LIM');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['variants']);
    expect(res.body.variants.map((v: any) => v.lasyncro_variant_id)).toEqual(eligible.slice(0, 30));
    const skus = res.body.variants.map((v: any) => v.sku);
    expect(skus).toEqual([...skus].sort());
    expect(Object.keys(res.body.variants[0]).sort()).toEqual(
      ['image_url', 'lasyncro_variant_id', 'product_title', 'sku', 'title', 'unit_cost'],
    );
  });

  it('R-H1-07: every search result is accepted by the canonical PO creation endpoint', async () => {
    const tenant = await createTenant('s1-h1-roundtrip');
    const supplierId = await createSupplier(tenant.shopId);
    for (const status of ['active', 'draft', 'unlisted', 'archived', 'deleted'] as const) {
      await createShopifyVariant(tenant.shopId, status);
    }
    await createShopifyVariant(tenant.shopId, 'active', { externalVariantId: null });
    const unmapped = await createShopifyVariant(tenant.shopId);
    await withTenant(tenant.shopId, (trx) =>
      trx('external_product_identity_map').where({ shop_id: tenant.shopId, lasyncro_variant_id: unmapped }).del(),
    );

    const ids = await searchIds(tenant.ownerToken);
    expect(ids).toHaveLength(3);

    for (const id of ids) {
      const res = await postPo(tenant.ownerToken, { supplier_id: supplierId, line_items: [line(id)] });
      expect(res.status).toBe(201);
    }
  });
});
