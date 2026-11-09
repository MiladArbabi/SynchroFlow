import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { WarehouseZone } from '../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2';
import { CanvasEditor } from '../../../../modules/floor-planning/src/ui/components/CanvasEditor';

function zone(overrides: Partial<WarehouseZone> = {}): WarehouseZone {
  return {
    location_code: 'BIN-01',
    type: 'bin',
    parent_location_code: 'ROOT-01',
    barcode: null,
    active: true,
    children_count: 0,
    position_x: 3,
    position_y: 2,
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

const warehouse = zone({
  location_code: 'ROOT-01', type: 'warehouse', parent_location_code: null,
  zone_type: null, children_count: 1, position_x: 0, position_y: 0, width: 10, depth: 5,
});


const rack = zone({ location_code: 'RACK-A', rack_levels: 3 });
const child = zone({ location_code: 'RACK-A-S1', parent_location_code: 'RACK-A', barcode: 'legacy shelf label',
  position_x: null, position_y: null, width: null, depth: null, rack_levels: null });

function selectRack(container: HTMLElement) {
  fireEvent.mouseDown(container.querySelector('[data-zone-code="RACK-A"]')!, { clientX: 200, clientY: 150 });
  fireEvent.mouseUp(window);
}

beforeEach(() => {
  jest.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1000, height: 500, top: 0, right: 1000, bottom: 500, left: 0, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => jest.restoreAllMocks());

describe('Inspector child position configuration', () => {
  it('keeps position creation disabled by default, including racks with existing children', () => {
    const create = jest.fn();
    const { container } = render(<CanvasEditor zones={[warehouse, rack, child]} onCreateZone={create} />);
    selectRack(container);
    expect(screen.queryByRole('button', { name: 'Add position' })).not.toBeInTheDocument();
    expect(screen.getByText('RACK-A-S1')).toBeVisible();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates only after confirmation, with explicit identity and no geometry', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const { container, rerender } = render(<CanvasEditor zones={[warehouse, rack]} allowChildPositionConfiguration onCreateZone={create} />);
    selectRack(container);
    fireEvent.click(screen.getByRole('button', { name: 'Add position' }));
    fireEvent.change(screen.getByLabelText(/^Position code/), { target: { value: ' rack-a-s1 ' } });
    fireEvent.change(screen.getByLabelText('Barcode override (optional)'), { target: { value: ' legacy shelf label ' } });
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create position' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ location_code: 'RACK-A-S1', type: 'bin',
      zone_type: 'pick', parent_location_code: 'RACK-A', barcode: 'legacy shelf label' }));
    await waitFor(() => expect(screen.queryByLabelText(/^Position code/)).not.toBeInTheDocument());
    expect(screen.queryByText('RACK-A-S1')).not.toBeInTheDocument();
    rerender(<CanvasEditor zones={[warehouse, rack, child]} allowChildPositionConfiguration onCreateZone={create} />);
    expect(screen.getByText('RACK-A-S1')).toBeVisible();
    expect(container.querySelector('[data-zone-code="RACK-A-S1"]')).toBeNull();
  });

  it('suggests an editable aisle-first code from explicit ancestry and skips used identities', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const aisle = zone({ location_code: 'A', type: 'lane', parent_location_code: 'ROOT-01' });
    const stock = { ...rack, location_code: 'PICK-0A-03', parent_location_code: 'A' };
    const existing = zone({ location_code: 'A-PICK-0A-03-01', parent_location_code: stock.location_code });
    const elsewhere = zone({ location_code: 'OTHER', barcode: 'A-PICK-0A-03-02', active: false });
    const { container } = render(<CanvasEditor zones={[warehouse, aisle, stock, existing, elsewhere]}
      allowChildPositionConfiguration onCreateZone={create} />);
    fireEvent.mouseDown(container.querySelector('[data-zone-code="PICK-0A-03"]')!, { clientX: 200, clientY: 150 });
    fireEvent.mouseUp(window);
    fireEvent.click(screen.getByRole('button', { name: 'Add position' }));
    expect(screen.getByLabelText(/^Position code/)).toHaveValue('A-PICK-0A-03-03');
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Position code/), { target: { value: 'A-PICK-0A-03-XYZ123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create position' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ location_code: 'A-PICK-0A-03-XYZ123',
      type: 'bin', zone_type: 'pick', parent_location_code: 'PICK-0A-03' }));
    expect(stock).toEqual({ ...rack, location_code: 'PICK-0A-03', parent_location_code: 'A' });
    expect(elsewhere.barcode).toBe('A-PICK-0A-03-02');
  });

  it('uses the parent code without inventing aisle ancestry from nearby lanes', () => {
    const create = jest.fn();
    const aisle = zone({ location_code: 'A', type: 'lane', parent_location_code: 'ROOT-01' });
    const { container } = render(<CanvasEditor zones={[warehouse, aisle, rack]}
      allowChildPositionConfiguration onCreateZone={create} />);
    selectRack(container);
    fireEvent.click(screen.getByRole('button', { name: 'Add position' }));
    expect(screen.getByLabelText(/^Position code/)).toHaveValue('RACK-A-01');
    fireEvent.change(screen.getByLabelText(/^Position code/), { target: { value: 'MERCHANT-SHELF' } });
    expect(screen.getByLabelText(/^Position code/)).toHaveValue('MERCHANT-SHELF');
    expect(create).not.toHaveBeenCalled();
  });

  it('does not repeat an aisle prefix already present in the stock location code', () => {
    const aisle = zone({ location_code: 'A', type: 'lane', parent_location_code: 'ROOT-01' });
    const stock = { ...rack, location_code: 'A-PICK-0A-03', parent_location_code: 'A' };
    const { container } = render(<CanvasEditor zones={[warehouse, aisle, stock]}
      allowChildPositionConfiguration onCreateZone={jest.fn()} />);
    fireEvent.mouseDown(container.querySelector('[data-zone-code="A-PICK-0A-03"]')!, { clientX: 200, clientY: 150 });
    fireEvent.mouseUp(window);
    fireEvent.click(screen.getByRole('button', { name: 'Add position' }));
    expect(screen.getByLabelText(/^Position code/)).toHaveValue('A-PICK-0A-03-01');
  });

  it('cancels configuration without creating a position', () => {
    const create = jest.fn();
    const { container } = render(<CanvasEditor zones={[warehouse, rack]} allowChildPositionConfiguration onCreateZone={create} />);
    selectRack(container);
    fireEvent.click(screen.getByRole('button', { name: 'Add position' }));
    fireEvent.change(screen.getByLabelText(/^Position code/), { target: { value: 'CANCELLED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/^Position code/)).not.toBeInTheDocument();
  });

  it('keeps validation failures visible and creates no phantom child', async () => {
    const create = jest.fn().mockRejectedValue({ response: { data: { error: 'LOCATION_IDENTITY_COLLISION' } } });
    const { container } = render(<CanvasEditor zones={[warehouse, rack]} allowChildPositionConfiguration onCreateZone={create} />);
    selectRack(container);
    fireEvent.click(screen.getByRole('button', { name: 'Add position' }));
    fireEvent.change(screen.getByLabelText(/^Position code/), { target: { value: 'COLLISION' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create position' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('LOCATION_IDENTITY_COLLISION');
    expect(screen.getByLabelText(/^Position code/)).toHaveValue('COLLISION');
    expect(container.querySelector('[data-zone-code="COLLISION"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Print label for COLLISION' })).not.toBeInTheDocument();
  });

  it('keeps children out of floor placement and exposes only their label action', async () => {
    const print = jest.fn().mockResolvedValue(new Blob());
    const { container } = render(<CanvasEditor zones={[warehouse, rack, child]} onPrintBarcode={print} />);
    expect(container.querySelector('[data-zone-code="RACK-A-S1"]')).toBeNull();
    expect(screen.queryByText('RACK-A-S1')).not.toBeInTheDocument();
    selectRack(container);
    const positions = screen.getByRole('region', { name: 'Shelf and bin positions' });
    expect(within(positions).getByText(/legacy shelf label/)).toBeVisible();
    expect(within(positions).queryByRole('button', { name: /delete|deactivate|duplicate/i })).not.toBeInTheDocument();
    expect(within(positions).queryByLabelText('Width')).not.toBeInTheDocument();
    fireEvent.click(within(positions).getByRole('button', { name: 'Print label for RACK-A-S1' }));
    await waitFor(() => expect(print).toHaveBeenCalledWith('RACK-A-S1'));
  });

  it('keeps positioned legacy children inside the parent inspector', () => {
    const { container } = render(<CanvasEditor zones={[warehouse, rack, { ...child, position_x: 4, position_y: 4 }]} />);
    expect(container.querySelector('[data-zone-code="RACK-A-S1"]')).toBeNull();
    selectRack(container);
    expect(screen.getByText('RACK-A-S1')).toBeVisible();
  });

  it('changes visual levels without creating identities', () => {
    const create = jest.fn();
    const update = jest.fn().mockResolvedValue(undefined);
    const { container } = render(<CanvasEditor zones={[warehouse, rack]} allowChildPositionConfiguration onCreateZone={create} onUpdateZone={update} />);
    selectRack(container);
    fireEvent.change(screen.getByLabelText('Levels'), { target: { value: '5' } });
    fireEvent.blur(screen.getByLabelText('Levels'));
    expect(update).toHaveBeenCalledWith('RACK-A', { rack_levels: 5 });
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText('Visual levels only. Add shelf/bin positions separately to give them individual location codes.')).toBeVisible();
  });

  it('does not offer creation beneath inactive racks', () => {
    const { container } = render(<CanvasEditor zones={[warehouse, { ...rack, active: false }]} allowChildPositionConfiguration onCreateZone={jest.fn()} />);
    selectRack(container);
    expect(screen.queryByRole('button', { name: 'Add position' })).not.toBeInTheDocument();
  });
});
