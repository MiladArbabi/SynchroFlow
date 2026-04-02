/**
 * EXECUTION REGISTRY
 * ------------------
 * Central mapping: action_type → handler
 *
 * WHY:
 * - Prevents fragmented execution logic
 * - Enforces explicit, deterministic handler resolution
 * - Required for safe execution dispatch
 *
 * RULES:
 * - NO dynamic resolution
 * - ALL handlers must be registered here
 * - Missing handler = hard failure
 */

import { ExecutionJob } from '../domain/decision/Decision.js';

export type ExecutionHandler = (
  job: ExecutionJob,
  /**
   * NOTE:
   * - Knex transaction type is not reliably inferred here
   * - Using `any` to match runtime behavior (callable trx)
   */
  trx?: any
) => Promise<void>;

/**
 * NOTE:
 * - Added trx support for atomic execution
 * - Enables handlers to participate in same DB transaction as worker
 * - Required for correctness in manual execution path
 */

const registry: Record<string, ExecutionHandler> = {};

/**
 * Register execution handler
 */
export function registerExecutionHandler(
  actionType: string,
  handler: ExecutionHandler
): void {
  if (registry[actionType]) {
    throw new Error(`[EXECUTION_REGISTRY_DUPLICATE] ${actionType}`);
  }

  registry[actionType] = handler;
}

/**
 * Resolve execution handler
 */
export function getExecutionHandler(actionType: string): ExecutionHandler {
  const handler = registry[actionType];

  if (!handler) {
    throw new Error(`[EXECUTION_HANDLER_NOT_FOUND] ${actionType}`);
  }

  return handler;
}

/**
 * DEBUG: list registered handlers
 */
export function listExecutionHandlers(): string[] {
  return Object.keys(registry);
}