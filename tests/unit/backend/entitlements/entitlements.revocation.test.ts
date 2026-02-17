// tests/unit/backend/entitlements/entitlements.revocation.test.ts

import db from '@lasyncro/backend-core/db.js';
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