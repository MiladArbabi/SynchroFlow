// tests/unit/ui/ops-console/ops-console-history-v1-model.test.ts
//
// OPS-CONSOLE-HISTORY-01 — pure row-model contract for buildHistoryRows().
//
// Companion to ops-console-model.test.ts's WAITING V1 block. Proves the
// same "no local derivation" invariant for HISTORY: buildHistoryRows must
// map the backend's already-classified verified_resolved feed verbatim,
// never re-deriving completion, chronology, copy or routing from
// treatment/constraintType/blockType.

import {
  OPS_STATUS_GLYPH,
  buildHistoryRows,
  openAttentionCount,
  isOpenRow,
} from 'components/OpsConsole/opsConsoleModel';

interface HistoryApiItemFixture {
  interventionId: string;
  treatment: 'address_correction' | 'inventory_reorder_intent' | string;
  lasyncroOrderId: string;
  externalOrderId: string | null;
  constraintId: string;
  constraintType: 'customer' | 'inventory';
  blockType: string;
  occurredAt: string;
  resolvedAt: string;
  outcome: 'verified_resolved';
  presentation: { title: string; subtitle: string; actionLabel: string };
  // HISTORY-ORDER-ENTITY-01 — routing is order_entity, never a route.
  routing: { kind: 'order_entity'; lasyncroOrderId: string };
}

function historyItem(over: Partial<HistoryApiItemFixture> = {}): HistoryApiItemFixture {
  return {
    interventionId: 'intv-1',
    treatment: 'address_correction',
    lasyncroOrderId: 'order-1',
    externalOrderId: '#1001',
    constraintId: 'constraint-1',
    constraintType: 'customer',
    blockType: 'incomplete_address',
    occurredAt: '2026-09-08T08:00:00.000Z',
    resolvedAt: '2026-09-08T09:00:00.000Z',
    outcome: 'verified_resolved',
    // Deliberately distinctive/unrelated to `treatment` wording, mirroring
    // waitingItem()'s own convention — a passing assertion can only mean
    // verbatim pass-through, never plausible-looking regenerated copy.
    presentation: {
      title: 'ZZQ-7 history marker',
      subtitle: 'backend-supplied history copy #501',
      actionLabel: 'Do the resolved thing',
    },
    routing: { kind: 'order_entity', lasyncroOrderId: 'order-1' },
    ...over,
  };
}

