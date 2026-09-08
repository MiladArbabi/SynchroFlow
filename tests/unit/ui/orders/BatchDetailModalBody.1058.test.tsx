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
import { fireEvent, render, screen } from '@testing-library/react';

import { BatchDetailModalBody } from 'pages/ft2-pages/BatchDetailModalBody';

const mockUsePickBatchOrders = jest.fn();

jest.mock('pages/wms/usePickBatches', () => ({
  usePickBatchOrders: (...args: unknown[]) =>
    mockUsePickBatchOrders(...args),
}));

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

describe('GH-1058 — BatchDetailModalBody', () => {
  beforeEach(() => {
    jest.clearAllMocks();

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
});
