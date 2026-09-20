import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('CanvasEditor component palette', () => {
  it('creates Problem Area immediately with registry metadata and the next generated code', async () => {
    const onCreateZone = jest.fn().mockResolvedValue(undefined);
    render(
      <CanvasEditor
        zones={[zone({ location_code: 'problem-01', zone_type: 'quarantine' })]}
        onCreateZone={onCreateZone}
      />,
    );

    expect(screen.getByText('EXCEPTIONS')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/code/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Problem Area' }));

    await waitFor(() => expect(onCreateZone).toHaveBeenCalledTimes(1));
    expect(onCreateZone).toHaveBeenCalledWith(expect.objectContaining({
      location_code: 'PROBLEM-02',
      type: 'bin',
      zone_type: 'problem',
      width: 2,
      depth: 2,
      rack_levels: 1,
      position_x: 2.7,
      position_y: 1.8,
    }));
    expect(screen.queryByPlaceholderText(/code/i)).not.toBeInTheDocument();
  });

  it('uses registry defaults for other palette items', async () => {
    const onCreateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[]} onCreateZone={onCreateZone} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Pick' }));

    await waitFor(() => expect(onCreateZone).toHaveBeenCalledWith(expect.objectContaining({
      location_code: 'PICK-01',
      type: 'bin',
      zone_type: 'pick',
      width: 1,
      depth: 0.5,
      rack_levels: 3,
    })));
  });

  it('keeps visible usable error state and recomputes the same available code on retry', async () => {
    const onCreateZone = jest.fn()
      .mockRejectedValueOnce({ response: { data: { error: 'Creation failed visibly' } } })
      .mockResolvedValueOnce(undefined);
    render(<CanvasEditor zones={[]} onCreateZone={onCreateZone} />);

    const addPack = screen.getByRole('button', { name: 'Add Pack' });
    fireEvent.click(addPack);
    expect(await screen.findByRole('alert')).toHaveTextContent('Creation failed visibly');

    fireEvent.click(addPack);
    await waitFor(() => expect(onCreateZone).toHaveBeenCalledTimes(2));
    expect(onCreateZone.mock.calls[0][0].location_code).toBe('PACK-01');
    expect(onCreateZone.mock.calls[1][0].location_code).toBe('PACK-01');
  });

  it('keeps an existing PROBLEM-prefixed quarantine semantically quarantine', () => {
    render(
      <CanvasEditor
        zones={[zone({ location_code: 'PROBLEM-01', zone_type: 'quarantine' })]}
        onCreateZone={jest.fn()}
      />,
    );

    const renderedCodes = screen.getAllByText('PROBLEM-01');
    fireEvent.mouseDown(renderedCodes[0]);
    expect(screen.getAllByText('quarantine').length).toBeGreaterThan(0);
  });

  it('keeps Duplicate as an explicit unique-code flow', () => {
    render(
      <CanvasEditor
        zones={[zone({ location_code: 'PACK-01', zone_type: 'receive' })]}
        onCreateZone={jest.fn()}
      />,
    );

    const renderedCodes = screen.getAllByText('PACK-01');
    fireEvent.mouseDown(renderedCodes[0]);
    fireEvent.click(screen.getByTitle('Duplicate zone'));
    expect(screen.getByLabelText('New name')).toHaveValue('PACK-01-COPY');
  });
});
