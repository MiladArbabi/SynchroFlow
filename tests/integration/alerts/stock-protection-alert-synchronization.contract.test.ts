// STOCK-PROTECT-03 / Slice 6 — Stock Protection alert synchronization cutover.
// Permanent RED regression contract.
//
// Expected RED at authoring time:
//   api-src/services/alerts/stockProtectionAlertSynchronizer does not exist yet.
// Once the synchronizer exists, these tests exercise real alert-row lifecycle
// behavior against the disposable synchroflow_test_* integration database while
// mocking evaluateStockProtectionForShop as the canonical planning boundary.

import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { aggregateAlertsForShop } from 'api-src/services/alerts/alerts.aggregator';
import type { StockProtectionMonitoringResult } from 'api-src/services/inventory/stockProtectionMonitoring';

const mockEvaluateStockProtectionForShop = jest.fn();

jest.mock('api-src/services/inventory/stockProtectionMonitoring', () => ({
  evaluateStockProtectionForShop: (...args: unknown[]) => mockEvaluateStockProtectionForShop(...args),
}));

async function loadSynchronizer() {
  return import('api-src/services/alerts/stockProtectionAlertSynchronizer');
}

async function createFixtureShop(prefix: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${crypto.randomUUID().slice(0, 8)}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedAlert(
  shopId: number,
  overrides: Partial<{
    alert_key: string;
    alert_type: string;
    source: string;
    severity: string;
    entity_type: string | null;
    entity_id: string | null;
    treatment: string | null;
    is_active: boolean;
    category: string;
  }>,
) {
  await withTenant(shopId, (trx) =>
    trx('alerts').insert({
      shop_id: shopId,
      alert_key: overrides.alert_key ?? `fixture:${crypto.randomUUID()}`,
      source: overrides.source ?? 'fixture',
      alert_type: overrides.alert_type ?? 'fixture_alert',
      severity: overrides.severity ?? 'warning',
      title: 'Fixture alert',
      message: 'Fixture alert message',
      entity_type: overrides.entity_type ?? 'shop',
      entity_id: overrides.entity_id ?? null,
      treatment: overrides.treatment ?? null,
      is_active: overrides.is_active ?? true,
      resolved_at: overrides.is_active === false ? trx.fn.now() : null,
      category: overrides.category ?? 'stock_reorder',
      audience: 'all',
    }),
  );
}

async function activeAlerts(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('alerts')
      .where({ shop_id: shopId, is_active: true })
      .select('alert_key', 'alert_type', 'severity', 'entity_type', 'entity_id', 'treatment', 'is_active')
      .orderBy('alert_key'),
  );
}

async function alertByKey(shopId: number, alertKey: string) {
  return withTenant(shopId, (trx) =>
    trx('alerts')
      .where({ shop_id: shopId, alert_key: alertKey })
      .first('alert_key', 'alert_type', 'source', 'severity', 'entity_type', 'entity_id', 'treatment', 'is_active', 'resolved_at'),
  );
}

async function syncStockProtection(shopId: number, variantIds?: string[]) {
  const mod = await loadSynchronizer();
  await withTenant(shopId, (trx) => mod.syncStockProtectionAlertsForShop(trx, shopId, variantIds));
}

