// tests/unit/ui/ops-console/ops-console-now-v1-alert-deep-link.test.ts
//
// NOW V1 — canonical alertDeepLink() routing contract for the ratified
// alert-backed NOW allowlist.
//
// Only `sla_breach` changes: NOW V1 requires it to resolve to
// `/orders/flow?urgency=sla_breach` (Orders), not the current generic
// `/orders` mapping in ALERT_ROUTE_MAP — RED against the current
// implementation. `inventory` and `customer` are locked here as explicitly
// unchanged; `stockout_risk` and `low_stock_reorder` are already locked by
// tests/unit/ui/alerts/alert-deep-link-stock-protection.test.ts and are not
// duplicated here.

import { alertDeepLink } from 'pages/alerts/alertDeepLink';
import type { Alert } from 'pages/alerts/useAlerts';

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a1',
    alert_key: 'k',
    source: 'projection',
    alert_type: 'sla_breach',
    severity: 'critical',
    title: 'Fixture title',
    message: 'Fixture message',
    entity_id: null,
    entity_type: null,
    revenue_impact: null,
    category: null,
    audience: 'all',
    is_active: true,
    dismissed_at: null,
    resolved_at: null,
    acknowledged_at: null,
    acknowledged_by: null,
    snoozed_until: null,
    escalated_at: null,
    rule_id: null,
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
    treatment: null,
    action: null,
    ...over,
  };
}

describe('NOW V1 routing contract — alertDeepLink()', () => {
  it('D: sla_breach resolves to /orders/flow?urgency=sla_breach, labelled Orders', () => {
    expect(alertDeepLink(alert({ alert_type: 'sla_breach' }))).toEqual({
      route: '/orders/flow?urgency=sla_breach',
      label: 'Orders',
    });
  });

  it('inventory remains unchanged: /orders/flow?constraint=inventory, Resolve stockouts', () => {
    expect(alertDeepLink(alert({ alert_type: 'inventory' }))).toEqual({
      route: '/orders/flow?constraint=inventory',
      label: 'Resolve stockouts',
    });
  });

  it('customer remains unchanged: /overview?resolution=address, Fix addresses', () => {
    expect(alertDeepLink(alert({ alert_type: 'customer' }))).toEqual({
      route: '/overview?resolution=address',
      label: 'Fix addresses',
    });
  });
});
