import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  CAPABILITY_REQUIREMENTS, evaluateAccess, modulesForTier, flagsForTier,
} from '@lasyncro/commercial-policy';
import type { CapabilityId } from '@lasyncro/commercial-policy';
import type { UpgradePromptProps } from 'components/UpgradePrompt';

const mockNavigate = jest.fn();
const mockPrompt = jest.fn();
let mockGroups: unknown[] = [];
const mockDecide = (capabilityId: CapabilityId) => evaluateAccess(
  CAPABILITY_REQUIREMENTS[capabilityId],
  { tier: 'core', modules: new Set(modulesForTier('core')), flags: new Set(flagsForTier('core')) },
);
const mockSourcingDecision = mockDecide('purchasing.sourcing');
const mockAnalyticsDecision = mockDecide('warehouse.analytics');

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock('hooks/useAppTheme', () => ({ useAppTheme: () => ({}) }));
jest.mock('hooks/usePlanEntitlement', () => ({
  usePlanEntitlement: () => ({ tier: 'core', can: () => true }),
}));
jest.mock('runtime/commercialContext', () => ({
  useCommercialAccess: () => ({ isResolved: true, decide: mockDecide }),
}));
jest.mock('runtime/useResolvedNavigation', () => ({
  useResolvedNavigation: () => ({ groups: mockGroups }),
}));
jest.mock('runtime/useModuleHealth', () => ({ useModuleHealth: () => new Map() }));
jest.mock('pages/alerts/useAlerts', () => ({ useAlerts: () => ({}) }));
jest.mock('contexts/AuthContext', () => ({ useAuth: () => ({ user: null, logout: jest.fn() }) }));
jest.mock('api/axiosConfig', () => ({ axiosInstance: { post: jest.fn() } }));
jest.mock('ui-component/third-party/SimpleBar', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: (props: UpgradePromptProps) => {
    mockPrompt(props);
    return props.open ? <div data-testid="upgrade-prompt" /> : null;
  },
}));

import { ModuleTabBar } from 'components/ModuleTabBar';
import SidenavContent from '../../../../apps/frontend/src/layouts/AppLayout/SidenavContent';
import { PURCHASING_SUB_TABS } from 'pages/ft2-pages/purchasingSubTabs';

function latestPrompt(): UpgradePromptProps {
  return mockPrompt.mock.calls[mockPrompt.mock.calls.length - 1][0];
}

function renderSidenav() {
  return render(
    <MemoryRouter initialEntries={['/suppliers-portal']}>
      <SidenavContent brandName="laSyncro" routes={[]} sidenavState="EXPANDED" isConnected isFt2Ready={false} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockPrompt.mockReset();
  mockGroups = [{
    id: 'operations', label: 'Operations', items: [{
      id: 'purchasing', title: 'Purchasing', path: '/suppliers-portal', disabled: false,
      children: [{
        id: 'sourcing', title: 'Sourcing', path: '/suppliers-portal/sourcing',
        capabilityId: 'purchasing.sourcing', disabled: true,
        decision: mockSourcingDecision,
      }, {
        id: 'analytics', title: 'Warehouse analytics', path: '/wms/analytics',
        capabilityId: 'warehouse.analytics', disabled: true,
        decision: mockAnalyticsDecision,
      }],
    }],
  }];
});

it('locked Sourcing Sidenav matches the tab presentation and preserves the canonical decision without navigation', () => {
  const tab = render(
    <MemoryRouter initialEntries={['/suppliers-portal']}>
      <ModuleTabBar tabs={PURCHASING_SUB_TABS} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('Sourcing'));
  const tabPrompt = latestPrompt();
  tab.unmount();

  renderSidenav();
  fireEvent.click(screen.getByText('Sourcing'));
  const sidenavPrompt = latestPrompt();

  expect(mockNavigate).not.toHaveBeenCalled();
  expect(sidenavPrompt.open).toBe(true);
  expect(sidenavPrompt.mode).toBe('modal');
  expect(sidenavPrompt.decision).toBe(mockSourcingDecision);
  expect(sidenavPrompt.decision).toEqual(tabPrompt.decision);
  expect(sidenavPrompt.requiredTier).toBeUndefined();
  expect(sidenavPrompt.featureName).toBe('Sourcing');
  expect(sidenavPrompt.benefits).toEqual([
    'Prioritize sourcing work from current inventory demand',
    'Compare supplier recommendations by product',
    'Use supplier-product preferences',
    'Accumulate reorder quantities against MOQ',
  ]);
  expect(sidenavPrompt.benefits).toEqual(tabPrompt.benefits);
});

it('a capability without presentation metadata retains its generic prompt after Sourcing', () => {
  renderSidenav();
  fireEvent.click(screen.getByText('Sourcing'));
  fireEvent.click(screen.getByText('Warehouse analytics'));
  const prompt = latestPrompt();

  expect(prompt.featureName).toBe('Warehouse analytics');
  expect(prompt.benefits).toBeUndefined();
  expect(prompt.decision).toBe(mockAnalyticsDecision);
  expect(prompt.requiredTier).toBeUndefined();
  expect(mockNavigate).not.toHaveBeenCalled();
});
