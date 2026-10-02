// WAREHOUSE-FOCUS-SHELL-01B
//
// WmsFT2Page renders the module tab bar (Operations | Floor Planning |
// Analytics | Problem Center) above the routed Stow/Receive content. The
// same URL-backed warehouseFocus truth AppLayout reads for topnav/sidenav
// (WAREHOUSE-FOCUS-SHELL-01A) now also gates this module-level navigation:
// hidden only during active execution, visible on Brief and once focus is
// removed. AppLayout itself is untouched by this slice — this suite exercises
// WmsFT2Page in isolation.
//
// CommercialGate, ModuleTabBar, and the lazy-loaded WmsOperationsPage/
// WmsAnalyticsPage are stubbed so the only variable under test is
// WmsFT2Page's own tab-bar gating logic — same isolation precedent as
// tests/unit/ui/layouts/AppLayout.warehouseFocus.test.tsx.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WmsFT2Page from '../../../../apps/frontend/src/pages/ft2-pages/WmsFT2Page';

jest.mock('../../../../apps/frontend/src/components/CommercialGate', () => ({
  CommercialGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../../../../apps/frontend/src/components/ModuleTabBar', () => ({
  ModuleTabBar: () => <div data-testid="module-tab-bar-stub" />,
}));

jest.mock('../../../../apps/frontend/src/pages/ft2-pages/WmsOperationsPage', () => ({
  __esModule: true,
  default: () => <div data-testid="wms-operations-content-stub" />,
}));

jest.mock('../../../../apps/frontend/src/pages/ft2-pages/WmsAnalyticsPage', () => ({
  __esModule: true,
  default: () => <div data-testid="wms-analytics-content-stub" />,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <WmsFT2Page />
    </MemoryRouter>
  );
}

describe('WAREHOUSE-FOCUS-SHELL-01B — WmsFT2Page module tab bar execution focus', () => {
  it('Stow Brief (stowTaskId only, no warehouseFocus): module tabs visible', async () => {
    renderAt('/?stowTaskId=task-a');

    expect(screen.getByTestId('module-tab-bar-stub')).toBeInTheDocument();
    expect(await screen.findByTestId('wms-operations-content-stub')).toBeInTheDocument();
  });

  it('Active Stow (warehouseFocus=stow + stowTaskId): module tabs absent, execution content preserved', async () => {
    renderAt('/?stowTaskId=task-a&stowStep=location&warehouseFocus=stow');

    expect(screen.queryByTestId('module-tab-bar-stub')).not.toBeInTheDocument();
    expect(await screen.findByTestId('wms-operations-content-stub')).toBeInTheDocument();
  });

  it('Receive Brief (receiveJobId only, no warehouseFocus): module tabs visible', async () => {
    renderAt('/?receiveJobId=job-a');

    expect(screen.getByTestId('module-tab-bar-stub')).toBeInTheDocument();
    expect(await screen.findByTestId('wms-operations-content-stub')).toBeInTheDocument();
  });

  it('Active Receive (warehouseFocus=receive + receiveJobId): module tabs absent, execution content preserved', async () => {
    renderAt('/?receiveJobId=job-a&warehouseFocus=receive');

    expect(screen.queryByTestId('module-tab-bar-stub')).not.toBeInTheDocument();
    expect(await screen.findByTestId('wms-operations-content-stub')).toBeInTheDocument();
  });

  it('removing warehouseFocus (session exit) restores the module tab bar', async () => {
    // Two independent mounts, one per URL — react-router's MemoryRouter only
    // honors initialEntries at mount, so this proves the same WmsFT2Page
    // gating logic responds correctly to "no warehouseFocus" the same way
    // exit's setSearchParams({}, { replace: true }) would leave the URL,
    // without depending on rerender semantics.
    const before = render(
      <MemoryRouter initialEntries={['/?stowTaskId=task-a&warehouseFocus=stow']}>
        <WmsFT2Page />
      </MemoryRouter>
    );
    expect(within(before.container).queryByTestId('module-tab-bar-stub')).not.toBeInTheDocument();
    before.unmount();

    const after = render(
      <MemoryRouter initialEntries={['/']}>
        <WmsFT2Page />
      </MemoryRouter>
    );
    expect(await within(after.container).findByTestId('module-tab-bar-stub')).toBeInTheDocument();
  });

  it('warehouseFocus=stow with no stowTaskId (stale/edited URL) does not hide tabs', () => {
    renderAt('/?warehouseFocus=stow');

    expect(screen.getByTestId('module-tab-bar-stub')).toBeInTheDocument();
  });

  it('warehouseFocus=stow with a mismatched receiveJobId does not hide tabs', () => {
    renderAt('/?receiveJobId=job-a&warehouseFocus=stow');

    expect(screen.getByTestId('module-tab-bar-stub')).toBeInTheDocument();
  });

  it('unfocused count URL (countTaskId only, no warehouseFocus — e.g. after fail-open): module tabs visible', async () => {
    renderAt('/?countTaskId=count-a');

    expect(screen.getByTestId('module-tab-bar-stub')).toBeInTheDocument();
    expect(await screen.findByTestId('wms-operations-content-stub')).toBeInTheDocument();
  });

  it('Active Count (warehouseFocus=count + countTaskId): module tabs absent, execution content preserved', async () => {
    renderAt('/?countTaskId=count-a&warehouseFocus=count');

    expect(screen.queryByTestId('module-tab-bar-stub')).not.toBeInTheDocument();
    expect(await screen.findByTestId('wms-operations-content-stub')).toBeInTheDocument();
  });

  it('warehouseFocus=count with no countTaskId does not hide tabs', () => {
    renderAt('/?warehouseFocus=count');

    expect(screen.getByTestId('module-tab-bar-stub')).toBeInTheDocument();
  });

});

// WAREHOUSE-SESSION-FOCUS-02A — Pick is execution-focused from the Pick Brief
// onward (canonical /wms?batchId=<id>&warehouseFocus=pick). The module tab bar
// is hidden for a focused Pick exactly as for Stow/Receive/Count; a stale
// warehouseFocus=pick without batchId must not hide it.
describe('WAREHOUSE-SESSION-FOCUS-02A — WmsFT2Page module tab bar for focused Pick', () => {
  it('focused Pick (warehouseFocus=pick + batchId): module tabs absent, execution content preserved', async () => {
    renderAt('/?batchId=batch-a&warehouseFocus=pick');

    expect(screen.queryByTestId('module-tab-bar-stub')).not.toBeInTheDocument();
    expect(await screen.findByTestId('wms-operations-content-stub')).toBeInTheDocument();
  });

  it('warehouseFocus=pick with no batchId (stale/edited URL) does not hide tabs', () => {
    renderAt('/?warehouseFocus=pick');

    expect(screen.getByTestId('module-tab-bar-stub')).toBeInTheDocument();
  });
});
