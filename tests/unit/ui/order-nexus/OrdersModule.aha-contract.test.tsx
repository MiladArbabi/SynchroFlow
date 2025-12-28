// tests/unit/ui/order-nexus/OrdersModule.aha-contract.test.tsx
import OrdersModule from '@lasyncro/order-nexus';
import { assertAhaPanelIntent } from '../helpers/assertAhaPanelIntent';

describe('OrderNexus Aha contract', () => {
  it('UNCERTAIN → emits START_ONBOARDING(add-costs)', () => {
    assertAhaPanelIntent({
      ui: (
        <OrdersModule
          ordersIngested={3}
          hasNegativeMarginOrder={false}
          missingCostCount={2}
        />
      ),
      ctaLabel: 'Complete cost setup',
      expectedIntent: {
        type: 'START_ONBOARDING',
        taskId: 'add-costs',
      },
    });
  });
});
