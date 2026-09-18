// tests/integration/onboarding/readiness.signal-passthrough.test.ts
import crypto from 'crypto';
import {
  systemTransaction,
  setTenantContext,
  withTenant,
  runWithTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';

describe('OnboardingReadinessService – signal passthrough', () => {
  it('passes through HEALTHY sku-os product signals when canonical products exist', async () => {
    const unique = crypto.randomBytes(6).toString('hex');

    const shopId = await systemTransaction(async (trx) => {
      const id = await createTenantShop(trx, `readiness-signal-${unique}`);
      await setTenantContext(trx, id);
      return id;
    });

    await withTenant(shopId, async (trx) => {
      await trx('products').insert({
        lasyncro_product_id: crypto.randomUUID(),
        shop_id: shopId,
        title: 'Test Product',
      });
    });

    const service = new OnboardingReadinessService();
    const snapshot = await runWithTenantContext(shopId, () =>
      service.getSnapshot({ shopId })
    );

    const skuModule = snapshot.modules.find(
      m => m.moduleId === 'sku-os'
    );

    expect(skuModule).toBeDefined();

    const productsKnown = skuModule?.signals.find(
      s => s.name === 'sku-os.productsKnown'
    );

    const productCount = skuModule?.signals.find(
      s => s.name === 'sku-os.productCount'
    );

    expect(productsKnown?.value).toBe(true);
    expect(productCount?.value).toBeGreaterThan(0);
  });
});
