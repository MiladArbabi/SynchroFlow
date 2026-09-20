import {
  FLOOR_PLANNING_COMPONENT_GROUPS,
  FLOOR_PLANNING_COMPONENTS,
  nextFloorPlanningLocationCode,
} from '../../../../modules/floor-planning/src/ui/components/floorPlanningComponents';

describe('Floor Planning component registry', () => {
  it('contains the approved grouped component set with stable unique identities', () => {
    expect(FLOOR_PLANNING_COMPONENT_GROUPS).toEqual([
      'STRUCTURE',
      'FULFILLMENT',
      'EXCEPTIONS',
      'OTHER',
    ]);
    expect(FLOOR_PLANNING_COMPONENTS.map(({ label }) => label)).toEqual([
      'Aisle',
      'Pick',
      'Pack',
      'Receive',
      'Ship',
      'Problem Area',
      'Returns',
      'Quarantine',
      'Materials',
    ]);

    const ids = FLOOR_PLANNING_COMPONENTS.map(({ id }) => id);
    const labels = FLOOR_PLANNING_COMPONENTS.map(({ label }) => label);
    const prefixes = FLOOR_PLANNING_COMPONENTS.map(({ codePrefix }) => codePrefix);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it.each([
    ['Problem Area', 'bin', 'problem'],
    ['Quarantine', 'bin', 'quarantine'],
    ['Materials', 'bin', 'kitting'],
  ])('%s owns its creation semantics', (label, type, zoneType) => {
    expect(FLOOR_PLANNING_COMPONENTS.find((item) => item.label === label)).toMatchObject({
      type,
      zone_type: zoneType,
    });
  });
});

describe('nextFloorPlanningLocationCode', () => {
  const zones = (...locationCodes: string[]) => locationCodes.map((location_code) => ({ location_code }));

  it.each([
    ['empty input', 'PACK', [], 'PACK-01'],
    ['next suffix', 'PACK', ['PACK-01'], 'PACK-02'],
    ['lowest gap', 'PACK', ['PACK-01', 'PACK-03'], 'PACK-02'],
    ['case-insensitive collision', 'PACK', ['pack-01'], 'PACK-02'],
    ['unrelated codes', 'PACK', ['PICK-01', 'PACKING-01', 'PACK-X'], 'PACK-01'],
    ['Problem prefix', 'PROBLEM', [], 'PROBLEM-01'],
  ])('%s', (_caseName, prefix, existing, expected) => {
    expect(nextFloorPlanningLocationCode(prefix, zones(...existing))).toBe(expected);
  });

  it('is deterministic and does not depend on current UI order', () => {
    const forward = zones('PACK-03', 'PACK-01', 'PICK-02');
    const reverse = [...forward].reverse();
    expect(nextFloorPlanningLocationCode('PACK', forward)).toBe('PACK-02');
    expect(nextFloorPlanningLocationCode('PACK', reverse)).toBe('PACK-02');
    expect(nextFloorPlanningLocationCode('PACK', forward)).toBe(
      nextFloorPlanningLocationCode('PACK', forward),
    );
  });

  it('uses a minimum of two digits without reusing an occupied numeric suffix', () => {
    expect(nextFloorPlanningLocationCode('PACK', zones('PACK-1', 'PACK-02'))).toBe('PACK-03');
    expect(nextFloorPlanningLocationCode('PACK', zones(...Array.from({ length: 99 }, (_, i) => `PACK-${i + 1}`)))).toBe('PACK-100');
  });
});
