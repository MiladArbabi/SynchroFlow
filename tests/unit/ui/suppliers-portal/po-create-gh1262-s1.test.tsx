import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import SuppliersPortalModuleFT2, {
  type SourcingResult,
} from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

/**
 * GH-1262 S1 R10 — Create PO frontend behaviour (RED regression)
 * --------------------------------------------------------------
 * Drives the real CreatePoDialog through the targeted Sourcing hand-off, which
 * seeds a canonical variant line (SRC-ACT-UI-07 proves the seeding is shown;
 * these cases prove what is SUBMITTED and what survives a failure).
 *
 *   S1-R10-01  Sourcing prefill submits the canonical variant and quantity
 *   S1-R10-02  a failed submit preserves the merchant's input
 *   S1-R10-03  a new supplier goes through the single atomic create-PO call
 *   S1-R10-04  a second click while submitting does not submit twice
 *   S1-R10-05  an unchanged retry after failure reuses the operation key
 *   S1-R10-06  a changed request (after a rejected fractional quantity) gets a new key
 *   S1-R10-07  a new logical operation after success gets a new key
 *   S1-R10-10  a selected variant's known zero cost stays a known zero (C1)
 *   S1-R10-11  changing variant never carries the previous variant's cost (C1)
 *   S1-R10-12  out-of-range / malformed unit costs never reach the payload (C2)
 *   S1-R10-13  inline-supplier MOQ / lead time must be whole PG integers (C2)
 *
 * `new_supplier` is the ratified E1 field for inline supplier details
 * (supplier_id XOR new_supplier).
 *
 * Key ownership is ratified (R10-B): CreatePoDialog owns the operation key
 * and hands it to onCreatePo as `{ idempotencyKey }`; the page sends it as
 * the Idempotency-Key header (SuppliersPortalPage.po-create-gh1262-s1.test.tsx).
 * Key lifecycle is observed through that callback argument only.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function keyOf(mock: jest.Mock, call: number): string {
  return mock.mock.calls[call][1].idempotencyKey;
}

function rejection(message: string) {
  return { response: { data: { error: message } } };
}

jest.mock('@lasyncro/shared/ui', () => {
  const React = require('react');

  return {
    ModuleErrorBoundary: ({ children }: any) =>
      React.createElement(React.Fragment, {}, children),
    ModuleLoadingSkeleton: () => React.createElement('div', { 'data-testid': 'skeleton' }),
    SpotlightCoachMark: ({ title }: any) => React.createElement('div', {}, title),
    // Rendered (not nulled) so the real Create PO form and its footer CTA exist.
    EntityDetailModal: ({ entityId, title, children, footerActions }: any) =>
      entityId
        ? React.createElement(
            'div',
            { role: 'dialog', 'aria-label': title },
            children,
            footerActions,
          )
        : null,
    PulseCard: ({ title }: any) =>
      React.createElement('section', { 'data-testid': 'pulse-card' }, title),
  };
});

const TARGET_VARIANT_ID = 'variant-gh1262-s1';
const SUPPLIER_ID = 7;
const SUPPLIER_NAME = 'Preferred Mills Ltd';
const DOMINANT = 'sourcing-primary-action';

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

/** A targeted variant with 5 units still to source and a PO-ready supplier. */
const SOURCING_RESULT = {
  recommendations: [
    {
      id: SUPPLIER_ID,
      name: SUPPLIER_NAME,
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
    },
  ],
  image_url: null,
  product_title: 'S1 Canonical Product',
  variant_title: 'S1 Canonical Variant',
  sku: 'S1-CANON-001',
  open_demand: 5,
  available: 0,
  committed_inbound: 0,
  short_now: 5,
  still_to_source: 5,
  in_purchasing: 0,
  unplanned: 5,
  pending_queue_qty: 0,
  draft_po_qty: 0,
  blocking_orders: [],
  originating_order_id: null,
  shortfall: 5,
  shortfall_basis: { demand: 5, available: 0 },
  queue_qty: 5,
  quantity_basis: 'reactive',
  suggested_reorder_qty: null,
  planning_context: null,
} as unknown as SourcingResult;

