/**
 * Constraint Types
 * ----------------
 * Canonical constraint taxonomy used across the constraint engine.
 *
 * NOTE:
 * Projection layer must never define constraint types.
 * They originate only from the constraint evaluation engine.
 */

export type ConstraintType =
  | 'inventory'
  | 'customer'
  | 'operational';

export interface ConstraintEvaluationResult {
  type: ConstraintType;
  isActive: boolean;
  meta?: Record<string, unknown>;
}