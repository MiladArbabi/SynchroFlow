import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type Tier = 'starter' | 'core' | 'growth' | 'scale';

let mockTier: Tier = 'scale';
let mockCommercialResolved = true;

jest.mock('runtime/useResolvedNavigation', () => ({
  useResolvedNavigation: () => ({ groups: [] }),
}));

jest.mock('runtime/useModuleHealth', () => ({
  useModuleHealth: () => new Map(),
}));

jest.mock('pages/alerts/useAlerts', () => ({
  useAlerts: () => ({ data: undefined }),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      first_name: 'Milad',
      last_name: '',
      email: 'contact@lasyncro.com',
    },
    logout: jest.fn(),
  }),
}));

jest.mock('runtime/commercialContext', () => ({
  useCommercialAccess: () => ({
    context: {
      tier: mockTier,
      modules: new Set<string>(),
      flags: new Set<string>(),
    },
    isResolved: mockCommercialResolved,
    decide: jest.fn(),
  }),
}));

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { post: jest.fn() },
}));

jest.mock('ui-component/third-party/SimpleBar', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: () => null,
}));

import SidenavContent from '../../../../apps/frontend/src/layouts/AppLayout/SidenavContent';

function renderAndOpenProfileMenu() {
  render(
    <MemoryRouter initialEntries={['/overview']}>
      <SidenavContent
        brandName="laSyncro"
        routes={[]}
        sidenavState="EXPANDED"
        isConnected
        isFt2Ready
      />
    </MemoryRouter>,
  );

  fireEvent.click(screen.getByRole('button', { name: /Milad/i }));

  return screen.getByRole('menu', { name: 'Account menu' });
}

beforeEach(() => {
  mockTier = 'scale';
  mockCommercialResolved = true;
});

it.each([
  ['starter', 'Starter plan'],
  ['core', 'Core plan'],
  ['growth', 'Growth plan'],
  ['scale', 'Scale plan'],
] as const)('shows the resolved %s tier as "%s"', (tier, expectedLabel) => {
  mockTier = tier;

  const menu = renderAndOpenProfileMenu();

  expect(within(menu).getByText('contact@lasyncro.com')).toBeInTheDocument();
  expect(within(menu).getByText(expectedLabel)).toBeInTheDocument();
});

it('does not show a plan label while commercial context is unresolved', () => {
  mockCommercialResolved = false;

  const menu = renderAndOpenProfileMenu();

  expect(within(menu).getByText('contact@lasyncro.com')).toBeInTheDocument();
  expect(
    within(menu).queryByText(/^(Starter|Core|Growth|Scale) plan$/),
  ).not.toBeInTheDocument();
});
