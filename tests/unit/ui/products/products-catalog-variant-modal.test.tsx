import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import type { CatalogVariant } from 'pages/products/useProductsCatalog';

const mockUseProductsCatalog = jest.fn();
const mockUseProductsOperatorSummary = jest.fn();
const mockUseCommercialAccess = jest.fn();
const mockUseFloorPlanning = jest.fn();
const mockUseVariantWarehouseBins = jest.fn();
const mockIsometricCanvas = jest.fn((props: Record<string, unknown>) => (
  <div data-testid="isometric-canvas" data-focused-bins={JSON.stringify(props.focusedBins)} />
));

jest.mock('pages/products/useProductsCatalog', () => ({
  useProductsCatalog: () => mockUseProductsCatalog(),
}));

jest.mock('pages/products/useProductsOperatorSummary', () => ({
  useProductsOperatorSummary: () => mockUseProductsOperatorSummary(),
}));

jest.mock('@lasyncro/ui-ft2', () => ({
  FT2PresetSelector: () => null,
}));

jest.mock('runtime/commercialContext', () => ({
  useCommercialAccess: () => mockUseCommercialAccess(),
}));

jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: (...args: unknown[]) => mockUseFloorPlanning(...args),
}));

jest.mock('pages/floor-planning/useVariantWarehouseBins', () => ({
  useVariantWarehouseBins: (...args: unknown[]) =>
    mockUseVariantWarehouseBins(...args),
}));

jest.mock('@lasyncro/shared/ui', () => ({
  OperationalContextShell: jest.requireActual('../../../../modules/shared/src/ui/OperationalContextShell').OperationalContextShell,
  EntityDetailModal: ({ entityId, title, subtitle, onClose, children }: any) =>
    entityId ? (
      <section data-testid="entity-detail-modal" aria-label={String(title)}>
        <div>{subtitle}</div>
        <button type="button" onClick={onClose}>Close</button>
        {children}
      </section>
    ) : null,
  IsometricCanvas: (props: Record<string, unknown>) =>
    mockIsometricCanvas(props),
}));

import ProductsCatalogPage from 'pages/ft2-pages/ProductsCatalogPage';
import { VariantDetailModalBody } from 'pages/ft2-pages/VariantDetailModalBody';

const variant: CatalogVariant = {
  lasyncro_variant_id: 'variant-1',
  lasyncro_product_id: 'product-1',
  product_title: 'Merino Crew',
  variant_title: 'Charcoal / M',
  sku: 'MC-CHAR-M',
  image_url: null,
  status: 'active',
  product_type: 'apparel',
  on_hand_quantity: 8,
  available_quantity: 6,
  sellable_quantity: 5,
  has_inventory_record: true,
};

const operatorData = {
  noSkuProducts: [],
  noInventoryProducts: [],
  sellability: {
    sellable: 1,
    blocked: 0,
    blockedReasons: {
      phantom: 0,
      zeroStock: 0,
      noSku: 0,
      noInventory: 0,
    },
  },
  drift: { addedThisPeriod: 0 },
};

const range = { preset: 'past_30_days' as const, from: null, to: null };

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderCatalog(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/inventory/catalog"
          element={
            <>
              <ProductsCatalogPage range={range} onChange={jest.fn()} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderVariantBody(overrides: Partial<CatalogVariant> = {}) {
  return render(
    <VariantDetailModalBody
      variant={{
        ...variant,
        ...overrides,
      }}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();

  mockUseProductsCatalog.mockReturnValue({
    data: { variants: [variant] },
    isLoading: false,
    isSuccess: true,
  });
  mockUseProductsOperatorSummary.mockReturnValue({
    data: operatorData,
    isSuccess: true,
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
  mockUseVariantWarehouseBins.mockReturnValue({
    data: {
      variant_id: variant.lasyncro_variant_id,
      bins: [
        { location_code: 'A-1', available_quantity: 2 },
      ],
    },
    isLoading: false,
    isError: false,
  });
});

describe('ProductsCatalogPage variant modal', () => {
  it('resolves ?variant from canonical catalog data and closes by removing only variant', async () => {
    renderCatalog('/inventory/catalog?variant=variant-1&tab=stock&search=merino&filter=missing-cost&page=2');

    const modal = screen.getByTestId('entity-detail-modal');

    expect(modal).toHaveAttribute(
      'aria-label',
      'Merino Crew · Charcoal / M',
    );
    expect(within(modal).getByText('SKU MC-CHAR-M')).toBeInTheDocument();
    expect(within(modal).getByText('8')).toBeInTheDocument();
    expect(within(modal).getByText('6')).toBeInTheDocument();
    expect(within(modal).getByText('5')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/inventory/catalog?tab=stock&search=merino&filter=missing-cost&page=2',
      );
    });
  });

  it('clears a stale variant id only after catalog loading completes', async () => {
    mockUseProductsCatalog.mockReturnValue({
      data: { variants: [] },
      isLoading: false,
      isSuccess: true,
    });

    renderCatalog('/inventory/catalog?variant=stale&foo=bar');

    expect(screen.queryByTestId('entity-detail-modal')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/inventory/catalog?foo=bar',
      );
    });
  });

  it('does not clear a deep link while catalog data is still loading', () => {
    mockUseProductsCatalog.mockReturnValue({
      data: undefined,
      isLoading: true,
      isSuccess: false,
    });

    renderCatalog('/inventory/catalog?variant=variant-1&foo=bar');

    expect(screen.getByText('Loading catalog…')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/inventory/catalog?variant=variant-1&foo=bar',
    );
  });
});

