// tests/unit/ui/overview/OverviewModuleFT2.action-ownership.test.tsx
//
// UX-OWNERSHIP-01 — RED CONTRACT.
//
// Ratified UX ownership: Ops Console is the cross-domain ACTION owner.
// Overview becomes STATUS / situational awareness only.
//   - triage signals (fallback triage layout AND the map-layout merged rail)
//     must render as information, not per-signal remediation CTAs;
//   - Business Pulse is a METRIC card, never a remediation CTA;
//   - the module owns exactly one navigation/action affordance:
//     "Open Ops Console", once onOpenOpsConsole is supplied.
//
// These contracts are RED against the current production component, which
// still renders a per-signal CTA (TriageRow), a clickable merged-rail
// decision row, and a Business Pulse "View order flow" footer CTA — and does
// not yet accept/expose onOpenOpsConsole at all.
//
// Imports the module directly from source (as OverviewModuleFT2.test.tsx
// already does) rather than through the @lasyncro/overview package alias, to
// avoid unrelated shared-ui ESM resolution debt.

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import OverviewModuleFT2, {
  type OverviewModuleFT2Props,
} from '../../../../modules/overview/src/ui/pages/OverviewModuleFT2';

const ADDRESS_DEEP_LINK = '/overview?resolution=address';
const REORDER_DEEP_LINK = '/demand?filter=critical';

function baseProps(overrides: Partial<OverviewModuleFT2Props> = {}): OverviewModuleFT2Props {
  return {
    trust: null,
    context: { ordersObserved: 10, productsObserved: 5, customersObserved: 3 },
    snapshot: { orders: null, products: null, customers: null },
    alignment: null,
    operationalWarningState: 'warning',
    pulse: {
      revenueToday: 1000,
      revenueDeltaVsYesterday: 0,
      atRiskRevenue: 200,
      blockedRevenue: 100,
      topBlockingType: null,
    },
    morningBrief: {
      signals: [
        {
          id: 'address',
          priority: 1,
          title: '2 orders with address issues',
          detail: 'Address problems are blocking fulfillment.',
          module: 'overview',
          deepLink: ADDRESS_DEEP_LINK,
          revenueImpact: 900,
          alertType: 'customer',
          ageLabel: '14d oldest',
          actionLabel: 'Fix addresses',
        },
        {
          id: 'reorder',
          priority: 3,
          title: '3 SKUs below reorder point',
          detail: 'Demand is outpacing stock.',
          module: 'demand',
          deepLink: REORDER_DEEP_LINK,
          revenueImpact: 300,
          alertType: 'revenue_at_risk',
          ageLabel: '6 orders',
          actionLabel: 'Reorder now',
        },
      ],
      hasUrgentIssues: true,
      generatedAt: '2026-09-10T00:00:00.000Z',
      trustWarning: false,
      greeting: null,
      summaryLine: null,
    },
    ...overrides,
  };
}

// ─── 1 — TRIAGE SIGNALS ARE INFORMATIONAL ───────────────────────────────────

