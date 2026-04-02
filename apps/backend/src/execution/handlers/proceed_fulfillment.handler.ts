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
import { ExecutionHandler } from '../execution.registry.js';
import { resolveExternalOrderId } from '../../services/identity/resolveExternalOrder.service.js';
import { createShopifyGraphQLClient } from '../../services/shopify/shopifyClient.service.js';

export const proceedFulfillmentHandler: ExecutionHandler = async (job) => {
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
    const existing = await db('fulfillment_executions')
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
  await db('fulfillment_executions').insert({
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
  }

  /**
   * STEP 3 — RESOLVE EXTERNAL ORDER ID (CRITICAL)
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

    await db('fulfillment_executions')
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
  await db('fulfillment_executions')
    .where({ decision_id: job.decision_id })
    .update({
      external_order_id: externalOrderId
    });

  /**
   * STEP 4 — LOAD SHOPIFY INSTALLATION (CRITICAL)
   * ---------------------------------------------
   */
  const installation = await db('shopify_app_installations')
    .where({ shop_id: job.shop_id })
    .first();

  if (!installation) {
    throw new Error('[FULFILLMENT_INSTALLATION_NOT_FOUND]');
  }

  let executionError: string | null = null;
  let fulfillmentOrderId: string | null = null;

  try {

    const client = createShopifyGraphQLClient({
      accessToken: installation.access_token,
      platformShopName: installation.shop_domain,
      shopId: Number(job.shop_id)
    });
  
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
                  node { id }
                }
              }
            }
          }
        `,
        variables: { orderId: orderGid }
      }
    });
  
    fulfillmentOrderId =
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
      fulfillmentOrdersResponse?.body?.data?.order?.fulfillmentOrders?.edges?.[0]?.node?.id;
  
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
            lineItemsByFulfillmentOrder: [
              { fulfillmentOrderId }
            ]
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
    await db('fulfillment_executions')
      .where({ decision_id: job.decision_id })
      .update({
        status: 'success',
        executed_at: db.fn.now() // explicit execution timestamp (audit correctness)
      });

    } catch (err) {
      executionError = (err as Error).message;

      console.error('[FULFILLMENT_EXECUTION_FAILED]', {
        decision_id: job.decision_id,
        error: executionError
      });

      await db('fulfillment_executions')
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
    fulfillment_order_id: fulfillmentOrderId
  });
};