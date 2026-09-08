import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import SuppliersPortalModuleFT2, {
  type SourcingResult,
  type SourcingRecommendation,
} from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

/**
 * SOURCING-UX-COGNITIVE-01 Slice 1B — TARGETED RECOVERY ACTIONS
 * -------------------------------------------------------------
 * Slice 1A told the merchant how many units remain unsecured. It did not tell
 * them whether they had ALREADY started buying those units, and it offered the
 * same two parallel CTAs (Add to queue, Create PO) on every supplier row in
 * every state — including states where starting new purchasing work is exactly
 * the wrong move.
 *
 * These contracts describe REQUIRED OBSERVABLE BEHAVIOUR of the targeted
 * surface. Supply truth is unchanged and is not re-tested here: `still_to_source`
 * remains max(0, open_demand - available - committed_inbound), and queue/draft
 * work never reduces it (see the backend suite).
 *
 *   SRC-ACT-UI-01  covered by inbound      → no new-purchase CTA
 *   SRC-ACT-UI-02  queue covers the need   → continue, do not duplicate
 *   SRC-ACT-UI-03  draft covers the need   → continue, do not duplicate
 *   SRC-ACT-UI-04  needs supplier vs merely no saved preference
 *   SRC-ACT-UI-05  targeted assignment preserves targeted context
 *   SRC-ACT-UI-06  MOQ decides which purchasing action leads
 *   SRC-ACT-UI-07  Prepare PO carries the real variant and the real quantity
 *   SRC-ACT-UI-08  exactly one dominant action; no portfolio coachmark
 *
 * Live-browser correction — media and decision composition:
 *
 *   SRC-ACT-UI-10  a real product image gets its own media region
 *   SRC-ACT-UI-11  no image collapses to the compact placeholder, no media region
 *   SRC-ACT-UI-12  nothing left to buy → no purchase quantity control
 *   SRC-ACT-UI-13  the quantity belongs to the purchasing action that uses it
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
const SUPPLIER_ID = 7;
const SUPPLIER_NAME = 'Preferred Mills Ltd';

/** The supplier the recommendations refer to, as the merchant's own record. */
const ACTIVE_SUPPLIER = {
  id: SUPPLIER_ID,
  name: SUPPLIER_NAME,
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  on_time_rate: 96,
  fill_rate: 99,
  defect_rate: 0.5,
  total_pos: 12,
  active: true,
  moq: null,
  lead_time_days: 14,
  open_po_count: 0,
};

/** The one action the surface is asking the merchant to take next. */
const DOMINANT = 'sourcing-primary-action';
/** Anything offered alongside it, deliberately subordinate. */
const SECONDARY = 'sourcing-secondary-action';
/** The prominent product media region, present only when there is an image. */
const MEDIA = 'sourcing-product-media';
/** The editable quantity the targeted purchasing action will actually use. */
const PURCHASE_QTY = 'sourcing-purchase-quantity';

function recommendation(
  overrides: Partial<SourcingRecommendation> = {}
): SourcingRecommendation {
  return {
    id: SUPPLIER_ID,
    name: 'Preferred Mills Ltd',
    contact_name: null,
    contact_email: null,
    on_time_rate: '96.00',
    fill_rate: '99.00',
    defect_rate: '0.50',
    avg_delivery_days: '4.00',
    moq: null,
    lead_time_days: 14,
    score: 91,
    pooled_qty: 0,
    units_to_moq: 0,
    is_preferred: false,
    preference_tier: null,
    preference_priority: null,
    preference_scope: null,
    preference_note: null,
    ...overrides,
  };
}

/**
 * Server truth for one targeted variant.
 *
 * `in_purchasing` / `unplanned` are the Slice 1B workflow facts;
 * `pending_queue_qty` / `draft_po_qty` decompose `in_purchasing` far enough for
 * the surface to say WHICH work is already underway — the minimum needed to
 * tell "review your queue" apart from "review your draft PO".
 */
