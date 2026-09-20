// tests/unit/ui/overview/overviewOperationalPresentation.test.ts
//
// OVERVIEW-LIVE-MAP-01 Slice D — regression coverage for the pure
// per-location and per-station explainability presentation helpers.
// PRESENTATION ONLY: badge/reason/work/impact/recency derived from the same
// canonical inputs Slice B already projects state from — no new fetch,
// threshold, or business rule, and no re-derivation of state precedence
// (deriveLocationOperationalState / deriveStationOperationalState remain the
// single source, exercised indirectly through these presentation helpers).

import {
  deriveLocationOperationalPresentation,
  deriveStationOperationalPresentation,
  type LocationPresentationInputs,
  type OverviewOperationalPresentation,
} from '../../../../apps/frontend/src/pages/overview/overviewOperationalState';

function locationInputs(
  overrides: Partial<LocationPresentationInputs> = {}
): LocationPresentationInputs {
  return {
    problemCount: 0,
    operatorCount: 0,
    staleOperatorCount: 0,
    stowUnits: 0,
    dockUnits: 0,
    ...overrides,
  };
}

describe('deriveLocationOperationalPresentation — PRECEDENCE EXAMPLES 1-6', () => {
  it('1: open problem + live operators + stow -> critical, badge "N issues"', () => {
    const p = deriveLocationOperationalPresentation(
      locationInputs({ problemCount: 3, operatorCount: 2, stowUnits: 5 })
    );
    expect(p.state).toBe('critical');
    expect(p.primaryBadge).toEqual({ label: '3 issues', count: 3 });
  });

  it('2: stale operator + live operator -> stale, stale reason/badge', () => {
    const p = deriveLocationOperationalPresentation(
      locationInputs({ staleOperatorCount: 1, operatorCount: 2 })
    );
    expect(p.state).toBe('stale');
    expect(p.primaryBadge).toEqual({ label: '1 stale', count: 1 });
    expect(p.reason).toMatch(/stale/i);
  });

  it('3: live operator + stow -> active, deterministic ONE badge only', () => {
    const p = deriveLocationOperationalPresentation(
      locationInputs({ operatorCount: 2, stowUnits: 5 })
    );
    expect(p.state).toBe('active');
    expect(p.primaryBadge).toEqual({ label: '2 active', count: 2 });
  });

  it('4: pending stow alone -> active, "N to stow"', () => {
    const p = deriveLocationOperationalPresentation(locationInputs({ stowUnits: 12 }));
    expect(p.state).toBe('active');
    expect(p.primaryBadge).toEqual({ label: '12 to stow', count: 12 });
    // Units, not tasks.
    expect(p.primaryBadge!.label).not.toMatch(/task/i);
  });

  it('5: receive at dock alone -> active, "N at dock"', () => {
    const p = deriveLocationOperationalPresentation(locationInputs({ dockUnits: 8 }));
    expect(p.state).toBe('active');
    expect(p.primaryBadge).toEqual({ label: '8 at dock', count: 8 });
  });

  it('6: no meaningful signal -> neutral, no badge', () => {
    const p = deriveLocationOperationalPresentation(locationInputs());
    expect(p.state).toBe('neutral');
    expect(p.primaryBadge).toBeNull();
  });
});

describe('deriveLocationOperationalPresentation — does not sum unlike units', () => {
  it('never combines stow units and dock units into one badge count', () => {
    const p = deriveLocationOperationalPresentation(
      locationInputs({ stowUnits: 10, dockUnits: 5 })
    );
    // Deterministic single winner (stow, since it is checked first in the
    // active tier) — never "15" (10 + 5), which would conflate two
    // different physical facts into a fabricated number.
    expect(p.primaryBadge?.count).not.toBe(15);
    expect(p.primaryBadge).toEqual({ label: '10 to stow', count: 10 });
  });
});

describe('deriveLocationOperationalPresentation — HOVER TESTS properties', () => {
  it('only non-empty conceptual sections are populated', () => {
    const neutral = deriveLocationOperationalPresentation(locationInputs());
    expect(neutral.workLines).toEqual([]);
    expect(neutral.impactLines).toEqual([]);
    expect(neutral.recencyLine).toBeUndefined();
  });

  it('merchant wording only — no internal field names leak into reason/badge/lines', () => {
    const p = deriveLocationOperationalPresentation(
      locationInputs({ problemCount: 1, operatorCount: 1, staleOperatorCount: 0 })
    );
    const haystack = JSON.stringify(p).toLowerCase();
    expect(haystack).not.toContain('stalecount');
    expect(haystack).not.toContain('problembylocation');
    expect(haystack).not.toContain('haslivepractoractivity'.toLowerCase());
    expect(haystack).not.toContain('hasopenproblem');
  });

  it('critical reason is visible and work details can coexist with it', () => {
    const p = deriveLocationOperationalPresentation(
      locationInputs({ problemCount: 2, operatorCount: 3, stowUnits: 12 })
    );
    expect(p.state).toBe('critical');
    expect(p.reason).toBe('Open warehouse issue');
    expect(p.workLines).toEqual(
      expect.arrayContaining(['3 operators active', '12 units awaiting stow'])
    );
    expect(p.impactLines).toEqual(['2 open issues']);
  });

  it('recency line is present only when a recencyText is supplied', () => {
    const withRecency = deriveLocationOperationalPresentation(
      locationInputs({ operatorCount: 1, recencyText: '4m ago' })
    );
    const withoutRecency = deriveLocationOperationalPresentation(
      locationInputs({ operatorCount: 1 })
    );
    expect(withRecency.recencyLine).toBe('Last activity 4m ago');
    expect(withoutRecency.recencyLine).toBeUndefined();
  });

  it('never produces more than one badge object for the same location', () => {
    const p = deriveLocationOperationalPresentation(
      locationInputs({ problemCount: 1, operatorCount: 5, staleOperatorCount: 2, stowUnits: 9, dockUnits: 4 })
    );
    // primaryBadge is a single object or null by construction — never an array.
    expect(Array.isArray(p.primaryBadge)).toBe(false);
    expect(p.primaryBadge).toEqual({ label: '1 issue', count: 1 });
  });

  it('singular vs plural issue wording', () => {
    expect(
      deriveLocationOperationalPresentation(locationInputs({ problemCount: 1 })).primaryBadge!.label
    ).toBe('1 issue');
    expect(
      deriveLocationOperationalPresentation(locationInputs({ problemCount: 2 })).primaryBadge!.label
    ).toBe('2 issues');
  });
});