function renderSourcing({
  onCreatePo = jest.fn().mockResolvedValue(undefined),
  onCreateSupplier = jest.fn(),
  onSearchVariants = jest.fn().mockResolvedValue([]),
}: { onCreatePo?: jest.Mock; onCreateSupplier?: jest.Mock; onSearchVariants?: jest.Mock } = {}) {
  render(
    <MemoryRouter
      initialEntries={[`/suppliers-portal/sourcing?variantId=${encodeURIComponent(TARGET_VARIANT_ID)}`]}
    >
      <SuppliersPortalModuleFT2
        view="sourcing"
        data={{
          purchase_orders: [],
          suppliers: [ACTIVE_SUPPLIER],
          never_ordered: [],
          never_ordered_count: 0,
        }}
        isLoading={false}
        isError={false}
        onRefresh={jest.fn()}
        onFetchLineItems={jest.fn().mockResolvedValue([])}
        onUpdatePoStatus={jest.fn().mockResolvedValue(undefined)}
        onCreateSupplier={onCreateSupplier}
        onUpdateSupplier={jest.fn()}
        onDeleteSupplier={jest.fn().mockResolvedValue(undefined)}
        onCreatePo={onCreatePo}
        onCreateReceiveJob={jest.fn()}
        onSearchVariants={onSearchVariants}
        onFetchSourcingRecommendations={jest.fn(() => Promise.resolve(SOURCING_RESULT))}
        onFetchPreferences={jest.fn().mockResolvedValue([])}
        onCreatePreference={jest.fn()}
        onUpdatePreference={jest.fn()}
        onDeletePreference={jest.fn().mockResolvedValue(undefined)}
        onFetchReorderRequests={jest.fn().mockResolvedValue([])}
        onCreateReorderRequest={jest.fn(() => Promise.resolve({} as never))}
        onDeleteReorderRequest={jest.fn().mockResolvedValue(undefined)}
        onConvertReorderRequests={jest.fn()}
      />
    </MemoryRouter>
  );

  return { onCreatePo, onCreateSupplier };
}

/** Opens the Create PO dialog from the targeted Sourcing dominant action. */
async function openPrefilledDialog() {
  await screen.findByTestId('sourcing-identity');
  fireEvent.click(screen.getByTestId(DOMINANT));
  return screen.findByRole('dialog', { name: /new purchase order/i });
}

function createPoButton(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: /create po|creating/i });
}

