// apps/backend/src/api/webhooks/carrierTrackingNormalization.ts
//
// DR-02 (#1114) — Carrier Truth Foundation
// -----------------------------------------
// Shared normalization + shipment-truth guard logic extracted from
// shippo.tracking.handler.ts and sendcloud.tracking.handler.ts, which
// previously duplicated this logic independently (DR-01 audit finding).
//
// Scope: normalization interpretation and pure decision functions only.
// Payload parsing (provider-specific field extraction), signature
// verification, and table-write orchestration remain in each handler —
// those differ enough between providers (HMAC vs token, timestamp
// availability, location shape) that unifying them further was judged
// out of DR-02's strict scope ("do not rewrite unrelated webhook
// architecture").
//
// DR-02-CORRECTION (this revision):
//  A. toAuditEventType now returns the real 'unknown' value, following
//     migration 0176 (parcel_tracking_events_event_type_check extended).
//  B. Removed the Sendcloud receipt-time dedup heuristic entirely — see
//     sendcloud.tracking.handler.ts for why.
//  C. Replaced blanket "delivered/returned are both permanently locked"
//     terminal handling with the explicit transition rules #1114 actually
//     needs (see shouldUpdateShipmentTruth).

export type CanonicalEventType =
  | 'announced'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'returned';

// The one additional value legal in parcel_tracking_events.event_type and
// order_shipment_tracking.latest_status beyond the 6 carrier_status_map
// canonical types (migration 0176). Never a carrier_status_map seed value —
// see that migration's header comment for why.
export type AuditEventType = CanonicalEventType | 'unknown';

export type FaultCategory = 'carrier_fault' | 'customer_fault' | 'unknown';

// 'returned' is the absolute terminal state in the DR-01 ratified canonical
// lifecycle (SHIPPED -> ... -> RETURNING -> RETURNED -> MERCHANT RESOLUTION
// -> CLOSED never re-enters carrier transit). Once the projection reaches
// it, no further webhook — earlier, later, or same-status — may change it.
export const ABSOLUTE_TERMINAL_EVENT_TYPES: ReadonlySet<CanonicalEventType> = new Set([
  'returned',
]);

// Only explicitly mapped physical-movement statuses prove carrier handoff.
export const CARRIER_HANDOFF_EVENTS: ReadonlySet<CanonicalEventType> = new Set([
  'in_transit',
  'out_for_delivery',
  'delivered',
  'returned',
]);

export interface CarrierStatusMapRow {
  event_type: CanonicalEventType;
  fault_category: FaultCategory | null;
}

/**
 * Resolves a carrier_status_map lookup result to a canonical event type,
 * or null when the raw status has no mapping.
 *
 * DR-02 fix: callers MUST treat null as "unknown", never coerce it to
 * 'in_transit' (the pre-DR-02 behavior in both handlers) or to 'exception'
 * (explicitly forbidden by the DR-02 brief — that would fabricate a known
 * cause bucket for a status that is, by definition, not understood).
 */
export function resolveCanonicalEventType(
  statusMapRow: CarrierStatusMapRow | undefined
): CanonicalEventType | null {
  return statusMapRow?.event_type ?? null;
}

/**
 * order_shipment_tracking.latest_status is a plain nullable varchar(64)
 * with no CHECK constraint (confirmed against migration 0118/0113/0114) —
 * it has always been able to honestly hold the literal string 'unknown'.
 */
export function toProjectionStatus(mappedEventType: CanonicalEventType | null): string {
  return mappedEventType ?? 'unknown';
}

/**
 * DR-02-CORRECTION-A: parcel_tracking_events.event_type's CHECK constraint
 * now includes 'unknown' (migration 0176_carrier_tracking_event_type_unknown).
 * An unmapped raw status is recorded honestly here too — no more 'in_transit'
 * placeholder. carrier_status_map itself is deliberately NOT extended with an
 * 'unknown' seed row (see that migration's header comment): the absence of a
 * mapping IS the "unknown" signal, not a value to look up.
 */
export function toAuditEventType(mappedEventType: CanonicalEventType | null): AuditEventType {
  return mappedEventType ?? 'unknown';
}

export interface ShipmentTruthState {
  latestStatus: string | null;
  latestEventAt: Date | null;
}

export interface IncomingShipmentEvent {
  mappedEventType: CanonicalEventType | null;
  eventTimestamp: Date;
}

/**
 * DR-02-CORRECTION-C: explicit transition rules for #1114's carrier truth,
 * not a speculative universal state machine. Three cases, in order:
 *
 * 1. Current status is 'returned' (absolute terminal) — reject every
 *    incoming event unconditionally. Covers: "returned + any earlier/
 *    pre-return state -> stay returned", "returned + delivered -> stay
 *    returned", and "a stale returned event must not incorrectly overwrite
 *    a newer returned state" (trivially true — nothing overwrites it, ever).
 *
 * 2. Current status is 'delivered' — the ONLY accepted forward transition
 *    is to a genuinely newer 'returned' event (a package can legitimately
 *    be returned after being marked delivered; it can never legitimately
 *    "un-deliver" back to an earlier carrier phase). Covers: "delivered +
 *    older in_transit/out_for_delivery -> stay delivered" and "delivered +
 *    LATER valid returned -> advance to returned".
 *
 * 3. Every other (non-terminal) current status — standard staleness guard:
 *    accept only if the incoming event's timestamp is strictly newer than
 *    the currently recorded latest_event_at (or there is none yet).
 *
 * This function gates ONLY the order_shipment_tracking projection update.
 * It never gates parcel_tracking_events insertion (raw evidence is always
 * persisted regardless of whether the projection accepts the event) and
 * never gates return_jobs/alert creation on a 'returned' event, which have
 * their own independent idempotency keys.
 */
export function shouldUpdateShipmentTruth(
  current: ShipmentTruthState,
  incoming: IncomingShipmentEvent
): boolean {
  const currentStatus = current.latestStatus as CanonicalEventType | 'unknown' | null;

  if (currentStatus && ABSOLUTE_TERMINAL_EVENT_TYPES.has(currentStatus as CanonicalEventType)) {
    return false;
  }

  if (currentStatus === 'delivered') {
    if (incoming.mappedEventType !== 'returned') {
      return false;
    }
    if (current.latestEventAt && incoming.eventTimestamp.getTime() <= current.latestEventAt.getTime()) {
      return false;
    }
    return true;
  }

  if (current.latestEventAt && incoming.eventTimestamp.getTime() <= current.latestEventAt.getTime()) {
    return false;
  }
  return true;
}
