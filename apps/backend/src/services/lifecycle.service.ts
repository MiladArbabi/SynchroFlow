// 🚫 CONTRACT VIOLATION (v1.0)
// Lifecycle must not read entitlements (paid/premium).
// This logic will be removed when FT2 confirmation is fully isolated.

/**
 * LifecycleService — READ AUTHORITY
 * --------------------------------
 * Source of truth for user lifecycle phase.
 *
 * RULES:
 * - Lifecycle is ledger-based, not inferred.
 * - user_lifecycle_snapshot is authoritative.
 * - Absence of snapshot == FT_MINUS_ONE.
 * - No readiness, entitlement, or integration logic is allowed here.
 *
 * Performance:
 * - O(1) single-row lookup by user_id.
 *
 * Write-path:
 * - Snapshots are written ONLY via LifecycleTransitionService.
 */


// apps/backend/src/services/lifecycle.service.ts
import db from 'api-src/db';
import type { LifecyclePhase } from './lifecycle.contract';

export type UserLifecyclePhase =
  | 'FT_MINUS_ONE'
  | 'FT0'
  | 'FT1'
  | 'FT2';

export class LifecycleService {
  /**
   * Resolve lifecycle phase for a user.
   *
   * This method MUST:
   * - Read from user_lifecycle_snapshot only
   * - Never derive or infer lifecycle
   * - Never call readiness, entitlements, or integration services
   */

  static async resolveForUser(userId: number): Promise<LifecyclePhase> {
    // 0. SNAPSHOT AUTHORITY (single source of truth)
    const snapshot = await db('user_lifecycle_snapshot')
      .where({ user_id: userId })
      .first<{ phase: LifecyclePhase }>();

    if (snapshot) {
      console.debug('[LIFECYCLE][RESOLVE][SNAPSHOT]', {
        userId,
        phase: snapshot.phase,
      });
      return snapshot.phase;
    }

    console.debug('[LIFECYCLE][RESOLVE][DEFAULT]', {
      userId,
      phase: 'FT_MINUS_ONE',
    });
    return 'FT_MINUS_ONE';
  }
}