function sourcingResult(overrides: Partial<SourcingResult> = {}): SourcingResult {
  return {
    recommendations: [recommendation()],
    image_url: null,
    product_title: 'Targeted Recovery Product',
    variant_title: 'Targeted Recovery Variant',
    sku: 'SRC-TGT-001',
    open_demand: 10,
    available: 0,
    committed_inbound: 0,
    short_now: 10,
    still_to_source: 10,
    in_purchasing: 0,
    unplanned: 10,
    pending_queue_qty: 0,
    draft_po_qty: 0,
    blocking_orders: [
      { order_id: ORIGINATING_ORDER_ID, external_order_id: '800001', units: 10 },
    ],
    originating_order_id: ORIGINATING_ORDER_ID,
    shortfall: 10,
    shortfall_basis: { demand: 10, available: 0 },
    queue_qty: 10,
    quantity_basis: 'reactive',
    suggested_reorder_qty: null,
    planning_context: null,
    ...overrides,
  } as SourcingResult;
}

type RenderOptions = {
  result?: SourcingResult;
  orderId?: string | null;
  onCreatePreference?: jest.Mock;
  onFetchSourcingRecommendations?: jest.Mock;
  /** OUTCOME-INV-01: captured so the queue payload can be asserted. */
  onCreateReorderRequest?: jest.Mock;
  /** OUTCOME-INV-01: advisory treatment provenance carried in the deep link. */
  treatmentKey?: string | null;
};