describe('GH-1208 canonical Item detail contract', () => {
  it('opens with Identity / Inventory / Cost / Placement facts', () => {
    renderVariantBody();

    // Section concepts are ratified; no wrapper structure or pixel assertions.
    const concepts = [/^Identity$/i, /^Inventory(?: truth)?$/i, /^Cost$/i, /^Placement$/i];
    expect(concepts.filter((name) => screen.queryAllByText(name).length === 0).map(String))
      .toEqual([]);
  });

  it('leaves the isometric warehouse map to Intelligence even when spatial access is allowed', () => {
    renderVariantBody();

    expect(mockIsometricCanvas).not.toHaveBeenCalled();
    expect(screen.queryByTestId('isometric-canvas')).not.toBeInTheDocument();
  });

  it('does not present absent inventory records as numeric zero, while confirmed zero remains visible', () => {
    const { rerender } = renderVariantBody({
      has_inventory_record: true,
      on_hand_quantity: 0,
      available_quantity: 0,
      sellable_quantity: 0,
    });
    // Control: an actual inventory row with zero quantities is known zero.
    expect(screen.queryAllByText('0', { exact: true }).length).toBeGreaterThan(0);

    rerender(
      <VariantDetailModalBody variant={{
        ...variant, has_inventory_record: false,
        on_hand_quantity: 0, available_quantity: 0, sellable_quantity: 0,
      }} />,
    );
    expect(screen.queryAllByText('0', { exact: true }).map((node) => node.textContent)).toEqual([]);
  });

  it('makes per-item unit-cost editing reachable through canonical inspection', () => {
    renderCatalog('/inventory/catalog?variant=variant-1');

    const modal = screen.getByTestId('entity-detail-modal');
    expect(within(modal).queryByRole('button', { name: /edit.*cost|cost.*edit/i }))
      .toBeInTheDocument();
  });
});

