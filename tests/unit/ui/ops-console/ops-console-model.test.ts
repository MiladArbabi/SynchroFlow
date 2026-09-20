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
  buildSetupRows,
  buildWaitingRows,
  isNowActionable,
  NOW_ACTIONABLE_ALERT_TYPES,
  NOW_VISIBLE_LIMIT,
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
    treatment: null,
    action: null,
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

  it('EXCLUDES an alert with no operational destination instead of rendering a dead end', () => {
    const rows = buildNowRows(
      [
        alert({ id: 'a1' }),                                // mapped
        alert({ id: 'a2', alert_type: 'unmapped_type' }),   // no destination
      ],
      deepLink,
    );

    expect(rows.map(r => r.id)).toEqual(['alert:a1']);
    // Every NOW row that survives carries a real action — no generic
    // "View" / "Manage alert" fallback was synthesised to keep the other one.
    expect(rows.every(r => r.action !== undefined)).toBe(true);
    const labels = rows.map(r => r.action!.label);
    expect(labels).not.toContain('View');
    expect(labels).not.toContain('Manage alert');
  });

  it('counts only actionable rows, so the NOW count is workload not alert volume', () => {
    const inbox = [
      alert({ id: 'a1' }),
      alert({ id: 'a2', alert_type: 'unmapped_type' }),
      alert({ id: 'a3', alert_type: 'also_unmapped' }),
      alert({ id: 'a4' }),
    ];
    expect(inbox).toHaveLength(4);
    expect(buildNowRows(inbox, deepLink)).toHaveLength(2);
  });

  it('caps the rendered queue at five while leaving the count intact', () => {
    // The cap is a rendering limit only; the model still returns everything.
    expect(NOW_VISIBLE_LIMIT).toBe(5);
    const many = Array.from({ length: 8 }, (_, i) => alert({ id: `a${i}` }));
    expect(buildNowRows(many, deepLink)).toHaveLength(8);
  });
});

// ─── NOW ELIGIBILITY POLICY ──────────────────────────────────────────────────

