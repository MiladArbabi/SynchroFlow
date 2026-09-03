import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import SuppliersPortalModuleFT2, {
  type SourcingResult,
  type SourcingRecommendation,
} from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

/**
 * SOURCING-UX-COGNITIVE-01 Slice 1A — TARGETED RECOVERY MODE
 * ----------------------------------------------------------
 * Ratified merchant-facing contracts for the Sourcing surface when it is
 * entered with a variantId (a merchant recovering ONE blocked product), as
 * opposed to the generic portfolio view.
 *
 *   SRC-L3-02   identity block names what is being sourced
 *   SRC-L3-03   a missing image degrades to a stable placeholder
 *   SRC-L3-04   the five purchasing numbers are readable without arithmetic
 *   SRC-L3-10   blocking-order context is visible
 *   SRC-L3-11   the originating order is named as context
 *   SRC-L3-13   portfolio distractions are suppressed in targeted mode
 *   SRC-L3-14   identity → purchasing truth → supplier candidates, in that order
 *   SRC-L3-15   404 is a distinct state from "no supplier history"
 *   SRC-L3-15A  a non-404 failure is a distinct state from both
 *
 * These assert RENDERED BEHAVIOUR. The arithmetic itself is a backend contract
 * (tests/integration/suppliers/sourcing-targeted-contract.test.ts) and is
 * deliberately NOT recomputed here — the component is handed server numbers.
 */

jest.mock('@lasyncro/shared/ui', () => {
  const React = require('react');

  return {
    ModuleErrorBoundary: ({ children }: any) =>
      React.createElement(React.Fragment, {}, children),
    ModuleLoadingSkeleton: () => React.createElement('div', { 'data-testid': 'skeleton' }),
    SpotlightCoachMark: ({ title }: any) => React.createElement('div', {}, title),
    EntityDetailModal: () => null,
    PulseCard: ({ title }: any) =>
      React.createElement('section', { 'data-testid': 'pulse-card' }, title),
  };
});

const TARGET_VARIANT_ID = 'variant-targeted-1';
const ORIGINATING_ORDER_ID = 'order-blocking-1';
const SECOND_ORDER_ID = 'order-blocking-2';

function recommendation(
  overrides: Partial<SourcingRecommendation> = {}
): SourcingRecommendation {
  return {
    id: 1,
    name: 'Preferred Mills Ltd',
    contact_name: null,
    contact_email: null,
    on_time_rate: '96.00',
    fill_rate: '99.00',
    defect_rate: '0.50',
    avg_delivery_days: '4.00',
    moq: 100,
    lead_time_days: 14,
    score: 91,
    pooled_qty: 0,
    units_to_moq: 92,
    is_preferred: false,
    preference_tier: null,
    preference_priority: null,
    preference_scope: null,
    preference_note: null,
    ...overrides,
  };
}

/**
 * The targeted payload as the server returns it. Numbers are SERVER TRUTH:
 * available 2, open demand 10, inbound 7 → short now 8, still to source 1.
 */
function sourcingResult(overrides: Partial<SourcingResult> = {}): SourcingResult {
  return {
    recommendations: [recommendation()],
    image_url: 'https://cdn.test.invalid/targeted-shirt.png',
    product_title: 'Targeted Recovery Product',
    variant_title: 'Targeted Recovery Variant',
    sku: 'SRC-TGT-001',
    open_demand: 10,
    available: 2,
    committed_inbound: 7,
    short_now: 8,
    still_to_source: 1,
    blocking_orders: [
      { order_id: ORIGINATING_ORDER_ID, external_order_id: '800001', units: 6 },
      { order_id: SECOND_ORDER_ID, external_order_id: '800002', units: 4 },
    ],
    originating_order_id: ORIGINATING_ORDER_ID,
    shortfall: 8,
    shortfall_basis: { demand: 10, available: 2 },
    queue_qty: 8,
    quantity_basis: 'reactive',
    suggested_reorder_qty: null,
    planning_context: null,
    ...overrides,
  } as SourcingResult;
}

