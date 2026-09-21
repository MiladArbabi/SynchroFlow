// SLICE D2A — pure visual-projection contract: D1
// OrdersOperationalEpisodeAggregate[] -> OrdersOperationalVisual[].
// SLICE D3A — extends coverage to the just_resolved -> healthy/'✓' mapping.
//
// Fixtures are built via D1's own projectOrdersOperationalEpisodes()
// (never hand-built shared OperationalEpisodeProjection objects), so these
// tests prove the real D1 -> D2A/D3A composition, not an isolated D2A-only
// shape. D1 forwards lifecycle verbatim with no restriction, so a
// 'just_resolved' fixture item flows through it exactly like 'attention'/
// 'verifying' already do.
import { projectOrdersOperationalEpisodes } from '../../../../apps/frontend/src/pages/orders/ordersOperationalEpisodeProjection';
import type { OperationalEpisodeItem } from '../../../../apps/frontend/src/pages/orders/useOperationalEpisodes';
import { projectOrdersOperationalVisuals } from '../../../../apps/frontend/src/pages/orders/ordersOperationalEpisodeVisual';

const ORDER_1 = 'order-1';
const ORDER_2 = 'order-2';
const VARIANT_A = 'variant-a';
const VARIANT_B = 'variant-b';

function addressItem(overrides: Partial<OperationalEpisodeItem> = {}): OperationalEpisodeItem {
  return {
    episodeId: 'ep-address-1',
    constraintId: 'constraint-address-1',
    constraintStartedAt: '2026-09-20T09:00:00.000Z',
    lasyncroOrderId: ORDER_1,
    constraintType: 'customer',
    blockType: 'incomplete_address',
    targetId: null,
    lifecycle: 'attention',
    occurredAt: '2026-09-20T09:00:00.000Z',
    treatment: 'address_correction',
    interventionId: null,
    ...overrides,
  };
}

function oversellItem(overrides: Partial<OperationalEpisodeItem> = {}): OperationalEpisodeItem {
  return {
    episodeId: 'ep-oversell-1',
    constraintId: 'constraint-oversell-1',
    constraintStartedAt: '2026-09-20T09:00:00.000Z',
    lasyncroOrderId: ORDER_1,
    constraintType: 'inventory',
    blockType: 'oversell',
    targetId: VARIANT_A,
    lifecycle: 'attention',
    occurredAt: '2026-09-20T09:00:00.000Z',
    treatment: 'inventory_reorder_intent',
    interventionId: null,
    ...overrides,
  };
}

describe('D2A-01 — attention aggregate -> critical + !', () => {
  it('maps dominant.lifecycle=attention to state=critical, glyph=!', () => {
    const aggregates = projectOrdersOperationalEpisodes([addressItem({ lifecycle: 'attention' })]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);
    expect(visual.state).toBe('critical');
    expect(visual.glyph).toBe('!');
  });
});

describe('D2A-02 — verifying aggregate -> active + ◌', () => {
  it('maps dominant.lifecycle=verifying to state=active, glyph=◌', () => {
    const aggregates = projectOrdersOperationalEpisodes([addressItem({ lifecycle: 'verifying' })]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);
    expect(visual.state).toBe('active');
    expect(visual.glyph).toBe('◌');
  });
});

describe('D2A-03 — state depends on dominant lifecycle only', () => {
  it('an attention-dominant aggregate with a verifying sibling still reads critical', () => {
    const aggregates = projectOrdersOperationalEpisodes([
      addressItem({ lifecycle: 'verifying' }),
      oversellItem({ lifecycle: 'attention' }),
    ]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);
    // Sanity: the dominant really is the attention episode (shared precedence).
    expect(visual.dominant.lifecycle).toBe('attention');
    expect(visual.state).toBe('critical');
    expect(visual.glyph).toBe('!');
  });
});

describe('D2A-04 — address attention and oversell attention produce identical visual treatment', () => {
  it('domain never influences state/glyph', () => {
    const addressAggregates = projectOrdersOperationalEpisodes([addressItem({ lifecycle: 'attention' })]);
    const oversellAggregates = projectOrdersOperationalEpisodes([oversellItem({ lifecycle: 'attention' })]);
    const [addressVisual] = projectOrdersOperationalVisuals(addressAggregates);
    const [oversellVisual] = projectOrdersOperationalVisuals(oversellAggregates);

    expect(addressVisual.state).toBe(oversellVisual.state);
    expect(addressVisual.glyph).toBe(oversellVisual.glyph);
  });
});

