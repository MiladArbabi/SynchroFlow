// #1164 — opening_inventory zero-line counting session.
//
// Renders CountingSessionPage directly with controlled props (same precedent
// as RecountLeaveSemantics.test.tsx): every side effect is an injected
// callback, so each contract below is asserted on which callback fires.
//
// CONTRACT-1164-UI-01: a claimed opening task with zero lines still makes its
//   frozen scope_location_code the active bin and asks for bin confirmation —
//   never a dead 0-of-0 session.
// CONTRACT-1164-UI-02: after confirmation the scan input stays enabled even
//   though the active bin has zero lines.
// CONTRACT-1164-UI-03: a resolved variant absent from the lines is added via
//   the opening-line callback, not the unexpected_item finding path.
// CONTRACT-1164-UI-04: ordinary recount keeps the unexpected_item finding path.
// CONTRACT-1164-UI-05: a zero-line opening bin is not implicitly complete;
//   explicit operator completion invokes the opening-complete callback.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CountingSessionPage, {
  type CountingLine,
  type CountingSessionPageProps,
  type CountingTask,
} from '../../../../modules/wms/src/ui/pages/CountingSessionPage';

const TASK_ID = 'task-1164';
const OPENING_BIN = 'PICK-01';
const VARIANT_V = 'variant-1164-v';

type OpeningCountingTask = CountingTask & {
  purpose: 'opening_inventory' | 'cycle_count';
  scope_location_code: string | null;
};

const openingTask: OpeningCountingTask = {
  recount_task_id: TASK_ID,
  label: 'CNT-1-1164',
  status: 'claimed',
  scope: 'location',
  blind: true,
  assigned_to: 7,
  claimed_by: 7,
  created_at: '2026-09-26T00:00:00.000Z',
  claimed_at: '2026-09-26T00:00:00.000Z',
  claim_generation: 'gen-1164',
  line_count: 0,
  counted_count: 0,
  purpose: 'opening_inventory',
  scope_location_code: OPENING_BIN,
};

const discoveredLine: CountingLine = {
  recount_line_id: 'line-1164-v',
  lasyncro_variant_id: VARIANT_V,
  location_code: OPENING_BIN,
  counted_quantity: null,
  count_method: null,
  scan_count: null,
  counted_at: null,
  skip_reason: null,
  skipped_at: null,
  product_title: 'Discovered product',
  variant_title: null,
  sku: 'SKU-1164-V',
  image_url: null,
};

function buildProps(task: OpeningCountingTask, lines: CountingLine[]) {
  return {
    task,
    onComplete: jest.fn(),
    onFetchLines: jest.fn().mockResolvedValue(lines),
    onFetchFindings: jest.fn().mockResolvedValue([]),
    onCreateFinding: jest.fn().mockResolvedValue({}),
    onClaimTask: jest.fn().mockResolvedValue(undefined),
    onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_V }),
    onRecordCount: jest.fn().mockResolvedValue(undefined),
    onSkipLine: jest.fn().mockResolvedValue(undefined),
    onCloseTask: jest.fn().mockResolvedValue(undefined),
    // #1164 opening-specific callbacks.
    onCreateOpeningLine: jest.fn().mockResolvedValue(discoveredLine),
    onCompleteOpening: jest.fn().mockResolvedValue(undefined),
  };
}

function renderSession(props: ReturnType<typeof buildProps>) {
  render(<CountingSessionPage {...(props as CountingSessionPageProps)} />);
  return props;
}

async function confirmBin(code: string) {
  const input = await screen.findByPlaceholderText('Scan bin barcode');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm bin' }));
  return screen.findByPlaceholderText('Scan product barcode');
}

function scan(value: string) {
  const input = screen.getByPlaceholderText('Scan product barcode');
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('CONTRACT-1164-UI-01 — zero-line opening task establishes its frozen bin', () => {
  it('asks the operator to confirm PICK-01 instead of rendering a dead 0-of-0 session', async () => {
    renderSession(buildProps(openingTask, []));

    expect(await screen.findByPlaceholderText('Scan bin barcode')).toBeInTheDocument();
    expect(screen.getAllByText(OPENING_BIN).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\b0 of 0\b/)).not.toBeInTheDocument();
  });
});

describe('CONTRACT-1164-UI-02 — scan stays enabled on an empty opening bin', () => {
  it('keeps the product scan input enabled after PICK-01 is confirmed', async () => {
    renderSession(buildProps(openingTask, []));

    const scanInput = await confirmBin(OPENING_BIN);

    expect(scanInput).toBeEnabled();
  });
});

describe('CONTRACT-1164-UI-03 — discovered variant uses the opening-line path', () => {
  it('calls the opening-line callback and never opens the unexpected_item finding path', async () => {
    const props = renderSession(buildProps(openingTask, []));
    await confirmBin(OPENING_BIN);

    scan('BC-1164-V');

    await waitFor(() => expect(props.onCreateOpeningLine).toHaveBeenCalledTimes(1));
    const [taskId, params] = props.onCreateOpeningLine.mock.calls[0];
    expect(taskId).toBe(TASK_ID);
    expect(params).toMatchObject({ lasyncro_variant_id: VARIANT_V });
    // The server owns the location: the client never proposes one.
    expect(params).not.toHaveProperty('location_code');

    expect(props.onCreateFinding).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Record finding' })).not.toBeInTheDocument();
  });
});

describe('CONTRACT-1164-UI-04 — ordinary recount keeps the unexpected_item path', () => {
  it('records an unexpected_item finding for a resolved variant absent from expected lines', async () => {
    const expectedLine: CountingLine = {
      ...discoveredLine,
      recount_line_id: 'line-1164-expected',
      lasyncro_variant_id: 'variant-1164-expected',
      location_code: 'A-1',
    };
    const cycleTask: OpeningCountingTask = {
      ...openingTask,
      purpose: 'cycle_count',
      scope_location_code: null,
      line_count: 1,
    };
    const props = renderSession(buildProps(cycleTask, [expectedLine]));
    await confirmBin('A-1');

    scan('BC-1164-V');

    fireEvent.click(await screen.findByRole('button', { name: 'Record finding' }));

    await waitFor(() => expect(props.onCreateFinding).toHaveBeenCalledTimes(1));
    expect(props.onCreateFinding).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({
        lasyncro_variant_id: VARIANT_V,
        location_code: 'A-1',
        finding_type: 'unexpected_item',
      })
    );
    expect(props.onCreateOpeningLine).not.toHaveBeenCalled();
  });
});

describe('CONTRACT-1164-UI-05 — empty opening bin requires explicit completion', () => {
  it('does not auto-complete a zero-line bin and routes explicit completion to the opening-complete callback', async () => {
    const props = renderSession(buildProps(openingTask, []));
    await confirmBin(OPENING_BIN);

    // Zero resolved of zero lines is not completion on its own.
    expect(props.onCompleteOpening).not.toHaveBeenCalled();
    expect(props.onCloseTask).not.toHaveBeenCalled();
    expect(props.onComplete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /complete|finish|empty/i }));

    await waitFor(() => expect(props.onCompleteOpening).toHaveBeenCalledTimes(1));
    expect(props.onCompleteOpening.mock.calls[0][0]).toBe(TASK_ID);
    expect(props.onCloseTask).not.toHaveBeenCalled();
  });
});
