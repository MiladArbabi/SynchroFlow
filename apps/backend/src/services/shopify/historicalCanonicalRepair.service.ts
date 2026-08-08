import crypto from 'crypto';
import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';

import { mapShopifyOrderNodeToCanonical } from '../mappers/shopify-to-canonical-order.js';
import { writeOrderRevenueUnits } from '../../workers/reconciliation/revenue-units.writer.js';

const ORDER_UUID_NAMESPACE =
  '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const HISTORICAL_REPAIR_UUID_NAMESPACE =
  'bead20cf-178b-49e8-b4b0-d8d6db202f4e';

export interface HistoricalShippingSnapshot {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  zip: string | null;
  phone: string | null;
  provinceCode: string | null;
  countryCode: string | null;
}

export interface HistoricalCanonicalLineItemPlan {
  lineItemId: string;
  externalVariantId: string | null;
  lasyncroVariantId: string | null;
  lasyncroProductId: string | null;
  sku: string | null;
  title: string;
  quantity: number;
  unitPrice: number | null;
}

export interface HistoricalInventoryNeutralityCheck {
  lasyncroVariantId: string;
  locationCode: string;
  currentOnHand: number;
  currentReserved: number;
  ledgerOnHand: number;
  ledgerReserved: number;
  consistent: boolean;
}

export interface HistoricalCanonicalRepairCandidate {
  domainEventId: number;
  eventTime: string;
  externalOrderId: string;
  lasyncroOrderId: string | null;
  paymentState: string | null;

  sourceShipping: HistoricalShippingSnapshot | null;
  storedShipping: HistoricalShippingSnapshot | null;
  sourceShippingComplete: boolean;
  shippingRepairRequired: boolean;

  sourceLineItemCount: number;
  storedLineItemCount: number;
  sourceQuantityTotal: number;
  storedQuantityTotal: number;
  sourceLineItemIds: string[];
  storedLineItemIds: string[];

  sourceLineItems: HistoricalCanonicalLineItemPlan[];
  lineItemRepairRequired: boolean;

  existingRevenueUnits: number;
  batchMemberships: number;

  inventoryNeutralityChecks:
    HistoricalInventoryNeutralityCheck[];

  blockers: string[];
  repairable: boolean;
}

