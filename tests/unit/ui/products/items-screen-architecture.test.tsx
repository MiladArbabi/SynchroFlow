// GH-1208 RED-A — route behavior and current ledger-owner composition.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { ConfigProvider } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';

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
      <section data-testid="entity-detail-modal" data-entity-id={entityId} aria-label={String(title)}>
        <div>{subtitle}</div>
        <button type="button" onClick={onClose}>Close</button>
        {children}
      </section>
    ) : null,
  IsometricCanvas: (props: Record<string, unknown>) =>
    mockIsometricCanvas(props),
}));

import ProductsCatalogPage, { itemCostState } from 'pages/ft2-pages/ProductsCatalogPage';
import ProductsFT2Page from 'pages/ft2-pages/ProductsFT2Page';

const variant: CatalogVariant = {
  lasyncro_variant_id: 'variant-1',
  lasyncro_product_id: 'product-1',
  product_title: 'Merino Crew',
  variant_title: 'Charcoal / M',
  sku: 'MC-CHAR-M',
  image_url: null,
  status: 'active',
  product_type: 'physical',
  on_hand_quantity: 8,
  available_quantity: 6,
  sellable_quantity: 6,
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
  return <div data-testid="location">{location.pathname}{location.search}{location.hash}</div>;
}

function SetConsole() {
  const { dispatch } = useConfig();
  return <>
    <button onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: true })}>open console</button>
    <button onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: false })}>close console</button>
  </>;
}

function renderCatalog(initialEntry: string) {
  return render(
    <ConfigProvider><MemoryRouter initialEntries={[initialEntry]}>
      <SetConsole />
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
    </MemoryRouter></ConfigProvider>,
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


// Keep the real route host, ledger and canonical VariantDetailModalHost.
// Only unrelated Intelligence / shell dependencies are isolated.
jest.mock('@lasyncro/products', () => ({ ProductsModuleFT2: () => null }), { virtual: true });
jest.mock('components/ModuleTabBar', () => ({ ModuleTabBar: () => null }));
jest.mock('components/CommercialGate', () => ({
  CommercialGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('components/ExportDrawer', () => ({ ExportDrawer: () => null }));
jest.mock('pages/ft2-pages/ProductsCostsPage', () => ({ __esModule: true, default: () => null }));
jest.mock('pages/ft2-pages/ProductsWmsReadinessPage', () => ({ __esModule: true, default: () => null }));
jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({ displayCurrency: 'USD', locale: 'en-US', tier: 'growth' }),
}));
jest.mock('hooks/useExchangeRates', () => ({ useExchangeRates: () => ({ rates: {} }) }));
jest.mock('pages/products/useProductsFt2Snapshot', () => ({
  useProductsFt2Snapshot: () => ({ isSuccess: true, data: {} }),
}));
jest.mock('pages/products/useProductsFt2Adapter', () => ({ mapProductsFt2Props: () => ({}) }));
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGridOccupancy: () => ({ data: { occupancy: {} }, isSuccess: true }),
}));

