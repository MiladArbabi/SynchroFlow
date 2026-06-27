/**
 * ============================================================
 * 🚨 LIFECYCLE WRITE AUTHORITY CONTRACT
 * ============================================================
 *
 * Lifecycle mutations are allowed ONLY from:
 *
 * 1. FT0CompletionService (canonical durability boundary)
 * 2. FT2 confirm endpoint (explicit user-confirmed promotion)
 *
 * The following layers MUST NEVER call this service:
 *
 * - OAuth controllers
 * - Sync workers
 * - External ingestion layers
 * - Webhooks
 * - staged_events ingestion
 *
 * Lifecycle reflects proven system state — not integration existence.
 *
 * Violating this contract corrupts onboarding invariants.
 * ============================================================
 */

// apps/backend/src/services/lifecycle-transition.service.ts

import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';
import type { Knex } from 'knex';
import { UserLifecyclePhase } from './lifecycle.service.js';

type AuditInput = {
  userId: number;
  shopId: number;
  currentPhase: UserLifecyclePhase;
};

const AUDITABLE_TRANSITIONS = new Set([
  'FT_MINUS_ONE->FT0',
  'FT0->FT1',
  'FT1->FT2',
]);

/**
 * LifecycleTransitionService — ATOMIC WRITE PROJECTION
 * -----------------------------------------------------
 * Writes:
 *   1. lifecycle_events (append-only ledger)
 *   2. user_lifecycle_snapshot (materialized state)
 *
 * TRANSACTION CONTRACT:
 * - If trx is provided → participates in caller transaction.
 * - If trx is not provided → opens its own transaction.
 * - Guarantees atomic audit + snapshot projection.
 *
 * No inference.
 * No lifecycle repair.
 * No silent failures.
 */

export class LifecycleTransitionService {
  static async auditIfTransitioned(
    input: AuditInput,
    trx?: Knex.Transaction
  ): Promise<void> {
    if (!trx) {
      return db.transaction(async t => {
        await this.auditIfTransitioned(input, t);
      });
    }

    const { userId, shopId, currentPhase } = input;

    /**
     * SUBPHASE DERIVATION (v2)
     * ------------------------
     * Only FT0 has subphases.
     * Derived strictly from system state (NOT passed from caller).
     *
     * Prevents:
     * - frontend sync leakage
     * - invalid lifecycle writes
     */
    let subphase: string | null = null;

    if (currentPhase === 'FT0') {
      const integration = await trx('integrations')
        .where({ shop_id: shopId })
        .first('sync_status');

      /**
       * 🧭 SUBPHASE NORMALIZATION (v2 FIX)
       * ----------------------------------
       * NEVER expose raw integration.sync_status.
       * Map to lifecycle-safe subphases.
       *
       * Prevents:
       * - UI coupling to integration layer
       * - invalid FT0 states like "COMPLETED"
       */
      const rawStatus = integration?.sync_status;

      switch (rawStatus) {
        case 'SYNCING_PRODUCTS':
        case 'SYNCING_INVENTORY':
        case 'SYNCING_SHOP':
          subphase = 'SYNCING';
          break;

        case 'COMPLETING':
          subphase = 'FINALIZING';
          break;

        case 'COMPLETED':
          subphase = 'PREPARING'; // still FT0 until FT1 transition
          break;

        case 'FAILED':
          subphase = 'ERROR';
          break;

        default:
          subphase = 'PREPARING';
      }

      console.info('[LIFECYCLE][SUBPHASE_NORMALIZED]', {
        shopId,
        rawStatus,
        subphase,
      });

      console.info('[LIFECYCLE][SUBPHASE_DERIVED]', {
        shopId,
        subphase,
      });
    }

    /**
     * SHOP-SCOPED LIFECYCLE:
     * Snapshot uniqueness boundary = shop_id
     */
    const snapshot = await trx('user_lifecycle_snapshot')
      .where({ shop_id: shopId })
      .first<{ phase: UserLifecyclePhase }>();

    const previousPhase: UserLifecyclePhase =
      snapshot?.phase ?? 'FT_MINUS_ONE';

    const transitionKey = `${previousPhase}->${currentPhase}`;

    /**
     * REPLAY IDEMPOTENCY GUARD (CRITICAL)
     * ------------------------------------
     * During projection replay, lifecycle events are re-processed
     * against an already-advanced snapshot. Two safe cases:
     *
     * 1. Same phase (e.g. FT2->FT2) — already applied, skip silently
     * 2. Backwards transition (e.g. FT2->FT0) — replay artefact, skip
     *
     * Only throw for genuinely invalid forward transitions that
     * are not in AUDITABLE_TRANSITIONS and are not replay artefacts.
     */
    const PHASE_ORDER: Record<string, number> = {
      'FT_MINUS_ONE': 0,
      'FT0': 1,
      'FT1': 2,
      'FT2': 3,
    };

    const previousOrder = PHASE_ORDER[previousPhase] ?? -1;
    const currentOrder = PHASE_ORDER[currentPhase] ?? -1;

    if (previousOrder >= currentOrder) {
      console.info('[LIFECYCLE][TRANSITION_SKIP_REPLAY]', {
        userId,
        shopId,
        previousPhase,
        attemptedPhase: currentPhase,
        transitionKey,
      });
      return;
    }

    if (!AUDITABLE_TRANSITIONS.has(transitionKey)) {
      console.log('[LIFECYCLE][INVALID_TRANSITION]', {
        userId,
        shopId,
        previousPhase,
        attemptedPhase: currentPhase,
        transitionKey,
      });
      throw new Error(
        `Invalid lifecycle transition: ${transitionKey}`
      );
    }

    /**
     * DUPLICATE TRANSITION CHECK
     * --------------------------
     * lifecycle_events is the canonical lifecycle ledger.
     * Prevent duplicate transitions by inspecting the
     * existing append-only event stream.
     */
    const existing = await trx('lifecycle_events')
      .where({
        shop_id: shopId,
        event_type: 'PHASE_TRANSITION',
      })
      .andWhereRaw("payload->>'from' = ?", [previousPhase])
      .andWhereRaw("payload->>'to' = ?", [currentPhase])
      .first();

    if (existing) return;

    const eventId = crypto.randomUUID();
    const occurredAt = trx.fn.now();

    /**
     * Dual-write: v2 lifecycle backbone (append-only)
     *
     * lifecycle_events replaces lifecycle_audit_events
     * during read-switch phase.
     */
    await trx('lifecycle_events')
      .insert({
        event_id: eventId,
        shop_id: shopId,
        user_id: userId,
        layer: 'LIFECYCLE',
        event_type: 'PHASE_TRANSITION',
        payload: {
          from: previousPhase,
          to: currentPhase,
        },
        occurred_at: occurredAt,
      })
      .onConflict('event_id')
      .ignore();

    await trx('user_lifecycle_snapshot')
      .insert({
        user_id: userId,
        shop_id: shopId,
        phase: currentPhase,
        subphase,
        since: occurredAt,
        last_event_id: eventId,
        updated_at: trx.fn.now(),
      })
      .onConflict('shop_id')
      .merge({
        phase: currentPhase,
        subphase,
        since: occurredAt,
        last_event_id: eventId,
        updated_at: trx.fn.now(),
      });
  }
}
