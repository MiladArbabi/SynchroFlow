import crypto from 'crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { resolveAuthUserByEmail } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { seedFirstEntry } from 'api-src/scripts/seed_first_entry';
import { wmsOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';
import { getShopOpeningInventoryProgress } from 'api-src/services/wms/inventoryRecount.service';
import { FT2EvaluatorService } from 'api-src/services/ft2-evaluator.service';

const app = createApp();
const password = 'First-entry-fixture-1160';
const originalSeedMode = process.env.DEV_SEED_MODE;

beforeAll(() => {
  process.env.DEV_SEED_MODE = 'first_entry';
  process.env.SHOPIFY_API_SECRET ||= 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY ||= 'test_shopify_key';
  process.env.API_URL ||= 'https://api.test';
});

afterAll(() => {
  if (originalSeedMode === undefined) delete process.env.DEV_SEED_MODE;
  else process.env.DEV_SEED_MODE = originalSeedMode;
});

async function installFreshShop() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const shopDomain = `first-entry-${suffix}.myshopify.com`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(`shop=${shopDomain}&timestamp=${timestamp}`).digest('hex');
  const response = await request(app)
    .get('/api/v1/integrations/shopify/install')
    .query({ shop: shopDomain, timestamp, hmac }).redirects(0);
  expect(response.status).toBe(302);
  const user = await resolveAuthUserByEmail(`shopify-install+${shopDomain}@lasyncro.internal`);
  expect(user).toBeTruthy();
  return { shopId: Number(user!.shop_id), email: `first-entry-${suffix}@example.test` };
}

async function createFixture() {
  const { shopId, email } = await installFreshShop();
  return { ...await seedFirstEntry(shopId, { email, password }), email };
}

async function signalsFor(shopId: number) {
  const signals = await runWithTenantContext(shopId, () =>
    wmsOnboardingSignalProvider.getSignals({ shopId })
  );
  return Object.fromEntries(signals.map(({ name, value }) => [name, value]));
}

