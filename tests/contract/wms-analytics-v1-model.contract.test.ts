// tests/contract/wms-analytics-v1-model.contract.test.ts
//
// GH-1231 — Analytics V1 pure presentation model contract (CI-gated, DB-free).
//
// Ratified contract: docs/blueprints/WarehouseAnalyticsModule.md §12B.4
// (Concept A + U1–U8). This protects merchant-facing meaning, not layout:
//   - the five Flow stages, including "Waiting to be packed";
//   - plain, cause-free problem labels; raw codes never shown;
//   - Team is alphabetical, never ranked by volume; "Showing K of N";
//   - recorded-status ages are uncapped; unknown is never a confirmed zero;
//   - partial current period reads "today so far" / "this week so far";
//   - Costs is setup-only (no money), carrier cutoff only when valid,
//     active-batch assignment is qualified, never "working now";
//   - no UPH / accuracy / on-track / ranking / cost calculations or merchant
//     copy exist (metric terms, not incidental helper names).
//
// Expected production module (pure, no React):
//   apps/frontend/src/pages/wms/analyticsV1Model.ts

import path from 'path';

const MODULE_REL = '../../apps/frontend/src/pages/wms/analyticsV1Model';

function loadModel(): Record<string, any> | null {
  try {
    return require(MODULE_REL);
  } catch (error: any) {
    // Only an absent module is the expected RED state; any other load error
    // (syntax, bad import) must surface as itself.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(path.basename(MODULE_REL))) return null;
    throw error;
  }
}

const loaded = loadModel();
function model(): Record<string, any> {
  if (!loaded) throw new Error('GH-1231 V1 contract missing: apps/frontend/src/pages/wms/analyticsV1Model.ts is not implemented');
  return loaded;
}

describe('GH-1231 V1 model — Flow stages', () => {
  it('exposes exactly the five ratified live stages, in process order, with plain labels', () => {
    expect(model().FLOW_STAGES).toEqual([
      { status: 'awaiting_pick', label: 'Waiting to be picked' },
      { status: 'picking', label: 'Being picked' },
      { status: 'picked', label: 'Waiting to be packed' },
      { status: 'packing', label: 'Being packed' },
      { status: 'packed', label: 'Ready to ship' },
    ]);
  });

  it('does not present shipped, partially shipped or cancelled orders as Flow stages', () => {
    const statuses = model().FLOW_STAGES.map((s: { status: string }) => s.status);
    for (const excluded of ['shipped', 'partially_shipped', 'cancelled']) expect(statuses).not.toContain(excluded);
  });
});

describe('GH-1231 V1 model — problem labels', () => {
  it.each([
    ['short_pick', 'Could not pick full amount'],
    ['item_missing', 'Item not found'],
    ['wrong_item', 'Wrong item'],
    ['product_defect', 'Damaged product'],
    ['packaging_defect', 'Damaged packaging'],
  ])('%s → "%s"', (code, label) => {
    expect(model().problemTypeLabel(code)).toBe(label);
  });

  it('an unknown code reads "Other problem" and never leaks the raw code', () => {
    expect(model().problemTypeLabel('pallet_collapse')).toBe('Other problem');
    expect(model().problemTypeLabel('')).toBe('Other problem');
  });

  it('no problem label infers a cause (bins, stock levels) or blames a person', () => {
    for (const code of ['short_pick', 'item_missing', 'wrong_item', 'product_defect', 'packaging_defect']) {
      const label: string = model().problemTypeLabel(code);
      expect(label).not.toMatch(/_/);
      expect(label).not.toMatch(/\bbin\b|not enough|out of stock|operator|picker|packer|fault|error by/i);
    }
  });
});

