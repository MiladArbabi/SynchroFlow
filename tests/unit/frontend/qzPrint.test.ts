// SHOP-REVIEW-BARCODE-PRINT-05 — printViaQz structured dispatch result.
//
// Proves the reviewer-safe contract of apps/frontend/src/utils/qzPrint.ts:
//   - default printer is looked up BEFORE any QZ websocket connect
//   - no default printer  → { status: 'fallback', reason: 'no_default_printer' }
//     and qz.websocket.connect is NEVER called
//   - printer + QZ down   → 'qz_unavailable'
//   - printer + QZ + ok   → { status: 'dispatched', printerName }
//   - printer + print err → 'qz_failed'
//   - the PDF blob is dispatched to QZ as a base64 pdf pixel job
//
// qz-tray itself is fully mocked — this test never touches a websocket.
// jest.mock factory refs must be `mock`-prefixed (babel-jest hoist rule).

const mockConnect = jest.fn<Promise<void>, unknown[]>();
const mockIsActive = jest.fn<boolean, []>();
const mockPrint = jest.fn<Promise<void>, [unknown, unknown]>();
const mockConfigsCreate = jest.fn((name: string) => ({ printer: name }));

jest.mock('qz-tray', () => ({
  __esModule: true,
  default: {
    websocket: {
      isActive: () => mockIsActive(),
      connect: (...a: unknown[]) => mockConnect(...a),
    },
    configs: { create: (name: string) => mockConfigsCreate(name) },
    print: (cfg: unknown, data: unknown) => mockPrint(cfg, data),
  },
}));

import { printViaQz } from 'utils/qzPrint';

function axiosWithDefaultPrinter(osName: string | null) {
  return {
    get: jest.fn(async (url: string) => {
      if (url.includes('/printers/default/')) {
        return { data: osName ? { printer: { os_printer_name: osName } } : {} };
      }
      throw new Error('unexpected url ' + url);
    }),
  };
}

function pdf(): Blob {
  const b = new Blob(['%PDF-1.4 mock'], { type: 'application/pdf' });
  if (typeof b.arrayBuffer !== 'function') {
    (b as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = async () =>
      new TextEncoder().encode('%PDF-1.4 mock').buffer;
  }
  return b;
}

beforeEach(() => {
  mockConnect.mockReset().mockResolvedValue(undefined);
  mockIsActive.mockReset().mockReturnValue(false);
  mockPrint.mockReset().mockResolvedValue(undefined);
  mockConfigsCreate.mockClear();
});

describe('printViaQz — SHOP-REVIEW-BARCODE-PRINT-05', () => {
  it('QZ1 — no default printer → fallback/no_default_printer, QZ connect NOT attempted', async () => {
    const axios = axiosWithDefaultPrinter(null);
    const result = await printViaQz(pdf(), 'product_label', axios as never);

    expect(result).toEqual({ status: 'fallback', reason: 'no_default_printer' });
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockPrint).not.toHaveBeenCalled();
  });

  it('QZ2 — printer configured but QZ unavailable → fallback/qz_unavailable', async () => {
    const axios = axiosWithDefaultPrinter('Zebra ZD410');
    mockIsActive.mockReturnValue(false);
    mockConnect.mockRejectedValue(new Error('ECONNREFUSED localhost:8182'));

    const result = await printViaQz(pdf(), 'location_label', axios as never);

    expect(result).toEqual({ status: 'fallback', reason: 'qz_unavailable' });
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockPrint).not.toHaveBeenCalled();
  });

  it('QZ3 — printer + QZ connected + print succeeds → dispatched with printer name', async () => {
    const axios = axiosWithDefaultPrinter('Zebra ZD410');
    mockIsActive.mockReturnValue(true);

    const result = await printViaQz(pdf(), 'location_label', axios as never);

    expect(result).toEqual({ status: 'dispatched', printerName: 'Zebra ZD410' });
    expect(mockPrint).toHaveBeenCalledTimes(1);
  });

  it('QZ4 — printer + qz.print throws → fallback/qz_failed', async () => {
    const axios = axiosWithDefaultPrinter('Zebra ZD410');
    mockIsActive.mockReturnValue(true);
    mockPrint.mockRejectedValue(new Error('QZ: printer offline'));

    const result = await printViaQz(pdf(), 'location_label', axios as never);

    expect(result).toEqual({ status: 'fallback', reason: 'qz_failed' });
  });

  it('QZ5 — the PDF blob is dispatched as a base64 pdf pixel job for the configured printer', async () => {
    const axios = axiosWithDefaultPrinter('DYMO LabelWriter');
    mockIsActive.mockReturnValue(true);

    await printViaQz(pdf(), 'product_label', axios as never);

    expect(mockConfigsCreate).toHaveBeenCalledWith('DYMO LabelWriter');
    const [, data] = mockPrint.mock.calls[0];
    expect(Array.isArray(data)).toBe(true);
    expect((data as Array<Record<string, unknown>>)[0]).toEqual(
      expect.objectContaining({ type: 'pixel', format: 'pdf', flavor: 'base64' }),
    );
    expect(typeof (data as Array<{ data: string }>)[0].data).toBe('string');
    expect((data as Array<{ data: string }>)[0].data.length).toBeGreaterThan(0);
  });
});
