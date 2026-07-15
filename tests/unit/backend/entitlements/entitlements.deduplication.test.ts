// tests/unit/backend/entitlements/entitlements.deduplication.test.ts
//
// ISS-C26: shop_module_entitlements' unique index on
// (shop_id, module_key, flag_key) never triggers a Postgres ON CONFLICT
// when flag_key IS NULL, because NULL is never considered equal to NULL
// for uniqueness purposes. Every module-level grant (flag_key: null) is
// therefore duplicated on every re-seed instead of being ignored.
//
// This test calls applyFromCommercialGrant twice with an identical
// module-level row — exactly what handleSubscriptionUpsert.ts does on
// every repeat webhook for the same shop/tier — and asserts exactly one
// row exists afterward.

import db from '@lasyncro/backend-core/db.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';

describe('EntitlementsService – deduplication of module-level grants', () => {
  beforeEach(async () => {
    await db('shop_module_entitlements').del();
    await db('shop_memberships').del();
    await db('users').del();
    await db('shops').del();
  });

  it('does not duplicate a module-level row (flag_key: null) on repeat grant', async () => {
    // ─────────────────────────────────────────────
    // Arrange
    // ─────────────────────────────────────────────
    const shopId = 9301;
    const userId = 9302;
    await seedShopAndUser({ shopId, userId });

    const row = {
      shop_id: shopId,
      module_key: 'returns',
      flag_key: null as string | null,
      source: 'tier:core',
    };

    // ─────────────────────────────────────────────
    // Act — apply the identical grant twice, mirroring a repeat webhook
    // ─────────────────────────────────────────────
    await EntitlementsService.applyFromCommercialGrant(db, [row]);
    await EntitlementsService.applyFromCommercialGrant(db, [row]);

    // ─────────────────────────────────────────────
    // Assert
    // ─────────────────────────────────────────────
    const rows = await db('shop_module_entitlements')
      .where({ shop_id: shopId, module_key: 'returns' });

    expect(rows).toHaveLength(1);
  });
});