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
   * Insert new decision
   */
  static async create(decision: Decision & { shop_id: number }): Promise<void> {
    await db('decisions').insert({
      id: decision.id,
      type: decision.type,
      entity_id: decision.entity_id,
      priority: decision.priority,
      score_breakdown: decision.score_breakdown,
      reason: decision.reason,
      signals: decision.signals,
      recommended_action: decision.recommended_action,
      actions: decision.actions,
      status: decision.status,
      created_at: decision.created_at,
      updated_at: decision.updated_at,
      shop_id: decision.shop_id,
    });
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