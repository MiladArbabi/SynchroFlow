/**
 * GH #1053 — ORDER DETAIL MODAL REDESIGN (RED regression coverage).
 *
 * This file SUPPLEMENTS, and never replaces, the three existing behavioural
 * contracts for this component:
 *
 *   tests/unit/ui/orders/OrderDetailModalBody.customer-address.test.tsx
 *   tests/unit/ui/orders/OrderDetailModalBody.inventory-sourcing.test.tsx
 *   tests/unit/ui/orders/OrderDetailModalBody.returned-undelivered.test.tsx
 *
 * Those files own WHAT each blocker's remediation does (which dialog opens,
 * which route is navigated to, that the generic execute mutation is never
 * fired). None of their assertions are weakened, moved or restated here.
 *
 * What #1053 adds is WHERE that remediation lives, plus two presentation
 * contracts:
 *
 *   ORD-MODAL-FOOTER-1053  blocker-specific remediation must reach
 *                          EntityDetailModal's footerActions slot through the
 *                          existing onFooterReady path, not render inside the
 *                          scrollable body. The behaviour on click is
 *                          unchanged — same dialog, same route, still no
 *                          generic execute.
 *   ORD-MODAL-ISO-1053     a compact Warehouse Status visualization that
 *                          represents the canonical order STAGE
 *                          (order.warehouseStatus), embedding the existing
 *                          @lasyncro/shared/ui IsometricZoneView primitive.
 *                          It must never claim a physical/live location.
 *   ORD-MODAL-SCOPE-1053   surfaces explicitly excluded from the opening
 *                          modal stay absent.
 *
 * Harness mirrors the three existing files (same hook mocks, same currency
 * mock, role/text queries only). No CSS or pixel assertions, no timers, no
 * sleeps, no SVG internals.
 */
