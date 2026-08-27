// RECOUNT-FRESH-NOBINS-40
//
// Renders the extracted RecountEmptyState component directly — not
// WmsModuleFT2. WmsModuleFT2 has a 30+ prop surface unrelated to this
// issue (see RecountReassignAffordance.test.tsx / WmsCtaTierConsistency
// .test.tsx for the precedent on why that component is never fully
// rendered in this test suite); this component was extracted specifically
// so its DOM contract can be proven with real render/click assertions
// instead of a source-scoped regex check.
//
// FRESH-02 (root-only -> no_bins_configured) is proven at the
// classification-helper level only, in
// tests/unit/frontend/wms-recount-bin-canvas.test.ts — root-only and
// true-zero-bin render identically here (both are `no_bins_configured`),
// so a second, duplicate DOM render adds no coverage.
import { fireEvent, render, screen } from '@testing-library/react';
import { RecountEmptyState } from '../../../../modules/wms/src/ui/components/RecountEmptyState';

describe('RecountEmptyState — FRESH-01 no_bins_configured', () => {
  test('shows setup-oriented onboarding copy, supporting explanation, and a Tier-1 Set up bins CTA', () => {
    const onSetupBinsClick = jest.fn();
    render(
      <RecountEmptyState
        availability="no_bins_configured"
        onSetupBinsClick={onSetupBinsClick}
      />
    );

    expect(
      screen.getByText(
        'Set up your warehouse bins before creating an inventory count.'
      )
    ).toBeInTheDocument();

    expect(
      screen.getByText(/physical storage locations/i)
    ).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: 'Set up bins' });
    expect(cta).toBeInTheDocument();

    // Canonical WMS Tier-1 treatment (WMS_TIER1_ACTION_SX) — same
    // var(--accent)/var(--accent-ink) token pair CountingSessionPage.tsx's
    // other Tier-1 actions already use, not a one-off color.
    expect(cta).toHaveStyle('background-color: var(--accent)');
    expect(cta).toHaveStyle('color: var(--accent-ink)');

    expect(
      screen.queryByText('No bins currently need reconciliation.')
    ).not.toBeInTheDocument();
  });

  test('clicking Set up bins invokes the callback exactly once', () => {
    const onSetupBinsClick = jest.fn();
    render(
      <RecountEmptyState
        availability="no_bins_configured"
        onSetupBinsClick={onSetupBinsClick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set up bins' }));

    expect(onSetupBinsClick).toHaveBeenCalledTimes(1);
  });
});

describe('RecountEmptyState — FRESH-03 no_suggestions', () => {
  test('shows neutral healthy-state copy and hides the setup path entirely', () => {
    render(
      <RecountEmptyState
        availability="no_suggestions"
        onSetupBinsClick={jest.fn()}
      />
    );

    expect(
      screen.getByText('No bins currently need reconciliation.')
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: 'Set up bins' })
    ).not.toBeInTheDocument();

    expect(
      screen.queryByText(
        'Set up your warehouse bins before creating an inventory count.'
      )
    ).not.toBeInTheDocument();
  });
});

describe('RecountEmptyState — FRESH-04 suggestions_available', () => {
  test('renders nothing — the canvas/fallback suggestion UI owns this state instead', () => {
    const { container } = render(
      <RecountEmptyState
        availability="suggestions_available"
        onSetupBinsClick={jest.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('RecountEmptyState — unknown grid state (grid not yet resolved)', () => {
  test('renders neither the onboarding nor the healthy-state copy until bin configuration is known', () => {
    const { container } = render(
      <RecountEmptyState availability="unknown" onSetupBinsClick={jest.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByText(
        'Set up your warehouse bins before creating an inventory count.'
      )
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('No bins currently need reconciliation.')
    ).not.toBeInTheDocument();
  });
});
