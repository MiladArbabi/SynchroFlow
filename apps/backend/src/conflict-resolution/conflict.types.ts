/**
 * 🚨 ENFORCEMENT DIRECTIVE — CONFLICT SYSTEM
 * -----------------------------------------
 * - DO NOT use raw string literals for conflict types or resolution strategies.
 * - ALWAYS import from this module.
 *
 * Violations:
 * ❌ const type = 'DUPLICATE_EVENT'
 * ❌ const strategy = 'MERGE'
 *
 * Required:
 * ✅ ConflictTypes.DUPLICATE_EVENT
 * ✅ ResolutionStrategies.MERGE
 *
 * This file is the SINGLE SOURCE OF TRUTH.
 * Any deviation introduces system inconsistency.
 */

/**
 * CONFLICT TYPES (CANONICAL)
 * --------------------------
 * Central definition for all conflict classification.
 * Must be used instead of ad-hoc string literals.
 */
export const ConflictTypes = {
  DUPLICATE_EVENT: 'DUPLICATE_EVENT',
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',
  DATA_RACE: 'DATA_RACE',
  STALE_WRITE: 'STALE_WRITE',
} as const;

export type ConflictType =
  typeof ConflictTypes[keyof typeof ConflictTypes];

/**
 * RESOLUTION STRATEGIES (CANONICAL)
 * ---------------------------------
 * Defines how conflicts are resolved.
 */
export const ResolutionStrategies = {
  IGNORE: 'IGNORE',
  MERGE: 'MERGE',
  RETRY: 'RETRY',
  FAIL: 'FAIL',
} as const;

export type ResolutionStrategy =
  typeof ResolutionStrategies[keyof typeof ResolutionStrategies];