import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CanvasEditor } from '../../../../modules/floor-planning/src/ui/components/CanvasEditor';
import FloorPlanningModuleFT2, { type WarehouseZone } from '../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2';
import { validateGeometry } from '../../../../apps/backend/src/api/floor-planning/geometry.validation';

const bin: WarehouseZone = {
  location_code: 'BIN-S2C', type: 'bin', parent_location_code: 'ROOT', barcode: null,
  active: true, children_count: 0, position_x: 2, position_y: 2, width: 2, depth: 1,
  orientation: 90, rack_levels: 3, zone_type: 'pick', last_printed_at: null, warehouse_name: null,
};
const root: WarehouseZone = { ...bin, location_code: 'ROOT', type: 'warehouse', parent_location_code: null,
  width: 20, depth: 15, position_x: 0, position_y: 0, rack_levels: null, orientation: 0 };
function select(container: HTMLElement) {
  fireEvent.mouseDown(container.querySelector('[data-zone-code="BIN-S2C"]')!);
  fireEvent.mouseUp(window);
}
function deferred() {
  let resolve!: () => void; let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => jest.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
  width: 1200, height: 800, top: 0, right: 1200, bottom: 800, left: 0, x: 0, y: 0, toJSON: () => ({}),
}));
afterEach(() => jest.restoreAllMocks());

it('manual decimals preserve exact JSON payloads accepted by S2A', async () => {
  const update = jest.fn().mockResolvedValue(undefined);
  const { container } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  for (const raw of ['0.3', '2.3', '1.001', '999.999']) {
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: raw } });
    await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
    const payload = JSON.parse(JSON.stringify(update.mock.calls.at(-1)![1]));
    expect(payload.width).toBe(Number(raw));
    expect(() => validateGeometry(payload)).not.toThrow();
  }
});

it('manual invalid geometry and fractional levels are not submitted', async () => {
  const update = jest.fn().mockResolvedValue(undefined);
  const { container } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  for (const [label, values] of [['Width', ['12junk', '-1', '0', '1000', '1.0001', 'Infinity', '1e1']],
    ['Position X', ['-1', '100000', '0.0001']], ['Levels', ['1.9', '1e1', '0', '21']]] as const) {
    for (const raw of values) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: raw } });
      await act(async () => fireEvent.blur(screen.getByLabelText(label)));
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    }
  }
  expect(update).not.toHaveBeenCalled();
});

it('blank and unchanged inputs do not mutate; explicit clear uses null and paired coordinates', async () => {
  const update = jest.fn().mockResolvedValue(undefined);
  const { container } = render(<CanvasEditor zones={[root, { ...bin, width: 1.001 }]} onUpdateZone={update} />);
  select(container);
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '' } });
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  expect(update).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Clear width' })));
  expect(update).toHaveBeenLastCalledWith('BIN-S2C', { width: null });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Clear position' })));
  expect(update).toHaveBeenLastCalledWith('BIN-S2C', { position_x: null, position_y: null });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Clear levels' })));
  expect(update).toHaveBeenLastCalledWith('BIN-S2C', { rack_levels: null });
});

it('Enter and blur submit once, block completion while pending, and malformed drafts do not lock completion', async () => {
  const save = deferred(); const update = jest.fn(() => save.promise); const changeMode = jest.fn();
  const { container } = render(<FloorPlanningModuleFT2 data={{ zones: [root, bin], product_barcodes: [] }}
    isLoading={false} isError={false} onRefresh={jest.fn()} mode="edit" onModeChange={changeMode} onUpdateZone={update} />);
  select(container);
  const input = screen.getByLabelText('Width');
  fireEvent.change(input, { target: { value: '2.301' } });
  fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.blur(input);
  expect(update).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Done editing' })).toBeDisabled();
  await act(async () => save.resolve());
  fireEvent.blur(input);
  expect(update).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: 'bad' } });
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Done editing' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  expect(changeMode).toHaveBeenCalledWith('inspect');
  fireEvent.change(input, { target: { value: '2.301' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Done editing' })).toBeEnabled());
});

it('legacy-worsening floor settings are blocked and manual floor precision is preserved', async () => {
  const update = jest.fn().mockResolvedValue(undefined);
  const { rerender } = render(<CanvasEditor zones={[{ ...root, width: 10, depth: 8 }, { ...bin, position_x: 12 }]} onUpdateZone={update} />);
  fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));
  fireEvent.change(screen.getByLabelText('Floor width'), { target: { value: '9' } });
  expect(screen.getByRole('button', { name: 'Save & continue' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('BIN-S2C');
  rerender(<CanvasEditor zones={[{ ...root, width: 10, depth: 8 }]} onUpdateZone={update} />);
  fireEvent.change(screen.getByLabelText('Floor width'), { target: { value: '10.301' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save & continue' })));
  expect(update).toHaveBeenLastCalledWith('ROOT', { width: 10.301, depth: 8 });
});

it('400/422 rejection preserves actionable messages and affected codes for retry', async () => {
  const update = jest.fn().mockRejectedValueOnce({ response: { status: 422, data: {
    message: 'Locations must stay inside the warehouse boundary.', location_codes: ['BIN-S2C', 'EDGE-02'],
  } } }).mockResolvedValue(undefined);
  const { container } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '3' } });
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  expect(screen.getByRole('alert')).toHaveTextContent('warehouse boundary');
  expect(screen.getByRole('alert')).toHaveTextContent('EDGE-02');
  expect(screen.getByLabelText('Width')).toHaveValue('2');
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  expect(update).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '3' } });
  await act(async () => fireEvent.keyDown(screen.getByLabelText('Width'), { key: 'Enter' }));
  expect(update).toHaveBeenCalledTimes(2);
});

