import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('FINAL-RECON-01A — frontend processed-order limit ownership', () => {
  const tierConfig = read('apps/frontend/src/config/tiers.ts');
  const shippedBanner = read(
    'apps/frontend/src/components/ShippedOrderCapBanner.tsx',
  );
  const billingSettings = read(
    'apps/frontend/src/pages/account-settings/BillingSettings.tsx',
  );
  const topnav = read(
    'apps/frontend/src/layouts/AppLayout/TopnavbarContent.tsx',
  );
  const billingUsageHook = read('apps/frontend/src/hooks/useBillingUsage.ts');

  it('owns processed-order allowances only in @lasyncro/commercial-policy', () => {
    expect(tierConfig).not.toMatch(
      /\bTIER_SHIPPED_ORDER_CAP\b/,
    );

    for (const [name, source] of [
      ['ShippedOrderCapBanner', shippedBanner],
    ] as const) {
      expect(source).not.toMatch(
        /\bTIER_SHIPPED_ORDER_CAP\b/,
      );

      expect(source).toMatch(
        /from ['"]@lasyncro\/commercial-policy['"]/,
      );

      expect(source).toMatch(
        /\bstandardLimits\s*\(/,
      );

      expect(source).toMatch(
        /\bshippedOrderCap\b/,
      );
    }
  });

  it('BillingSettings and topnav consume the shared billing usage read model', () => {
    for (const source of [billingSettings, topnav]) {
      expect(source).toMatch(/useBillingUsage/);
      expect(source).not.toMatch(/TIER_SHIPPED_ORDER_CAP/);
      expect(source).not.toMatch(/PLAN_PROCESSED_ORDER_OVERAGE_CENTS/);
      expect(source).not.toMatch(/\b(?:2000|7500|20000)\b/);
      expect(source).not.toMatch(/\$0\.0[468]/);
    }

    expect(billingUsageHook).toMatch(/queryKey:\s*\['billing-usage'\]/);
    expect(billingUsageHook).toMatch(/\/api\/v1\/billing\/usage/);
  });
});
