import fs from 'fs';
import path from 'path';

const MUTATORS = [
  'apps/backend/src/services/shopify/applyShopifyBillingState.service.ts',
  'apps/backend/src/api/billing/handlers/handleSubscriptionUpsert.ts',
  'apps/backend/src/api/billing/handlers/handleSubscriptionDeleted.ts',
  'apps/backend/src/services/shopify/forceDowngradeToStarter.service.ts',
  'apps/backend/src/services/trial-expiry.service.ts',
];

describe('commercial entitlement authority', () => {
  it.each(MUTATORS)(
    '%s derives commercial module/flag grants and revocations from commercial-policy',
    (relativePath) => {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

      expect(source).toContain('modulesForTier');
      expect(source).toContain('flagsForTier');

      // Frozen compatibility tier config must never again decide entitlement
      // module/flag grants or downgrade diffs.
      expect(source).not.toMatch(
        /\b(?:tierConfig|priorTierConfig|starterConfig|growthConfig)\.(?:modules|flags)\b/
      );
    }
  );
});