import React, { ReactNode, useCallback, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';

const mockNavigate = jest.fn();
const mockExecute = jest.fn();
const mockUseOrderDecision = jest.fn();
const mockUseOrderDetail = jest.fn();
const mockUpdateAddress = jest.fn();

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

/**
 * The compact stage visualization must REUSE the existing embeddable
 * primitive rather than growing a second isometric implementation. Mocked so
 * the contract is "the primitive is mounted", not "these SVG paths exist" —
 * the real component's geometry is not this file's business, and the full
 * Overview IsometricCanvas (with its live-map entitlement behaviour) must not
 * be mounted here at all.
 */
jest.mock('@lasyncro/shared/ui', () => ({
  IsometricZoneView: (props: Record<string, unknown>) => (
    <div data-testid="iso-zone-view" data-zone-code={String((props as any)?.zone?.location_code ?? '')} />
  ),
}));

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
    mutate: mockUpdateAddress,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

jest.mock('hooks/useCurrency', () => ({
  useCurrency: () => ({
    format: (value: number | null | undefined) =>
      value == null ? '—' : `$${Number(value).toLocaleString('en-US')}`,
  }),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

type Constraint = {
  constraint_type: string;
  block_type: string | null;
  target_id: string | null;
  target_status: string | null;
  started_at: string;
};

const CUSTOMER_CONSTRAINT: Constraint = {
  constraint_type: 'customer',
  block_type: 'incomplete_address',
  target_id: null,
  target_status: null,
  started_at: '2026-09-01T12:00:00.000Z',
};

const INVENTORY_CONSTRAINT: Constraint = {
  constraint_type: 'inventory',
  block_type: 'oversell',
  target_id: 'variant-a',
  target_status: null,
  started_at: '2026-09-02T12:00:00.000Z',
};

const RETURNED_CONSTRAINT: Constraint = {
  constraint_type: 'operational',
  block_type: 'returned_undelivered',
  target_id: 'return-job-1',
  target_status: 'pending',
  started_at: '2026-09-01T12:00:00.000Z',
};

function decisionResponse(
  constraints: Constraint[],
  recommendedActionType: string | null = null
) {
  return {
    decision: recommendedActionType
      ? {
          id: 'decision-1053',
          type: 'operational',
          entity_id: 'order-1',
          status: 'pending',
          priority: 60,
          reason: `Derived from ${recommendedActionType}`,
          recommended_action: {
            type: recommendedActionType,
            payload: {},
            execution_mode: 'manual',
          },
          actions: [],
          lifecycle: null,
          created_at: '2026-09-01T12:00:00.000Z',
          updated_at: '2026-09-01T12:00:00.000Z',
        }
      : null,
    constraints,
  };
}

function setDecision(body: unknown) {
  mockUseOrderDecision.mockReturnValue({
    data: body,
    isLoading: false,
    isError: false,
    error: null,
  });
}

/** A realistic GET /api/v1/orders/:id payload (see useOrderDetail.ts). */
function orderDetail(warehouseStatus: string | null) {
  return {
    id: 'order-1',
    externalOrderId: '1001',
    total: 120,
    subtotal: 100,
    tax: 20,
    currency: 'USD',
    paymentState: 'paid',
    createdAt: '2026-09-01T12:00:00.000Z',
    lineItems: [
      {
        id: 'li-1',
        sku: 'SKU-1',
        title: 'Test item',
        quantity: 1,
        unit_price: 100,
        line_total: 100,
        image_url: null,
      },
    ],
    // Null so the ISS-07b "Fulfilled" tier never masks the real stage under test.
    fulfillment: null,
    warehouseStatus,
    timeline: [],
    tracking: null,
    shipping: {
      name: 'Jane Doe',
      address1: '1 Test Way',
      address2: null,
      city: 'Bristol',
      zip: 'BS1 1AA',
      phone: null,
      province: null,
      countryCode: 'GB',
    },
    addressAssist: null,
  };
}

function setOrderDetail(warehouseStatus: string | null) {
  mockUseOrderDetail.mockReturnValue({
    data: orderDetail(warehouseStatus),
    isLoading: false,
  });
}

// ── Test host: body and footer are separately addressable ───────────────────
/**
 * EntityDetailModal renders this component as `children` and its
 * onFooterReady payload into the `footerActions` slot — two different DOM
 * regions. This host reproduces exactly that split so "in the footer, not in
 * the scrollable body" is an assertable fact rather than a description.
 */
const noop = () => {};

function ModalHost({ queryClient, onSubtitleReady = noop }: { queryClient: QueryClient; onSubtitleReady?: (subtitle: string | undefined) => void }) {
  const [footer, setFooter] = useState<ReactNode>(null);
  const handleFooterReady = useCallback((node: ReactNode) => setFooter(node), []);

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <div data-testid="modal-body">
          <OrderDetailModalBody
            orderId="order-1"
            onTitleReady={noop}
            onSubtitleReady={onSubtitleReady}
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

function renderModal(seed?: (qc: QueryClient) => void) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  seed?.(queryClient);
  return render(<ModalHost queryClient={queryClient} />);
}

const body = () => within(screen.getByTestId('modal-body'));
const footer = () => within(screen.getByTestId('modal-footer'));

// ── A. ORD-MODAL-FOOTER-1053 ────────────────────────────────────────────────

describe('ORD-MODAL-FOOTER-1053 — blocker remediation lives in footerActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('customer/incomplete_address — problem stays in the body, "Correct shipping address" moves to the footer', () => {
    setDecision(decisionResponse([CUSTOMER_CONSTRAINT]));
    setOrderDetail(null);

    renderModal();

    // The blocker EVIDENCE is body content and stays there.
    expect(body().getByText('Address Issue')).toBeInTheDocument();

    // The remediation is footer content.
    const footerCta = footer().getByRole('button', { name: 'Correct shipping address' });
    expect(footerCta).toBeInTheDocument();

    // …and is no longer duplicated inside the scrollable body.
    expect(
      body().queryByRole('button', { name: 'Correct shipping address' })
    ).not.toBeInTheDocument();

    // Behaviour on click is unchanged (see customer-address.test.tsx ADDR-UI-01).
    fireEvent.click(footerCta);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Correct shipping address' })
    ).toBeInTheDocument();

    // The generic manual-no-op execute path is still never reached.
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('inventory/oversell — "Source this item" moves to the footer and keeps target_id-specific routing', () => {
    setDecision(decisionResponse([INVENTORY_CONSTRAINT], 'open_sourcing'));
    setOrderDetail(null);

    renderModal();

    expect(body().getByText(/Out of stock/i)).toBeInTheDocument();

    const footerCta = footer().getByRole('button', { name: 'Source this item' });
    expect(footerCta).toBeInTheDocument();
    expect(
      body().queryByRole('button', { name: 'Source this item' })
    ).not.toBeInTheDocument();

    fireEvent.click(footerCta);

    // Unchanged contract (see inventory-sourcing.test.tsx INV-RED-06/07).
    expect(mockNavigate).toHaveBeenCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-a&orderId=order-1'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('inventory/oversell — every blocked variant keeps its own footer action', () => {
    setDecision(
      decisionResponse(
        [INVENTORY_CONSTRAINT, { ...INVENTORY_CONSTRAINT, target_id: 'variant-b' }],
        'open_sourcing'
      )
    );
    setOrderDetail(null);

    renderModal();

    const footerCtas = footer().getAllByRole('button', { name: /Source (this )?item/i });
    expect(footerCtas).toHaveLength(2);

    fireEvent.click(footerCtas[1]);
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-b&orderId=order-1'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('operational/returned_undelivered — "Process return" moves to the footer and keeps WMS routing', () => {
    setDecision(decisionResponse([RETURNED_CONSTRAINT], 'open_return_job'));
    setOrderDetail(null);

    renderModal();

    expect(body().getByText('Package returned')).toBeInTheDocument();

    const footerCta = footer().getByRole('button', { name: 'Process return' });
    expect(footerCta).toBeInTheDocument();
    expect(
      body().queryByRole('button', { name: 'Process return' })
    ).not.toBeInTheDocument();

    fireEvent.click(footerCta);

    // Unchanged contract (see returned-undelivered.test.tsx).
    expect(mockNavigate).toHaveBeenCalledWith('/wms?returnJobId=return-job-1');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('operational/returned_undelivered awaiting_decision — footer action keeps the Returns-items route', () => {
    setDecision(
      decisionResponse(
        [{ ...RETURNED_CONSTRAINT, target_status: 'awaiting_decision' }],
        'open_return_job'
      )
    );
    setOrderDetail(null);

    renderModal();

    fireEvent.click(footer().getByRole('button', { name: 'Review return' }));

    expect(mockNavigate).toHaveBeenCalledWith('/returns/items?returnJobId=return-job-1');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('generic executable recommendation — the existing execute path still runs, from the footer', () => {
    setDecision(
      decisionResponse(
        [
          {
            constraint_type: 'operational',
            block_type: 'manual_hold',
            target_id: null,
            target_status: null,
            started_at: '2026-09-01T12:00:00.000Z',
          },
        ],
        'resolve_operational_block'
      )
    );
    setOrderDetail(null);

    renderModal();

    fireEvent.click(footer().getByRole('button', { name: 'Mark as resolved' }));

    // The generic execute contract itself is unchanged.
    expect(mockExecute).toHaveBeenCalledWith('order-1');
  });
});

// ── B. ORD-MODAL-ISO-1053 ───────────────────────────────────────────────────
/**
 * Stage truth is order.warehouseStatus (order_warehouse_status_type):
 * awaiting_pick | picking | picked | packing | packed | shipped |
 * partially_shipped | cancelled. Null + an active blocker is the
 * blocked/order-pool state, not missing data.
 *
 * The visualization represents that CANONICAL STAGE. It must never present
 * itself as the unit's physical whereabouts — there is no per-order live
 * location signal behind it.
 */
describe('ORD-MODAL-ISO-1053 — compact Warehouse Status visualization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['picking', 'Picking'],
    ['packing', 'Packing'],
    ['packed', 'Packed'],
    ['shipped', 'Shipped'],
  ])('warehouseStatus %s renders the Warehouse status stage "%s"', (status, label) => {
    setDecision(decisionResponse([]));
    setOrderDetail(status);

    renderModal();

    expect(screen.getByText(/Warehouse status/i)).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();

    // Stage representation, never a physical/live location claim.
    expect(screen.queryByText(/Current location/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Live location/i)).not.toBeInTheDocument();
  });

  it('renders the shared compact isometric primitive for a real warehouse stage', () => {
    setDecision(decisionResponse([]));
    setOrderDetail('picking');

    renderModal();

    // The existing embeddable primitive, not a second implementation and not
    // the full Overview live canvas.
    expect(screen.getByTestId('iso-zone-view')).toBeInTheDocument();
  });

  it('null warehouseStatus with an active blocker renders the blocked / order-pool stage', () => {
    setDecision(decisionResponse([INVENTORY_CONSTRAINT], 'open_sourcing'));
    setOrderDetail(null);

    renderModal();

    expect(screen.getByText(/Warehouse status/i)).toBeInTheDocument();
    expect(screen.getByText(/Blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/Order pool/i)).toBeInTheDocument();

    // The compact stage visual is what replaces the removed Similar Orders
    // surface — including for the primary blocked / order-pool state, which is
    // the state an operator opens this modal in most often. Mount contract
    // only: no location_code, no live-map data, no full IsometricCanvas.
    expect(screen.getByTestId('iso-zone-view')).toBeInTheDocument();
  });

  it('null warehouseStatus never implies a current or live physical location', () => {
    setDecision(decisionResponse([]));
    setOrderDetail(null);

    renderModal();

    expect(screen.queryByText(/Current location/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Live location/i)).not.toBeInTheDocument();
  });
});

// ── C. ORD-MODAL-SCOPE-1053 ─────────────────────────────────────────────────

describe('ORD-MODAL-SCOPE-1053 — surfaces excluded from the opening modal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Seeded so the similar-orders lookup has real material to render from:
   * useCachedConstrainedRow prefix-matches ['orders','constrained'], and the
   * modal's similarOrders filter matches on constraint_type + block_type.
   */
  function constrainedRow(orderId: string, externalId: string) {
    return {
      order_id: orderId,
      external_order_id: externalId,
      constraint_type: 'inventory',
      block_type: 'oversell',
      target_id: 'variant-a',
      target_status: null,
      other_blocker_types: [],
      constrained_since: '2026-09-02T12:00:00.000Z',
      revenue: 250,
      promised_ship_by: null,
      recommended_action: null,
      priority: 80,
      decision_id: null,
      age_since_creation_seconds: 3600,
      age_since_paid_seconds: 3600,
      fulfillment_sla_hours: 48,
      is_shipping_sla_breached: false,
      is_delivery_sla_breached: false,
      gross_margin: null,
      margin_pct: null,
    };
  }

  it('does not offer Snooze, batch, Shopify or similar-orders surfaces', () => {
    setDecision(decisionResponse([INVENTORY_CONSTRAINT], 'open_sourcing'));
    setOrderDetail(null);

    renderModal((qc) => {
      qc.setQueryData(['orders', 'constrained', { page: 1, limit: 25, constraint_type: null }], {
        data: [
          constrainedRow('order-1', '1001'),
          constrainedRow('order-2', '1002'),
          constrainedRow('order-3', '1003'),
        ],
      });
    });

    expect(screen.queryByText(/Snooze 24h/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Snooze 24h/i })).not.toBeInTheDocument();

    expect(screen.queryByText(/View all .* as a batch/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View all .* as a batch/i })).not.toBeInTheDocument();

    expect(screen.queryByText(/Open in Shopify/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open in Shopify/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open in Shopify/i })).not.toBeInTheDocument();

    // Similar-orders opening UI: the cache above WOULD populate it.
    expect(screen.queryByText(/share this exact issue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/other orders?/i)).not.toBeInTheDocument();
  });
});


