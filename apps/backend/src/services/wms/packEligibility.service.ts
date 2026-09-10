// apps/backend/src/services/wms/packEligibility.service.ts
import { Knex } from 'knex';

/**
 * PACK ELIGIBILITY SERVICE (GH-1086 / PACK-GATE-01)
 * -------------------------------------------------
 * The single authority on whether an order that is already inside warehouse
 * execution may be packed, and for how much.
 *
 * DOMAIN CONTRACT
 * ---------------
 * A Pick problem is a Problem Center / warehouse-execution concern. It never
 * returns an order to Order Pool, never populates Blocked Orders, and never
 * detaches the order from pick_batch_orders. Batch membership stays
 * authoritative for the whole life of the batch.
 *
 * Problem Center operational actions (re_stow, discard, write_off, quarantine,
 * find_replacement) resolve physical custody of the missing units. They do NOT
 * authorize shipment, and neither does pick_exceptions.resolved = true. That is
 * why this service never reads pick_exceptions: settling custody of a missing
 * unit does not conjure the unit into the parcel.
 *
 * Two independent inputs decide eligibility:
 *
 *   1. PHYSICAL EVIDENCE — for a line Pick reported short (a pick_exceptions
 *      row of type item_missing / short_pick), the confirmed pick_scan_log
 *      quantity for that line in this batch is the ceiling. A short_pick
 *      writes a confirmed scan for exactly the quantity found
 *      (recordShortPickPhysicalOutcome), so partial physical truth is already
 *      represented there; item_missing writes none.
 *
 *      The exception row is the deficit SIGNAL; `resolved` is deliberately
 *      never read, because settling custody of a missing unit does not put
 *      the unit in the parcel. A line Pick never reported short carries no
 *      deficit.
 *
 *   2. COMMERCIAL AUTHORIZATION — pack_decision_requests. Shipping an order
 *      short of what the customer bought is a commercial decision owned by the
 *      owner/admin, never by the warehouse floor.
 *
 * The packable ceiling per line is therefore min(ordered, physically picked).
 * Missing quantity is never fabricated into Pack evidence, and closure never
 * demands a scan for a unit that does not exist.
 */

export type PackEligibilityStatus =
  /** Every line has full physical evidence. Ordinary executable Pack work. */
  | 'full_pack'
  /** Deficit exists and an owner/admin approved shipping it partial. */
  | 'approved_partial'
  /** Deficit exists and an owner/admin decided to hold it. Not packable. */
  | 'held'
  /** Deficit exists and no owner/admin decision has been made yet. */
  | 'authorization_required';

export interface PackEligibilityLine {
  lasyncroLineItemId: string;
  lasyncroVariantId: string;
  orderedQuantity: number;
  /** Confirmed pick_scan_log quantity for this line in this batch. */
  pickedQuantity: number;
  /** Confirmed pack_scan_log quantity for this line in this batch. */
  packedQuantity: number;
  /**
   * How much Pack may confirm for this line. Zero whenever the order is not
   * authorized at all, so a non-authorized order has no packable surface.
   */
  packableQuantity: number;
  /** Ordered quantity that has no physical evidence behind it. */
  deficitQuantity: number;
}

export interface OrderPackEligibility {
  lasyncroOrderId: string;
  status: PackEligibilityStatus;
  /** True for full_pack and approved_partial only. */
  packable: boolean;
  /** True when any line lacks full physical evidence. */
  hasDeficit: boolean;
  /** True when every line has already met its packable ceiling. */
  packEvidenceComplete: boolean;
  lines: PackEligibilityLine[];
}

export interface BatchScope {
  shopId: number;
  pickBatchId: string;
}

/** Thrown when a Pack mutation is attempted on a non-authorized order. */
export const PACK_ORDER_NOT_AUTHORIZED = 'PACK_ORDER_NOT_AUTHORIZED';
/** Thrown when a Pack scan would exceed the physical Pick evidence. */
export const PACK_QUANTITY_EXCEEDS_PICK_EVIDENCE = 'PACK_QUANTITY_EXCEEDS_PICK_EVIDENCE';

interface EvidenceRow {
  lasyncro_order_id: string;
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  ordered_quantity: string | number;
  picked_quantity: string | number;
  packed_quantity: string | number;
  has_fulfillment_exception: boolean;
}

interface DecisionRow {
  lasyncro_order_id: string;
  status: string;
  partial_shipment: boolean | null;
}

/**
 * Per-line physical evidence for every order in the batch, anchored on
 * pick_batch_orders so an order with no scan rows at all still appears.
 * Tenant scoping is explicit on every table; the caller must additionally hold
 * SET LOCAL "app.current_tenant".
 */