describe('D2A-05 — verifying address and verifying oversell produce identical visual treatment', () => {
  it('domain never influences state/glyph', () => {
    const addressAggregates = projectOrdersOperationalEpisodes([addressItem({ lifecycle: 'verifying' })]);
    const oversellAggregates = projectOrdersOperationalEpisodes([oversellItem({ lifecycle: 'verifying' })]);
    const [addressVisual] = projectOrdersOperationalVisuals(addressAggregates);
    const [oversellVisual] = projectOrdersOperationalVisuals(oversellAggregates);

    expect(addressVisual.state).toBe(oversellVisual.state);
    expect(addressVisual.glyph).toBe(oversellVisual.glyph);
  });
});

describe('D2A-06/07 — multiple episodes retain complete episodes[] and episodeCount matches', () => {
  it('carries all constituent episodes through, with episodeCount === episodes.length', () => {
    const aggregates = projectOrdersOperationalEpisodes([
      addressItem({ lifecycle: 'attention' }),
      oversellItem({ lifecycle: 'attention' }),
    ]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);

    expect(visual.episodes).toHaveLength(2);
    expect(visual.episodeCount).toBe(visual.episodes.length);
    const domains = visual.episodes.map((e) => e.problem.domain).sort();
    expect(domains).toEqual(['customer', 'inventory']);
  });
});

describe('D2A-08 — exact orderId preserved', () => {
  it('carries D1 aggregate orderId through unchanged', () => {
    const aggregates = projectOrdersOperationalEpisodes([addressItem({ lasyncroOrderId: ORDER_2 })]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);
    expect(visual.orderId).toBe(ORDER_2);
  });
});

describe('D2A-09 — exact dominant object/actionTarget preserved', () => {
  it('the visual dominant is the exact same D1 dominant object, actionTarget included', () => {
    const aggregates = projectOrdersOperationalEpisodes([addressItem()]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);

    expect(visual.dominant).toBe(aggregates[0].dominant);
    expect(visual.dominant.actionTarget).toEqual({
      kind: 'entity',
      entity: { kind: 'order', id: ORDER_1 },
    });
  });
});

describe('D2A-10 — input aggregates are not mutated', () => {
  it('leaves a frozen D1 aggregate array/episodes untouched', () => {
    const aggregates = projectOrdersOperationalEpisodes([addressItem(), oversellItem()]);
    const frozenAggregates = Object.freeze(
      aggregates.map((a) =>
        Object.freeze({
          orderId: a.orderId,
          episodes: Object.freeze(a.episodes.slice()),
          dominant: a.dominant,
        })
      )
    );

    expect(() => projectOrdersOperationalVisuals(frozenAggregates)).not.toThrow();
    expect(frozenAggregates[0].episodes).toHaveLength(2);
  });
});

describe('D2A-11 — output order matches input aggregate order', () => {
  it('never resorts by severity/time in this layer', () => {
    const aggregates = projectOrdersOperationalEpisodes([
      addressItem({ lasyncroOrderId: ORDER_2, episodeId: 'ep-order2', constraintId: 'c-order2' }),
      oversellItem({ lasyncroOrderId: ORDER_1, episodeId: 'ep-order1', constraintId: 'c-order1' }),
    ]);
    // Sanity: D1 preserves first-seen-key order — order-2 first here.
    expect(aggregates.map((a) => a.orderId)).toEqual([ORDER_2, ORDER_1]);

    const visuals = projectOrdersOperationalVisuals(aggregates);
    expect(visuals.map((v) => v.orderId)).toEqual([ORDER_2, ORDER_1]);
  });
});

describe('D2A-12 — no spatial/location data is manufactured', () => {
  it('the visual carries no location-shaped fields, and inherited episodes keep zero spatialContext', () => {
    const aggregates = projectOrdersOperationalEpisodes([
      addressItem({ lifecycle: 'attention' }),
      oversellItem({ lifecycle: 'attention', targetId: VARIANT_B }),
    ]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);

    const visualKeys = Object.keys(visual);
    for (const forbidden of [
      'locationCode',
      'location',
      'bin',
      'station',
      'occupancy',
      'coordinates',
      'operationalStateByLocation',
    ]) {
      expect(visualKeys).not.toContain(forbidden);
    }

    for (const episode of visual.episodes) {
      expect(episode.spatialContext).toEqual([]);
    }
  });
});

