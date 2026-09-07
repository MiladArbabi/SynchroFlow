import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type Tier = 'starter' | 'core' | 'growth' | 'scale';

let mockTier: Tier = 'core';
const mockNav = jest.fn();
const mockPromptProps = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNav,
}));

jest.mock('hooks/useAppTheme', () => ({
  useAppTheme: () => ({}),
}));

jest.mock('hooks/usePlanEntitlement', () => ({
  usePlanEntitlement: () => ({
    tier: mockTier,
    can: () => true,
  }),
}));

jest.mock('runtime/commercialContext', () => ({
  useCommercialAccess: () => ({
    isResolved: true,
    decide: (capabilityId: string) => {
      if (capabilityId === 'purchasing.core') {
        const allowed = mockTier !== 'starter';
        return allowed
          ? { allowed: true, reason: 'ALLOWED' }
          : { allowed: false, reason: 'TIER_TOO_LOW', requiredTier: 'core' };
      }

      if (capabilityId === 'purchasing.sourcing') {
        const allowed = mockTier === 'growth' || mockTier === 'scale';
        return allowed
          ? { allowed: true, reason: 'ALLOWED' }
          : { allowed: false, reason: 'TIER_TOO_LOW', requiredTier: 'growth' };
      }

      return { allowed: true, reason: 'ALLOWED' };
    },
  }),
}));

jest.mock('components/UpgradePrompt', () => {
  const ReactActual = jest.requireActual('react');

  const MockUpgradePrompt = (props: any) => {
    mockPromptProps(props);

    if (!props.open) return null;

    return ReactActual.createElement(
      'div',
      {
        'data-testid': 'upgrade-prompt',
        'data-mode': props.mode ?? '',
        'data-feature': props.featureName ?? '',
        'data-required-tier':
          props.decision?.requiredTier ?? props.requiredTier ?? '',
      },
      (props.benefits ?? []).join(' | '),
    );
  };

  return {
    __esModule: true,
    UpgradePrompt: MockUpgradePrompt,
    default: MockUpgradePrompt,
  };
});

import { ModuleTabBar } from 'components/ModuleTabBar';
import { PURCHASING_SUB_TABS } from 'pages/ft2-pages/purchasingSubTabs';

beforeEach(() => {
  mockTier = 'core';
  mockNav.mockReset();
  mockPromptProps.mockReset();
});

describe('PUR-COMM-UX-01 — locked Sourcing tab upgrade UX', () => {
  it('EXPECTED RED: Core keeps Sourcing visible, does not navigate, and opens a Growth modal with Sourcing-specific benefits', () => {
    render(
      <MemoryRouter initialEntries={['/suppliers-portal']}>
        <ModuleTabBar tabs={PURCHASING_SUB_TABS} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Sourcing')).not.toBeNull();
    expect(screen.getByText('Growth')).not.toBeNull();

    fireEvent.click(screen.getByText('Sourcing'));

    expect(mockNav).not.toHaveBeenCalled();

    const prompt = screen.getByTestId('upgrade-prompt');

    expect(prompt.getAttribute('data-mode')).toBe('modal');
    expect(prompt.getAttribute('data-feature')).toBe('Sourcing');
    expect(prompt.getAttribute('data-required-tier')).toBe('growth');

    expect(prompt.textContent).toContain(
      'Prioritize sourcing work from current inventory demand',
    );
    expect(prompt.textContent).toContain(
      'Compare supplier recommendations by product',
    );
    expect(prompt.textContent).toContain(
      'Use supplier-product preferences',
    );
    expect(prompt.textContent).toContain(
      'Accumulate reorder quantities against MOQ',
    );
  });

  it('GREEN CONTROL: Growth Sourcing click navigates normally and does not open an upgrade modal', () => {
    mockTier = 'growth';

    render(
      <MemoryRouter initialEntries={['/suppliers-portal']}>
        <ModuleTabBar tabs={PURCHASING_SUB_TABS} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('Sourcing'));

    expect(mockNav).toHaveBeenCalledWith('/suppliers-portal/sourcing');
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });
});
