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

export type OpsSectionKey = 'NOW' | 'WAITING' | 'SETUP' | 'RECENT' | 'HISTORY';

export interface OpsRow {
  id: string;
  section: OpsSectionKey;
  status: OpsRowStatus;
  label: string;
  /** Short right-aligned qualifier (age, severity, acknowledgement). */
  meta?: string;
  /** One primary action per row. Navigation only in V1. */
  action?: { label: string; route: string };
  /** Severity tone, so 'attention' can pick --critical-ink vs --warning-ink. */
  tone?: 'critical' | 'warning' | 'info';
  /**
   * Severity/context stated for assistive tech only. Severity is deliberately
   * NOT visible text on a NOW row — it consumed width and truncated the
   * subject — but it must stay reachable, so it is carried here and rendered
   * into a visually-hidden node plus the row's title.
   */
  a11yLabel?: string;
}

/** A row is "open attention" only while it is neither completed nor retired. */
export function isOpenRow(row: OpsRow): boolean {
  if (row.section === 'RECENT' || row.section === 'HISTORY') return false;
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
 * acknowledged_at is explicitly NOT treated as resolution: an acknowledged
 * alert stays an open NOW row and only carries an 'acked' qualifier.
 */
export function buildNowRows(
  alerts: Alert[],
  deepLink: (alert: Alert) => { route: string; label: string } | null,
): OpsRow[] {
  return alerts.map((alert) => {
    const link = deepLink(alert);
    const acked = alert.acknowledged_at !== null;
    return {
      id: `alert:${alert.id}`,
      section: 'NOW' as const,
      status: alert.severity === 'info' ? ('actionable' as const) : ('attention' as const),
      label: alert.title,
      // Severity is NOT visible text: it crowded out the subject. It stays in
      // a11yLabel and in the glyph colour, so the semantic is intact.
      meta: acked ? 'acked' : undefined,
      action: link ? { label: link.label, route: link.route } : undefined,
      tone: alert.severity,
      a11yLabel: acked
        ? `${alert.severity} severity, acknowledged`
        : `${alert.severity} severity`,
    };
  });
}

// ─── WAITING ──────────────────────────────────────────────────────────────────

/**
 * WAITING is empty in V1 — deliberately, not accidentally.
 *
 * decision_interventions IS persisted, and services/decision/
 * interventionOutcome.service.ts derives pending_verification from
 * order_constraints. But that read model is an internal, per-order seam with no
 * HTTP surface: there is no shop-wide "interventions awaiting verification"
 * endpoint for the shell to read. Synthesising this section from alerts,
 * navigation or local state would manufacture exactly the claim the read model
 * refuses to persist, so the section renders only once a canonical global
 * source exists.
 */
export function buildWaitingRows(): OpsRow[] {
  return [];
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

// ─── RECENT / HISTORY — ALERT LIFECYCLE ONLY ─────────────────────────────────

/**
 * These sections carry ALERT HISTORY, and nothing more.
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
 * and asserts no cause.
 */
export function buildAlertHistoryRows(
  resolvedAlerts: Alert[],
  section: 'RECENT' | 'HISTORY',
  limit?: number,
  now: number = Date.now(),
): OpsRow[] {
  const rows = resolvedAlerts
    .filter((alert) => alert.resolved_at !== null)
    .map((alert) => ({
      id: `${section.toLowerCase()}:${alert.id}`,
      section,
      status: 'closed' as const,
      label: alert.title,
      // The '·' glyph already carries "closed"; the meta column is spent on
      // chronology instead of repeating the word. Still alert lifecycle only.
      meta: relativeAgeLabel(alert.resolved_at, now) ?? undefined,
      a11yLabel: 'alert closed',
    }));
  return typeof limit === 'number' ? rows.slice(0, limit) : rows;
}
