import React, { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';

const mockNavigate = jest.fn();
const mockExecute = jest.fn();
const mockUseOrderDecision = jest.fn();

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

jest.mock('pages/orders/useOrderDecision', () => ({
  useOrderDecision: (...args: unknown[]) => mockUseOrderDecision(...args),
  useExecuteOrderDecision: () => ({
    mutate: mockExecute,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}));

const mockUseOrderDetail = jest.fn();

jest.mock('pages/orders/useOrderDetail', () => ({
  useOrderDetail: (...args: unknown[]) => mockUseOrderDetail(...args),
}));

jest.mock('pages/orders/usePickExceptionsForOrder', () => ({
  usePickExceptionsForOrder: () => ({
    data: { exceptions: [] },
  }),
  useResolvePickException: () => ({}),
}));

jest.mock('pages/problem-center/usePackDecisions', () => ({
  useOrderPackDecisions: () => ({
    data: { requests: [] },
    isLoading: false,
  }),
}));

jest.mock('pages/orders/useShippingAddress', () => ({
  useUpdateShippingAddress: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));

jest.mock('hooks/useCurrency', () => ({
  useCurrency: () => ({
    format: (value: number | null | undefined) =>
      value == null ? '—' : `$${Number(value).toLocaleString('en-US')}`,
  }),
}));

type Constraint = {
  constraint_type: string;
  block_type: string | null;
  target_id: string | null;
  target_status: string | null;
  started_at: string;
};

function inventoryConstraint(targetId: string): Constraint {
  return {
    constraint_type: 'inventory',
    block_type: 'oversell',
    target_id: targetId,
    target_status: null,
    started_at: '2026-09-02T12:00:00.000Z',
  };
}

function decisionResponse(constraints: Constraint[]) {
  return {
    decision: {
      id: 'decision-inventory',
      type: 'inventory',
      entity_id: 'order-1',
      status: 'pending',
      priority: 80,
      reason: 'Inventory shortage',
      recommended_action: {
        // INV-ACTION-ARCH-01: new inventory decisions are workflow navigation.
        type: 'open_sourcing',
        payload: {},
        execution_mode: 'manual',
      },
      actions: [],
      lifecycle: null,
      created_at: '2026-09-02T12:00:00.000Z',
      updated_at: '2026-09-02T12:00:00.000Z',
    },
    constraints,
  };
}

const noop = () => {};

function ModalHost({ queryClient }: { queryClient: QueryClient }) {
  const [footer, setFooter] = useState<ReactNode>(null);
  const handleFooterReady = useCallback((node: ReactNode) => setFooter(node), []);

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <div data-testid="modal-body">
          <OrderDetailModalBody
            orderId="order-1"
            onTitleReady={noop}
            onSubtitleReady={noop}
            onNavigateToOrder={noop}
            onFooterReady={handleFooterReady}
            onClose={noop}
          />
        </div>
        <div data-testid="modal-footer">{footer}</div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<ModalHost queryClient={queryClient} />);
}

/**
 * SRC-L3-11A (SOURCING-UX-COGNITIVE-01 Slice 1A)
 * ----------------------------------------------
 * Every inventory-sourcing CTA must carry BOTH the canonical variant and the
 * canonical order the merchant came from. `order-1` is the internal
 * orders.lasyncro_order_id already supplied to this component — never an
 * external Shopify id or a display order number.
 */
describe('OrderDetailModalBody inventory sourcing contract — ORD-DECISION-01 Slice 2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Existing INV-RED-* / INV-ACTION-* contracts assume no order-detail payload.
    mockUseOrderDetail.mockReturnValue({ data: null, isLoading: false });
  });

  it('INV-RED-06 routes an active stockout to Sourcing instead of executing the decision', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([inventoryConstraint('variant-a')]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.getByText(/Out of stock/i)).toBeInTheDocument();

    const sourceButton = screen.getByRole('button', {
      name: 'Source this item',
    });

    fireEvent.click(sourceButton);

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-a&orderId=order-1'
    );
  });

  it('INV-RED-07 derives the Sourcing variant from active constraint target_id, not the stored decision payload', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([inventoryConstraint('exact-blocked-variant')]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Source this item',
      })
    );

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      '/suppliers-portal/sourcing?variantId=exact-blocked-variant&orderId=order-1'
    );
  });

  /**
   * INV-ACTION-ARCH-01 — the generic execute fallback previously labelled
   * `resolve_inventory_block` as "Go to sourcing" while running
   * execute(orderId), which reached a machine handler that could not resolve a
   * real stockout. `open_sourcing` must never reach that fallback.
   */
  it('INV-ACTION-07 never renders a generic execute CTA for open_sourcing', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([inventoryConstraint('variant-1')]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    // The misleading generic label is gone entirely.
    expect(screen.queryByRole('button', { name: 'Go to sourcing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take action' })).not.toBeInTheDocument();

    // Constraint-driven routing remains the only inventory CTA.
    fireEvent.click(screen.getByRole('button', { name: 'Source this item' }));
    expect(mockExecute).not.toHaveBeenCalled();
  });

  /**
   * The real fall-through: an inventory constraint with no usable target_id
   * yields no sourcing target, so the elected `open_sourcing` decision reaches
   * the GENERIC execute branch — a "Take action" button wired to
   * execute(orderId). `open_sourcing` is workflow navigation with no execution
   * handler, so that button would POST an action the backend must refuse.
   * It must not be offered at all.
   */
  it('INV-ACTION-07 never offers generic execution for open_sourcing when no sourcing target exists', () => {
    const untargetedInventoryConstraint: Constraint = {
      constraint_type: 'inventory',
      block_type: 'oversell',
      target_id: null,
      target_status: null,
      started_at: '2026-09-02T12:00:00.000Z',
    };

    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([untargetedInventoryConstraint]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.queryByRole('button', { name: 'Take action' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to sourcing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Source this item' })).not.toBeInTheDocument();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('INV-RED-08 keeps multiple blocked variants independently actionable', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([
        inventoryConstraint('variant-a'),
        inventoryConstraint('variant-b'),
      ]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    const sourceButtons = screen.getAllByRole('button', {
      name: /Source (this )?item/i,
    });

    expect(sourceButtons).toHaveLength(2);

    fireEvent.click(sourceButtons[0]);
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-a&orderId=order-1'
    );

    fireEvent.click(sourceButtons[1]);
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-b&orderId=order-1'
    );

    expect(mockExecute).not.toHaveBeenCalled();
  });
});

