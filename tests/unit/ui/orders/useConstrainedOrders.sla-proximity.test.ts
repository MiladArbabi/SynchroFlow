// SLA-SEM-01 — RED-first frontend proximity semantics.
//
// The current helper is creation-age/hardcoded-threshold based.
// The canonical contract is paid-age + merchant-configured Fulfillment SLA.

import {
  getSlaProximity,
  type ConstrainedOrder,
} from '../../../../apps/frontend/src/pages/orders/useConstrainedOrders';

function order(input: {
  creationAgeSeconds: number;
  paidAgeSeconds: number;
  slaHours: number;
  breached?: boolean;
}): ConstrainedOrder {
  return {
    order_id: 'sla-sem-01-order',
    external_order_id: '#SLA-1',
    constraint_type: 'inventory',
    block_type: null,
    constrained_since: null,
    revenue: 100,
    promised_ship_by: null,
    recommended_action: null,
    priority: null,
    decision_id: null,
    age_since_creation_seconds: input.creationAgeSeconds,
    is_shipping_sla_breached: input.breached ?? false,
    is_delivery_sla_breached: false,
    gross_margin: null,
    margin_pct: null,

    // SLA-SEM-01 target contract fields.
    // Cast below deliberately allows RED against the current transport shape.
    age_since_paid_seconds: input.paidAgeSeconds,
    fulfillment_sla_hours: input.slaHours,
  } as ConstrainedOrder;
}

describe('getSlaProximity — SLA-SEM-01', () => {
  it('SLA-APPROACH-02 ignores creation-age-only operational aging', () => {
    expect(
      getSlaProximity(
        order({
          creationAgeSeconds: 40 * 3600,
          paidAgeSeconds: 2 * 3600,
          slaHours: 24,
        })
      )
    ).toBe('ok');
  });

  it('SLA-APPROACH-03 warns in final 4h of a 24h SLA', () => {
    expect(
      getSlaProximity(
        order({
          creationAgeSeconds: 21 * 3600,
          paidAgeSeconds: 21 * 3600,
          slaHours: 24,
        })
      )
    ).toBe('warning');
  });

  it('SLA-APPROACH-03 scales a 1h SLA to a 15m warning window', () => {
    expect(
      getSlaProximity(
        order({
          creationAgeSeconds: 46 * 60,
          paidAgeSeconds: 46 * 60,
          slaHours: 1,
        })
      )
    ).toBe('warning');
  });

  it('keeps a 24h SLA order outside the warning window at 19h paid age', () => {
    expect(
      getSlaProximity(
        order({
          creationAgeSeconds: 19 * 3600,
          paidAgeSeconds: 19 * 3600,
          slaHours: 24,
        })
      )
    ).toBe('ok');
  });

  it('breach remains higher priority than approaching', () => {
    expect(
      getSlaProximity(
        order({
          creationAgeSeconds: 30 * 3600,
          paidAgeSeconds: 30 * 3600,
          slaHours: 24,
          breached: true,
        })
      )
    ).toBe('breached');
  });
});
