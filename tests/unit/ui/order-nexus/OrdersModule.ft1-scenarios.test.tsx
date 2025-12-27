//tests/unit/ui/order-nexus/OrdersModule.ft1-scenarios.test.tsx
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

describe('OrdersModule – FT1 scenario composition', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders NO_ORDERS surface', () => {
    (useOrdersFt1Scenario as jest.Mock).mockReturnValue('NO_ORDERS');

    render(
        <OrdersModule
            ordersIngested={0}
            hasNegativeMarginOrder={false}
            missingCostCount={0}
        />
    );

    expect(
      screen.getByTestId('orders-ft1-no-orders')
    ).toBeInTheDocument();
  });

  it('renders LOSS surface', () => {
    (useOrdersFt1Scenario as jest.Mock).mockReturnValue('LOSS');

    render(
    <OrdersModule
        ordersIngested={5}
        hasNegativeMarginOrder={true}
        missingCostCount={0}
    />);

    expect(
      screen.getByTestId('orders-ft1-loss')
    ).toBeInTheDocument();
  });

  it('renders UNCERTAIN surface', () => {
    (useOrdersFt1Scenario as jest.Mock).mockReturnValue('UNCERTAIN');

    render(
    <OrdersModule
        ordersIngested={5}
        hasNegativeMarginOrder={false}
        missingCostCount={2}
    />);

    expect(
      screen.getByTestId('orders-ft1-uncertain')
    ).toBeInTheDocument();
  });

  it('renders HEALTHY surface', () => {
    (useOrdersFt1Scenario as jest.Mock).mockReturnValue('HEALTHY');

    render(
    <OrdersModule
        ordersIngested={10}
        hasNegativeMarginOrder={false}
        missingCostCount={0}
    />);

    expect(
      screen.getByTestId('orders-ft1-healthy')
    ).toBeInTheDocument();
  });
});