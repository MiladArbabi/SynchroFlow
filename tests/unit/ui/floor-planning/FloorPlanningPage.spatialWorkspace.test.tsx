/**
 * Architecture B — RED contract only. Real page, module and MemoryRouter.
 * Data hooks and unrelated app chrome are stubbed; child canvas markers prove
 * which existing surface the module mounts, without retesting editor internals
 * or testing renderer internals. No proposed mode/Console props are invented.
 *
 * CanvasEditor root/readiness/selection/deletion contracts remain in their
 * existing suites. Visual dominance, compact controls and full app-level Ops
 * Console composition require manual certification after implementation.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FloorPlanningPage from 'pages/ft2-pages/FloorPlanningPage';
import { ConfigProvider } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';
import type { WarehouseZone } from '../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2';
import type { IsometricCanvasProps } from '../../../../modules/shared/src/ui/IsometricCanvas';

// Same complete zone shape as CanvasEditor.warehouseRoot.test.tsx; no reusable
// helper exists there. One root and one placed stock location suffice here.
const mockStock: WarehouseZone = {
  location_code: 'STOCK-RED-01', type: 'bin', parent_location_code: 'ROOT-RED-01',
  barcode: null, active: true, children_count: 0,
  position_x: 1, position_y: 1, width: 2, depth: 2, orientation: 0,
  rack_levels: 1, zone_type: 'pick', last_printed_at: null, warehouse_name: null,
};
const mockRoot: WarehouseZone = {
  ...mockStock, location_code: 'ROOT-RED-01', type: 'warehouse',
  parent_location_code: null, children_count: 1, zone_type: null,
  position_x: 0, position_y: 0, width: 10, depth: 5,
};

jest.mock('@lasyncro/floor-planning', () => ({
  // Resolve directly to current source, not a potentially stale package dist.
  FloorPlanningModuleFT2: jest.requireActual(
    '../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2',
  ).default,
}), { virtual: true });

jest.mock('@lasyncro/shared/ui', () => ({
  ModuleErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ModuleLoadingSkeleton: () => <div>Loading floor planning</div>,
  WarehouseGrid: () => <div data-testid="warehouse-grid" />,
  IsometricCanvas: ({ onSelect }: Pick<IsometricCanvasProps, 'onSelect'>) => (
    <div data-testid="inspection-workspace">
      <button onClick={() => onSelect?.('STOCK-RED-01')}>Select stock location</button>
    </div>
  ),
}));
jest.mock('../../../../modules/floor-planning/src/ui/components/CanvasEditor', () => ({
  CanvasEditor: () => <div data-testid="layout-authoring" />,
  ZONE_COLORS: {}, ZONE_STROKE: {},
}));
jest.mock('components/ModuleTabBar', () => ({ ModuleTabBar: () => null }));
jest.mock('components/CommercialGate', () => ({
  CommercialGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('hooks/useActivationChecklist', () => ({
  useActivationChecklist: () => ({ minimumMappingReady: true }),
}));
jest.mock('api/axiosConfig', () => ({ axiosInstance: { get: jest.fn() } }));
jest.mock('utils/qzPrint', () => ({ printViaQz: jest.fn() }));
jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: () => ({
    data: {
      zones: [mockRoot, mockStock],
      product_barcodes: [{
        lasyncro_variant_id: 'variant-red-01', sku: 'SKU-RED-01',
        product_title: 'Synthetic product', variant_title: null,
        barcode: 'SYNTHETIC-BARCODE', lasyncro_barcode: null,
      }],
    },
    isLoading: false, isError: false, refetch: jest.fn(),
  }),
}));
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGrid: () => ({ data: { locations: [mockRoot, mockStock] }, isLoading: false }),
  useWarehouseGridOccupancy: () => ({ data: { occupancy: {} } }),
}));
jest.mock('pages/floor-planning/useBinLog', () => ({
  useBinLog: () => ({ data: { events: [] }, isLoading: false }),
}));
jest.mock('pages/floor-planning/useBinStats', () => ({ useBinStats: () => ({ data: undefined }) }));
jest.mock('pages/floor-planning/useZoneManagement', () => {
  const mutation = () => ({ mutateAsync: jest.fn() });
  return {
    useCreateZone: mutation, useDeleteZone: mutation, useDeleteZones: mutation,
    useDuplicateZones: mutation, useUpdateZone: mutation, useUpdateZonePositions: mutation,
    useUpdateProductBarcode: mutation, usePrintBarcode: mutation,
    useBatchPrintBarcodes: mutation, usePrintProductBarcode: mutation,
    useBatchPrintProductBarcodes: mutation,
  };
});

// Test driver uses the existing canonical action, as the app-level trigger does.
// It is outside FloorPlanningPage and supplies no new module public props.
function ConsoleDriver() {
  const { state, dispatch } = useConfig();
  return <>
    <output data-testid="ops-console-state">{String(state.isOpsConsoleOpen)}</output>
    <button onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: true })}>
      Open shared Ops Console
    </button>
  </>;
}

function renderPage(route = '/floor-planning') {
  return render(
    <ConfigProvider>
      <MemoryRouter initialEntries={[route]}>
        <ConsoleDriver />
        <FloorPlanningPage />
      </MemoryRouter>
    </ConfigProvider>,
  );
}

// The selected code legitimately renders more than once (the always-mounted
// bin-log drawer header repeats it), and the rail has no test boundary.
// Identify the rail semantically: nearest container holding both the selected
// code and its contextual location-label action.
function selectedLocationSurface(code: string): HTMLElement {
  let node: HTMLElement | null = screen.getByText(/print (?:bin|location) label/i);
  while (node && within(node).queryAllByText(code).length === 0) node = node.parentElement;
  if (!node) throw new Error(`No surface holds both ${code} and a location-label action`);
  return node;
}

describe('Floor Planning — canonical spatial workspace (RED contract)', () => {
  it('defaults to inspection with an explicit Edit layout action, without authoring', () => {
    renderPage();
    expect(screen.getByTestId('inspection-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('layout-authoring')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Edit layout$/i })).toBeVisible();
  });

  it('enters the existing CanvasEditor through Edit layout and returns through Done editing', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^Edit layout$/i }));
    expect(screen.getByTestId('layout-authoring')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Done editing$/i }));
    expect(screen.getByTestId('inspection-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('layout-authoring')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Edit layout$/i })).toBeVisible();
  });

  it('preserves the legacy setup/canvas deep link as edit mode with an exit to inspection', () => {
    renderPage('/floor-planning?tab=setup&view=canvas');
    expect(screen.getByTestId('layout-authoring')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Done editing$/i }));
    expect(screen.getByTestId('inspection-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('layout-authoring')).not.toBeInTheDocument();
  });

  it('retires permanent Map, Setup and Barcodes tab navigation', () => {
    renderPage();
    // Counts may appear in tab names. Target actual accessible navigation,
    // rather than headings, prose or the unrelated warehouse-level tab bar.
    expect(screen.queryAllByRole('tab', { name: /^(Map|Setup|Barcodes)\b/i })).toHaveLength(0);
  });

  it('does not expose product barcode management even through the former products subtab', () => {
    renderPage('/floor-planning?tab=barcodes&subTab=products');
    // Contractual product-management controls/columns, not incidental prose.
    expect(screen.queryByRole('columnheader', { name: /^Supplier\s*Barcode$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('SKU-RED-01')).not.toBeInTheDocument();
    // A vacuous blank route must not satisfy removal of the former surface.
    expect(screen.getByTestId('inspection-workspace')).toBeInTheDocument();
  });

  it('keeps a contextual location-label action represented when a location is selected', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Select stock location' }));
    expect(screen.getAllByText('STOCK-RED-01').length).toBeGreaterThan(0);
    // Presence only: PDF delivery and editor label behavior belong to existing
    // barcode suites. Do not prescribe a new callback or print implementation.
    expect(screen.getByText(/print (?:bin|location) label/i)).toBeVisible();
  });

  it('withdraws the selected-location rail for shared Ops Console while retaining inspection', () => {
    renderPage();
    expect(screen.getByTestId('ops-console-state')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: 'Select stock location' }));
    const rail = selectedLocationSurface('STOCK-RED-01');
    expect(rail).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open shared Ops Console' }));
    expect(screen.getByTestId('ops-console-state')).toHaveTextContent('true');
    expect(screen.getByTestId('inspection-workspace')).toBeInTheDocument();
    // Rail withdrawn: captured surface unmounted, and no remounted equivalent.
    expect(rail).not.toBeInTheDocument();
    expect(screen.queryByText(/print (?:bin|location) label/i)).not.toBeInTheDocument();
  });
});
