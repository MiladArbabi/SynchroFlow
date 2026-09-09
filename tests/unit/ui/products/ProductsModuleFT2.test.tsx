import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductsModuleFT2 } from '@lasyncro/products';
import type { ProductsModuleFT2Props } from '@lasyncro/products';

describe('ProductsModuleFT2 (fallback layout)', () => {
  // The module uses useNavigate(), so every render needs router context.
  //
  // These two cases previously asserted the pre-Sprint-4 FT2 CNS copy
  // ("Products detected", "Consistent product data", …), which the current
  // Inventory implementation no longer renders. They now assert the stable
  // contract that actually survives: the module renders, the Inventory header
  // is present, and with no mapContent supplied it stays on the legacy layout
  // rather than the INV-UX-01 live-intelligence branch.

  it('renders the legacy layout when no map surface is supplied', () => {
    const props = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        productsObserved: 10,
        variantsObserved: 12,
        productsWithSkuCount: 12,
        productsWithoutSkuCount: 0,
        statusCounts: null,
      },
      operatorSummary: {
        sellability: {
          sellable: 8,
          blocked: 0,
          blockedReasons: { noSku: 0, noInventory: 0, zeroStock: 0, phantom: 0 },
        },
        topReturned: [],
        demand: null,
        inbound: null,
        warehouse: null,
        finances: null,
      },
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

    // Fallback branch marker — "Action queue" exists only in the legacy body.
    expect(screen.getByText('Action queue')).toBeInTheDocument();

    // The map-only rail must not appear without a map surface.
    expect(screen.queryByText('Needs a decision')).toBeNull();
  });

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
// INV-UX-01 Slice 2B — live-intelligence map layout
// ===========================================================================
// The module never decides map eligibility; it only leases the left slot. When
// mapContent is supplied it must render the map + compact decision rail and
// must NOT render the legacy parent detail sections.

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

  it('renders the supplied map surface alongside the decision rail and pulse', () => {
    renderWithMap();

    expect(screen.getByTestId('map-surface')).toBeInTheDocument();
    expect(screen.getByText('Inventory pulse')).toBeInTheDocument();
    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
  });

  it('does not render the legacy parent detail sections in the map branch', () => {
    renderWithMap();

    expect(screen.queryByText('Action queue')).toBeNull();
    expect(screen.queryByText('Inbound pipeline')).toBeNull();
    expect(screen.queryByText('Return leakage')).toBeNull();
  });

  it('previews at most three decision groups and defers the rest', () => {
    renderWithMap();

    // Seven candidate groups are authoritative in this fixture; the rail shows
    // three and offers the remainder rather than listing every problem class.
    expect(screen.getByText(/See \d+ more/)).toBeInTheDocument();
  });

  it('omits the decision rail entirely when no authoritative problem exists', () => {
    render(
      <MemoryRouter>
        <ProductsModuleFT2
          {...baseProps}
          operatorSummary={{
            ...operatorSummary,
            topReturned: [],
            demand: {
              ...operatorSummary.demand,
              critical_reorder_count: 0,
              stockout_count: 0,
              dead_capital_value: 0,
              reorder_now: [],
            },
            inbound: { ...operatorSummary.inbound, overdue_pos: [] },
            warehouse: { ...operatorSummary.warehouse, variants_with_stock_no_bin: 0 },
            sellability: {
              ...operatorSummary.sellability,
              blockedReasons: { ...operatorSummary.sellability.blockedReasons, noSku: 0 },
            },
          } as unknown as ProductsModuleFT2Props['operatorSummary']}
          mapContent={<div data-testid="map-surface" />}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('map-surface')).toBeInTheDocument();
    expect(screen.queryByText('Needs a decision')).toBeNull();
    expect(screen.getByText('Inventory pulse')).toBeInTheDocument();
  });
});
