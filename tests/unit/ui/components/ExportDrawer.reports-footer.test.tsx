// tests/unit/ui/components/ExportDrawer.reports-footer.test.tsx
//
// CROSS-SCREEN-UX-01 — Export behavior unification.
//
// The shared ExportDrawer:
//   B. shows the full QUICK_REPORTS set when no reportIds are supplied
//      (Overview), and only the scoped set when they are (module pages);
//   C. carries one persistent footer handoff, "Go to Reports →", that
//      closes the drawer and navigates to /settings/reports — inherited by
//      every consumer.
//
// Commercial access is mocked at its public boundary (useCommercialAccess);
// entitlement/download authority is owned by export-commercial-access.test.tsx.

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: 'stub' }),
  },
}));

jest.mock('api/entitlementDenial', () => ({ isEntitlementDenial: () => false }));

jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
    context: { tier: 'growth', modules: new Set<string>(), flags: new Set<string>() },
    isResolved: true,
    decide: () => ({ allowed: true, reason: 'ALLOWED' }),
  }),
}));

import { ExportDrawer } from 'components/ExportDrawer';
import { QUICK_REPORTS } from '../../../../apps/frontend/src/config/exportReports';

function renderDrawer(props: { reportIds?: string[]; onClose?: () => void } = {}) {
  const onClose = props.onClose ?? jest.fn();
  render(
    <MemoryRouter initialEntries={['/overview']}>
      <Routes>
        <Route
          path="/overview"
          element={<ExportDrawer open onClose={onClose} reportIds={props.reportIds} />}
        />
        <Route path="/settings/reports" element={<div data-testid="reports-hub" />} />
      </Routes>
    </MemoryRouter>
  );
  return { onClose };
}

describe('CROSS-SCREEN-UX-01 (B): report scope', () => {
  it('without reportIds exposes every canonical QUICK_REPORTS entry', () => {
    renderDrawer();

    expect(QUICK_REPORTS.length).toBeGreaterThan(1);
    for (const report of QUICK_REPORTS) {
      expect(screen.getByText(report.title)).toBeInTheDocument();
    }
  });

  it('with reportIds exposes only the scoped reports', () => {
    renderDrawer({ reportIds: ['orders-all'] });

    for (const report of QUICK_REPORTS) {
      if (report.id === 'orders-all') expect(screen.getByText(report.title)).toBeInTheDocument();
      else expect(screen.queryByText(report.title)).toBeNull();
    }
  });
});

describe('CROSS-SCREEN-UX-01 (C): Reports hub footer', () => {
  it('"Go to Reports →" closes the drawer and navigates to /settings/reports', () => {
    const { onClose } = renderDrawer({ reportIds: ['products'] });

    fireEvent.click(screen.getByRole('button', { name: 'Go to Reports →' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('reports-hub')).toBeInTheDocument();
  });
});