type FetchBehaviour =
  | { kind: 'resolve'; result: SourcingResult }
  | { kind: 'reject'; error: unknown };

function renderSourcing(
  behaviour: FetchBehaviour,
  options: { variantId?: string | null } = {}
) {
  const variantId =
    options.variantId === undefined ? TARGET_VARIANT_ID : options.variantId;

  const onFetchSourcingRecommendations = jest.fn(() =>
    behaviour.kind === 'resolve'
      ? Promise.resolve(behaviour.result)
      : Promise.reject(behaviour.error)
  );

  const search = variantId
    ? `?variantId=${encodeURIComponent(variantId)}`
    : '';

  const utils = render(
    <MemoryRouter initialEntries={[`/suppliers-portal/sourcing${search}`]}>
      <SuppliersPortalModuleFT2
        view="sourcing"
        data={{
          purchase_orders: [],
          suppliers: [],
          never_ordered: [
            {
              lasyncro_variant_id: 'variant-never-ordered',
              sku: 'NEVER-1',
              title: 'Never Ordered Variant',
              product_title: 'Never Ordered Product',
              product_id: 'product-never',
              product_type: 'physical',
              has_sku: true,
            },
          ],
          never_ordered_count: 1,
        }}
        isLoading={false}
        isError={false}
        onRefresh={jest.fn()}
        onFetchLineItems={jest.fn().mockResolvedValue([])}
        onUpdatePoStatus={jest.fn().mockResolvedValue(undefined)}
        onCreateSupplier={jest.fn()}
        onUpdateSupplier={jest.fn()}
        onDeleteSupplier={jest.fn().mockResolvedValue(undefined)}
        onCreatePo={jest.fn().mockResolvedValue(undefined)}
        onCreateReceiveJob={jest.fn()}
        onSearchVariants={jest.fn().mockResolvedValue([])}
        onFetchSourcingRecommendations={onFetchSourcingRecommendations}
        onFetchPreferences={jest.fn().mockResolvedValue([])}
        onCreatePreference={jest.fn()}
        onUpdatePreference={jest.fn()}
        onDeletePreference={jest.fn().mockResolvedValue(undefined)}
        onFetchReorderRequests={jest.fn().mockResolvedValue([])}
        onCreateReorderRequest={jest.fn()}
        onDeleteReorderRequest={jest.fn().mockResolvedValue(undefined)}
        onConvertReorderRequests={jest.fn()}
      />
    </MemoryRouter>
  );

  return { ...utils, onFetchSourcingRecommendations };
}

/** An axios-shaped rejection, which is how the page adapter surfaces failures. */
function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    status,
    response: { status },
  });
}

