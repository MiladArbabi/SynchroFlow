// tests/unit/ui/pages/OrdersPage.adapter.test.tsx
import { mapOrdersFt1Props } from 'pages/orders/useOrdersFt1Adapter';

jest.mock('@lasyncro/order-nexus', () => ({
  __esModule: true,
  default: jest.fn(() => <div data-testid="orders-module-mock" />),
}));


describe('FT1 Orders Adapter – mapOrdersFt1Props', () => {
  const baseReadiness = {
    modules: [
      {
        moduleId: 'order-nexus',
        signals: []
      }
    ]
  };

  it('returns ordersIngested = null when ordersKnown=false', () => {
    const readiness = {
      ...baseReadiness,
      modules: [{
        moduleId: 'order-nexus',
        signals: [
          { name: 'orderNexus.ordersKnown', value: false }
        ]
      }]
    };

    const props = mapOrdersFt1Props(readiness);
    expect(props.ordersIngested).toBeNull();
  });

  it('returns ordersIngested = 0 when known and zero', () => {
    const readiness = {
      ...baseReadiness,
      modules: [{
        moduleId: 'order-nexus',
        signals: [
          { name: 'orderNexus.ordersKnown', value: true },
          { name: 'orderNexus.ordersIngested', value: 0 }
        ]
      }]
    };

    const props = mapOrdersFt1Props(readiness);
    expect(props.ordersIngested).toBe(0);
  });

  it('returns ordersIngested > 0 when orders exist', () => {
    const readiness = {
      ...baseReadiness,
      modules: [{
        moduleId: 'order-nexus',
        signals: [
          { name: 'orderNexus.ordersKnown', value: true },
          { name: 'orderNexus.ordersIngested', value: 7 }
        ]
      }]
    };

    const props = mapOrdersFt1Props(readiness);
    expect(props.ordersIngested).toBe(7);
  });

  it('never coerces null to zero', () => {
    const readiness = {
      ...baseReadiness,
      modules: [{
        moduleId: 'order-nexus',
        signals: []
      }]
    };

    const props = mapOrdersFt1Props(readiness);
    expect(props.ordersIngested).toBeNull();
  });
});