function renderInventory(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/inventory/*" element={<ProductsFT2Page />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('GH-1208 Items route contract', () => {
  it('returns legacy Data Quality to neutral Inventory with query and hash intact', async () => {
    renderInventory('/inventory/data-quality?filter=receive-rejection&search=merino&page=2#details');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/inventory?filter=receive-rejection&search=merino&page=2#details'));
  });

  it('redirects legacy Costs to missing-cost Items while retaining query and hash', async () => {
    renderInventory('/inventory/costs?search=merino&page=2#cost');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/inventory/items?search=merino&page=2&filter=missing-cost#cost'));
  });

  it('preserves an explicit Costs filter rather than replacing it', async () => {
    renderInventory('/inventory/costs?filter=all&variant=variant-1#cost');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/inventory/items?filter=all&variant=variant-1#cost'));
  });

  it('retains the Catalog hash with the legacy query', async () => {
    renderInventory('/inventory/catalog?variant=variant-1&search=merino#identity');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/inventory/items?variant=variant-1&search=merino#identity'));
  });

  it('opens variant inspection at /inventory/items through the canonical host and preserves ledger params on close', async () => {
    renderInventory('/inventory/items?variant=variant-1&search=merino&filter=missing-cost&page=2');

    const modal = screen.queryByTestId('entity-detail-modal');
    expect(modal).toHaveAttribute('data-entity-id', 'variant-1');
    fireEvent.click(within(modal!).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/inventory/items?search=merino&filter=missing-cost&page=2',
      );
    });
  });

  it('migrates the legacy Catalog URL to Items without losing inspection/filter/page parameters', async () => {
    renderInventory('/inventory/catalog?variant=variant-1&search=merino&filter=missing-cost&page=2');

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/inventory/items?variant=variant-1&search=merino&filter=missing-cost&page=2',
      );
    });
    expect(screen.queryByTestId('entity-detail-modal')).toHaveAttribute('data-entity-id', 'variant-1');
  });
});

// Exercise the current ledger owner directly so a missing /items route cannot
// conceal independent composition failures. GREEN may rename this owner.
describe('GH-1208 operational item ledger contract', () => {
  it('uses the ratified cost fallback, prefers server state and excludes unavailable costs from missing-cost results', () => {
    expect(itemCostState({ ...variant, unit_cost: 0 })).toBe('missing');
    expect(itemCostState({ ...variant, unit_cost: -1 })).toBe('missing');
    expect(itemCostState({ ...variant, unit_cost: 12.5 })).toBe('present');
    expect(itemCostState(variant)).toBe('unavailable');
    expect(itemCostState({ ...variant, unit_cost: 0, cost_state: 'unavailable' })).toBe('unavailable');
    const missing = { ...variant, unit_cost: 0 };
    const positive = { ...variant, lasyncro_variant_id: 'positive', variant_title: 'Positive cost', unit_cost: 12.5 };
    const unavailable = { ...variant, lasyncro_variant_id: 'unavailable', variant_title: 'Unavailable cost', unit_cost: 0, cost_state: 'unavailable' as const };
    const absent = { ...variant, lasyncro_variant_id: 'absent', variant_title: 'Absent cost source' };
    mockUseProductsCatalog.mockReturnValue({
      data: { variants: [missing, positive, unavailable, absent] }, isLoading: false, isSuccess: true,
    });
    renderCatalog('/inventory/catalog');
    const filter = screen.getByRole('button', { name: /^Missing cost 1$/i });
    expect(screen.getByRole('row', { name: /Charcoal \/ M/ })).toHaveTextContent('Missing');
    fireEvent.click(filter);
    expect(screen.getByText('Charcoal / M')).toBeInTheDocument();
    expect(screen.queryByText('Positive cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Absent cost source')).not.toBeInTheDocument();
  });

  it('keeps sibling variants independently inspectable instead of aggregating their stock into one product row', () => {
    const sibling: CatalogVariant = {
      ...variant, lasyncro_variant_id: 'variant-2', variant_title: 'Ivory / L', sku: 'MC-IVORY-L',
      on_hand_quantity: 3, available_quantity: 2, sellable_quantity: 2,
    };
    mockUseProductsCatalog.mockReturnValue({
      data: { variants: [variant, sibling] }, isLoading: false, isSuccess: true,
    });
    renderCatalog('/inventory/catalog');

    expect(screen.queryByText('Charcoal / M')).toBeInTheDocument();
    expect(screen.queryByText('Ivory / L')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ivory / L'));
    expect(screen.queryByTestId('entity-detail-modal')).toHaveAttribute('data-entity-id', 'variant-2');
    expect(new URLSearchParams(screen.getByTestId('location').textContent!.split('?')[1]).get('variant'))
      .toBe('variant-2');
  });

  it('exposes Item / Identity / On hand / Available / Unit cost / Signal without a permanent Action column', () => {
    renderCatalog('/inventory/catalog');
    // These are ratified ledger concepts, not incidental page copy or DOM shape.
    const concepts = [/^Item$/i, /^Identity$/i, /^On[ -]hand$/i, /^Available$/i, /^Unit cost$/i, /^Signal$/i];
    expect({
      missing: concepts.filter((label) => screen.queryAllByText(label).length === 0).map(String),
      forbidden: screen.queryAllByText(/^Action$/i).map((node) => node.textContent),
    }).toEqual({ missing: [], forbidden: [] });
  });

  it('retires local attention, Catalog health/drift and the duplicate missing-SKU list', () => {
    mockUseProductsOperatorSummary.mockReturnValue({
      isSuccess: true,
      data: {
        ...operatorData,
        noSkuProducts: [{ productTitle: 'Merino Crew', variants: [{ variantTitle: 'Charcoal / M' }] }],
        sellability: {
          ...operatorData.sellability,
          sellable: 0,
          blocked: 1,
          blockedReasons: { ...operatorData.sellability.blockedReasons, noSku: 1 },
        },
      },
    });
    mockUseProductsCatalog.mockReturnValue({
      data: { variants: [{ ...variant, sku: null }] }, isLoading: false, isSuccess: true,
    });
    renderCatalog('/inventory/catalog');
    const forbidden = [
      /^Needs attention$/i, /^Catalog health$/i, /^Catalog drift$/i,
      /products missing SKU$/i,
    ];
    expect(forbidden.flatMap((name) => screen.queryAllByText(name).map((node) => node.textContent)))
      .toEqual([]);
  });

  it('does not announce healthy stock when subordinate sellability facts are unavailable', () => {
    // Null is allowed by the existing ProductsOperatorSummary boundary.
    // This does not invent a new backend state or use failed requests as zero.
    mockUseProductsOperatorSummary.mockReturnValue({
      isSuccess: true,
      data: {
        ...operatorData,
        sellability: {
          sellable: null, blocked: null,
          blockedReasons: { phantom: null, zeroStock: null, noSku: null, noInventory: null },
        },
      },
    });
    renderCatalog('/inventory/catalog');

    expect(screen.queryByText(/all stock sellable.*nothing blocked/i)).not.toBeInTheDocument();
  });

  it('offers missing-cost filtering in Items rather than requiring the retired Costs screen', () => {
    renderCatalog('/inventory/catalog');
    const filter = screen.queryByRole('button', { name: /missing cost/i })
      ?? screen.queryByRole('checkbox', { name: /missing cost/i })
      ?? screen.queryByRole('link', { name: /missing cost/i });
    expect(filter).toBeInTheDocument();
    // Filtering results need an authoritative cost-state boundary first;
    // this RED assertion protects reachability without inventing that data.
  });

  it('exposes cost CSV import after opening the Items Bulk control', async () => {
    renderCatalog('/inventory/catalog');
    const bulk = screen.queryByRole('button', { name: /bulk/i });
    expect(bulk).toBeInTheDocument();
    fireEvent.click(bulk!);
    await waitFor(() => {
      const name = /import costs csv|(?:upload|import).*csv/i;
      const importCosts = screen.queryByRole('menuitem', { name })
        ?? screen.queryByRole('button', { name })
        ?? screen.queryByRole('link', { name });
      expect(importCosts).toBeInTheDocument();
    });
  });
});


describe('GH-1208 Items visual correction behavior', () => {
  it('withdraws rail content on shared Ops Console open and restores it without remounting either shell track or the primary ledger', () => {
    const { container } = renderCatalog('/inventory/catalog');
    const primary = screen.getByRole('region', { name: 'Items ledger' });
    const primaryTrack = primary.closest('[data-shell-track="primary"]');
    const railTrack = screen.getByRole('complementary', { name: 'Item state' }).closest('[data-shell-track="rail"]');
    const shell = container.querySelector('[data-operational-context-shell]');
    expect(primaryTrack?.parentElement).toBe(shell);
    expect(railTrack?.parentElement).toBe(shell);

    fireEvent.click(screen.getByRole('button', { name: 'open console' }));
    expect(screen.queryByRole('complementary', { name: 'Item state' })).toBeNull();
    expect(railTrack).toHaveAttribute('data-rail-suppressed', 'true');
    expect(railTrack).toBeEmptyDOMElement();
    expect(container.querySelector('[data-shell-track="rail"]')).toBe(railTrack);
    expect(screen.getByRole('region', { name: 'Items ledger' })).toBe(primary);
    expect(primary.closest('[data-shell-track="primary"]')).toBe(primaryTrack);
    expect(container.querySelector('[data-operational-context-shell]')).toBe(shell);

    fireEvent.click(screen.getByRole('button', { name: 'close console' }));
    expect(screen.getByRole('complementary', { name: 'Item state' }).closest('[data-shell-track="rail"]')).toBe(railTrack);
    expect(railTrack).toHaveAttribute('data-rail-suppressed', 'false');
    expect(screen.getByRole('region', { name: 'Items ledger' })).toBe(primary);
  });

  it('keeps quick-filter selection, page reset and search query semantics, with missing cost reachable through Filters', () => {
    mockUseProductsCatalog.mockReturnValue({ data: { variants: [
      { ...variant, scan_identity_issue: true, unit_cost: 0 },
      { ...variant, lasyncro_variant_id: 'unreceived', variant_title: 'Not yet received', has_inventory_record: false, unit_cost: 15 },
    ] }, isSuccess: true, isLoading: false });
    renderCatalog('/inventory/catalog?search=merino&page=2');
    const quick = screen.getByRole('group', { name: 'Item filters' });
    fireEvent.click(within(quick).getByRole('button', { name: 'Identity issues' }));
    expect(within(quick).getByRole('button', { name: 'Identity issues' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent('/inventory/catalog?search=merino&filter=identity-issues');
    expect(screen.queryByText('Not yet received')).toBeNull();
    fireEvent.click(within(quick).getByRole('button', { name: 'Not received' }));
    expect(within(quick).getByRole('button', { name: 'Not received' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Charcoal / M')).toBeNull();
    expect(screen.getByText('Not yet received')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Missing cost' }));
    expect(screen.getByText('Charcoal / M')).toBeInTheDocument();
    expect(screen.queryByText('Not yet received')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/inventory/catalog?search=merino&filter=missing-cost');
    fireEvent.click(within(quick).getByRole('button', { name: 'All' }));
    expect(within(quick).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Not yet received')).toBeInTheDocument();
    expect(screen.getByText('Charcoal / M')).toBeInTheDocument();
  });
});
