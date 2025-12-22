// tests/unit/onboarding/ft0-completion.service.test.ts

import db from 'api-db';
import { seedShopAndUser } from '../helpers/seedShopAndUser';
import { seedIntegration } from '../helpers/seedIntegration';
import { seedCanonicalOrder } from '../helpers/seedCanonicalOrder';
import { seedCanonicalProduct } from '../helpers/seedCanonicalProduct';

describe('FT0CompletionService (TDD)', () => {
  const shopId = 123;
  const userId = 456;

  beforeEach(async () => {
    await db('ft0_state').where({ shop_id: shopId }).del().catch(() => {});
    await db('integrations').where({ shop_id: shopId }).del();
    await db('canonical_orders').where({ shop_id: shopId }).del();
    await db('canonical_products').where({ shop_id: shopId }).del();
    await db('users').where({ id: userId }).del();
    await db('shops').where({ id: shopId }).del();

    await seedShopAndUser({ shopId, userId });
    });

  afterAll(async () => {
    await db.destroy();
  });

  test('does NOT complete FT0 when no integration exists', async () => {
    const { FT0CompletionService } = await import(
      'api-src/services/ft0-completion.service'
    );

    const result = await FT0CompletionService.evaluateAndComplete(shopId);

    expect(result.completed).toBe(false);
  });

  test('does NOT complete FT0 when integration sync is not completed', async () => {
    await seedIntegration({
      shopId,
      syncStatus: 'IN_PROGRESS',
    });

    const { FT0CompletionService } = await import(
      'api-src/services/ft0-completion.service'
    );

    const result = await FT0CompletionService.evaluateAndComplete(shopId);

    expect(result.completed).toBe(false);
  });

  test('does NOT complete FT0 when canonical data is missing', async () => {
    await seedIntegration({
      shopId,
      syncStatus: 'COMPLETED',
    });

    // Only orders exist — products missing
    await seedCanonicalOrder({ shopId });

    const { FT0CompletionService } = await import(
      'api-src/services/ft0-completion.service'
    );

    const result = await FT0CompletionService.evaluateAndComplete(shopId);

    expect(result.completed).toBe(false);
  });

  test('does NOT complete FT0 when first insight has not been delivered', async () => {
    await seedIntegration({
        shopId,
        syncStatus: 'COMPLETED',
    });

    await seedCanonicalOrder({ shopId });

    await seedCanonicalProduct({ shopId });

    // user.first_insight_delivered is still false

    const { FT0CompletionService } = await import(
      'api-src/services/ft0-completion.service'
    );

    const result = await FT0CompletionService.evaluateAndComplete(shopId);

    expect(result.completed).toBe(false);
  });

  test('COMPLETES FT0 when all completion criteria are met', async () => {
    await seedIntegration({
      shopId,
      syncStatus: 'COMPLETED',
    });

    await seedCanonicalOrder({ shopId });

    await seedCanonicalProduct({ shopId });

    await db('users')
      .where({ id: userId })
      .update({ first_insight_delivered: true });

    const { FT0CompletionService } = await import(
      'api-src/services/ft0-completion.service'
    );

    const result = await FT0CompletionService.evaluateAndComplete(shopId);

    expect(result.completed).toBe(true);

    const row = await db('ft0_state').where({ shop_id: shopId }).first();

    expect(row).toBeDefined();
    expect(row.status).toBe('COMPLETED');
    expect(row.completed_at).toBeTruthy();
  });

  test('FT0 completion is idempotent', async () => {
    await seedIntegration({
      shopId,
      syncStatus: 'COMPLETED',
    });

    await seedCanonicalOrder({ shopId });

    await seedCanonicalProduct({ shopId });

    await db('users')
      .where({ id: userId })
      .update({ first_insight_delivered: true });

    const { FT0CompletionService } = await import(
      'api-src/services/ft0-completion.service'
    );

    const first = await FT0CompletionService.evaluateAndComplete(shopId);
    const second = await FT0CompletionService.evaluateAndComplete(shopId);

    expect(first.completed).toBe(true);
    expect(second.alreadyCompleted).toBe(true);

    const rows = await db('ft0_state').where({ shop_id: shopId });

    expect(rows.length).toBe(1);
  });
});
