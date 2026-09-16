// tests/unit/ui/alerts/alert-deep-link-stock-protection.test.ts
//
// STOCK-PROTECT-03 Slice 3B — canonical shared alertDeepLink() must consume
// the backend-derived `action` field verbatim for alert_type='stock_protection'
// and must NEVER re-derive treatment or invent a static route for it.
// PERMANENT regression contract.

import { alertDeepLink, ALERT_ROUTE_MAP } from 'pages/alerts/alertDeepLink';
import type { Alert } from 'pages/alerts/useAlerts';

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a1',
    alert_key: 'k',
    source: 'projection',
    alert_type: 'stock_protection',
    severity: 'critical',
    title: 'Fixture title',
    message: 'Fixture message',
    entity_id: 'variant-abc',
    entity_type: 'variant',
    revenue_impact: null,
    category: 'stock_reorder',
    audience: 'all',
    is_active: true,
    dismissed_at: null,
    resolved_at: null,
    acknowledged_at: null,
    acknowledged_by: null,
    snoozed_until: null,
    escalated_at: null,
    rule_id: null,
    created_at: '2026-09-13T10:00:00.000Z',
    updated_at: '2026-09-13T10:00:00.000Z',
    treatment: null,
    action: null,
    ...over,
  };
}

describe('alertDeepLink — stock_protection backend-action precedence', () => {
  it('A: stock_protection + backend action -> returns backend route/label, not the static map', () => {
    const a = alert({
      treatment: 'reorder_now',
      action: {
        key: 'stock_protection_reorder_now',
        label: 'Reorder now',
        route: '/suppliers-portal/sourcing?variantId=variant-abc',
        module: 'suppliers-portal',
      },
    });

    expect(alertDeepLink(a)).toEqual({
      route: '/suppliers-portal/sourcing?variantId=variant-abc',
      label: 'Reorder now',
    });
  });

  it('B: stock_protection + action=null -> null, never an invented Stock Protection route', () => {
    const a = alert({ treatment: 'complete_setup', action: null });

    expect(alertDeepLink(a)).toBeNull();
  });

  it('B2: stock_protection + action=null even with treatment=reorder_now (e.g. commercially denied) -> null', () => {
    const a = alert({ treatment: 'reorder_now', action: null });

    expect(alertDeepLink(a)).toBeNull();
  });

  it('B3: no ALERT_ROUTE_MAP entry exists for stock_protection', () => {
    expect(ALERT_ROUTE_MAP.stock_protection).toBeUndefined();
  });

  it('C: legacy stockout_risk route/variant-append behavior is unchanged', () => {
    const a = alert({
      alert_type: 'stockout_risk',
      entity_type: 'variant',
      entity_id: 'variant-xyz',
      treatment: undefined,
      action: undefined,
    });

    expect(alertDeepLink(a)).toEqual({
      route: '/suppliers-portal/sourcing?variantId=variant-xyz',
      label: 'Sourcing',
    });
  });

  it('C2: legacy low_stock_reorder route is unchanged', () => {
    const a = alert({
      alert_type: 'low_stock_reorder',
      entity_type: null,
      entity_id: null,
      treatment: undefined,
      action: undefined,
    });

    expect(alertDeepLink(a)).toEqual({
      route: '/demand?filter=critical',
      label: 'Reorder now',
    });
  });

  it('C3: billing_usage_threshold routes to canonical billing settings', () => {
    const a = alert({
      alert_type: 'billing_usage_threshold',
      entity_type: 'shop_usage_period',
      entity_id: 'usage-period-1',
      treatment: undefined,
      action: undefined,
    });

    expect(alertDeepLink(a)).toEqual({
      route: '/settings/billing',
      label: 'Billing',
    });
  });

  it('a backend action on a legacy alert type would still take precedence (future-proofing, no special-case needed)', () => {
    const a = alert({
      alert_type: 'stockout_risk',
      action: { key: 'x', label: 'Custom', route: '/custom', module: 'suppliers-portal' },
    });

    expect(alertDeepLink(a)).toEqual({ route: '/custom', label: 'Custom' });
  });
});
