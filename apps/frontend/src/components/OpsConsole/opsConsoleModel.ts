// apps/frontend/src/components/OpsConsole/opsConsoleModel.ts
//
// OPS-CONSOLE-01 — pure row model for the Ops Console rail.
//
// GOVERNING INVARIANT
//   A click or a navigation is NEVER evidence of completion.
//
// Every row's status is derived here from a persisted authoritative field and
// nothing else:
//   verified  <- onboarding readiness / activation-event completion ONLY
//   closed    <- an alert whose backend set resolved_at. Neutral: the alert's
//                own lifecycle ended. It is NOT a verified Decision Engine
//                outcome and must never be styled or worded as one.
//   waiting   <- a durable intervention/verification record
//   attention <- live alert severity
// There is deliberately no code path from "the merchant opened this route" to
// 'waiting' or 'verified'. The console holds no local completion state, so a
// row cannot be promoted by interacting with it.
//
// Kept free of React and of transport concerns so the rules above are provable
// without rendering or mocking a network.

import type { Alert } from '../../pages/alerts/useAlerts';
import type { ChecklistItem } from '../../hooks/useActivationChecklist';
import type { WaitingItem } from '../../pages/operations/useWaiting';

/** Ratified status semantics — glyph column of the console. */
export type OpsRowStatus =
  | 'available'   // ○ available / setup required
  | 'attention'   // ! attention required
  | 'actionable'  // → actionable navigation
  | 'waiting'     // … intervention recorded / awaiting canonical verification
  | 'verified'    // ✓ canonically verified completion
  | 'failed'      // × failed
  | 'dismissed'   // – dismissed / expired
  | 'closed';     // · alert lifecycle closed — NOT a verified outcome

export const OPS_STATUS_GLYPH: Record<OpsRowStatus, string> = {
  available:  '○',
  attention:  '!',
  actionable: '→',
  waiting:    '…',
  verified:   '✓',
  failed:     '×',
  dismissed:  '–',
  closed:     '·',
};

// OPS-CONSOLE-02: 'RECENT' removed. Closed alerts were rendered in OPEN *and*
// in the HISTORY tab; OPEN is now actionable work only and alert lifecycle
// history lives in exactly one place.
export type OpsSectionKey = 'NOW' | 'WAITING' | 'SETUP' | 'HISTORY';

export interface OpsRow {
  id: string;
  section: OpsSectionKey;
  status: OpsRowStatus;
  label: string;
  /**
   * Secondary context line, rendered under the label when present. Introduced
   * for #1114 canonical Decision Feed rows (backend `presentation.subtitle`)
   * — existing alert/setup/history rows never set this, so their rendering is
   * unchanged.
   */
  subtitle?: string;
  /** Short right-aligned qualifier (age, severity, acknowledgement). */
  meta?: string;
  /** One primary action per row. Navigation only in V1. */
  action?: { label: string; route: string };
  /** Severity tone, so 'attention' can pick --critical-ink vs --warning-ink. */
  tone?: 'critical' | 'warning' | 'info';
  /**
   * Severity/context stated for assistive tech only. Severity is deliberately
   * NOT visible text on a NOW row — it consumed width and truncated the
   * subject — but it must stay reachable, so it is rendered into a
   * visually-hidden node. It is NOT put in a `title` attribute: that produced a
   * native tooltip which made "warning severity" visible copy on hover.
   */
  a11yLabel?: string;
}

/** A row is "open attention" only while it is neither completed nor retired. */
export function isOpenRow(row: OpsRow): boolean {
  if (row.section === 'HISTORY') return false;
  return row.status !== 'verified'
    && row.status !== 'dismissed'
    && row.status !== 'closed';
}

/**
 * Badge count — open attention only.
 * Completed setup, resolved outcomes and history are excluded by construction.
 */
export function openAttentionCount(rows: OpsRow[]): number {
  return rows.filter(isOpenRow).length;
}

// ─── CHRONOLOGY ───────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Compact relative age for a history row: 'just now' / '28m' / '2h' / 'Sep 08'.
 *
 * Built from explicit parts rather than toLocaleDateString so the label is
 * deterministic across runtimes. Returns null for a missing/unparseable
 * timestamp so the caller omits the column instead of printing a placeholder.
 */
