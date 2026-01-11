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

  it('is idempotent when revoking an already-revoked entitlement', async () => {
    // ─────────────────────────────────────────────
    // Arrange
    // ─────────────────────────────────────────────
    const shopId = 9101;
    const userId = 9102;

    await seedShopAndUser({ shopId, userId });

    await db('shop_module_entitlements').insert({
      shop_id: shopId,
      module_key: 'analytics',
      flag_key: null,
      source: 'test',
      valid_from: new Date(Date.now() - 1000),
      valid_until: null,
    });

    // First revocation
    const revokedAt = new Date();
    await EntitlementRevocationService.revokeEntitlements({
      shopId,
      scope: { modules: ['analytics'] },
      revokedAt,
      reason: 'admin',
    });

    // ─────────────────────────────────────────────
    // Act (second revocation — should be no-op)
    // ─────────────────────────────────────────────
    await EntitlementRevocationService.revokeEntitlements({
      shopId,
      scope: { modules: ['analytics'] },
      revokedAt: new Date(Date.now() + 1000),
      reason: 'admin',
    });

    // ─────────────────────────────────────────────
    // Assert
    // ─────────────────────────────────────────────
    const rows = await db('shop_module_entitlements')
      .where({ shop_id: shopId, module_key: 'analytics' });

    expect(rows).toHaveLength(1);
    expect(rows[0].valid_until).toEqual(revokedAt);
  });
  
  it('does not delete entitlement rows when revoking (non-destructive)', async () => {
    // ─────────────────────────────────────────────
    // Arrange
    // ─────────────────────────────────────────────
    const shopId = 9201;
    const userId = 9202;

    await seedShopAndUser({ shopId, userId });

    await db('shop_module_entitlements').insert({
      shop_id: shopId,
      module_key: 'finances',
      flag_key: null,
      source: 'test',
      valid_from: new Date(Date.now() - 1000),
      valid_until: null,
    });

    const beforeRows = await db('shop_module_entitlements')
      .where({ shop_id: shopId, module_key: 'finances' });

    expect(beforeRows).toHaveLength(1);
    expect(beforeRows[0].valid_until).toBeNull();

    // ─────────────────────────────────────────────
    // Act
    // ─────────────────────────────────────────────
    await EntitlementRevocationService.revokeEntitlements({
      shopId,
      scope: { modules: ['finances'] },
      reason: 'admin',
    });

    // ─────────────────────────────────────────────
    // Assert
    // ─────────────────────────────────────────────
    const afterRows = await db('shop_module_entitlements')
      .where({ shop_id: shopId, module_key: 'finances' });

    expect(afterRows).toHaveLength(1);
    expect(afterRows[0].valid_until).not.toBeNull();
  });
});