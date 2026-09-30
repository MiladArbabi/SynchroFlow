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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

    // Opening the canonical confirmation is not completion.
    fireEvent.click(screen.getByRole('button', { name: 'Confirm bin is empty' }));
    const dialog = await screen.findByRole('dialog');
    expect(props.onCompleteOpening).not.toHaveBeenCalled();

    // "Go back" cancels without completing.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(props.onCompleteOpening).not.toHaveBeenCalled();

    // Only the explicit confirmation completes the bin, exactly once.
    fireEvent.click(screen.getByRole('button', { name: 'Confirm bin is empty' }));
    fireEvent.click(within(await screen.findByRole('dialog'))
      .getByRole('button', { name: 'Confirm empty bin' }));

    await waitFor(() => expect(props.onCompleteOpening).toHaveBeenCalledTimes(1));
    expect(props.onCompleteOpening.mock.calls[0][0]).toBe(TASK_ID);
    expect(props.onCloseTask).not.toHaveBeenCalled();
  });
});

// #1164 — first-time Opening Inventory count coaching. The session only
// renders the shared SpotlightCoachMark; dismissal/persistence belongs to the
// app-layer useSpotlight('opening_inventory_count') injected by the page.
describe('CONTRACT-1164-UI-06 — Opening Inventory count Spotlight', () => {
  const SPOTLIGHT = 'opening-inventory-count-spotlight';
  const spotlight = (isDismissed = false) => ({ isDismissed, dismiss: jest.fn() });

  it('shows the coach mark for an opening_inventory session that has not been dismissed', async () => {
    const props = { ...buildProps(openingTask, []), openingInventorySpotlight: spotlight() };
    renderSession(props as ReturnType<typeof buildProps>);

    expect(await screen.findByTestId(SPOTLIGHT)).toBeInTheDocument();
  });

  it('does not block execution: bin confirmation and product scanning still work with the mark present', async () => {
    const props = { ...buildProps(openingTask, []), openingInventorySpotlight: spotlight() };
    renderSession(props as ReturnType<typeof buildProps>);

    const scanInput = await confirmBin(OPENING_BIN);
    expect(scanInput).toBeEnabled();
    scan('BC-1164-V');
    await waitFor(() => expect(props.onCreateOpeningLine).toHaveBeenCalledTimes(1));
  });

  it('ordinary cycle recount never shows the Opening Inventory mark', async () => {
    const cycleTask: OpeningCountingTask = {
      ...openingTask, purpose: 'cycle_count', scope_location_code: null, line_count: 1,
    };
    const props = { ...buildProps(cycleTask, [{ ...discoveredLine, location_code: 'A-1' }]), openingInventorySpotlight: spotlight() };
    renderSession(props as ReturnType<typeof buildProps>);

    expect(await screen.findByPlaceholderText('Scan bin barcode')).toBeInTheDocument();
    expect(screen.queryByTestId(SPOTLIGHT)).not.toBeInTheDocument();
  });

  it('a dismissed mark stays hidden, and dismissing delegates to the injected persistence callback', async () => {
    const dismissed = { ...buildProps(openingTask, []), openingInventorySpotlight: spotlight(true) };
    const { unmount } = render(<CountingSessionPage {...(dismissed as unknown as CountingSessionPageProps)} />);
    expect(await screen.findByPlaceholderText('Scan bin barcode')).toBeInTheDocument();
    expect(screen.queryByTestId(SPOTLIGHT)).not.toBeInTheDocument();
    unmount();

    const live = spotlight();
    renderSession({ ...buildProps(openingTask, []), openingInventorySpotlight: live } as ReturnType<typeof buildProps>);
    const mark = await screen.findByTestId(SPOTLIGHT);
    fireEvent.click(within(mark).getByRole('button', { name: 'Got it' }));
    expect(live.dismiss).toHaveBeenCalledTimes(1);
  });

  it('without an injected spotlight the session renders unchanged (no mark)', async () => {
    renderSession(buildProps(openingTask, []));
    expect(await screen.findByPlaceholderText('Scan bin barcode')).toBeInTheDocument();
    expect(screen.queryByTestId(SPOTLIGHT)).not.toBeInTheDocument();
  });
});