describe('deriveStationOperationalPresentation — PRECEDENCE EXAMPLES 7-12', () => {
  it('7: blocked count -> critical, "N blocked orders" (Slice D.1 explicit noun wording)', () => {
    const p = deriveStationOperationalPresentation({ id: 'blocked', count: 3 });
    expect(p.state).toBe('critical');
    expect(p.primaryBadge).toEqual({ label: '3 blocked orders', count: 3 });
  });

  it('8: pool count -> active, one pool badge', () => {
    const p = deriveStationOperationalPresentation({ id: 'pool', count: 7 });
    expect(p.state).toBe('active');
    expect(p.primaryBadge).toEqual({ label: '7 ready', count: 7 });
  });

  it('9: staged -> active, "N awaiting pickup"', () => {
    const p = deriveStationOperationalPresentation({ id: 'staged', count: 4 });
    expect(p.state).toBe('active');
    expect(p.primaryBadge).toEqual({ label: '4 awaiting pickup', count: 4 });
    expect(p.primaryBadge!.label).not.toMatch(/blocked|critical/i);
  });

  it('10: shipped -> healthy, "N shipped"', () => {
    const p = deriveStationOperationalPresentation({ id: 'shipped', count: 18 });
    expect(p.state).toBe('healthy');
    expect(p.primaryBadge).toEqual({ label: '18 shipped', count: 18 });
  });

  it('11: zero count -> no badge', () => {
    const p = deriveStationOperationalPresentation({ id: 'pool', count: 0 });
    expect(p.state).toBe('neutral');
    expect(p.primaryBadge).toBeNull();
  });

  it('12: legacy tone is not part of the presentation input and cannot leak a critical badge', () => {
    // StationPresentationInputs has no `tone` field at all — this proves the
    // helper cannot read it even if a caller tried to pass extra data.
    const p = deriveStationOperationalPresentation({ id: 'staged', count: 2 });
    expect(p.state).toBe('active');
    expect(p.primaryBadge?.label).toBe('2 awaiting pickup');
  });
});

describe('deriveStationOperationalPresentation — Slice D.1 showIdentityLabel', () => {
  it('blocked: identity is redundant with the primary badge -> suppressed', () => {
    expect(deriveStationOperationalPresentation({ id: 'blocked', count: 3 }).showIdentityLabel).toBe(false);
  });

  it('pool: identity answers a different question than the primary badge -> kept', () => {
    expect(deriveStationOperationalPresentation({ id: 'pool', count: 7 }).showIdentityLabel).toBe(true);
  });

  it('staged: identity is redundant with the primary badge -> suppressed', () => {
    expect(deriveStationOperationalPresentation({ id: 'staged', count: 4 }).showIdentityLabel).toBe(false);
  });

  it('shipped: identity is redundant with the primary badge -> suppressed', () => {
    expect(deriveStationOperationalPresentation({ id: 'shipped', count: 18 }).showIdentityLabel).toBe(false);
  });

  it('zero-count/neutral: no primary message exists to be redundant with -> identity may remain', () => {
    expect(deriveStationOperationalPresentation({ id: 'blocked', count: 0 }).showIdentityLabel).toBe(true);
  });
});

describe('deriveStationOperationalPresentation — HOVER TESTS properties', () => {
  it('critical station reports its fact as impact, not work', () => {
    const p = deriveStationOperationalPresentation({ id: 'blocked', count: 5 });
    expect(p.impactLines).toEqual(['5 blocked orders']);
    expect(p.workLines).toEqual([]);
  });

  it('non-critical station reports its fact as work, not impact', () => {
    const p = deriveStationOperationalPresentation({ id: 'shipped', count: 9 });
    expect(p.workLines).toEqual(['9 shipped']);
    expect(p.impactLines).toEqual([]);
  });

  it('neutral station has no populated sections', () => {
    const p = deriveStationOperationalPresentation({ id: 'shipped', count: 0 });
    expect(p.workLines).toEqual([]);
    expect(p.impactLines).toEqual([]);
    expect(p.recencyLine).toBeUndefined();
  });
});

describe('presentation state matches the state Slice C already derives (single source, no drift)', () => {
  it.each([
    ['blocked', 3, 'critical'],
    ['pool', 7, 'active'],
    ['staged', 4, 'active'],
    ['shipped', 18, 'healthy'],
    ['blocked', 0, 'neutral'],
  ] as const)('station %s with count %d -> %s', (id, count, expected) => {
    const p: OverviewOperationalPresentation = deriveStationOperationalPresentation({ id, count });
    expect(p.state).toBe(expected);
  });
});
