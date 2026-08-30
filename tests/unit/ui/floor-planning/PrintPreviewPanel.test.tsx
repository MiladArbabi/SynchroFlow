// SHOP-REVIEW-BARCODE-PRINT-05 — PrintPreviewPanel reviewer-safe printing.
//
// BP1  existing printable labels render a preview + honest count
// BP2  Print sends EVERY selected id (not just the first sheet)
// BP3  QZ unavailable  → visible browser fallback (Open/Download)
// BP4  no default printer → visible browser fallback
// BP5  qz.print failure → visible browser fallback
// BP6  fallback state exposes Open + Download controls
// BP7  window.open returning null cannot strand the user — controls stay
// BP8  empty selection → Print disabled
// BP9  QZ success → "Sent to <printer>"
// BP10 browser fallback never claims physical print success
// BP11 repeat Print works after a prior fallback
// BP12 error outcome → reviewer-visible error, not console only
// BP13 Print submits ids in the received (already server-ordered) order
// BP14 object URL revoked on replacement and on unmount

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  PrintPreviewPanel,
  type LabelFormat,
  type PrintableLabel,
  type PrintSubmitResult,
} from '../../../../modules/floor-planning/src/ui/components/PrintPreviewPanel';

const FORMATS: LabelFormat[] = [
  { id: 'avery-5160', label: 'Avery 5160 · 24/sheet', labelsPerSheet: 24, columns: 3, labelWidthMm: 66, labelHeightMm: 25, paperSize: 'A4' },
  { id: 'zebra-4x6', label: 'Zebra 4×6', labelsPerSheet: 1, columns: 1, labelWidthMm: 101, labelHeightMm: 152, paperSize: '4x6' },
];

function labels(n: number): PrintableLabel[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `LOC-${String(i).padStart(3, '0')}`,
    code: `LOC-${String(i).padStart(3, '0')}`,
    caption: `Bin ${i}`,
  }));
}

let createdUrls: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
  createdUrls = [];
  revoked = [];
  let seq = 0;
  global.URL.createObjectURL = jest.fn(() => {
    const u = `blob:mock/${seq++}`;
    createdUrls.push(u);
    return u;
  }) as unknown as typeof URL.createObjectURL;
  global.URL.revokeObjectURL = jest.fn((u: string) => { revoked.push(u); }) as unknown as typeof URL.revokeObjectURL;
  (window.open as unknown) = jest.fn(() => ({}));
});
afterEach(() => cleanup());

const pdfBlob = () => new Blob(['%PDF'], { type: 'application/pdf' });

