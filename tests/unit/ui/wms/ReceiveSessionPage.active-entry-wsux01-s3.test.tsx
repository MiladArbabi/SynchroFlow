// WS-UX-01 S3 — a Receive job claimed from Purchasing enters the existing WMS
// session as a canonical in_progress job owned by the viewer.
//
// Contract (ratified D1): the existing active-session entry is authoritative.
// Mounting it writes nothing — no artificial provisional count, no count
// confirmation, no claim — and opens the first open line ready to scan.
import { render, screen, waitFor } from '@testing-library/react';
import ReceiveSessionPage, {
  type ReceiveJobLine,
} from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

const CURRENT_USER_ID = 7;

function line(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: 'line-a',
    lasyncro_variant_id: 'variant-a',
    sku: 'S3-A',
    variant_title: 'Default Title',
    description: 'First line',
    quantity_expected: 3,
    image_url: null,
    barcode: '7350000000001',
    product_title: 'First product',
    ...overrides,
  };
}

it('an owned in_progress job opens in inspect on the first open line with no write on entry', async () => {
  const onPersistLineProgress = jest.fn().mockResolvedValue(undefined);
  const onConfirmLineCount = jest.fn().mockResolvedValue(undefined);
  const onClaimJob = jest.fn().mockResolvedValue(undefined);
  const onExecutionFocusChange = jest.fn();

  render(
    <ReceiveSessionPage
      {...({
        receiveJobId: 'job-s3',
        poId: 'po-s3',
        poNumber: 1012,
        supplierName: 'S3 Supplier',
        jobStatus: 'in_progress',
        assignedOperatorId: CURRENT_USER_ID,
        currentUserId: CURRENT_USER_ID,
        closedAt: null,
        actualDeliveryDate: null,
        lines: [
          line(),
          line({ receive_job_line_id: 'line-b', lasyncro_variant_id: 'variant-b', sku: 'S3-B', product_title: 'Second product', barcode: '7350000000002' }),
        ],
        onClaimJob,
        onInspectLine: jest.fn().mockResolvedValue(undefined),
        onReportException: jest.fn().mockResolvedValue(undefined),
        onPersistLineProgress,
        onConfirmLineCount,
        onCloseJob: jest.fn().mockResolvedValue(undefined),
        onComplete: jest.fn(),
        onPrintUnitLabels: jest.fn(),
        onConfirmUnitLabelsPrinted: jest.fn(),
        onResolveBarcode: jest.fn(),
        onRefresh: jest.fn(),
        onExecutionFocusChange,
      } as any)}
    />
  );

  await waitFor(() => expect(onExecutionFocusChange).toHaveBeenCalledWith(true));
  expect(screen.queryByRole('button', { name: /claim & start receive|start receive/i })).toBeNull();
  expect(screen.getAllByText('First product').length).toBeGreaterThan(0);
  expect(screen.getAllByPlaceholderText(/scan barcode/i).length).toBeGreaterThan(0);

  // Let any mount-time effects and queued writes settle before asserting none happened.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(onPersistLineProgress).not.toHaveBeenCalled();
  expect(onConfirmLineCount).not.toHaveBeenCalled();
  expect(onClaimJob).not.toHaveBeenCalled();
});
