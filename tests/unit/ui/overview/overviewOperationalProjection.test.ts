// tests/unit/ui/overview/overviewOperationalProjection.test.ts
//
// OVERVIEW-LIVE-MAP-01 Slice B — regression coverage for the pure
// per-location and per-station operational-state projection helpers.
// PROJECTION ONLY: no renderer, navigation, Ops Console, or threshold
// assertions belong here.

import {
  deriveLocationOperationalState,
  deriveStationOperationalState,
  type LocationOperationalInputs,
  type OverviewOperationalState,
} from '../../../../apps/frontend/src/pages/overview/overviewOperationalState';

function locationInputs(
  overrides: Partial<LocationOperationalInputs> = {}
): LocationOperationalInputs {
  return {
    hasOpenProblem: false,
    hasLiveOperatorActivity: false,
    hasStaleOperatorActivity: false,
    hasPendingStow: false,
    hasReceiveAtDock: false,
    ...overrides,
  };
}

describe('deriveLocationOperationalState — per-location projection', () => {
  const cases: Array<{
    name: string;
    inputs: LocationOperationalInputs;
    expected: OverviewOperationalState;
  }> = [
    {
      name: '1: empty location -> neutral',
      inputs: locationInputs(),
      expected: 'neutral',
    },
    {
      name: '2: live operator only -> active',
      inputs: locationInputs({ hasLiveOperatorActivity: true }),
      expected: 'active',
    },
    {
      name: '3: stale operator only -> stale',
      inputs: locationInputs({ hasStaleOperatorActivity: true }),
      expected: 'stale',
    },
    {
      name: '4: pending stow only -> active',
      inputs: locationInputs({ hasPendingStow: true }),
      expected: 'active',
    },
    {
      name: '5: receive-at-dock only -> active',
      inputs: locationInputs({ hasReceiveAtDock: true }),
      expected: 'active',
    },
    {
      name: '6: open problem only -> critical',
      inputs: locationInputs({ hasOpenProblem: true }),
      expected: 'critical',
    },
    {
      name: '7: open problem outranks stale + active signals',
      inputs: locationInputs({
        hasOpenProblem: true,
        hasStaleOperatorActivity: true,
        hasLiveOperatorActivity: true,
        hasPendingStow: true,
        hasReceiveAtDock: true,
      }),
      expected: 'critical',
    },
  ];

  it.each(cases)('$name', ({ inputs, expected }) => {
    expect(deriveLocationOperationalState(inputs)).toBe(expected);
  });
});

describe('deriveStationOperationalState — synthetic-station projection', () => {
  const cases: Array<{
    name: string;
    id: string;
    count: number;
    expected: OverviewOperationalState;
  }> = [
    {
      name: '8: blocked station with count > 0 -> critical',
      id: 'blocked',
      count: 3,
      expected: 'critical',
    },
    {
      name: '9: order pool with count > 0 -> active',
      id: 'pool',
      count: 5,
      expected: 'active',
    },
    {
      name: '10: staged/awaiting-pickup with count > 0 -> active, NOT critical',
      id: 'staged',
      count: 2,
      expected: 'active',
    },
    {
      name: '11: shipped with count > 0 -> healthy',
      id: 'shipped',
      count: 7,
      expected: 'healthy',
    },
    {
      name: '12a: zero-count blocked station -> neutral',
      id: 'blocked',
      count: 0,
      expected: 'neutral',
    },
    {
      name: '12b: zero-count shipped station -> neutral',
      id: 'shipped',
      count: 0,
      expected: 'neutral',
    },
  ];

  it.each(cases)('$name', ({ id, count, expected }) => {
    expect(deriveStationOperationalState({ id, count })).toBe(expected);
  });

  it('contract 10 guard: staged existing hardcoded critical visual tone is not proof of critical operational state', () => {
    // OV-157b gives the "staged" station a critical visual `tone` for alarm
    // styling — that is an unrelated rendering concern this projection must
    // not read or infer from.
    expect(deriveStationOperationalState({ id: 'staged', count: 4 })).not.toBe(
      'critical'
    );
  });
});
