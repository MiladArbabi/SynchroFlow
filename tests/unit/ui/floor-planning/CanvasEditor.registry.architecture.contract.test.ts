import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const canvasSource = fs.readFileSync(
  path.join(REPO, 'modules/floor-planning/src/ui/components/CanvasEditor.tsx'),
  'utf8',
);

describe('CanvasEditor canonical component registry boundary', () => {
  it('consumes the canonical registry without retaining a second palette role table', () => {
    expect(canvasSource).toMatch(/from '\.\/floorPlanningComponents\.js'/);
    expect(canvasSource).toContain('FLOOR_PLANNING_COMPONENTS');
    expect(canvasSource).not.toContain('PALETTE_ITEMS');
  });

  it('keeps visual token selection driven by structural type and zone_type', () => {
    expect(canvasSource).toMatch(/item\.type === 'lane' \? 'lane' : item\.zone_type/);
    expect(canvasSource).toMatch(/zone\.zone_type \?\? 'storage'/);
    expect(canvasSource).not.toMatch(/location_code[^\n]*(?:ZONE_COLORS|ZONE_STROKE)/);
  });

  it('does not designate a WMS problem bin during palette creation', () => {
    expect(canvasSource).not.toMatch(/problem_bin_location|wms_settings/i);
  });
});
