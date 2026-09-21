// SLICE D1 — pure projector contract: D0 backend items ->
// OrdersOperationalEpisodeAggregate[]. No React/network/DOM involved;
// import type in ordersOperationalEpisodeProjection.ts keeps
// useOperationalEpisodes.ts's react-query/axios usage out of the
// PROJECTOR's own module graph. OPERATIONAL_EPISODES_QUERY_KEY below is a
// REAL (non-type) import specifically to prove useOperationalEpisodes.ts
// itself resolves under the frontend Jest environment — no hook render, no
// React Query harness.
import {
  projectOrdersOperationalEpisodes,
  type OrdersOperationalEpisodeAggregate,
} from '../../../../apps/frontend/src/pages/orders/ordersOperationalEpisodeProjection';
import {
  OPERATIONAL_EPISODES_QUERY_KEY,
  type OperationalEpisodeItem,
} from '../../../../apps/frontend/src/pages/orders/useOperationalEpisodes';

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

function aggregateFor(
  aggregates: readonly OrdersOperationalEpisodeAggregate[],
  orderId: string
): OrdersOperationalEpisodeAggregate | undefined {
  return aggregates.find((a) => a.orderId === orderId);
}

describe('useOperationalEpisodes query key contract', () => {
  it('resolves the hook module under the frontend Jest environment and locks the query key for D2/invalidation', () => {
    expect(OPERATIONAL_EPISODES_QUERY_KEY).toEqual(['operations', 'episodes']);
  });
});

describe('D1-01/05/07 — address attention -> canonical address projection', () => {
  it('projects customer/incomplete_address, blocking=true, zero spatial context, exact order actionTarget', () => {
    const result = projectOrdersOperationalEpisodes([addressItem()]);
    const aggregate = aggregateFor(result, ORDER_1)!;

    expect(aggregate.episodes).toHaveLength(1);
    const episode = aggregate.episodes[0];
    expect(episode.problem).toEqual({ domain: 'customer', type: 'incomplete_address' });
    expect(episode.blocking).toBe(true);
    expect(episode.severity).toBe('critical');
    expect(episode.primaryEntity).toEqual({ kind: 'order', id: ORDER_1 });
    expect(episode.spatialContext).toEqual([]); // item 5
    expect(episode.actionTarget).toEqual({
      kind: 'entity',
      entity: { kind: 'order', id: ORDER_1 },
    }); // item 7
    expect(episode.occurredAt).toBe('2026-09-20T09:00:00.000Z');
  });
});

describe('D1-02 — address verifying -> lifecycle preserved', () => {
  it('copies lifecycle=verifying verbatim, no inference', () => {
    const result = projectOrdersOperationalEpisodes([addressItem({ lifecycle: 'verifying' })]);
    const aggregate = aggregateFor(result, ORDER_1)!;
    expect(aggregate.episodes[0].lifecycle).toBe('verifying');
  });
});

describe('D1-03/06/07 — oversell attention -> exact variant projection', () => {
  it('projects inventory/oversell, blocking=true, exact variant, zero spatial context, exact order actionTarget', () => {
    const result = projectOrdersOperationalEpisodes([oversellItem()]);
    const aggregate = aggregateFor(result, ORDER_1)!;

    expect(aggregate.episodes).toHaveLength(1);
    const episode = aggregate.episodes[0];
    expect(episode.problem).toEqual({ domain: 'inventory', type: 'oversell' });
    expect(episode.blocking).toBe(true);
    expect(episode.severity).toBe('critical');
    expect(episode.primaryEntity).toEqual({ kind: 'order', id: ORDER_1 });
    expect(episode.affectedEntities).toEqual(
      expect.arrayContaining([
        { kind: 'order', id: ORDER_1 },
        { kind: 'variant', id: VARIANT_A },
      ])
    );
    expect(episode.spatialContext).toEqual([]); // item 6
    expect(episode.actionTarget).toEqual({
      kind: 'entity',
      entity: { kind: 'order', id: ORDER_1 },
    }); // item 7
  });
});

