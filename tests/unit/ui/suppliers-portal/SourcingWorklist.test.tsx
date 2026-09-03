import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import SuppliersPortalModuleFT2, {
  type SourcingRecommendation,
  type Supplier,
  type SupplierAccumulation,
} from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

/**
 * SOURCING-UX-COGNITIVE-01 Slice 2 / Slice 2B — UNIFIED SOURCING WORKLIST
 * --------------------------------------------------------------------
 * Slice 2 (base worklist) contracts SRC-WL-UI-01..05, 07, 09..11, 13, 14
 * remain in force unchanged below.
 *
 * SRC-WL-UI-06 ("a normal row exposes exactly one Review action") is
 * SUPERSEDED by the Slice 2B category-conditional row-action model — see
 * the 2B contracts below. It no longer appears as its own test.
 *
 * SRC-WL-UI-12 (MOQ reachable) is CORRECTED in this pass: the previous
 * fixture never actually exercised a non-empty `reorderRequests` (the
 * render helper hardcoded it to `[]`), so the "remains visible" half of
 * SRC-WL-2B-01 was never genuinely proven. It now uses an explicit
 * non-empty fixture.
 *
 * Slice 2B contracts (RED — not yet implemented):
 *
 *   SRC-WL-2B-01  MOQ/reorder-queue panel absent when reorderRequests=[];
 *                 preserved when non-empty (corrects SRC-WL-UI-12 above)
 *   SRC-WL-2B-02  worklist controls reuse canonical token/interaction
 *                 patterns (styling — deliberately NOT covered by RTL
 *                 assertions here; see the note before §CTA below)
 *   SRC-WL-2B-03  category controls precede search/filter controls (DOM order)
 *   SRC-WL-2B-04  pagination follows canonical module pagination structure
 *   SRC-WL-2B-05  worklist CTAs follow Tier 1/Tier 2 doctrine (styling —
 *                 not covered by RTL assertions here, see note below)
 *   SRC-WL-2B-06  needs_supplier exposes Assign supplier directly at Level 1
 *   SRC-WL-2B-07  Level-1 assignment reuses the EXISTING AssignSupplierDialog
 *                 / onCreatePreference flow, not a duplicate implementation
 *   SRC-WL-2B-08  successful Level-1 assignment refetches the worklist and
 *                 the UI reflects server-derived category movement
 *   SRC-WL-2B-09  needs_purchase and plan_ahead keep Prepare PO at Level 2
 *   SRC-WL-2B-10  in_purchasing exposes queue/draft navigation at Level 1
 *                 (draft wins when both are present, matching Level 2's
 *                 existing targetedAction precedence)
 *   SRC-WL-2B-11  covered_inbound exposes View inbound at Level 1 (does
 *                 NOT claim to resolve SRC-INBOUND-CONTEXT-01 | P2 | OPEN)
 *   SRC-WL-2B-12  planning-driven needs_supplier reason copy uses planning
 *                 context instead of "0 still to source"
 *   SRC-WL-2B-13  Level 1 may perform deterministic, no-new-fetch actions;
 *                 richer contextual decisions (ranking, MOQ detail, editable
 *                 quantity, ranked-supplier PO prep) remain Level 2 —
 *                 exercised throughout via the absence assertions below,
 *                 not as a single standalone test
 *
 * §CTA note: per WORKSHOP instruction, token/color compliance (SRC-WL-2B-02,
 * -05) is deliberately NOT tested here via computed styles or CSS variables
 * — that remains an implementation-inspection / modules-UX-playbook grep /
 * live-browser concern, not an RTL contract.
 *
 * The unified worklist's row-action model above the base Slice 2 shape does
 * not exist yet: there is no `AssignSupplierTarget`-style wiring from the
 * generic worklist into the existing `AssignSupplierDialog`, no worklist
 * refetch-on-assign, no contextual in_purchasing/covered_inbound actions, no
 * category-before-search DOM ordering, and no canonical pagination footer.
 * Every new 2B test below is expected to fail — that is the RED signal.
 */