function renderTargeted(options: RenderOptions = {}) {
  const result = options.result ?? sourcingResult();

  const onFetchSourcingRecommendations =
    options.onFetchSourcingRecommendations ??
    jest.fn(() => Promise.resolve(result));

  const onCreatePreference =
    options.onCreatePreference ??
    jest.fn(() =>
      Promise.resolve({
        id: 'pref-1',
        supplier_id: SUPPLIER_ID,
        supplier_name: 'Preferred Mills Ltd',
        scope_type: 'variant' as const,
        scope_id: TARGET_VARIANT_ID,
        priority: 1,
        note: null,
        created_at: '2026-09-03T12:00:00.000Z',
        updated_at: '2026-09-03T12:00:00.000Z',
      })
    );

  const orderId =
    options.orderId === undefined ? ORIGINATING_ORDER_ID : options.orderId;

  const onCreateReorderRequest =
    options.onCreateReorderRequest ?? jest.fn(() => Promise.resolve({} as never));

  const treatmentKey = options.treatmentKey ?? null;

  const search =
    `?variantId=${encodeURIComponent(TARGET_VARIANT_ID)}` +
    (orderId ? `&orderId=${encodeURIComponent(orderId)}` : '') +
    (treatmentKey ? `&treatmentKey=${encodeURIComponent(treatmentKey)}` : '');

  const utils = render(
    <MemoryRouter initialEntries={[`/suppliers-portal/sourcing${search}`]}>
      <SuppliersPortalModuleFT2
        view="sourcing"
        data={{
          purchase_orders: [],
          // Both UI-05 and UI-07 model an EXISTING supplier: one assigns it,
          // the other prepares a PO for it. The dialogs pick their selectable
          // options from data.suppliers, so the recommended supplier has to be
          // a real active row here — an empty list modelled a merchant with no
          // suppliers at all, which is not the scenario under test.
          suppliers: [ACTIVE_SUPPLIER],
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
        onFetchPreferences={jest.fn().mockResolvedValue([])}
        onCreatePreference={onCreatePreference}
        onUpdatePreference={jest.fn()}
        onDeletePreference={jest.fn().mockResolvedValue(undefined)}
        onFetchReorderRequests={jest.fn().mockResolvedValue([])}
        onCreateReorderRequest={onCreateReorderRequest}
        onDeleteReorderRequest={jest.fn().mockResolvedValue(undefined)}
        onConvertReorderRequests={jest.fn()}
      />
    </MemoryRouter>
  );

  return {
    ...utils,
    onFetchSourcingRecommendations,
    onCreatePreference,
    onCreateReorderRequest,
  };
}

/** Waits for the targeted surface to have loaded before asserting on actions. */
async function targetedSurface() {
  return screen.findByTestId('sourcing-identity');
}

describe('SOURCING-UX-COGNITIVE-01 Slice 1B — targeted recovery actions', () => {
  it('SRC-ACT-UI-01: fully covered by inbound offers no new purchasing action', async () => {
    renderTargeted({
      result: sourcingResult({
        available: 0,
        open_demand: 10,
        committed_inbound: 10,
        short_now: 10,
        still_to_source: 0,
        in_purchasing: 0,
        unplanned: 0,
        pending_queue_qty: 0,
        draft_po_qty: 0,
      }),
    });

    await targetedSurface();

    // Nothing remains to buy, so the surface must not invite a new purchase.
    expect(screen.queryByText(/add to queue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/create po|prepare po/i)).not.toBeInTheDocument();

    // The blocking order is still waiting, so this is not "nothing to do" —
    // it points at the stock already on its way.
    const dominant = screen.getByTestId(DOMINANT);
    expect(dominant).toHaveTextContent(/inbound/i);
    expect(screen.getAllByTestId(DOMINANT)).toHaveLength(1);
  });

  it('SRC-ACT-UI-02: a queue that already covers the need continues it, and does not offer to start again', async () => {
    renderTargeted({
      result: sourcingResult({
        still_to_source: 10,
        in_purchasing: 10,
        unplanned: 0,
        pending_queue_qty: 10,
        draft_po_qty: 0,
      }),
    });

    await targetedSurface();

    const dominant = screen.getByTestId(DOMINANT);
    expect(dominant).toHaveTextContent(/queue/i);
    expect(dominant).toHaveTextContent(/review|view|open/i);

    // The work is already queued — offering to queue it again duplicates intent.
    expect(screen.queryByText(/add to queue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/create po|prepare po/i)).not.toBeInTheDocument();
  });

  it('SRC-ACT-UI-03: a draft PO that already covers the need continues it, and does not offer to start again', async () => {
    renderTargeted({
      result: sourcingResult({
        still_to_source: 10,
        in_purchasing: 10,
        unplanned: 0,
        pending_queue_qty: 0,
        draft_po_qty: 10,
      }),
    });

    await targetedSurface();

    const dominant = screen.getByTestId(DOMINANT);
    expect(dominant).toHaveTextContent(/draft/i);
    expect(dominant).toHaveTextContent(/review|view|open/i);

    expect(screen.queryByText(/add to queue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/create po|prepare po/i)).not.toBeInTheDocument();
  });

  it('SRC-ACT-UI-04A: no usable supplier makes assigning one the dominant action', async () => {
    renderTargeted({
      result: sourcingResult({ recommendations: [] }),
    });

    await targetedSurface();

    const dominant = screen.getByTestId(DOMINANT);
    expect(dominant).toHaveTextContent(/assign supplier/i);
  });

  it('SRC-ACT-UI-04B: a usable supplier without a saved preference is not "needs supplier"', async () => {
    renderTargeted({
      result: sourcingResult({
        recommendations: [
          recommendation({ is_preferred: false, preference_tier: null }),
        ],
      }),
    });

    await targetedSurface();

    const dominant = screen.getByTestId(DOMINANT);
    // A supplier this merchant has bought from before is usable whether or not
    // they have saved a preference. Demanding an assignment first would block
    // purchasing on bookkeeping.
    expect(dominant).not.toHaveTextContent(/assign supplier/i);
    expect(dominant).toHaveTextContent(/queue|prepare po/i);
  });

  it('SRC-ACT-UI-05: assigning a supplier keeps the targeted context and surfaces the new option', async () => {
    const ASSIGNED_SUPPLIER = 'Newly Assigned Mills';

    const onCreatePreference = jest.fn().mockResolvedValue({
      id: 'pref-1',
      supplier_id: SUPPLIER_ID,
      supplier_name: ASSIGNED_SUPPLIER,
      scope_type: 'variant',
      scope_id: TARGET_VARIANT_ID,
      priority: 1,
      note: null,
      created_at: '2026-09-03T12:00:00.000Z',
      updated_at: '2026-09-03T12:00:00.000Z',
    });

    // Before: nothing usable. After the assignment the server returns that
    // supplier as a real recommendation — which is the whole point of assigning
    // one, and the merchant must actually see it without leaving the target.
    const beforeAssignment = sourcingResult({
      recommendations: [],
      still_to_source: 10,
      in_purchasing: 0,
      unplanned: 10,
    });

    const afterAssignment = sourcingResult({
      recommendations: [
        recommendation({
          name: ASSIGNED_SUPPLIER,
          is_preferred: true,
          preference_tier: 1,
          moq: null,
          units_to_moq: 0,
        }),
      ],
      still_to_source: 10,
      in_purchasing: 0,
      unplanned: 10,
    });

    const onFetchSourcingRecommendations = jest
      .fn()
      .mockResolvedValueOnce(beforeAssignment)
      .mockResolvedValue(afterAssignment);

    renderTargeted({
      result: beforeAssignment,
      onCreatePreference,
      onFetchSourcingRecommendations,
    });

    await targetedSurface();

    fireEvent.click(screen.getByTestId(DOMINANT));

    const dialog = await screen.findByRole('dialog');

    // Assigning means picking WHICH supplier — the dialog rightly refuses to
    // submit without one, so the test has to make that choice like a merchant.
    fireEvent.mouseDown(within(dialog).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: SUPPLIER_NAME }));

    fireEvent.click(
      within(dialog).getByRole('button', { name: /assign supplier/i })
    );

    await waitFor(() => {
      expect(onCreatePreference).toHaveBeenCalledWith(
        expect.objectContaining({
          supplier_id: SUPPLIER_ID,
          scope_type: 'variant',
          scope_id: TARGET_VARIANT_ID,
        })
      );
    });

    // Still on the target: identity and purchasing truth remain on screen.
    const identity = await screen.findByTestId('sourcing-identity');
    expect(within(identity).getByText('Targeted Recovery Product')).toBeInTheDocument();
    expect(within(identity).getByText('SRC-TGT-001')).toBeInTheDocument();
    expect(screen.getByTestId('sourcing-gap-summary')).toBeInTheDocument();

    // The variantId context survives: the module keeps reading the SAME target.
    expect(onFetchSourcingRecommendations).toHaveBeenLastCalledWith(
      TARGET_VARIANT_ID
    );

    // The orderId context survives: the originating order is still named.
    expect(screen.getByText(/800001/)).toBeInTheDocument();

    // The assignment is visible as a usable option …
    await waitFor(() => {
      expect(screen.getByText(ASSIGNED_SUPPLIER)).toBeInTheDocument();
    });

    // … and the surface now offers the purchasing action that option unlocks,
    // rather than still asking the merchant to assign a supplier.
    const dominant = screen.getByTestId(DOMINANT);
    expect(dominant).not.toHaveTextContent(/assign supplier/i);
    expect(dominant).toHaveTextContent(/queue|prepare po/i);
  });

  it('SRC-ACT-UI-06A: below MOQ, queueing leads and immediate ordering is secondary', async () => {
    renderTargeted({
      result: sourcingResult({
        still_to_source: 10,
        in_purchasing: 0,
        unplanned: 10,
        recommendations: [recommendation({ moq: 100, units_to_moq: 90 })],
      }),
    });

    await targetedSurface();

    expect(screen.getByTestId(DOMINANT)).toHaveTextContent(/queue/i);
    // "Order now instead" is the Workshop-ratified wording for the below-MOQ
    // immediate-order path: the exception to pooling, phrased as one.
    expect(screen.getByTestId(SECONDARY)).toHaveTextContent(/order now instead/i);
  });

  it('SRC-ACT-UI-06B: at or above MOQ, preparing the PO leads', async () => {
    renderTargeted({
      result: sourcingResult({
        still_to_source: 10,
        in_purchasing: 0,
        unplanned: 10,
        recommendations: [recommendation({ moq: null, units_to_moq: 0 })],
      }),
    });

    await targetedSurface();

    expect(screen.getByTestId(DOMINANT)).toHaveTextContent(/prepare po/i);
  });

  it('SRC-ACT-UI-07: Prepare PO seeds the real variant, identity and quantity', async () => {
    renderTargeted({
      result: sourcingResult({
        still_to_source: 5,
        in_purchasing: 0,
        unplanned: 5,
        queue_qty: 5,
        recommendations: [recommendation({ moq: null, units_to_moq: 0 })],
      }),
    });

    await targetedSurface();

    fireEvent.click(screen.getByTestId(DOMINANT));

    const dialog = await screen.findByRole('dialog');

    // The supplier the merchant chose.
    expect(within(dialog).getByText(/preferred mills ltd/i)).toBeInTheDocument();

    // A line the merchant can actually send: identity, not a blank description.
    // The seeded line keeps its canonical variant link, so the dialog renders
    // it as a linked product line rather than a free-text search field — the
    // same fact, read where the component actually shows it.
    const description = within(dialog).getByText(/targeted recovery|SRC-TGT-001/i);
    expect(description).toBeInTheDocument();
    expect(description.textContent?.trim()).not.toBe('');

    // The quantity the merchant was shown. A fallback of 1 against a 5-unit
    // requirement silently under-orders, which is the current defect.
    expect(within(dialog).getByDisplayValue('5')).toBeInTheDocument();
  });

  it.each([
    [
      'covered by inbound',
      sourcingResult({
        committed_inbound: 10,
        still_to_source: 0,
        in_purchasing: 0,
        unplanned: 0,
      }),
    ],
    [
      'queue covers the need',
      sourcingResult({
        still_to_source: 10,
        in_purchasing: 10,
        unplanned: 0,
        pending_queue_qty: 10,
      }),
    ],
    [
      'draft covers the need',
      sourcingResult({
        still_to_source: 10,
        in_purchasing: 10,
        unplanned: 0,
        draft_po_qty: 10,
      }),
    ],
    ['no usable supplier', sourcingResult({ recommendations: [] })],
    [
      'below MOQ',
      sourcingResult({
        recommendations: [recommendation({ moq: 100, units_to_moq: 90 })],
      }),
    ],
    [
      'ready to prepare PO',
      sourcingResult({
        recommendations: [recommendation({ moq: null, units_to_moq: 0 })],
      }),
    ],
  ])(
    'SRC-ACT-UI-08: %s presents exactly one dominant action and no portfolio coachmark',
    async (_label, result) => {
      renderTargeted({ result });

      await targetedSurface();

      expect(screen.getAllByTestId(DOMINANT)).toHaveLength(1);

      // The portfolio onboarding coachmark competes with purchasing truth in a
      // targeted recovery. Generic mode keeps it; this is a targeted-mode rule.
      expect(
        screen.queryByText(/your best supplier, ranked automatically/i)
      ).not.toBeInTheDocument();
    }
  );

  it('SRC-ACT-UI-10: a real product image gets its own media region', async () => {
    const imageUrl = 'https://cdn.test.invalid/targeted-shirt.png';

    renderTargeted({ result: sourcingResult({ image_url: imageUrl }) });

    await targetedSurface();

    // A merchant recovering one product should be able to recognise it on
    // sight. A 48px thumbnail inside a text row is an icon, not a look at the
    // product — so a real image earns a region of its own.
    const media = screen.getByTestId(MEDIA);
    const image = within(media).getByRole('img');
    expect(image).toHaveAttribute('src', imageUrl);

    // Identity stays readable alongside it; the image replaces nothing.
    const identity = screen.getByTestId('sourcing-identity');
    expect(within(identity).getByText('Targeted Recovery Product')).toBeInTheDocument();
    expect(within(identity).getByText('SRC-TGT-001')).toBeInTheDocument();

    // And the compact placeholder is not standing in for a picture we have.
    expect(screen.queryByTestId('sourcing-identity-placeholder')).not.toBeInTheDocument();
  });

  it('SRC-ACT-UI-11: a target with no image collapses to the compact placeholder', async () => {
    renderTargeted({ result: sourcingResult({ image_url: null }) });

    const identity = await targetedSurface();

    // Preservation contract: the Slice 1A fallback still holds.
    expect(screen.getByTestId('sourcing-identity-placeholder')).toBeInTheDocument();
    expect(within(identity).getByText('Targeted Recovery Product')).toBeInTheDocument();
    expect(within(identity).getByText('Targeted Recovery Variant')).toBeInTheDocument();
    expect(within(identity).getByText('SRC-TGT-001')).toBeInTheDocument();

    // No image means no media region to give space to — an empty frame would
    // be worse than the compact row it replaced.
    expect(screen.queryByTestId(MEDIA)).not.toBeInTheDocument();
  });

  it('SRC-ACT-UI-12: nothing left to buy offers no purchasing quantity', async () => {
    renderTargeted({
      result: sourcingResult({
        available: 0,
        open_demand: 10,
        committed_inbound: 10,
        short_now: 10,
        still_to_source: 0,
        in_purchasing: 0,
        unplanned: 0,
        pending_queue_qty: 0,
        draft_po_qty: 0,
        queue_qty: 0,
      }),
    });

    await targetedSurface();

    // Asking "how many?" when the answer is none is a question with no purpose.
    // Asserted twice on purpose: by the semantic id the purchasing control will
    // carry, and by the label the merchant actually reads today — the id alone
    // would pass trivially while the current control is still on screen.
    expect(screen.queryByTestId(PURCHASE_QTY)).not.toBeInTheDocument();
    expect(screen.queryByText(/order quantity/i)).not.toBeInTheDocument();

    // The rest of the covered-by-inbound contract is unchanged.
    const dominant = screen.getByTestId(DOMINANT);
    expect(dominant).toHaveTextContent(/inbound/i);
    expect(screen.queryByText(/add to queue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/create po|prepare po/i)).not.toBeInTheDocument();
  });

  it('SRC-ACT-UI-13: the purchasing quantity is the one the action uses', async () => {
    renderTargeted({
      result: sourcingResult({
        still_to_source: 5,
        in_purchasing: 0,
        unplanned: 5,
        queue_qty: 5,
        recommendations: [recommendation({ moq: null, units_to_moq: 0 })],
      }),
    });

    await targetedSurface();

    // It starts at what still needs buying — not the full requirement, and
    // not a fallback of 1.
    const quantity = screen.getByTestId(PURCHASE_QTY) as HTMLInputElement;
    expect(quantity).toHaveValue(5);

    // A merchant who knows better can override it, and the action must honour
    // the override rather than the number it was seeded with.
    fireEvent.change(quantity, { target: { value: '9' } });
    expect(screen.getByTestId(PURCHASE_QTY)).toHaveValue(9);

    fireEvent.click(screen.getByTestId(DOMINANT));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('9')).toBeInTheDocument();
  });
});