it('rejected single drag restores preview, clears the gesture, and normalizes its JSON numbers', async () => {
  const save = deferred(); const update = jest.fn(() => save.promise);
  const { container } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  const node = container.querySelector('[data-zone-code="BIN-S2C"]')!;
  const before = node.getAttribute('transform');
  fireEvent.mouseDown(node, { clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 118, clientY: 100 }); fireEvent.mouseUp(window);
  expect(node.getAttribute('transform')).not.toBe(before);
  const payload = JSON.parse(JSON.stringify(update.mock.calls[0][1]));
  expect(() => validateGeometry(payload)).not.toThrow();
  await act(async () => save.reject({ response: { status: 400, data: { error: 'Bad geometry' } } }));
  expect(node.getAttribute('transform')).toBe(before);
  fireEvent.mouseMove(window, { clientX: 300, clientY: 300 });
  expect(node.getAttribute('transform')).toBe(before);
  fireEvent.mouseUp(window);
  expect(update).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent('Bad geometry');
});

it('accepted Inspector edits supersede earlier successful drag geometry', async () => {
  let current = bin;
  const update = jest.fn(async (_code, patch) => { current = { ...current, ...patch }; });
  const { container, rerender } = render(<CanvasEditor zones={[root, current]} onUpdateZone={update} />);
  const node = container.querySelector('[data-zone-code="BIN-S2C"]')!;
  fireEvent.mouseDown(node, { clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 160, clientY: 100 });
  await act(async () => fireEvent.mouseUp(window));
  rerender(<CanvasEditor zones={[root, current]} onUpdateZone={update} />);
  fireEvent.change(screen.getByLabelText('Position X'), { target: { value: '4.301' } });
  await act(async () => fireEvent.blur(screen.getByLabelText('Position X')));
  rerender(<CanvasEditor zones={[root, current]} onUpdateZone={update} />);
  const transform = node.getAttribute('transform')!.match(/translate\(([-\d.]+),([-\d.]+)\)/)!;
  expect(Number(transform[1]) / Number(transform[2])).toBeCloseTo(4.301 / 2);
});

it('single resize rejection restores size, ends the gesture and allows retry', async () => {
  const save = deferred(); const update = jest.fn().mockImplementationOnce(() => save.promise).mockResolvedValue(undefined);
  const { container } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  const node = container.querySelector('[data-zone-code="BIN-S2C"]')!;
  const body = () => node.querySelector('rect[x="0"][y="0"]')!;
  const handle = () => node.querySelector('rect[style*="nwse-resize"]')!;
  const before = body().getAttribute('width');
  fireEvent.mouseDown(handle(), { clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 140, clientY: 120 }); fireEvent.mouseUp(window);
  expect(body().getAttribute('width')).not.toBe(before);
  expect(() => validateGeometry(JSON.parse(JSON.stringify(update.mock.calls[0][1])))).not.toThrow();
  await act(async () => save.reject({ response: { status: 422, data: { message: 'Outside boundary', location_codes: ['BIN-S2C'] } } }));
  expect(body().getAttribute('width')).toBe(before);
  fireEvent.mouseMove(window, { clientX: 300, clientY: 300 }); fireEvent.mouseUp(window);
  expect(body().getAttribute('width')).toBe(before);
  expect(update).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent('BIN-S2C');
  fireEvent.mouseDown(handle(), { clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 140, clientY: 120 });
  await act(async () => fireEvent.mouseUp(window));
  expect(update).toHaveBeenCalledTimes(2);
});