describe('GH-1262 S1 R10 — Create PO frontend behaviour', () => {
  it('S1-R10-01: Sourcing prefill submits the canonical variant and the sourced quantity', async () => {
    const { onCreatePo } = renderSourcing();
    const dialog = await openPrefilledDialog();

    fireEvent.click(createPoButton(dialog));

    await waitFor(() => expect(onCreatePo).toHaveBeenCalledTimes(1));
    const input = onCreatePo.mock.calls[0][0];
    expect(input.supplier_id).toBe(SUPPLIER_ID);
    expect(input.line_items).toEqual([
      expect.objectContaining({ lasyncro_variant_id: TARGET_VARIANT_ID, quantity_ordered: 5 }),
    ]);
  });

  it('S1-R10-02: a failed submit keeps the dialog open with the merchant input intact', async () => {
    const onCreatePo = jest
      .fn()
      .mockRejectedValue({ response: { data: { error: 'Variant is not eligible for a new PO' } } });
    renderSourcing({ onCreatePo });
    const dialog = await openPrefilledDialog();

    fireEvent.change(within(dialog).getByLabelText(/expected delivery date/i), {
      target: { value: '2026-11-30' },
    });
    fireEvent.click(createPoButton(dialog));

    expect(await within(dialog).findByText(/not eligible for a new po/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /new purchase order/i })).toBe(dialog);
    expect(within(dialog).getByDisplayValue('5')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('2026-11-30')).toBeInTheDocument();
    expect(createPoButton(dialog)).not.toBeDisabled();
  });

  it('S1-R10-03: a new supplier is submitted with the PO in one atomic create call', async () => {
    const onCreateSupplier = jest.fn().mockResolvedValue({ id: 9001 });
    const { onCreatePo } = renderSourcing({ onCreateSupplier });
    const dialog = await openPrefilledDialog();

    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /supplier/i }));
    fireEvent.click(await screen.findByRole('option', { name: /add new supplier/i }));
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: 'Inline Supplier Co' } });
    fireEvent.click(createPoButton(dialog));

    await waitFor(() => expect(onCreatePo).toHaveBeenCalledTimes(1));
    // A separate supplier write first is exactly what leaves an orphan
    // supplier behind when the PO then fails.
    expect(onCreateSupplier).not.toHaveBeenCalled();
    const input = onCreatePo.mock.calls[0][0];
    expect(input.new_supplier).toEqual(expect.objectContaining({ name: 'Inline Supplier Co' }));
    expect(input.supplier_id).toBeUndefined();
  });

  it('S1-R10-04: a second click while the PO is being created does not submit again', async () => {
    let resolveCreate: () => void = () => undefined;
    const onCreatePo = jest.fn(
      () => new Promise<void>((resolve) => { resolveCreate = resolve; }),
    );
    renderSourcing({ onCreatePo });
    const dialog = await openPrefilledDialog();

    const button = createPoButton(dialog);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(onCreatePo).toHaveBeenCalledTimes(1));
    resolveCreate();
    await waitFor(() => expect(onCreatePo).toHaveBeenCalledTimes(1));
  });

  it('S1-R10-05: an unchanged retry after a failure reuses the same operation key', async () => {
    const onCreatePo = jest
      .fn()
      .mockRejectedValueOnce(rejection('Temporarily unavailable'))
      .mockResolvedValueOnce(undefined);
    renderSourcing({ onCreatePo });
    const dialog = await openPrefilledDialog();

    fireEvent.click(createPoButton(dialog));
    await within(dialog).findByText(/temporarily unavailable/i);
    fireEvent.click(createPoButton(dialog));

    await waitFor(() => expect(onCreatePo).toHaveBeenCalledTimes(2));
    expect(keyOf(onCreatePo, 0)).toMatch(UUID_V4);
    expect(keyOf(onCreatePo, 1)).toBe(keyOf(onCreatePo, 0));
    expect(onCreatePo.mock.calls[1][0]).toEqual(onCreatePo.mock.calls[0][0]);
  });

  it('S1-R10-06: a changed request gets a new key; a fractional quantity is never submitted', async () => {
    const onCreatePo = jest
      .fn()
      .mockRejectedValueOnce(rejection('Temporarily unavailable'))
      .mockResolvedValueOnce(undefined);
    renderSourcing({ onCreatePo });
    const dialog = await openPrefilledDialog();

    fireEvent.click(createPoButton(dialog));
    await within(dialog).findByText(/temporarily unavailable/i);

    const quantity = within(dialog).getByDisplayValue('5');
    fireEvent.change(quantity, { target: { value: '1.5' } });
    fireEvent.click(createPoButton(dialog));
    expect(await within(dialog).findByText(/whole-number quantity/i)).toBeInTheDocument();
    expect(onCreatePo).toHaveBeenCalledTimes(1);

    fireEvent.change(quantity, { target: { value: '6' } });
    fireEvent.click(createPoButton(dialog));

    await waitFor(() => expect(onCreatePo).toHaveBeenCalledTimes(2));
    expect(onCreatePo.mock.calls[1][0].line_items).toEqual([
      expect.objectContaining({ lasyncro_variant_id: TARGET_VARIANT_ID, quantity_ordered: 6 }),
    ]);
    expect(keyOf(onCreatePo, 1)).toMatch(UUID_V4);
    expect(keyOf(onCreatePo, 1)).not.toBe(keyOf(onCreatePo, 0));
  });

  it('S1-R10-07: a new logical operation after a confirmed success gets a new key', async () => {
    const onCreatePo = jest.fn().mockResolvedValue(undefined);
    renderSourcing({ onCreatePo });

    const first = await openPrefilledDialog();
    fireEvent.click(createPoButton(first));
    await waitFor(() => expect(onCreatePo).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /new purchase order/i })).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(DOMINANT));
    const second = await screen.findByRole('dialog', { name: /new purchase order/i });
    fireEvent.click(createPoButton(second));

    await waitFor(() => expect(onCreatePo).toHaveBeenCalledTimes(2));
    expect(keyOf(onCreatePo, 1)).toMatch(UUID_V4);
    expect(keyOf(onCreatePo, 1)).not.toBe(keyOf(onCreatePo, 0));
  });

  // ── C1 / C2 — cost and numeric safety ────────────────────────────────────

  const ZERO_COST_VARIANT = {
    lasyncro_variant_id: 'variant-zero-cost',
    sku: 'ZERO-001',
    title: 'Default Title',
    unit_cost: 0,
    image_url: null,
    product_title: 'Free Sample Product',
  };
  const COSTED_VARIANT = {
    lasyncro_variant_id: 'variant-costed',
    sku: 'COST-001',
    title: 'Default Title',
    unit_cost: 12.5,
    image_url: null,
    product_title: 'Costed Product',
  };
  const UNKNOWN_COST_VARIANT = {
    lasyncro_variant_id: 'variant-unknown-cost',
    sku: 'UNKNOWN-001',
    title: 'Default Title',
    unit_cost: null,
    image_url: null,
    product_title: 'Unknown Cost Product',
  };

  /** Adds a second line and links it to `option` through the real search dropdown. */
  async function selectVariantOnNewLine(dialog: HTMLElement, option: { product_title: string }) {
    fireEvent.click(within(dialog).getByRole('button', { name: /add line item/i }));
    fireEvent.change(within(dialog).getByLabelText(/product \/ sku/i), { target: { value: 'sku' } });
    fireEvent.click(await within(dialog).findByText(option.product_title));
    fireEvent.change(within(dialog).getAllByLabelText(/qty/i)[1], { target: { value: '2' } });
  }

  function secondLineCost(dialog: HTMLElement) {
    return within(dialog).getAllByLabelText(/unit cost/i)[1] as HTMLInputElement;
  }

  it('S1-R10-10: a selected variant with a known zero cost submits an explicit zero', async () => {
    const onCreatePo = jest.fn().mockResolvedValue(undefined);
    const onSearchVariants = jest.fn().mockResolvedValue([ZERO_COST_VARIANT]);
    renderSourcing({ onCreatePo, onSearchVariants });
    const dialog = await openPrefilledDialog();

    await selectVariantOnNewLine(dialog, ZERO_COST_VARIANT);
    expect(secondLineCost(dialog).value).toBe('0');
    fireEvent.click(createPoButton(dialog));

    await waitFor(() => expect(onCreatePo).toHaveBeenCalledTimes(1));
    const [prefilled, zero] = onCreatePo.mock.calls[0][0].line_items;
    expect(prefilled.unit_cost_cents).toBeUndefined();
    expect(zero).toEqual(expect.objectContaining({ lasyncro_variant_id: 'variant-zero-cost', unit_cost_cents: 0 }));
  });

  it("S1-R10-11: re-selecting a variant replaces the previous variant's cost; unknown stays unknown", async () => {
    const onCreatePo = jest.fn().mockResolvedValue(undefined);
    const onSearchVariants = jest.fn().mockResolvedValue([COSTED_VARIANT, UNKNOWN_COST_VARIANT]);
    renderSourcing({ onCreatePo, onSearchVariants });
    const dialog = await openPrefilledDialog();

    await selectVariantOnNewLine(dialog, COSTED_VARIANT);
    expect(secondLineCost(dialog).value).toBe('12.5');

    // Unlink the costed variant (the linked row's clear control), then pick another.
    const linkedRow = within(dialog).getByText('Costed Product').parentElement!.parentElement!;
    fireEvent.click(within(linkedRow).getByRole('button'));
    fireEvent.change(within(dialog).getByLabelText(/product \/ sku/i), { target: { value: 'sku' } });
    fireEvent.click(await within(dialog).findByText('Unknown Cost Product'));

    expect(secondLineCost(dialog).value).toBe('');
    fireEvent.click(createPoButton(dialog));

    await waitFor(() => expect(onCreatePo).toHaveBeenCalledTimes(1));
    const line = onCreatePo.mock.calls[0][0].line_items[1];
    expect(line.lasyncro_variant_id).toBe('variant-unknown-cost');
    expect(line.unit_cost_cents).toBeUndefined();
  });

  it.each([
    ['a lone decimal point', '.'],
    ['an unsafe integer amount', '99999999999999999999'],
    ['an amount beyond the cents column', '21474836.48'],
  ])('S1-R10-12: %s as unit cost is rejected before any create call', async (_label, cost) => {
    const onCreatePo = jest.fn().mockResolvedValue(undefined);
    renderSourcing({ onCreatePo });
    const dialog = await openPrefilledDialog();

    fireEvent.change(within(dialog).getByLabelText(/unit cost/i), { target: { value: cost } });
    fireEvent.click(createPoButton(dialog));

    expect(await within(dialog).findByText(/unit cost must be/i)).toBeInTheDocument();
    expect(onCreatePo).not.toHaveBeenCalled();
  });

  async function openInlineSupplier(dialog: HTMLElement) {
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /supplier/i }));
    fireEvent.click(await screen.findByRole('option', { name: /add new supplier/i }));
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: 'Inline Supplier Co' } });
  }

  it.each([
    ['a fractional MOQ', /min order qty/i, '2.5', /moq must be/i],
    ['an exponent lead time', /lead time/i, '1e3', /lead time must be/i],
    ['an out-of-range lead time', /lead time/i, '99999999999', /lead time must be/i],
  ])('S1-R10-13: %s is rejected before any create call', async (_label, field, value, message) => {
    const onCreatePo = jest.fn().mockResolvedValue(undefined);
    renderSourcing({ onCreatePo });
    const dialog = await openPrefilledDialog();

    await openInlineSupplier(dialog);
    fireEvent.change(within(dialog).getByLabelText(field), { target: { value } });
    fireEvent.click(createPoButton(dialog));

    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(onCreatePo).not.toHaveBeenCalled();
  });

  it('S1-R10-13: a blank MOQ stays unknown and a whole lead time is sent as an integer', async () => {
    const onCreatePo = jest.fn().mockResolvedValue(undefined);
    renderSourcing({ onCreatePo });
    const dialog = await openPrefilledDialog();

    await openInlineSupplier(dialog);
    fireEvent.change(within(dialog).getByLabelText(/lead time/i), { target: { value: '14' } });
    fireEvent.click(createPoButton(dialog));

    await waitFor(() => expect(onCreatePo).toHaveBeenCalledTimes(1));
    const { new_supplier } = onCreatePo.mock.calls[0][0];
    expect(new_supplier.lead_time_days).toBe(14);
    expect(new_supplier.moq).toBeUndefined();
  });
});
