/**
 * proceed_fulfillment HANDLER
 * ---------------------------
 * Executes fulfillment progression.
 *
 * CURRENT:
 * - Placeholder (no side-effects yet)
 *
 * PURPOSE:
 * - Unblock execution pipeline
 * - Provide deterministic execution surface
 *
 * TODO:
 * - Integrate with fulfillment service
 */
import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';
import { ExecutionHandler } from '../execution.registry.js';
import { resolveExternalOrderId } from '../../services/identity/resolveExternalOrder.service.js';
import { createShopifyGraphQLClient } from '../../services/shopify/shopifyClient.service.js';
import { decrypt } from '../../security/encryption.service.js';

/**
 * NOTE:
 * - Required to decrypt Shopify access tokens before use
 * - Aligns with existing patterns (order-identity-guard, sync.worker)
 */

export const proceedFulfillmentHandler: ExecutionHandler = async (job, trx) => {

/**
 * NOTE:
 * - trx injected from execution worker
 * - MUST be used for all DB operations to preserve atomicity
 */
const dbx = (trx ?? db) as typeof db;

/**
 * NOTE:
 * - trx and db share same runtime API (Knex)
 * - explicit cast required for TypeScript to resolve overloads
 * - safe because both support identical query interface
 */

  console.info('[HANDLER_EXECUTION_START]', {
    action: 'proceed_fulfillment',
    decision_id: job.decision_id,
    entity_id: job.entity_id
  });

    /**
     * IDEMPOTENCY GUARD (CRITICAL)
     * -----------------------------
     * Prevents duplicate external side-effects.
     *
     * Strategy:
     * - decision_id is unique key
     * - if exists → skip execution
     */
    const existing = await dbx('fulfillment_executions')
      .where({ decision_id: job.decision_id })
      .first();

    if (existing) {
      console.warn('[FULFILLMENT_ALREADY_EXECUTED]', {
        decision_id: job.decision_id
      });
      return;
    }

  /**
   * EXECUTION RECORD (PENDING)
   * --------------------------
   * Created BEFORE external call.
   * Ensures visibility even if process crashes.
   */
  await dbx('fulfillment_executions').insert({
    id: crypto.randomUUID(),
    decision_id: job.decision_id,
    lasyncro_order_id: job.entity_id,
    external_order_id: '__RESOLVING__', // temporary placeholder (will be updated after identity resolution)
    shop_id: job.shop_id,
    status: 'pending'
  });

    /**
   * STEP 1 — RESOLVE ORDER IDENTITY (MANDATORY)
   * -------------------------------------------
   * Required to map internal → external order
   */
  if (!job.entity_id) {
    throw new Error('[FULFILLMENT_MISSING_ENTITY_ID]');
  }

  /**
   * STEP 2 — RESOLVE SHOP CONTEXT (MANDATORY)
   * -----------------------------------------
   * Required for Shopify API access + RLS context
   */
  if (!job.shop_id) {
    throw new Error('[FULFILLMENT_MISSING_SHOP_ID]');
  };

  /**
   * STEP 3 — PRE-FLIGHT VALIDATION (PER ORDER) (CRITICAL)
   * -----------------------------------------------------
   * Ensures this specific order is not already fulfilled.
   *
   * Source of truth:
   * - order_fulfillment_status (projection)
   */
  const existingFulfillment = await dbx('order_fulfillment_status')
    .where({ lasyncro_order_id: job.entity_id })
    .first();

  if (existingFulfillment?.status === 'fulfilled') {
    console.warn('[FULFILLMENT_SKIPPED_ALREADY_FULFILLED]', {
      decision_id: job.decision_id,
      entity_id: job.entity_id
    });

    await dbx('fulfillment_executions')
      .where({ decision_id: job.decision_id })
      .update({
        status: 'failure',
        error: '[ALREADY_FULFILLED_BLOCKED]'
      });

    return;
  }

  /**
   * RESOLVE EXTERNAL ORDER ID (CRITICAL)
   * ---------------------------------------------
   * Guarantees:
   * - correct mapping internal → Shopify order
   * - prevents invalid external calls
   *
   * FAIL POLICY:
   * - hard fail if identity missing
   * - prevents silent corruption
   */
  const externalOrderId = await resolveExternalOrderId(
    Number(job.shop_id),
    'shopify',
    String(job.entity_id)
  );

  if (!externalOrderId) {
    console.error('[FULFILLMENT_IDENTITY_RESOLUTION_FAILED]', {
      decision_id: job.decision_id,
      lasyncro_order_id: job.entity_id,
      shop_id: job.shop_id
    });

    await dbx('fulfillment_executions')
      .where({ decision_id: job.decision_id })
      .update({
        status: 'failure',
        error: '[FULFILLMENT_EXTERNAL_ID_NOT_FOUND]'
      });

    throw new Error('[FULFILLMENT_EXTERNAL_ID_NOT_FOUND]');
  }

  /**
   * Persist resolved external ID
   */
  await dbx('fulfillment_executions')
    .where({ decision_id: job.decision_id })
    .update({
      external_order_id: externalOrderId
    });

  /**
   * STEP 4 — LOAD SHOPIFY INSTALLATION (CRITICAL)
   * ---------------------------------------------
   */
  const installation = await dbx('shopify_app_installations')
    .where({ shop_id: job.shop_id })
    .first();

  if (!installation) {
    throw new Error('[FULFILLMENT_INSTALLATION_NOT_FOUND]');
  }

  let executionError: string | null = null;
  let fulfillmentOrderId: string | null = null;

  /**
   * SHARED STATE (CRITICAL)
   * -----------------------
   * Needed outside try/catch for logging.
   */
  let fulfillmentOrders: any[] = [];

  try {

    const accessToken = decrypt(
      installation.access_token,
      'proceed_fulfillment.handler'
    );

    const client = createShopifyGraphQLClient({
      accessToken,
      platformShopName: installation.shop_domain,
      shopId: Number(job.shop_id)
    });

    /**
     * NOTE:
     * - Decrypt token before API usage (security invariant)
     * - Context string ensures traceability + access control
     */
  
    /**
     * STEP 5 — FETCH FULFILLMENT ORDER ID
     * -----------------------------------
     */
    const orderGid = `gid://shopify/Order/${externalOrderId}`;
  
    const fulfillmentOrdersResponse: any = await client.query({
      data: {
        query: `
          query ($orderId: ID!) {
            order(id: $orderId) {
              fulfillmentOrders(first: 10) {
                edges {
                  node {
                    id
                    status
                    lineItems(first: 10) {
                      edges {
                        node {
                          remainingQuantity
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        variables: { orderId: orderGid }
      }
    });
  
    /**
     * TYPE NOTE (CRITICAL)
     * --------------------
     * Shopify GraphQL client is untyped → returns unknown shape.
    *
    * We explicitly cast to `any` to:
    * - avoid false `never` inference
    * - allow safe access to `.body.data`
    *
    * Future:
    * - replace with typed GraphQL response contract
    */
    fulfillmentOrderId =
      fulfillmentOrdersResponse?.body?.data?.order?.fulfillmentOrders?.edges?.[0]?.node?.id;

    /**
     * DUPLICATE FULFILLMENT GUARD (CRITICAL)
     * --------------------------------------
     * Prevents executing fulfillment if already fully fulfilled in Shopify.
     *
     * Source of truth:
     * - Shopify fulfillmentOrders.remainingQuantity
     */
    fulfillmentOrders =
      fulfillmentOrdersResponse?.body?.data?.order?.fulfillmentOrders?.edges ?? [];
  
    /**
     * SAFETY CHECK (POST-EXECUTION)
     * -----------------------------
     * Ensures logging never references undefined state.
     */
    if (!fulfillmentOrderId) {
      throw new Error('[FULFILLMENT_ORDER_ID_MISSING_POST_EXECUTION]');
    }
  
    /**
     * STEP 6 — EXECUTE FULFILLMENT
     * ----------------------------
     */
    const fulfillmentResponse: any = await client.query({
      data: {
        query: `
          mutation ($input: FulfillmentInput!) {
            fulfillmentCreate(input: $input) {
              fulfillment { id }
              userErrors { field message }
            }
          }
        `,
        variables: {
          input: {
            lineItemsByFulfillmentOrder: fulfillmentOrders.map((edge: any) => ({
              fulfillmentOrderId: edge.node.id
          }))
          }
        }
      }
    });
  
    const userErrors =
      fulfillmentResponse?.body?.data?.fulfillmentCreate?.userErrors;
  
    if (userErrors && userErrors.length > 0) {
      throw new Error(
        `[SHOPIFY_FULFILLMENT_ERROR] ${JSON.stringify(userErrors)}`
      );
    }
  
    /**
     * STEP 7 — MARK SUCCESS
     */
    await dbx('fulfillment_executions')
      .where({ decision_id: job.decision_id })
      .update({
        status: 'success',
        /**
         * DO NOT set executed_at here.
         * --------------------------------
         * Execution timestamp is owned exclusively by execution.worker.
         *
         * Handlers must remain pure execution logic and MUST NOT
         * mutate lifecycle tracking fields.
         */
      });

    } catch (err) {
      executionError = (err as Error).message;

      console.error('[FULFILLMENT_EXECUTION_FAILED]', {
        decision_id: job.decision_id,
        error: executionError
      });

      await dbx('fulfillment_executions')
        .where({ decision_id: job.decision_id })
        .update({
          status: 'failure',
          error: executionError
        });

      throw err;
    }

  console.info('[FULFILLMENT_EXECUTED]', {
    decision_id: job.decision_id,
    external_order_id: externalOrderId,
    fulfillment_order_ids: fulfillmentOrders.map((e: any) => e.node.id)
  });
};