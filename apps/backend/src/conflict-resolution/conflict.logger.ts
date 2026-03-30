/**
 * CONFLICT LOGGER (SHARED)
 * ------------------------
 * Centralized logging for all conflict resolution events.
 * Prevents duplicated logging logic across codebase.
 */

import { ConflictType, ResolutionStrategy } from './conflict.types.js';

export function logConflictResolved(params: {
  entity: string;
  conflictKey: string[] | string;
  conflictType: ConflictType;
  resolutionStrategy: ResolutionStrategy;
  note?: string;
}) {
  console.info('[CONFLICT_RESOLVED]', params);
}

export function logConflictIgnored(params: {
  entity: string;
  conflictKey: string[] | string;
  note?: string;
}) {
  console.warn('[CONFLICT_IGNORED]', params);
}

export function logIdempotentSkip(params: {
  entity: string;
  id: string;
  incomingVersion: number;
  existingVersion: number;
}) {
  console.warn('[IDEMPOTENT_SKIP]', params);
}