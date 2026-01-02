// apps/backend/src/services/lifecycle-transition.service.ts

import db from 'api-src/db';
import crypto from 'crypto';
import { UserLifecyclePhase } from './lifecycle.service';

type AuditInput = {
  userId: number;
  shopId: number;
  currentPhase: UserLifecyclePhase;
};

const AUDITABLE_TRANSITIONS = new Set([
  'FT0->FT1',
  'FT1->FT2',
]);

export class LifecycleTransitionService {
  static async auditIfTransitioned(input: AuditInput): Promise<void> {
    const { userId, shopId, currentPhase } = input;

    // 1. Load last known lifecycle phase (if any)
    const last = await db('lifecycle_audit_events')
      .where({ user_id: userId })
      .orderBy('occurred_at', 'desc')
      .first<{ to_phase: UserLifecyclePhase }>();

    let previousPhase: UserLifecyclePhase =
      last?.to_phase ?? 'FT_MINUS_ONE';

    let effectivePreviousPhase = previousPhase;

    // Backfill FT1 if jumping directly to FT2
    if (currentPhase === 'FT2' && previousPhase !== 'FT1') {
      effectivePreviousPhase = 'FT1';
    }

    // No-op only if semantically unchanged
    if (effectivePreviousPhase === currentPhase) return;

    const transitionKey = `${effectivePreviousPhase}->${currentPhase}`;

    if (!AUDITABLE_TRANSITIONS.has(transitionKey)) {
      return;
    }

    // 4. Idempotency guard — same transition already recorded
    const existing = await db('lifecycle_audit_events')
    .where({
        user_id: userId,
        from_phase: effectivePreviousPhase,
        to_phase: currentPhase,
    })
    .first();

    if (existing) return;

    // 5. Write audit event
    try {
      const eventId = crypto.randomUUID();
      const occurredAt = db.fn.now();

      await db('lifecycle_audit_events')
        .insert({
          event_id: eventId,
          user_id: userId,
          shop_id: shopId,
          from_phase: effectivePreviousPhase,
          to_phase: currentPhase,
          occurred_at: occurredAt,
        })
        .onConflict(['user_id', 'from_phase', 'to_phase'])
        .ignore();

      // 6. Update lifecycle snapshot (projection of audit event)
      await db('user_lifecycle_snapshot')
        .insert({
          user_id: userId,
          shop_id: shopId,
          phase: currentPhase,
          since: occurredAt,
          last_event_id: eventId,
          updated_at: db.fn.now(),
        })
        .onConflict('user_id')
        .merge({
          phase: currentPhase,
          since: occurredAt,
          last_event_id: eventId,
          updated_at: db.fn.now(),
        });
    } catch (err) {
    // Defensive: uniqueness violation or race — treat as no-op
    return;
    }
  }
}