describe('SOURCING-UX-COGNITIVE-01 Slice 1A — targeted sourcing mode', () => {
  it('SRC-L3-02: names the target with image, product title, variant title and SKU', async () => {
    renderSourcing({ kind: 'resolve', result: sourcingResult() });

    const identity = await screen.findByTestId('sourcing-identity');

    expect(within(identity).getByText('Targeted Recovery Product')).toBeInTheDocument();
    expect(within(identity).getByText('Targeted Recovery Variant')).toBeInTheDocument();
    expect(within(identity).getByText('SRC-TGT-001')).toBeInTheDocument();

    const image = within(identity).getByRole('img');
    expect(image).toHaveAttribute(
      'src',
      'https://cdn.test.invalid/targeted-shirt.png'
    );
  });

  it('SRC-L3-03: a null image renders a stable placeholder, never a broken image', async () => {
    renderSourcing({
      kind: 'resolve',
      result: sourcingResult({ image_url: null }),
    });

    const identity = await screen.findByTestId('sourcing-identity');

    expect(screen.getByTestId('sourcing-identity-placeholder')).toBeInTheDocument();
    expect(within(identity).queryByRole('img')).not.toBeInTheDocument();
    // No <img> may be emitted with an empty/absent source.
    expect(
      identity.querySelectorAll('img:not([src]), img[src=""]').length
    ).toBe(0);
  });

  it('SRC-L3-04: shows available, open demand, inbound, short now and still to source', async () => {
    renderSourcing({ kind: 'resolve', result: sourcingResult() });

    const gap = await screen.findByTestId('sourcing-gap-summary');

    for (const label of [
      /available/i,
      /open demand/i,
      /inbound/i,
      /short now/i,
      /still to source/i,
    ]) {
      expect(within(gap).getByText(label)).toBeInTheDocument();
    }

    // The server's numbers, displayed — not recomputed by the component.
    for (const value of ['2', '10', '7', '8', '1']) {
      expect(within(gap).getAllByText(value).length).toBeGreaterThan(0);
    }
  });

  it('SRC-L3-10: surfaces how many orders are blocked by this variant', async () => {
    renderSourcing({ kind: 'resolve', result: sourcingResult() });

    await screen.findByTestId('sourcing-identity');

    expect(screen.getByText(/2\s+orders?\s+blocked/i)).toBeInTheDocument();
  });

  it('SRC-L3-11: names the originating order the merchant arrived from', async () => {
    renderSourcing({ kind: 'resolve', result: sourcingResult() });

    await screen.findByTestId('sourcing-identity');

    // The merchant must see WHICH order sent them here — by its merchant-facing
    // identifier, not the internal uuid.
    expect(screen.getByText(/800001/)).toBeInTheDocument();
  });

  it('SRC-L3-13: suppresses portfolio distractions while a target is active', async () => {
    renderSourcing({ kind: 'resolve', result: sourcingResult() });

    await screen.findByTestId('sourcing-identity');

    expect(screen.queryByText(/never ordered before/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('pulse-card')).not.toBeInTheDocument();
    expect(screen.queryByText(/supplier preferences/i)).not.toBeInTheDocument();

    // Suppression must not reach the candidates that answer the merchant's task.
    expect(screen.getByTestId('sourcing-supplier-candidates')).toBeInTheDocument();
    expect(screen.getByText('Preferred Mills Ltd')).toBeInTheDocument();
  });

  it('SRC-L3-14: renders identity, then purchasing truth, then supplier candidates', async () => {
    const { container } = renderSourcing({
      kind: 'resolve',
      result: sourcingResult(),
    });

    const identity = await screen.findByTestId('sourcing-identity');
    const gap = screen.getByTestId('sourcing-gap-summary');
    const candidates = screen.getByTestId('sourcing-supplier-candidates');

    const order = (node: Element) =>
      Array.from(container.querySelectorAll('*')).indexOf(node);

    expect(order(identity)).toBeLessThan(order(gap));
    expect(order(gap)).toBeLessThan(order(candidates));
  });

  it('SRC-L3-15: a 404 target renders not-found, never the no-history or load-error states', async () => {
    renderSourcing({ kind: 'reject', error: httpError(404) });

    await screen.findByTestId('sourcing-target-not-found');

    expect(
      screen.queryByText('No supplier history for this product yet.')
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('sourcing-target-load-error')).not.toBeInTheDocument();
  });

  it('SRC-L3-15: a valid target with zero recommendations still says no supplier history', async () => {
    renderSourcing({
      kind: 'resolve',
      result: sourcingResult({ recommendations: [] }),
    });

    await screen.findByTestId('sourcing-identity');

    await waitFor(() => {
      expect(
        screen.getByText('No supplier history for this product yet.')
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId('sourcing-target-not-found')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sourcing-target-load-error')).not.toBeInTheDocument();
  });

  it('SRC-L3-15A: a non-404 failure renders load-error, never not-found or no-history', async () => {
    renderSourcing({ kind: 'reject', error: httpError(500) });

    await screen.findByTestId('sourcing-target-load-error');

    expect(screen.queryByTestId('sourcing-target-not-found')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No supplier history for this product yet.')
    ).not.toBeInTheDocument();
  });
});
