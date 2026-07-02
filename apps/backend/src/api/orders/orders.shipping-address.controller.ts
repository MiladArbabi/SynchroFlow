// apps/backend/src/api/orders/orders.shipping-address.controller.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import db from '@lasyncro/backend-core/db.js';

/**
 * PATCH /api/v1/orders/:orderId/shipping-address
 * -------------------------------------------------
 * Lets an operator correct an order's shipping address directly in-app
 * — the primary resolution path for `customer`/`incomplete_address`
 * blocks (OF-08, 2026-07-02), instead of sending operators to Shopify.
 *
 * CORRECTED (GH-1036, 2026-07-02): originally built as a direct API
 * write only (bump aggregate_version, insert a reconciliation intent),
 * reasoning that domain events were only for external Shopify facts.
 * Confirmed live this was WRONG — reconciliation.handlers.ts's
 * intent-driven path can only READ existing order_risk_snapshot rows,
 * never create new ones, and never calls the real constraint
 * persistence layer (projectOrderConstraints). Only a real domain
 * event flowing through projection.db.worker.ts →
 * projectDomainEventCore actually re-evaluates and persists cleared
 * constraints. This endpoint now does BOTH: the direct write (for
 * immediate UI feedback / the timeline entry) AND emits a real
 * 'orders/shipping_address_corrected' domain event (to actually
 * trigger constraint re-evaluation). See GH-1036 for the full
 * investigation trail — this is genuinely how the system works, not
 * a workaround.
 *
 * Also appends a real order_fulfillment_history row ('address_corrected')
 * so the correction is visible in the Order Detail modal's "Why —
 * activity" timeline — same pattern as every other real event shown
 * there (see OrderDetailModalBody.tsx's formatTimelineEventLabel, which
 * needs a case added for this new status — see that file).
 */
export const httpUpdateShippingAddress = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const {
      name,
      address1,
      address2,
      city,
      zip,
      phone,
      province,
      countryCode,
    } = req.body ?? {};

    /**
     * VALIDATION — matches evaluateCustomerConstraint's own definition
     * of "complete" exactly (address1, city, zip, country_code required).
     * Rejecting an incomplete submission here rather than accepting a
     * still-broken address is deliberate — the whole point of this
     * endpoint is to CLEAR the block, not to allow saving a state that
     * would immediately re-trigger it.
     */
    const missing: string[] = [];
    if (!address1) missing.push('address1');
    if (!city) missing.push('city');
    if (!zip) missing.push('zip');
    if (!countryCode) missing.push('countryCode');

    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required address fields: ${missing.join(', ')}`,
      });
    }

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const order = await trx('orders')
        .where({ shop_id: shopId, lasyncro_order_id: orderId })
        .first();

      if (!order) {
        throw new Error('ORDER_NOT_FOUND');
      }

      const [updatedOrder] = await trx('orders')
        .where({ shop_id: shopId, lasyncro_order_id: orderId })
        .update({
          shipping_name: name ?? order.shipping_name,
          shipping_address1: address1,
          shipping_address2: address2 ?? null,
          shipping_city: city,
          shipping_zip: zip,
          shipping_phone: phone ?? order.shipping_phone,
          shipping_province: province ?? order.shipping_province,
          shipping_country_code: countryCode,
          aggregate_version: trx.raw('aggregate_version + 1'),
          updated_at: trx.fn.now(),
        })
        .returning('aggregate_version');

      /**
       * RECONCILIATION INTENT (2026-07-02, fixing OF-08 gap found live)
       * -------------------------------------------------------------
       * Bumping aggregate_version alone does NOTHING — confirmed live:
       * an order sat with aggregate_version=4, last_projected_version=0,
       * last_reconciled_at=NULL indefinitely after a real address save.
       * projection.db.worker.ts's Step 4 only reconciles orders that
       * have a pending order_reconciliation_intents row — it doesn't
       * poll/re-check every order unconditionally. Same insert shape
       * as orders.create.ts's real writer (the only other genuine
       * writer of this table, confirmed via full-repo search).
       */
      await trx('order_reconciliation_intents')
        .insert({
          lasyncro_order_id: orderId,
          aggregate_version: updatedOrder.aggregate_version,
          shop_id: shopId,
          observed: JSON.stringify({
            observedAt: new Date().toISOString(),
            source: 'operator_shipping_address_correction',
          }),
          created_at: trx.fn.now(),
        });

      await trx('order_fulfillment_history').insert({
        lasyncro_fulfillment_event_id: crypto.randomUUID(),
        lasyncro_order_id: orderId,
        status: 'address_corrected',
        event_occurred_at: trx.fn.now(),
      });

      /**
       * DOMAIN EVENT EMISSION (GH-1036, 2026-07-02)
       * ---------------------------------------------
       * Confirmed live: bumping aggregate_version + inserting a
       * reconciliation intent alone does NOT clear the constraint.
       * order_reconciliation_intents-driven reconciliation
       * (reconciliation.handlers.ts) can only READ existing
       * order_risk_snapshot rows — it never creates new ones as
       * versions advance, and it never calls the real constraint
       * persistence layer (projectOrderConstraints). Only a real
       * domain event, processed by projection.db.worker.ts →
       * projectDomainEventCore, triggers the full orchestration
       * (age → evaluateOrderConstraints → projectOrderConstraints →
       * projectOrderRisk) that actually re-evaluates and persists the
       * cleared constraint. See GH-1036 for the full investigation —
       * this was a genuine, system-wide gap, not specific to this
       * feature.
       *
       * external_order_id resolved from external_order_identity_map
       * (not orderId itself, which is the internal lasyncro UUID) —
       * matches the shape extractExternalOrderId expects (payload.id).
       */
      const externalIdentity = await trx('external_order_identity_map')
        .where({
          shop_id: shopId,
          platform: 'shopify',
          lasyncro_order_id: orderId,
        })
        .select('external_order_id')
        .first();

      if (externalIdentity?.external_order_id) {
        await trx('domain_events').insert({
          shop_id: shopId,
          event_type: 'orders/shipping_address_corrected',
          event_payload: { id: externalIdentity.external_order_id },
          event_time: trx.fn.now(),
          event_version: 1,
          external_event_id: `${externalIdentity.external_order_id}:shipping_address_corrected:${Date.now()}`,
        });
      } else {
        console.warn('[SHIPPING_ADDRESS_CORRECTED_NO_EXTERNAL_ID]', {
          order_id: orderId,
          shop_id: shopId,
        });
      }

      console.info('[SHIPPING_ADDRESS_UPDATED]', {
        order_id: orderId,
        shop_id: shopId,
      });
    });

    return res.status(200).json({ message: 'Shipping address updated' });
  } catch (error) {
    if (error instanceof Error && error.message === 'ORDER_NOT_FOUND') {
      return res.status(404).json({ error: 'Order not found' });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SHIPPING_ADDRESS_UPDATE_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to update shipping address: ${message}`,
    });
  }
};