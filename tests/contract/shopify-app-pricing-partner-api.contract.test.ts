import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const RECONCILIATION_SOURCE = 'apps/backend/src/services/shopify/shopifyBillingReconciliation.service.ts';
const SWEEP_SOURCE = 'apps/backend/src/services/shopify/shopifyBillingReconciliationSweep.service.ts';

function source(relPath: string): string {
  return fs.readFileSync(path.join(REPO, relPath), 'utf8');
}

describe('MON-REM-01B-4 — Shopify App Pricing Partner API reconciliation boundary', () => {
  const reconciliation = source(RECONCILIATION_SOURCE);
  const sweep = source(SWEEP_SOURCE);

  it('requires Partner API configuration at the billing reconciliation boundary', () => {
    expect(reconciliation).toContain('SHOPIFY_PARTNER_ORG_ID');
    expect(reconciliation).toContain('SHOPIFY_PARTNER_API_ACCESS_TOKEN');
    expect(reconciliation).toContain('SHOPIFY_APP_GID');
  });

  it('uses Partner API activeSubscription as the canonical Shopify App Pricing source', () => {
    expect(reconciliation).toMatch(/\bactiveSubscription\b/);
    expect(reconciliation).toMatch(/partners\.shopify\.com|Partner API|shopifyPartner/i);
  });

  it('queries the Partner API 2026-07 pricing and usage shape', () => {
    expect(reconciliation).toContain('FlatRatePrice');
    expect(reconciliation).toContain('TieredPrice');
    expect(reconciliation).toContain('tiersMode');
    expect(reconciliation).toContain('quantity');
    expect(reconciliation).toContain('currencyCode');
    expect(reconciliation).not.toContain('RecurringApplicationCharge');
    expect(reconciliation).not.toContain('UsageApplicationCharge');
    expect(reconciliation).not.toContain('balanceUsed');
  });

  it('does not use Admin currentAppInstallation.activeSubscriptions as the commercial reconciliation authority', () => {
    expect(reconciliation).not.toMatch(/currentAppInstallation\s*{[\s\S]*activeSubscriptions/);
    expect(reconciliation).not.toContain('currentAppInstallation');
    expect(reconciliation).not.toContain('activeSubscriptions');
  });

  it('scheduled reconciliation sweep delegates through applyShopifyBillingState rather than duplicating provider behavior', () => {
    expect(sweep).toContain('applyShopifyBillingState.service');
    expect(sweep).toMatch(/\bapplyShopifyBillingState\s*\(\s*row\.shop_id\s*,\s*trx\s*\)/);
    expect(sweep).not.toContain('activeSubscription');
    expect(sweep).not.toContain('activeSubscriptions');
  });
});