jest.mock('@lasyncro/shared/ui', () => {
  const React = require('react');
  return {
    ModuleErrorBoundary: ({ children }: any) => React.createElement(React.Fragment, {}, children),
    ModuleLoadingSkeleton: () => React.createElement('div', { 'data-testid': 'skeleton' }),
    SpotlightCoachMark: ({ title }: any) => React.createElement('div', {}, title),
    EntityDetailModal: () => null,
    PulseCard: ({ title }: any) => React.createElement('section', { 'data-testid': 'pulse-card' }, title),
  };
});

type WorklistRow = {
  lasyncro_variant_id: string;
  sku: string | null;
  product_title: string | null;
  variant_title: string | null;
  image_url: string | null;
  category: 'needs_supplier' | 'needs_purchase' | 'in_purchasing' | 'covered_inbound' | 'plan_ahead';
  short_now: number;
  still_to_source: number;
  committed_inbound: number;
  pending_queue_qty: number;
  draft_po_qty: number;
  in_purchasing: number;
  unplanned: number;
  days_of_stock_remaining: number | null;
};

type WorklistResult = {
  items: WorklistRow[];
  summary: {
    needs_supplier: number;
    needs_purchase: number;
    in_purchasing: number;
    covered_inbound: number;
    plan_ahead: number;
  };
  total: number;
  page: number;
  page_size: number;
};

function row(overrides: Partial<WorklistRow> = {}): WorklistRow {
  return {
    lasyncro_variant_id: 'variant-ns-1',
    sku: 'SKU-NS-1',
    product_title: 'Worklist Product',
    variant_title: 'Needs Supplier Variant',
    image_url: 'https://cdn.test.invalid/ns-1.png',
    category: 'needs_supplier',
    short_now: 8,
    still_to_source: 8,
    committed_inbound: 0,
    pending_queue_qty: 0,
    draft_po_qty: 0,
    in_purchasing: 0,
    unplanned: 8,
    days_of_stock_remaining: null,
    ...overrides,
  };
}

function worklistResult(overrides: Partial<WorklistResult> = {}): WorklistResult {
  const items = overrides.items ?? [
    row(),
    row({
      lasyncro_variant_id: 'variant-np-1',
      sku: 'SKU-NP-1',
      variant_title: 'Needs Purchase Variant',
      category: 'needs_purchase',
      still_to_source: 6,
      unplanned: 6,
    }),
  ];
  return {
    items,
    summary: {
      needs_supplier: 1,
      needs_purchase: 1,
      in_purchasing: 0,
      covered_inbound: 1,
      plan_ahead: 0,
    },
    total: items.length,
    page: 1,
    page_size: 50,
    ...overrides,
  };
}

function recommendation(overrides: Partial<SourcingRecommendation> = {}): SourcingRecommendation {
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

const SUPPLIER_ID = 42;
const SUPPLIER_NAME = 'Preferred Mills Ltd';

function defaultSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: SUPPLIER_ID,
    name: SUPPLIER_NAME,
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    on_time_rate: null,
    fill_rate: null,
    defect_rate: null,
    total_pos: 0,
    active: true,
    moq: null,
    lead_time_days: null,
    open_po_count: 0,
    ...overrides,
  };
}

function moqGroup(overrides: Partial<SupplierAccumulation> = {}): SupplierAccumulation {
  return {
    supplier_id: SUPPLIER_ID,
    supplier_name: SUPPLIER_NAME,
    moq: 100,
    lead_time_days: 14,
    total_qty: 60,
    moq_met: false,
    all_lines_have_sku: true,
    gates: { moq_met: false, lead_time_set: true, all_lines_have_sku: true },
    po_ready: false,
    requests: [],
    ...overrides,
  };
}

/**
 * SRC-WL-UI-07: MemoryRouter keeps navigation in an in-memory history object
 * and never writes to jsdom's real `window.location` — so the router's
 * ACTUAL current location must be observed through React Router's own
 * useLocation(), not window.location.
 */
function LocationObserver() {
  const location = useLocation();
  return (
    <div data-testid="test-location-observer" hidden>
      <span data-testid="test-location-pathname">{location.pathname}</span>
      <span data-testid="test-location-search">{location.search}</span>
    </div>
  );
}

