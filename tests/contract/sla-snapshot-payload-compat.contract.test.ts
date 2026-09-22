import { buildSnapshotPayload } from 'api-src/workers/projections/payload/buildSnapshotPayload';
import type { SnapshotMetrics } from 'api-src/workers/projections/types/metrics.types';

describe('SLA-CANONICAL-01D snapshot payload compatibility', () => {
  it('maps canonical slaBreachedRevenue into the legacy persisted column', () => {
    const metrics: SnapshotMetrics = {
      realizedRevenue: 0,
      pendingRevenue: 0,
      atRiskRevenue: 0,

      revenueBlockedInventory: 0,
      revenueBlockedCustomer: 0,
      revenueBlockedOperational: 0,
      blockedRevenueTotal: 0,

      avgContributionMarginPct: 0,

      pendingFulfillment: 0,
      exceptionOrders: 0,
      constrainedOrders: 0,

      aging24h: 0,
      aging48h: 0,
      aging72hPlus: 0,

      ordersAtSlaRisk: 1,
      slaBreachedRevenue: 125.5,

      queueManualReview: 0,
      queueAwaitingInventory: 0,
      queueAwaitingCustomer: 0,
      queueReadyToShip: 0,

      readyToShipRevenue: 0,

      fulfilledOrders: 0,

      oldestExceptionOrderAgeHours: 0,
      revenueLeakage: 0,

      aggregateVersion: 1,
    };

    const payload = buildSnapshotPayload(
      {
        shopId: '42',
        snapshotDateNormalized: '2026-09-22T09:00:00.000Z',
        snapshotDate: new Date('2026-09-22T09:00:00.000Z'),
      },
      metrics
    );

    expect(payload.sla_breach_24h_revenue).toBe(125.5);

    // Canonical naming remains internal. The persisted shape stays backwards
    // compatible until a separately audited schema/API migration retires it.
    expect(payload).not.toHaveProperty('slaBreachedRevenue');
  });
});
