// tests/unit/backend/entitlements/entitlements.revocation.test.ts

import db from 'api-db';
import { EntitlementsService } from 'api-src/services/entitlements.service';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';

// NOTE: This service does NOT exist yet.
// The test MUST fail until we implement it.
import { EntitlementRevocationService } from 'api-src/services/entitlement-revocation.service';

describe('EntitlementRevocationService – explicit revocation', () => {
  beforeEach(async () => {
    await db('shop_module_entitlements').del();
    await db('shop_memberships').del();
    await db('users').del();
    await db('shops').del();
  });

  it('revokes an active entitlement by setting valid_until', async () => {
    // ─────────────────────────────────────────────
    // Arrange
    // ─────────────────────────────────────────────
    const shopId = 9001;
    const userId = 9002;

    await seedShopAndUser({ shopId, userId });

    await db('shop_module_entitlements').insert({
      shop_id: shopId,
      module_key: 'analytics',
      flag_key: null,
      source: 'test',
      valid_from: new Date(Date.now() - 1000),
      valid_until: null,
    });

    // Sanity check: entitlement is active
    const before = await EntitlementsService.getForUser(userId);
    expect(before).not.toBeNull();
    expect(before!.modules).toContain('analytics');

    // ─────────────────────────────────────────────
    // Act
    // ─────────────────────────────────────────────
    await EntitlementRevocationService.revokeEntitlements({
      shopId,
      scope: {
        modules: ['analytics'],
      },
      reason: 'admin',
    });

    // ─────────────────────────────────────────────
    // Assert
    // ─────────────────────────────────────────────
    const after = await EntitlementsService.getForUser(userId);
    expect(after).not.toBeNull();
    expect(after!.modules).not.toContain('analytics');
  });
});