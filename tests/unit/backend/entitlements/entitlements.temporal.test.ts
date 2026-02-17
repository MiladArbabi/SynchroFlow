// tests/unit/backend/entitlements/entitlements.temporal.test.ts

import db from '@lasyncro/backend-core/db.js';
import { EntitlementsService } from 'api-src/services/entitlements.service';
import { CommercialGrantService } from 'api-src/services/commercial-grant.service';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';

describe('EntitlementsService – temporal validity', () => {
    beforeEach(async () => {
        await db('shop_module_entitlements').del();
        await db('shop_memberships').del();
        await db('users').del();
        await db('shops').del();
    });

  it('excludes entitlements whose valid_until is in the past', async () => {
    // ─────────────────────────────────────────────
    // Arrange
    // ─────────────────────────────────────────────
    const shopId = 10001;
    const userId = 20001;

    await seedShopAndUser({ shopId, userId });


    const now = new Date();
    const past = new Date(now.getTime() - 60 * 1000);
    const future = new Date(now.getTime() + 60 * 1000);

    await db('shop_module_entitlements').insert([
      {
        shop_id: shopId,
        module_key: 'expired-module',
        flag_key: null,
        source: 'test',
        valid_from: past,
        valid_until: past,
      },
      {
        shop_id: shopId,
        module_key: 'active-module',
        flag_key: null,
        source: 'test',
        valid_from: past,
        valid_until: future,
      },
    ]);

    // ─────────────────────────────────────────────
    // Act
    // ─────────────────────────────────────────────
    const snapshot = await EntitlementsService.getForUser(userId);

    // ─────────────────────────────────────────────
    // Assert
    // ─────────────────────────────────────────────
    expect(snapshot).not.toBeNull();
    expect(snapshot!.modules).toContain('active-module');
    expect(snapshot!.modules).not.toContain('expired-module');
  });

  it('excludes entitlements whose valid_from is in the future', async () => {
    // ─────────────────────────────────────────────
    // Arrange
    // ─────────────────────────────────────────────
    const shopId = 2001;
    const userId = 3001;

    await seedShopAndUser({ shopId, userId });

    const future = new Date(Date.now() + 60 * 60 * 1000); // +1 hour

    await db('shop_module_entitlements').insert({
      shop_id: shopId,
      module_key: 'future-module',
      flag_key: null,
      source: 'test',
      valid_from: future,
      valid_until: null,
    });

    // ─────────────────────────────────────────────
    // Act
    // ─────────────────────────────────────────────
    const snapshot = await EntitlementsService.getForUser(userId);

    // ─────────────────────────────────────────────
    // Assert
    // ─────────────────────────────────────────────
    expect(snapshot).not.toBeNull();
    expect(snapshot!.modules).not.toContain('future-module');
  });
  it('does not activate commercial grants before valid_from', async () => {
    // arrange
    const shopId = 1001;
    const userId = 2001;

    await seedShopAndUser({ shopId, userId });

    const issuedAt = new Date(Date.now() + 60_000).toISOString();

    await CommercialGrantService.apply({
        shopId,
        source: 'admin',
        grants: { modules: ['analytics'] },
        metadata: { issuedAt },
    });

    // act
    const snapshot = await EntitlementsService.getForUser(userId);

    // assert
    expect(snapshot).not.toBeNull();
    expect(snapshot!.modules).not.toContain('analytics');
    });

});