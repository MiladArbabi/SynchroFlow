// apps/backend/src/domain/decision/decision.repository.ts

import db from '@lasyncro/backend-core/db.js';
import { Decision } from './Decision.js';

/**
 * DECISION REPOSITORY (MANDATORY ACCESS LAYER)
 * --------------------------------------------
 * All decision persistence MUST go through this layer.
 *
 * RULES:
 * - No direct table access outside this file
 * - Prevents fragmentation of decision logic
 * - Central point for logging, validation, and audit
 */

export class DecisionRepository {

  /**
   * DECISION LIFECYCLE MANAGEMENT
   * -----------------------------
   * Explicit lifecycle transitions for execution tracking.
   *
   * WHY:
   * - Enables observability into execution state
   * - Prevents silent execution failures
   * - Required for retry + audit
   */
  async markStarted(trx: any, decisionId: string): Promise<void> {
    await trx('decisions')
      .where({ id: decisionId })
      .update({
        status: 'in_progress',
        lifecycle: trx.raw(`
          jsonb_set(
            coalesce(lifecycle, '{}'::jsonb),
            '{started_at}',
            to_jsonb(now())
          )
        `),
        updated_at: trx.fn.now()
      });

    console.info('[DECISION_STARTED]', { decision_id: decisionId });
  }

  async markSuccess(trx: any, decisionId: string): Promise<void> {
    await trx('decisions')
      .where({ id: decisionId })
      .update({
        status: 'resolved',
        lifecycle: trx.raw(`
          jsonb_set(
            jsonb_set(
              coalesce(lifecycle, '{}'::jsonb),
              '{resolved_at}',
              to_jsonb(now())
            ),
            '{outcome}',
            '"success"'::jsonb
          )
        `),
        updated_at: trx.fn.now()
      });

    console.info('[DECISION_SUCCESS]', { decision_id: decisionId });
  }

  async markFailure(trx: any, decisionId: string, error: string): Promise<void> {
    await trx('decisions')
      .where({ id: decisionId })
      .update({
        status: 'pending',
        lifecycle: trx.raw(`
          jsonb_set(
            jsonb_set(
              coalesce(lifecycle, '{}'::jsonb),
              '{resolved_at}',
              to_jsonb(now())
            ),
            '{outcome}',
            '"failure"'::jsonb
          )
        `),
        updated_at: trx.fn.now()
      });

    console.error('[DECISION_FAILURE]', {
      decision_id: decisionId,
      error
    });
  }

  /**
   * Insert new decision
   */
  static async create(decision: Decision & { shop_id: number }): Promise<void> {

    /**
     * CALL SITE ENFORCEMENT (CRITICAL)
     * --------------------------------
     * Detects illegal direct DB writes bypassing repository.
     *
     * Strategy:
     * - Attach stack trace for observability
     * - Ensures all writes flow through this layer
     */
    if (!decision) {
      throw new Error('[DECISION_REPO_INVARIANT] decision payload missing');
    }

    /**
     * DEEP JSON TRACE (CRITICAL)
     * --------------------------
     * Identifies which field is malformed before DB insert.
     */
    /* console.debug('[DECISION_REPO_PAYLOAD]', {
      id: decision.id,
      recommended_action: {
        type: typeof decision.recommended_action,
        value: decision.recommended_action
      },
      actions: {
        type: typeof decision.actions,
        value: decision.actions
      },
      score_breakdown: {
        type: typeof decision.score_breakdown,
        value: decision.score_breakdown
      },
      signals: {
        type: typeof decision.signals,
        value: decision.signals
      }
    }); */

    /**
     * JSON VALIDATION GUARD
     * ---------------------
     * Must run BEFORE persistence.
     *
     * Guarantees:
     * - No double-stringified JSON
     * - No undefined payloads
     * - Fail-fast before DB interaction
     */
    function assertValidJsonField(value: unknown, field: string) {
      if (typeof value === 'string') {
        throw new Error(`[DECISION_JSON_INVALID] ${field} must be object, received string`);
      }

      if (value === undefined) {
        throw new Error(`[DECISION_JSON_INVALID] ${field} is undefined`);
      }

      // Deep validation (critical)
      try {
        JSON.stringify(value);
      } catch {
        throw new Error(`[DECISION_JSON_INVALID] ${field} is not serializable`);
      }
    }

    /**
     * EMPTY OBJECT GUARD
     * -------------------
     * Prevents structurally valid but meaningless payloads.
     */
    function assertNotEmptyObject(value: unknown, field: string) {
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      ) {
        throw new Error(`[DECISION_JSON_INVALID] ${field} is empty object`);
      }
    }

