// tests/unit/ui/lifecycle/Ft1ChecklistSurface.test.tsx

import React from 'react';
import { render, screen } from '@testing-library/react';
import { Ft1ChecklistDataSurface } from 'lifecycle/Ft1ChecklistDataSurface';
import * as readiness from 'lifecycle/useOnboardingReadiness';

jest.mock('lifecycle/useOnboardingReadiness');

describe('Ft1ChecklistSurface', () => {
  it('renders checklist modules from onboarding readiness snapshot', () => {
    (readiness.useOnboardingReadiness as jest.Mock).mockReturnValue({
      isSuccess: true,
      data: {
        shopId: 1,
        modules: [
          {
            moduleId: 'order-nexus',
            displayName: 'Orders & Profitability',
            tasks: [
              {
                id: 'sync-orders',
                label: 'Sync orders',
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
      },
    });

    render(<Ft1ChecklistDataSurface shopId={1} />);

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

  it('renders nothing while readiness is loading', () => {
    (readiness.useOnboardingReadiness as jest.Mock).mockReturnValue({
      isSuccess: false,
    });

    const { container } = render(
      <Ft1ChecklistDataSurface shopId={1} />
    );

    expect(container.firstChild).toBeNull();
  });
});
