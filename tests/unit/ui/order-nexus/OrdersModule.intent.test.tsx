//tests/unit/ui/order-nexus/OrdersModule.intent.test.tsx
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import OrdersModule from '@lasyncro/order-nexus';
import { renderWithTheme } from 'test-utils';

describe('OrdersModule → START_ONBOARDING intent', () => {
  it('emits START_ONBOARDING with correct taskId on CTA click (UNCERTAIN)', () => {
    const onIntent = jest.fn();

    renderWithTheme(
      <OrdersModule
        ordersIngested={5}
        hasNegativeMarginOrder={false}
        missingCostCount={2}
        onIntent={onIntent}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /complete cost setup/i })
    );

    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith({
      type: 'START_ONBOARDING',
      taskId: 'add-costs',
    });
  });
});
