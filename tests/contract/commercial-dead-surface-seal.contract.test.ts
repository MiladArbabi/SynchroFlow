import fs from 'fs';
import path from 'path';

import {
  isEffectivePersistedGrant,
  MODULE_IDS,
} from '@lasyncro/commercial-policy';
import {
  FT2_PAID_FLAGS,
  FT2_PAID_MODULES,
} from 'api-src/contracts/ft2-paid.contract';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('COMMERCIAL-DEAD-SURFACE-01D — commercial identity seal', () => {
  it('echo-hub is not a live ModuleId', () => {
    expect(MODULE_IDS).not.toContain('echo-hub');
  });

  it.each(['customers', 'specter', 'specter_sdk_free', 'finances', 'cashflow', 'echo-hub'])(
    '%s is a non-effective persisted grant identity',
    (moduleKey) => {
      expect(isEffectivePersistedGrant({ moduleKey, source: 'billing' })).toBe(false);
      expect(isEffectivePersistedGrant({ moduleKey, source: 'admin' })).toBe(false);
      expect(isEffectivePersistedGrant({ moduleKey, source: 'migration' })).toBe(false);
    },
  );

  it.each(['customers.segmentation', 'specter.full_capture', 'cashflow.revenue_buckets'])(
    '%s is a non-effective persisted grant flag',
    (flagKey) => {
      expect(isEffectivePersistedGrant({ flagKey, source: 'billing' })).toBe(false);
      expect(isEffectivePersistedGrant({ flagKey, source: 'admin' })).toBe(false);
      expect(isEffectivePersistedGrant({ flagKey, source: 'migration' })).toBe(false);
    },
  );

  it('keeps explicit commercial grants and required internal plumbing effective', () => {
    expect(isEffectivePersistedGrant({ moduleKey: 'wms', source: 'admin' })).toBe(true);
    expect(isEffectivePersistedGrant({ moduleKey: 'shopify_integration', source: 'free_tier_default' })).toBe(true);
    expect(isEffectivePersistedGrant({ moduleKey: 'barcodes', source: 'free_tier_default' })).toBe(true);
  });

  it('historical plan-materialization sources fail closed for standard commercial modules', () => {
    for (const source of ['free_tier_default', 'ft2_free_baseline', 'trial:growth', 'tier:growth', 'shopify_billing:growth', 'reviewer_seed:growth', 'dev_seed:growth', 'manual:scale_upgrade']) {
      expect({ source, effective: isEffectivePersistedGrant({ moduleKey: 'order-nexus', source }) })
        .toEqual({ source, effective: false });
    }
  });
});

describe('COMMERCIAL-DEAD-SURFACE-01D — FT2 paid delta', () => {
  it('does not contain discontinued modules or paused/deprecated flags', () => {
    expect(FT2_PAID_MODULES).not.toContain('specter');
    expect(FT2_PAID_MODULES).not.toContain('echo-hub');
    expect(FT2_PAID_FLAGS).not.toContain('customers.segmentation');
    expect(FT2_PAID_FLAGS).not.toContain('specter.full_capture');
  });
});

describe('COMMERCIAL-DEAD-SURFACE-01D — entitlement plan writers', () => {
  const WRITERS = [
    'apps/backend/src/api/auth/auth.controller.ts',
    'apps/backend/src/api/integrations/integration.controller.ts',
    'apps/backend/seeds/dev_seed.ts',
    'apps/backend/src/scripts/seed_reviewer.ts',
  ];

  it.each(WRITERS)('%s derives entitlement rows from modulesForTier()/flagsForTier()', (rel) => {
    const src = read(rel);
    expect(src).toContain('modulesForTier(');
    expect(src).toContain('flagsForTier(');
    expect(src).not.toMatch(/getTierConfig\([^)]*\)\.modules/);
    expect(src).not.toMatch(/getTierConfig\([^)]*\)\.flags/);
    expect(src).not.toMatch(/\b\w+Config\.modules\.map/);
    expect(src).not.toMatch(/\b\w+Config\.flags\.map/);
  });
});
