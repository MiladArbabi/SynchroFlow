// tests/unit/backend/order-nexus/orderNexusFt2.resolver.test.ts

import { describe, it, expect, jest } from '@jest/globals';
import { getOrderNexusFt2Snapshot } from
  'api-src/services/order-nexus-ft2/orderNexusFt2.resolver';

// ─────────────────────────────────────────────
// Mocks — ALL external dependencies
// ─────────────────────────────────────────────
jest.mock('api-src/services/order-facts/orderFacts.service', () => ({
  extractOrderFacts: jest.fn(),
}));

jest.mock('api-src/services/order-facts/orderTrendFacts.service', () => ({
  extractOrderTrendFacts: jest.fn(),
}));

jest.mock('api-src/services/order-facts/orderFulfillmentFacts.service', () => ({
  extractOrderFulfillmentFacts: jest.fn(),
}));

jest.mock('api-src/services/order-intelligence/orderIntelligence.service', () => ({
  deriveOrderIntelligence: jest.fn(),
}));

jest.mock(
  'api-src/services/order-intelligence/orderFulfillmentIntelligence.service',
  () => ({
    deriveOrderFulfillmentIntelligence: jest.fn(),
  })
);

jest.mock('api-src/services/order-ftep/orderFtep.service', () => ({
  exposeOrderNexusFT2: jest.fn(),
}));

jest.mock('api-src/services/alignment-planes/alignmentPlanes.resolver', () => ({
  resolveAlignmentPlanes: jest.fn(),
}));

const mockExtractOrderFacts =
  extractOrderFacts as jest.MockedFunction<typeof extractOrderFacts>;

const mockExtractOrderTrendFacts =
  extractOrderTrendFacts as jest.MockedFunction<
    typeof extractOrderTrendFacts
  >;

const mockExtractOrderFulfillmentFacts =
  extractOrderFulfillmentFacts as jest.MockedFunction<
    typeof extractOrderFulfillmentFacts
  >;

// ─────────────────────────────────────────────
// Imports (after mocks)
// ─────────────────────────────────────────────
import { extractOrderFacts } from
  'api-src/services/order-facts/orderFacts.service';
import { extractOrderTrendFacts } from
  'api-src/services/order-facts/orderTrendFacts.service';
import { extractOrderFulfillmentFacts } from
  'api-src/services/order-facts/orderFulfillmentFacts.service';

import { deriveOrderIntelligence } from
  'api-src/services/order-intelligence/orderIntelligence.service';
import { deriveOrderFulfillmentIntelligence } from
  'api-src/services/order-intelligence/orderFulfillmentIntelligence.service';

import { exposeOrderNexusFT2 } from
  'api-src/services/order-ftep/orderFtep.service';

import { resolveAlignmentPlanes } from
  'api-src/services/alignment-planes/alignmentPlanes.resolver';

describe('OrderNexus FT2 Resolver — Alignment Orchestration', () => {
  it('orchestrates Facts → Intelligence → FTEP → Alignment without DB access', async () => {
    // ───────── Layer 1 — Facts
    mockExtractOrderFacts.mockResolvedValue({
      shopId: 1,
      ordersObserved: 10,
      totals: {
        revenueTotal: 1000,
        costTotal: 700,
        currency: 'USD',
      },
      dataCoverage: {
        completenessPct: 90,
      },
      extractedAt: '2025-01-01T00:00:00.000Z',
    });

    mockExtractOrderTrendFacts.mockResolvedValue({
      previousWindowOrders: 8,
      currentWindowOrders: 10,
    });

    mockExtractOrderFulfillmentFacts.mockResolvedValue({
      fulfillmentSignal: 'present',
      visibility: 'sufficient',
    });

    // ───────── Layer 2 — Intelligence
    (deriveOrderIntelligence as jest.Mock).mockReturnValue({
      ordersObserved: 10,
      margin: { averagePct: null, status: 'healthy' },
      loss: { exists: false },
      trend: { direction: 'up' },
      dataCoveragePct: 90,
      visibility: { status: 'sufficient' },
    });

    (deriveOrderFulfillmentIntelligence as jest.Mock).mockReturnValue({
      operationalReality: 'real',
      visibility: 'sufficient',
    });

    // ───────── Layer 3 — FTEP
    (exposeOrderNexusFT2 as jest.Mock).mockReturnValue({
      context: { ordersObserved: 10 },
      totals: { revenueTotal: 1000, costTotal: 700, currency: 'USD' },
      outcome: { status: 'positive' },
      trend: { direction: 'up' },
      dataCoverage: { completenessPct: 90 },
      visibility: { status: 'sufficient' },
    });

    // ───────── Alignment
    (resolveAlignmentPlanes as jest.Mock).mockReturnValue({
      'demand-reality': 'aligned',
      'engagement-revenue': 'unknown',
      'operational-economic': 'aligned',
    });

    // ───────── Execute
    const result = await getOrderNexusFt2Snapshot({
      shopId: 1,
      range: 'today',
    });

    // ───────── Assertions
    expect(extractOrderFacts).toHaveBeenCalled();
    expect(extractOrderTrendFacts).toHaveBeenCalled();
    expect(extractOrderFulfillmentFacts).toHaveBeenCalled();

    expect(deriveOrderIntelligence).toHaveBeenCalled();
    expect(deriveOrderFulfillmentIntelligence).toHaveBeenCalled();

    expect(exposeOrderNexusFT2).toHaveBeenCalled();
    expect(resolveAlignmentPlanes).toHaveBeenCalled();

    expect(result.alignment).toEqual({
      demandReality: 'aligned',
      engagementRevenue: 'unknown',
      operationalEconomic: 'aligned',
    });
  });
});