describe('VariantDetailModalBody compact placement', () => {
  it('keeps placement independent of Inventory live-map access', () => {
    mockUseCommercialAccess.mockReturnValue({
      isResolved: true,
      decide: (capabilityId: string) => ({
        allowed: capabilityId !== 'inventory.live_map',
        reason: 'TIER_TOO_LOW',
      }),
    });

    renderVariantBody();

    expect(mockUseFloorPlanning).not.toHaveBeenCalled();
    expect(mockUseVariantWarehouseBins).toHaveBeenCalledWith('variant-1', true);
    expect(screen.getByText('2 available')).toBeInTheDocument();
    expect(screen.getByText('MC-CHAR-M')).toBeInTheDocument();
  });

  it('does not acquire placement when floor planning is denied or unresolved', () => {
    mockUseCommercialAccess.mockReturnValue({
      isResolved: true,
      decide: (capabilityId: string) => ({
        allowed: capabilityId !== 'warehouse.floor_planning',
        reason: 'TIER_TOO_LOW',
      }),
    });

    renderVariantBody();

    expect(mockUseFloorPlanning).not.toHaveBeenCalled();
    expect(mockUseVariantWarehouseBins).toHaveBeenCalledWith('variant-1', false);

    jest.clearAllMocks();
    mockUseCommercialAccess.mockReturnValue({
      isResolved: false,
      decide: () => ({ allowed: true, reason: 'ALLOWED' }),
    });

    renderVariantBody();

    expect(mockUseFloorPlanning).not.toHaveBeenCalled();
    expect(mockUseVariantWarehouseBins).toHaveBeenCalledWith('variant-1', false);
    expect(screen.getByText('Placement availability is still resolving.')).toBeInTheDocument();
  });

  it('shows distinct authoritative placement codes and sums their quantities', () => {
    mockUseVariantWarehouseBins.mockReturnValue({
      data: {
        variant_id: 'variant-1',
        bins: [
          { location_code: 'A-1', available_quantity: 2 },
          { location_code: 'A-1', available_quantity: 3 },
          { location_code: 'B-2', available_quantity: 1 },
          { location_code: '', available_quantity: 9 },
        ],
      },
      isLoading: false,
      isError: false,
    });

    renderVariantBody();

    expect(mockUseFloorPlanning).not.toHaveBeenCalled();
    expect(mockUseVariantWarehouseBins).toHaveBeenCalledWith('variant-1', true);
    expect(mockIsometricCanvas).not.toHaveBeenCalled();
    expect(screen.getByText('A-1')).toBeInTheDocument();
    expect(screen.getByText('B-2')).toBeInTheDocument();
    expect(screen.getByText('5 available')).toBeInTheDocument();
  });

  it('renders truthful empty, root, mixed, absent and failed placement states', () => {
    mockUseVariantWarehouseBins.mockReturnValueOnce({
      data: { variant_id: 'variant-1', bins: [] },
      isLoading: false,
      isError: false,
    });
    const { rerender } = render(
      <VariantDetailModalBody variant={variant} />,
    );
    expect(screen.getByText('No sellable stock is currently assigned to a warehouse location.')).toBeInTheDocument();

    mockUseVariantWarehouseBins.mockReturnValueOnce({
      data: { variant_id: 'variant-1', bins: [{ location_code: 'ROOT', available_quantity: 4 }] },
      isLoading: false,
      isError: false,
    });
    rerender(<VariantDetailModalBody variant={variant} />);
    expect(screen.getByText('ROOT')).toBeInTheDocument();
    expect(screen.getByText('4 available')).toBeInTheDocument();

    mockUseVariantWarehouseBins.mockReturnValueOnce({
      data: {
        variant_id: 'variant-1',
        bins: [
          { location_code: 'A-1', available_quantity: 2 },
          { location_code: 'ROOT', available_quantity: 4 },
        ],
      },
      isLoading: false,
      isError: false,
    });
    rerender(<VariantDetailModalBody variant={variant} />);
    expect(mockIsometricCanvas).not.toHaveBeenCalled();
    expect(screen.getByText('A-1')).toBeInTheDocument();
    expect(screen.getByText('ROOT')).toBeInTheDocument();
    expect(screen.getByText('4 available')).toBeInTheDocument();

    mockUseVariantWarehouseBins.mockReturnValueOnce({ data: null, isLoading: false, isError: false });
    rerender(<VariantDetailModalBody variant={variant} />);
    expect(screen.getByText('Placement is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('A-1')).not.toBeInTheDocument();
    expect(screen.queryByText('ROOT')).not.toBeInTheDocument();

    mockUseVariantWarehouseBins.mockReturnValueOnce({
      data: null,
      isLoading: false,
      isError: true,
    });
    rerender(<VariantDetailModalBody variant={variant} />);
    expect(screen.getByText('Warehouse location context is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Merino Crew')).toBeInTheDocument();
  });

  it('distinguishes missing inventory records from honest zero stock', () => {
    const { rerender } = renderVariantBody({
      has_inventory_record: false,
      on_hand_quantity: 0,
      available_quantity: 0,
      sellable_quantity: 0,
    });

    expect(screen.getByText(/No inventory record exists/)).toBeInTheDocument();

    rerender(
      <VariantDetailModalBody
        variant={{
          ...variant,
          has_inventory_record: true,
          on_hand_quantity: 0,
          available_quantity: 0,
          sellable_quantity: 0,
        }}
      />,
    );

    expect(screen.getByText(/all current quantities are zero/)).toBeInTheDocument();
  });
});