async function loadBatchEvidence(
  trx: Knex.Transaction,
  scope: BatchScope
): Promise<EvidenceRow[]> {
  const result = await trx.raw(
    `
    SELECT
      pbo.lasyncro_order_id,
      oli.lasyncro_line_item_id,
      oli.lasyncro_variant_id,
      oli.quantity AS ordered_quantity,
      COALESCE(pick.qty, 0) AS picked_quantity,
      COALESCE(pack.qty, 0) AS packed_quantity,
      EXISTS (
        SELECT 1
        FROM pick_exceptions pe
        WHERE pe.shop_id = pbo.shop_id
          AND pe.pick_batch_id = pbo.pick_batch_id
          AND pe.lasyncro_line_item_id = oli.lasyncro_line_item_id
          AND pe.exception_type IN ('item_missing', 'short_pick')
      ) AS has_fulfillment_exception
    FROM pick_batch_orders pbo
    JOIN order_line_items oli
      ON oli.lasyncro_order_id = pbo.lasyncro_order_id
    LEFT JOIN LATERAL (
      SELECT SUM(psl.quantity_confirmed)::int AS qty
      FROM pick_scan_log psl
      WHERE psl.shop_id = pbo.shop_id
        AND psl.pick_batch_id = pbo.pick_batch_id
        AND psl.lasyncro_line_item_id = oli.lasyncro_line_item_id
        AND psl.status = 'confirmed'
    ) pick ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(pkl.quantity_confirmed)::int AS qty
      FROM pack_scan_log pkl
      WHERE pkl.shop_id = pbo.shop_id
        AND pkl.pick_batch_id = pbo.pick_batch_id
        AND pkl.lasyncro_line_item_id = oli.lasyncro_line_item_id
        AND pkl.status = 'confirmed'
    ) pack ON TRUE
    WHERE pbo.shop_id = ?
      AND pbo.pick_batch_id = ?
    `,
    [scope.shopId, scope.pickBatchId]
  );

  return result.rows as EvidenceRow[];
}

async function loadBatchDecisions(
  trx: Knex.Transaction,
  scope: BatchScope
): Promise<DecisionRow[]> {
  return trx('pack_decision_requests')
    .where({ shop_id: scope.shopId, pick_batch_id: scope.pickBatchId })
    .select('lasyncro_order_id', 'status', 'partial_shipment');
}

/**
 * Commercial authorization for one order.
 *
 * Fail-closed precedence: an explicit hold outranks an approval, so a
 * contradictory pair of decisions can never open the shipment path. A rejected
 * decision means "hold this order" — it does NOT mean requeue, and nothing here
 * or downstream may detach it from its batch.
 */
function classifyDecisions(decisions: DecisionRow[]): PackEligibilityStatus {
  const held = decisions.some(
    (d) =>
      d.status === 'rejected' ||
      (d.status === 'approved' && d.partial_shipment !== true)
  );
  if (held) return 'held';

  const approvedPartial = decisions.some(
    (d) => d.status === 'approved' && d.partial_shipment === true
  );
  if (approvedPartial) return 'approved_partial';

  return 'authorization_required';
}

function buildOrderEligibility(
  lasyncroOrderId: string,
  evidence: EvidenceRow[],
  decisions: DecisionRow[]
): OrderPackEligibility {
  const rawLines = evidence.map((row) => {
    const orderedQuantity = Number(row.ordered_quantity);
    const pickedQuantity = Number(row.picked_quantity);
    const packedQuantity = Number(row.packed_quantity);

    /**
     * A fulfillment deficit is a RECORDED Pick outcome, not merely an absence
     * of scan rows. Only a line that Pick actually reported short
     * (item_missing / short_pick) is measured against its physical evidence.
     *
     * This distinction matters: not every batch reaches Pack through
     * unit-level pick scanning, and treating "no pick_scan_log row" as
     * "units are missing" would hold back orders the warehouse never reported
     * a problem for. Absence of a report means Pick found no shortfall.
     *
     * Where a shortfall WAS reported, physical evidence becomes the ceiling —
     * capped by the ordered quantity, so an over-pick never authorises
     * shipping more than the customer bought.
     */
    const physicallyAvailable = row.has_fulfillment_exception
      ? Math.min(orderedQuantity, pickedQuantity)
      : orderedQuantity;

    return {
      lasyncroLineItemId: row.lasyncro_line_item_id,
      lasyncroVariantId: row.lasyncro_variant_id,
      orderedQuantity,
      pickedQuantity,
      packedQuantity,
      physicallyAvailable,
      deficitQuantity: orderedQuantity - physicallyAvailable,
    };
  });

  const hasDeficit = rawLines.some((l) => l.deficitQuantity > 0);

  const status: PackEligibilityStatus = hasDeficit
    ? classifyDecisions(decisions)
    : 'full_pack';

  const packable = status === 'full_pack' || status === 'approved_partial';

  const lines: PackEligibilityLine[] = rawLines.map((l) => ({
    lasyncroLineItemId: l.lasyncroLineItemId,
    lasyncroVariantId: l.lasyncroVariantId,
    orderedQuantity: l.orderedQuantity,
    pickedQuantity: l.pickedQuantity,
    packedQuantity: l.packedQuantity,
    // A non-authorized order exposes no packable surface at all.
    packableQuantity: packable ? l.physicallyAvailable : 0,
    deficitQuantity: l.deficitQuantity,
  }));

  return {
    lasyncroOrderId,
    status,
    packable,
    hasDeficit,
    // Closure never waits on a unit that does not physically exist.
    packEvidenceComplete:
      packable && lines.every((l) => l.packedQuantity >= l.packableQuantity),
    lines,
  };
}

