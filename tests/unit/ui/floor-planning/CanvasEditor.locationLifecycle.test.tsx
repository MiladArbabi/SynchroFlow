/**
 * Location lifecycle (Activate / Deactivate) — RED contract.
 *
 * The retired Setup list owned activate/deactivate. Mutation now belongs to
 * Edit layout → selected-location Inspector, through the existing
 * onUpdateZone(locationCode, patch) contract (useUpdateZone already accepts
 * `active`). Inspect mode may show the state but does not own the mutation;
 * that is outside this suite. The passive warehouse root gains no control.
 */
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

const deactivate = () => screen.queryByRole('button', { name: /^Deactivate$/i });
const activate = () => screen.queryByRole('button', { name: /^Activate$/i });

function select(container: HTMLElement, code: string) {
  const target = container.querySelector(`[data-zone-code="${code}"]`) as SVGGElement;
  fireEvent.mouseDown(target, { clientX: 200, clientY: 150 });
  fireEvent.mouseUp(window);
}

describe('CanvasEditor selected-location Inspector — location lifecycle (RED contract)', () => {
  let rectSpy: jest.SpyInstance;

  beforeEach(() => {
    rectSpy = jest.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1000, height: 500, top: 0, right: 1000, bottom: 500, left: 0, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
  });

  afterEach(() => rectSpy.mockRestore());

  it('allocates editing context only for a selection, preserves capabilities, and releases it on close', () => {
    const onPrintBarcode = jest.fn();
    const { container } = render(<CanvasEditor zones={[warehouse, zone()]} onUpdateZone={jest.fn()} onPrintBarcode={onPrintBarcode} onDeleteZone={jest.fn()} onCreateZone={jest.fn()} />);
    expect(screen.queryByRole('region', { name: 'Edit context' })).not.toBeInTheDocument();

    select(container, 'BIN-01');
    const context = screen.getByRole('region', { name: 'Edit context' });
    expect(within(context).getByText('Role')).toBeInTheDocument();
    expect(within(context).getByText('Active')).toBeInTheDocument();
    expect(within(context).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    expect(within(context).getByLabelText('Width')).toBeInTheDocument();
    expect(within(context).getByLabelText('Depth')).toBeInTheDocument();
    expect(within(context).getByLabelText('Position X')).toBeInTheDocument();
    expect(within(context).getByLabelText('Position Y')).toBeInTheDocument();
    expect(within(context).getByLabelText('Levels')).toBeInTheDocument();
    expect(within(context).getByText('Orientation')).toBeInTheDocument();
    expect(within(context).getByText('Parent: ROOT-01')).toBeInTheDocument();
    expect(within(context).getByTitle('Duplicate zone')).toBeInTheDocument();
    fireEvent.click(within(context).getByText('Print location label'));
    expect(onPrintBarcode).toHaveBeenCalledWith('BIN-01');
    expect(within(context).getByText('Delete')).toBeInTheDocument();

    fireEvent.click(within(context).getByTitle('Close inspector'));
    expect(screen.queryByRole('region', { name: 'Edit context' })).not.toBeInTheDocument();
  });

  it('shows an active location as Active and deactivates it through onUpdateZone', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const { container } = render(<CanvasEditor zones={[warehouse, zone()]} onUpdateZone={onUpdateZone} />);
    select(container, 'BIN-01');

    expect(screen.getByText(/^Active$/i)).toBeVisible();
    expect(activate()).not.toBeInTheDocument();
    fireEvent.click(deactivate() as HTMLElement);

    await waitFor(() => expect(onUpdateZone).toHaveBeenCalledWith('BIN-01', { active: false }));
  });

  it('shows an inactive location as Inactive and activates it through onUpdateZone', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const { container } = render(
      <CanvasEditor zones={[warehouse, zone({ active: false })]} onUpdateZone={onUpdateZone} />,
    );
    select(container, 'BIN-01');

    expect(screen.getByText(/^Inactive$/i)).toBeVisible();
    expect(deactivate()).not.toBeInTheDocument();
    fireEvent.click(activate() as HTMLElement);

    await waitFor(() => expect(onUpdateZone).toHaveBeenCalledWith('BIN-01', { active: true }));
  });

  it('gives the warehouse root no activate/deactivate control', () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const { container } = render(<CanvasEditor zones={[warehouse, zone()]} onUpdateZone={onUpdateZone} />);

    // Precondition: the control exists for an ordinary location, so its
    // absence below is a root exclusion, not a missing feature.
    select(container, 'BIN-01');
    expect(deactivate()).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Close inspector'));

    select(container, 'ROOT-01');
    expect(deactivate()).not.toBeInTheDocument();
    expect(activate()).not.toBeInTheDocument();

    // The root's only surface is Floor settings — no lifecycle control there.
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));
    expect(screen.getByTestId('floor-settings-panel')).toBeInTheDocument();
    expect(deactivate()).not.toBeInTheDocument();
    expect(activate()).not.toBeInTheDocument();
    expect(onUpdateZone).not.toHaveBeenCalledWith('ROOT-01', expect.objectContaining({ active: expect.anything() }));
  });
});
