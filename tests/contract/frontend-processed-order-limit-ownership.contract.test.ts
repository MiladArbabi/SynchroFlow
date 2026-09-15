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

  it('owns processed-order allowances only in @lasyncro/commercial-policy', () => {
    expect(tierConfig).not.toMatch(
      /\bTIER_SHIPPED_ORDER_CAP\b/,
    );

    for (const [name, source] of [
      ['ShippedOrderCapBanner', shippedBanner],
      ['BillingSettings', billingSettings],
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
});