/**
 * INV-TREAT-01 — INVENTORY TREATMENT ASSIST UI CONTRACT (RED)
 * -----------------------------------------------------------
 * Backend counterpart:
 *   tests/integration/orders/inventory-treatment-assist-contract.test.ts
 *
 * LOCKED RANKING CONTRACT
 *   rank=1 is BEST, treatments are ordered ascending, and treatments[0] is the
 *   single primary recommendation. Everything else is compact context, never a
 *   competing equal-weight CTA.
 *
 * LOCKED SAFETY CONTRACT
 *   No execute(orderId) for any inventory treatment, no automatic purchase, no
 *   stock movement, no constraint clearing. `open_sourcing` stays navigation
 *   only and reuses the EXISTING supported route/query pattern already proven
 *   by INV-RED-06/07/08 above:
 *     /suppliers-portal/sourcing?variantId=<id>&orderId=<orderId>
 *
 * TEST HOOKS (part of the UI contract, so these tests assert behaviour rather
 * than MUI structure or styling):
 *   data-testid="inv-assist-item-<variantId>"       one region per assist item
 *   data-testid="inv-assist-need-<variantId>"       blockerEvidence.orderRemainingQty
 *   data-testid="inv-assist-available-<variantId>"  blockerEvidence.pickableAvailableQty
 *   data-testid="inv-assist-short-<variantId>"      blockerEvidence.shortageQty
 *
 * COMPACTNESS
 *   Item regions are asserted to carry exactly ONE button, which is both the
 *   CTA-hierarchy contract and what keeps this surface from growing the modal
 *   (GH-1053 is out of scope and must stay that way).
 */

type Treatment = {
  type:
    | 'wait_for_inbound'
    | 'continue_purchasing'
    | 'source_remaining'
    | 'find_supplier'
    | 'investigate_inventory';
  rank: number;
  quantity: number | null;
  reason: string;
  automationLevel: 'inform' | 'assist';
  action: { type: 'open_sourcing'; variantId: string; orderId: string } | null;
};

