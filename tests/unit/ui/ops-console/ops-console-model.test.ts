// tests/unit/ui/ops-console/ops-console-model.test.ts
//
// OPS-CONSOLE-01 — row-model contracts.
//
// Protects the console's single consequential rule: a status glyph is a claim
// about persisted truth, so 'verified' and 'waiting' must be derivable ONLY
// from authoritative completion evidence. These are pure-function proofs; the
// rendered surface is covered by ops-console-surface.test.tsx.

import type { Alert } from 'pages/alerts/useAlerts';
import type { ChecklistItem } from 'hooks/useActivationChecklist';
import {
  OPS_STATUS_GLYPH,
  buildNowRows,
  buildAlertHistoryRows,
  buildSetupRows,
  buildWaitingRows,
  openAttentionCount,
  relativeAgeLabel,
} from 'components/OpsConsole/opsConsoleModel';

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a1',
    alert_key: 'k',
    source: 'wms',
    alert_type: 'wms_pick_exception',
    severity: 'critical',
    title: 'Pick exception on batch 12',
    message: 'm',
    entity_id: null,
    entity_type: null,
    revenue_impact: null,
    category: null,
    audience: 'all',
    is_active: true,
    dismissed_at: null,
    resolved_at: null,
    acknowledged_at: null,
    acknowledged_by: null,
    snoozed_until: null,
    escalated_at: null,
    rule_id: null,
    created_at: '2026-09-09T10:00:00.000Z',
    updated_at: '2026-09-09T10:00:00.000Z',
    ...over,
  };
}

const deepLink = (a: Alert) =>
  a.alert_type === 'wms_pick_exception'
    ? { route: '/problem-center', label: 'Problem Center' }
    : null;

// ─── STATUS SEMANTICS ────────────────────────────────────────────────────────

describe('status glyph semantics', () => {
  it('maps each ratified status to its ratified glyph', () => {
    expect(OPS_STATUS_GLYPH).toEqual({
      available:  '○',
      attention:  '!',
      actionable: '→',
      waiting:    '…',
      verified:   '✓',
      failed:     '×',
      dismissed:  '–',
      closed:     '·',
    });
  });
});

// ─── CHRONOLOGY ──────────────────────────────────────────────────────────────

describe('relativeAgeLabel', () => {
  const NOW = Date.parse('2026-09-09T12:00:00.000Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it('walks the ratified thresholds', () => {
    expect(relativeAgeLabel(ago(30_000), NOW)).toBe('just now');       // <2m
    expect(relativeAgeLabel(ago(90_000), NOW)).toBe('just now');       // <2m
    expect(relativeAgeLabel(ago(28 * 60_000), NOW)).toBe('28m');       // <60m
    expect(relativeAgeLabel(ago(59 * 60_000), NOW)).toBe('59m');       // <60m
    expect(relativeAgeLabel(ago(2 * 3_600_000), NOW)).toBe('2h');      // <24h
    expect(relativeAgeLabel(ago(23 * 3_600_000), NOW)).toBe('23h');    // <24h
  });

  it('falls back to a compact date once older than a day', () => {
    expect(relativeAgeLabel(ago(30 * 3_600_000), NOW)).toMatch(/^[A-Z][a-z]{2} \d{2}$/);
  });

  it('returns null for a missing or unparseable timestamp so the column is omitted', () => {
    expect(relativeAgeLabel(null, NOW)).toBeNull();
    expect(relativeAgeLabel('not-a-date', NOW)).toBeNull();
  });
});

// ─── NOW — CANONICAL ALERT SOURCE, ACK IS NOT RESOLUTION ─────────────────────