describe('PrintPreviewPanel — SHOP-REVIEW-BARCODE-PRINT-05', () => {
  it('BP1 — renders a preview and an honest label/sheet count', () => {
    render(
      <PrintPreviewPanel items={labels(30)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={jest.fn()} />,
    );
    // 30 labels across 2 sheets of 24
    expect(screen.getByText(/30 labels · 2 sheets/i)).toBeInTheDocument();
    expect(screen.getByText(/sheet 1 of 2/i)).toBeInTheDocument();
  });

  it('BP2 / BP13 — Print submits ALL selected ids in order', async () => {
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValue({ outcome: 'dispatched', printerName: 'Zebra' });
    render(
      <PrintPreviewPanel items={labels(30)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    await waitFor(() => expect(onBatchPrint).toHaveBeenCalledTimes(1));
    const [ids] = onBatchPrint.mock.calls[0];
    expect(ids).toHaveLength(30);
    expect(ids).toEqual(labels(30).map((l) => l.id));
  });

  it('BP3 — QZ unavailable → visible browser fallback', async () => {
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValue({ outcome: 'browser', blob: pdfBlob(), reason: 'qz_unavailable' });
    render(<PrintPreviewPanel items={labels(3)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    expect(await screen.findByText(/ready to print in your browser/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open printable pdf/i })).toBeInTheDocument();
  });

  it('BP4 — no default printer → visible browser fallback', async () => {
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValue({ outcome: 'browser', blob: pdfBlob(), reason: 'no_default_printer' });
    render(<PrintPreviewPanel items={labels(3)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    expect(await screen.findByRole('link', { name: /open printable pdf/i })).toBeInTheDocument();
  });

  it('BP5 — qz.print failure → visible browser fallback', async () => {
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValue({ outcome: 'browser', blob: pdfBlob(), reason: 'qz_failed' });
    render(<PrintPreviewPanel items={labels(3)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    expect(await screen.findByRole('link', { name: /open printable pdf/i })).toBeInTheDocument();
  });

  it('BP6 — fallback exposes both Open and Download controls bound to the same blob URL', async () => {
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValue({ outcome: 'browser', blob: pdfBlob(), reason: 'qz_unavailable' });
    render(<PrintPreviewPanel items={labels(2)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    const open = await screen.findByRole('link', { name: /open printable pdf/i });
    const download = screen.getByRole('link', { name: /download pdf/i });
    expect(open).toHaveAttribute('href', createdUrls[createdUrls.length - 1]);
    expect(download).toHaveAttribute('href', createdUrls[createdUrls.length - 1]);
    expect(download).toHaveAttribute('download');
  });

  it('BP7 — window.open returning null cannot strand the user (controls remain)', async () => {
    (window.open as jest.Mock).mockReturnValue(null);
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValue({ outcome: 'browser', blob: pdfBlob(), reason: 'qz_unavailable' });
    render(<PrintPreviewPanel items={labels(2)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    expect(await screen.findByRole('link', { name: /open printable pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download pdf/i })).toBeInTheDocument();
  });

  it('BP8 — empty selection → Print button disabled', () => {
    render(<PrintPreviewPanel items={[]} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="Nothing selected" onBatchPrint={jest.fn()} />);
    expect(screen.getByRole('button', { name: /print sheet/i })).toBeDisabled();
  });

  it('BP9 — QZ dispatch success → "Sent to <printer>"', async () => {
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValue({ outcome: 'dispatched', printerName: 'Zebra ZD410' });
    render(<PrintPreviewPanel items={labels(3)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    expect(await screen.findByText(/sent to zebra zd410/i)).toBeInTheDocument();
  });

  it('BP10 — browser fallback never claims a physical print happened', async () => {
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValue({ outcome: 'browser', blob: pdfBlob(), reason: 'qz_unavailable' });
    render(<PrintPreviewPanel items={labels(2)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    await screen.findByRole('link', { name: /open printable pdf/i });
    // The outcome describes browser readiness, never a completed physical print.
    expect(screen.getByText(/ready to print in your browser/i)).toBeInTheDocument();
    expect(screen.queryByText(/sent to/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/print(ed|ing) (successfully|complete|to the printer)/i)).not.toBeInTheDocument();
  });

  it('BP11 — a second Print works after a prior browser fallback', async () => {
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValueOnce({ outcome: 'browser', blob: pdfBlob(), reason: 'qz_unavailable' })
      .mockResolvedValueOnce({ outcome: 'dispatched', printerName: 'Zebra' });
    render(<PrintPreviewPanel items={labels(2)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    await screen.findByRole('link', { name: /open printable pdf/i });
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    expect(await screen.findByText(/sent to zebra/i)).toBeInTheDocument();
    expect(onBatchPrint).toHaveBeenCalledTimes(2);
  });

  it('BP12 — an error outcome shows a reviewer-visible message', async () => {
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValue({ outcome: 'error', message: 'Could not generate the labels. Please try again.' });
    render(<PrintPreviewPanel items={labels(2)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    expect(await screen.findByText(/could not generate the labels/i)).toBeInTheDocument();
  });

  it('BP12b — an "empty" outcome shows the refresh-and-retry message', async () => {
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValue({ outcome: 'empty' });
    render(<PrintPreviewPanel items={labels(2)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    expect(await screen.findByText(/no longer available.*refresh/i)).toBeInTheDocument();
  });

  it('BP14 — object URL is revoked when replaced and on unmount', async () => {
    const onBatchPrint = jest.fn<Promise<PrintSubmitResult>, [string[], string]>()
      .mockResolvedValue({ outcome: 'browser', blob: pdfBlob(), reason: 'qz_unavailable' });
    const view = render(<PrintPreviewPanel items={labels(2)} formats={FORMATS} defaultFormatId="avery-5160" emptyMessage="none" onBatchPrint={onBatchPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    await screen.findByRole('link', { name: /open printable pdf/i });
    expect(createdUrls).toHaveLength(1);

    // second print → previous URL revoked, new one created
    fireEvent.click(screen.getByRole('button', { name: /print sheet/i }));
    await waitFor(() => expect(createdUrls.length).toBe(2));
    expect(revoked).toContain(createdUrls[0]);

    // unmount → last URL revoked
    view.unmount();
    expect(revoked).toContain(createdUrls[1]);
  });
});
