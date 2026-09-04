import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-PH-01 subscription analytics taxonomy', () => {
  test('Shopify cancellation uses the canonical subscription_cancelled event', () => {
    const handler = source(
      'apps/backend/src/api/shopify/handlers/handleAppSubscriptionUpdate.ts'
    );

    expect(handler).toContain("'subscription_cancelled'");
    expect(handler).not.toContain("'subscription_canceled'");
  });

  test('Stripe updated subscriptions count as upgrades only when tier rank increases', () => {
    const handler = source(
      'apps/backend/src/api/billing/handlers/handleSubscriptionUpsert.ts'
    );

    expect(handler).toContain('TIER_ORDER');
    expect(handler).toContain('priorTier');
    expect(handler).toContain('TIER_ORDER[tier] > TIER_ORDER[priorTier]');
    expect(handler).not.toMatch(
      /event:\s*stripeEventType\s*===\s*'customer\.subscription\.created'[\s\S]{0,180}\?\s*'subscription_activated'[\s\S]{0,100}:\s*'subscription_upgraded'/
    );
  });
});