describe('UX-OWNERSHIP-01 (1): triage signals are informational, not actionable', () => {
  it('fallback triage layout still shows title/detail/severity/revenue/age but no per-signal CTA or navigation', () => {
    const onNavigate = jest.fn();
    render(<OverviewModuleFT2 {...baseProps()} onNavigate={onNavigate} />);

    // Informational content still renders.
    expect(screen.getByText('2 orders with address issues')).toBeInTheDocument();
    expect(screen.getByText(/Address problems are blocking fulfillment\./)).toBeInTheDocument();
    expect(screen.getByText('3 SKUs below reorder point')).toBeInTheDocument();
    expect(screen.getByText('14d oldest')).toBeInTheDocument();
    expect(screen.getByText('6 orders')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Watch')).toBeInTheDocument();

    // Remediation CTAs must not render as controls.
    expect(screen.queryByRole('button', { name: 'Fix addresses' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reorder now' })).not.toBeInTheDocument();

    expect(onNavigate).not.toHaveBeenCalledWith(ADDRESS_DEEP_LINK);
    expect(onNavigate).not.toHaveBeenCalledWith(REORDER_DEEP_LINK);
  });

  it('map-layout merged rail still shows the same signal information without invoking navigation on read/click', () => {
    const onNavigate = jest.fn();
    render(
      <OverviewModuleFT2
        {...baseProps()}
        onNavigate={onNavigate}
        mapContent={<div data-testid="map-slot" />}
      />
    );

    expect(screen.getByTestId('map-slot')).toBeInTheDocument();
    expect(screen.getByText('2 orders with address issues')).toBeInTheDocument();
    expect(screen.getByText('3 SKUs below reorder point')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Fix addresses' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reorder now' })).not.toBeInTheDocument();

    // Reading/clicking the decision row must not fire remediation navigation.
    fireEvent.click(screen.getByText('2 orders with address issues'));
    fireEvent.click(screen.getByText('3 SKUs below reorder point'));

    expect(onNavigate).not.toHaveBeenCalledWith(ADDRESS_DEEP_LINK);
    expect(onNavigate).not.toHaveBeenCalledWith(REORDER_DEEP_LINK);
  });
});

// ─── 2 — FALLBACK TRIAGE IS ALSO NON-ACTIONABLE ─────────────────────────────

describe('UX-OWNERSHIP-01 (2): fallback triage (no mapContent) is non-actionable', () => {
  it('renders signal information but no per-signal CTA and fires no signal.deepLink navigation', () => {
    const onNavigate = jest.fn();
    render(<OverviewModuleFT2 {...baseProps()} onNavigate={onNavigate} />);

    // Signal information may still render for now (copy normalization is UX-COPY-01).
    expect(screen.getByText('2 orders with address issues')).toBeInTheDocument();
    expect(screen.getByText('3 SKUs below reorder point')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Fix addresses' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reorder now' })).not.toBeInTheDocument();

    expect(onNavigate).not.toHaveBeenCalledWith(ADDRESS_DEEP_LINK);
    expect(onNavigate).not.toHaveBeenCalledWith(REORDER_DEEP_LINK);
  });
});

// ─── 3 — BUSINESS PULSE HAS NO CTA ───────────────────────────────────────────

describe('UX-OWNERSHIP-01 (3): Business Pulse is metric-only', () => {
  it('fallback Business Pulse renders metrics but no "View order flow" footer CTA', () => {
    const onNavigate = jest.fn();
    render(<OverviewModuleFT2 {...baseProps()} onNavigate={onNavigate} />);

    expect(screen.getByText('Business pulse')).toBeInTheDocument();
    expect(screen.getByText('Revenue today')).toBeInTheDocument();

    expect(screen.queryByText(/View order flow/)).not.toBeInTheDocument();

    const footerCta = screen.queryByRole('button', { name: /View order flow/ });
    expect(footerCta).not.toBeInTheDocument();
    if (footerCta) fireEvent.click(footerCta);
    expect(onNavigate).not.toHaveBeenCalledWith('/orders/flow');
  });

  it('map-layout merged pulse card renders metrics but no "View order flow" footer CTA', () => {
    const onNavigate = jest.fn();
    render(
      <OverviewModuleFT2
        {...baseProps()}
        onNavigate={onNavigate}
        mapContent={<div data-testid="map-slot" />}
      />
    );

    expect(screen.getByText('Business pulse')).toBeInTheDocument();
    expect(screen.queryByText(/View order flow/)).not.toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalledWith('/orders/flow');
  });
});

// ─── 4 — EXACTLY ONE OPS CONSOLE CTA ─────────────────────────────────────────

