import fs from 'fs';
import path from 'path';

describe('entitlements billing-status payload contract', () => {
  const controller = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'apps/backend/src/api/entitlements/entitlements.controller.ts',
    ),
    'utf8',
  );

  it('returns canonical shop_subscriptions.status as subscriptionStatus', () => {
    expect(controller).toMatch(
      /subscriptionStatus:\s*subscription\?\.status\s*\?\?\s*null/,
    );
  });

  it('returns an unresolved billing provider as null, never a fabricated stripe default', () => {
    expect(controller).toMatch(
      /billingProvider:\s*subscription\?\.billing_provider\s*\?\?\s*null/,
    );
    expect(controller).not.toMatch(
      /billingProvider:[^,\n]*\?\?\s*['"]stripe['"]/,
    );
  });
});
