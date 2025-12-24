//apps/backend/src/services/lifecycle-history.service.ts
import db from 'api-src/db';
import type { LifecyclePhase } from './lifecycle.contract';

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
  static async getForUser(
    userId: number
  ): Promise<LifecycleHistoryEvent[]> {
    return db<LifecycleHistoryEvent>('lifecycle_audit_events')
      .where({ user_id: userId })
      .orderBy('occurred_at', 'asc');
  }
}