describe('NOW eligibility policy — NOW V1 ratified allowlist', () => {
  // Every type resolves to a route, so the route is NOT what decides.
  const routeForAll = () => ({ route: '/wms', label: 'Warehouse' });

  // RATIFIED NOW V1 — exactly these 10 alert types. Anything else, however
  // routable, is not "a decision to make" and must not consume a NOW slot.
  const ACTIONABLE = [
    'sla_breach',
    'inventory',
    'customer',
    'stockout_risk',
    'low_stock_reorder',
    'stock_protection',
    'wms_pick_exception',
    'wms_pack_exception',
    'wms_stow_exception',
    'wms_receive_exception',
  ];

  // Ratified as explicitly NOT NOW-actionable, even though each currently
  // resolves to a real route. These are normal workflow progression /
  // duplicate summary / setup-debt signals, not new merchant decisions.
  const NOT_ACTIONABLE = [
    'operational',
    'revenue_at_risk',
    'missing_cogs',
    'reorder_warning',
    'wms_stow_pending',
    'wms_receive_arrived',
    'wms_batch_ready_to_pack',
    'wms_batch_ready_to_ship',
  ];

  it('A: classifies exactly the ratified 10-item actionable set', () => {
    expect([...NOW_ACTIONABLE_ALERT_TYPES].sort()).toEqual([...ACTIONABLE].sort());
    expect(NOW_ACTIONABLE_ALERT_TYPES.size).toBe(10);
    for (const alert_type of ACTIONABLE) {
      expect(isNowActionable(alert({ alert_type }))).toBe(true);
    }
  });

  it.each(NOT_ACTIONABLE)(
    'B: %s is NOT NOW-actionable under NOW V1',
    (alert_type) => {
      expect(isNowActionable(alert({ alert_type }))).toBe(false);
    },
  );

  it.each(NOT_ACTIONABLE)(
    'C: %s stays excluded from NOW even with a perfectly valid route',
    (alert_type) => {
      const row = alert({ alert_type });

      // Proof the exclusion is POLICY, not a missing destination.
      expect(routeForAll()).toEqual({ route: '/wms', label: 'Warehouse' });
      expect(buildNowRows([row], routeForAll)).toEqual([]);
    },
  );

  it('excludes wms_batch_released even though its route is perfectly valid', () => {
    const released = alert({ alert_type: 'wms_batch_released' });

    // Proof the exclusion is the POLICY, not a missing destination.
    expect(routeForAll()).toEqual({ route: '/wms', label: 'Warehouse' });
    expect(isNowActionable(released)).toBe(false);
    expect(buildNowRows([released], routeForAll)).toEqual([]);
  });

  it('excludes an unknown alert type by default, route or not', () => {
    expect(isNowActionable(alert({ alert_type: 'brand_new_signal_2027' }))).toBe(false);
    expect(buildNowRows([alert({ alert_type: 'brand_new_signal_2027' })], routeForAll))
      .toEqual([]);
  });

  it('requires BOTH classification and a destination', () => {
    const noRoute = () => null;
    // Classified, but unroutable.
    expect(buildNowRows([alert({ alert_type: 'sla_breach' })], noRoute)).toEqual([]);
    // Routable, but unclassified.
    expect(buildNowRows([alert({ alert_type: 'wms_batch_released' })], routeForAll)).toEqual([]);
  });

  it('preserves backend order among eligible rows and lets excluded ones consume nothing', () => {
    const inbox = [
      alert({ id: 'a1', alert_type: 'sla_breach' }),
      alert({ id: 'x1', alert_type: 'wms_batch_released' }),   // excluded (both policies)
      alert({ id: 'a2', alert_type: 'customer' }),
      alert({ id: 'x2', alert_type: 'operational' }),          // excluded (NOW V1 only)
      alert({ id: 'a3', alert_type: 'inventory' }),
    ];
    const rows = buildNowRows(inbox, routeForAll);

    // Order preserved, gaps closed, excluded rows uncounted.
    expect(rows.map(r => r.id)).toEqual(['alert:a1', 'alert:a2', 'alert:a3']);
    expect(rows).toHaveLength(3);
    expect(openAttentionCount(rows)).toBe(3);
  });

  it('excluded rows do not consume the five-row visible cap', () => {
    // 5 eligible interleaved with 4 excluded: all 5 eligible must survive, so
    // none of the visible slots was spent on a progress event.
    const inbox = [
      alert({ id: 'a1', alert_type: 'sla_breach' }),
      alert({ id: 'x1', alert_type: 'wms_batch_released' }),
      alert({ id: 'a2', alert_type: 'inventory' }),
      alert({ id: 'x2', alert_type: 'wms_batch_released' }),
      alert({ id: 'a3', alert_type: 'customer' }),
      alert({ id: 'x3', alert_type: 'wms_batch_released' }),
      alert({ id: 'a4', alert_type: 'stockout_risk' }),
      alert({ id: 'x4', alert_type: 'unknown_type' }),
      alert({ id: 'a5', alert_type: 'low_stock_reorder' }),
    ];
    const rows = buildNowRows(inbox, routeForAll);

    expect(rows).toHaveLength(NOW_VISIBLE_LIMIT);
    expect(rows.slice(0, NOW_VISIBLE_LIMIT).map(r => r.id))
      .toEqual(['alert:a1', 'alert:a2', 'alert:a3', 'alert:a4', 'alert:a5']);
  });

  // ── STOCK-PROTECT-03 Slice 3B ────────────────────────────────────────────
  // stock_protection is classified actionable, but — exactly like every
  // other alert_type — earns a NOW row ONLY when deepLink() resolves
  // non-null. The console never inspects `treatment` itself; the injected
  // deepLink resolver (in production, alertDeepLink()) is the only place
  // that reads the backend-derived `action` field.

  it('F: stock_protection + a resolvable deep link -> appears in NOW', () => {
    const spDeepLink = (a: ReturnType<typeof alert>) =>
      a.alert_type === 'stock_protection' && a.action
        ? { route: a.action.route, label: a.action.label }
        : null;
    const sp = alert({
      alert_type: 'stock_protection',
      action: { key: 'stock_protection_reorder_now', label: 'Reorder now', route: '/suppliers-portal/sourcing?variantId=v1', module: 'suppliers-portal' },
    });

    const rows = buildNowRows([sp], spDeepLink);

    expect(rows).toHaveLength(1);
    expect(rows[0].action).toEqual({ kind: 'navigate', label: 'Reorder now', route: '/suppliers-portal/sourcing?variantId=v1' });
  });

  it('G: stock_protection + action=null (e.g. complete_setup) -> excluded from NOW', () => {
    const spDeepLink = (a: ReturnType<typeof alert>) =>
      a.alert_type === 'stock_protection' && a.action
        ? { route: a.action.route, label: a.action.label }
        : null;
    const sp = alert({ alert_type: 'stock_protection', action: null });

    expect(buildNowRows([sp], spDeepLink)).toEqual([]);
  });

  it('H: legacy actionable types are unaffected by the stock_protection addition', () => {
    for (const alert_type of ['sla_breach', 'stockout_risk', 'wms_pick_exception']) {
      expect(isNowActionable(alert({ alert_type }))).toBe(true);
    }
    const rows = buildNowRows(
      [alert({ id: 'legacy1', alert_type: 'sla_breach' })],
      routeForAll,
    );
    expect(rows).toHaveLength(1);
  });
});