describe('GH-1231 V1 model — Team is alphabetical, not a ranking', () => {
  const rows = [
    { user_id: 4, display_name: 'zoë Park', items_picked: 1, items_packed: 0, is_current_member: true },
    { user_id: 3, display_name: 'Avery Lind', items_picked: 900, items_packed: 400, is_current_member: true },
    { user_id: 2, display_name: 'blake Moss', items_picked: 5, items_packed: 700, is_current_member: false },
    { user_id: 1, display_name: 'Avery Lind', items_picked: 2, items_packed: 2, is_current_member: true },
  ];

  it('sorts case-insensitively by display name, user_id breaks ties, volume never reorders', () => {
    const sorted = model().sortTeamAlphabetically(rows);
    expect(sorted.map((r: { user_id: number }) => r.user_id)).toEqual([1, 3, 2, 4]);
  });

  it('does not mutate the input and keeps former members in the list', () => {
    const input = rows.map((r) => ({ ...r }));
    const sorted = model().sortTeamAlphabetically(input);
    expect(input.map((r) => r.user_id)).toEqual([4, 3, 2, 1]);
    expect(sorted.some((r: { is_current_member: boolean }) => !r.is_current_member)).toBe(true);
  });

  it('"Showing K of N" only when rows are clipped', () => {
    expect(model().teamOverflowLabel(6, 9)).toBe('Showing 6 of 9');
    expect(model().teamOverflowLabel(4, 4)).toBeNull();
    expect(model().teamOverflowLabel(0, 0)).toBeNull();
  });
});

describe('GH-1231 V1 model — recorded-status age, unknown vs zero', () => {
  it.each([
    [0, 'Under 1 min'],
    [59, 'Under 1 min'],
    [2700, '45 min'],
    [10_800, '3 h'],
    [172_799, '47 h'],
    [172_800, '2 days'],
    [6_213_600, '71 days'],
    [86_400 * 400, '400 days'],
  ])('%i s → "%s" (uncapped)', (seconds, text) => {
    expect(model().formatStatusAge(seconds)).toBe(text);
  });

  it('an unknown age is "—", never a zero duration', () => {
    expect(model().formatStatusAge(null)).toBe('—');
    expect(model().formatStatusAge(undefined)).toBe('—');
  });

  it('ages of a day or more are flagged as from an earlier day; shorter ones are not', () => {
    expect(model().isEarlierDayAge(86_400)).toBe(true);
    expect(model().isEarlierDayAge(6_213_600)).toBe(true);
    expect(model().isEarlierDayAge(86_399)).toBe(false);
    expect(model().isEarlierDayAge(null)).toBe(false);
  });

  it('counts: genuine 0 renders "0"; unknown renders "—"', () => {
    expect(model().formatCount(0)).toBe('0');
    expect(model().formatCount(12)).toBe('12');
    expect(model().formatCount(null)).toBe('—');
    expect(model().formatCount(undefined)).toBe('—');
  });
});

describe('GH-1231 V1 model — partial current period', () => {
  it('daily buckets read "today so far"; weekly buckets read "this week so far"', () => {
    expect(model().partialPeriodLabel('day')).toBe('today so far');
    expect(model().partialPeriodLabel('week')).toBe('this week so far');
  });
});

describe('GH-1231 V1 model — Costs setup strip (U3)', () => {
  it('no rates: a plain Team setup affordance that promises nothing', () => {
    const copy = model().costsStripCopy(false);
    expect(copy).toEqual({ text: 'Hourly rates are set in Team', href: '/team' });
  });

  it('at least one rate: neutral availability statement, no link, no figure', () => {
    expect(model().costsStripCopy(true)).toEqual({ text: "Cost reporting isn't available in Analytics yet", href: null });
  });

  it('never states money, coverage or an unlock promise', () => {
    for (const unlocked of [false, true]) {
      const { text } = model().costsStripCopy(unlocked);
      expect(text).not.toMatch(/\d|[$€£¥]|kr\b|per order|per item|coverage|unlock|will show|to see/i);
    }
  });
});