export function relativeAgeLabel(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const mins = Math.floor((now - then) / 60_000);
  if (mins < 0) return 'just now';
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;

  const d = new Date(then);
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`;
}

// ─── NOW ──────────────────────────────────────────────────────────────────────

/**
 * NOW is backed by the canonical live alert inbox owned by the topnav. The
 * alerts are already ranked by the backend (severity → revenue); that order is
 * preserved rather than re-sorted here.
 *
 * ACTIONABLE-ONLY (OPS-CONSOLE-02): an alert earns a NOW row only when it is
 * BOTH classified actionable by NOW_ACTIONABLE_ALERT_TYPES and resolvable to a
 * real operational destination by deepLink(). A row the merchant cannot
 * act on is not "work now" — it is noise in a queue that answers "what needs my
 * action now?". Such alerts are NOT lost: they remain authoritative in the
 * alerts subsystem and are managed at /alerts. Deliberately no generic
 * "View" / "Manage alert" fallback CTA is synthesised to keep them in the
 * queue — that would restore the noise while pretending it was actionable.
 *
 * acknowledged_at is explicitly NOT treated as resolution: an acknowledged
 * alert stays an open NOW row and only carries an 'acked' qualifier.
 */
/**
 * NOW ELIGIBILITY POLICY — NOW V1 ratified allowlist
 * ----------------------
 * An allow-list by alert_type, deliberately NOT "anything with a route".
 *
 * Having a destination proves an alert can be navigated to; it does not prove
 * the merchant has a decision to make. A new alert type must be classified here
 * on purpose before it can consume a NOW slot — the default for anything
 * unrecognised is exclusion, so the queue cannot silently fill with whatever
 * the backend starts emitting next.
 *
 * Severity is NOT the criterion by itself, but it is not sufficient either:
 * the WMS work-queue states (stow_pending, receive_arrived,
 * batch_ready_to_pack, batch_ready_to_ship) are normal workflow progression —
 * the same class of event as wms_batch_released — and are ratified OUT of NOW
 * V1 for that reason, despite each having a perfectly valid route.
 *
 * Excluded types are not lost: they stay authoritative in the alerts subsystem
 * and are managed at /alerts.
 */
export const NOW_ACTIONABLE_ALERT_TYPES: ReadonlySet<string> = new Set([
  // Order signals
  'sla_breach',
  'inventory',
  'customer',
  // Demand signals
  'stockout_risk',
  'low_stock_reorder',
  // STOCK-PROTECT-03 Slice 3B: canonical Stock Protection. Actionability is
  // still gated by deepLink() resolving non-null — a complete_setup row or
  // a commercially-denied/resolved row has action=null (backend-derived,
  // never re-inferred here) and is correctly excluded from NOW by the
  // existing rule below, exactly like any other unresolvable alert.
  'stock_protection',
  // WMS exceptions
  'wms_pick_exception',
  'wms_pack_exception',
  'wms_stow_exception',
  'wms_receive_exception',
  // DELIBERATELY ABSENT (NOW V1): 'operational', 'revenue_at_risk',
  // 'missing_cogs', 'reorder_warning' — duplicate/summary signals, not a new
  // decision. 'wms_stow_pending', 'wms_receive_arrived',
  // 'wms_batch_ready_to_pack', 'wms_batch_ready_to_ship',
  // 'wms_batch_released' — normal workflow progression, not an intervention.
]);

/** True only for an alert_type explicitly classified as operationally actionable. */
export function isNowActionable(alert: Alert): boolean {
  return NOW_ACTIONABLE_ALERT_TYPES.has(alert.alert_type);
}

export function buildNowRows(
  alerts: Alert[],
  deepLink: (alert: Alert) => { route: string; label: string } | null,
): OpsRow[] {
  return alerts.flatMap((alert) => {
    if (!isNowActionable(alert)) return [];
    const link = deepLink(alert);
    if (!link) return [];
    const acked = alert.acknowledged_at !== null;
    return [{
      id: `alert:${alert.id}`,
      section: 'NOW' as const,
      status: alert.severity === 'info' ? ('actionable' as const) : ('attention' as const),
      label: alert.title,
      // Severity is NOT visible text: it crowded out the subject. It stays in
      // a11yLabel and in the glyph colour, so the semantic is intact.
      meta: acked ? 'acked' : undefined,
      action: { label: link.label, route: link.route },
      tone: alert.severity,
      a11yLabel: acked
        ? `${alert.severity} severity, acknowledged`
        : `${alert.severity} severity`,
    }];
  });
}

/** Default number of NOW rows rendered before the "Show N more" control. */
export const NOW_VISIBLE_LIMIT = 5;

// ─── WAITING ──────────────────────────────────────────────────────────────────

/**
 * OPS-CONSOLE-WAITING-01 — V1 backend-classified WAITING rows.
 *
 * The backend (`GET /api/v1/operations/waiting`) already classifies every
 * item as canonically pending_verification, already supplies
 * presentation/routing, and already scopes to the V1 treatment allowlist.
 * This builder performs ZERO lifecycle inference of its own: no reading of
 * is_active/resolved_at/latency/episode metadata, no local outcome
 * re-derivation, no treatment-keyed copy table. It maps the feed verbatim
 * and preserves backend order, exactly like buildDecisionNowRows does for
 * the canonical Decision Feed.
 *
 * The V1 treatment allowlist filter here is defence in depth only — the
 * backend contract should never emit anything outside it.
 */
const WAITING_V1_TREATMENTS: ReadonlySet<string> = new Set([
  'address_correction',
  'inventory_reorder_intent',
]);

export function buildWaitingRows(items: WaitingItem[]): OpsRow[] {
  return items
    .filter((item) => WAITING_V1_TREATMENTS.has(item.treatment))
    .map((item) => ({
      id: `waiting:${item.interventionId}`,
      section: 'WAITING' as const,
      status: 'waiting' as const,
      label: item.presentation.title,
      subtitle: item.presentation.subtitle,
      action: { label: item.presentation.actionLabel, route: item.routing.route },
    }));
}

// ─── SETUP ────────────────────────────────────────────────────────────────────

/**
 * SETUP reuses the existing onboarding assembler unchanged, so completion stays
 * owned by /api/v1/onboarding/readiness and /api/v1/user-state/activation-events.
 * `complete` is the only input to 'verified'.
 */
export function buildSetupRows(items: ChecklistItem[]): OpsRow[] {
  return items.map((item) => ({
    id: `setup:${item.key}`,
    section: 'SETUP' as const,
    status: item.complete
      ? ('verified' as const)
      : item.actionRoute
        ? ('actionable' as const)
        : ('available' as const),
    label: item.label,
    action: !item.complete && item.actionRoute
      ? { label: 'Open', route: item.actionRoute }
      : undefined,
  }));
}

// ─── HISTORY — ALERT LIFECYCLE ONLY ──────────────────────────────────────────

/**
 * This section carries ALERT HISTORY, and nothing more.
 *
 * `resolved_at` is authoritative for the ALERT's own lifecycle (alerts.
 * controller.ts status='resolved'). It is NOT evidence that a Decision Engine
 * intervention was verified, that an order_constraints episode cleared, or that
 * anything the alert described was actually fixed — an alert can be resolved by
 * a rule re-evaluating, and interventionOutcome.service.ts deliberately refuses
 * to derive outcome from any source but order_constraints.
 *
 * So these rows take the neutral 'closed' status, never 'verified'. Green /
 * ✓ semantics stay reserved for sources that genuinely establish completion
 * (currently only onboarding SETUP). Row wording states that the alert closed
 * and asserts no cause. These rows are reachable ONLY from the HISTORY tab —
 * OPEN carries actionable work exclusively.
 */
export function buildAlertHistoryRows(
  resolvedAlerts: Alert[],
  limit?: number,
  now: number = Date.now(),
): OpsRow[] {
  const rows = resolvedAlerts
    .filter((alert) => alert.resolved_at !== null)
    .map((alert) => ({
      id: `history:${alert.id}`,
      section: 'HISTORY' as const,
      status: 'closed' as const,
      label: alert.title,
      // The '·' glyph already carries "closed"; the meta column is spent on
      // chronology instead of repeating the word. Still alert lifecycle only.
      meta: relativeAgeLabel(alert.resolved_at, now) ?? undefined,
      a11yLabel: 'alert closed',
    }));
  return typeof limit === 'number' ? rows.slice(0, limit) : rows;
}
