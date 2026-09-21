import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { WarehouseZone } from '../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2';
import { CanvasEditor } from '../../../../modules/floor-planning/src/ui/components/CanvasEditor';

function zone(overrides: Partial<WarehouseZone> = {}): WarehouseZone {
  return {
    location_code: 'ZONE-01',
    type: 'bin',
    parent_location_code: 'LANE-01',
    barcode: 'BIN-CODE-01',
    active: true,
    children_count: 0,
    position_x: 2,
    position_y: 2,
    width: 2,
    depth: 1.5,
    orientation: 90,
    rack_levels: 3,
    zone_type: 'pick',
    last_printed_at: null,
    warehouse_name: null,
    ...overrides,
  };
}

const warehouse = zone({
  location_code: 'WAREHOUSE-01',
  type: 'warehouse',
  parent_location_code: null,
  barcode: null,
  position_x: 0,
  position_y: 0,
  width: 12,
  depth: 12,
  orientation: 0,
  rack_levels: null,
  zone_type: null,
});

const bin = zone();

describe('CanvasEditor floor settings', () => {
  let rectSpy: jest.SpyInstance;

  beforeEach(() => {
    rectSpy = jest.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 500,
      top: 0,
      right: 1000,
      bottom: 500,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => rectSpy.mockRestore());

  it('opens explicit root settings without selecting or exposing normal zone actions', () => {
    const { container } = render(<CanvasEditor zones={[warehouse, bin]} />);
    const action = screen.getByRole('button', { name: 'Floor settings' });

    expect(action).toBeVisible();
    fireEvent.click(action);

    expect(screen.getByTestId('floor-settings-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Floor code')).toHaveValue('WAREHOUSE-01');
    expect(screen.getByLabelText('Floor code')).toHaveAttribute('readonly');
    expect(screen.queryByTitle('Duplicate zone')).not.toBeInTheDocument();
    expect(screen.queryByText('Print barcode')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    const root = container.querySelector('[data-zone-code="WAREHOUSE-01"]') as SVGGElement;
    expect(root).toHaveStyle({ pointerEvents: 'none' });
    expect(root.querySelector('rect[stroke="var(--accent)"]')).not.toBeInTheDocument();
  });

  it('updates root width and depth through onUpdateZone', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[warehouse, bin]} onUpdateZone={onUpdateZone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));

    fireEvent.change(screen.getByLabelText('Floor width'), { target: { value: '14' } });
    fireEvent.blur(screen.getByLabelText('Floor width'));
    await waitFor(() => expect(onUpdateZone).toHaveBeenCalledWith('WAREHOUSE-01', { width: 14 }));

    fireEvent.change(screen.getByLabelText('Floor depth'), { target: { value: '10' } });
    fireEvent.blur(screen.getByLabelText('Floor depth'));
    await waitFor(() => expect(onUpdateZone).toHaveBeenCalledWith('WAREHOUSE-01', { depth: 10 }));
  });

  it('keeps warehouse canvas geometry non-interactive', () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const { container } = render(<CanvasEditor zones={[warehouse, bin]} onUpdateZone={onUpdateZone} />);
    const root = container.querySelector('[data-zone-code="WAREHOUSE-01"]') as SVGGElement;

    fireEvent.mouseDown(root, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 180, clientY: 180 });
    fireEvent.mouseUp(window);

    expect(onUpdateZone).not.toHaveBeenCalled();
    expect(screen.queryByTitle('Duplicate zone')).not.toBeInTheDocument();
  });
});

describe('CanvasEditor compact zone inspector', () => {
  let rectSpy: jest.SpyInstance;

  beforeEach(() => {
    rectSpy = jest.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 500,
      top: 0,
      right: 1000,
      bottom: 500,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => rectSpy.mockRestore());

  function openBin(container: HTMLElement) {
    fireEvent.mouseDown(container.querySelector('[data-zone-code="ZONE-01"]') as SVGGElement);
  }

  it('keeps all ordinary geometry, meta, and action controls in compact rows', async () => {
    const onPrintBarcode = jest.fn().mockResolvedValue(new Blob());
    const onCreateZone = jest.fn().mockResolvedValue(undefined);
    const onDeleteZone = jest.fn().mockResolvedValue(undefined);
    const { container } = render(
      <CanvasEditor
        zones={[warehouse, bin]}
        onPrintBarcode={onPrintBarcode}
        onCreateZone={onCreateZone}
        onDeleteZone={onDeleteZone}
      />,
    );
    openBin(container);

    const sizeRow = screen.getByTestId('geometry-size-row');
    expect(within(sizeRow).getByLabelText('Width')).toBeInTheDocument();
    expect(within(sizeRow).getByLabelText('Depth')).toBeInTheDocument();
    const positionRow = screen.getByTestId('geometry-position-row');
    expect(within(positionRow).getByLabelText('Position X')).toBeInTheDocument();
    expect(within(positionRow).getByLabelText('Position Y')).toBeInTheDocument();
    const levelsRow = screen.getByTestId('geometry-levels-row');
    expect(within(levelsRow).getByLabelText('Levels')).toHaveValue(3);
    expect(within(levelsRow).getByText('Orientation')).toBeInTheDocument();
    expect(within(levelsRow).getByText('90°')).toBeInTheDocument();
    expect(screen.getByText('Barcode: BIN-CODE-01')).toBeInTheDocument();
    expect(screen.getByText('Parent: LANE-01')).toBeInTheDocument();
    expect(screen.queryByLabelText('Dock opening')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Print barcode'));
    expect(onPrintBarcode).toHaveBeenCalledWith('ZONE-01');

    fireEvent.click(screen.getByTitle('Duplicate zone'));
    expect(screen.getByLabelText('New name')).toHaveValue('ZONE-01-COPY');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByText('Delete'));

    expect(onDeleteZone).not.toHaveBeenCalled();
    let dialog = screen.getByRole('dialog');

    expect(
      within(dialog).getByText(
        (_content, element) =>
          element?.tagName === 'P'
          && element.textContent === 'Delete ZONE-01?',
      ),
    ).toBeInTheDocument();

    expect(
      within(dialog).getByText(
        'This component will be removed. This action cannot be undone.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(onDeleteZone).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText('Delete'));
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(onDeleteZone).toHaveBeenCalledTimes(1),
    );
    expect(onDeleteZone).toHaveBeenCalledWith('ZONE-01');
  });

  it('keeps dock controls conditional to receive and ship roles', () => {
    const receive = zone({ zone_type: 'receive', dock_face: 'north' });
    const { container } = render(<CanvasEditor zones={[warehouse, receive]} />);
    openBin(container);

    expect(screen.getByLabelText('Dock opening')).toHaveValue('north');
  });
});
