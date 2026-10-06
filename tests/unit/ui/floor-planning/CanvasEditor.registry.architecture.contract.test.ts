import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const canvasSource = fs.readFileSync(
  path.join(REPO, 'modules/floor-planning/src/ui/components/CanvasEditor.tsx'),
  'utf8',
);

const pageSource = fs.readFileSync(
  path.join(REPO, 'modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2.tsx'),
  'utf8',
);

describe('CanvasEditor canonical component registry boundary', () => {
  it('consumes the canonical registry without retaining a second palette role table', () => {
    expect(canvasSource).toMatch(/from '\.\/floorPlanningComponents\.js'/);
    expect(canvasSource).toContain('FLOOR_PLANNING_COMPONENTS');
    expect(canvasSource).not.toContain('PALETTE_ITEMS');
    expect(canvasSource).not.toMatch(/const\s+.*DEFAULT.*(?:width|depth|rack)/i);
  });

  it('keeps visual token selection driven by structural type and zone_type', () => {
    expect(canvasSource).toMatch(/item\.type === 'lane' \? 'lane' : item\.zone_type/);
    expect(canvasSource).toMatch(/zone\.zone_type \?\? 'storage'/);
    expect(canvasSource).not.toMatch(/location_code[^\n]*(?:ZONE_COLORS|ZONE_STROKE)/);
  });

  it('does not designate a WMS problem bin during palette creation', () => {
    expect(canvasSource).not.toMatch(/problem_bin_location|wms_settings/i);
  });

  it('contains no rejected ghost-placement state or rendering', () => {
    expect(canvasSource).not.toMatch(/pendingPlacement|pending-placement-ghost|placePendingComponent|movePendingPlacement/);
    expect(canvasSource).not.toContain('floorPlanningDimensions');
  });

  it('keeps onboarding coaching in one persistent SpotlightCoachMark slot', () => {
    expect(canvasSource.match(/<SpotlightCoachMark\b/g) ?? []).toHaveLength(1);
    expect(canvasSource).toContain("const guidancePhase: 'boundary' | 'stock' | null");
    expect(canvasSource).toContain("Start with a Stock location — the place your team stores, counts and picks products. Add an aisle only if your warehouse uses them. You can then add Receiving, Packing, Shipping and other work areas as needed.");
  });

  it('retains the existing canvas drag and resize interaction owners', () => {
    expect(canvasSource).toContain('function onRackMouseDown');
    expect(canvasSource).toContain('resizeRef.current');
    expect(canvasSource).toMatch(/onUpdateZone\(r\.locationCode, \{ width: local\.w, depth: local\.h \}\)/);
  });
});


describe('GH1177 approved visual hierarchy contracts', () => {
  it('anchors boundary guidance to Floor settings and stock guidance to the Stock location component', () => {
    const guidancePopper = (canvasSource.match(/<Popper\b[\s\S]*?<\/Popper>/g) ?? [])
      .find((popper) => popper.includes('<SpotlightCoachMark'));
    expect(guidancePopper).toBeDefined();
    expect(guidancePopper).toContain('anchorEl={guidanceAnchorEl}');
    expect(guidancePopper).toContain('open={guidancePhase != null && guidanceAnchorEl != null}');
    expect(canvasSource).toContain('anchorEl={guidanceAnchorEl}');
    expect(canvasSource).toContain('ref={setFloorSettingsAnchorEl}');
    expect(canvasSource).toMatch(
      /<Button\b[^>]*ref=\{setFloorSettingsAnchorEl\}[^>]*aria-label="Floor settings"/s,
    );
    const paletteRow = canvasSource.match(/<Box key=\{item\.id\}[\s\S]*?role="button"/)?.[0];
    expect(paletteRow).toMatch(
      /ref=\{\(node:[^)]*\)\s*=>\s*\{[\s\S]*?if\s*\(item\.id === 'pick'\)\s*onStockLocationAnchor\(node\);[\s\S]*?\}\}/,
    );
    const registrySource = fs.readFileSync(
      path.join(REPO, 'modules/floor-planning/src/ui/components/floorPlanningComponents.ts'),
      'utf8',
    );
    expect(registrySource).toMatch(/id: 'pick',\s*label: 'Stock location'/);
    expect(canvasSource).toContain('onStockLocationAnchor={setStockLocationAnchorEl}');
    expect(canvasSource).toMatch(
      /const guidanceAnchorEl\s*=\s*guidancePhase === 'boundary'\s*\?\s*floorSettingsAnchorEl\s*:\s*guidancePhase === 'stock'\s*\?\s*stockLocationAnchorEl\s*:\s*null/s,
    );
    expect(guidancePopper).toContain(
      "placement={guidancePhase === 'stock' ? 'right-start' : 'bottom'}",
    );
    expect(canvasSource).toMatch(
      /direction=\{\s*guidancePhase === 'boundary'\s*\?\s*'up'\s*:\s*guidancePhase === 'stock'\s*\?\s*'left'\s*:\s*undefined\s*\}/s,
    );
    expect(canvasSource).not.toContain("top: 'calc(100% + 10px)'");
  });

  it('keeps Setup copy aligned with the Stock location mental model', () => {
    expect(pageSource).toContain(
      'Map where you keep stock and the work areas your warehouse uses.',
    );
    expect(pageSource).not.toContain(
      'Configure aisles, shelves, and bins.',
    );
  });
});