describe('D1-04 — oversell verifying -> lifecycle preserved', () => {
  it('copies lifecycle=verifying verbatim, no inference', () => {
    const result = projectOrdersOperationalEpisodes([oversellItem({ lifecycle: 'verifying' })]);
    const aggregate = aggregateFor(result, ORDER_1)!;
    expect(aggregate.episodes[0].lifecycle).toBe('verifying');
  });
});

describe('D1-08 — address + oversell on the same order => one aggregate, two episodes', () => {
  it('never manufactures a mega-episode', () => {
    const result = projectOrdersOperationalEpisodes([addressItem(), oversellItem()]);
    expect(result).toHaveLength(1);
    const aggregate = aggregateFor(result, ORDER_1)!;
    expect(aggregate.episodes).toHaveLength(2);
    const domains = aggregate.episodes.map((e) => e.problem.domain).sort();
    expect(domains).toEqual(['customer', 'inventory']);
  });
});

describe('D1-09 — two oversell variants on the same order => one aggregate, two episodes', () => {
  it('retains both distinct inventory episodes', () => {
    const result = projectOrdersOperationalEpisodes([
      oversellItem({ episodeId: 'ep-oversell-a', constraintId: 'c-a', targetId: VARIANT_A }),
      oversellItem({ episodeId: 'ep-oversell-b', constraintId: 'c-b', targetId: VARIANT_B }),
    ]);
    expect(result).toHaveLength(1);
    const aggregate = aggregateFor(result, ORDER_1)!;
    expect(aggregate.episodes).toHaveLength(2);
    const variantIds = aggregate.episodes
      .map((e) => e.affectedEntities.find((r) => r.kind === 'variant')?.id)
      .sort();
    expect(variantIds).toEqual([VARIANT_A, VARIANT_B]);
  });
});

describe('D1-10 — active attention dominates a verifying sibling', () => {
  it('picks the attention+blocking episode as dominant over verifying', () => {
    const result = projectOrdersOperationalEpisodes([
      addressItem({ lifecycle: 'verifying' }),
      oversellItem({ lifecycle: 'attention' }),
    ]);
    const aggregate = aggregateFor(result, ORDER_1)!;
    expect(aggregate.dominant.problem).toEqual({ domain: 'inventory', type: 'oversell' });
  });
});

describe('D1-11 — malformed inventory without target is omitted', () => {
  it('drops the row entirely rather than inventing a variant', () => {
    const result = projectOrdersOperationalEpisodes([oversellItem({ targetId: null })]);
    expect(result).toHaveLength(0);
  });
});

describe('D1-12 — unsupported constraintType/blockType pairing is omitted', () => {
  it('drops an operational-domain row', () => {
    const result = projectOrdersOperationalEpisodes([
      addressItem({
        constraintType: 'operational',
        blockType: 'returned_undelivered',
        targetId: null,
      }),
    ]);
    expect(result).toHaveLength(0);
  });

  it('drops a row whose blockType does not match its constraintType', () => {
    const result = projectOrdersOperationalEpisodes([
      addressItem({ constraintType: 'customer', blockType: 'oversell' }),
    ]);
    expect(result).toHaveLength(0);
  });
});

describe('D1-13 — episodes from two orders remain two aggregates', () => {
  it('never collapses distinct orders into one aggregate', () => {
    const result = projectOrdersOperationalEpisodes([
      addressItem({ lasyncroOrderId: ORDER_1 }),
      oversellItem({ lasyncroOrderId: ORDER_2, episodeId: 'ep-oversell-order2', constraintId: 'c-order2' }),
    ]);
    expect(result).toHaveLength(2);
    expect(aggregateFor(result, ORDER_1)?.episodes).toHaveLength(1);
    expect(aggregateFor(result, ORDER_2)?.episodes).toHaveLength(1);
  });
});

describe('D1-14 — input is not mutated', () => {
  it('leaves a frozen input array/items untouched', () => {
    const items = Object.freeze([
      Object.freeze(addressItem()),
      Object.freeze(oversellItem()),
    ]);

    expect(() => projectOrdersOperationalEpisodes(items)).not.toThrow();

    expect(items[0]).toEqual(addressItem());
    expect(items[1]).toEqual(oversellItem());
  });
});