describe('NOW rows', () => {
  it('are built from canonical alerts, keep backend rank, and reuse the existing deep-link route', () => {
    const rows = buildNowRows(
      [alert({ id: 'a1' }), alert({ id: 'a2', severity: 'info', title: 'Second' })],
      deepLink,
    );

    expect(rows.map(r => r.id)).toEqual(['alert:a1', 'alert:a2']);
    expect(rows[0]).toMatchObject({
      section: 'NOW',
      status: 'attention',
      label: 'Pick exception on batch 12',
      action: { route: '/problem-center', label: 'Problem Center' },
    });
    expect(rows[1].status).toBe('actionable');
  });

  it('keeps an ACKNOWLEDGED alert open — acknowledgement is not resolution', () => {
    const [row] = buildNowRows(
      [alert({ acknowledged_at: '2026-09-09T11:00:00.000Z' })],
      deepLink,
    );

    expect(row.status).toBe('attention');
    expect(row.status).not.toBe('verified');
    expect(openAttentionCount([row])).toBe(1);
  });

  it('keeps severity out of visible meta but exposes it accessibly, and preserves tone + rank', () => {
    const rows = buildNowRows(
      [alert({ id: 'a1', severity: 'critical' }), alert({ id: 'a2', severity: 'warning' })],
      deepLink,
    );

    // Severity is no longer printed as a visible qualifier...
    expect(rows[0].meta).toBeUndefined();
    expect(rows[1].meta).toBeUndefined();
    // ...but it is neither lost nor weakened.
    expect(rows[0].a11yLabel).toBe('critical severity');
    expect(rows[1].a11yLabel).toBe('warning severity');
    expect(rows[0].tone).toBe('critical');
    expect(rows[1].tone).toBe('warning');
    expect(rows.map(r => r.id)).toEqual(['alert:a1', 'alert:a2']);
  });

  it('states acknowledgement in both the visible qualifier and the accessible label', () => {
    const [row] = buildNowRows(
      [alert({ severity: 'critical', acknowledged_at: '2026-09-09T11:00:00.000Z' })],
      deepLink,
    );
    expect(row.meta).toBe('acked');
    expect(row.a11yLabel).toBe('critical severity, acknowledged');
    expect(row.status).toBe('attention');
  });

  it('omits the action when no route exists rather than inventing one', () => {
    const [row] = buildNowRows([alert({ alert_type: 'unmapped_type' })], deepLink);
    expect(row.action).toBeUndefined();
  });
});

// ─── WAITING — DELIBERATELY EMPTY ────────────────────────────────────────────

describe('WAITING rows', () => {
  it('are empty: no shop-wide intervention/verification read model exists to source them', () => {
    expect(buildWaitingRows()).toEqual([]);
  });
});

// ─── SETUP — ONBOARDING TRUTH IS THE ONLY INPUT TO ✓ ─────────────────────────

describe('SETUP rows', () => {
  const items: ChecklistItem[] = [
    { key: 'connect-store', label: 'Connect your store', complete: true },
    { key: 'map-zones', label: 'Map your warehouse zones', complete: false, actionRoute: '/floor-planning' },
    { key: 'complete-sync', label: 'Complete your first sync', complete: false },
  ];

  it('marks ✓ only where the onboarding source reported complete', () => {
    const rows = buildSetupRows(items);
    expect(rows.map(r => [r.label, r.status])).toEqual([
      ['Connect your store', 'verified'],
      ['Map your warehouse zones', 'actionable'],
      ['Complete your first sync', 'available'],
    ]);
  });

  it('preserves the existing route on incomplete rows and offers no action once complete', () => {
    const rows = buildSetupRows(items);
    expect(rows[1].action).toEqual({ label: 'Open', route: '/floor-planning' });
    expect(rows[0].action).toBeUndefined();
  });
});

// ─── ALERT HISTORY — NEUTRAL, NEVER A VERIFIED OUTCOME ───────────────────────