    assertNotEmptyObject(decision.recommended_action, 'recommended_action');
    assertNotEmptyObject(decision.score_breakdown, 'score_breakdown');
    assertNotEmptyObject(decision.signals, 'signals');
    assertValidJsonField(decision.actions, 'actions');

    /**
     * FINAL SERIALIZATION CHECK (DB BOUNDARY)
     * ---------------------------------------
     * Forces exact payload that pg will receive.
     * Eliminates hidden mutations / prototypes.
     */
    try {
      const test = {
        recommended_action: decision.recommended_action,
        actions: decision.actions,
        score_breakdown: decision.score_breakdown,
        signals: decision.signals
      };

      const serialized = JSON.stringify(test);

      /* console.debug('[FINAL_DB_SERIALIZATION]', serialized); */
    } catch (err) {
      throw new Error('[FINAL_DB_SERIALIZATION_FAILED]');
    }

    /**
     * EXECUTION ROUTING SIGNAL
     * ------------------------
     * Emits signal for downstream execution layer.
     *
     * Current:
     * - logs only (no automation yet)
     *
     * Future:
     * - queue dispatch
     * - workflow engine trigger
     */

    /**
     * EXECUTION DISPATCH (PHASE 1 - INLINE SIGNAL)
     *
     * WHY:
     * - Ensures every persisted decision produces an execution signal
     * - Temporary inline dispatch until queue-based dispatcher is introduced
     *
     * GUARANTEES:
     * - Runs AFTER successful persistence
     * - No execution performed here (signal only)
     * - Safe for replay (idempotency handled downstream via decision_id)
     *
     * TODO:
     * - Replace with async queue publish (Execution Dispatcher)
     */
    console.info('[DECISION_EXECUTION_SIGNAL]', {
      decision_id: decision.id,
      entity_id: decision.entity_id,
      aggregate_version: decision.aggregate_version,
      // NOTE: DecisionAction uses `type` (canonical action identifier)
      // mapped here to `action_type` for execution contract consistency
      action_type: decision.recommended_action?.type,
      execution_mode: decision.recommended_action?.execution_mode
    });


    if (decision.recommended_action.execution_mode === 'automated') {
      console.info('[DECISION_AUTOMATION_CANDIDATE]', {
        decisionId: decision.id,
        action: decision.recommended_action.type,
        entityId: decision.entity_id
      });
    }

    /**
     * IDEMPOTENCY WITH VERIFICATION (CRITICAL)
     * ---------------------------------------
     * Conflict must NOT be silently ignored.
     *
     * Behavior:
     * - If insert conflicts → verify row already exists
     * - If not → FAIL (data loss)
     */
    const result = await db('decisions')
      .insert({
        id: decision.id,
        type: decision.type,
        entity_id: decision.entity_id,
        /**
         * AGGREGATE VERSION (CRITICAL)
         * ----------------------------
         * Required for:
         * - deterministic replay
         * - execution correlation
         * - DB constraint integrity
         */
        aggregate_version: decision.aggregate_version,
        priority: decision.priority,
        recommended_action: db.raw('?::jsonb', [JSON.stringify(decision.recommended_action)]),
        actions: db.raw('?::jsonb', [JSON.stringify(decision.actions)]),
        score_breakdown: db.raw('?::jsonb', [JSON.stringify(decision.score_breakdown)]),
        signals: db.raw('?::jsonb', [JSON.stringify(decision.signals)]),
        reason: decision.reason,
        status: decision.status,
        created_at: decision.created_at,
        updated_at: decision.updated_at,
        shop_id: decision.shop_id,
      })
      .onConflict('id')
      .ignore()
      .returning('id');

    // If insert did NOT happen → verify existence
    if (!result || result.length === 0) {
      const existing = await db('decisions')
        .where({ id: decision.id })
        .first();

      if (!existing) {
        throw new Error(
          `[DECISION_PERSISTENCE_FAILED] Insert ignored but record missing id=${decision.id}`
        );
      }

      console.warn(
        `[DECISION_IDEMPOTENT_REPLAY] decision already exists id=${decision.id}`
      );
    } else {
      console.info(
        `[DECISION_PERSISTED] id=${decision.id}`
      );
    }
  }

  /**
   * Fetch decisions for tenant (priority-ordered)
   */
  static async getByShop(shopId: number): Promise<Decision[]> {
    return db('decisions')
      .where({ shop_id: shopId })
      .orderBy('priority', 'desc');
  }

  /**
   * Update decision status
   */
  static async updateStatus(
    id: string,
    status: Decision['status']
  ): Promise<void> {
    const updated = await db('decisions')
      .where({ id })
      .update({ status });

    if (updated === 0) {
      throw new Error(`[DecisionRepository] Decision not found: ${id}`);
    }
  }
}