// #1164 — initial Opening Inventory uses a real pre-execution Brief.
// Assignment creates dispatched work; opening the task must not claim it.
// Claim & Start Count is the explicit execution boundary.
describe('CONTRACT-1164-UI-07 — Opening Inventory Brief before execution', () => {
  const dispatchedOpeningTask: OpeningCountingTask = {
    ...openingTask,
    status: 'dispatched',
    claimed_by: null,
    claimed_at: null,
    claim_generation: null,
  };

  it('renders a Brief for assigned dispatched opening work without claiming or exposing scanner execution', async () => {
    const props = renderSession(buildProps(dispatchedOpeningTask, []));

    expect(
      await screen.findByRole('heading', { name: /opening inventory|opening stock|count inventory/i })
    ).toBeInTheDocument();

    expect(screen.getByText(OPENING_BIN)).toBeInTheDocument();
    expect(screen.getByText(/Shopify.*reference/i)).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: /claim.*start.*count/i })
    ).toBeInTheDocument();

    expect(props.onClaimTask).not.toHaveBeenCalled();

    expect(
      screen.queryByPlaceholderText('Scan bin barcode')
    ).not.toBeInTheDocument();

    expect(
      screen.queryByPlaceholderText('Scan product barcode')
    ).not.toBeInTheDocument();
  });

  it('claims exactly once from the Brief and enters execution only after claim succeeds', async () => {
    let resolveClaim: () => void = () => undefined;

    const props = buildProps(dispatchedOpeningTask, []);
    props.onClaimTask = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClaim = resolve;
        })
    );

    renderSession(props);

    const start = await screen.findByRole('button', {
      name: /claim.*start.*count/i,
    });

    fireEvent.click(start);
    fireEvent.click(start);

    expect(props.onClaimTask).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByPlaceholderText('Scan bin barcode')
    ).not.toBeInTheDocument();

    resolveClaim();

    expect(
      await screen.findByPlaceholderText('Scan bin barcode')
    ).toBeInTheDocument();

    expect(props.onClaimTask).toHaveBeenCalledTimes(1);
  });

  it('claim failure stays on the Brief and remains retryable without exposing execution', async () => {
    const props = buildProps(dispatchedOpeningTask, []);
    props.onClaimTask = jest
      .fn()
      .mockRejectedValueOnce(new Error('Claim unavailable'))
      .mockResolvedValueOnce(undefined);

    renderSession(props);

    const start = await screen.findByRole('button', {
      name: /claim.*start.*count/i,
    });

    fireEvent.click(start);

    expect(
      await screen.findByText(/Claim unavailable|Failed to start/i)
    ).toBeInTheDocument();

    expect(
      screen.queryByPlaceholderText('Scan bin barcode')
    ).not.toBeInTheDocument();

    expect(start).toBeEnabled();

    fireEvent.click(start);

    expect(
      await screen.findByPlaceholderText('Scan bin barcode')
    ).toBeInTheDocument();

    expect(props.onClaimTask).toHaveBeenCalledTimes(2);
  });

  it('already claimed opening work resumes execution directly without showing the Brief or claiming again', async () => {
    const props = renderSession(buildProps(openingTask, []));

    expect(
      await screen.findByPlaceholderText('Scan bin barcode')
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: /claim.*start.*count/i })
    ).not.toBeInTheDocument();

    expect(props.onClaimTask).not.toHaveBeenCalled();
  });
});

