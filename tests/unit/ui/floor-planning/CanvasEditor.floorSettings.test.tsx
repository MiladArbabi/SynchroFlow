import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(screen.queryByText('Print location label')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    const root = container.querySelector('[data-zone-code="WAREHOUSE-01"]') as SVGGElement;
    expect(root).toHaveStyle({ pointerEvents: 'none' });
    expect(root.querySelector('rect[stroke="var(--accent)"]')).not.toBeInTheDocument();
  });

  it('GH1192: keeps Width and Depth changes as drafts without persistence', () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[warehouse, bin]} onUpdateZone={onUpdateZone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));

    fireEvent.change(screen.getByLabelText('Floor width'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Floor depth'), { target: { value: '10' } });

    expect(screen.getByLabelText('Floor width')).toHaveValue('14');
    expect(screen.getByLabelText('Floor depth')).toHaveValue('10');
    expect(screen.getByLabelText('Floor width')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('Floor depth')).toHaveAttribute('autocomplete', 'off');
    expect(onUpdateZone).not.toHaveBeenCalled();
  });

  it('GH1192: blurring either dimension does not persist drafts', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[warehouse, bin]} onUpdateZone={onUpdateZone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));

    const width = screen.getByLabelText('Floor width');
    const depth = screen.getByLabelText('Floor depth');
    fireEvent.change(width, { target: { value: '14' } });
    fireEvent.change(depth, { target: { value: '10' } });
    await act(async () => {
      fireEvent.blur(width);
      fireEvent.blur(depth);
    });

    expect(onUpdateZone).not.toHaveBeenCalled();
  });

  it('GH1192: Enter in either dimension does not persist or advance onboarding', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const freshRoot = { ...warehouse, width: null, depth: null };
    render(<CanvasEditor zones={[freshRoot]} minimumMappingReady={false} onUpdateZone={onUpdateZone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));

    const width = screen.getByLabelText('Floor width');
    const depth = screen.getByLabelText('Floor depth');
    fireEvent.change(width, { target: { value: '14' } });
    fireEvent.change(depth, { target: { value: '10' } });
    await act(async () => {
      fireEvent.keyDown(width, { key: 'Enter', code: 'Enter' });
      fireEvent.keyDown(depth, { key: 'Enter', code: 'Enter' });
    });

    expect(onUpdateZone).not.toHaveBeenCalled();
    expect(screen.queryByText('Add where you keep your stock')).not.toBeInTheDocument();
  });

  it('GH1192: exposes one visible Save & continue CTA enabled for a valid draft pair', () => {
    render(<CanvasEditor zones={[warehouse, bin]} onUpdateZone={jest.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));
    fireEvent.change(screen.getByLabelText('Floor width'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Floor depth'), { target: { value: '10' } });

    expect(screen.getAllByRole('button', { name: 'Save & continue' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save & continue' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save & continue' })).toBeEnabled();
  });

  it('GH1192: uses the canonical Tier-1 token, typography, focus and interaction contract', () => {
    render(<CanvasEditor zones={[warehouse]} onUpdateZone={jest.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));
    const save = screen.getByRole('button', { name: 'Save & continue' });

    expect(save).toHaveStyle({
      backgroundColor: 'var(--accent)', color: 'var(--accent-ink)',
      borderRadius: '6px', fontWeight: 600, boxShadow: 'none',
    });
    // JSDOM normalizes transition serialization and does not simulate CSS
    // hover/press/focus. Scope source assertions to this CTA, without depending
    // on Emotion's generated class names or whitespace around transition commas.
    const source = fs.readFileSync(path.resolve(__dirname,
      '../../../../modules/floor-planning/src/ui/components/CanvasEditor.tsx'), 'utf8');
    const panelStart = source.indexOf('function FloorSettingsPanel(');
    const panelEnd = source.indexOf('function BulkSelectionPanel(', panelStart);
    const panel = source.slice(panelStart, panelEnd);
    const cta = panel.slice(panel.indexOf('<Button'), panel.indexOf('</Button>'));
    expect(cta).toMatch(/transition:\s*'transform 150ms ease\s*,\s*opacity 150ms ease\s*,\s*background-color 150ms ease'/);
    expect(cta).toMatch(/'&:hover':\s*\{\s*bgcolor: 'var\(--accent\)', opacity: 0\.88, boxShadow: 'none'/);
    expect(cta).toMatch(/'&:active':\s*\{\s*transform: 'scale\(0\.97\)'/);
    expect(cta).toMatch(/'&:focus-visible':\s*\{\s*outline: '2px solid var\(--accent\)', outlineOffset: '2px'/);
    expect(cta).toMatch(/'&\.Mui-disabled':\s*\{\s*bgcolor: 'var\(--accent\)', color: 'var\(--accent-ink\)', opacity: 0\.5/);
  });

  it('GH1192: incomplete, non-finite, zero and negative draft dimensions cannot commit', () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[{ ...warehouse, width: null, depth: null }]} onUpdateZone={onUpdateZone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));
    const save = screen.getByRole('button', { name: 'Save & continue' });
    const width = screen.getByLabelText('Floor width');
    const depth = screen.getByLabelText('Floor depth');

    const cannotCommit = () => {
      expect(save).toBeVisible();
      expect(save).toBeDisabled();
      expect(save).toHaveStyle({ opacity: 0.5 });
      fireEvent.click(save);
      expect(onUpdateZone).not.toHaveBeenCalled();
    };
    cannotCommit();
    fireEvent.change(width, { target: { value: '14' } });
    cannotCommit();
    fireEvent.change(width, { target: { value: '' } });
    fireEvent.change(depth, { target: { value: '10' } });
    cannotCommit();
    fireEvent.change(width, { target: { value: '0' } });
    cannotCommit();
    fireEvent.change(width, { target: { value: '-1' } });
    cannotCommit();
    fireEvent.change(width, { target: { value: 'Infinity' } });
    cannotCommit();
    fireEvent.change(width, { target: { value: 'NaN' } });
    cannotCommit();
    fireEvent.change(width, { target: { value: '14' } });
    fireEvent.change(depth, { target: { value: '0' } });
    cannotCommit();
    fireEvent.change(depth, { target: { value: '-1' } });
    cannotCommit();
    fireEvent.change(depth, { target: { value: 'Infinity' } });
    cannotCommit();
    fireEvent.change(depth, { target: { value: 'NaN' } });
    cannotCommit();
  });

  it('GH1192: saves snapped Width and Depth together in exactly one update', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[warehouse, bin]} onUpdateZone={onUpdateZone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));
    fireEvent.change(screen.getByLabelText('Floor width'), { target: { value: '14.04' } });
    fireEvent.change(screen.getByLabelText('Floor depth'), { target: { value: '10.04' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    });

    expect(onUpdateZone).toHaveBeenCalledTimes(1);
    expect(onUpdateZone).toHaveBeenCalledWith('WAREHOUSE-01', { width: 14, depth: 10 });
  });

  it('GH1192: disables confirmation during saving and prevents duplicate updates', async () => {
    let finishSave!: () => void;
    const onUpdateZone = jest.fn().mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    render(<CanvasEditor zones={[warehouse, bin]} onUpdateZone={onUpdateZone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));
    fireEvent.change(screen.getByLabelText('Floor width'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Floor depth'), { target: { value: '10' } });
    const save = screen.getByRole('button', { name: 'Save & continue' });
    fireEvent.click(save);

    expect(save).toHaveAccessibleName('Saving…');
    expect(save).toBeDisabled();
    expect(save).toHaveStyle({ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)', opacity: 0.5 });
    fireEvent.click(save);
    expect(onUpdateZone).toHaveBeenCalledTimes(1);
    await act(async () => { finishSave(); });
    expect(save).toHaveAccessibleName('Save & continue');
    expect(save).toBeEnabled();
  });

  it('GH1192: rejected persistence stays recoverable without local guidance completion', async () => {
    const onUpdateZone = jest.fn()
      .mockRejectedValueOnce(new Error('Dimension update failed'))
      .mockResolvedValueOnce(undefined);
    const freshRoot = { ...warehouse, width: null, depth: null };
    render(<CanvasEditor zones={[freshRoot]} minimumMappingReady={false} onUpdateZone={onUpdateZone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));
    fireEvent.change(screen.getByLabelText('Floor width'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Floor depth'), { target: { value: '10' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    });

    expect(onUpdateZone).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('floor-settings-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save & continue' })).toBeEnabled();
    expect(screen.queryByText('Add where you keep your stock')).not.toBeInTheDocument();
    expect(screen.getByText('Set your warehouse boundary')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    });
    expect(onUpdateZone).toHaveBeenCalledTimes(2);
    expect(onUpdateZone).toHaveBeenLastCalledWith('WAREHOUSE-01', { width: 14, depth: 10 });
    // Successful callback alone is still not persisted root-prop authority.
    expect(screen.queryByText('Add where you keep your stock')).not.toBeInTheDocument();
  });

  it('GH1192: centers dimension values and positions them slightly below the old symmetric 6px padding', () => {
    render(<CanvasEditor zones={[warehouse]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));

    for (const label of ['Floor width', 'Floor depth']) {
      const style = getComputedStyle(screen.getByLabelText(label));
      expect(style.textAlign).toBe('center');
      expect(parseFloat(style.paddingTop)).toBeGreaterThan(6);
      expect(parseFloat(style.paddingTop)).toBeGreaterThan(parseFloat(style.paddingBottom));
    }
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

describe('GH1176 — floor settings resize containment', () => {
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

  it('GH1176: rejects a width that would exclude an existing positioned child, with validation feedback', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    // Child spans x 8..10 inside the 12m root; a 6m width would exclude it.
    const child = zone({ location_code: 'EDGE-BIN', position_x: 8, position_y: 2, width: 2, depth: 1, orientation: 0 });
    render(<CanvasEditor zones={[warehouse, child]} onUpdateZone={onUpdateZone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));

    const width = screen.getByLabelText('Floor width');
    fireEvent.change(width, { target: { value: '6' } });
    fireEvent.blur(width);

    await waitFor(() => expect(width).toHaveAttribute('aria-invalid', 'true'));
    expect(width).toHaveAccessibleDescription();
    expect(onUpdateZone).not.toHaveBeenCalled();
    const save = screen.getByRole('button', { name: 'Save & continue' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onUpdateZone).not.toHaveBeenCalled();
  });

  // GH1176 audit: a null persisted size still renders a visible Canvas
  // footprint (1m wide, 0.8m deep), so containment must use that footprint.
  it.each([
    {
      axis: 'width' as const,
      label: 'Floor width',
      child: { position_x: 9.5, position_y: 2, width: null, depth: 1 },
    },
    {
      axis: 'depth' as const,
      label: 'Floor depth',
      child: { position_x: 2, position_y: 9.5, width: 1, depth: null },
    },
  ])('GH1176: rejects a $axis shrink that would clip a positioned child with a null $axis', async ({ label, child }) => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const nullSized = zone({ location_code: 'NULL-SIZE-BIN', orientation: 0, ...child });
    render(<CanvasEditor zones={[warehouse, nullSized]} onUpdateZone={onUpdateZone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));

    // 10m keeps the persisted origin (9.5) inside but clips the visible footprint.
    const input = screen.getByLabelText(label);
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.blur(input);

    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(input).toHaveAccessibleDescription();
    expect(onUpdateZone).not.toHaveBeenCalled();
    const save = screen.getByRole('button', { name: 'Save & continue' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onUpdateZone).not.toHaveBeenCalled();
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

    fireEvent.click(screen.getByText('Print location label'));
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