// ── D3A — just_resolved -> healthy + ✓ ──────────────────────────────────────

describe('D3A-01 — just_resolved aggregate -> healthy + ✓', () => {
  it('maps dominant.lifecycle=just_resolved to state=healthy, glyph=✓ (address family)', () => {
    const aggregates = projectOrdersOperationalEpisodes([
      addressItem({ lifecycle: 'just_resolved', occurredAt: '2026-09-21T09:00:00.000Z' }),
    ]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);
    expect(visual.state).toBe('healthy');
    expect(visual.glyph).toBe('✓');
  });

  it('maps dominant.lifecycle=just_resolved to state=healthy, glyph=✓ (oversell family)', () => {
    const aggregates = projectOrdersOperationalEpisodes([
      oversellItem({ lifecycle: 'just_resolved', occurredAt: '2026-09-21T09:00:00.000Z' }),
    ]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);
    expect(visual.state).toBe('healthy');
    expect(visual.glyph).toBe('✓');
  });
});

describe('D3A-02 — exact dominant/actionTarget preserved for just_resolved', () => {
  it('the visual dominant is the exact same D1 dominant object, actionTarget included, occurredAt preserved', () => {
    const aggregates = projectOrdersOperationalEpisodes([
      addressItem({ lifecycle: 'just_resolved', occurredAt: '2026-09-21T09:00:00.000Z' }),
    ]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);

    expect(visual.dominant).toBe(aggregates[0].dominant);
    expect(visual.dominant.actionTarget).toEqual({
      kind: 'entity',
      entity: { kind: 'order', id: ORDER_1 },
    });
    expect(visual.dominant.occurredAt).toBe('2026-09-21T09:00:00.000Z');
  });
});

describe('D3A-03 — no spatial data manufactured for just_resolved', () => {
  it('carries no location-shaped fields and inherited episodes keep zero spatialContext', () => {
    const aggregates = projectOrdersOperationalEpisodes([
      addressItem({ lifecycle: 'just_resolved' }),
      oversellItem({ lifecycle: 'just_resolved', targetId: VARIANT_B }),
    ]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);

    const visualKeys = Object.keys(visual);
    for (const forbidden of [
      'locationCode',
      'location',
      'bin',
      'station',
      'occupancy',
      'coordinates',
      'operationalStateByLocation',
    ]) {
      expect(visualKeys).not.toContain(forbidden);
    }
    for (const episode of visual.episodes) {
      expect(episode.spatialContext).toEqual([]);
    }
  });
});

describe('D3A-04 — input not mutated for just_resolved', () => {
  it('leaves a frozen D1 aggregate array/episodes untouched', () => {
    const aggregates = projectOrdersOperationalEpisodes([
      addressItem({ lifecycle: 'just_resolved' }),
    ]);
    const frozenAggregates = Object.freeze(
      aggregates.map((a) =>
        Object.freeze({
          orderId: a.orderId,
          episodes: Object.freeze(a.episodes.slice()),
          dominant: a.dominant,
        })
      )
    );

    expect(() => projectOrdersOperationalVisuals(frozenAggregates)).not.toThrow();
    expect(frozenAggregates[0].episodes).toHaveLength(1);
    expect(frozenAggregates[0].dominant.lifecycle).toBe('just_resolved');
  });
});

describe('D3A-05 — attention/verifying behavior unchanged after adding just_resolved support', () => {
  it('attention still reads critical/!', () => {
    const aggregates = projectOrdersOperationalEpisodes([addressItem({ lifecycle: 'attention' })]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);
    expect(visual.state).toBe('critical');
    expect(visual.glyph).toBe('!');
  });

  it('verifying still reads active/◌', () => {
    const aggregates = projectOrdersOperationalEpisodes([oversellItem({ lifecycle: 'verifying' })]);
    const [visual] = projectOrdersOperationalVisuals(aggregates);
    expect(visual.state).toBe('active');
    expect(visual.glyph).toBe('◌');
  });
});
