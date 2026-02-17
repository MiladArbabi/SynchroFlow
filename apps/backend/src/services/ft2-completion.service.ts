// apps/backend/src/services/ft2-completion.service.ts
import db from '@lasyncro/backend-core/db.js';

export class FT2CompletionService {
  static async markCompleted(shopId: number): Promise<void> {
    await db('ft2_state')
      .insert({
        shop_id: shopId,
        completed_at: new Date().toISOString(),
      })
      .onConflict('shop_id')
      .ignore();

      console.log('[FT2_LATCH_WRITTEN]', {
        shopId,
        ts: new Date().toISOString(),
      });
  }

  static async isCompleted(shopId: number): Promise<boolean> {
    const row = await db('ft2_state')
      .where({ shop_id: shopId })
      .first();

      console.log('[FT2_LATCH_CHECK]', {
        shopId,
        exists: !!row,
        ts: new Date().toISOString(),
      });
      
    return !!row;
  }
}
