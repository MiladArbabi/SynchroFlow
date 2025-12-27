// tests/unit/ui/pages/OrdersPage.adapter.test.tsx

import { render } from '@testing-library/react';
import OrdersPage from 'pages/OrdersPage';
import OrdersModule from '@lasyncro/order-nexus';

jest.mock('@lasyncro/order-nexus', () => ({
  __esModule: true,
  default: jest.fn(() => <div data-testid="orders-module-mock" />),
}));

describe('OrdersPage → OrdersModule adapter', () => {
  it('passes FT1 props to OrdersModule', () => {
    render(<OrdersPage />);

    expect(OrdersModule).toHaveBeenCalledWith(
      expect.objectContaining({
        ordersIngested: expect.any(Number),
        hasNegativeMarginOrder: expect.any(Boolean),
        missingCostCount: expect.any(Number),
      }),
      expect.anything()
    );
  });
});