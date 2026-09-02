// tests/unit/ui/ft2/OrdersFT2Page.returnedPackage.wiring.test.tsx
//
// RET-RETPKG · Case D — LIVE WIRING
// OrdersFT2Page must obtain the EXISTING constrained-orders payload
// (useConstrainedOrders → GET /api/v1/orders/constrained) and pass the
// active returned_undelivered rows through to OrdersModuleFT2 as
// `constrainedOrders`. No new endpoint.

import React from 'react';

import { renderWithProviders } from 'test-utils';
import OrdersFT2Page from 'pages/ft2-pages/OrdersFT2Page';

const mockOrdersModuleFT2 = jest.fn();
const mockUseConstrainedOrders = jest.fn();

jest.mock('@lasyncro/order-nexus', () => ({
  __esModule: true,
  OrdersModuleFT2: (props: any) => {
    mockOrdersModuleFT2(props);
    return require('react').createElement('div', { 'data-testid': 'orders-module-ft2' });
  },
}));

// @lasyncro/shared/ui's barrel does not resolve under jest (./activation/index.js).
// Stub the single symbol OrdersFT2Page uses.
jest.mock('@lasyncro/shared/ui', () => ({
  __esModule: true,
  EntityDetailModal: ({ children }: any) => require('react').createElement(require('react').Fragment, {}, children),
}));

jest.mock('pages/orders/OrderDetailModalBody', () => ({
  __esModule: true,
  OrderDetailModalBody: () => null,
}));

jest.mock('components/ModuleTabBar', () => ({
  __esModule: true,
  ModuleTabBar: () => null,
}));

jest.mock('components/OrderCapBanner', () => ({
  __esModule: true,
  OrderCapBanner: () => null,
}));

jest.mock('components/ShippedOrderCapBanner', () => ({
  __esModule: true,
  ShippedOrderCapBanner: () => null,
}));

jest.mock('components/ExportDrawer', () => ({
  __esModule: true,
  ExportDrawer: () => null,
}));

jest.mock('pages/orders/useOrdersFt2Snapshot', () => ({
  useOrdersFt2Snapshot: () => ({
    data: {
      decision: { brief: null },
      operationalControl: {
        snapshot_date: new Date().toISOString(),
        aggregate_version: 1,
        constrained_orders: 1,
      },
    },
  }),
}));

jest.mock('pages/orders/useOrdersFt2Adapter', () => ({
  mapOrdersFt2Props: () => ({
    context: {},
    orders: { total: 1, fulfilled: 0, unfulfilled: 1, constrained: 1 },
    revenue: { totalSales: 0, earned: 0, pending: 0, blocked: 0 },
    decision: { brief: null },
  }),
}));

jest.mock('pages/orders/useOrdersOperatorSummary', () => ({
  useOrdersOperatorSummary: () => ({ data: { agingOrders: [] } }),
}));

jest.mock('pages/orders/useConstrainedOrders', () => ({
  useConstrainedOrders: (opts: any) => mockUseConstrainedOrders(opts),
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({ displayCurrency: 'USD', locale: 'en-US', tier: 'growth' }),
}));

jest.mock('hooks/useExchangeRates', () => ({
  useExchangeRates: () => ({ rates: {} }),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useBulkSetPriority: () => ({ mutateAsync: jest.fn().mockResolvedValue(undefined) }),
}));

beforeEach(() => {
  mockOrdersModuleFT2.mockClear();
  mockUseConstrainedOrders.mockReset();
  mockUseConstrainedOrders.mockReturnValue({
    data: {
      data: [
        {
          order_id: '989979d7-2c3b-41ec-e18d-a3e38e71dc9f',
          external_order_id: '900099',
          constraint_type: 'operational',
          block_type: 'returned_undelivered',
          revenue: 0,
          age_since_creation_seconds: null,
          is_shipping_sla_breached: null,
        },
        {
          order_id: 'inv-1',
          external_order_id: '800001',
          constraint_type: 'inventory',
          block_type: 'oversell',
          revenue: 100,
          age_since_creation_seconds: null,
          is_shipping_sla_breached: null,
        },
      ],
      pagination: { page: 1, limit: 50 },
    },
  });
});

describe('OrdersFT2Page — returned-package constrained-orders wiring', () => {
  it('D — passes active returned_undelivered constrained orders into OrdersModuleFT2', () => {
    renderWithProviders(<OrdersFT2Page />);

    expect(mockUseConstrainedOrders).toHaveBeenCalled();
    expect(mockOrdersModuleFT2).toHaveBeenCalled();

    const props = mockOrdersModuleFT2.mock.calls[0][0];
    expect(Array.isArray(props.constrainedOrders)).toBe(true);

    const returnedPackage = props.constrainedOrders.filter(
      (o: any) => o.constraint_type === 'operational' && o.block_type === 'returned_undelivered'
    );
    expect(returnedPackage).toHaveLength(1);
    expect(returnedPackage[0].external_order_id).toBe('900099');
  });
});
