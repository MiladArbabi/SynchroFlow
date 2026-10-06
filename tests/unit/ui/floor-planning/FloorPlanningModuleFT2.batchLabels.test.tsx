import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FloorPlanningModuleFT2, { type WarehouseZone } from '../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2';
import type { PrintSubmitResult } from '../../../../modules/floor-planning/src/ui/components/PrintPreviewPanel';

jest.mock('@lasyncro/shared/ui', () => ({
  ModuleErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ModuleLoadingSkeleton: () => null,
  IsometricCanvas: () => null,
}));
jest.mock('../../../../modules/floor-planning/src/ui/components/CanvasEditor', () => ({
  CanvasEditor: () => null,
  ZONE_COLORS: {}, ZONE_STROKE: {},
}));
jest.mock('jsbarcode', () => ({ __esModule: true, default: jest.fn() }));

it('excludes the passive warehouse from physical labels and submits the displayed eligible count', async () => {
  const stock: WarehouseZone = {
    location_code: 'ROOT-PICK', type: 'bin', parent_location_code: 'MAIN-FLOOR',
    barcode: null, active: true, children_count: 0,
    position_x: 1, position_y: 1, width: 2, depth: 2, orientation: 0,
    rack_levels: 1, zone_type: 'pick', last_printed_at: null, warehouse_name: null,
  };
  const zones: WarehouseZone[] = [
    { ...stock, location_code: 'MAIN-FLOOR', type: 'warehouse', parent_location_code: null, zone_type: null },
    stock,
    { ...stock, location_code: 'AISLE-01', type: 'lane', zone_type: null },
    { ...stock, location_code: 'SHELF-01', type: 'shelf' },
    { ...stock, location_code: 'INACTIVE-01', active: false },
  ];
  const submit = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
    .mockResolvedValue({ outcome: 'dispatched', printerName: 'Synthetic printer' });
  render(<FloorPlanningModuleFT2
    data={{ zones, product_barcodes: [] }} isLoading={false} isError={false}
    onRefresh={jest.fn()} onBatchPrintBarcodes={submit}
  />);

  const batchAction = screen.getByRole('button', { name: /^Labels for \d+ locations$/ });
  const displayedCount = Number(batchAction.textContent?.match(/\d+/)?.[0]);
  fireEvent.click(batchAction);
  fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  const [submittedCodes, formatId] = submit.mock.calls[0];
  expect(submittedCodes).not.toContain('MAIN-FLOOR');
  expect(submittedCodes).toEqual(['AISLE-01', 'ROOT-PICK', 'SHELF-01']);
  expect(submittedCodes).not.toContain('INACTIVE-01');
  expect(displayedCount).toBe(submittedCodes.length);
  expect(displayedCount).toBe(3);
  expect(formatId).toBe('avery-5160');
});
