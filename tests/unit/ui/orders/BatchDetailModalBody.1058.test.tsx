/**
 * GH-1058 — active fulfillment batch entity detail.
 * BATCH-DETAIL-HANDOFF-01 — ratified operations-first Batch Detail body.
 *
 * Contract:
 * - operations-first hierarchy: stage stepper → fact rail → Current Work →
 *   Pick footprint → Items to Pick → Member Orders
 * - stage model is Picking → Picked → Packing → Packed (BATCH-UX-02)
 * - fact rail: Orders / Lines / Units / Locations (BATCH-UX-03)
 * - Current Work derives from canonical batch.status (BATCH-UX-04)
 * - Items to Pick renders canonical batch line-item truth (BATCH-UX-05)
 * - member orders expose an explicit accessible View → affordance that
 *   delegates to Order Detail navigation (BATCH-UX-06)
 * - Pick footprint stays truthful: authoritative location_code, real floor
 *   geometry, explicit denied/error/unmapped fallbacks (BATCH-UX-07)
 * - Continue/Resume/Go to is state-aware Tier-2 navigation to WMS
 *   Operations (/wms?batchId=<id> for pick work, /wms for pack work), never
 *   a workflow mutation — the Pick Brief owns the claim (BATCH-UX-08/09)
 * - no Cancel batch — pending cancellation stays on the Order Flow
 *   fulfillment card (BATCH-UX-10)
 */
import React from 'react';
import fs from 'fs';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';

const mockUsePickBatchOrders = jest.fn();
const mockUsePickBatchLineItems = jest.fn();
const mockUseCancelBatch = jest.fn();
const mockCancelMutate = jest.fn();
const mockCancelMutateAsync = jest.fn();
const mockUseCommercialAccess = jest.fn();
const mockUseFloorPlanning = jest.fn();
const mockNavigate = jest.fn();
const mockAxios = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};
const mockIsometricCanvas = jest.fn((props: Record<string, unknown>) => (
  <div data-testid="isometric-canvas" data-focused-bins={JSON.stringify(props.focusedBins)} />
));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('api/axiosConfig', () => ({
  get axiosInstance() {
    return mockAxios;
  },
}));

jest.mock('pages/wms/usePickBatches', () => ({
  usePickBatchOrders: (...args: unknown[]) =>
    mockUsePickBatchOrders(...args),
  usePickBatchLineItems: (...args: unknown[]) =>
    mockUsePickBatchLineItems(...args),
  useCancelBatch: (...args: unknown[]) =>
    mockUseCancelBatch(...args),
}));

jest.mock('runtime/commercialContext', () => ({
  useCommercialAccess: () => mockUseCommercialAccess(),
}));

jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: (...args: unknown[]) => mockUseFloorPlanning(...args),
}));

jest.mock('@lasyncro/shared/ui', () => ({
  IsometricCanvas: (props: Record<string, unknown>) =>
    mockIsometricCanvas(props),
}));

import { BatchDetailModalBody } from 'pages/ft2-pages/BatchDetailModalBody';

type BatchFixture = React.ComponentProps<typeof BatchDetailModalBody>['batch'];

const batch: BatchFixture = {
  pick_batch_id: 'abcd1234-1058-batch',
  status: 'picking',
  release_trigger: 'manual',
  total_line_items: 3,
  total_units: 10,
  units_picked: 4,
  units_packed: 1,
  picked_by: 7,
  packed_by: null,
  pick_claimed_at: '2026-09-08T12:00:00.000Z',
  pick_completed_at: null,
  pack_claimed_at: null,
  pack_completed_at: null,
  released_at: '2026-09-08T11:30:00.000Z',
  assigned_operator_id: 7,
  assigned_packer_id: null,
  picker_name: 'Ava Picker',
  packer_name: null,
};

function makeOrder(index: number) {
  return {
    lasyncro_order_id: `order-1058-${index}`,
    external_order_id: `1700000000000${index}`,
    wms_barcode: `LSO-1058-${index}`,
    total_price: 20 * index,
    currency: 'USD',
    warehouse_status: index % 2 === 0 ? 'awaiting_pick' : 'picking',
    line_items: [
      {
        lasyncro_line_item_id: `line-${index}`,
        lasyncro_order_id: `order-1058-${index}`,
        lasyncro_variant_id: `variant-${index}`,
        sku: `SKU-${index}`,
        product_title: `Product ${index}`,
        variant_title: 'Default',
        quantity: 1,
        pack_scanned: false,
        has_tracked_unit: true,
      },
    ],
  };
}