describe('GH-1160 first-entry fixture and readiness', () => {
  it('has a login-capable owner, FT2 durability, root only, and no mature operational data', async () => {
    const fixture = await createFixture();
    const user = await resolveAuthUserByEmail(fixture.email);
    expect(user).toMatchObject({ id: fixture.ownerId, shop_id: fixture.shopId, entry_channel: 'shopify_app_store' });
    expect(await bcrypt.compare(password, user!.password_hash)).toBe(true);

    await withTenant(fixture.shopId, async (trx) => {
      expect(await trx('shop_memberships').where({ shop_id: fixture.shopId, user_id: fixture.ownerId }).first())
        .toMatchObject({ role: 'owner', revoked_at: null });
      expect(await trx('shop_wms_settings').where({ shop_id: fixture.shopId }).first())
        .toMatchObject({ bootstrap_model: 'reconcile_opening_expectation_v2', opening_inventory_reconciliation_started_at: null });
      expect(await trx('warehouses').where({ shop_id: fixture.shopId }))
        .toEqual([expect.objectContaining({ warehouse_id: fixture.warehouseId, is_default: true, active: true })]);
      expect(await trx('warehouse_locations').where({ shop_id: fixture.shopId }))
        .toEqual([expect.objectContaining({ location_code: fixture.rootLocationCode, type: 'warehouse', active: true, parent_location_code: null })]);
      expect(await trx('warehouse_locations').where({ shop_id: fixture.shopId, type: 'bin', active: true })).toEqual([]);
      expect(await trx('integrations').where({ shop_id: fixture.shopId }).first())
        .toMatchObject({ platform: 'shopify', sync_status: 'COMPLETED', sync_last_error: null });
      expect(await trx('user_lifecycle_snapshot').where({ shop_id: fixture.shopId }).first()).toMatchObject({ phase: 'FT2' });
      expect(await trx('ft2_state').where({ shop_id: fixture.shopId }).first()).toBeDefined();
      for (const table of [
        'products', 'orders', 'inventory_movements', 'inventory_truth',
        'inventory_recount_tasks',
        'revenue_projection_daily', 'daily_operational_brief_snapshot',
      ]) {
        expect({ table, rows: await trx(table).where({ shop_id: fixture.shopId }) })
          .toEqual({ table, rows: [] });
      }
    });
    // FIRST_ENTRY_TEST_REVENUE_UNITS_INDIRECT_SCOPE:
    // order_revenue_units has no shop_id; tenant ownership derives
    // through its parent order.
    const revenueUnits = await withTenant(fixture.shopId, (trx) =>
      trx('order_revenue_units as ru')
        .join(
          'orders as o',
          'o.lasyncro_order_id',
          'ru.lasyncro_order_id'
        )
        .where('o.shop_id', fixture.shopId)
        .select('ru.lasyncro_order_id')
    );

    expect(revenueUnits).toEqual([]);

    const evaluation = await runWithTenantContext(fixture.shopId, () =>
      FT2EvaluatorService.evaluateReal(fixture.shopId)
    );
    expect(evaluation.eligible).toBe(true);
  });

  it('root-only readiness remains unmapped and never starts opening inventory', async () => {
    const fixture = await createFixture();
    const before = await withTenant(fixture.shopId, (trx) => getShopOpeningInventoryProgress(trx, fixture.shopId));
    expect(before).toMatchObject({ state: 'not_started', started_at: null, progress_pct: 0 });
    expect(await signalsFor(fixture.shopId)).toMatchObject({
      'wms.enabled': true,
      'wms.zonesConfigured': false,
      'wms.barcodesPrinted': false,
      'wms.carrierConfigured': false,
      'wms.openingInventoryReconciliationRequired': true,
      'wms.openingInventoryProgressPct': 0,
      'wms.openingInventoryNeedsReview': false,
      'wms.openingInventoryReconciled': false,
    });
    const after = await withTenant(fixture.shopId, (trx) => getShopOpeningInventoryProgress(trx, fixture.shopId));
    expect(after).toEqual(before);
    expect(await withTenant(fixture.shopId, (trx) => trx('inventory_recount_tasks')
      .where({ shop_id: fixture.shopId, purpose: 'opening_inventory' }))).toEqual([]);
  });

  it.each([
    { type: 'bin', active: false, warehouseActive: true, mapped: false },
    { type: 'bin', active: true, warehouseActive: true, mapped: true },
    { type: 'bin', active: true, warehouseActive: false, mapped: false },
    { type: 'lane', active: true, warehouseActive: true, mapped: false },
  ])('mapping requires an opening-eligible bin: %j', async ({ type, active, warehouseActive, mapped }) => {
    const fixture = await createFixture();
    await withTenant(fixture.shopId, async (trx) => {
      await trx('warehouses').where({ shop_id: fixture.shopId, warehouse_id: fixture.warehouseId })
        .update({ active: warehouseActive });
      await trx('warehouse_locations').insert({
        shop_id: fixture.shopId, warehouse_id: fixture.warehouseId,
        location_code: 'A-1', parent_location_code: fixture.rootLocationCode, type, active,
      });
    });
    expect((await signalsFor(fixture.shopId))['wms.zonesConfigured']).toBe(mapped);
  });

  it('does not treat an active bin in a non-default warehouse as mapped', async () => {
    const fixture = await createFixture();
    const secondaryWarehouseId = crypto.randomUUID();
    const secondaryRoot = `WH-${fixture.shopId}-SECONDARY-ROOT`;

    await withTenant(fixture.shopId, async (trx) => {
      await trx('warehouses').insert({
        warehouse_id: secondaryWarehouseId,
        shop_id: fixture.shopId,
        name: 'Secondary warehouse',
        root_location_code: secondaryRoot,
        is_default: false,
        active: true,
      });

      await trx('warehouse_locations').insert([
        {
          shop_id: fixture.shopId,
          warehouse_id: secondaryWarehouseId,
          location_code: secondaryRoot,
          parent_location_code: null,
          type: 'warehouse',
          active: true,
        },
        {
          shop_id: fixture.shopId,
          warehouse_id: secondaryWarehouseId,
          location_code: 'SECONDARY-A-1',
          parent_location_code: secondaryRoot,
          type: 'bin',
          active: true,
        },
      ]);
    });

    expect(
      (await signalsFor(fixture.shopId))['wms.zonesConfigured']
    ).toBe(false);
  });

  it('serves authenticated onboarding readiness after real password login', async () => {
    const fixture = await createFixture();
    const login = await request(app).post('/api/v1/auth/login').send({ email: fixture.email, password });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toEqual(expect.any(String));
    const response = await request(app).get('/api/v1/onboarding/readiness')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.shopId).toBe(fixture.shopId);
    const wms = response.body.modules.find((module: { moduleId: string }) => module.moduleId === 'wms');
    expect(wms.signals).toEqual(expect.arrayContaining([
      { name: 'wms.zonesConfigured', value: false },
      { name: 'wms.openingInventoryReconciliationRequired', value: true },
      { name: 'wms.openingInventoryReconciled', value: false },
    ]));
    expect(await withTenant(fixture.shopId, (trx) => trx('inventory_recount_tasks')
      .where({ shop_id: fixture.shopId, purpose: 'opening_inventory' }))).toEqual([]);
  });

  it('rejects reuse without resetting an existing fixture', async () => {
    const fixture = await createFixture();
    await expect(seedFirstEntry(fixture.shopId, { email: fixture.email, password }))
      .rejects.toThrow('FIRST_ENTRY_REQUIRES_EMPTY_TABLE: integrations');
    expect(await resolveAuthUserByEmail(fixture.email)).toMatchObject({ id: fixture.ownerId });
  });
});
