import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductsModuleFT2 } from '@lasyncro/products';
import type { ProductsModuleFT2Props } from '@lasyncro/products';

describe('ProductsModuleFT2 (no map surface supplied)', () => {
  // The module uses useNavigate(), so every render needs router context.
  //
  // INVENTORY INTELLIGENCE RED-A: the case that asserted the legacy no-map
  // Action queue composition was removed — that composition is not part of
  // the ratified Inventory screen. Null-safety is still worth protecting.

  it('renders null-safe props without crashing and without requiring mapContent', () => {
    const props = {
      context: {
        period: { from: '', to: '' },
        productsObserved: null,
        variantsObserved: null,
        productsWithSkuCount: null,
        productsWithoutSkuCount: null,
        statusCounts: null,
      },
      operatorSummary: null,
      dataFreshness: null,
      outcome: null,
      operationalCounts: null,
    } as unknown as ProductsModuleFT2Props;

    render(
      <MemoryRouter>
        <ProductsModuleFT2 {...props} />
      </MemoryRouter>
    );

    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.queryByText('Needs a decision')).toBeNull();
  });
});

// ===========================================================================
// INVENTORY INTELLIGENCE — Operational Context screen architecture (RED-A)
// ===========================================================================
// The module never decides map eligibility; it only leases the primary slot
// (real map, LiveMapTeaser, or no-floor teaching state all arrive as
// mapContent). The secondary rail is "Inventory state" — permanent physical
// state, not a decision inbox. Ops Console owns actionable attention, so the
// rail withdraws while the shared Console is open and the module owns no
// local Console control.