it('coordinate autosave submits a valid pair and exact maximum values', async () => {
  const update = jest.fn().mockResolvedValue(undefined);
  const { container } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  fireEvent.change(screen.getByLabelText('Position X'), { target: { value: '99999.999' } });
  await act(async () => fireEvent.blur(screen.getByLabelText('Position X')));
  expect(update).toHaveBeenLastCalledWith('BIN-S2C', { position_x: 99999.999, position_y: 2 });
  expect(() => validateGeometry(JSON.parse(JSON.stringify(update.mock.calls[0][1])))).not.toThrow();
});

it('server rejection restores geometry and keeps completion available before reset', async () => {
  const update = jest.fn().mockRejectedValue({ response: { status: 422, data: { message: 'Outside boundary', location_codes: ['BIN-S2C'] } } });
  const { container } = render(<FloorPlanningModuleFT2 data={{ zones: [root, bin], product_barcodes: [] }} isLoading={false} isError={false}
    onRefresh={jest.fn()} mode="edit" onUpdateZone={update} />);
  select(container);
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '3' } });
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  expect(screen.getByLabelText('Width')).toHaveValue('2');
  expect(screen.getByRole('button', { name: 'Done editing' })).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Outside boundary');
  fireEvent.click(screen.getByRole('button', { name: 'Reset draft' }));
  expect(screen.getByRole('button', { name: 'Done editing' })).toBeEnabled();
});

it('explicitly cleared coordinates cannot resurrect the previous companion value', async () => {
  const update = jest.fn().mockResolvedValue(undefined);
  const { container } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Clear position' })));
  fireEvent.change(screen.getByLabelText('Position X'), { target: { value: '3' } });
  await act(async () => fireEvent.blur(screen.getByLabelText('Position X')));
  expect(update).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent('both X and Y');
});

it('blank floor dimensions preserve persisted numeric-string values as numeric payloads', async () => {
  const update = jest.fn().mockResolvedValue(undefined);
  const persisted = { ...root, width: '10.001', depth: '8.001' } as unknown as WarehouseZone;
  render(<CanvasEditor zones={[persisted]} onUpdateZone={update} />);
  fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));
  fireEvent.change(screen.getByLabelText('Floor width'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Floor depth'), { target: { value: '8.002' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save & continue' })));
  expect(update).toHaveBeenLastCalledWith('ROOT', { width: 10.001, depth: 8.002 });
});


it('recovery: first pointer reset does not autosave the focused rejected draft', async () => {
  const user = userEvent.setup();
  const update = jest.fn().mockRejectedValue({ response: { status: 422, data: { message: 'Outside boundary' } } });
  const { container } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  const width = screen.getByLabelText('Width');
  await user.clear(width); await user.type(width, '999.999'); await user.tab();
  expect(update).toHaveBeenCalledTimes(1);
  await user.click(width);
  await user.click(screen.getByRole('button', { name: 'Reset draft' }));
  expect(update).toHaveBeenCalledTimes(1);
  expect(width).toHaveValue('2');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('recovery: rollback leaves unrelated saves and subsequent corrections usable', async () => {
  const update = jest.fn().mockRejectedValueOnce({ response: { status: 422, data: { message: 'Outside boundary' } } }).mockResolvedValue(undefined);
  const { container } = render(<FloorPlanningModuleFT2 data={{ zones: [root, bin], product_barcodes: [] }} isLoading={false} isError={false}
    onRefresh={jest.fn()} mode="edit" onUpdateZone={update} />);
  select(container);
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '999.999' } });
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  expect(screen.getByLabelText('Width')).toHaveValue('2');
  expect(screen.getByRole('alert')).toHaveTextContent('Outside boundary');
  fireEvent.change(screen.getByLabelText('Depth'), { target: { value: '1.5' } });
  await act(async () => fireEvent.blur(screen.getByLabelText('Depth')));
  expect(screen.getByLabelText('Depth')).toHaveValue('1.5');
  expect(screen.getByRole('button', { name: 'Done editing' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '3.001' } });
  expect(screen.getByRole('button', { name: 'Done editing' })).toBeEnabled();
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  expect(screen.getByRole('button', { name: 'Done editing' })).toBeEnabled();
  expect(screen.getByTitle('Close inspector')).toBeEnabled();
  fireEvent.mouseDown(screen.getByTestId('floor-planning-canvas'));
  expect(screen.queryByLabelText('Width')).not.toBeInTheDocument();
});

