// SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02, Slice 3.
//
// Renders the REAL AhaMomentPage (no stand-in), mocking only the
// network/API boundaries (api/axiosConfig, api/lifecycle), matching the
// existing AuthRegister.test.tsx / *.dateRange.wiring.test.tsx
// conventions in this suite. No router is provided — AhaMomentPage has
// no react-router-dom dependency; if a future change introduced one
// (e.g. useNavigate), render or click would throw here rather than
// silently pass, which is exactly the proof UI-5 needs.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';
import AhaMomentPage from 'pages/ft1-pages/AhaMomentPage';
import { axiosInstance } from 'api/axiosConfig';
import { getFt2Readiness, confirmFt2 } from 'api/lifecycle';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn() },
}));

jest.mock('api/lifecycle', () => ({
  getFt2Readiness: jest.fn(),
  confirmFt2: jest.fn(),
}));

const mockedGet = axiosInstance.get as jest.Mock;
const mockedGetFt2Readiness = getFt2Readiness as jest.Mock;
const mockedConfirmFt2 = confirmFt2 as jest.Mock;

const zeroOrderSignal = {
  priority: 0,
  headline: "You're connected — no orders yet.",
  detail:
    "Your Shopify sync finished successfully. You can set up your warehouse now — insights will start populating when your first orders arrive.",
  revenueImpact: null,
  cards: [
    { label: 'Sync status', value: 'Complete', sublabel: 'Shopify connection ready' },
    { label: 'Products synced', value: '0', sublabel: 'from your catalogue' },
    { label: 'Orders synced', value: '0', sublabel: 'no orders yet' },
  ],
  deepLink: '/overview',
  ctaLabel: 'Unlock Insights',
};

function mockSignalResponse(signal: any) {
  mockedGet.mockResolvedValue({ data: { signal, evaluatedAt: new Date().toISOString() } });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AhaMomentPage — priority 0 (zero-order)', () => {
  it('UI-1: renders the locked zero-order copy and never the generic priority-6/eyebrow copy', async () => {
    mockSignalResponse(zeroOrderSignal);
    renderWithTheme(<AhaMomentPage />);

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText("You're connected")).toBeInTheDocument();
    expect(screen.getByText("You're connected — no orders yet.")).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your Shopify sync finished successfully. You can set up your warehouse now — insights will start populating when your first orders arrive.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Sync status')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Products synced')).toBeInTheDocument();
    expect(screen.getByText('Orders synced')).toBeInTheDocument();
    expect(
      screen.getByText('Set up your warehouse — insights arrive with your first order.')
    ).toBeInTheDocument();

    expect(screen.queryByText('LaSyncro found this in your store')).not.toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryByText(/operation looks healthy/i)).not.toBeInTheDocument();
  });

  it('UI-3: clicking Unlock Insights calls getFt2Readiness then confirmFt2, each exactly once', async () => {
    mockSignalResponse(zeroOrderSignal);
    mockedGetFt2Readiness.mockResolvedValue({ ready: true });
    mockedConfirmFt2.mockResolvedValue(undefined);

    renderWithTheme(<AhaMomentPage />);
    const button = await screen.findByRole('button', { name: /unlock insights/i });
    fireEvent.click(button);

    await waitFor(() => expect(mockedConfirmFt2).toHaveBeenCalledTimes(1));
    expect(mockedGetFt2Readiness).toHaveBeenCalledTimes(1);

    const readinessOrder = mockedGetFt2Readiness.mock.invocationCallOrder[0];
    const confirmOrder = mockedConfirmFt2.mock.invocationCallOrder[0];
    expect(readinessOrder).toBeLessThan(confirmOrder);
  });

  it('UI-4: readiness not ready — confirmFt2 is never called', async () => {
    mockSignalResponse(zeroOrderSignal);
    mockedGetFt2Readiness.mockResolvedValue({ ready: false });

    renderWithTheme(<AhaMomentPage />);
    const button = await screen.findByRole('button', { name: /unlock insights/i });
    fireEvent.click(button);

    await waitFor(() => expect(mockedGetFt2Readiness).toHaveBeenCalledTimes(1));
    expect(mockedConfirmFt2).not.toHaveBeenCalled();
  });

  it('UI-5: no navigation is attempted regardless of signal.deepLink — readiness/confirm behavior unchanged', async () => {
    mockSignalResponse({
      ...zeroOrderSignal,
      deepLink: '/floor-planning?tab=setup&view=canvas',
      ctaLabel: 'Go set up bins',
    });
    mockedGetFt2Readiness.mockResolvedValue({ ready: true });
    mockedConfirmFt2.mockResolvedValue(undefined);

    // No MemoryRouter provided at all — if AhaMomentPage ever called
    // useNavigate() this render/click would throw ("useNavigate() may be
    // used only in the context of a <Router> component"), not silently
    // pass.
    renderWithTheme(<AhaMomentPage />);
    const button = await screen.findByRole('button', { name: /unlock insights/i });
    // Label is still the locked "Unlock Insights", never signal.ctaLabel.
    expect(button).toHaveTextContent('Unlock Insights');

    expect(() => fireEvent.click(button)).not.toThrow();
    await waitFor(() => expect(mockedConfirmFt2).toHaveBeenCalledTimes(1));
  });

  it('UI-6a: loading state renders while the signal fetch is pending', async () => {
    let resolveFetch: (v: any) => void = () => {};
    mockedGet.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    render(<AhaMomentPage />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    resolveFetch({ data: { signal: zeroOrderSignal, evaluatedAt: new Date().toISOString() } });
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });

  it('UI-6b: error state renders when the signal fetch rejects', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));
    render(<AhaMomentPage />);

    expect(await screen.findByText('Could not load your signal. Please refresh.')).toBeInTheDocument();
  });
});

describe('AhaMomentPage — priorities 1/2/3/4/6 regression', () => {
  const basePopulatedSignal = {
    detail: 'Some detail.',
    revenueImpact: 100,
    cards: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }, { label: 'C', value: '3' }],
    deepLink: '/overview',
    ctaLabel: 'Unlock Insights',
  };

  const cases: Array<{ priority: 1 | 2 | 3 | 4 | 6; label: string; headline: string }> = [
    { priority: 1, label: 'Needs attention', headline: '3 SKUs will stock out within 7 days' },
    { priority: 2, label: 'Urgent', headline: '2 orders are arriving late' },
    { priority: 3, label: 'Strategic', headline: 'Revenue concentration risk' },
    { priority: 4, label: 'Operational', headline: '5 orders have been waiting over 72 hours' },
    { priority: 6, label: 'Healthy', headline: 'Your operation looks healthy' },
  ];

  it.each(cases)('priority $priority renders existing visual label and eyebrow unchanged', async ({ priority, label, headline }) => {
    mockSignalResponse({ ...basePopulatedSignal, priority, headline });
    renderWithTheme(<AhaMomentPage />);

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByText(headline)).toBeInTheDocument();
    expect(screen.getByText('LaSyncro found this in your store')).toBeInTheDocument();
    expect(screen.queryByText("You're connected")).not.toBeInTheDocument();
  });
});
