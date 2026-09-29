// tests/unit/ui/products/ProductsModuleFT2.inventory-state-availability.test.tsx
//
// INVENTORY INTELLIGENCE RED-D — the Inventory state rail distinguishes DATA
// STATUS from FACT VALUE.
//
// Target module props:
//   inventoryStateStatus?: 'loading' | 'ready' | 'error'
//   onRetryInventoryState?: () => void
//   inventoryState.hasInventoryTruth: boolean | null
//
//   loading                      → region mounted, aria-busy, no fact shown as 0
//   error                        → region mounted, "Inventory state unavailable",
//                                  Retry when a callback is supplied, no 0s
//   ready + hasInventoryTruth=false → "Inventory truth not established";
//                                  On hand / Available / Reserved never read as
//                                  confirmed physical 0; Not received may show
//   ready + truth + all-zero     → real 0 values, described "Physically empty"
//   ready + normal truth         → the six facts, no actionable inbox
//
// The rail stays status / orientation only.

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductsModuleFT2 } from '@lasyncro/products';
import type { ProductsModuleFT2Props } from '@lasyncro/products';

const BASE_PROPS = {
  context: {
    period: { from: '2026-08-01', to: '2026-08-31' },
    productsObserved: 10,
    variantsObserved: 12,
    productsWithSkuCount: 9,
    productsWithoutSkuCount: 3,
    statusCounts: null,
  },
  operatorSummary: null,
  dataFreshness: null,
  outcome: null,
  operationalCounts: null,
};

const QUANTITY_LABELS = ['On hand', 'Available', 'Reserved'];
const FACT_LABELS = [...QUANTITY_LABELS, 'Not received', 'Phantom', 'No valid pick location'];

function renderRail(extra: Record<string, unknown>) {
  render(
    <MemoryRouter>
      <ProductsModuleFT2
        {...({ ...BASE_PROPS, mapContent: <div data-testid="map-surface" />, ...extra } as unknown as ProductsModuleFT2Props)}
      />
    </MemoryRouter>
  );
  return screen.getByRole('region', { name: 'Inventory state' });
}

/** Text of the row carrying `label` (label + value), or null when the row is absent. */
function rowText(region: HTMLElement, label: string): string | null {
  const labelEl = within(region).queryByText(label, { selector: 'p, span, div' });
  return labelEl?.parentElement?.textContent ?? null;
}

/** A row value reads as numeric zero (e.g. "0", "0 units"). */
function readsAsZero(text: string | null, label: string): boolean {
  if (text == null) return false;
  return /^0(\s|$)|^0units$|^0SKUs$/.test(text.replace(label, '').trim());
}

describe('Inventory state rail — LOADING', () => {
  it('stays mounted, is marked busy, and shows no fact as 0', () => {
    const region = renderRail({ inventoryStateStatus: 'loading', inventoryState: null });

    expect(region).toHaveAttribute('aria-busy', 'true');
    for (const label of FACT_LABELS) {
      expect(readsAsZero(rowText(region, label), label)).toBe(false);
    }
    expect(within(region).queryByText('Inventory state unavailable')).toBeNull();
  });
});

describe('Inventory state rail — ERROR', () => {
  it('stays mounted, says "Inventory state unavailable", offers Retry, and shows no 0s', () => {
    const onRetry = jest.fn();
    const region = renderRail({
      inventoryStateStatus: 'error',
      inventoryState: null,
      onRetryInventoryState: onRetry,
    });

    expect(within(region).getByText('Inventory state unavailable')).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    for (const label of FACT_LABELS) {
      expect(readsAsZero(rowText(region, label), label)).toBe(false);
    }
  });

  it('offers no Retry control when no retry callback is supplied', () => {
    const region = renderRail({ inventoryStateStatus: 'error', inventoryState: null });

    expect(within(region).getByText('Inventory state unavailable')).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: /retry/i })).toBeNull();
  });
});

describe('Inventory state rail — READY without established truth', () => {
  it('says "Inventory truth not established" and never presents the quantity trio as confirmed 0', () => {
    const region = renderRail({
      inventoryStateStatus: 'ready',
      inventoryState: {
        onHandUnits: 0,
        availableUnits: 0,
        reservedUnits: 0,
        notReceivedCount: 3,
        phantomCount: 0,
        noValidPickLocationCount: 0,
        hasInventoryTruth: false,
      },
    });

    expect(within(region).getByText('Inventory truth not established')).toBeInTheDocument();
    for (const label of QUANTITY_LABELS) {
      expect(readsAsZero(rowText(region, label), label)).toBe(false);
    }
    expect(rowText(region, 'Not received')).toMatch(/3/);
    expect(within(region).queryByText('Physically empty')).toBeNull();
  });
});

describe('Inventory state rail — READY with explicit all-zero truth', () => {
  it('shows real 0 values described as "Physically empty", distinct from no truth', () => {
    const region = renderRail({
      inventoryStateStatus: 'ready',
      inventoryState: {
        onHandUnits: 0,
        availableUnits: 0,
        reservedUnits: 0,
        notReceivedCount: 0,
        phantomCount: 0,
        noValidPickLocationCount: 0,
        hasInventoryTruth: true,
      },
    });

    expect(within(region).getByText('Physically empty')).toBeInTheDocument();
    for (const label of QUANTITY_LABELS) {
      expect(readsAsZero(rowText(region, label), label)).toBe(true);
    }
    expect(within(region).queryByText('Inventory truth not established')).toBeNull();
  });
});

describe('Inventory state rail — READY with normal truth', () => {
  it('keeps the six facts, no status notices, and no actionable controls', () => {
    const region = renderRail({
      inventoryStateStatus: 'ready',
      inventoryState: {
        onHandUnits: 30,
        availableUnits: 21,
        reservedUnits: 9,
        notReceivedCount: 2,
        phantomCount: 1,
        noValidPickLocationCount: 3,
        hasInventoryTruth: true,
      },
    });

    for (const label of FACT_LABELS) {
      expect(rowText(region, label)).not.toBeNull();
    }
    expect(rowText(region, 'On hand')).toMatch(/30/);
    expect(rowText(region, 'Available')).toMatch(/21/);
    expect(rowText(region, 'Reserved')).toMatch(/9/);

    expect(region).not.toHaveAttribute('aria-busy', 'true');
    expect(within(region).queryByText('Inventory state unavailable')).toBeNull();
    expect(within(region).queryByText('Inventory truth not established')).toBeNull();
    expect(within(region).queryByText('Physically empty')).toBeNull();
    expect(within(region).queryAllByRole('button')).toHaveLength(0);
  });
});