it.each(['resolve', 'reject'] as const)('recovery: keyboard reset discards pending draft before delayed %s', async outcome => {
  const user = userEvent.setup(); const save = deferred(); const update = jest.fn(() => save.promise);
  const { container } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '3' } });
  fireEvent.keyDown(screen.getByLabelText('Width'), { key: 'Enter' });
  const reset = screen.getByRole('button', { name: 'Reset draft' });
  expect(reset).toBeEnabled();
  act(() => reset.focus()); await user.keyboard('{Enter}');
  expect(screen.getByLabelText('Width')).toHaveValue('2');
  await act(async () => outcome === 'resolve' ? save.resolve() : save.reject({ response: { status: 422, data: { message: 'Outside boundary' } } }));
  expect(screen.getByLabelText('Width')).toHaveValue('2');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(update).toHaveBeenCalledTimes(1);
});


it.each(['{Enter}', ' '] as const)('recovery: keyboard traversal to reset does not retry rejection (%s)', async key => {
  const user = userEvent.setup();
  const update = jest.fn().mockRejectedValue({ response: { status: 422, data: { message: 'Outside boundary' } } });
  const { container } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  const width = screen.getByLabelText('Width');
  fireEvent.change(width, { target: { value: '999.999' } });
  await act(async () => fireEvent.keyDown(width, { key: 'Enter' }));
  await user.click(width);
  // Width -> depth -> X -> Y -> levels -> four clears -> reset.
  for (let i = 0; i < 9; i++) await user.tab();
  expect(screen.getByRole('button', { name: 'Reset draft' })).toHaveFocus();
  await user.keyboard(key);
  expect(update).toHaveBeenCalledTimes(1);
  expect(width).toHaveValue('2');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('recovery: saving blocks lifecycle, duplicate, delete, print, breadcrumbs and resize', async () => {
  const save = deferred(); const update = jest.fn(() => save.promise);
  const create = jest.fn(); const remove = jest.fn(); const print = jest.fn();
  const parent = { ...bin, location_code: 'PARENT', type: 'lane', parent_location_code: 'ROOT' };
  const { container } = render(<CanvasEditor zones={[root, parent, { ...bin, parent_location_code: 'PARENT' }]} onUpdateZone={update}
    onCreateZone={create} onDeleteZone={remove} onPrintBarcode={print} />);
  select(container);
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '999.999' } });
  fireEvent.blur(screen.getByLabelText('Width'));
  expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDisabled();
  fireEvent.click(screen.getByTitle('Duplicate zone'));
  fireEvent.click(screen.getByText('Delete', { exact: true }));
  fireEvent.click(screen.getByText('Print location label'));
  fireEvent.click(screen.getByText('PARENT', { selector: 'div' }));
  expect(screen.getByLabelText('Width')).toHaveValue('999.999');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const handle = container.querySelector('[data-zone-code="BIN-S2C"] rect[style*="nwse-resize"]')!;
  fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 140, clientY: 120 });
  await act(async () => fireEvent.mouseUp(window));
  expect(update).toHaveBeenCalledTimes(1);
  expect(create).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(print).not.toHaveBeenCalled();
  await act(async () => save.reject({ response: { status: 422, data: { message: 'Outside boundary' } } }));
  expect(screen.getByLabelText('Width')).toHaveValue('2');
  expect(screen.getByRole('button', { name: 'Deactivate' })).toBeEnabled();
});


it.each([400, 422])('rejection UX: %s rolls back to last acceptance without locking or retrying', async status => {
  const update = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce({ response: { status, data: { message: 'Outside warehouse boundary', location_codes: ['BIN-S2C'] } } });
  const changeMode = jest.fn();
  const { container } = render(<FloorPlanningModuleFT2 data={{ zones: [root, bin], product_barcodes: [] }} isLoading={false} isError={false}
    onRefresh={jest.fn()} mode="edit" onModeChange={changeMode} onUpdateZone={update} />);
  select(container);
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '3.001' } });
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '999.999' } });
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  expect(screen.getByLabelText('Width')).toHaveValue('3.001');
  expect(screen.getByRole('alert')).toHaveTextContent('Outside warehouse boundary');
  expect(screen.getByRole('alert')).toHaveTextContent('BIN-S2C');
  expect(screen.getByRole('button', { name: 'Done editing' })).toBeEnabled();
  expect(screen.getByTitle('Close inspector')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Deactivate' })).toBeEnabled();
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  expect(update).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '4.125' } });
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  expect(update).toHaveBeenLastCalledWith('BIN-S2C', { width: 4.125 });
  expect(screen.getByLabelText('Width')).toHaveValue('4.125');
  fireEvent.click(screen.getByTitle('Close inspector'));
  select(container);
  fireEvent.mouseDown(screen.getByTestId('floor-planning-canvas'));
  expect(screen.queryByLabelText('Width')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  expect(changeMode).toHaveBeenCalledWith('inspect');
});