export interface HistoricalCanonicalRepairPlan {
  shopId: number;
  generatedAt: string;
  totalSourceOrders: number;
  candidates: HistoricalCanonicalRepairCandidate[];
  summary: {
    candidateCount: number;
    repairableCount: number;
    blockedCount: number;
    lineItemRepairCount: number;
    shippingRepairCount: number;
    completeAddressRestoreCount: number;
    domainEventIds: number[];
  };
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function shippingFromCanonical(
  address: any
): HistoricalShippingSnapshot | null {
  if (!address) {
    return null;
  }

  return {
    name: normalizeNullableString(address.name),
    address1: normalizeNullableString(address.address1),
    address2: normalizeNullableString(address.address2),
    city: normalizeNullableString(address.city),
    zip: normalizeNullableString(address.zip),
    phone: normalizeNullableString(address.phone),
    provinceCode: normalizeNullableString(address.provinceCode),
    countryCode: normalizeNullableString(address.countryCode),
  };
}

function shippingFromOrder(
  order: any
): HistoricalShippingSnapshot | null {
  if (!order) {
    return null;
  }

  return {
    name: normalizeNullableString(order.shipping_name),
    address1: normalizeNullableString(order.shipping_address1),
    address2: normalizeNullableString(order.shipping_address2),
    city: normalizeNullableString(order.shipping_city),
    zip: normalizeNullableString(order.shipping_zip),
    phone: normalizeNullableString(order.shipping_phone),
    provinceCode: normalizeNullableString(order.shipping_province),
    countryCode: normalizeNullableString(order.shipping_country_code),
  };
}

function shippingHasAnyValue(
  shipping: HistoricalShippingSnapshot | null
): boolean {
  if (!shipping) {
    return false;
  }

  return Object.values(shipping).some((value) => value !== null);
}

function shippingIsComplete(
  shipping: HistoricalShippingSnapshot | null
): boolean {
  return !!(
    shipping?.address1 &&
    shipping?.city &&
    shipping?.zip &&
    shipping?.countryCode
  );
}

function shippingEquals(
  left: HistoricalShippingSnapshot | null,
  right: HistoricalShippingSnapshot | null
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toShopifyVariantGid(
  rawVariantId: unknown
): string | null {
  if (
    rawVariantId === null ||
    rawVariantId === undefined ||
    String(rawVariantId).trim() === ''
  ) {
    return null;
  }

  const value = String(rawVariantId);

  return value.startsWith('gid://')
    ? value
    : `gid://shopify/ProductVariant/${value}`;
}

export async function planShopifyHistoricalCanonicalRepair(
  trx: Knex.Transaction,
  shopId: number
): Promise<HistoricalCanonicalRepairPlan> {
  const sourceResult = await trx.raw(
    `
      SELECT DISTINCT ON (de.event_payload->>'id')
        de.id,
        de.event_time,
        de.event_payload
      FROM domain_events de
      WHERE de.shop_id = ?
        AND de.event_type = 'orders/create'
        AND de.event_payload->>'id' IS NOT NULL
      ORDER BY
        de.event_payload->>'id',
        de.event_time DESC,
        de.id DESC
    `,
    [shopId]
  );

  const candidates: HistoricalCanonicalRepairCandidate[] = [];

  for (const sourceEvent of sourceResult.rows) {
    const canonical = mapShopifyOrderNodeToCanonical(
      sourceEvent.event_payload,
      shopId
    ) as any;

    const externalOrderId = String(canonical.id);

    const identity = await trx('external_order_identity_map')
      .where({
        shop_id: shopId,
        platform: 'shopify',
        external_order_id: externalOrderId,
      })
      .select('lasyncro_order_id')
      .first();

    const lasyncroOrderId =
      identity?.lasyncro_order_id ?? null;

    const order = lasyncroOrderId
      ? await trx('orders')
          .where({
            shop_id: shopId,
            lasyncro_order_id: lasyncroOrderId,
          })
          .first()
      : null;

    const storedLineItems = lasyncroOrderId
      ? await trx('order_line_items')
          .where({
            lasyncro_order_id: lasyncroOrderId,
          })
          .select(
            'external_line_item_id',
            'lasyncro_variant_id',
            'quantity',
            'unit_price'
          )
      : [];

    const sourceShipping =
      shippingFromCanonical(canonical.shippingAddress);

    const storedShipping =
      shippingFromOrder(order);

    const sourceShippingComplete =
      shippingIsComplete(sourceShipping);

    /**
     * Partial source addresses are restored exactly as Shopify supplied them.
     * This does NOT make them complete and therefore does not falsely clear
     * an incomplete-address constraint.
     */
    const shippingRepairRequired =
      shippingHasAnyValue(sourceShipping) &&
      !shippingEquals(sourceShipping, storedShipping);

    const sourceLineItemIds = (canonical.lineItems ?? [])
      .map((line: any) => String(line.lineItemId))
      .sort();

    const storedLineItemIds = storedLineItems
      .filter((line: any) => line.external_line_item_id != null)
      .map((line: any) => String(line.external_line_item_id))
      .sort();

    const sourceQuantityTotal = (canonical.lineItems ?? [])
      .reduce(
        (sum: number, line: any) =>
          sum + Number(line.quantity ?? 0),
        0
      );

    const storedQuantityTotal = storedLineItems
      .reduce(
        (sum: number, line: any) =>
          sum + Number(line.quantity ?? 0),
        0
      );

    const sourceLineItemCount =
      canonical.lineItems?.length ?? 0;

    const storedLineItemCount =
      storedLineItems.length;

    const lineItemRepairRequired =
      sourceLineItemCount !== storedLineItemCount ||
      sourceQuantityTotal !== storedQuantityTotal ||
      JSON.stringify(sourceLineItemIds) !==
        JSON.stringify(storedLineItemIds);

    if (
      !shippingRepairRequired &&
      !lineItemRepairRequired
    ) {
      continue;
    }

    const blockers: string[] = [];

    /**
     * Never overwrite an address that has gained real persisted data since
     * the historical ingestion defect. A differing non-empty stored address
     * may be an operator correction and therefore outranks the old webhook.
     */
    if (
      shippingRepairRequired &&
      shippingHasAnyValue(storedShipping)
    ) {
      blockers.push(
        'DIVERGENT_STORED_SHIPPING_STATE'
      );
    }

    if (!lasyncroOrderId) {
      blockers.push('MISSING_ORDER_IDENTITY');
    }

    if (!order) {
      blockers.push('MISSING_ORDER');
    }

    const sourceLineItems: HistoricalCanonicalLineItemPlan[] = [];

    for (const line of canonical.lineItems ?? []) {
      const externalVariantId =
        toShopifyVariantGid(line.variantId);

      let lasyncroVariantId: string | null = null;
      let lasyncroProductId: string | null = null;
      let catalogTitle = '';
      let catalogSku: string | null = null;

      if (!externalVariantId) {
        blockers.push(
          `LINE_${String(line.lineItemId)}_MISSING_VARIANT_ID`
        );
      } else {
        const variantIdentity =
          await trx('external_product_identity_map')
            .where({
              shop_id: shopId,
              platform: 'shopify',
              external_variant_id: externalVariantId,
            })
            .select('lasyncro_variant_id')
            .first();

        if (!variantIdentity?.lasyncro_variant_id) {
          blockers.push(
            `LINE_${String(line.lineItemId)}_VARIANT_IDENTITY_MISSING`
          );
        } else {
          lasyncroVariantId =
            variantIdentity.lasyncro_variant_id;

          const variant = await trx('variants')
            .where({
              lasyncro_variant_id: lasyncroVariantId,
            })
            .select(
              'lasyncro_product_id',
              'sku',
              'title'
            )
            .first();

          if (!variant?.lasyncro_product_id) {
            blockers.push(
              `LINE_${String(line.lineItemId)}_VARIANT_ROW_MISSING`
            );
          } else {
            lasyncroProductId =
              variant.lasyncro_product_id;
            catalogSku = variant.sku ?? null;
            catalogTitle = variant.title ?? '';
          }
        }
      }

      const quantity = Number(line.quantity);
      const unitPrice =
        line.unitPrice === null ||
        line.unitPrice === undefined
          ? null
          : Number(line.unitPrice);

      if (
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        blockers.push(
          `LINE_${String(line.lineItemId)}_INVALID_QUANTITY`
        );
      }

      if (
        unitPrice === null ||
        !Number.isFinite(unitPrice)
      ) {
        blockers.push(
          `LINE_${String(line.lineItemId)}_INVALID_UNIT_PRICE`
        );
      }

      sourceLineItems.push({
        lineItemId: String(line.lineItemId),
        externalVariantId,
        lasyncroVariantId,
        lasyncroProductId,
        sku: line.sku ?? catalogSku,
        // Match orders.create.ts canonical materialization semantics:
        // prefer the sovereign variant title over the Shopify product title.
        title:
          catalogTitle ||
          line.title ||
          '',
        quantity,
        unitPrice,
      });
    }

    /**
     * Revenue units are variant-aggregated. Multiple historical source
     * lines resolving to one internal variant are ambiguous for the current
     * writer and therefore require separate investigation.
     */
    const variantCounts = new Map<string, number>();

    for (const line of sourceLineItems) {
      if (!line.lasyncroVariantId) {
        continue;
      }

      variantCounts.set(
        line.lasyncroVariantId,
        (variantCounts.get(line.lasyncroVariantId) ?? 0) + 1
      );
    }

    for (const [variantId, count] of variantCounts) {
      if (count > 1) {
        blockers.push(
          `DUPLICATE_SOURCE_VARIANT:${variantId}`
        );
      }
    }

    /**
     * INVENTORY NEUTRALITY PRECONDITION
     * ---------------------------------
     * Historical line repair will eventually materialize the missing
     * economic sale and pair it with a deterministic reconciliation
     * correction so today's physical inventory does not move.
     *
     * That is safe only if inventory_truth already agrees with the
     * append-only ledger before repair.
     *
     * The movement categories below intentionally match
     * rebuildInventoryProjectionForVariants.
     */
    const inventoryNeutralityChecks:
      HistoricalInventoryNeutralityCheck[] = [];

    if (lineItemRepairRequired) {
      for (const variantId of variantCounts.keys()) {
        const locationCode =
          `WH-${shopId}-ROOT`;

        const truth = await trx('inventory_truth')
          .where({
            shop_id: shopId,
            lasyncro_variant_id: variantId,
            location_code: locationCode,
          })
          .select(
            'on_hand_quantity',
            'reserved_quantity'
          )
          .first();

        const movements =
          await trx('inventory_movements')
            .where({
              shop_id: shopId,
              lasyncro_variant_id: variantId,
              location_code: locationCode,
            })
            .select(
              'movement_type',
              'quantity_delta'
            );

        let ledgerOnHand = 0;
        let ledgerReserved = 0;

        for (const movement of movements) {
          const quantity =
            Number(movement.quantity_delta ?? 0);

          if (
            [
              'inbound_purchase',
              'refund_return',
              'manual_adjustment',
              'reconciliation_correction',
              'opening_balance',
              'sale',
              'damage',
              'shrinkage',
            ].includes(movement.movement_type)
          ) {
            ledgerOnHand += quantity;
          }

          if (
            movement.movement_type ===
            'reservation_hold'
          ) {
            ledgerReserved += quantity;
          }

          if (
            movement.movement_type ===
            'reservation_release'
          ) {
            ledgerReserved += quantity;
          }
        }

        const currentOnHand =
          Number(truth?.on_hand_quantity ?? 0);

        const currentReserved =
          Number(truth?.reserved_quantity ?? 0);

        const consistent =
          currentOnHand === ledgerOnHand &&
          currentReserved === ledgerReserved;

        inventoryNeutralityChecks.push({
          lasyncroVariantId: variantId,
          locationCode,
          currentOnHand,
          currentReserved,
          ledgerOnHand,
          ledgerReserved,
          consistent,
        });

        if (!consistent) {
          blockers.push(
            `INVENTORY_TRUTH_LEDGER_MISMATCH:${variantId}`
          );
        }
      }
    }

    const revenueCountRow = lasyncroOrderId
      ? await trx('order_revenue_units')
          .where({
            lasyncro_order_id: lasyncroOrderId,
          })
          .count<{ count: string }>('* as count')
          .first()
      : null;

    const existingRevenueUnits =
      Number(revenueCountRow?.count ?? 0);

    const batchCountRow = lasyncroOrderId
      ? await trx('pick_batch_orders')
          .where({
            lasyncro_order_id: lasyncroOrderId,
          })
          .count<{ count: string }>('* as count')
          .first()
      : null;

    const batchMemberships =
      Number(batchCountRow?.count ?? 0);

    /**
     * Historical repair is deliberately fail-closed.
     *
     * Current production blast radius has zero persisted lines for each
     * affected order. A partially materialized order requires a separate
     * audit instead of trying to merge ambiguous historical state.
     */
    if (
      lineItemRepairRequired &&
      storedLineItemCount > 0
    ) {
      blockers.push('PARTIAL_LINE_ITEM_STATE');
    }

    if (
      lineItemRepairRequired &&
      existingRevenueUnits > 0
    ) {
      blockers.push('EXISTING_REVENUE_UNITS');
    }

    if (batchMemberships > 0) {
      blockers.push('ORDER_ALREADY_BATCHED');
    }

    const uniqueBlockers = [...new Set(blockers)];

    candidates.push({
      domainEventId: Number(sourceEvent.id),
      eventTime: new Date(
        sourceEvent.event_time
      ).toISOString(),
      externalOrderId,
      lasyncroOrderId,
      paymentState: order?.payment_state ?? null,

      sourceShipping,
      storedShipping,
      sourceShippingComplete,
      shippingRepairRequired,

      sourceLineItemCount,
      storedLineItemCount,
      sourceQuantityTotal,
      storedQuantityTotal,
      sourceLineItemIds,
      storedLineItemIds,

      sourceLineItems,
      lineItemRepairRequired,

      existingRevenueUnits,
      batchMemberships,

      inventoryNeutralityChecks,

      blockers: uniqueBlockers,
      repairable: uniqueBlockers.length === 0,
    });
  }

  return {
    shopId,
    generatedAt: new Date().toISOString(),
    totalSourceOrders: sourceResult.rows.length,
    candidates,
    summary: {
      candidateCount: candidates.length,
      repairableCount:
        candidates.filter((candidate) => candidate.repairable).length,
      blockedCount:
        candidates.filter((candidate) => !candidate.repairable).length,
      lineItemRepairCount:
        candidates.filter(
          (candidate) => candidate.lineItemRepairRequired
        ).length,
      shippingRepairCount:
        candidates.filter(
          (candidate) => candidate.shippingRepairRequired
        ).length,
      completeAddressRestoreCount:
        candidates.filter(
          (candidate) =>
            candidate.shippingRepairRequired &&
            candidate.sourceShippingComplete
        ).length,
      domainEventIds:
        candidates
          .map((candidate) => candidate.domainEventId)
          .sort((a, b) => a - b),
    },
  };
}

export interface HistoricalCanonicalRepairAppliedOrder {
  domainEventId: number;
  externalOrderId: string;
  lasyncroOrderId: string;
  aggregateVersion: number;
  insertedLineItems: number;
  shippingRestored: boolean;
  revenueUnitsMaterialized: number;
  neutralityCorrectionsWritten: number;
  repairDomainEventId: number;
}

export interface HistoricalCanonicalRepairApplyResult {
  shopId: number;
  requestedDomainEventIds: number[];
  repaired: HistoricalCanonicalRepairAppliedOrder[];
  alreadyClean: number[];
}

function deterministicHistoricalLineItemId(
  shopId: number,
  externalOrderId: string,
  externalLineItemId: string
): string {
  /**
   * Must remain identical to orders.create.ts.
   * A repaired historical line must have the same sovereign identity
   * it would have received had original ingestion succeeded.
   */
  return crypto
    .createHash('sha1')
    .update(
      `${ORDER_UUID_NAMESPACE}:${shopId}:shopify:${externalOrderId}:line:${externalLineItemId}`
    )
    .digest('hex')
    .slice(0, 32)
    .replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
      '$1-$2-$3-$4-$5'
    );
}

async function verifyHistoricalRepairInventoryNeutrality(
  trx: Knex.Transaction,
  shopId: number,
  variantId: string
): Promise<HistoricalInventoryNeutralityCheck> {
  const locationCode = `WH-${shopId}-ROOT`;

  const truth = await trx('inventory_truth')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      location_code: locationCode,
    })
    .select(
      'on_hand_quantity',
      'reserved_quantity'
    )
    .first();

  const movements = await trx('inventory_movements')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      location_code: locationCode,
    })
    .select(
      'movement_type',
      'quantity_delta'
    );

  let ledgerOnHand = 0;
  let ledgerReserved = 0;

  for (const movement of movements) {
    const quantity =
      Number(movement.quantity_delta ?? 0);

    if (
      [
        'inbound_purchase',
        'refund_return',
        'manual_adjustment',
        'reconciliation_correction',
        'opening_balance',
        'sale',
        'damage',
        'shrinkage',
      ].includes(movement.movement_type)
    ) {
      ledgerOnHand += quantity;
    }

    if (
      movement.movement_type === 'reservation_hold' ||
      movement.movement_type === 'reservation_release'
    ) {
      ledgerReserved += quantity;
    }
  }

  const currentOnHand =
    Number(truth?.on_hand_quantity ?? 0);

  const currentReserved =
    Number(truth?.reserved_quantity ?? 0);

  return {
    lasyncroVariantId: variantId,
    locationCode,
    currentOnHand,
    currentReserved,
    ledgerOnHand,
    ledgerReserved,
    consistent:
      currentOnHand === ledgerOnHand &&
      currentReserved === ledgerReserved,
  };
}

