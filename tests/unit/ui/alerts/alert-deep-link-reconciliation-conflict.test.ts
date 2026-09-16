// RECONCILIATION-CONFLICT-02 — operator navigation contract.
//
// A persisted inventory reconciliation conflict is actionable work.
// Its canonical web destination is Problem Center.
//
// The conflict UUID remains entity context only for this slice; Problem Center
// does not yet expose a supported conflict-targeting query contract.

import {
  ALERT_ROUTE_MAP,
  alertDeepLink,
} from 'pages/alerts/alertDeepLink';
import type { Alert } from 'pages/alerts/useAlerts';

function alert(): Alert {
  return {
    id: 'alert-1',
    alert_key:
      'reconciliation:conflict-123:inventory_reconciliation_conflict',
    source: 'reconciliation',
    alert_type: 'inventory_reconciliation_conflict',
    severity: 'warning',
    title: 'Inventory conflict needs review',
    message: 'Fixture reconciliation conflict',
    entity_id: 'conflict-123',
    entity_type: 'inventory_reconciliation_conflict',
    revenue_impact: null,
    category: 'data_trust',
    audience: 'operator',
    is_active: true,
    dismissed_at: null,
    resolved_at: null,
    acknowledged_at: null,
    acknowledged_by: null,
    snoozed_until: null,
    escalated_at: null,
    rule_id: null,
    created_at: '2026-09-16T10:00:00.000Z',
    updated_at: '2026-09-16T10:00:00.000Z',
    treatment: null,
    action: null,
  };
}

describe(
  'alertDeepLink — inventory reconciliation conflict',
  () => {
    it(
      'routes the reconciliation alert to Problem Center without inventing unsupported query targeting',
      () => {
        expect(
          ALERT_ROUTE_MAP.inventory_reconciliation_conflict
        ).toEqual({
          route: '/problem-center',
          label: 'Problem Center',
        });

        expect(alertDeepLink(alert())).toEqual({
          route: '/problem-center',
          label: 'Problem Center',
        });
      }
    );
  }
);