describe('RECENT / HISTORY rows', () => {
  const resolved = [
    alert({ id: 'r1', title: 'Resolved one', resolved_at: '2026-09-08T09:00:00.000Z' }),
    alert({ id: 'r2', title: 'Resolved two', resolved_at: '2026-09-07T09:00:00.000Z' }),
    alert({ id: 'r3', title: 'Resolved three', resolved_at: '2026-09-06T09:00:00.000Z' }),
    alert({ id: 'r4', title: 'Resolved four', resolved_at: '2026-09-05T09:00:00.000Z' }),
  ];

  it('drops any row without a persisted resolved_at instead of showing it complete', () => {
    const rows = buildAlertHistoryRows(
      [...resolved, alert({ id: 'x1', title: 'Never resolved', resolved_at: null })],
      'HISTORY',
    );
    expect(rows.map(r => r.id)).not.toContain('history:x1');
    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.status === 'closed')).toBe(true);
  });

  it('NEVER presents a resolved alert as a verified Decision Engine outcome', () => {
    const rows = [
      ...buildAlertHistoryRows(resolved, 'RECENT', 3),
      ...buildAlertHistoryRows(resolved, 'HISTORY'),
    ];

    // resolved_at is authoritative for the ALERT's lifecycle only. It must not
    // be promoted into the ✓ / verified vocabulary, which is reserved for
    // sources that actually establish completion.
    expect(rows.some(r => r.status === 'verified')).toBe(false);
    expect(rows.every(r => r.status === 'closed')).toBe(true);
    expect(rows.map(r => OPS_STATUS_GLYPH[r.status])).not.toContain('✓');

    // And the row wording asserts no cause, resolution or prevention.
    const words = rows.map(r => `${r.label} ${r.meta ?? ''}`.toLowerCase()).join(' ');
    for (const causal of ['verified', 'resolved by', 'prevented', 'fixed', 'saved', 'intervention']) {
      expect(words).not.toContain(causal);
    }
  });

  it('shows chronology instead of repeating the word "closed"', () => {
    const NOW = Date.parse('2026-09-09T12:00:00.000Z');
    const rows = buildAlertHistoryRows(
      [
        alert({ id: 'c1', resolved_at: new Date(NOW - 28 * 60_000).toISOString() }),
        alert({ id: 'c2', resolved_at: new Date(NOW - 2 * 3_600_000).toISOString() }),
        alert({ id: 'c3', resolved_at: new Date(NOW - 40 * 3_600_000).toISOString() }),
      ],
      'RECENT', undefined, NOW,
    );

    expect(rows.map(r => r.meta)).toEqual(['28m', '2h', expect.stringMatching(/^[A-Z][a-z]{2} \d{2}$/)]);
    expect(rows.map(r => r.meta)).not.toContain('closed');
    // The closed fact still reaches assistive tech via the row's a11y label.
    expect(rows.every(r => r.a11yLabel === 'alert closed')).toBe(true);
  });

  it('limits RECENT while HISTORY carries the full authoritative list', () => {
    expect(buildAlertHistoryRows(resolved, 'RECENT', 3)).toHaveLength(3);
    expect(buildAlertHistoryRows(resolved, 'HISTORY')).toHaveLength(4);
  });
});

// ─── BADGE — OPEN ATTENTION ONLY ─────────────────────────────────────────────

describe('openAttentionCount', () => {
  it('counts open NOW + SETUP rows and excludes completed setup, RECENT and HISTORY', () => {
    const rows = [
      ...buildNowRows([alert({ id: 'a1' })], deepLink),                       // open
      ...buildSetupRows([
        { key: 'a', label: 'Done', complete: true },                          // excluded
        { key: 'b', label: 'Todo', complete: false, actionRoute: '/x' },      // open
      ]),
      ...buildAlertHistoryRows([alert({ id: 'r1', resolved_at: 'now' })], 'RECENT'),   // excluded
      ...buildAlertHistoryRows([alert({ id: 'r2', resolved_at: 'now' })], 'HISTORY'),  // excluded
    ];

    expect(rows).toHaveLength(5);
    expect(openAttentionCount(rows)).toBe(2);
  });
});
