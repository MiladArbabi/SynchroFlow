import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { WarehouseZone } from '../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2';
import { CanvasEditor } from '../../../../modules/floor-planning/src/ui/components/CanvasEditor';

function zone(overrides: Partial<WarehouseZone> = {}): WarehouseZone {
  return {
    location_code: 'ZONE-01',
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: 1,
    position_y: 1,
    width: 2,
    depth: 2,
    orientation: 0,
    rack_levels: 1,
    zone_type: 'pick',
    last_printed_at: null,
    warehouse_name: null,
    ...overrides,
  };
}

function openPaletteItem(label: string) {
  const tile = screen.getByRole('button', { name: `Add ${label}` });
  fireEvent.click(tile);
  return { tile, codeInput: within(tile).getByLabelText('Location code') };
}

describe('CanvasEditor corrected inline creation flow', () => {
  it('expands a required Location code field with the next generated code without creating', () => {
    const onCreateZone = jest.fn();
    render(<CanvasEditor zones={[zone({ location_code: 'PACK-01' })]} onCreateZone={onCreateZone} />);

    const { codeInput } = openPaletteItem('Pack');

    expect(codeInput).toBeRequired();
    expect(codeInput).toHaveValue('PACK-02');
    expect(onCreateZone).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pending-placement-ghost')).not.toBeInTheDocument();
  });

  it('pressing Enter creates at the deterministic centre with canonical defaults and selects the zone', async () => {
    const onCreateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[]} onCreateZone={onCreateZone} />);
    const { codeInput } = openPaletteItem('Pack');

    fireEvent.keyDown(codeInput, { key: 'Enter' });

    await waitFor(() => expect(onCreateZone).toHaveBeenCalledTimes(1));
    expect(onCreateZone).toHaveBeenCalledWith({
      location_code: 'PACK-01',
      type: 'bin',
      zone_type: 'pack',
      position_x: 2.7,
      position_y: 1.8,
      width: 2,
      depth: 1.5,
      rack_levels: 2,
    });
    expect(await screen.findByText('Role')).toBeInTheDocument();
    expect(screen.getAllByText('PACK-01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pack').length).toBeGreaterThan(0);
  });

  it('Add creates with a deliberately replaced uppercase code while role stays Problem Area', async () => {
    const onCreateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[]} onCreateZone={onCreateZone} />);
    const { tile, codeInput } = openPaletteItem('Problem Area');

    fireEvent.change(codeInput, { target: { value: 'quarantine-work' } });
    expect(codeInput).toHaveValue('QUARANTINE-WORK');
    fireEvent.click(within(tile).getByRole('button', { name: 'Add', exact: true }));

    await waitFor(() => expect(onCreateZone).toHaveBeenCalledTimes(1));
    expect(onCreateZone).toHaveBeenCalledWith(expect.objectContaining({
      location_code: 'QUARANTINE-WORK',
      type: 'bin',
      zone_type: 'problem',
      width: 2,
      depth: 2,
      rack_levels: 1,
    }));
    expect(screen.getAllByText('Problem Area').length).toBeGreaterThan(0);
  });

  it('uses Quarantine registry semantics even when its code looks like Problem Area', async () => {
    const onCreateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[]} onCreateZone={onCreateZone} />);
    const { codeInput } = openPaletteItem('Quarantine');
    fireEvent.change(codeInput, { target: { value: 'problem-like-code' } });
    fireEvent.keyDown(codeInput, { key: 'Enter' });

    await waitFor(() => expect(onCreateZone).toHaveBeenCalledWith(expect.objectContaining({
      location_code: 'PROBLEM-LIKE-CODE',
      type: 'bin',
      zone_type: 'quarantine',
    })));
  });

  it('switching palette items replaces the inline form and generated suggestion', () => {
    const onCreateZone = jest.fn();
    render(<CanvasEditor zones={[]} onCreateZone={onCreateZone} />);
    openPaletteItem('Problem Area');
    const { codeInput } = openPaletteItem('Pick');

    expect(screen.getAllByLabelText('Location code')).toHaveLength(1);
    expect(codeInput).toHaveValue('PICK-01');
    expect(onCreateZone).not.toHaveBeenCalled();
  });

  it('keeps visible error state and preserves the typed code for retry', async () => {
    const onCreateZone = jest.fn()
      .mockRejectedValueOnce({ response: { data: { error: 'Code already exists' } } })
      .mockResolvedValueOnce(undefined);
    render(<CanvasEditor zones={[]} onCreateZone={onCreateZone} />);
    const { tile, codeInput } = openPaletteItem('Pack');
    fireEvent.change(codeInput, { target: { value: 'PACK-NORTH' } });

    fireEvent.click(within(tile).getByRole('button', { name: 'Add', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Code already exists');
    expect(codeInput).toHaveValue('PACK-NORTH');
    fireEvent.keyDown(codeInput, { key: 'Enter' });

    await waitFor(() => expect(onCreateZone).toHaveBeenCalledTimes(2));
    expect(onCreateZone.mock.calls[0][0].location_code).toBe('PACK-NORTH');
    expect(onCreateZone.mock.calls[1][0].location_code).toBe('PACK-NORTH');
  });
});

describe('CanvasEditor corrected-flow compatibility', () => {
  it('keeps an existing PROBLEM-prefixed quarantine semantically quarantine', () => {
    render(<CanvasEditor zones={[zone({ location_code: 'PROBLEM-01', zone_type: 'quarantine' })]} onCreateZone={jest.fn()} />);
    fireEvent.mouseDown(screen.getAllByText('PROBLEM-01')[0]);
    expect(screen.getAllByText('Quarantine').length).toBeGreaterThan(0);
  });

  it('keeps location_code immutable while width/depth remain editable in metres', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[zone({ location_code: 'PACK-01', zone_type: 'pack' })]} onCreateZone={jest.fn()} onUpdateZone={onUpdateZone} />);
    fireEvent.mouseDown(screen.getAllByText('PACK-01')[0]);

    expect(screen.queryByLabelText('Location code')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '2.4' } });
    fireEvent.blur(screen.getByLabelText('Width'));
    await waitFor(() => expect(onUpdateZone).toHaveBeenCalledTimes(1));
    expect(onUpdateZone.mock.calls[0][0]).toBe('PACK-01');
    expect(onUpdateZone.mock.calls[0][1].width).toBeCloseTo(2.4);
    expect(Object.keys(onUpdateZone.mock.calls[0][1])).toEqual(['width']);
    expect(screen.getAllByText('PACK-01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pack').length).toBeGreaterThan(0);
  });

  it('keeps Duplicate as an explicit unique-code flow', () => {
    render(<CanvasEditor zones={[zone({ location_code: 'PACK-01', zone_type: 'receive' })]} onCreateZone={jest.fn()} />);
    fireEvent.mouseDown(screen.getAllByText('PACK-01')[0]);
    fireEvent.click(screen.getByTitle('Duplicate zone'));
    expect(screen.getByLabelText('New name')).toHaveValue('PACK-01-COPY');
  });
});
