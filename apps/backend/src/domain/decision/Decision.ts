// apps/backend/src/domain/decision/Decision.ts

/**
 * DECISION DOMAIN MODEL (SOURCE OF TRUTH)
 * ---------------------------------------
 * This is the ONLY allowed structure for representing a decision.
 *
 * RULES:
 * - Must be used by Decision Engine (future)
 * - Must NOT be redefined in services/controllers
 * - All prioritization must resolve into `priority`
 * 
 * INVARIANT:
 * - Every decision MUST be tied to an aggregate_version
 *
 * If multiple "decision-like" objects exist → system is broken
 */

export type DecisionType = 'operational' | 'financial' | 'risk';

export type DecisionStatus =
  | 'pending'
  | 'in_progress'
  | 'resolved'
  | 'dismissed';

export interface DecisionAction {
  /**
   * Canonical action identifier
   * Example: 'resolve_inventory', 'contact_customer'
   */
  type: string;

  /**
   * Action payload (must be serializable)
   */
  payload: Record<string, unknown>;

  /**
   * Execution mode:
   * - manual → user must trigger
   * - automated → system can execute
   */
  execution_mode: 'manual' | 'automated';
}

export interface Decision {
  /**
   * Unique decision identifier (UUID)
   */
  id: string;

  /**
   * Decision classification
   */
  type: DecisionType;

  /**
   * Target entity (e.g. order_id)
   */
  entity_id: string;

  /**
   * AGGREGATE VERSION (CRITICAL)
   * ---------------------------
   * Binds decision to exact reconciliation version.
   *
   * Required for:
   * - deterministic replay
   * - checkpoint validation
   * - DB integrity alignment
   */
  aggregate_version: number;

  /**
   * GLOBAL PRIORITY
   * ---------------
   * Must be normalized across ALL domains.
   * Higher = more important.
   */
  priority: number;

  /**
   * Priority breakdown for audit/debugging
   */
  score_breakdown: Record<string, number>;

  /**
   * Human-readable explanation
   */
  reason: string;

  /**
   * Raw signals used to generate decision
   * (constraints, risk, revenue, etc.)
   */
  signals: Record<string, unknown>;

  /**
   * Primary recommended action
   */
  recommended_action: DecisionAction;

  /**
   * Optional alternative actions
   */
  actions: DecisionAction[];

  /**
   * Lifecycle status
   */
  status: DecisionStatus;

  /**
   * Decision lifecycle tracking
   */
  lifecycle?: {
    started_at: Date | null;
    resolved_at: Date | null;
    outcome: 'success' | 'failure' | null;
  };

  created_at: Date;
  updated_at: Date;
}