// ─── WAITING V1 — BACKEND-CLASSIFIED PENDING ITEMS ONLY (RED CONTRACT) ───────
//
// OPS-CONSOLE-WAITING-01. SUPERSEDES the prior "WAITING rows / DELIBERATELY
// EMPTY" block above, which asserted buildWaitingRows() was permanently and
// unconditionally [] — that specific claim is now WRONG under the ratified
// V1 contract (WAITING renders backend-classified pending_verification
// items once a shop-wide read model exists). The invariant that block
// actually protected — this file must never locally DERIVE 'waiting' from
// raw constraint/intervention fields, only render what the backend already
// classified — is carried forward below (the "no local derivation" source
// check) rather than dropped.
//
// buildWaitingRows(items) is EXPECTED to accept the backend's WAITING feed,
// exactly mirroring how buildDecisionNowRows(decisions) already maps the
// canonical Decision Feed above. It does not have that shape yet —
// buildWaitingRows() currently takes no parameters and always returns [] —
// so every populated-input case below is RED until that shape exists.
//
// Row-id convention: `waiting:${interventionId}`, matching the existing
// `alert:${id}` / `decision:${decisionId}` / `setup:${key}` /
// `history:${id}` convention already used by the sibling builders.
//
// COPY IS NOT RATIFIED (correction pass, 2026-09-18). Fixture title /
// subtitle / actionLabel below are DELIBERATELY distinctive nonsense —
// unrelated to `treatment`'s wording — so a passing assertion can only mean
// the builder rendered backend copy VERBATIM, never that it happened to
// regenerate plausible-sounding address/inventory copy of its own. Only
// routing.route is a ratified, real, exact string.

interface WaitingApiItemFixture {
  interventionId: string;
  treatment: 'address_correction' | 'inventory_reorder_intent' | string;
  lasyncroOrderId: string;
  externalOrderId: string | null;
  constraintId: string;
  constraintType: 'customer' | 'inventory';
  blockType: string;
  occurredAt: string;
  outcome: 'pending_verification';
  presentation: { title: string; subtitle: string; actionLabel: string };
  routing: { route: string };
}

function waitingItem(over: Partial<WaitingApiItemFixture> = {}): WaitingApiItemFixture {
  return {
    interventionId: 'intv-1',
    treatment: 'address_correction',
    lasyncroOrderId: 'order-1',
    externalOrderId: '#1001',
    constraintId: 'constraint-1',
    constraintType: 'customer',
    blockType: 'incomplete_address',
    occurredAt: '2026-09-18T10:00:00.000Z',
    outcome: 'pending_verification',
    // Deliberately distinctive/unrelated to `treatment` — see note above.
    presentation: {
      title: 'ZZQ-7 marker',
      subtitle: 'backend-supplied waiting copy #482',
      actionLabel: 'Do the thing',
    },
    routing: { route: '/overview?resolution=address' },
    ...over,
  };
}

