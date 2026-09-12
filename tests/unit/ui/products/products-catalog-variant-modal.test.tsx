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
    renderCatalog('/inventory/catalog?variant=variant-1&tab=stock');

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
        '/inventory/catalog?tab=stock',
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

describe('VariantDetailModalBody spatial context', () => {
  it('does not acquire spatial sources when inventory live map is denied', () => {
    mockUseCommercialAccess.mockReturnValue({
      isResolved: true,
      decide: (capabilityId: string) => ({
        allowed: capabilityId !== 'inventory.live_map',
        reason: 'TIER_TOO_LOW',
      }),
    });

    renderVariantBody();

    expect(mockUseFloorPlanning).toHaveBeenCalledWith(false);
    expect(mockUseVariantWarehouseBins).toHaveBeenCalledWith('variant-1', false);
    expect(screen.getByText('Warehouse map is not available on this plan.')).toBeInTheDocument();
    expect(screen.getByText('MC-CHAR-M')).toBeInTheDocument();
  });

  it('does not acquire spatial sources when floor planning is denied or unresolved', () => {
    mockUseCommercialAccess.mockReturnValue({
      isResolved: true,
      decide: (capabilityId: string) => ({
        allowed: capabilityId !== 'warehouse.floor_planning',
        reason: 'TIER_TOO_LOW',
      }),
    });

    renderVariantBody();

    expect(mockUseFloorPlanning).toHaveBeenCalledWith(false);
    expect(mockUseVariantWarehouseBins).toHaveBeenCalledWith('variant-1', false);

    jest.clearAllMocks();
    mockUseCommercialAccess.mockReturnValue({
      isResolved: false,
      decide: () => ({ allowed: true, reason: 'ALLOWED' }),
    });

    renderVariantBody();

    expect(mockUseFloorPlanning).toHaveBeenCalledWith(false);
    expect(mockUseVariantWarehouseBins).toHaveBeenCalledWith('variant-1', false);
    expect(screen.getByText('Warehouse map availability is still resolving.')).toBeInTheDocument();
  });

  it('feeds distinct authoritative bin codes into focusedBins', () => {
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

    expect(mockUseFloorPlanning).toHaveBeenCalledWith(true);
    expect(mockUseVariantWarehouseBins).toHaveBeenCalledWith('variant-1', true);
    expect(mockIsometricCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        focusedBins: ['A-1', 'B-2'],
        showLegend: false,
        showControls: false,
        disablePan: true,
      }),
    );
    expect(screen.getByText('5 available')).toBeInTheDocument();
  });

  it('renders truthful fallbacks for empty, unpositioned, partial and failed spatial states', () => {
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
    expect(screen.getByText('Stocked locations are not positioned on the mapped floor.')).toBeInTheDocument();
    expect(screen.getByText('4 available · not mapped')).toBeInTheDocument();

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
    expect(mockIsometricCanvas).toHaveBeenLastCalledWith(
      expect.objectContaining({ focusedBins: ['A-1'] }),
    );
    expect(screen.getByText('4 available · not mapped')).toBeInTheDocument();

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