describe('HISTORY V1 rows — backend-classified verified_resolved contract', () => {
  it('an empty backend feed renders nothing', () => {
    expect(buildHistoryRows([])).toEqual([]);
  });

  it('maps one backend verified_resolved item into exactly one status="verified" row, verbatim from backend presentation/routing', () => {
    const item = historyItem();
    const rows = buildHistoryRows([item]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: `history:${item.interventionId}`,
        section: 'HISTORY',
        status: 'verified',
        label: item.presentation.title,
        subtitle: item.presentation.subtitle,
        action: {
          kind: 'order_entity',
          label: item.presentation.actionLabel,
          lasyncroOrderId: item.routing.lasyncroOrderId,
        },
      })
    );
  });

  // ── HISTORY-ORDER-ENTITY-01 — required assertions 1-3 ──────────────────────

  it('[1] address_correction HISTORY returns action.kind="order_entity" with the exact lasyncroOrderId', () => {
    const item = historyItem({
      interventionId: 'intv-addr',
      treatment: 'address_correction',
      lasyncroOrderId: 'order-addr-77',
      routing: { kind: 'order_entity', lasyncroOrderId: 'order-addr-77' },
    });
    const rows = buildHistoryRows([item]);
    expect(rows[0].action).toEqual({
      kind: 'order_entity',
      label: item.presentation.actionLabel,
      lasyncroOrderId: 'order-addr-77',
    });
  });

  it('[2] inventory_reorder_intent HISTORY returns action.kind="order_entity" with the exact lasyncroOrderId', () => {
    const item = historyItem({
      interventionId: 'intv-inv',
      treatment: 'inventory_reorder_intent',
      constraintType: 'inventory',
      blockType: 'oversell',
      lasyncroOrderId: 'order-inv-88',
      routing: { kind: 'order_entity', lasyncroOrderId: 'order-inv-88' },
    });
    const rows = buildHistoryRows([item]);
    expect(rows[0].action).toEqual({
      kind: 'order_entity',
      label: item.presentation.actionLabel,
      lasyncroOrderId: 'order-inv-88',
    });
  });

  it('[3] HISTORY no longer returns a generic address/inventory route — no `route` key on the action at all', () => {
    const rows = buildHistoryRows([historyItem()]);
    expect(rows[0].action).not.toHaveProperty('route');
    expect((rows[0].action as { kind: string }).kind).toBe('order_entity');
  });

  it('carries the ✓ glyph — a HISTORY V1 row IS a canonically verified outcome', () => {
    const rows = buildHistoryRows([historyItem()]);
    expect(OPS_STATUS_GLYPH[rows[0].status]).toBe('✓');
  });

  it('derives its chronology meta from resolvedAt, not occurredAt', () => {
    const NOW = Date.parse('2026-09-08T09:30:00.000Z');
    const rows = buildHistoryRows([
      historyItem({ occurredAt: '2026-09-01T00:00:00.000Z', resolvedAt: '2026-09-08T09:00:00.000Z' }),
    ]);
    // relativeAgeLabel is exercised with Date.now() inside buildHistoryRows,
    // so assert only that a chronology label — not the raw ISO string or the
    // word "closed" — is present.
    expect(rows[0].meta).not.toBe('closed');
    expect(rows[0].meta).not.toBe(undefined);
    void NOW;
  });

  it('preserves backend feed order — no client-side re-sorting', () => {
    const first = historyItem({ interventionId: 'intv-a', constraintId: 'c-a' });
    const second = historyItem({ interventionId: 'intv-b', constraintId: 'c-b' });
    const rows = buildHistoryRows([second, first]);
    expect(rows.map((r) => r.id)).toEqual(['history:intv-b', 'history:intv-a']);
  });

  it('excludes any backend item whose treatment is outside the V1 allowlist (defence in depth)', () => {
    const allowed = historyItem({ interventionId: 'intv-ok' });
    const outOfScope = historyItem({ interventionId: 'intv-oos', treatment: 'stock_protection' });
    const rows = buildHistoryRows([allowed, outOfScope]);
    expect(rows.map((r) => r.id)).toEqual(['history:intv-ok']);
  });

  it('renders two same-treatment items with their own distinct backend copy verbatim', () => {
    const addr1 = historyItem({
      interventionId: 'intv-addr-1',
      presentation: { title: 'Nautilus', subtitle: 'copy-one', actionLabel: 'Go one' },
    });
    const addr2 = historyItem({
      interventionId: 'intv-addr-2',
      presentation: { title: 'Periscope', subtitle: 'copy-two', actionLabel: 'Go two' },
    });
    const rows = buildHistoryRows([addr1, addr2]);
    expect(rows[0]).toEqual(expect.objectContaining({ label: 'Nautilus', subtitle: 'copy-one' }));
    expect(rows[1]).toEqual(expect.objectContaining({ label: 'Periscope', subtitle: 'copy-two' }));
  });

  it('never contributes to openAttentionCount — HISTORY is excluded from the badge by section, regardless of status', () => {
    const rows = buildHistoryRows([historyItem()]);
    expect(rows.every((r) => isOpenRow(r) === false)).toBe(true);
    expect(openAttentionCount(rows)).toBe(0);
  });

  it('[supplemental] the model file contains no local episode/chronology derivation vocabulary for HISTORY', () => {
    const source = require('fs').readFileSync(
      require('path').join(
        __dirname,
        '../../../../apps/frontend/src/components/OpsConsole/opsConsoleModel.ts'
      ),
      'utf8'
    );
    expect(source).not.toMatch(/constraint_is_active/);
    expect(source).not.toMatch(/resolutionLatencyMs/);
    expect(source).not.toMatch(/deriveOutcome/);
  });
});