describe('GH-1231 V1 model — carrier cutoff only when valid (U4)', () => {
  it('not configured or invalid → nothing shown', () => {
    for (const cpt of [null, '', '25:99', 'noon', '16']) expect(model().carrierCutoffCopy(cpt, 1.5)).toBeNull();
  });

  it('before the cutoff: shop-clock time and remaining time; accepts Postgres TIME "HH:MM:SS"', () => {
    expect(model().carrierCutoffCopy('16:00:00', 1.7833)).toBe('Carrier cutoff 16:00 (shop time) · 1h 47m left');
    expect(model().carrierCutoffCopy('09:30', 0.25)).toBe('Carrier cutoff 09:30 (shop time) · 15m left');
  });

  it('after today\'s cutoff: states it passed, with no pace or on-track judgement', () => {
    const text = model().carrierCutoffCopy('16:00:00', null);
    expect(text).toBe("Today's 16:00 cutoff has passed");
    expect(text).not.toMatch(/on track|behind|at risk|required|pace/i);
  });
});

describe('GH-1231 V1 model — active-batch assignment is qualified', () => {
  it('labels live.active_operators as batch assignment, never as people working now', () => {
    const copy = model().activeBatchAssignmentCopy(3);
    expect(copy.label).toBe('Assigned to active batches');
    expect(copy.value).toBe('3');
    expect(copy.qualification).toBe('Includes unfinished batches — not a count of people working right now.');
    expect(`${copy.label} ${copy.qualification}`).not.toMatch(/working now|on shift|headcount/i);
  });

  it('unknown assignment count is "—", not 0', () => {
    expect(model().activeBatchAssignmentCopy(null).value).toBe('—');
  });
});

describe('GH-1231 V1 model — no unsupported claims or calculations', () => {
  // Bans unsupported MERCHANT-FACING METRICS, not incidental helper naming:
  // export names are split into words (camelCase / snake_case / digits) and only
  // whole metric terms match, so harmless utilities (e.g. formatCurrency,
  // averageOf, meaningfulLabel, requiredField) are not forbidden.
  const words = (name: string) => name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
    .join(' ');
  const UNSUPPORTED_METRIC_NAME = /\b(?:uph|units per hour|accuracy|on track|vs (?:self|team)|rank(?:ed|ing|s)?|score|forecast|bottleneck|baseline|cost per (?:order|unit|item))\b/;

  it('exports no speed, accuracy, on-track, comparison, ranking, score, forecast, baseline or cost-per calculation', () => {
    const names = Object.keys(model());
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(`${name} → ${words(name)}`).not.toMatch(UNSUPPORTED_METRIC_NAME);
  });

  it('exported merchant copy (labels, constants and copy helpers) states no unsupported metric or claim', () => {
    const m = model();
    const strings: string[] = [];
    const collect = (v: unknown, depth = 0): void => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object' && depth < 4) for (const x of Object.values(v)) collect(x, depth + 1);
    };
    for (const v of Object.values(m)) if (typeof v !== 'function') collect(v);
    for (const code of ['short_pick', 'item_missing', 'wrong_item', 'product_defect', 'packaging_defect', 'unknown_code']) collect(m.problemTypeLabel(code));
    for (const unlocked of [false, true]) collect(m.costsStripCopy(unlocked));
    collect(m.carrierCutoffCopy('16:00:00', 1.5));
    collect(m.carrierCutoffCopy('16:00:00', null));
    collect(m.activeBatchAssignmentCopy(3));
    collect([m.partialPeriodLabel('day'), m.partialPeriodLabel('week'), m.teamOverflowLabel(6, 9)]);
    expect(strings.length).toBeGreaterThan(0);
    for (const text of strings) {
      expect(text).not.toMatch(/\bUPH\b|units per hour|accuracy|on track|at risk|behind|ahead of|vs\.? (?:self|team)|\brank|\bscore|forecast|bottleneck|usually|average|per order|per item|[$€£¥]|working now|on shift|headcount/i);
    }
  });

  it('no Flow stage label implies speed, targets or blame', () => {
    for (const { label } of model().FLOW_STAGES as { label: string }[]) {
      expect(label).not.toMatch(/slow|fast|late|behind|stuck|bottleneck|usually|average/i);
    }
  });
});