describe('WAITING rows — V1 backend-classified contract (supersedes the prior "always empty" contract)', () => {
  it('an empty backend feed still renders nothing — this part of the prior contract survives V1 unchanged', () => {
    expect((buildWaitingRows as unknown as (items: WaitingApiItemFixture[]) => unknown[])([])).toEqual([]);
  });

  it('maps one backend pending_verification item into exactly one status=\'waiting\' row, verbatim from backend presentation/routing', () => {
    const item = waitingItem();
    const rows = (buildWaitingRows as unknown as (items: WaitingApiItemFixture[]) => any[])([item]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: `waiting:${item.interventionId}`,
        section: 'WAITING',
        status: 'waiting',
        label: item.presentation.title,
        subtitle: item.presentation.subtitle,
        action: { kind: 'navigate', label: item.presentation.actionLabel, route: item.routing.route },
      })
    );
  });

  it('preserves backend feed order — no client-side re-sorting, matching the buildDecisionNowRows/buildNowRows convention', () => {
    const first = waitingItem({ interventionId: 'intv-a', constraintId: 'c-a' });
    const second = waitingItem({ interventionId: 'intv-b', constraintId: 'c-b' });
    const rows = (buildWaitingRows as unknown as (items: WaitingApiItemFixture[]) => any[])([second, first]);
    expect(rows.map((r) => r.id)).toEqual(['waiting:intv-b', 'waiting:intv-a']);
  });

  it('excludes any backend item whose treatment is outside the V1 allowlist (defence in depth — the backend contract should never emit one, e.g. a stock_protection-tagged entry)', () => {
    const allowed = waitingItem({ interventionId: 'intv-ok' });
    const outOfScope = waitingItem({ interventionId: 'intv-oos', treatment: 'stock_protection' });
    const rows = (buildWaitingRows as unknown as (items: WaitingApiItemFixture[]) => any[])([
      allowed,
      outOfScope,
    ]);
    expect(rows.map((r) => r.id)).toEqual(['waiting:intv-ok']);
  });

  it('renders two same-treatment items with their own distinct backend copy verbatim — proves no treatment-keyed copy table exists on the frontend', () => {
    const addr1 = waitingItem({
      interventionId: 'intv-addr-1',
      treatment: 'address_correction',
      presentation: { title: 'Nautilus', subtitle: 'copy-one', actionLabel: 'Go one' },
    });
    const addr2 = waitingItem({
      interventionId: 'intv-addr-2',
      treatment: 'address_correction',
      presentation: { title: 'Periscope', subtitle: 'copy-two', actionLabel: 'Go two' },
    });
    const rows = (buildWaitingRows as unknown as (items: WaitingApiItemFixture[]) => any[])([
      addr1,
      addr2,
    ]);
    expect(rows[0]).toEqual(expect.objectContaining({ label: 'Nautilus', subtitle: 'copy-one' }));
    expect(rows[1]).toEqual(expect.objectContaining({ label: 'Periscope', subtitle: 'copy-two' }));
  });

  /**
   * SUPPLEMENTAL ONLY — not the primary proof of the architecture. The
   * primary proof is behavioural (the cases above: output is exactly and
   * only what the backend fixture supplied, nothing recomputed, nothing
   * treatment-keyed). This source-text check is defence in depth against a
   * future regression re-adding local derivation logic; it is not itself
   * evidence that today's (nonexistent) implementation is correct.
   */
  it('[supplemental] the model file contains no local episode/chronology derivation vocabulary — that stays backend-only, in interventionOutcome.service.ts', () => {
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
    expect(rows[1].action).toEqual({ kind: 'navigate', label: 'Open', route: '/floor-planning' });
    expect(rows[0].action).toBeUndefined();
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
      { id: 'history:h1', section: 'HISTORY' as const, status: 'verified' as const, label: 'Resolved outcome' },  // excluded
    ];

    expect(rows).toHaveLength(4);
    expect(openAttentionCount(rows)).toBe(2);
  });
});
