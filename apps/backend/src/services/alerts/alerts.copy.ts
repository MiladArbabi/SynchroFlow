// apps/backend/src/services/alerts/alerts.copy.ts
//
// ALERT COPY HELPERS (OV-DATA-02 — OV-SEM correction)
// --------------------------------------------------
// Pure title/message builders for the two shop-level alerts whose wording is
// surfaced in the Overview "Needs a decision" panel:
//   - sla_breach       (orders past the shop's fulfillment SLA)
//   - revenue_at_risk  (orders blocked by an active constraint)
//
// These strings are the canonical merchant-facing wording. The monetary figure
// for each alert stays in the alert's `revenue_impact` field and is rendered
// separately by the UI — it is deliberately kept out of the prose here.
//
// Pure: no I/O, no clock.

/**
 * Shop-level "orders past Fulfillment SLA" alert (alert_type: sla_breach), active branch.
 *
 * @param breachedOrderCount  distinct unfulfilled orders past the shop's fulfillment SLA
 * @param breachedOrderValue  summed order value of those orders — surfaced only via the
 *                            alert's `revenue_impact` field, never the copy. Retained in
 *                            the signature to match the aggregator call site.
 */
export function buildSlaBreachAlertCopy(
  breachedOrderCount: number,
  breachedOrderValue: number,
): { title: string; message: string } {
  const plural = breachedOrderCount > 1;
  return {
    title: `${breachedOrderCount} order${plural ? 's' : ''} past Fulfillment SLA`,
    message: `${breachedOrderCount} order${plural ? 's are' : ' is'} past the Fulfillment SLA — fulfil ${plural ? 'them' : 'it'} now to prevent customer complaints.`,
  };
}

/**
 * Shop-level "orders blocked by constraints" alert (alert_type: revenue_at_risk), active branch.
 *
 * @param blockedOrderCount  orders held by an active constraint
 * @param blockedRevenue     blocked order value — surfaced only via the alert's
 *                           `revenue_impact` field, never the copy. Retained in the
 *                           signature to match the aggregator call site.
 */
export function buildBlockedRevenueAlertCopy(
  blockedOrderCount: number,
  blockedRevenue: number,
): { title: string; message: string } {
  const plural = blockedOrderCount > 1;
  return {
    title: `${blockedOrderCount} order${plural ? 's' : ''} blocked`,
    message: `${blockedOrderCount} order${plural ? 's are' : ' is'} blocked by an active constraint — resolve each blocker to release ${plural ? 'them' : 'it'} for fulfillment.`,
  };
}