describe('GH-1053 live-browser regression contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ORD-MODAL-SUBTITLE-1053 — unchanged subtitle is not republished on unrelated rerender', () => {
    setDecision(decisionResponse([CUSTOMER_CONSTRAINT]));
    setOrderDetail(null);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['orders', 'constrained'], {
      data: [{ order_id: 'order-1', revenue: 120, margin_pct: null }],
    });
    const onSubtitleReady = jest.fn();
    const { rerender } = render(<ModalHost queryClient={queryClient} onSubtitleReady={onSubtitleReady} />);
    expect(onSubtitleReady).toHaveBeenLastCalledWith('$120 at stake');
    onSubtitleReady.mockClear();

    rerender(<ModalHost queryClient={queryClient} onSubtitleReady={onSubtitleReady} />);

    expect(onSubtitleReady).not.toHaveBeenCalled();
  });

  it('ORD-MODAL-FOOTER-STABILITY-1053 — consumers wire the same stable close callback to shell and body', () => {
    // Structural wiring contract: parse executable TSX, without freezing
    // callback names, source formatting or unrelated page rendering.
    const ts = require('typescript') as typeof import('typescript');
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const violations: string[] = [];
    for (const page of ['OrderFlowPage', 'OrdersFT2Page', 'OrdersOutboundPage']) {
      const filename = path.resolve(__dirname, '../../../../apps/frontend/src/pages/ft2-pages', `${page}.tsx`);
      const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const declarations = new Map<string, import('typescript').Expression>();
      const closeProps = new Map<string, import('typescript').Expression[]>();
      const visit = (node: import('typescript').Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
          declarations.set(node.name.text, node.initializer);
        }
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
            ts.isIdentifier(node.tagName) && ['EntityDetailModal', 'OrderDetailModalBody'].includes(node.tagName.text)) {
          const prop = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'onClose');
          if (prop && ts.isJsxAttribute(prop) && prop.initializer && ts.isJsxExpression(prop.initializer) && prop.initializer.expression) {
            closeProps.set(node.tagName.text, [...(closeProps.get(node.tagName.text) ?? []), prop.initializer.expression]);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      const shell = closeProps.get('EntityDetailModal') ?? [];
      const body = closeProps.get('OrderDetailModalBody') ?? [];
      if (shell.length !== 1 || body.length !== 1 || !ts.isIdentifier(shell[0]) || !ts.isIdentifier(body[0]) || shell[0].text !== body[0].text) {
        violations.push(`${page}: shell and body must reference the same stable close callback`);
        continue;
      }
      const initializer = declarations.get(shell[0].text);
      if (!initializer || !ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression) || initializer.expression.text !== 'useCallback') {
        violations.push(`${page}: close callback must be created with useCallback`);
        continue;
      }
      const [callback, dependencies] = initializer.arguments;
      if (!dependencies || !ts.isArrayLiteralExpression(dependencies) || dependencies.elements.length !== 0) {
        violations.push(`${page}: close callback must have stable empty dependencies`);
      }
      let clearsSelection = false;
      const inspectClose = (node: import('typescript').Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'setSelectedOrderId' &&
            node.arguments.length === 1 && node.arguments[0].kind === ts.SyntaxKind.NullKeyword) clearsSelection = true;
        ts.forEachChild(node, inspectClose);
      };
      if (callback) inspectClose(callback);
      if (!clearsSelection) violations.push(`${page}: close callback must clear the selected order`);
    }
    expect(violations).toEqual([]);
  });

  it('ORD-MODAL-ACTIVITY-1053 — footer surfaces only the two newest events alongside remediation', () => {
    setDecision(decisionResponse([CUSTOMER_CONSTRAINT]));
    mockUseOrderDetail.mockReturnValue({
      data: {
        ...orderDetail(null),
        timeline: [
          { id: 'oldest', status: 'pending', event_occurred_at: '2026-09-01T12:00:00.000Z' },
          { id: 'middle', status: 'payment_captured', event_occurred_at: '2026-09-02T12:00:00.000Z' },
          { id: 'newest', status: 'address_corrected', event_occurred_at: '2026-09-03T12:00:00.000Z' },
        ],
      },
      isLoading: false,
    });

    renderModal();

    expect(body().queryByText('Activity')).not.toBeInTheDocument();
    expect(body().queryByText('Latest activity')).not.toBeInTheDocument();
    expect(body().queryByText('Shipping address corrected')).not.toBeInTheDocument();
    expect(body().queryByText('Payment captured')).not.toBeInTheDocument();
    expect(footer().getByText('Latest activity')).toBeInTheDocument();
    const newest = footer().getByText('Shipping address corrected');
    const middle = footer().getByText('Payment captured');
    expect(newest.compareDocumentPosition(middle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer().queryByText('Order placed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show.*more/i })).not.toBeInTheDocument();
    expect(footer().getByRole('button', { name: 'Correct shipping address' })).toBeInTheDocument();
  });
});

describe('SLA-TREAT-01 assistance', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  function treatment(assistance: unknown, assessment = 'picking_stalled') {
    mockUseOrderDetail.mockReturnValue({ data: { ...orderDetail('picking'), slaTreatment: {
      sla: { state: 'approaching' }, cpt: { state: 'before_cutoff', localTime: '16:00', hoursRemaining: 2 },
      execution: { assessment }, activeBlockerRefs: [], assistance,
    } }, isLoading: false });
  }
  it('navigates to the exact picking batch without an execute mutation', () => {
    setDecision(decisionResponse([]));
    treatment({ kind: 'navigate', label: 'Continue picking', href: '/wms?batchId=batch-sla' });
    renderModal();
    expect(mockExecute).not.toHaveBeenCalled();
    fireEvent.click(footer().getByRole('button', { name: 'Continue picking' }));
    expect(mockNavigate).toHaveBeenCalledWith('/wms?batchId=batch-sla');
    expect(mockExecute).not.toHaveBeenCalled();
  });
  it('keeps canonical blocker CTA above warehouse assistance', () => {
    setDecision(decisionResponse([CUSTOMER_CONSTRAINT]));
    treatment({ kind: 'navigate', label: 'Continue picking', href: '/wms?batchId=batch-sla' });
    renderModal();
    expect(footer().getByRole('button', { name: 'Correct shipping address' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue picking' })).not.toBeInTheDocument();
  });
  it('uses generic warehouse navigation for another operator and packing', () => {
    setDecision(decisionResponse([]));
    treatment({ kind: 'navigate', label: 'Review warehouse work', href: '/wms' });
    const view = renderModal();
    fireEvent.click(footer().getByRole('button', { name: 'Review warehouse work' }));
    expect(mockNavigate).toHaveBeenCalledWith('/wms');
    view.unmount();
    treatment({ kind: 'navigate', label: 'Open packing', href: '/wms' }, 'packing_stalled');
    renderModal();
    fireEvent.click(footer().getByRole('button', { name: 'Open packing' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('/wms');
    expect(mockExecute).not.toHaveBeenCalled();
  });
  it('adds no execution CTA for active work or completed warehouse work', () => {
    setDecision(decisionResponse([]));
    treatment(null, 'picking_active');
    const view = renderModal();
    expect(footer().queryByRole('button')).not.toBeInTheDocument();
    view.unmount();
    treatment(null, 'warehouse_complete');
    renderModal();
    expect(footer().queryByRole('button')).not.toBeInTheDocument();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
