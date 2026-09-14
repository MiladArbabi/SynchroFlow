// tests/integration/overview/morning-brief-stock-protection.contract.test.ts
//
// STOCK-PROTECT-03 Slice 3A — Morning Brief compatibility for
// alert_type='stock_protection'. PERMANENT regression contract, authored RED.
// ===========================================================================
// INDEPENDENTLY RED (at authoring time)
//   overviewMorningBrief.resolver.ts's alerts query has no stock_protection-
//   aware predicate at all — every stock_protection row (actionable or not)
//   competes for the LIMIT 5 slots purely by severity/revenue rank. Tests B
//   and C below construct exactly the starvation scenario the ratified
//   design exists to prevent, and fail against the CURRENT resolver because
//   it has no mechanism to exclude a null-action stock_protection row before
//   LIMIT — narrowly attributable to the missing prefilter, not a malformed
//   test.
//
// Uses the NODE_ENV=development trust-gate bypass already present in
// computeMorningBrief (restored in afterAll) rather than constructing a full
// trust-eligibility fixture — this is a resolver-level unit/integration test
// of ranking behavior, not a trust-gate test.

import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import * as shopResolutionModule from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { computeMorningBrief } from 'api-src/services/overview-ft2/overviewMorningBrief.resolver';

const now = new Date('2026-09-13T12:00:00.000Z');
let originalNodeEnv: string | undefined;

beforeAll(() => {
  originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development'; // trust-gate bypass, see header
});

afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

async function bootstrapShop(unique: string, tier: 'starter' | 'core' | 'growth' | 'scale' = 'growth') {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sp-brief-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, async (trx) => {
    await trx('shops').where({ id: shopId }).update({ timezone: 'UTC' });
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier,
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });
  });

  return shopId;
}

async function seedLegacyCriticalAlert(shopId: number, suffix: string, revenueImpact: number) {
  await withTenant(shopId, async (trx) => {
    await trx('alerts').insert({
      shop_id: shopId,
      alert_key: `demand:stockout_risk:${suffix}`,
      source: 'demand',
      alert_type: 'stockout_risk',
      severity: 'critical',
      title: `Legacy critical ${suffix}`,
      message: 'Legacy fixture message',
      entity_id: crypto.randomUUID(),
      entity_type: 'variant',
      revenue_impact: revenueImpact,
      is_active: true,
      category: 'stock_reorder',
      audience: 'all',
    });
  });
}

async function seedStockProtectionAlerts(
  shopId: number,
  count: number,
  overrides: Partial<{
    treatment: string | null;
    entity_type: string | null;
    entity_id: string | null;
    is_active: boolean;
    resolved_at: Date | null;
    revenueImpactBase: number;
  }> = {},
) {
  await withTenant(shopId, async (trx) => {
    const rows = Array.from({ length: count }).map((_, i) => ({
      shop_id: shopId,
      alert_key: `stock_protection:${crypto.randomUUID()}`,
      source: 'projection',
      alert_type: 'stock_protection',
      severity: 'critical',
      title: `SP fixture ${i}`,
      message: 'SP fixture message',
      entity_id: overrides.entity_id === null ? null : (overrides.entity_id ?? crypto.randomUUID()),
      entity_type: overrides.entity_type === null ? null : (overrides.entity_type ?? 'variant'),
      treatment: overrides.treatment ?? 'reorder_now',
      // Ranked ABOVE the legacy fixtures via a very high revenue_impact,
      // so they must be excluded by eligibility, not merely out-ranked.
      revenue_impact: (overrides.revenueImpactBase ?? 999999) + i,
      is_active: overrides.is_active ?? true,
      resolved_at: overrides.resolved_at ?? null,
      category: 'stock_reorder',
      audience: 'all',
    }));
    await trx('alerts').insert(rows);
  });
}

