// tests/unit/backend/onboarding/order-nexus.readiness.test.ts

import db from '@lasyncro/backend-core/db.js';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';

import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedIntegration } from '../../helpers/seedIntegration';
import { seedCanonicalOrder } from '../../helpers/seedCanonicalOrder';

describe('Order-Nexus readiness signal visibility', () => {
  const shopId = 7001;
  const userId = 7002;

  beforeEach(async () => {
    // --- hard cleanup (idempotent, deterministic) ---
    await db('canonical_order_line_items').where({ shop_id: shopId }).del();
    await db('canonical_orders').where({ shop_id: shopId }).del();
    await db('users').where({ id: userId }).del();
    await db('shops').where({ id: shopId }).del();

    // --- base entities ---
    await seedShopAndUser({ shopId, userId });
  });

  it('exposes FT1 Order-Nexus signals when canonical orders exist', async () => {
    // Arrange — FT0 prerequisites
    await seedIntegration({
      shopId,
      syncStatus: 'COMPLETED',
    });

    // Canonical FT1 fact: at least one order exists
    await seedCanonicalOrder({
      shopId,
      canonicalOrderId: 'order-ft1-001',
      platformOrderId: 'shopify-ft1-001',
    });

    const service = new OnboardingReadinessService();

    // Act
    const snapshot = await service.getSnapshot({ shopId, userId });

    const orderNexus = snapshot.modules.find(
      (m) => m.moduleId === 'order-nexus'
    );

    // Assert — module exists
    expect(orderNexus).toBeDefined();

    // Assert — signals are surfaced to readiness layer
    const signalNames = orderNexus!.signals.map((s) => s.name);

    expect(signalNames).toContain('orderNexus.ordersKnown');
    expect(signalNames).toContain('orderNexus.ordersIngested');
    expect(signalNames).toContain('orderNexus.missingCostCount');
    expect(signalNames).toContain('orderNexus.hasNegativeMarginOrder');
  });
});
