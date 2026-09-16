// tests/unit/backend/webhooks/carrierTrackingNormalization.test.ts
//
// DR-02 (#1114) — pure-function contract for the shared carrier tracking
// normalization module. No DB, no transaction — these are the decision
// functions both shippo.tracking.handler.ts and sendcloud.tracking.handler.ts
// delegate to.
//
// DR-02-CORRECTION: updated in place (not multiplied) to match:
//  A. toAuditEventType now returns real 'unknown' (migration 0176).
//  B. Sendcloud dedup heuristic removed entirely — no longer exists to test.
//  C. Blanket terminal locking replaced by explicit transition rules.

import {
  resolveCanonicalEventType,
  toAuditEventType,
  toProjectionStatus,
  shouldUpdateShipmentTruth,
  ABSOLUTE_TERMINAL_EVENT_TYPES,
  CARRIER_HANDOFF_EVENTS,
} from 'api-src/api/webhooks/carrierTrackingNormalization';

describe('resolveCanonicalEventType', () => {
  it('returns the mapped event_type when a carrier_status_map row exists', () => {
    expect(resolveCanonicalEventType({ event_type: 'delivered', fault_category: null })).toBe('delivered');
  });

  it('returns null (not a fabricated default) when no row exists', () => {
    expect(resolveCanonicalEventType(undefined)).toBeNull();
  });
});

describe('toProjectionStatus', () => {
  it('passes through a mapped canonical status', () => {
    expect(toProjectionStatus('in_transit')).toBe('in_transit');
  });

  it('renders unmapped as the literal string "unknown", never "in_transit" or "exception"', () => {
    expect(toProjectionStatus(null)).toBe('unknown');
  });
});

describe('toAuditEventType', () => {
  it('passes through a mapped canonical status', () => {
    expect(toAuditEventType('delivered')).toBe('delivered');
  });

  it('DR-02-CORRECTION-A: returns real "unknown" for an unmapped status, following migration 0176', () => {
    expect(toAuditEventType(null)).toBe('unknown');
    expect(toAuditEventType(null)).not.toBe('in_transit');
    expect(toAuditEventType(null)).not.toBe('exception');
  });
});

describe('shouldUpdateShipmentTruth', () => {
  const t1 = new Date('2026-09-15T10:00:00.000Z');
  const t2 = new Date('2026-09-15T11:00:00.000Z');

  it('allows the first event on a fresh shipment', () => {
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: null, latestEventAt: null },
        { mappedEventType: 'in_transit', eventTimestamp: t1 }
      )
    ).toBe(true);
  });

  it('allows a strictly newer event to advance a non-terminal state', () => {
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'in_transit', latestEventAt: t1 },
        { mappedEventType: 'out_for_delivery', eventTimestamp: t2 }
      )
    ).toBe(true);
  });

  it('blocks a stale (older-or-equal timestamp) event from regressing a non-terminal state', () => {
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'out_for_delivery', latestEventAt: t2 },
        { mappedEventType: 'in_transit', eventTimestamp: t1 }
      )
    ).toBe(false);
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'out_for_delivery', latestEventAt: t2 },
        { mappedEventType: 'in_transit', eventTimestamp: t2 }
      )
    ).toBe(false);
  });

  // DR-02-CORRECTION-C: explicit transition rules for 'delivered'.
  it('delivered + older in_transit -> stays delivered', () => {
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'delivered', latestEventAt: t2 },
        { mappedEventType: 'in_transit', eventTimestamp: t1 }
      )
    ).toBe(false);
  });

  it('delivered + older out_for_delivery -> stays delivered', () => {
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'delivered', latestEventAt: t2 },
        { mappedEventType: 'out_for_delivery', eventTimestamp: t1 }
      )
    ).toBe(false);
  });

  it('delivered + a NEWER non-returned event still stays delivered (only returned may advance it)', () => {
    const t3 = new Date('2026-09-15T12:00:00.000Z');
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'delivered', latestEventAt: t1 },
        { mappedEventType: 'out_for_delivery', eventTimestamp: t3 }
      )
    ).toBe(false);
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'delivered', latestEventAt: t1 },
        { mappedEventType: 'in_transit', eventTimestamp: t3 }
      )
    ).toBe(false);
  });

  it('delivered + LATER valid returned -> advances to returned', () => {
    const t3 = new Date('2026-09-15T12:00:00.000Z');
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'delivered', latestEventAt: t1 },
        { mappedEventType: 'returned', eventTimestamp: t3 }
      )
    ).toBe(true);
  });

  it('delivered + an OLDER returned event does not advance it', () => {
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'delivered', latestEventAt: t2 },
        { mappedEventType: 'returned', eventTimestamp: t1 }
      )
    ).toBe(false);
  });

  // DR-02-CORRECTION-C: 'returned' is absolute terminal — nothing overrides it.
  it('returned + any earlier/pre-return state -> stays returned', () => {
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'returned', latestEventAt: t2 },
        { mappedEventType: 'in_transit', eventTimestamp: t1 }
      )
    ).toBe(false);
  });

  it('returned + delivered -> stays returned', () => {
    const t3 = new Date('2026-09-15T12:00:00.000Z');
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'returned', latestEventAt: t1 },
        { mappedEventType: 'delivered', eventTimestamp: t3 }
      )
    ).toBe(false);
  });

  it('a stale returned event must not incorrectly overwrite a newer returned state', () => {
    expect(
      shouldUpdateShipmentTruth(
        { latestStatus: 'returned', latestEventAt: t2 },
        { mappedEventType: 'returned', eventTimestamp: t1 }
      )
    ).toBe(false);
  });

  it('exactly "returned" is absolute terminal, and nothing else', () => {
    expect(ABSOLUTE_TERMINAL_EVENT_TYPES.has('returned')).toBe(true);
    expect(ABSOLUTE_TERMINAL_EVENT_TYPES.has('delivered')).toBe(false);
    expect(ABSOLUTE_TERMINAL_EVENT_TYPES.has('in_transit')).toBe(false);
    expect(ABSOLUTE_TERMINAL_EVENT_TYPES.has('exception')).toBe(false);
    expect(ABSOLUTE_TERMINAL_EVENT_TYPES.has('out_for_delivery')).toBe(false);
    expect(ABSOLUTE_TERMINAL_EVENT_TYPES.has('announced')).toBe(false);
  });

  it('keeps the carrier-handoff set unchanged from pre-DR-02 behavior', () => {
    expect([...CARRIER_HANDOFF_EVENTS].sort()).toEqual(
      ['delivered', 'in_transit', 'out_for_delivery', 'returned'].sort()
    );
  });
});