/**
 * APPLY HISTORICAL SHOPIFY CANONICAL REPAIR
 * ------------------------------------------
 * SHOPIFY-CANON-REST-02.
 *
 * Transaction contract:
 * - caller owns one tenant-scoped transaction
 * - every requested candidate is re-planned inside that transaction
 * - any blocker or post-write invariant failure throws and rolls back ALL
 *   requested repairs
 *
 * Inventory contract:
 * - missing order_line_items are restored
 * - writeOrderRevenueUnits materializes the historical sale
 * - an equal deterministic reconciliation correction is appended
 * - inventory_truth is NOT rewritten
 * - ledger == inventory_truth is verified again before commit
 *
 * This restores economic attribution without changing today's physical stock.
 */
export async function applyShopifyHistoricalCanonicalRepair(
  trx: Knex.Transaction,
  shopId: number,
  domainEventIds: number[]
): Promise<HistoricalCanonicalRepairApplyResult> {
  const requestedDomainEventIds = [
    ...new Set(
      domainEventIds.map((value) => Number(value))
    ),
  ].sort((a, b) => a - b);

  if (
    requestedDomainEventIds.length === 0 ||
    requestedDomainEventIds.some(
      (value) =>
        !Number.isInteger(value) ||
        value <= 0
    )
  ) {
    throw new Error(
      '[SHOPIFY_CANONICAL_REPAIR_INVALID_DOMAIN_EVENT_IDS]'
    );
  }

  /**
   * Re-plan inside the same transaction that will mutate state.
   * This prevents applying an old dry-run result after the order changed.
   */
  const plan =
    await planShopifyHistoricalCanonicalRepair(
      trx,
      shopId
    );

  const candidateByEventId = new Map(
    plan.candidates.map((candidate) => [
      candidate.domainEventId,
      candidate,
    ])
  );

  const repaired: HistoricalCanonicalRepairAppliedOrder[] = [];
  const alreadyClean: number[] = [];

  for (
    const domainEventId of requestedDomainEventIds
  ) {
    const candidate =
      candidateByEventId.get(domainEventId);

    if (!candidate) {
      /**
       * Idempotent second execution:
       * if the source event still exists but no drift candidate remains,
       * this event has already been repaired / is already canonical.
       */
      const sourceExists = await trx('domain_events')
        .where({
          id: domainEventId,
          shop_id: shopId,
          event_type: 'orders/create',
        })
        .select('id')
        .first();

      if (!sourceExists) {
        throw new Error(
          `[SHOPIFY_CANONICAL_REPAIR_SOURCE_EVENT_NOT_FOUND] domainEventId=${domainEventId}`
        );
      }

      alreadyClean.push(domainEventId);
      continue;
    }

    if (!candidate.repairable) {
      throw new Error(
        `[SHOPIFY_CANONICAL_REPAIR_BLOCKED] domainEventId=${domainEventId} blockers=${candidate.blockers.join(',')}`
      );
    }

    if (!candidate.lasyncroOrderId) {
      throw new Error(
        `[SHOPIFY_CANONICAL_REPAIR_ORDER_ID_MISSING] domainEventId=${domainEventId}`
      );
    }

    const lasyncroOrderId =
      candidate.lasyncroOrderId;

    const repairTime = new Date();

    let insertedLineItems = 0;

    if (candidate.lineItemRepairRequired) {
      for (const line of candidate.sourceLineItems) {
        if (
          !line.lasyncroVariantId ||
          !line.lasyncroProductId ||
          line.unitPrice === null
        ) {
          throw new Error(
            `[SHOPIFY_CANONICAL_REPAIR_LINE_NOT_MATERIALIZABLE] domainEventId=${domainEventId} lineItemId=${line.lineItemId}`
          );
        }

        await trx('order_line_items').insert({
          lasyncro_line_item_id:
            deterministicHistoricalLineItemId(
              shopId,
              candidate.externalOrderId,
              line.lineItemId
            ),

          lasyncro_order_id:
            lasyncroOrderId,

          lasyncro_product_id:
            line.lasyncroProductId,

          lasyncro_variant_id:
            line.lasyncroVariantId,

          sku: line.sku,
          title: line.title,

          quantity: line.quantity,
          unit_price: line.unitPrice,
          line_total:
            line.unitPrice * line.quantity,

          platform: 'shopify',

          external_line_item_id:
            line.lineItemId,

          /**
           * These rows existed economically at original Shopify order time.
           * Preserve that temporal anchor instead of pretending the repair
           * created the sale today.
           */
          created_at:
            new Date(candidate.eventTime),

          updated_at:
            new Date(candidate.eventTime),
        });

        insertedLineItems++;
      }
    }

    const orderUpdate: Record<string, any> = {
      aggregate_version:
        trx.raw('aggregate_version + 1'),
      updated_at: repairTime,
    };

    if (
      candidate.shippingRepairRequired &&
      candidate.sourceShipping
    ) {
      orderUpdate.shipping_name =
        candidate.sourceShipping.name;

      orderUpdate.shipping_address1 =
        candidate.sourceShipping.address1;

      orderUpdate.shipping_address2 =
        candidate.sourceShipping.address2;

      orderUpdate.shipping_city =
        candidate.sourceShipping.city;

      orderUpdate.shipping_zip =
        candidate.sourceShipping.zip;

      orderUpdate.shipping_phone =
        candidate.sourceShipping.phone;

      orderUpdate.shipping_province =
        candidate.sourceShipping.provinceCode;

      orderUpdate.shipping_country_code =
        candidate.sourceShipping.countryCode;
    }

    const updatedOrders = await trx('orders')
      .where({
        shop_id: shopId,
        lasyncro_order_id: lasyncroOrderId,
      })
      .update(orderUpdate)
      .returning('aggregate_version');

    if (updatedOrders.length !== 1) {
      throw new Error(
        `[SHOPIFY_CANONICAL_REPAIR_ORDER_UPDATE_COUNT] domainEventId=${domainEventId} count=${updatedOrders.length}`
      );
    }

    const aggregateVersion =
      Number(updatedOrders[0].aggregate_version);

    let revenueUnitsMaterialized = 0;
    let neutralityCorrectionsWritten = 0;

    if (candidate.lineItemRepairRequired) {
      /**
       * Existing revenue-unit writer gives repaired lines the same economic
       * representation as a correctly-ingested fresh order.
       */
      await writeOrderRevenueUnits(
        lasyncroOrderId,
        trx
      );

      const revenueUnits =
        await trx('order_revenue_units')
          .where({
            lasyncro_order_id:
              lasyncroOrderId,
          })
          .select(
            'lasyncro_revenue_unit_id',
            'lasyncro_variant_id',
            'quantity'
          );

      revenueUnitsMaterialized =
        revenueUnits.length;

      const expectedByVariant = new Map(
        candidate.sourceLineItems
          .filter(
            (line) =>
              line.lasyncroVariantId !== null
          )
          .map((line) => [
            line.lasyncroVariantId as string,
            line.quantity,
          ])
      );

      if (
        revenueUnits.length !==
        expectedByVariant.size
      ) {
        throw new Error(
          `[SHOPIFY_CANONICAL_REPAIR_REVENUE_UNIT_COUNT_MISMATCH] domainEventId=${domainEventId} expected=${expectedByVariant.size} actual=${revenueUnits.length}`
        );
      }

      for (const revenueUnit of revenueUnits) {
        const variantId = String(
          revenueUnit.lasyncro_variant_id
        );

        const expectedQuantity =
          expectedByVariant.get(variantId);

        const revenueQuantity =
          Number(revenueUnit.quantity);

        if (
          expectedQuantity === undefined ||
          revenueQuantity !== expectedQuantity
        ) {
          throw new Error(
            `[SHOPIFY_CANONICAL_REPAIR_REVENUE_QUANTITY_MISMATCH] domainEventId=${domainEventId} variant=${variantId}`
          );
        }

        const saleMovement =
          await trx('inventory_movements')
            .where({
              shop_id: shopId,
              lasyncro_variant_id:
                variantId,
              movement_type: 'sale',
              reference_type:
                'order_revenue_unit',
              reference_id:
                revenueUnit.lasyncro_revenue_unit_id,
            })
            .select(
              'quantity_delta',
              'location_code',
              'occurred_at'
            )
            .first();

        if (!saleMovement) {
          throw new Error(
            `[SHOPIFY_CANONICAL_REPAIR_SALE_MOVEMENT_MISSING] domainEventId=${domainEventId} variant=${variantId}`
          );
        }

        if (
          Number(saleMovement.quantity_delta) !==
          -revenueQuantity
        ) {
          throw new Error(
            `[SHOPIFY_CANONICAL_REPAIR_SALE_QUANTITY_MISMATCH] domainEventId=${domainEventId} variant=${variantId}`
          );
        }

        if (
          saleMovement.location_code !==
          `WH-${shopId}-ROOT`
        ) {
          throw new Error(
            `[SHOPIFY_CANONICAL_REPAIR_SALE_LOCATION_MISMATCH] domainEventId=${domainEventId} variant=${variantId}`
          );
        }

        /**
         * The Shopify inventory-level reconciliation already established
         * today's physical stock. Backfilling the historical sale must not
         * subtract that quantity from physical stock a second time.
         *
         * Append the equal opposite correction at the SAME historical time:
         *
         *   sale                       -Q
         *   canonical repair correction +Q
         *                              --
         *   inventory net               0
         */
        const correctionMovementId =
          uuidv5(
            `${revenueUnit.lasyncro_revenue_unit_id}:historical-canonical-repair:movement`,
            HISTORICAL_REPAIR_UUID_NAMESPACE
          );

        const correctionDeviceEventId =
          uuidv5(
            `${revenueUnit.lasyncro_revenue_unit_id}:historical-canonical-repair:device-event`,
            HISTORICAL_REPAIR_UUID_NAMESPACE
          );

        await trx('inventory_movements')
          .insert({
            lasyncro_inventory_movement_id:
              correctionMovementId,

            device_event_id:
              correctionDeviceEventId,

            shop_id: shopId,

            lasyncro_variant_id:
              variantId,

            movement_type:
              'reconciliation_correction',

            quantity_delta:
              revenueQuantity,

            reference_type:
              'canonical_repair',

            reference_id:
              revenueUnit.lasyncro_revenue_unit_id,

            platform: 'shopify',

            location_code:
              saleMovement.location_code,

            occurred_at:
              saleMovement.occurred_at,
          });

        neutralityCorrectionsWritten++;
      }

      /**
       * POST-WRITE INVARIANT
       * --------------------
       * Because sale and repair correction net to zero, inventory_truth
       * must STILL equal the full append-only ledger before transaction
       * commit. Any mismatch aborts and rolls back the whole repair.
       */
      for (
        const variantId of expectedByVariant.keys()
      ) {
        const check =
          await verifyHistoricalRepairInventoryNeutrality(
            trx,
            shopId,
            variantId
          );

        if (!check.consistent) {
          throw new Error(
            `[SHOPIFY_CANONICAL_REPAIR_POST_INVENTORY_MISMATCH] domainEventId=${domainEventId} variant=${variantId} truth=${check.currentOnHand}/${check.currentReserved} ledger=${check.ledgerOnHand}/${check.ledgerReserved}`
          );
        }
      }
    }

    /**
     * Internal repair event is emitted LAST.
     *
     * If any canonical/economic/inventory invariant above fails, no event
     * exists and the entire transaction rolls back.
     *
     * The external identity is deterministic and globally idempotent within
     * the shop because domain_events enforces (shop_id, external_event_id).
     */
    const repairExternalEventId =
      `canonical_data_repair:${domainEventId}`;

    const insertedEvents =
      await trx('domain_events')
        .insert({
          shop_id: shopId,

          event_type:
            'orders/canonical_data_repaired',

          event_payload: {
            id: candidate.externalOrderId,
            source_domain_event_id:
              domainEventId,
            repaired_shipping:
              candidate.shippingRepairRequired,
            repaired_line_items:
              candidate.lineItemRepairRequired,
          },

          event_time: repairTime,
          event_version: 1,

          external_event_id:
            repairExternalEventId,
        })
        .returning('id');

    if (insertedEvents.length !== 1) {
      throw new Error(
        `[SHOPIFY_CANONICAL_REPAIR_EVENT_INSERT_COUNT] domainEventId=${domainEventId}`
      );
    }

    repaired.push({
      domainEventId,
      externalOrderId:
        candidate.externalOrderId,
      lasyncroOrderId,
      aggregateVersion,
      insertedLineItems,
      shippingRestored:
        candidate.shippingRepairRequired,
      revenueUnitsMaterialized,
      neutralityCorrectionsWritten,
      repairDomainEventId:
        Number(insertedEvents[0].id),
    });
  }

  return {
    shopId,
    requestedDomainEventIds,
    repaired,
    alreadyClean,
  };
}
