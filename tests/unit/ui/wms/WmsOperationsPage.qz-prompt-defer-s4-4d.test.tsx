// S4-4D F3 — the QZ Tray onboarding prompt is a fixed overlay. During an
// active Receive session (?receiveJobId present until explicit exit) it must
// not render over label acknowledgement, scanning, custody or Close; the
// browser print fallback still runs, and the optional onboarding appears once
// the operator leaves Receive.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { axiosInstance } from 'api/axiosConfig';
import { printViaQz } from 'utils/qzPrint';

function alertsQueryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['alerts', { status: 'inbox' }], { data: [], meta: { total: 0, status: 'inbox' } });
  return function AlertsQueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));

jest.mock('utils/qzPrint', () => ({
  printViaQz: jest.fn(),
}));

jest.mock('utils/qzPrompt', () => ({
  hasQzPromptBeenDismissed: () => false,
  dismissQzPrompt: jest.fn(),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, role: 'operator' } }),
}));

jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: () => null,
}));

// One stable hook value across renders, as the canonical page harnesses use.
const mockWmsValue = {
  data: { batches: [] },
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  stowTasks: [],
  settings: null,
  openReceiveJobs: [],
  recountTasks: [],
  recountLocked: false,
};
jest.mock('pages/wms/useWms', () => ({
  useWms: () => mockWmsValue,
}));

jest.mock('pages/wms/useReadyToPack', () => ({
  useReadyToPack: () => ({ data: { orders: [], orderCount: 0 } }),
}));

jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGrid: () => ({ data: { locations: [] } }),
}));

jest.mock('hooks/useSpotlight', () => ({
  useSpotlight: () => ({ isDismissed: false, isLoading: false, dismiss: jest.fn() }),
}));

jest.mock('@lasyncro/wms', () => {
  function WmsModuleFT2Stub(props: {
    onPrintUnitLabels: (lineId: string) => Promise<void>;
    onSessionExit: () => void;
  }) {
    return (
      <>
        <button type="button" onClick={() => void props.onPrintUnitLabels('line-qz')}>stub print labels</button>
        <button type="button" onClick={() => props.onSessionExit()}>stub exit receive</button>
      </>
    );
  }
  return {
    WmsModuleFT2: WmsModuleFT2Stub,
    useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
    useWebPush: jest.fn(),
    WmsConnectionBadge: () => null,
  };
});

const PROMPT = /want labels to print automatically/i;

describe('S4-4D F3 — QZ Tray onboarding never obstructs an active Receive', () => {
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    (axiosInstance.get as jest.Mock).mockImplementation(async (url: string) => {
      if (url.endsWith('/unit-labels')) return { data: 'pdf' };
      return { data: { job: { po_id: 'PO-QZ', supplier_name: 'QZ Supply', status: 'in_progress', assigned_operator_id: 3 }, lines: [] } };
    });
    (printViaQz as jest.Mock).mockResolvedValue({ status: 'fallback', reason: 'qz_unavailable' });
    openSpy = jest.spyOn(window, 'open').mockReturnValue(null);
    (URL as any).createObjectURL = jest.fn(() => 'blob:qz');
    (URL as any).revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('keeps the browser fallback but defers the prompt until the operator leaves Receive', async () => {
    render(
      <MemoryRouter initialEntries={['/wms?receiveJobId=job-qz']}>
        <Routes>
          <Route path="/wms" element={<WmsOperationsPage />} />
        </Routes>
      </MemoryRouter>, { wrapper: alertsQueryWrapper() });

    // The GH-1245 handoff hold resolves first; awaiting it inside an outer act()
    // would withhold that state update until act exits.
    const printButton = await screen.findByRole('button', { name: 'stub print labels' });
    await act(async () => {
      fireEvent.click(printButton);
    });

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('blob:qz', '_blank'));
    expect(screen.queryByText(PROMPT)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'stub exit receive' }));
    expect(await screen.findByText(PROMPT)).toBeInTheDocument();
  });

  it('still shows the optional prompt immediately outside an active Receive', async () => {
    render(
      <MemoryRouter initialEntries={['/wms']}>
        <Routes>
          <Route path="/wms" element={<WmsOperationsPage />} />
        </Routes>
      </MemoryRouter>, { wrapper: alertsQueryWrapper() });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'stub print labels' }));
    });

    expect(await screen.findByText(PROMPT)).toBeInTheDocument();
  });
});
