// SHOP-REVIEW-BARCODE-PRINT-05 — BP16: per-row product print browser-fallback
// object-URL lifecycle.
//
// The batch PrintPreviewPanel lifecycle is proven by PrintPreviewPanel.test.tsx
// (BP14). This closes the per-row ProductBarcodesTable ambiguity behaviourally:
//
//   A. first per-row Print → browser fallback Blob A → URL.createObjectURL,
//      "Open PDF" / "Download" render, both pointing at URL A
//   B. Print the same row again → browser fallback Blob B → URL A revoked,
//      "Open PDF" now points at URL B (URL B not revoked)
//   C. unmount → URL B revoked
//   + QZ-dispatched path creates NO browser object URL
//   + error path leaves NO stale browser URL and offers Retry
//
// ProductBarcodesTable is an internal (non-exported) component; it is driven
// here through the built FloorPlanningModuleFT2 on the Barcodes → Products tab.
// Only the per-row product print lifecycle is asserted — no other module
// behaviour.

import React from 'react';

jest.mock('@lasyncro/shared/ui', () => ({
  __esModule: true,
  ModuleErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ModuleLoadingSkeleton: () => <div>loading</div>,
  WarehouseGrid: () => <div>grid</div>,
}));
jest.mock('@lasyncro/ui-ft2', () => ({ __esModule: true }), { virtual: true });

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FloorPlanningModuleFT2 } from '../../../../modules/floor-planning/dist/ui/index.js';
import type { PrintSubmitResult } from '../../../../modules/floor-planning/src/ui/components/PrintPreviewPanel';

let created: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
  created = [];
  revoked = [];
  let seq = 0;
  global.URL.createObjectURL = jest.fn(() => {
    const u = `blob:mock/${seq++}`;
    created.push(u);
    return u;
  }) as unknown as typeof URL.createObjectURL;
  global.URL.revokeObjectURL = jest.fn((u: string) => { revoked.push(u); }) as unknown as typeof URL.revokeObjectURL;
  (window.open as unknown) = jest.fn(() => ({}));
});
afterEach(() => cleanup());

function renderModule(onPrintProductBarcode: jest.Mock<Promise<PrintSubmitResult>, [string]>) {
  return render(
    // @ts-expect-error dist default-typed props are looser than the source prop type
    <FloorPlanningModuleFT2
      data={{
        zones: [],
        product_barcodes: [
          { lasyncro_variant_id: 'v-1', sku: 'SKU-1', product_title: 'P1', variant_title: 'Default', barcode: null, lasyncro_barcode: null },
        ],
      }}
      isLoading={false}
      isError={false}
      onRefresh={() => {}}
      activeTab="barcodes"
      activeSubTab="products"
      onPrintProductBarcode={onPrintProductBarcode}
    />,
  );
}

const browser = (): PrintSubmitResult => ({ outcome: 'browser', blob: new Blob(['%PDF']), reason: 'qz_unavailable' });
const anchorHref = (text: RegExp) => screen.getByText(text).closest('a')?.getAttribute('href');

describe('BP16 — per-row product print object-URL lifecycle', () => {
  it('A/B/C — creates, revokes-on-replace, and revokes-on-unmount', async () => {
    const onPrint = jest.fn<Promise<PrintSubmitResult>, [string]>()
      .mockResolvedValueOnce(browser())
      .mockResolvedValueOnce(browser());
    const view = renderModule(onPrint);

    // A — first print → one URL, Open/Download point at it
    fireEvent.click(screen.getByText(/Print label/i));
    await screen.findByText(/Open PDF/i);
    expect(created).toEqual(['blob:mock/0']);
    expect(revoked).toEqual([]);
    expect(anchorHref(/Open PDF/i)).toBe('blob:mock/0');
    expect(anchorHref(/Download/i)).toBe('blob:mock/0');
    expect(screen.getByText(/Download/i).closest('a')).toHaveAttribute('download');

    // B — print the same row again → previous URL revoked, new URL active
    fireEvent.click(screen.getByText(/Print label/i));
    await waitFor(() => expect(created.length).toBe(2));
    expect(revoked).toContain('blob:mock/0');
    expect(revoked).not.toContain('blob:mock/1');
    await waitFor(() => expect(anchorHref(/Open PDF/i)).toBe('blob:mock/1'));

    // C — unmount → last URL revoked
    view.unmount();
    expect(revoked).toContain('blob:mock/1');
  });

  it('QZ-dispatched path creates no browser object URL and shows the printer name', async () => {
    const onPrint = jest.fn<Promise<PrintSubmitResult>, [string]>()
      .mockResolvedValue({ outcome: 'dispatched', printerName: 'Zebra ZD410' });
    renderModule(onPrint);

    fireEvent.click(screen.getByText(/Print label/i));
    expect(await screen.findByText(/sent to zebra zd410/i)).toBeInTheDocument();
    expect(created).toEqual([]);
    expect(screen.queryByRole('link', { name: /open pdf/i })).not.toBeInTheDocument();
  });

  it('error path leaves no stale browser URL and offers Retry', async () => {
    const onPrint = jest.fn<Promise<PrintSubmitResult>, [string]>()
      .mockResolvedValue({ outcome: 'error', message: 'Could not prepare the label. Please try again.' });
    renderModule(onPrint);

    fireEvent.click(screen.getByText(/Print label/i));
    expect(await screen.findByText(/could not prepare the label/i)).toBeInTheDocument();
    expect(screen.getByText(/Retry/i)).toBeInTheDocument();
    expect(created).toEqual([]);
    expect(screen.queryByRole('link', { name: /open pdf/i })).not.toBeInTheDocument();
  });
});
