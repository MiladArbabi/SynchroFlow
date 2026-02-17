//apps/backend/src/services/lifecycle-history.service.ts
import db from '@lasyncro/backend-core/db.js';
import { LifecyclePhase } from './lifecycle.contract.js';

/**
 * v2 Backbone Migration:
 * - Reads from lifecycle_events (append-only backbone)
 */

export type LifecycleHistoryEvent = {
  event_id: string;
  user_id: number;
  shop_id: number;
  from_phase: LifecyclePhase;
  to_phase: LifecyclePhase;
  occurred_at: string;
};

export class LifecycleHistoryService {
  /**
   * READ-ONLY historical record.
   *
   * ❗ This service MUST NOT:
   * - derive lifecycle
   * - infer current phase
   * - apply business logic
   *
   * It only returns persisted facts.
   */
  static async getForUser(userId: number): Promise<LifecycleHistoryEvent[]> {
    const rows = await db('lifecycle_events')
      .where({
        user_id: userId,
        layer: 'LIFECYCLE',
        event_type: 'PHASE_TRANSITION',
      })
      .orderBy('occurred_at', 'asc');

    console.debug('[LIFECYCLE][HISTORY_READ]', {
      userId,
      source: 'lifecycle_events',
    });

    return rows.map((row: any) => ({
      event_id: row.event_id,
      user_id: row.user_id,
      shop_id: row.shop_id,
      from_phase: row.payload.from,
      to_phase: row.payload.to,
      occurred_at: row.occurred_at,
    }));
  }
}