describe('Stock Protection canonical alert synchronization lifecycle', () => {
  beforeEach(() => {
    mockEvaluateStockProtectionForShop.mockReset();
  });

  it('full-shop sync upserts active canonical rows, persists treatment, maps severity, and resolves stale/none rows', async () => {
    const shopId = await createFixtureShop('sp-alert-sync-full');
    const criticalVariant = crypto.randomUUID();
    const warningVariant = crypto.randomUUID();
    const inboundVariant = crypto.randomUUID();
    const planningDataVariant = crypto.randomUUID();
    const noneVariant = crypto.randomUUID();
    const staleVariant = crypto.randomUUID();

    await seedAlert(shopId, {
      alert_key: `stock_protection:${noneVariant}`,
      alert_type: 'stock_protection',
      source: 'stock_protection',
      entity_type: 'variant',
      entity_id: noneVariant,
      treatment: 'reorder_now',
      is_active: true,
    });
    await seedAlert(shopId, {
      alert_key: `stock_protection:${staleVariant}`,
      alert_type: 'stock_protection',
      source: 'stock_protection',
      entity_type: 'variant',
      entity_id: staleVariant,
      treatment: 'reorder_now',
      is_active: true,
    });

    mockEvaluateStockProtectionForShop.mockResolvedValue([
      row(criticalVariant, 'reorder_now', 'critical', 8),
      row(warningVariant, 'finish_reorder', 'warning', 3),
      row(inboundVariant, 'receive_inbound', 'warning', 0),
      row(planningDataVariant, 'complete_setup', 'planning_data_required', null),
      row(noneVariant, 'none', 'healthy', 0),
    ]);

    await syncStockProtection(shopId);

    expect(await alertByKey(shopId, `stock_protection:${criticalVariant}`)).toMatchObject({
      alert_type: 'stock_protection',
      entity_type: 'variant',
      entity_id: criticalVariant,
      treatment: 'reorder_now',
      severity: 'critical',
      is_active: true,
    });
    expect(await alertByKey(shopId, `stock_protection:${warningVariant}`)).toMatchObject({
      treatment: 'finish_reorder',
      severity: 'warning',
      is_active: true,
    });
    expect(await alertByKey(shopId, `stock_protection:${inboundVariant}`)).toMatchObject({
      treatment: 'receive_inbound',
      severity: 'warning',
      is_active: true,
    });
    expect(await alertByKey(shopId, `stock_protection:${planningDataVariant}`)).toMatchObject({
      treatment: 'complete_setup',
      severity: 'warning',
      is_active: true,
    });
    expect(await alertByKey(shopId, `stock_protection:${noneVariant}`)).toMatchObject({
      is_active: false,
    });
    expect((await alertByKey(shopId, `stock_protection:${noneVariant}`)).resolved_at).toBeTruthy();
    expect(await alertByKey(shopId, `stock_protection:${staleVariant}`)).toMatchObject({
      is_active: false,
    });
    expect((await alertByKey(shopId, `stock_protection:${staleVariant}`)).resolved_at).toBeTruthy();
  });

  it('scoped sync changes only supplied variants and [] evaluates/reconciles nothing', async () => {
    const shopId = await createFixtureShop('sp-alert-sync-scoped');
    const scopedVariant = crypto.randomUUID();
    const untouchedVariant = crypto.randomUUID();

    await seedAlert(shopId, {
      alert_key: `stock_protection:${scopedVariant}`,
      alert_type: 'stock_protection',
      source: 'stock_protection',
      entity_type: 'variant',
      entity_id: scopedVariant,
      treatment: 'reorder_now',
      is_active: true,
    });
    await seedAlert(shopId, {
      alert_key: `stock_protection:${untouchedVariant}`,
      alert_type: 'stock_protection',
      source: 'stock_protection',
      entity_type: 'variant',
      entity_id: untouchedVariant,
      treatment: 'reorder_now',
      is_active: true,
    });

    mockEvaluateStockProtectionForShop.mockResolvedValueOnce([
      row(scopedVariant, 'finish_reorder', 'critical', 4),
    ]);
    await syncStockProtection(shopId, [scopedVariant]);

    expect(mockEvaluateStockProtectionForShop).toHaveBeenLastCalledWith(expect.anything(), shopId, [scopedVariant]);
    expect(await alertByKey(shopId, `stock_protection:${scopedVariant}`)).toMatchObject({
      treatment: 'finish_reorder',
      is_active: true,
    });
    expect(await alertByKey(shopId, `stock_protection:${untouchedVariant}`)).toMatchObject({
      treatment: 'reorder_now',
      is_active: true,
    });

    mockEvaluateStockProtectionForShop.mockClear();
    await syncStockProtection(shopId, []);

    expect(mockEvaluateStockProtectionForShop).not.toHaveBeenCalled();
    expect(await alertByKey(shopId, `stock_protection:${scopedVariant}`)).toMatchObject({
      treatment: 'finish_reorder',
      is_active: true,
    });
    expect(await alertByKey(shopId, `stock_protection:${untouchedVariant}`)).toMatchObject({
      treatment: 'reorder_now',
      is_active: true,
    });
  });

  it('full sync resolves historical legacy replenishment alerts without deleting or deactivating foreign alerts', async () => {
    const shopId = await createFixtureShop('sp-alert-sync-cutover');
    const variantId = crypto.randomUUID();

    for (const alertType of ['low_stock_reorder', 'stockout_risk', 'reorder_warning']) {
      await seedAlert(shopId, {
        alert_key: `legacy:${alertType}:${variantId}`,
        alert_type: alertType,
        entity_type: 'variant',
        entity_id: variantId,
        is_active: true,
      });
    }
    await seedAlert(shopId, {
      alert_key: 'inventory:order-block:123',
      alert_type: 'inventory',
      source: 'decision',
      category: 'revenue_at_risk',
      is_active: true,
    });
    await seedAlert(shopId, {
      alert_key: 'foreign:margin:123',
      alert_type: 'missing_cogs',
      source: 'snapshot',
      category: 'data_trust',
      is_active: true,
    });

    mockEvaluateStockProtectionForShop.mockResolvedValue([
      row(variantId, 'reorder_now', 'critical', 10),
    ]);

    await syncStockProtection(shopId);

    for (const alertType of ['low_stock_reorder', 'stockout_risk', 'reorder_warning']) {
      const legacy = await alertByKey(shopId, `legacy:${alertType}:${variantId}`);
      expect(legacy).toMatchObject({ alert_type: alertType, is_active: false });
      expect(legacy.resolved_at).toBeTruthy();
    }
    expect(await alertByKey(shopId, 'inventory:order-block:123')).toMatchObject({ is_active: true });
    expect(await alertByKey(shopId, 'foreign:margin:123')).toMatchObject({ is_active: true });

    const active = await activeAlerts(shopId);
    expect(active.filter((a: any) => ['low_stock_reorder', 'stockout_risk', 'reorder_warning'].includes(a.alert_type))).toEqual([]);
    expect(active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ alert_key: `stock_protection:${variantId}`, alert_type: 'stock_protection' }),
      ]),
    );
  });
});