describe('UX-OWNERSHIP-01 (4): exactly one "Open Ops Console" action owner affordance', () => {
  it('fallback layout renders exactly one Open Ops Console control that invokes the callback once', () => {
    const onOpenOpsConsole = jest.fn();
    render(
      <OverviewModuleFT2 {...baseProps()} onOpenOpsConsole={onOpenOpsConsole} />
    );

    const ctas = screen.queryAllByText('Open Ops Console');
    expect(ctas).toHaveLength(1);

    fireEvent.click(ctas[0]);
    expect(onOpenOpsConsole).toHaveBeenCalledTimes(1);
  });

  it('map layout renders exactly one Open Ops Console control, not duplicated between decision list and Business Pulse', () => {
    const onOpenOpsConsole = jest.fn();
    render(
      <OverviewModuleFT2
        {...baseProps()}
        onOpenOpsConsole={onOpenOpsConsole}
        mapContent={<div data-testid="map-slot" />}
      />
    );

    const ctas = screen.queryAllByText('Open Ops Console');
    expect(ctas).toHaveLength(1);

    fireEvent.click(ctas[0]);
    expect(onOpenOpsConsole).toHaveBeenCalledTimes(1);
  });

  it('does not render one Open Ops Console CTA per signal', () => {
    const onOpenOpsConsole = jest.fn();
    render(
      <OverviewModuleFT2 {...baseProps()} onOpenOpsConsole={onOpenOpsConsole} />
    );

    // Two signals are rendered above; the CTA count must stay at one, not two.
    expect(screen.queryAllByText('Open Ops Console')).toHaveLength(1);
  });
});

// ─── 7 — SIGNAL UI NO LONGER OWNS REMEDIATION ROUTES ────────────────────────

describe('UX-OWNERSHIP-01 (7): Overview module no longer invokes remediation routes through signal UI', () => {
  const FORBIDDEN_ROUTES = [
    '/overview?resolution=address',
    '/orders/flow?urgency=sla_breach',
    '/demand?filter=critical',
  ];

  it('clicking the actual Fix addresses remediation control must not call onNavigate with its deep link', () => {
    // UX-OWNERSHIP-01 fix: the original version of this test clicked the
    // signal TITLE text, which never owned navigation (only the CTA button
    // did) — that made the test vacuously pass without ever exercising the
    // real remediation control. This corrects it to click the actual button.
    const onNavigate = jest.fn();
    const signals = [
      {
        id: 'address',
        priority: 1 as const,
        title: 'Address issues',
        detail: 'Detail',
        module: 'overview',
        deepLink: '/overview?resolution=address',
        revenueImpact: 100,
        actionLabel: 'Fix addresses',
      },
      {
        id: 'sla',
        priority: 1 as const,
        title: 'SLA breaches',
        detail: 'Detail',
        module: 'order-nexus',
        deepLink: '/orders/flow?urgency=sla_breach',
        revenueImpact: 200,
        actionLabel: 'Fulfil orders',
      },
      {
        id: 'demand',
        priority: 2 as const,
        title: 'Reorder needed',
        detail: 'Detail',
        module: 'demand',
        deepLink: '/demand?filter=critical',
        revenueImpact: 300,
        actionLabel: 'Reorder now',
      },
    ];

    render(
      <OverviewModuleFT2
        {...baseProps({
          morningBrief: {
            signals,
            hasUrgentIssues: true,
            generatedAt: '2026-09-10T00:00:00.000Z',
            trustWarning: false,
            greeting: null,
            summaryLine: null,
          },
        })}
        onNavigate={onNavigate}
      />
    );

    // GREEN: the remediation control itself no longer renders — Overview owns
    // no per-signal CTA at all, so there is nothing to click that could still
    // reach a forbidden route.
    expect(screen.queryByRole('button', { name: 'Fix addresses' })).not.toBeInTheDocument();

    for (const route of FORBIDDEN_ROUTES) {
      expect(onNavigate).not.toHaveBeenCalledWith(route);
    }
  });
});