function renderWorklist(
  worklistOrSequence: WorklistResult | WorklistResult[],
  options: {
    reorderRequests?: SupplierAccumulation[];
    suppliers?: Supplier[];
    onCreatePreference?: jest.Mock;
    onDeletePreference?: jest.Mock;
  } = {}
) {
  const sequence = Array.isArray(worklistOrSequence) ? worklistOrSequence : [worklistOrSequence];
  let callCount = 0;
  const onFetchSourcingWorklist = jest.fn(() => {
    const result = sequence[Math.min(callCount, sequence.length - 1)];
    callCount += 1;
    return Promise.resolve(result);
  });
  const onFetchSourcingRecommendations = jest.fn(() =>
    Promise.resolve({ recommendations: [recommendation()] } as any)
  );
  const onCreatePreference =
    options.onCreatePreference ?? jest.fn().mockResolvedValue({ id: 'pref-1' });
  const onDeletePreference = options.onDeletePreference ?? jest.fn().mockResolvedValue(undefined);
  const suppliers = options.suppliers ?? [defaultSupplier()];
  const reorderRequests = options.reorderRequests ?? [];

  const utils = render(
    <MemoryRouter initialEntries={['/suppliers-portal/sourcing']}>
      <LocationObserver />
      <SuppliersPortalModuleFT2
        view="sourcing"
        data={{
          purchase_orders: [],
          suppliers,
          never_ordered: [],
          never_ordered_count: 0,
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
        onFetchSourcingWorklist={onFetchSourcingWorklist}
        onFetchPreferences={jest.fn().mockResolvedValue([])}
        onCreatePreference={onCreatePreference}
        onUpdatePreference={jest.fn()}
        onDeletePreference={onDeletePreference}
        onFetchReorderRequests={jest.fn().mockResolvedValue(reorderRequests)}
        onCreateReorderRequest={jest.fn()}
        onDeleteReorderRequest={jest.fn().mockResolvedValue(undefined)}
        onConvertReorderRequests={jest.fn()}
        {...({} as any)}
      />
    </MemoryRouter>
  );

  return { ...utils, onFetchSourcingWorklist, onFetchSourcingRecommendations, onCreatePreference };
}

describe('SOURCING-UX-COGNITIVE-01 Slice 2 — unified sourcing worklist', () => {
  it('SRC-WL-UI-01: generic /sourcing (no variantId) renders the unified worklist', async () => {
    renderWorklist(worklistResult());

    const worklist = await screen.findByTestId('sourcing-worklist');
    expect(worklist).toBeInTheDocument();
    expect(within(worklist).getByTestId('sourcing-worklist-row-variant-ns-1')).toBeInTheDocument();
  });

  it('SRC-WL-UI-02: clicking a category count filters the same worklist server-side', async () => {
    const { onFetchSourcingWorklist } = renderWorklist(worklistResult());

    await screen.findByTestId('sourcing-worklist');
    const counts = await screen.findByTestId('sourcing-worklist-category-counts');
    fireEvent.click(within(counts).getByTestId('sourcing-worklist-category-needs_purchase'));

    await waitFor(() => {
      const lastCall = onFetchSourcingWorklist.mock.calls[onFetchSourcingWorklist.mock.calls.length - 1];
      expect(lastCall?.[0]).toMatchObject({ category: 'needs_purchase' });
    });
  });

  it('SRC-WL-UI-03: covered_inbound rows are absent from the default action view', async () => {
    renderWorklist(
      worklistResult({
        items: [
          row(),
          row({ lasyncro_variant_id: 'variant-ci-1', sku: 'SKU-CI-1', category: 'covered_inbound', still_to_source: 0, committed_inbound: 8 }),
        ],
      })
    );

    await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    expect(screen.queryByTestId('sourcing-worklist-row-variant-ci-1')).not.toBeInTheDocument();
  });

  it('SRC-WL-UI-04: each row shows compact identity — image (or placeholder), product, variant, SKU', async () => {
    renderWorklist(worklistResult());

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    expect(within(worklistRow).getByText('Worklist Product')).toBeInTheDocument();
    expect(within(worklistRow).getByText('Needs Supplier Variant')).toBeInTheDocument();
    expect(within(worklistRow).getByText('SKU-NS-1')).toBeInTheDocument();
    expect(within(worklistRow).getByRole('img')).toBeInTheDocument();

    renderWorklist(
      worklistResult({ items: [row({ lasyncro_variant_id: 'variant-noimg-1', image_url: null })] })
    );
    const noImageRow = await screen.findByTestId('sourcing-worklist-row-variant-noimg-1');
    expect(within(noImageRow).getByTestId('sourcing-worklist-image-placeholder')).toBeInTheDocument();
  });

  it('SRC-WL-UI-05: each row shows exactly one primary reason, not the Level-2 five-number truth grid', async () => {
    renderWorklist(worklistResult());

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    expect(within(worklistRow).getByTestId('sourcing-worklist-row-reason')).toBeInTheDocument();
    for (const field of ['available', 'open_demand', 'committed_inbound', 'short_now', 'still_to_source']) {
      expect(within(worklistRow).queryByTestId(`sourcing-worklist-row-${field}`)).not.toBeInTheDocument();
    }
  });

  it('SRC-WL-UI-07: Review navigates to ?variantId=<canonical variant id> and enters targeted Level 2', async () => {
    const { container } = renderWorklist(worklistResult());

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    fireEvent.click(within(worklistRow).getByRole('button', { name: /review/i }));

    // 1. React Router's OWN location — MemoryRouter never touches
    // window.location, so the router's actual current location is observed
    // via useLocation(), not the browser API.
    await waitFor(() => {
      expect(screen.getByTestId('test-location-pathname').textContent).toBe('/suppliers-portal/sourcing');
      expect(screen.getByTestId('test-location-search').textContent).toBe('?variantId=variant-ns-1');
    });

    // 2. The SAME mounted component instance entered targeted Level 2.
    await waitFor(() => {
      const identity = container.querySelector('[data-testid="sourcing-identity"]');
      expect(identity).toBeInTheDocument();
    });
  });

  it('SRC-WL-UI-08: Level-2 supplier-ranking details and queue/convert actions are absent from worklist rows', async () => {
    renderWorklist(worklistResult());

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    expect(within(worklistRow).queryByText(/preferred mills/i)).not.toBeInTheDocument();
    expect(within(worklistRow).queryByRole('button', { name: /^queue$/i })).not.toBeInTheDocument();
    expect(within(worklistRow).queryByRole('button', { name: /convert/i })).not.toBeInTheDocument();
  });

  it('SRC-WL-UI-09: search is server-backed — typing triggers a worklist refetch with the query', async () => {
    const { onFetchSourcingWorklist } = renderWorklist(worklistResult());

    await screen.findByTestId('sourcing-worklist');
    const search = await screen.findByTestId('sourcing-worklist-search');
    fireEvent.change(search, { target: { value: 'SKU-NS-1' } });

    await waitFor(() => {
      const lastCall = onFetchSourcingWorklist.mock.calls[onFetchSourcingWorklist.mock.calls.length - 1];
      expect(lastCall?.[0]).toMatchObject({ q: 'SKU-NS-1' });
    });
  });

  it('SRC-WL-UI-10: Search, category counts, Filters, and Sort are all present together', async () => {
    renderWorklist(worklistResult());

    const worklist = await screen.findByTestId('sourcing-worklist');
    expect(within(worklist).getByTestId('sourcing-worklist-search')).toBeInTheDocument();
    expect(within(worklist).getByTestId('sourcing-worklist-category-counts')).toBeInTheDocument();
    expect(within(worklist).getByTestId('sourcing-worklist-filters')).toBeInTheDocument();
    expect(within(worklist).getByTestId('sourcing-worklist-sort')).toBeInTheDocument();
  });

  it('SRC-WL-UI-11: Supplier Preferences is moved behind a secondary Supplier settings entry, not shown inline', async () => {
    renderWorklist(worklistResult());

    const worklist = await screen.findByTestId('sourcing-worklist');
    expect(within(worklist).queryByTestId('supplier-preferences-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('supplier-settings-entry')).toBeInTheDocument();
  });

  it('SRC-WL-UI-12 (corrected): supplier-group MOQ accumulation remains visible and reachable when non-empty', async () => {
    renderWorklist(worklistResult(), { reorderRequests: [moqGroup()] });

    await screen.findByTestId('sourcing-worklist');
    const moqPanel = await screen.findByTestId('moq-accumulator-entry');
    expect(within(moqPanel).getByText(new RegExp(SUPPLIER_NAME, 'i'))).toBeInTheDocument();
  });

  it('SRC-WL-UI-13: an empty worklist renders a coherent operational empty state, not a blank view', async () => {
    renderWorklist(worklistResult({ items: [], total: 0, summary: { needs_supplier: 0, needs_purchase: 0, in_purchasing: 0, covered_inbound: 0, plan_ahead: 0 } }));

    const emptyState = await screen.findByTestId('sourcing-worklist-empty-state');
    expect(emptyState).toBeInTheDocument();
    expect(emptyState.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it('SRC-WL-UI-14: generic mode makes ZERO targeted per-variant recommendation calls', async () => {
    const { onFetchSourcingRecommendations } = renderWorklist(worklistResult());

    await screen.findByTestId('sourcing-worklist');
    await waitFor(() => {
      expect(screen.getByTestId('sourcing-worklist-row-variant-ns-1')).toBeInTheDocument();
    });

    expect(onFetchSourcingRecommendations).not.toHaveBeenCalled();
  });
});

describe('SOURCING-UX-COGNITIVE-01 Slice 2B — worklist UX alignment + contextual row actions (RED)', () => {
  it('SRC-WL-2B-01: the MOQ/reorder-queue panel is absent entirely when there is no queued supplier group', async () => {
    renderWorklist(worklistResult(), { reorderRequests: [] });

    await screen.findByTestId('sourcing-worklist');
    expect(screen.queryByTestId('moq-accumulator-entry')).not.toBeInTheDocument();
  });

  it('SRC-WL-2B-03: category controls precede search/filter controls in DOM order', async () => {
    renderWorklist(worklistResult());

    const worklist = await screen.findByTestId('sourcing-worklist');
    const counts = within(worklist).getByTestId('sourcing-worklist-category-counts');
    const search = within(worklist).getByTestId('sourcing-worklist-search');

    // DOCUMENT_POSITION_FOLLOWING (4) on `search` relative to `counts` means
    // `search` comes AFTER `counts` in document order — i.e. category
    // controls precede search/filter controls. A structural check, not a
    // pixel/CSS-position one.
    const position = counts.compareDocumentPosition(search);
    // eslint-disable-next-line no-bitwise
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('SRC-WL-2B-04: pagination exposes range, page-size control, Previous, numbered pages, and Next', async () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      row({ lasyncro_variant_id: `variant-pg-${i}`, sku: `SKU-PG-${i}` })
    );
    renderWorklist(worklistResult({ items, total: 75, page: 1, page_size: 50 }));

    const pagination = await screen.findByTestId('sourcing-worklist-pagination');
    expect(within(pagination).getByText(/1.*50.*75|1–50 of 75/i)).toBeInTheDocument();
    expect(within(pagination).getByTestId('sourcing-worklist-page-size')).toBeInTheDocument();
    expect(within(pagination).getByRole('button', { name: /previous|prev/i })).toBeInTheDocument();
    expect(within(pagination).getByRole('button', { name: /next/i })).toBeInTheDocument();
    // total 75 / page_size 50 -> 2 pages, so a numbered page control for
    // page 2 must exist somewhere in the pagination region.
    expect(within(pagination).getByRole('button', { name: /^2$/ })).toBeInTheDocument();
  });

  it('SRC-WL-2B-06: needs_supplier row exposes BOTH Assign supplier (primary) and Review (secondary)', async () => {
    renderWorklist(worklistResult());

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    expect(within(worklistRow).getByRole('button', { name: /assign supplier/i })).toBeInTheDocument();
    expect(within(worklistRow).getByRole('button', { name: /review/i })).toBeInTheDocument();
  });

  it('SRC-WL-2B-06/09: Assign supplier is absent from needs_purchase, in_purchasing and plan_ahead rows', async () => {
    renderWorklist(
      worklistResult({
        items: [
          row({ lasyncro_variant_id: 'variant-np-1', category: 'needs_purchase', still_to_source: 6, unplanned: 6 }),
          row({ lasyncro_variant_id: 'variant-ip-1', category: 'in_purchasing', still_to_source: 5, unplanned: 0, pending_queue_qty: 5, in_purchasing: 5 }),
          row({ lasyncro_variant_id: 'variant-pa-1', category: 'plan_ahead', still_to_source: 0, unplanned: 0, days_of_stock_remaining: 12 }),
        ],
        summary: { needs_supplier: 0, needs_purchase: 1, in_purchasing: 1, covered_inbound: 0, plan_ahead: 1 },
        total: 3,
      })
    );

    for (const id of ['variant-np-1', 'variant-ip-1', 'variant-pa-1']) {
      const worklistRow = await screen.findByTestId(`sourcing-worklist-row-${id}`);
      expect(within(worklistRow).queryByRole('button', { name: /assign supplier/i })).not.toBeInTheDocument();
    }
  });

  it('SRC-WL-2B-06/09: Assign supplier is absent from covered_inbound rows', async () => {
    renderWorklist(
      worklistResult({
        items: [
          row({ lasyncro_variant_id: 'variant-ci-1', category: 'covered_inbound', still_to_source: 0, unplanned: 0, committed_inbound: 8, short_now: 8 }),
        ],
        summary: { needs_supplier: 0, needs_purchase: 0, in_purchasing: 0, covered_inbound: 1, plan_ahead: 0 },
        total: 1,
      })
    );

    // covered_inbound is excluded from the default view (SRC-WL-UI-03) — the
    // row is only reachable via the explicit category filter, same as the
    // dedicated covered_inbound action test below.
    const counts = await screen.findByTestId('sourcing-worklist-category-counts');
    fireEvent.click(within(counts).getByTestId('sourcing-worklist-category-covered_inbound'));

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ci-1');
    expect(within(worklistRow).queryByRole('button', { name: /assign supplier/i })).not.toBeInTheDocument();
  });

  it('SRC-WL-2B-09: Prepare PO is absent from needs_purchase and plan_ahead rows', async () => {
    renderWorklist(
      worklistResult({
        items: [
          row({ lasyncro_variant_id: 'variant-np-1', category: 'needs_purchase', still_to_source: 6, unplanned: 6 }),
          row({ lasyncro_variant_id: 'variant-pa-1', category: 'plan_ahead', still_to_source: 0, unplanned: 0, days_of_stock_remaining: 12 }),
        ],
        summary: { needs_supplier: 0, needs_purchase: 1, in_purchasing: 0, covered_inbound: 0, plan_ahead: 1 },
        total: 2,
      })
    );

    for (const id of ['variant-np-1', 'variant-pa-1']) {
      const worklistRow = await screen.findByTestId(`sourcing-worklist-row-${id}`);
      expect(within(worklistRow).queryByRole('button', { name: /prepare po/i })).not.toBeInTheDocument();
    }
  });

  it('SRC-WL-2B-07: Assign supplier opens the EXISTING AssignSupplierDialog and submits through onCreatePreference', async () => {
    const { onCreatePreference, onFetchSourcingRecommendations } = renderWorklist(worklistResult());

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    fireEvent.click(within(worklistRow).getByRole('button', { name: /assign supplier/i }));

    // The SAME dialog Level 2 already uses — not a replacement/mocked one.
    // The dialog legitimately contains "Assign supplier" TWICE (its heading
    // AND its submit button), so each is asserted by role rather than by an
    // ambiguous shared text match.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /assign supplier/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^assign supplier$/i })).toBeInTheDocument();

    fireEvent.mouseDown(within(dialog).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: SUPPLIER_NAME }));

    fireEvent.click(within(dialog).getByRole('button', { name: /^assign supplier$/i }));

    await waitFor(() => {
      expect(onCreatePreference).toHaveBeenCalledWith(
        expect.objectContaining({
          supplier_id: SUPPLIER_ID,
          scope_type: 'variant',
          scope_id: 'variant-ns-1',
        })
      );
    });

    // Assigning from Level 1 must not trigger a targeted per-variant fetch —
    // SRC-WL-UI-14 still holds through this flow.
    expect(onFetchSourcingRecommendations).not.toHaveBeenCalled();
  });

  it('SRC-WL-2B-08: a successful Level-1 assignment refetches the worklist and the UI reflects the server-derived category move', async () => {
    const beforeAssignment = worklistResult({
      items: [row()],
      summary: { needs_supplier: 1, needs_purchase: 0, in_purchasing: 0, covered_inbound: 0, plan_ahead: 0 },
      total: 1,
    });
    const afterAssignment = worklistResult({
      items: [row({ category: 'needs_purchase', still_to_source: 8, unplanned: 8 })],
      summary: { needs_supplier: 0, needs_purchase: 1, in_purchasing: 0, covered_inbound: 0, plan_ahead: 0 },
      total: 1,
    });

    const { onFetchSourcingWorklist } = renderWorklist([beforeAssignment, afterAssignment]);

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    const callsBeforeAssign = onFetchSourcingWorklist.mock.calls.length;

    fireEvent.click(within(worklistRow).getByRole('button', { name: /assign supplier/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(within(dialog).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: SUPPLIER_NAME }));
    fireEvent.click(within(dialog).getByRole('button', { name: /assign supplier/i }));

    // The worklist MUST be refetched — not locally mutated.
    await waitFor(() => {
      expect(onFetchSourcingWorklist.mock.calls.length).toBeGreaterThan(callsBeforeAssign);
    });

    // Server truth (second response) is what the UI shows: no more
    // Assign-supplier action on this row, because it is no longer
    // needs_supplier.
    await waitFor(() => {
      const updatedRow = screen.getByTestId('sourcing-worklist-row-variant-ns-1');
      expect(within(updatedRow).queryByRole('button', { name: /assign supplier/i })).not.toBeInTheDocument();
    });
  });

  it('SRC-WL-2B-08 (filtered): when the needs_supplier category filter is active, a row that moves off-category on refetch disappears from the view', async () => {
    const beforeAssignment = worklistResult({
      items: [row()],
      summary: { needs_supplier: 1, needs_purchase: 0, in_purchasing: 0, covered_inbound: 0, plan_ahead: 0 },
      total: 1,
    });
    const afterAssignmentFilteredEmpty = worklistResult({
      items: [],
      summary: { needs_supplier: 0, needs_purchase: 1, in_purchasing: 0, covered_inbound: 0, plan_ahead: 0 },
      total: 0,
    });

    renderWorklist([beforeAssignment, beforeAssignment, afterAssignmentFilteredEmpty]);

    const counts = await screen.findByTestId('sourcing-worklist-category-counts');
    fireEvent.click(within(counts).getByTestId('sourcing-worklist-category-needs_supplier'));

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    fireEvent.click(within(worklistRow).getByRole('button', { name: /assign supplier/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(within(dialog).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: SUPPLIER_NAME }));
    fireEvent.click(within(dialog).getByRole('button', { name: /assign supplier/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('sourcing-worklist-row-variant-ns-1')).not.toBeInTheDocument();
    });
  });

  it('SRC-WL-2B-10: in_purchasing exposes "Review queue" when only queued, "Review draft PO" when only drafted', async () => {
    renderWorklist(
      worklistResult({
        items: [
          row({
            lasyncro_variant_id: 'variant-ip-queue',
            category: 'in_purchasing',
            still_to_source: 5,
            unplanned: 0,
            pending_queue_qty: 5,
            draft_po_qty: 0,
            in_purchasing: 5,
          }),
          row({
            lasyncro_variant_id: 'variant-ip-draft',
            category: 'in_purchasing',
            still_to_source: 4,
            unplanned: 0,
            pending_queue_qty: 0,
            draft_po_qty: 4,
            in_purchasing: 4,
          }),
        ],
        summary: { needs_supplier: 0, needs_purchase: 0, in_purchasing: 2, covered_inbound: 0, plan_ahead: 0 },
        total: 2,
      })
    );

    const queueRow = await screen.findByTestId('sourcing-worklist-row-variant-ip-queue');
    expect(within(queueRow).getByRole('button', { name: /review queue/i })).toBeInTheDocument();
    expect(within(queueRow).queryByRole('button', { name: /review draft/i })).not.toBeInTheDocument();

    const draftRow = await screen.findByTestId('sourcing-worklist-row-variant-ip-draft');
    expect(within(draftRow).getByRole('button', { name: /review draft/i })).toBeInTheDocument();
    expect(within(draftRow).queryByRole('button', { name: /review queue/i })).not.toBeInTheDocument();
  });

  it('SRC-WL-2B-10: when both queued and drafted, "Review draft PO" wins (matches Level 2 targetedAction precedence)', async () => {
    const { container } = renderWorklist(
      worklistResult({
        items: [
          row({
            lasyncro_variant_id: 'variant-ip-both',
            category: 'in_purchasing',
            still_to_source: 9,
            unplanned: 0,
            pending_queue_qty: 5,
            draft_po_qty: 4,
            in_purchasing: 9,
          }),
        ],
        summary: { needs_supplier: 0, needs_purchase: 0, in_purchasing: 1, covered_inbound: 0, plan_ahead: 0 },
        total: 1,
      })
    );

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ip-both');
    expect(within(worklistRow).getByRole('button', { name: /review draft/i })).toBeInTheDocument();
    expect(within(worklistRow).queryByRole('button', { name: /review queue/i })).not.toBeInTheDocument();

    // Existing navigation behaviour only — no new purchasing route: Level 2's
    // targetedAction resolver navigates draft/queue review to /suppliers-portal.
    fireEvent.click(within(worklistRow).getByRole('button', { name: /review draft/i }));
    await waitFor(() => {
      expect(screen.getByTestId('test-location-pathname').textContent).toBe('/suppliers-portal');
    });
    void container;
  });

  it('SRC-WL-2B-11: covered_inbound exposes "View inbound" as plain existing navigation', async () => {
    renderWorklist(
      worklistResult({
        items: [
          row({
            lasyncro_variant_id: 'variant-ci-1',
            category: 'covered_inbound',
            still_to_source: 0,
            unplanned: 0,
            short_now: 8,
            committed_inbound: 8,
          }),
        ],
        summary: { needs_supplier: 0, needs_purchase: 0, in_purchasing: 0, covered_inbound: 1, plan_ahead: 0 },
        total: 1,
      }),
      { }
    );

    // covered_inbound is excluded from the default view (SRC-WL-UI-03) — the
    // action itself is proven via the explicit category filter, same as the
    // existing covered_inbound row-shape test.
    const counts = await screen.findByTestId('sourcing-worklist-category-counts');
    fireEvent.click(within(counts).getByTestId('sourcing-worklist-category-covered_inbound'));

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ci-1');
    const viewInbound = within(worklistRow).getByRole('button', { name: /view inbound/i });
    fireEvent.click(viewInbound);

    await waitFor(() => {
      expect(screen.getByTestId('test-location-pathname').textContent).toBe('/suppliers-portal');
    });
    // Deliberately NOT asserted: that variant context survives navigation.
    // SRC-INBOUND-CONTEXT-01 | P2 | OPEN remains open and unresolved by this.
  });

  it('SRC-WL-2B-12: reactive needs_supplier reason states the shortfall', async () => {
    renderWorklist(
      worklistResult({
        items: [row({ still_to_source: 8, unplanned: 8 })],
      })
    );

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    const reason = within(worklistRow).getByTestId('sourcing-worklist-row-reason');
    expect(reason.textContent).toMatch(/8 still to source/i);
    expect(reason.textContent).toMatch(/no supplier assigned/i);
  });

  it('SRC-WL-2B-12: planning-driven needs_supplier with a known days-of-stock uses planning copy, never "0 still to source"', async () => {
    renderWorklist(
      worklistResult({
        items: [row({ still_to_source: 0, unplanned: 0, days_of_stock_remaining: 6 })],
      })
    );

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    const reason = within(worklistRow).getByTestId('sourcing-worklist-row-reason');
    expect(reason.textContent).toMatch(/stockout projected in 6 days/i);
    expect(reason.textContent).toMatch(/no supplier assigned/i);
    expect(reason.textContent?.toLowerCase()).not.toContain('0 still to source');
  });

  it('SRC-WL-2B-12: planning-driven needs_supplier with no known days-of-stock falls back to "Replenishment due"', async () => {
    renderWorklist(
      worklistResult({
        items: [row({ still_to_source: 0, unplanned: 0, days_of_stock_remaining: null })],
      })
    );

    const worklistRow = await screen.findByTestId('sourcing-worklist-row-variant-ns-1');
    const reason = within(worklistRow).getByTestId('sourcing-worklist-row-reason');
    expect(reason.textContent).toMatch(/replenishment due/i);
    expect(reason.textContent).toMatch(/no supplier assigned/i);
    expect(reason.textContent?.toLowerCase()).not.toContain('0 still to source');
  });
});
