/**
 * ORD-DECISION-01 / Slice 3A — Order Pool VISUAL ordering invariant.
 *
 * The backend returns the pool already ranked
 *   is_priority_flagged DESC, COALESCE(is_shipping_sla_breached,false) DESC,
 *   order_created_at ASC
 * and OrderFlowPage previously re-sorted the rows by the operator's chosen
 * field alone, discarding that prefix — an SLA-breached order could be pushed
 * below a calm one purely because it was younger.
 *
 * comparePoolOrders (apps/frontend/src/pages/ft2-pages/orderPoolSorting.ts)
 * is the client's single expression of that ranking. These cases protect the
 * ordering contract only — no DOM, no copy, no styling.
 */
import {
  comparePoolOrders,
  type PoolSortableOrder,
} from '../../../apps/frontend/src/pages/ft2-pages/orderPoolSorting';

type Row = PoolSortableOrder & { id: string };

function row(
  id: string,
  overrides: Partial<PoolSortableOrder> = {},
): Row {
  return {
    id,
    // Fixed epoch baseline — these tests assert relative order, never clock time.
    order_created_at: '2026-09-01T12:00:00.000Z',
    total_price: '100.00',
    line_item_count: 1,
    unit_count: 1,
    is_priority_flagged: false,
    is_shipping_sla_breached: false,
    ...overrides,
  };
}

const ids = (rows: Row[], field: Parameters<typeof comparePoolOrders>[0], dir: 'asc' | 'desc') =>
  [...rows].sort(comparePoolOrders<Row>(field, dir)).map((r) => r.id);

describe('ORD-DECISION-01 — Order Pool visual ordering', () => {
  it('SLA-DEC-02-UI-A keeps a breached order ahead of a calm one under either Age direction', () => {
    // The breached order is the YOUNGER of the two, so Age sorting on its own
    // would place it last in one direction and first in the other. Neither
    // direction may demote it below the calm order.
    const breached = row('breached', {
      is_shipping_sla_breached: true,
      order_created_at: '2026-09-01T12:00:00.000Z',
    });
    const calm = row('calm', {
      is_shipping_sla_breached: false,
      order_created_at: '2026-08-01T12:00:00.000Z',
    });
    const pool = [calm, breached];

    expect(ids(pool, 'age', 'asc')).toEqual(['breached', 'calm']);
    expect(ids(pool, 'age', 'desc')).toEqual(['breached', 'calm']);

    // Same guarantee on every other sortable column.
    expect(ids([calm, row('breached', { is_shipping_sla_breached: true, total_price: '1.00' })], 'value', 'desc'))
      .toEqual(['breached', 'calm']);
    expect(ids([calm, row('breached', { is_shipping_sla_breached: true, line_item_count: 0 })], 'lines', 'desc'))
      .toEqual(['breached', 'calm']);
    expect(ids([calm, row('breached', { is_shipping_sla_breached: true, unit_count: 0 })], 'units', 'desc'))
      .toEqual(['breached', 'calm']);
  });

  it('SLA-DEC-02-UI-B keeps priority-flagged ahead of SLA-only, and both ahead of neither', () => {
    // Deliberately adversarial ages: the highest tier is the youngest row, so
    // any leak of the Age key into the tier comparison inverts the result.
    const both = row('both', {
      is_priority_flagged: true,
      is_shipping_sla_breached: true,
      order_created_at: '2026-09-04T12:00:00.000Z',
    });
    const priorityOnly = row('priority', {
      is_priority_flagged: true,
      order_created_at: '2026-09-03T12:00:00.000Z',
    });
    const slaOnly = row('sla', {
      is_shipping_sla_breached: true,
      order_created_at: '2026-09-02T12:00:00.000Z',
    });
    const neither = row('neither', { order_created_at: '2026-09-01T12:00:00.000Z' });
    const pool = [neither, slaOnly, priorityOnly, both];

    const expected = ['both', 'priority', 'sla', 'neither'];
    expect(ids(pool, 'age', 'asc')).toEqual(expected);
    expect(ids(pool, 'age', 'desc')).toEqual(expected);
    expect(ids(pool, 'value', 'asc')).toEqual(expected);

    // A null breach flag (no age snapshot yet) ranks as not-breached, exactly
    // as COALESCE(is_shipping_sla_breached, false) does on the server.
    const unknown = row('unknown', { is_shipping_sla_breached: null });
    expect(ids([unknown, slaOnly], 'age', 'asc')).toEqual(['sla', 'unknown']);
  });

  it('SLA-DEC-02-UI-C still applies the operator sort inside a tier, in both directions', () => {
    const mk = (id: string, over: Partial<PoolSortableOrder>) =>
      row(id, { is_shipping_sla_breached: true, ...over });

    const byAge = [
      mk('new', { order_created_at: '2026-09-03T12:00:00.000Z' }),
      mk('old', { order_created_at: '2026-09-01T12:00:00.000Z' }),
      mk('mid', { order_created_at: '2026-09-02T12:00:00.000Z' }),
    ];
    expect(ids(byAge, 'age', 'asc')).toEqual(['old', 'mid', 'new']);
    expect(ids(byAge, 'age', 'desc')).toEqual(['new', 'mid', 'old']);

    const byValue = [
      mk('cheap', { total_price: '10.00' }),
      mk('rich', { total_price: '900.00' }),
      mk('mid', { total_price: '100.00' }),
    ];
    expect(ids(byValue, 'value', 'asc')).toEqual(['cheap', 'mid', 'rich']);
    expect(ids(byValue, 'value', 'desc')).toEqual(['rich', 'mid', 'cheap']);

    const byLines = [mk('l3', { line_item_count: 3 }), mk('l1', { line_item_count: 1 })];
    expect(ids(byLines, 'lines', 'asc')).toEqual(['l1', 'l3']);
    expect(ids(byLines, 'lines', 'desc')).toEqual(['l3', 'l1']);

    const byUnits = [mk('u7', { unit_count: 7 }), mk('u2', { unit_count: 2 })];
    expect(ids(byUnits, 'units', 'asc')).toEqual(['u2', 'u7']);
    expect(ids(byUnits, 'units', 'desc')).toEqual(['u7', 'u2']);

    // Tier boundaries hold while the within-tier sort is applied: each tier is
    // ordered internally, and no tier member crosses a tier line.
    const mixed = [
      row('p-cheap', { is_priority_flagged: true, total_price: '10.00' }),
      row('p-rich', { is_priority_flagged: true, total_price: '900.00' }),
      row('s-cheap', { is_shipping_sla_breached: true, total_price: '10.00' }),
      row('s-rich', { is_shipping_sla_breached: true, total_price: '900.00' }),
    ];
    expect(ids(mixed, 'value', 'desc')).toEqual(['p-rich', 'p-cheap', 's-rich', 's-cheap']);
    expect(ids(mixed, 'value', 'asc')).toEqual(['p-cheap', 'p-rich', 's-cheap', 's-rich']);
  });
});