describe('ProductsModuleFT2 — live intelligence map layout', () => {
  const operatorSummary = {
    sellability: {
      sellable: 8,
      blocked: 2,
      blockedReasons: { noSku: 3, noInventory: 0, zeroStock: 1, phantom: 0 },
    },
    deadWeight: { noSalesCount: 0 },
    drift: { addedThisPeriod: 0 },
    topReturned: [
      {
        variantTitle: 'Blue / M',
        sku: 'SKU-1',
        unitsReturned: 4,
        revenueLeakage: 120,
        returnRatePct: 12,
      },
    ],
    noSkuProducts: [],
    demand: {
      critical_reorder_count: 5,
      warning_reorder_count: 1,
      stockout_count: 1,
      total_inventory_value: 10000,
      dead_capital_value: 2500,
      avg_days_of_stock: 12,
      reorder_now: [
        {
          lasyncro_variant_id: 'v-1',
          sku: 'SKU-1',
          title: 'Item',
          product_title: 'Item',
          days_of_stock_remaining: 0,
          estimated_stockout_date: null,
          velocity_per_day: 1.5,
          suggested_reorder_qty: 20,
        },
      ],
    },
    inbound: {
      open_po_count: 1,
      total_units_expected: 50,
      total_committed_value_cents: 100000,
      overdue_pos: [
        {
          po_short_ref: 'PO-9',
          supplier_name: 'Acme',
          status: 'sent',
          expected_delivery_date: null,
          overdue_days: 4,
          total_units_ordered: 50,
          total_units_received: 0,
          covers_stocked_out_skus: ['v-2'],
        },
      ],
      pending_pos: [],
    },
    warehouse: {
      total_pick_bins: 10,
      stocked_pick_bins: 6,
      pick_zone_occupancy_pct: 60,
      variants_with_stock_no_bin: 2,
    },
    finances: {
      total_margin_at_risk_per_week: 300,
      active_sellers_no_cost: 0,
      stocked_out_margin_variants: [],
    },
  };

  const baseProps = {
    context: {
      period: { from: '2026-08-01', to: '2026-08-31' },
      productsObserved: 10,
      variantsObserved: 12,
      productsWithSkuCount: 9,
      productsWithoutSkuCount: 3,
      statusCounts: null,
    },
    dataFreshness: null,
    outcome: null,
    operationalCounts: null,
  } as unknown as ProductsModuleFT2Props;

  function renderWithMap() {
    return render(
      <MemoryRouter>
        <ProductsModuleFT2
          {...baseProps}
          operatorSummary={operatorSummary as ProductsModuleFT2Props['operatorSummary']}
          mapContent={<div data-testid="map-surface" />}
        />
      </MemoryRouter>
    );
  }

  const INVENTORY_STATE_LABELS = [
    'On hand',
    'Available',
    'Reserved',
    'Not received',
    'Phantom',
    'No valid pick location',
  ];

  function renderWithMapProps(extra: Record<string, unknown>) {
    // suppressInventoryState is the target presentation prop; cast so the
    // contract can be expressed before the module declares it.
    return render(
      <MemoryRouter>
        <ProductsModuleFT2
          {...baseProps}
          operatorSummary={operatorSummary as ProductsModuleFT2Props['operatorSummary']}
          mapContent={<div data-testid="map-surface" />}
          {...(extra as Partial<ProductsModuleFT2Props>)}
        />
      </MemoryRouter>
    );
  }

  it('renders the supplied map surface beside an accessible Inventory state region with the six canonical states', () => {
    renderWithMap();

    expect(screen.getByTestId('map-surface')).toBeInTheDocument();

    const rail = screen.getByRole('region', { name: 'Inventory state' });
    for (const label of INVENTORY_STATE_LABELS) {
      expect(within(rail).getByText(label)).toBeInTheDocument();
    }
  });

  it('renders none of the retired decision / pulse / Stocked out vocabulary', () => {
    renderWithMap();

    expect(screen.queryByText('Needs a decision')).toBeNull();
    expect(screen.queryByText('Inventory pulse')).toBeNull();
    expect(screen.queryByText('Stocked out')).toBeNull();
  });

  it('does not render the legacy parent detail sections in the map branch', () => {
    renderWithMap();

    expect(screen.queryByText('Action queue')).toBeNull();
    expect(screen.queryByText('Inbound pipeline')).toBeNull();
    expect(screen.queryByText('Return leakage')).toBeNull();
  });

  it('suppressInventoryState=false keeps the Inventory state rail present', () => {
    renderWithMapProps({ suppressInventoryState: false });

    expect(screen.getByTestId('map-surface')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Inventory state' })).toBeInTheDocument();
  });

  it('suppressInventoryState toggles the Inventory state rail while the same map surface node stays mounted', () => {
    const mapElement = <div data-testid="map-surface" />;
    const ui = (suppressInventoryState: boolean) => (
      <MemoryRouter>
        <ProductsModuleFT2
          {...baseProps}
          operatorSummary={operatorSummary as ProductsModuleFT2Props['operatorSummary']}
          mapContent={mapElement}
          {...({ suppressInventoryState } as Partial<ProductsModuleFT2Props>)}
        />
      </MemoryRouter>
    );

    // A. rail visible — precondition that makes suppression non-vacuous.
    const { rerender } = render(ui(false));
    expect(screen.getByRole('region', { name: 'Inventory state' })).toBeInTheDocument();
    const mapNode = screen.getByTestId('map-surface');

    // B. suppressed — rail withdrawn, map surface not remounted.
    rerender(ui(true));
    expect(screen.queryByRole('region', { name: 'Inventory state' })).toBeNull();
    expect(screen.getByTestId('map-surface')).toBe(mapNode);

    // C. restored — rail returns, map surface still not remounted.
    rerender(ui(false));
    expect(screen.getByRole('region', { name: 'Inventory state' })).toBeInTheDocument();
    expect(screen.getByTestId('map-surface')).toBe(mapNode);
  });

  it('renders no local Ops Console control', () => {
    renderWithMap();

    expect(screen.queryByRole('button', { name: /ops console/i })).toBeNull();
    expect(screen.queryByText(/ops console/i)).toBeNull();
  });

  it('carries the Inventory orientation copy and no local standalone Live badge', () => {
    renderWithMap();

    expect(
      screen.getByText('Physical stock, availability and inventory truth by location')
    ).toBeInTheDocument();
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByText('LIVE')).toBeNull();
  });

  it('keeps Export available when a handler is supplied', () => {
    const onExport = jest.fn();
    renderWithMapProps({ onExport });

    fireEvent.click(screen.getByText(/Export/));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