type AssistItem = {
  variantId: string;
  identity: {
    productTitle: string | null;
    variantTitle: string | null;
    sku: string | null;
    imageUrl: string | null;
  };
  blockerEvidence: {
    orderRemainingQty: number;
    pickableAvailableQty: number;
    shortageQty: number;
  };
  purchasingEvidence: {
    variantOpenDemandQty: number;
    committedInboundQty: number;
    pendingQueueQty: number;
    draftPoQty: number;
    supplierOptionCount: number;
  };
  treatments: Treatment[];
};

const openSourcingAction = (variantId: string) => ({
  type: 'open_sourcing' as const,
  variantId,
  orderId: 'order-1',
});

/** Builds one assist item; every field is overridable per contract. */
function assistItem(overrides: {
  variantId: string;
  identity?: Partial<AssistItem['identity']>;
  blockerEvidence?: Partial<AssistItem['blockerEvidence']>;
  purchasingEvidence?: Partial<AssistItem['purchasingEvidence']>;
  treatments: Treatment[];
}): AssistItem {
  return {
    variantId: overrides.variantId,
    identity: {
      productTitle: 'Merino Crew Sweater',
      variantTitle: 'Charcoal / M',
      sku: 'MER-CRW-CHR-M',
      imageUrl: null,
      ...overrides.identity,
    },
    blockerEvidence: {
      orderRemainingQty: 6,
      pickableAvailableQty: 2,
      shortageQty: 4,
      ...overrides.blockerEvidence,
    },
    purchasingEvidence: {
      variantOpenDemandQty: 6,
      committedInboundQty: 0,
      pendingQueueQty: 0,
      draftPoQty: 0,
      supplierOptionCount: 0,
      ...overrides.purchasingEvidence,
    },
    treatments: overrides.treatments,
  };
}

/**
 * Minimal-but-complete Order Detail payload. Line items, totals and timeline
 * are deliberately empty so nothing outside the assist surface can supply the
 * numbers these tests assert.
 */
function orderDetail(inventoryAssist: { generatedAt: string; items: AssistItem[] } | null) {
  return {
    id: 'order-1',
    externalOrderId: '1001',
    total: 0,
    subtotal: 0,
    tax: 0,
    currency: 'USD',
    paymentState: 'paid',
    createdAt: '2026-09-02T12:00:00.000Z',
    lineItems: [],
    fulfillment: null,
    warehouseStatus: null,
    timeline: [],
    tracking: null,
    shipping: {
      name: null,
      address1: null,
      address2: null,
      city: null,
      zip: null,
      phone: null,
      province: null,
      countryCode: null,
    },
    addressAssist: null,
    inventoryAssist,
  };
}

function setOrderDetail(inventoryAssist: { generatedAt: string; items: AssistItem[] } | null) {
  mockUseOrderDetail.mockReturnValue({
    data: orderDetail(inventoryAssist),
    isLoading: false,
  });
}

const assistOf = (items: AssistItem[]) => ({
  generatedAt: '2026-09-07T12:00:00.000Z',
  items,
});

const itemRegion = (variantId: string) =>
  screen.getByTestId(`inv-assist-item-${variantId}`);

const footerRegion = () => screen.getByTestId('modal-footer');

function footerCta(name: string | RegExp) {
  const button = within(footerRegion()).getByRole('button', { name });
  expect(button).toBeEnabled();
  return button;
}