// ── OUTCOME-INV-UI-01..05 — reorder provenance for inventory attribution ────
//
// OUTCOME-INV-01 pilot. A queued reorder becomes a durable INTERVENTION only
// when the server can attribute it to an exact active inventory/oversell
// constraint. That requires the originating order to travel with the write.
//
// This is PROVENANCE ONLY. Queueing intent buys nothing, receives nothing and
// makes nothing pickable — these contracts assert no prevention, no revenue and
// no resolution, and none may be inferred from them.
//
// The originating order used for the payload is the SERVER-VALIDATED
// `originating_order_id` from the targeted sourcing response, never the raw URL
// value: the server checks it against that variant's canonical blocking orders
// and returns null when it does not belong.

const QUEUE_SUPPLIER = recommendation({ moq: 10, units_to_moq: 4 });

/** Below-MOQ state, where "Add to queue" is the dominant action. */
function queueableResult(overrides: Partial<SourcingResult> = {}): SourcingResult {
  return sourcingResult({
    recommendations: [QUEUE_SUPPLIER],
    queue_qty: 10,
    ...overrides,
  });
}

describe('OUTCOME-INV-UI — targeted reorder carries attribution provenance', () => {
  it('OUTCOME-INV-UI-01: Add to queue carries the server-validated originating order', async () => {
    const { onCreateReorderRequest } = renderTargeted({ result: queueableResult() });

    await targetedSurface();
    fireEvent.click(screen.getByTestId(DOMINANT));

    await waitFor(() => expect(onCreateReorderRequest).toHaveBeenCalledTimes(1));
    expect(onCreateReorderRequest.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        lasyncro_variant_id: TARGET_VARIANT_ID,
        supplier_id: SUPPLIER_ID,
        originating_order_id: ORIGINATING_ORDER_ID,
      })
    );
  });

  it('OUTCOME-INV-UI-02: advisory shown treatment provenance is carried explicitly when present', async () => {
    const { onCreateReorderRequest } = renderTargeted({
      result: queueableResult(),
      treatmentKey: 'source_remaining',
    });

    await targetedSurface();
    fireEvent.click(screen.getByTestId(DOMINANT));

    await waitFor(() => expect(onCreateReorderRequest).toHaveBeenCalledTimes(1));
    expect(onCreateReorderRequest.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        originating_order_id: ORIGINATING_ORDER_ID,
        shown_treatment_key: 'source_remaining',
      })
    );
  });

  it('OUTCOME-INV-UI-03: a server that refuses the originating order yields no attribution claim', async () => {
    // The deep link asserts an order, but the server did not validate it
    // against this variant's blocking orders. The client must defer to the
    // server, not to its own URL.
    const { onCreateReorderRequest } = renderTargeted({
      result: queueableResult({ originating_order_id: null, blocking_orders: [] }),
    });

    await targetedSurface();
    fireEvent.click(screen.getByTestId(DOMINANT));

    await waitFor(() => expect(onCreateReorderRequest).toHaveBeenCalledTimes(1));
    const payload = onCreateReorderRequest.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.originating_order_id ?? null).toBeNull();
    // The purchasing write itself is still perfectly valid.
    expect(payload).toEqual(
      expect.objectContaining({ lasyncro_variant_id: TARGET_VARIANT_ID, supplier_id: SUPPLIER_ID })
    );
  });

  it('OUTCOME-INV-UI-04: generic sourcing carries no originating order', async () => {
    const { onCreateReorderRequest } = renderTargeted({
      result: queueableResult({ originating_order_id: null, blocking_orders: [] }),
      orderId: null,
    });

    await targetedSurface();
    fireEvent.click(screen.getByTestId(DOMINANT));

    await waitFor(() => expect(onCreateReorderRequest).toHaveBeenCalledTimes(1));
    const payload = onCreateReorderRequest.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.originating_order_id ?? null).toBeNull();
  });

  it('OUTCOME-INV-UI-05: merely opening targeted Sourcing writes nothing', async () => {
    const { onCreateReorderRequest } = renderTargeted({
      result: queueableResult(),
      treatmentKey: 'source_remaining',
    });

    await targetedSurface();

    // Evidence and a recommendation are on screen. Nothing has been bought,
    // queued or committed — Add to queue remains the sole write.
    expect(screen.getByTestId(DOMINANT)).toBeInTheDocument();
    expect(onCreateReorderRequest).not.toHaveBeenCalled();
  });
});