// #1164 / WAREHOUSE-FOCUS-SHELL — the protected task session begins at the
// Brief: Brief is focused; claim/start changes ownership and execution phase,
// not shell ownership; failed claim stays on the protected Brief;
// already-active canonical work restores focus on re-entry.
describe('CONTRACT-1164-UI-08 — Opening Inventory execution focus', () => {
  const dispatchedOpeningTask: OpeningCountingTask = {
    ...openingTask,
    status: 'dispatched',
    claimed_by: null,
    claimed_at: null,
    claim_generation: null,
  };

  it('reports focused while dispatched Opening Inventory is on the protected Brief', async () => {
    const onExecutionFocusChange = jest.fn();
    const props = {
      ...buildProps(dispatchedOpeningTask, []),
      onExecutionFocusChange,
    };

    render(
      <CountingSessionPage
        {...(props as unknown as CountingSessionPageProps)}
      />
    );

    expect(
      await screen.findByRole('button', { name: /claim.*start.*count/i })
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(onExecutionFocusChange).toHaveBeenCalledWith(true)
    );

    expect(onExecutionFocusChange).not.toHaveBeenCalledWith(false);
  });

  it('stays focused through a successful Claim & Start Count into execution', async () => {
    const onExecutionFocusChange = jest.fn();
    const props = {
      ...buildProps(dispatchedOpeningTask, []),
      onExecutionFocusChange,
    };

    render(
      <CountingSessionPage
        {...(props as unknown as CountingSessionPageProps)}
      />
    );

    const start = await screen.findByRole('button', {
      name: /claim.*start.*count/i,
    });

    fireEvent.click(start);

    expect(
      await screen.findByPlaceholderText('Scan bin barcode')
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(onExecutionFocusChange).toHaveBeenCalledWith(true)
    );
  });

  it('failed claim stays focused on the protected Brief', async () => {
    const onExecutionFocusChange = jest.fn();
    const props = {
      ...buildProps(dispatchedOpeningTask, []),
      onClaimTask: jest.fn().mockRejectedValue(new Error('Claim unavailable')),
      onExecutionFocusChange,
    };

    render(
      <CountingSessionPage
        {...(props as unknown as CountingSessionPageProps)}
      />
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: /claim.*start.*count/i,
      })
    );

    expect(
      await screen.findByText(/Claim unavailable/i)
    ).toBeInTheDocument();

    expect(
      screen.queryByPlaceholderText('Scan bin barcode')
    ).not.toBeInTheDocument();

    expect(onExecutionFocusChange).toHaveBeenLastCalledWith(true);
    expect(onExecutionFocusChange).not.toHaveBeenCalledWith(false);
  });

  it('already-claimed Opening Inventory restores focused execution on re-entry', async () => {
    const onExecutionFocusChange = jest.fn();
    const props = {
      ...buildProps(openingTask, []),
      onExecutionFocusChange,
    };

    render(
      <CountingSessionPage
        {...(props as unknown as CountingSessionPageProps)}
      />
    );

    expect(
      await screen.findByPlaceholderText('Scan bin barcode')
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(onExecutionFocusChange).toHaveBeenCalledWith(true)
    );
  });
});

// #1164 — the protected shell hides app chrome from the Brief onward, so every
// pre-bin phase carries its own exit. Leave count is session exit only
// (onComplete with no finished label): it never claims, counts or completes.
describe('CONTRACT-1164-UI-10 — protected pre-bin phases have a non-mutating exit', () => {
  const dispatchedOpeningTask: OpeningCountingTask = {
    ...openingTask,
    status: 'dispatched',
    claimed_by: null,
    claimed_at: null,
    claim_generation: null,
  };

  const expectNoCountMutation = (props: ReturnType<typeof buildProps>) => {
    expect(props.onRecordCount).not.toHaveBeenCalled();
    expect(props.onSkipLine).not.toHaveBeenCalled();
    expect(props.onCreateFinding).not.toHaveBeenCalled();
    expect(props.onCreateOpeningLine).not.toHaveBeenCalled();
    expect(props.onCompleteOpening).not.toHaveBeenCalled();
    expect(props.onCloseTask).not.toHaveBeenCalled();
  };

  const expectPlainExit = (props: ReturnType<typeof buildProps>) => {
    expect(props.onComplete).toHaveBeenCalledTimes(1);
    expect(props.onComplete.mock.calls[0]).toEqual([]);
  };

  it('the Brief offers Leave count, which exits without claiming or mutating count data', async () => {
    const props = renderSession(buildProps(dispatchedOpeningTask, []));

    expect(await screen.findByRole('button', { name: /claim.*start.*count/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leave count' }));

    expectPlainExit(props);
    expect(props.onClaimTask).not.toHaveBeenCalled();
    expectNoCountMutation(props);
  });

  it('after a failed claim the operator stays on the Brief and Leave count remains available', async () => {
    const props = renderSession({
      ...buildProps(dispatchedOpeningTask, []),
      onClaimTask: jest.fn().mockRejectedValue(new Error('Claim unavailable')),
    });

    fireEvent.click(await screen.findByRole('button', { name: /claim.*start.*count/i }));
    expect(await screen.findByText(/Claim unavailable/i)).toBeInTheDocument();

    const leave = screen.getByRole('button', { name: 'Leave count' });
    expect(leave).toBeEnabled();
    fireEvent.click(leave);

    expectPlainExit(props);
    expect(props.onClaimTask).toHaveBeenCalledTimes(1);
    expectNoCountMutation(props);
  });

  it('the location confirmation phase offers Leave count, which exits without recording or completing anything', async () => {
    const props = renderSession(buildProps(openingTask, []));

    const input = await screen.findByPlaceholderText('Scan bin barcode');
    fireEvent.change(input, { target: { value: OPENING_BIN } });
    fireEvent.click(screen.getByRole('button', { name: 'Leave count' }));

    expectPlainExit(props);
    expectNoCountMutation(props);
    expect(screen.queryByPlaceholderText('Scan product barcode')).not.toBeInTheDocument();
  });
});