describe('aggregateAlertsForShop ownership-scoped orphan reconciliation', () => {
  it('does not deactivate an active foreign-owned alert just because the key is absent from aggregator output', async () => {
    const shopId = await createFixtureShop('sp-alert-agg-owner');
    const foreignAlertKey = 'decision:order-block:inventory:123';
    mockEvaluateStockProtectionForShop.mockResolvedValue([]);

    await seedAlert(shopId, {
      alert_key: foreignAlertKey,
      alert_type: 'inventory',
      source: 'decision',
      entity_type: 'order',
      entity_id: crypto.randomUUID(),
      category: 'revenue_at_risk',
      is_active: true,
    });

    await aggregateAlertsForShop(shopId);

    expect(await alertByKey(shopId, foreignAlertKey)).toMatchObject({
      alert_key: foreignAlertKey,
      alert_type: 'inventory',
      source: 'decision',
      is_active: true,
    });
  });
});

function row(
  lasyncro_variant_id: string,
  treatment: StockProtectionMonitoringResult['treatment'],
  reorder_urgency: StockProtectionMonitoringResult['reorder_urgency'],
  suggested_reorder_qty: number | null,
): StockProtectionMonitoringResult {
  return { lasyncro_variant_id, treatment, reorder_urgency, suggested_reorder_qty };
}