function renderBody(
  overrides: Partial<BatchFixture> = {},
  onNavigateToOrder: (orderId: string) => void = jest.fn(),
) {
  return render(
    <MemoryRouter>
      <BatchDetailModalBody
        batch={{ ...batch, ...overrides }}
        onNavigateToOrder={onNavigateToOrder}
      />
    </MemoryRouter>,
  );
}

const region = (name: RegExp) => screen.getByRole('region', { name });

/** Value shown beside a fact-rail label (the rail precedes later sections). */
function factValue(label: string): string {
  const labelElement = screen.getAllByText(label, { exact: true })[0];
  const container = labelElement.parentElement as HTMLElement;

  return (container.textContent ?? '').replace(label, '').trim();
}

/** Smallest ancestor of the SKU text that also carries its location code. */
function itemRow(scope: HTMLElement, sku: string, locationCode: string) {
  let node: HTMLElement | null = within(scope).getByText(new RegExp(sku));

  while (node && node !== scope && !node.textContent?.includes(locationCode)) {
    node = node.parentElement;
  }

  if (!node || node === scope) {
    throw new Error(`No item row for ${sku} carrying ${locationCode}`);
  }

  return node;
}

const executionControls = () =>
  [
    ...screen.queryAllByRole('button'),
    ...screen.queryAllByRole('link'),
  ].filter((element) =>
    /^(continue|resume|go to)\b/i.test(
      element.getAttribute('aria-label') ?? element.textContent ?? '',
    ),
  );

/** Resolves a navigation control's destination URL without mutating. */
function navigationTarget(control: HTMLElement): URL {
  const href = control.getAttribute('href');

  if (href) {
    return new URL(href, 'http://localhost');
  }

  fireEvent.click(control);

  expect(mockNavigate).toHaveBeenCalledTimes(1);

  const target = mockNavigate.mock.calls[0][0];
  const path =
    typeof target === 'string'
      ? target
      : `${target?.pathname ?? ''}${target?.search ?? ''}`;

  return new URL(path, 'http://localhost');
}