/**
 * Eligibility for every order in the batch, keyed by lasyncro_order_id.
 * One pair of queries for the whole batch — callers iterating a batch must use
 * this rather than calling the single-order variant in a loop.
 */
export async function getBatchPackEligibility(
  trx: Knex.Transaction,
  scope: BatchScope
): Promise<Map<string, OrderPackEligibility>> {
  const [evidence, decisions] = await Promise.all([
    loadBatchEvidence(trx, scope),
    loadBatchDecisions(trx, scope),
  ]);

  const byOrder = new Map<string, EvidenceRow[]>();
  for (const row of evidence) {
    const bucket = byOrder.get(row.lasyncro_order_id) ?? [];
    bucket.push(row);
    byOrder.set(row.lasyncro_order_id, bucket);
  }

  const result = new Map<string, OrderPackEligibility>();
  for (const [orderId, rows] of byOrder) {
    result.set(
      orderId,
      buildOrderEligibility(
        orderId,
        rows,
        decisions.filter((d) => d.lasyncro_order_id === orderId)
      )
    );
  }
  return result;
}

/**
 * Eligibility for a single order in a batch.
 * Returns null when the order is not a member of the batch, or has no lines.
 */
export async function getOrderPackEligibility(
  trx: Knex.Transaction,
  scope: BatchScope & { lasyncroOrderId: string }
): Promise<OrderPackEligibility | null> {
  const eligibility = await getBatchPackEligibility(trx, scope);
  return eligibility.get(scope.lasyncroOrderId) ?? null;
}

/**
 * Mutation-boundary guard. Throws before any Pack write when the order is not
 * commercially authorized, or when the requested quantity exceeds the physical
 * Pick evidence for that line.
 *
 * Every Pack entry path (direct scan, unit free-scan, invoice close) funnels
 * through this so a direct API call cannot evade the gate.
 */
export async function assertOrderPackEligible(
  trx: Knex.Transaction,
  scope: BatchScope & {
    lasyncroOrderId: string;
    lasyncroLineItemId?: string;
    quantityConfirmed?: number;
  }
): Promise<OrderPackEligibility> {
  const eligibility = await getOrderPackEligibility(trx, scope);

  if (!eligibility) {
    throw new Error(`${PACK_ORDER_NOT_AUTHORIZED}:not_in_batch`);
  }

  if (!eligibility.packable) {
    throw new Error(`${PACK_ORDER_NOT_AUTHORIZED}:${eligibility.status}`);
  }

  if (scope.lasyncroLineItemId && typeof scope.quantityConfirmed === 'number') {
    const line = eligibility.lines.find(
      (l) => l.lasyncroLineItemId === scope.lasyncroLineItemId
    );

    if (!line) {
      throw new Error(`${PACK_ORDER_NOT_AUTHORIZED}:line_not_in_order`);
    }

    const remaining = line.packableQuantity - line.packedQuantity;
    if (scope.quantityConfirmed > remaining) {
      throw new Error(
        `${PACK_QUANTITY_EXCEEDS_PICK_EVIDENCE}:` +
          `requested=${scope.quantityConfirmed},available=${remaining},` +
          `picked=${line.pickedQuantity},ordered=${line.orderedQuantity}`
      );
    }
  }

  return eligibility;
}

/** True when the order may not be packed and still carries a deficit. */
export function isHeldForFulfillmentDeficit(
  eligibility: OrderPackEligibility
): boolean {
  return eligibility.hasDeficit && !eligibility.packable;
}
