// tests/unit/ui/ft1-checklist/Ft1ChecklistSurface.test.tsx

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import * as readiness from 'lifecycle/useOnboardingReadiness';
import * as focus from 'activation/ft1ChecklistFocus';
import { Ft1ChecklistSurface } from 'ui/src/ui/ft1-checklist/Ft1ChecklistSurface'

jest.mock('lifecycle/useOnboardingReadiness');
jest.mock('lifecycle/ShopLifecycleContext', () => ({
  useShopLifecycle: () => ({ phase: 'FT1_READY' }),
}));
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { shop_id: 1 } }),
}));

describe('Ft1ChecklistSurface', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders checklist modules from backend readiness (including Specter)', async () => {
    jest
      .spyOn(readiness, 'useOnboardingReadiness')
      .mockReturnValue({
        isSuccess: true,
        data: {
          shopId: 1,
          modules: [
            {
              moduleId: 'order-nexus',
              displayName: 'Orders & Profitability',
              tasks: [
                {
                  id: 'orderNexus.reviewProfitAutopsy',
                  label: 'Review your first Profit Autopsy',
                  complete: false,
                },
              ],
            },
            {
              moduleId: 'specter',
              displayName: 'Customer & Conversion (Specter)',
              tasks: [
                {
                  id: 'specter-sdk-installed',
                  label: 'Enable Specter tracking',
                  complete: false,
                },
              ],
            },
          ],
          ft1: {
            isComplete: false,
            blockingModules: ['order-nexus', 'specter'],
            readyModules: [],
          },
        },
      } as any);

    render(<Ft1ChecklistSurface />);

    // open checklist drawer
    act(() => {
      window.dispatchEvent(new CustomEvent('ft1-checklist:open'));
    });

    expect(
      await screen.findByTestId('ft1-checklist-shell')
    ).toBeInTheDocument();

    expect(
      screen.getByText('Orders & Profitability')
    ).toBeInTheDocument();

    expect(
      screen.getByText('Customer & Conversion (Specter)')
    ).toBeInTheDocument();

    expect(
      screen.getByText('Enable Specter tracking')
    ).toBeInTheDocument();
  });

  it('applies focused task when focus is set', async () => {
    jest
      .spyOn(readiness, 'useOnboardingReadiness')
      .mockReturnValue({
        isSuccess: true,
        data: {
          shopId: 1,
          modules: [
            {
              moduleId: 'specter',
              displayName: 'Customer & Conversion (Specter)',
              tasks: [
                {
                  id: 'specter-sdk-installed',
                  label: 'Enable Specter tracking',
                  complete: false,
                },
              ],
            },
          ],
          ft1: {
            isComplete: false,
            blockingModules: ['specter'],
            readyModules: [],
          },
        },
      } as any);

    jest
      .spyOn(focus, 'consumeFt1ChecklistFocus')
      .mockReturnValue({
        moduleId: 'specter',
        taskId: 'specter-sdk-installed',
      });

    render(<Ft1ChecklistSurface />);

    act(() => {
      window.dispatchEvent(new CustomEvent('ft1-checklist:open'));
    });

    const focusedTask = await screen.findByText(
      'Enable Specter tracking'
    );

    expect(
      focusedTask.closest('li')
    ).toHaveAttribute('data-focused-task', 'true');
  });
});