// tests/integration/migrations/stock-protection-reconciliation-tenants-function.migration.test.ts
//
// STOCK-PROTECT-03 Slice 4 — list_stock_protection_reconciliation_tenants()
// SECURITY DEFINER migration contract. PERMANENT regression contract,
// authored RED.
// ===========================================================================
// REQUIRED RED (at authoring time): no migration defining
// public.list_stock_protection_reconciliation_tenants() exists yet — every
// query against it fails with a clear "function ... does not exist" Postgres
// error, narrowly attributable to the missing Slice 4 migration.

import crypto from 'crypto';
import db, {
  setTenantContext,
  systemTransaction,
  systemQuery,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

async function createFixtureShop(unique: string, tier: string, status: string): Promise<number> {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sp-fn-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, (trx) =>
    trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier,
      status,
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    }),
  );

  return shopId;
}

describe('list_stock_protection_reconciliation_tenants() — SECURITY DEFINER migration contract', () => {
  it('returns active/trialing candidate shops when called via the sf_app runtime role', async () => {
    const shopActive = await createFixtureShop(`active-${crypto.randomUUID().slice(0, 8)}`, 'growth', 'active');
    const shopTrialing = await createFixtureShop(`trialing-${crypto.randomUUID().slice(0, 8)}`, 'growth', 'trialing');
    const shopCanceled = await createFixtureShop(`canceled-${crypto.randomUUID().slice(0, 8)}`, 'growth', 'canceled');

    const result = await systemQuery(
      db.raw('SELECT shop_id FROM public.list_stock_protection_reconciliation_tenants()'),
    );
    const shopIds = new Set(result.rows.map((r: any) => Number(r.shop_id)));

    expect(shopIds.has(shopActive)).toBe(true);
    expect(shopIds.has(shopTrialing)).toBe(true);
    expect(shopIds.has(shopCanceled)).toBe(false);
  });

  it('PUBLIC cannot execute the function', async () => {
    const result = await systemQuery(
      db.raw(
        `SELECT has_function_privilege('public', 'public.list_stock_protection_reconciliation_tenants()', 'EXECUTE') as can_execute`,
      ),
    );
    expect(result.rows[0].can_execute).toBe(false);
  });

  it('sf_app CAN execute the function', async () => {
    const result = await systemQuery(
      db.raw(
        `SELECT has_function_privilege('sf_app', 'public.list_stock_protection_reconciliation_tenants()', 'EXECUTE') as can_execute`,
      ),
    );
    expect(result.rows[0].can_execute).toBe(true);
  });

  it('works with no app.current_tenant set — cross-tenant discovery is granted by SECURITY DEFINER, not by an app-level bypass', async () => {
    const shopId = await createFixtureShop(`notenant-${crypto.randomUUID().slice(0, 8)}`, 'scale', 'active');

    // Deliberately no setTenantContext / withTenant here — a fresh
    // transaction with app.current_tenant never set.
    const result = await systemTransaction(async (trx) =>
      systemQuery(trx.raw('SELECT shop_id FROM public.list_stock_protection_reconciliation_tenants()')),
    );

    const shopIds = new Set(result.rows.map((r: any) => Number(r.shop_id)));
    expect(shopIds.has(shopId)).toBe(true);
  });
});
