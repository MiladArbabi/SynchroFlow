/**
 * FT1 UI Contract Tests — Order-Nexus
 * ----------------------------------
 * These tests enforce the semantic meaning of FT1 diagnostics.
 *
 * They intentionally assert COPY, not just structure, to prevent:
 * - Overconfident language
 * - Semantic drift
 * - FT2 logic leaking into FT1
 *
 * If these tests fail after a copy change, the copy is wrong.
 */

// tests/unit/ui/order-nexus/OrdersModule.ft1-scenarios.test.tsx
import { render, screen } from '@testing-library/react';
import OrdersModule, {
  useOrdersFt1Scenario,
} from '@lasyncro/order-nexus';

jest.mock('@lasyncro/order-nexus', () => {
  const actual = jest.requireActual('@lasyncro/order-nexus');
  return {
    __esModule: true,
    ...actual,
    useOrdersFt1Scenario: jest.fn(),
  };
});

describe('OrdersModule – FT1 scenario composition (diagnostic)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders NO_ORDERS diagnostic surface', () => {
    (useOrdersFt1Scenario as jest.Mock).mockReturnValue('NO_ORDERS');

    render(
      <OrdersModule
        ordersIngested={0}
        hasNegativeMarginOrder={false}
        missingCostCount={0}
      />
    );

    expect(screen.getByTestId('orders-ft1-no-orders')).toBeInTheDocument();
    expect(
      screen.getByText(/no orders have been recorded yet/i)
    ).toBeInTheDocument();
  });

  it('renders LOSS diagnostic surface', () => {
    (useOrdersFt1Scenario as jest.Mock).mockReturnValue('LOSS');

    render(
      <OrdersModule
        ordersIngested={5}
        hasNegativeMarginOrder={true}
        missingCostCount={0}
      />
    );

    expect(screen.getByTestId('orders-ft1-loss')).toBeInTheDocument();
    expect(
      screen.getByText(/at least one order has a negative margin/i)
    ).toBeInTheDocument();
  });

  it('renders UNCERTAIN diagnostic surface', () => {
    (useOrdersFt1Scenario as jest.Mock).mockReturnValue('UNCERTAIN');

    render(
      <OrdersModule
        ordersIngested={5}
        hasNegativeMarginOrder={false}
        missingCostCount={2}
      />
    );

    expect(screen.getByTestId('orders-ft1-uncertain')).toBeInTheDocument();
    expect(
      screen.getByText(/profitability cannot be determined yet/i)
    ).toBeInTheDocument();
  });

  it('renders HEALTHY diagnostic surface', () => {
    (useOrdersFt1Scenario as jest.Mock).mockReturnValue('HEALTHY');

    render(
      <OrdersModule
        ordersIngested={10}
        hasNegativeMarginOrder={false}
        missingCostCount={0}
      />
    );

    expect(screen.getByTestId('orders-ft1-healthy')).toBeInTheDocument();
    expect(
      screen.getByText(/no negative margins detected/i)
    ).toBeInTheDocument();
  });
});
