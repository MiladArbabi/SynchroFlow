/**
 * GH-1058 — active fulfillment batch entity detail.
 *
 * Contract:
 * - explains aggregate pick/pack progress
 * - shows picker/packer ownership
 * - shows exact member orders from the canonical batch-orders read
 * - member-order activation delegates to Order Detail navigation
 */
import React from 'react';
import fs from 'fs';
import { fireEvent, render, screen } from '@testing-library/react';

const mockUsePickBatchOrders = jest.fn();
const mockUsePickBatchLineItems = jest.fn();
const mockUseCommercialAccess = jest.fn();
const mockUseFloorPlanning = jest.fn();
const mockIsometricCanvas = jest.fn((props: Record<string, unknown>) => (
  <div data-testid="isometric-canvas" data-focused-bins={JSON.stringify(props.focusedBins)} />
));

jest.mock('pages/wms/usePickBatches', () => ({
  usePickBatchOrders: (...args: unknown[]) =>
    mockUsePickBatchOrders(...args),
  usePickBatchLineItems: (...args: unknown[]) =>
    mockUsePickBatchLineItems(...args),
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

const batch = {
  pick_batch_id: 'abcd1234-1058-batch',
  status: 'picking' as const,
  release_trigger: 'manual' as const,
  total_line_items: 6,
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

describe('GH-1058 — BatchDetailModalBody', () => {
  beforeEach(() => {
    jest.clearAllMocks();

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

  it('renders progress, ownership and member-order context', () => {
    render(
      <BatchDetailModalBody
        batch={batch}
        onNavigateToOrder={jest.fn()}
      />,
    );

    expect(mockUsePickBatchOrders).toHaveBeenCalledWith(
      batch.pick_batch_id,
    );
    expect(mockUsePickBatchLineItems).toHaveBeenCalledWith(
      batch.pick_batch_id,
    );

    expect(screen.getByText('Picking progress')).toBeInTheDocument();
    expect(screen.getByText('4 / 10 units')).toBeInTheDocument();

    expect(screen.getByText('Packing progress')).toBeInTheDocument();
    expect(screen.getByText('1 / 10 units')).toBeInTheDocument();

    expect(screen.getByText('Ava Picker')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();

    expect(screen.getByText('Released')).toBeInTheDocument();
    expect(screen.getByText('Pick claimed')).toBeInTheDocument();
    expect(screen.getByText('Pick completed')).toBeInTheDocument();
    expect(screen.getByText('Pack claimed')).toBeInTheDocument();
    expect(screen.getByText('Pack completed')).toBeInTheDocument();

    expect(screen.getByText('2 orders')).toBeInTheDocument();
    expect(screen.getByText('6 lines · 10 units')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show \d+ more/i })).not.toBeInTheDocument();

    expect(
      screen.getByRole('button', {
        name: /Order #17000000000001/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', {
        name: /Order #17000000000002/i,
      }),
    ).toBeInTheDocument();
  });

  it('delegates member-order inspection without creating a nested modal', () => {
    const onNavigateToOrder = jest.fn();

    render(
      <BatchDetailModalBody
        batch={batch}
        onNavigateToOrder={onNavigateToOrder}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /Order #17000000000001/i,
      }),
    );

    expect(onNavigateToOrder).toHaveBeenCalledTimes(1);
    expect(onNavigateToOrder).toHaveBeenCalledWith(
      'order-1058-a',
    );
  });

  it('does not fetch floor geometry when floor-planning access is denied', () => {
    mockUseCommercialAccess.mockReturnValue({
      isResolved: true,
      decide: () => ({ allowed: false, reason: 'TIER_TOO_LOW' }),
    });

    render(
      <BatchDetailModalBody
        batch={batch}
        onNavigateToOrder={jest.fn()}
      />,
    );

    expect(mockUseFloorPlanning).toHaveBeenCalledWith(false);
    expect(screen.getByText('Picking progress')).toBeInTheDocument();
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

    render(
      <BatchDetailModalBody
        batch={batch}
        onNavigateToOrder={jest.fn()}
      />,
    );

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

    render(
      <BatchDetailModalBody
        batch={batch}
        onNavigateToOrder={jest.fn()}
      />,
    );

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

    render(
      <BatchDetailModalBody
        batch={batch}
        onNavigateToOrder={jest.fn()}
      />,
    );

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

    render(
      <BatchDetailModalBody
        batch={{ ...batch, total_line_items: 6, total_units: 6 }}
        onNavigateToOrder={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Order #17000000000001/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Order #17000000000004/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Order #17000000000005/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }));

    expect(screen.getByRole('button', { name: /Order #17000000000005/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Order #17000000000006/i })).toBeInTheDocument();
  });

  it('keeps the pick footprint map compact', () => {
    const source = fs.readFileSync(
      'apps/frontend/src/pages/ft2-pages/BatchDetailModalBody.tsx',
      'utf8',
    );

    expect(source).toContain('height: 205');
    expect(source).not.toMatch(/\bheight:\s*(3\d\d|[4-9]\d\d)\b/);
    expect(source).not.toMatch(/\bminHeight:\s*(3\d\d|[4-9]\d\d)\b/);
  });
});