it('rejection UX: malformed draft is visible without locking unrelated interactions', () => {
  const update = jest.fn();
  const { container } = render(<FloorPlanningModuleFT2 data={{ zones: [root, bin], product_barcodes: [] }} isLoading={false} isError={false}
    onRefresh={jest.fn()} mode="edit" onUpdateZone={update} />);
  select(container);
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '12junk' } });
  fireEvent.blur(screen.getByLabelText('Width'));
  expect(screen.getByLabelText('Width')).toHaveAttribute('aria-invalid', 'true');
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Done editing' })).toBeEnabled();
  expect(screen.getByTitle('Close inspector')).toBeEnabled();
  fireEvent.click(screen.getByTitle('Close inspector'));
  expect(screen.queryByLabelText('Width')).not.toBeInTheDocument();
});

it.each(['resolve', 'reject'] as const)('rejection UX: delayed %s cannot overwrite newer authoritative geometry', async outcome => {
  const save = deferred(); const update = jest.fn(() => save.promise);
  const { container, rerender } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '999.999' } });
  fireEvent.keyDown(screen.getByLabelText('Width'), { key: 'Enter' });
  // First the mutation cache is optimistic; then a newer authoritative value arrives.
  rerender(<CanvasEditor zones={[root, { ...bin, width: 999.999 }]} onUpdateZone={update} />);
  rerender(<CanvasEditor zones={[root, { ...bin, width: 4.125 }]} onUpdateZone={update} />);
  await act(async () => outcome === 'resolve' ? save.resolve() : save.reject({ response: { status: 422, data: { message: 'Outside boundary' } } }));
  expect(screen.getByLabelText('Width')).toHaveValue('4.125');
  const body = container.querySelector('[data-zone-code="BIN-S2C"] rect[x="0"][y="0"]')!;
  expect(Number(body.getAttribute('width')) / Number(body.getAttribute('height'))).toBeCloseTo(4.125);
  expect(screen.getByTitle('Close inspector')).toBeEnabled();
  expect(update).toHaveBeenCalledTimes(1);
});


it('rejection UX: optimistic props do not become rollback values or cause another PATCH', async () => {
  const save = deferred(); const update = jest.fn(() => save.promise);
  const { container, rerender } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  fireEvent.change(screen.getByLabelText('Width'), { target: { value: '999.999' } });
  fireEvent.keyDown(screen.getByLabelText('Width'), { key: 'Enter' });
  rerender(<CanvasEditor zones={[root, { ...bin, width: 999.999 }]} onUpdateZone={update} />);
  await act(async () => save.reject({ response: { status: 422, data: { message: 'Outside boundary' } } }));
  expect(screen.getByLabelText('Width')).toHaveValue('2');
  await act(async () => fireEvent.blur(screen.getByLabelText('Width')));
  expect(update).toHaveBeenCalledTimes(1);
  rerender(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  expect(screen.getByLabelText('Width')).toHaveValue('2');
});


it.each(['resolve', 'reject'] as const)('rejection UX: stale paired %s preserves newer authoritative coordinates', async outcome => {
  const save = deferred(); const update = jest.fn(() => save.promise);
  const { container, rerender } = render(<CanvasEditor zones={[root, bin]} onUpdateZone={update} />);
  select(container);
  fireEvent.change(screen.getByLabelText('Position X'), { target: { value: '999' } });
  fireEvent.change(screen.getByLabelText('Position Y'), { target: { value: '5' } });
  fireEvent.keyDown(screen.getByLabelText('Position X'), { key: 'Enter' });
  rerender(<CanvasEditor zones={[root, { ...bin, position_x: 999, position_y: 5 }]} onUpdateZone={update} />);
  rerender(<CanvasEditor zones={[root, { ...bin, position_x: 4.125 }]} onUpdateZone={update} />);
  await act(async () => outcome === 'resolve' ? save.resolve() : save.reject({ response: { status: 422, data: { message: 'Outside boundary' } } }));
  expect(screen.getByLabelText('Position X')).toHaveValue('4.125');
  expect(screen.getByLabelText('Position Y')).toHaveValue('2');
  await act(async () => fireEvent.blur(screen.getByLabelText('Position Y')));
  expect(update).toHaveBeenCalledTimes(1);
});