describe('Morning Brief — stock_protection actionable prefilter', () => {
  it('B: 25 complete_setup SP rows ranked above 5 legacy alerts -> five legacy alerts returned', async () => {
    const shopId = await bootstrapShop('b', 'growth');
    for (let i = 0; i < 5; i++) {
      await seedLegacyCriticalAlert(shopId, `b-${i}`, 1000 - i);
    }
    await seedStockProtectionAlerts(shopId, 25, { treatment: 'complete_setup' });

    const brief = await computeMorningBrief({ shopId });

    expect(brief).not.toBeNull();
    expect(brief!.signals).toHaveLength(5);
    expect(brief!.signals.every((s) => s.alertType === 'stockout_risk')).toBe(true);
  });

  it('C: 25 commercially-denied reorder_now SP rows above 5 legacy alerts -> five legacy alerts returned', async () => {
    const shopId = await bootstrapShop('c', 'starter'); // starter: no demand.forecasting
    for (let i = 0; i < 5; i++) {
      await seedLegacyCriticalAlert(shopId, `c-${i}`, 1000 - i);
    }
    await seedStockProtectionAlerts(shopId, 25, { treatment: 'reorder_now' });

    const brief = await computeMorningBrief({ shopId });

    expect(brief).not.toBeNull();
    expect(brief!.signals).toHaveLength(5);
    expect(brief!.signals.every((s) => s.alertType === 'stockout_risk')).toBe(true);
  });

  it('D: entity_id null SP rows cannot consume a slot even when top-ranked', async () => {
    const shopId = await bootstrapShop('d', 'growth');
    for (let i = 0; i < 5; i++) {
      await seedLegacyCriticalAlert(shopId, `d-${i}`, 1000 - i);
    }
    await seedStockProtectionAlerts(shopId, 25, { treatment: 'reorder_now', entity_id: null });

    const brief = await computeMorningBrief({ shopId });

    expect(brief!.signals).toHaveLength(5);
    expect(brief!.signals.every((s) => s.alertType === 'stockout_risk')).toBe(true);
  });

  it('E: entity_type != variant SP rows cannot consume a slot', async () => {
    const shopId = await bootstrapShop('e', 'growth');
    for (let i = 0; i < 5; i++) {
      await seedLegacyCriticalAlert(shopId, `e-${i}`, 1000 - i);
    }
    await seedStockProtectionAlerts(shopId, 25, { treatment: 'reorder_now', entity_type: 'order' });

    const brief = await computeMorningBrief({ shopId });

    expect(brief!.signals).toHaveLength(5);
    expect(brief!.signals.every((s) => s.alertType === 'stockout_risk')).toBe(true);
  });

  it('F: unknown treatment SP rows cannot consume a slot', async () => {
    const shopId = await bootstrapShop('f', 'growth');
    for (let i = 0; i < 5; i++) {
      await seedLegacyCriticalAlert(shopId, `f-${i}`, 1000 - i);
    }
    await seedStockProtectionAlerts(shopId, 25, { treatment: 'some_future_treatment' });

    const brief = await computeMorningBrief({ shopId });

    expect(brief!.signals).toHaveLength(5);
    expect(brief!.signals.every((s) => s.alertType === 'stockout_risk')).toBe(true);
  });

  it('is_active=true but resolved_at set cannot consume a slot', async () => {
    const shopId = await bootstrapShop('g', 'growth');
    for (let i = 0; i < 5; i++) {
      await seedLegacyCriticalAlert(shopId, `g-${i}`, 1000 - i);
    }
    await seedStockProtectionAlerts(shopId, 25, { treatment: 'reorder_now', resolved_at: now });

    const brief = await computeMorningBrief({ shopId });

    expect(brief!.signals).toHaveLength(5);
    expect(brief!.signals.every((s) => s.alertType === 'stockout_risk')).toBe(true);
  });

  it('G: all-legacy fixture produces the exact existing first-five result, unchanged', async () => {
    const shopId = await bootstrapShop('g-legacy', 'growth');
    for (let i = 0; i < 8; i++) {
      await seedLegacyCriticalAlert(shopId, `gl-${i}`, 1000 - i);
    }

    const brief = await computeMorningBrief({ shopId });

    expect(brief!.signals).toHaveLength(5);
    // Highest revenue_impact first among the 8 legacy rows.
    expect(brief!.signals.map((s) => s.id)).toEqual([
      'demand:stockout_risk:gl-0',
      'demand:stockout_risk:gl-1',
      'demand:stockout_risk:gl-2',
      'demand:stockout_risk:gl-3',
      'demand:stockout_risk:gl-4',
    ]);
  });

  it('H: fully-entitled actionable SP row competes normally and uses the shared resolver action', async () => {
    const shopId = await bootstrapShop('h', 'growth');
    const variantId = crypto.randomUUID();
    await withTenant(shopId, async (trx) => {
      await trx('alerts').insert({
        shop_id: shopId,
        alert_key: `stock_protection:${variantId}`,
        source: 'projection',
        alert_type: 'stock_protection',
        severity: 'critical',
        title: 'SP actionable',
        message: 'SP fixture message',
        entity_id: variantId,
        entity_type: 'variant',
        treatment: 'reorder_now',
        revenue_impact: 5000000, // ranks above every legacy fixture below
        is_active: true,
        category: 'stock_reorder',
        audience: 'all',
      });
    });
    for (let i = 0; i < 5; i++) {
      await seedLegacyCriticalAlert(shopId, `h-${i}`, 1000 - i);
    }

    const brief = await computeMorningBrief({ shopId });

    expect(brief!.signals[0]).toMatchObject({
      alertType: 'stock_protection',
      module: 'suppliers-portal',
      deepLink: `/suppliers-portal/sourcing?variantId=${variantId}`,
    });
    expect((brief!.signals[0] as any).actionLabel).toBe('Reorder now');
    // Never the generic /overview fallback for a resolvable SP action.
    expect(brief!.signals[0].deepLink).not.toBe('/overview');
  });

  it('resolveTierForShop is invoked exactly once per Morning Brief computation, not once per alert', async () => {
    const shopId = await bootstrapShop('tiercount', 'growth');
    for (let i = 0; i < 5; i++) {
      await seedLegacyCriticalAlert(shopId, `tiercount-${i}`, 1000 - i);
    }
    await seedStockProtectionAlerts(shopId, 10, { treatment: 'reorder_now' });

    const spy = jest.spyOn(shopResolutionModule, 'resolveTierForShop');
    try {
      await computeMorningBrief({ shopId });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(shopId);
    } finally {
      spy.mockRestore();
    }
  });

  it('null-action stock_protection never falls back to /overview', async () => {
    const shopId = await bootstrapShop('i', 'growth');
    await seedStockProtectionAlerts(shopId, 1, { treatment: 'complete_setup', revenueImpactBase: 1 });

    const brief = await computeMorningBrief({ shopId });

    expect(brief!.signals.find((s) => s.alertType === 'stock_protection')).toBeUndefined();
    expect(brief!.signals.some((s) => s.deepLink === '/overview')).toBe(false);
  });
});
