/**
 * proceed_fulfillment COMPATIBILITY TOMBSTONE
 * --------------------------------------------
 * ARCH-10F
 *
 * Direct decision-driven Shopify fulfillment is retired.
 * Fulfillment is owned by Release → Pick → Pack → Ship.
 *
 * This handler remains registered so stale persisted jobs receive a
 * deterministic retirement reason instead of EXECUTION_HANDLER_NOT_FOUND.
 */

import type { ExecutionHandler } from '../execution.registry.js';

export const proceedFulfillmentHandler: ExecutionHandler = async () => {
  throw new Error('PROCEED_FULFILLMENT_RETIRED');
};