describe('OrderDetailModalBody inventory treatment assist — INV-TREAT-01', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([inventoryConstraint('variant-a')]),
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it('INV-TREAT-UI-01 renders item identity and compact Need / Available / Short evidence from blockerEvidence', () => {
    setOrderDetail(
      assistOf([
        assistItem({
          variantId: 'variant-a',
          blockerEvidence: { orderRemainingQty: 6, pickableAvailableQty: 2, shortageQty: 4 },
          // Catalogue-wide demand is deliberately DIFFERENT from this order's
          // remaining demand — substituting it would be a truthfulness defect.
          purchasingEvidence: { variantOpenDemandQty: 14 },
          treatments: [
            {
              type: 'find_supplier',
              rank: 1,
              quantity: 4,
              reason: 'No supplier is set up for this variant yet.',
              automationLevel: 'inform',
              action: openSourcingAction('variant-a'),
            },
          ],
        }),
      ])
    );

    renderModal();

    const region = itemRegion('variant-a');

    expect(region).toHaveTextContent(/Merino Crew Sweater/);
    expect(region).toHaveTextContent(/Charcoal \/ M/);
    expect(region).toHaveTextContent(/MER-CRW-CHR-M/);

    expect(region).toHaveTextContent(/Need\s*6/i);
    expect(region).toHaveTextContent(/Available\s*2/i);
    expect(region).toHaveTextContent(/Short\s*4/i);

    // Need is THIS order's remaining demand — never the catalogue-wide figure.
    expect(screen.getByTestId('inv-assist-need-variant-a')).toHaveTextContent('6');
    expect(screen.getByTestId('inv-assist-need-variant-a')).not.toHaveTextContent('14');
    expect(screen.getByTestId('inv-assist-available-variant-a')).toHaveTextContent('2');
    expect(screen.getByTestId('inv-assist-short-variant-a')).toHaveTextContent('4');
  });

  it('INV-TREAT-UI-02 presents wait_for_inbound as "Review incoming stock" with committed-inbound context', () => {
    setOrderDetail(
      assistOf([
        assistItem({
          variantId: 'variant-a',
          purchasingEvidence: { committedInboundQty: 4, supplierOptionCount: 1 },
          treatments: [
            {
              type: 'wait_for_inbound',
              rank: 1,
              quantity: 4,
              reason: '4 units are already on the way.',
              automationLevel: 'assist',
              action: openSourcingAction('variant-a'),
            },
          ],
        }),
      ])
    );

    renderModal();

    const region = itemRegion('variant-a');

    expect(
      within(footerRegion()).getByText(/4 committed inbound/i)
    ).toBeInTheDocument();

    expect(screen.getByTestId('inv-assist-available-variant-a')).toHaveTextContent('2');

    const cta = footerCta(/Review incoming stock/i);

    fireEvent.click(cta);

    expect(mockNavigate).toHaveBeenCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-a&orderId=order-1'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('INV-TREAT-UI-03 presents continue_purchasing with queue/draft context that is never counted as available stock', () => {
    setOrderDetail(
      assistOf([
        assistItem({
          variantId: 'variant-a',
          blockerEvidence: { orderRemainingQty: 10, pickableAvailableQty: 2, shortageQty: 8 },
          purchasingEvidence: {
            variantOpenDemandQty: 10,
            committedInboundQty: 3,
            pendingQueueQty: 5,
            draftPoQty: 2,
            supplierOptionCount: 1,
          },
          treatments: [
            {
              type: 'continue_purchasing',
              rank: 1,
              quantity: 5,
              reason: 'Purchasing work for this variant is already in progress.',
              automationLevel: 'assist',
              action: openSourcingAction('variant-a'),
            },
          ],
        }),
      ])
    );

    renderModal();

    const region = itemRegion('variant-a');

    expect(within(footerRegion()).getByText(/5 queued/i)).toBeInTheDocument();
    expect(within(footerRegion()).getByText(/2 in draft/i)).toBeInTheDocument();

    expect(screen.getByTestId('inv-assist-available-variant-a')).toHaveTextContent('2');
    expect(screen.getByTestId('inv-assist-short-variant-a')).toHaveTextContent('8');

    const cta = footerCta(/Continue purchasing/i);

    fireEvent.click(cta);

    expect(mockNavigate).toHaveBeenCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-a&orderId=order-1'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('INV-TREAT-UI-04 presents source_remaining as "Source 7 units" using the treatment quantity', () => {
    setOrderDetail(
      assistOf([
        assistItem({
          variantId: 'variant-a',
          blockerEvidence: { orderRemainingQty: 9, pickableAvailableQty: 2, shortageQty: 7 },
          purchasingEvidence: { variantOpenDemandQty: 9, supplierOptionCount: 2 },
          treatments: [
            {
              type: 'source_remaining',
              rank: 1,
              quantity: 7,
              reason: '7 units are not covered by any inbound or purchasing work.',
              automationLevel: 'assist',
              action: openSourcingAction('variant-a'),
            },
          ],
        }),
      ])
    );

    renderModal();

    expect(footerCta(/Source 7 units/i)).toBeInTheDocument();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('INV-TREAT-UI-05 presents find_supplier as "Find a supplier" when no supplier option exists', () => {
    setOrderDetail(
      assistOf([
        assistItem({
          variantId: 'variant-a',
          purchasingEvidence: { supplierOptionCount: 0 },
          treatments: [
            {
              type: 'find_supplier',
              rank: 1,
              quantity: 4,
              reason: 'No supplier is set up for this variant yet.',
              automationLevel: 'assist',
              action: openSourcingAction('variant-a'),
            },
          ],
        }),
      ])
    );

    renderModal();

    expect(footerCta(/Find a supplier/i)).toBeInTheDocument();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('INV-TREAT-UI-06 presents investigate_inventory as a non-destructive recheck state with no execute mutation', () => {
    setOrderDetail(
      assistOf([
        assistItem({
          variantId: 'variant-a',
          // Fresh evidence contradicts the still-active blocker.
          blockerEvidence: { orderRemainingQty: 3, pickableAvailableQty: 10, shortageQty: 0 },
          purchasingEvidence: { variantOpenDemandQty: 3 },
          treatments: [
            {
              type: 'investigate_inventory',
              rank: 1,
              quantity: null,
              reason: 'Stock now covers this order, but the blocker has not cleared.',
              automationLevel: 'inform',
              action: null,
            },
          ],
        }),
      ])
    );

    renderModal();

    const region = itemRegion('variant-a');

    // A clear investigation/recheck state, stated in the merchant's terms.
    expect(
      within(footerRegion()).getByText(/Recheck inventory/i)
    ).toBeInTheDocument();

    // Fresh evidence is what is shown, not the stale blocker's original numbers.
    expect(screen.getByTestId('inv-assist-available-variant-a')).toHaveTextContent('10');
    expect(screen.getByTestId('inv-assist-short-variant-a')).toHaveTextContent('0');

    // Nothing here may mutate: no execute, and no sourcing CTA for a null action.
    expect(
      within(footerRegion()).queryByRole('button', {
        name: /Recheck inventory|Source/i,
      })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take action' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to sourcing' })).not.toBeInTheDocument();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('INV-TREAT-UI-07 routes an actionable treatment to targeted Sourcing with the exact variant and originating order, never a decision execution', () => {
    setOrderDetail(
      assistOf([
        assistItem({
          variantId: 'exact-blocked-variant',
          purchasingEvidence: { supplierOptionCount: 2 },
          treatments: [
            {
              type: 'source_remaining',
              rank: 1,
              quantity: 4,
              reason: '4 units are still unplanned.',
              automationLevel: 'assist',
              action: {
                type: 'open_sourcing',
                variantId: 'exact-blocked-variant',
                orderId: 'order-1',
              },
            },
          ],
        }),
      ])
    );
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([inventoryConstraint('exact-blocked-variant')]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    fireEvent.click(footerCta(/Source 4 units/i));

    // Existing supported routing/query pattern, unchanged.
    expect(mockNavigate).toHaveBeenCalledWith(
      '/suppliers-portal/sourcing?variantId=exact-blocked-variant&orderId=order-1'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('INV-TREAT-UI-08 renders two assist items independently and keeps each separately actionable', () => {
    setOrderDetail(
      assistOf([
        assistItem({
          variantId: 'variant-a',
          identity: { productTitle: 'Merino Crew Sweater', variantTitle: 'Charcoal / M', sku: 'SKU-A' },
          blockerEvidence: { orderRemainingQty: 6, pickableAvailableQty: 2, shortageQty: 4 },
          purchasingEvidence: { variantOpenDemandQty: 6, supplierOptionCount: 1 },
          treatments: [
            {
              type: 'source_remaining',
              rank: 1,
              quantity: 4,
              reason: '4 units are still unplanned.',
              automationLevel: 'assist',
              action: openSourcingAction('variant-a'),
            },
          ],
        }),
        assistItem({
          variantId: 'variant-b',
          identity: { productTitle: 'Linen Shirt', variantTitle: 'Sand / L', sku: 'SKU-B' },
          blockerEvidence: { orderRemainingQty: 9, pickableAvailableQty: 1, shortageQty: 8 },
          purchasingEvidence: { variantOpenDemandQty: 9, supplierOptionCount: 0 },
          treatments: [
            {
              type: 'find_supplier',
              rank: 1,
              quantity: 8,
              reason: 'No supplier is set up for this variant yet.',
              automationLevel: 'assist',
              action: openSourcingAction('variant-b'),
            },
          ],
        }),
      ])
    );
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([
        inventoryConstraint('variant-a'),
        inventoryConstraint('variant-b'),
      ]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    // Evidence does not collapse onto an arbitrary first variant.
    expect(screen.getByTestId('inv-assist-need-variant-a')).toHaveTextContent('6');
    expect(screen.getByTestId('inv-assist-short-variant-a')).toHaveTextContent('4');
    expect(screen.getByTestId('inv-assist-need-variant-b')).toHaveTextContent('9');
    expect(screen.getByTestId('inv-assist-short-variant-b')).toHaveTextContent('8');

    // Each item keeps its own primary recommendation.
    expect(
      within(footerRegion()).getByRole('button', { name: /Source 4 units/i })
    ).toBeInTheDocument();
    expect(
      within(footerRegion()).getByRole('button', { name: /Find a supplier/i })
    ).toBeInTheDocument();

    fireEvent.click(footerCta(/Source 4 units/i));
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-a&orderId=order-1'
    );

    fireEvent.click(footerCta(/Find a supplier/i));
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-b&orderId=order-1'
    );

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('INV-TREAT-UI-09 presents only treatments[0] as the primary recommendation, not four competing CTAs', () => {
    setOrderDetail(
      assistOf([
        assistItem({
          variantId: 'variant-a',
          blockerEvidence: { orderRemainingQty: 10, pickableAvailableQty: 2, shortageQty: 8 },
          purchasingEvidence: {
            variantOpenDemandQty: 10,
            committedInboundQty: 3,
            pendingQueueQty: 5,
            draftPoQty: 2,
            supplierOptionCount: 2,
          },
          treatments: [
            {
              type: 'continue_purchasing',
              rank: 1,
              quantity: 5,
              reason: 'Purchasing work for this variant is already in progress.',
              automationLevel: 'inform',
              action: null,
            },
            {
              type: 'source_remaining',
              rank: 2,
              quantity: 3,
              reason: '3 units remain unplanned.',
              automationLevel: 'assist',
              action: openSourcingAction('variant-a'),
            },
            {
              type: 'wait_for_inbound',
              rank: 3,
              quantity: 3,
              reason: '3 units are already on the way.',
              automationLevel: 'inform',
              action: null,
            },
            {
              type: 'find_supplier',
              rank: 4,
              quantity: 3,
              reason: 'Other suppliers could cover this.',
              automationLevel: 'assist',
              action: openSourcingAction('variant-a'),
            },
          ],
        }),
      ])
    );

    renderModal();

    const footer = footerRegion();

    expect(within(footer).getByText(/Continue purchasing/i)).toBeInTheDocument();

    expect(within(footer).queryAllByRole('button')).toHaveLength(0);

    expect(within(footer).queryByText(/Source 3 units/i)).not.toBeInTheDocument();
    expect(within(footer).queryByText(/Review incoming stock/i)).not.toBeInTheDocument();
    expect(within(footer).queryByText(/Find a supplier/i)).not.toBeInTheDocument();

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('INV-TREAT-UI-10 falls back to the existing constraint-driven "Source this item" route when no assist is present', () => {
    // Order detail loaded, but the assist is absent — the additive feature must
    // not remove the safe behaviour INV-RED-06 already protects.
    setOrderDetail(null);
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([inventoryConstraint('variant-a')]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.queryByTestId('inv-assist-item-variant-a')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Source this item' }));

    expect(mockNavigate).toHaveBeenCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-a&orderId=order-1'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('INV-TREAT-UI-11 ignores stale assist and falls back per active constraint target', () => {
    setOrderDetail(
      assistOf([
        assistItem({
          variantId: 'variant-a',
          blockerEvidence: {
            orderRemainingQty: 6,
            pickableAvailableQty: 2,
            shortageQty: 4,
          },
          purchasingEvidence: {
            variantOpenDemandQty: 6,
            supplierOptionCount: 2,
          },
          treatments: [
            {
              type: 'source_remaining',
              rank: 1,
              quantity: 4,
              reason: '4 units are still unplanned.',
              automationLevel: 'assist',
              action: openSourcingAction('variant-a'),
            },
          ],
        }),
      ])
    );

    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([inventoryConstraint('variant-b')]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    // Assist is enrichment only: stale variant-a cannot create blocker/action truth.
    expect(screen.queryByTestId('inv-assist-item-variant-a')).not.toBeInTheDocument();
    expect(
      within(footerRegion()).queryByRole('button', { name: /Source 4 units/i })
    ).not.toBeInTheDocument();

    // The real active target still receives the safe per-variant fallback.
    const fallback = within(footerRegion()).getByRole('button', {
      name: 'Source this item',
    });

    fireEvent.click(fallback);

    expect(mockNavigate).toHaveBeenCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-b&orderId=order-1'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

});