describe('GH-1058 — BatchDetailModalBody', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockUseCancelBatch.mockReturnValue({
      mutate: mockCancelMutate,
      mutateAsync: mockCancelMutateAsync,
      isPending: false,
      isError: false,
    });
    mockUseCommercialAccess.mockReturnValue({
      isResolved: true,
      decide: () => ({ allowed: true, reason: 'ALLOWED' }),
    });
    mockUseFloorPlanning.mockReturnValue({
      data: {
        zones: [
          {
            location_code: 'A-1',
            type: 'bin',
            active: true,
            position_x: 1,
            position_y: 1,
          },
          {
            location_code: 'B-2',
            type: 'bin',
            active: true,
            position_x: 2,
            position_y: 2,
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    mockUsePickBatchLineItems.mockReturnValue({
      data: {
        line_items: [
          { lasyncro_line_item_id: 'line-a1', lasyncro_variant_id: 'variant-a', lasyncro_order_id: 'order-1058-a', sku: 'SKU-A', title: 'Alpha', quantity: 2, location_code: 'A-1' },
          { lasyncro_line_item_id: 'line-a2', lasyncro_variant_id: 'variant-b', lasyncro_order_id: 'order-1058-a', sku: 'SKU-B', title: 'Beta', quantity: 3, location_code: 'A-1' },
          { lasyncro_line_item_id: 'line-b1', lasyncro_variant_id: 'variant-c', lasyncro_order_id: 'order-1058-b', sku: 'SKU-C', title: 'Gamma', quantity: 5, location_code: 'B-2' },
        ],
      },
      isLoading: false,
      isError: false,
    });

    mockUsePickBatchOrders.mockReturnValue({
      data: {
        orders: [
          {
            lasyncro_order_id: 'order-1058-a',
            external_order_id: '17000000000001',
            wms_barcode: 'LSO-1058-A',
            total_price: 120,
            currency: 'USD',
            warehouse_status: 'picking',
            line_items: [
              {
                lasyncro_line_item_id: 'line-a1',
                lasyncro_order_id: 'order-1058-a',
                lasyncro_variant_id: 'variant-a',
                sku: 'SKU-A',
                product_title: 'Alpha',
                variant_title: 'Default',
                quantity: 2,
                pack_scanned: false,
                has_tracked_unit: true,
              },
              {
                lasyncro_line_item_id: 'line-a2',
                lasyncro_order_id: 'order-1058-a',
                lasyncro_variant_id: 'variant-b',
                sku: 'SKU-B',
                product_title: 'Beta',
                variant_title: 'Default',
                quantity: 3,
                pack_scanned: false,
                has_tracked_unit: true,
              },
            ],
          },
          {
            lasyncro_order_id: 'order-1058-b',
            external_order_id: '17000000000002',
            wms_barcode: 'LSO-1058-B',
            total_price: 80,
            currency: 'USD',
            warehouse_status: 'awaiting_pick',
            line_items: [
              {
                lasyncro_line_item_id: 'line-b1',
                lasyncro_order_id: 'order-1058-b',
                lasyncro_variant_id: 'variant-c',
                sku: 'SKU-C',
                product_title: 'Gamma',
                variant_title: 'Default',
                quantity: 5,
                pack_scanned: false,
                has_tracked_unit: true,
              },
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it('BATCH-UX-03 — reads canonical batch orders and line items into the Orders / Lines / Units / Locations fact rail', () => {
    renderBody();

    expect(mockUsePickBatchOrders).toHaveBeenCalledWith(
      batch.pick_batch_id,
    );
    expect(mockUsePickBatchLineItems).toHaveBeenCalledWith(
      batch.pick_batch_id,
    );

    expect(factValue('Orders')).toBe('2');
    expect(factValue('Lines')).toBe('3');
    expect(factValue('Units')).toBe('10');
    expect(factValue('Locations')).toBe('2');
  });

  it('BATCH-UX-02 — exposes the Picking → Picked → Packing → Packed stage model with the current stage marked', () => {
    renderBody();

    const stages = screen.getByRole('list', { name: /stage/i });
    const items = within(stages).getAllByRole('listitem');

    expect(items.map((item) => item.textContent?.trim())).toEqual([
      expect.stringContaining('Picking'),
      expect.stringContaining('Picked'),
      expect.stringContaining('Packing'),
      expect.stringContaining('Packed'),
    ]);

    const current = stages.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Picking');
  });

  it('renders the ratified operations-first information hierarchy in order', () => {
    renderBody();

    const ordered = [
      screen.getByRole('list', { name: /stage/i }),
      screen.getAllByText('Orders', { exact: true })[0],
      region(/current work/i),
      screen.getByText('Pick footprint'),
      region(/items to pick/i),
      region(/member orders/i),
    ];

    for (let index = 1; index < ordered.length; index += 1) {
      expect(
        ordered[index - 1].compareDocumentPosition(ordered[index]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('BATCH-UX-04 — Current Work derives picker work from a picking batch', () => {
    renderBody();

    const work = region(/current work/i);

    expect(within(work).getByText(/Ava Picker/)).toBeInTheDocument();
    expect(work).toHaveTextContent(/4\s*\/\s*10/);
  });

  it('BATCH-UX-04 — Current Work derives packer work from a packing batch', () => {
    renderBody({
      status: 'packing',
      units_picked: 10,
      units_packed: 6,
      pick_completed_at: '2026-09-08T12:30:00.000Z',
      pack_claimed_at: '2026-09-08T12:45:00.000Z',
      packed_by: 9,
      assigned_packer_id: 9,
      packer_name: 'Pax Packer',
    });

    const work = region(/current work/i);

    expect(within(work).getByText(/Pax Packer/)).toBeInTheDocument();
    expect(work).toHaveTextContent(/6\s*\/\s*10/);
    expect(work).not.toHaveTextContent(/Ava Picker/);

    const current = screen
      .getByRole('list', { name: /stage/i })
      .querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Packing');
  });

  it('BATCH-UX-05 — Items to Pick renders canonical batch line-item truth', () => {
    renderBody();

    const items = region(/items to pick/i);

    const alpha = itemRow(items, 'SKU-A', 'A-1');
    expect(alpha).toHaveTextContent('Alpha');
    expect(alpha.textContent).toMatch(/(^|\D)2(\D|$)/);
    expect(alpha).toHaveTextContent('17000000000001');

    const gamma = itemRow(items, 'SKU-C', 'B-2');
    expect(gamma).toHaveTextContent('Gamma');
    expect(gamma.textContent).toMatch(/(^|\D)5(\D|$)/);
    expect(gamma).toHaveTextContent('17000000000002');
  });

  it('BATCH-UX-06 — member orders expose an explicit accessible View affordance that delegates to Order Detail', () => {
    const onNavigateToOrder = jest.fn();

    renderBody({}, onNavigateToOrder);

    const members = region(/member orders/i);
    const view = within(members).getByRole('button', {
      name: /View order #17000000000001/i,
    });

    expect(view).toHaveTextContent(/View/);
    expect(
      within(members).getByRole('button', {
        name: /View order #17000000000002/i,
      }),
    ).toBeInTheDocument();

    fireEvent.click(view);

    expect(onNavigateToOrder).toHaveBeenCalledTimes(1);
    expect(onNavigateToOrder).toHaveBeenCalledWith('order-1058-a');
  });

  it.each([
    ['pending', 'Continue to Pick', true],
    ['picking', 'Resume Picking', true],
    ['pick_complete', 'Go to Packing', false],
    ['packing', 'Resume Packing', false],
  ] as const)(
    'BATCH-UX-08/09 — %s → "%s →" is Tier-2 navigation to WMS without mutating the batch',
    (status, label, opensPickBrief) => {
      renderBody({ status });

      const controls = executionControls();
      expect(controls).toHaveLength(1);

      const control = controls[0];
      expect(
        control.getAttribute('aria-label') ?? control.textContent ?? '',
      ).toMatch(new RegExp(`^${label}`));

      // Tier 2: navigation ghost treatment, never the Tier-1 filled accent.
      expect(control).toHaveStyle({ color: 'var(--accent-text)' });
      expect(control).not.toHaveStyle({ backgroundColor: 'var(--accent)' });

      // WMS Operations is the mounted execution surface. Pick work deep-links
      // the exact batch (?batchId= → pendingPickBatchId → Pick Brief); pack
      // work lands on Operations without entering a pick session.
      const target = navigationTarget(control);
      expect(target.pathname).toBe('/wms');
      expect(target.searchParams.get('batchId')).toBe(
        opensPickBrief ? batch.pick_batch_id : null,
      );

      // Navigation only: no claim / start / pick / pack / cancel writes.
      expect(mockAxios.post).not.toHaveBeenCalled();
      expect(mockAxios.put).not.toHaveBeenCalled();
      expect(mockAxios.patch).not.toHaveBeenCalled();
      expect(mockAxios.delete).not.toHaveBeenCalled();
      expect(mockCancelMutate).not.toHaveBeenCalled();
      expect(mockCancelMutateAsync).not.toHaveBeenCalled();
    },
  );

  it('BATCH-UX-08 — pack_complete exposes no execution CTA', () => {
    renderBody({
      status: 'pack_complete',
      units_picked: 10,
      units_packed: 10,
      pick_completed_at: '2026-09-08T12:30:00.000Z',
      pack_claimed_at: '2026-09-08T12:45:00.000Z',
      pack_completed_at: '2026-09-08T13:00:00.000Z',
    });

    expect(executionControls()).toHaveLength(0);
  });

  it('BATCH-UX-10 — does not offer Cancel batch, even for a pending batch', () => {
    renderBody({
      status: 'pending',
      units_picked: 0,
      units_packed: 0,
      picked_by: null,
      pick_claimed_at: null,
      assigned_operator_id: null,
      picker_name: null,
    });

    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/cancel batch/i)).not.toBeInTheDocument();
  });

  it('does not fetch floor geometry when floor-planning access is denied', () => {
    mockUseCommercialAccess.mockReturnValue({
      isResolved: true,
      decide: () => ({ allowed: false, reason: 'TIER_TOO_LOW' }),
    });

    renderBody();

    expect(mockUseFloorPlanning).toHaveBeenCalledWith(false);
    expect(region(/current work/i)).toBeInTheDocument();
    expect(screen.getByText('Warehouse map is not available on this plan.')).toBeInTheDocument();
  });

  it('focuses distinct authoritative pick locations and ignores blanks', () => {
    mockUsePickBatchLineItems.mockReturnValue({
      data: {
        line_items: [
          { lasyncro_line_item_id: 'line-a1', lasyncro_variant_id: 'variant-a', lasyncro_order_id: 'order-1058-a', sku: 'SKU-A', title: 'Alpha', quantity: 2, location_code: 'A-1' },
          { lasyncro_line_item_id: 'line-a2', lasyncro_variant_id: 'variant-b', lasyncro_order_id: 'order-1058-a', sku: 'SKU-B', title: 'Beta', quantity: 1, location_code: 'A-1' },
          { lasyncro_line_item_id: 'line-a3', lasyncro_variant_id: 'variant-c', lasyncro_order_id: 'order-1058-a', sku: 'SKU-C', title: 'Gamma', quantity: 1, location_code: 'B-2' },
          { lasyncro_line_item_id: 'line-a4', lasyncro_variant_id: 'variant-d', lasyncro_order_id: 'order-1058-a', sku: 'SKU-D', title: 'Delta', quantity: 1, location_code: '' },
        ],
      },
      isLoading: false,
      isError: false,
    });

    renderBody();

    expect(mockUseFloorPlanning).toHaveBeenCalledWith(true);
    expect(screen.getByText('Pick footprint')).toBeInTheDocument();
    expect(mockIsometricCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        focusedBins: ['A-1', 'B-2'],
        showLegend: false,
        showControls: false,
        disablePan: true,
      }),
    );
  });

  it('does not synthesize unmapped locations', () => {
    mockUsePickBatchLineItems.mockReturnValue({
      data: {
        line_items: [
          { lasyncro_line_item_id: 'line-a1', lasyncro_variant_id: 'variant-a', lasyncro_order_id: 'order-1058-a', sku: 'SKU-A', title: 'Alpha', quantity: 2, location_code: 'ROOT' },
        ],
      },
      isLoading: false,
      isError: false,
    });

    renderBody();

    expect(mockIsometricCanvas).not.toHaveBeenCalled();
    expect(screen.getByText('Pick locations are not positioned on the mapped floor.')).toBeInTheDocument();
    expect(screen.getByText('ROOT · not mapped')).toBeInTheDocument();
  });

  it('keeps batch detail usable when geometry fails', () => {
    mockUseFloorPlanning.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
    });

    renderBody();

    expect(screen.getByText('Warehouse pick footprint is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Ava Picker')).toBeInTheDocument();
  });

  it('bounds the default order list for larger batches and expands on request', () => {
    mockUsePickBatchOrders.mockReturnValue({
      data: {
        orders: [1, 2, 3, 4, 5, 6].map(makeOrder),
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderBody({ total_line_items: 6, total_units: 6 });

    expect(screen.getByRole('button', { name: /View order #17000000000001/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View order #17000000000004/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View order #17000000000005/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }));

    expect(screen.getByRole('button', { name: /View order #17000000000005/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View order #17000000000006/i })).toBeInTheDocument();
  });

  it('BATCH-UX-11 — keeps the canonical desktop Pick footprint inside the scroll-free density budget', () => {
    const source = fs.readFileSync(
      'apps/frontend/src/pages/ft2-pages/BatchDetailModalBody.tsx',
      'utf8',
    );

    const footprintHeight = source.match(
      /focusedBins\.length > 0[\s\S]*?height:\s*(\d+),/,
    );

    expect(footprintHeight).not.toBeNull();

    // BATCH-UX-11 — normal desktop Entity Detail should fit canonical
    // reviewer-sized data without avoidable internal scrolling. The map is
    // supporting spatial context, so it must stay inside this compact budget.
    // Live browser remains the authority for actual scroll/no-scroll.
    expect(Number(footprintHeight![1])).toBeLessThanOrEqual(160);
    expect(source).not.toMatch(/\bheight:\s*(3\d\d|[4-9]\d\d)\b/);
    expect(source).not.toMatch(/\bminHeight:\s*(3\d\d|[4-9]\d\d)\b/);
  });
});
