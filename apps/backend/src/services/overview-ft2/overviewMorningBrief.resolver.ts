// apps/backend/src/services/overview-ft2/overviewMorningBrief.resolver.ts
//
// Morning Brief Resolver (OVR-01)
// --------------------------------
// Computes a ranked signal list for the owner/admin morning brief.
// Reads from the `alerts` table — the canonical signal surface.
//
// Signal ranking:
//   P1 — critical severity, highest revenue impact
//   P2 — critical severity, lower revenue impact
//   P3 — warning severity, highest revenue impact
//   P4 — warning severity, lower revenue impact
//   P5 — info severity
//
// Max 5 signals. Min 0 (quiet day).
//
// Trust gated — returns null if trust not eligible.
// Called by:
//   - GET /api/v1/modules/overview/morning-brief (on-demand, cache-first)
//   - Nightly brief job at 5am per shop timezone (OVR-02)
//   - Push notification dispatcher (OVR-03)
//
// CHANGE POLICY:
//   Signal sources are the alerts aggregator (AL-01).
//   Never query raw tables here — always read from `alerts`.
//   Deep links must stay in sync with frontend routes.

import db from '@lasyncro/backend-core/db.js';
import { getTrustFt2Snapshot } from '../trust-ft2/trustFt2.resolver.js';

/**
 * Computes a personalized greeting based on shop timezone and owner's first name.
 * Falls back gracefully if timezone or name is missing.
 */
function computeGreeting(firstName: string | null, timezone: string): string {
  let hour = new Date().getHours(); // fallback: server local time
  try {
    const localTime = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    }).format(new Date());
    hour = parseInt(localTime, 10);
  } catch {
    // Invalid timezone — use server time
  }

  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const name = firstName?.trim();
  return name
    ? `Good ${timeOfDay}, ${name}`
    : `Good ${timeOfDay}`;
}

/**
 * Computes a one-sentence business context summary for the brief header.
 */
function computeSummaryLine(
  signalCount: number,
  hasUrgentIssues: boolean
): string {
  if (signalCount === 0) return 'All clear — operations are on track today.';
  if (hasUrgentIssues) {
    return `${signalCount} issue${signalCount > 1 ? 's' : ''} need${signalCount === 1 ? 's' : ''} your attention today.`;
  }
  return `${signalCount} item${signalCount > 1 ? 's' : ''} to review when you have a moment.`;
}

// --- Types ---

export interface MorningBriefSignal {
  /** Deterministic signal ID — matches alert_key */
  id: string;
  /** 1 = most urgent, 5 = least urgent */
  priority: 1 | 2 | 3 | 4 | 5;
  /** Short operator-vocabulary title */
  title: string;
  /** One-sentence explanation */
  detail: string;
  /** Module the operator should navigate to */
  module: string;
  /** Frontend route — deep link with pre-applied filters */
  deepLink: string;
  /** Revenue impact in dollars, null if not applicable */
  revenueImpact: number | null;
}

export interface MorningBriefSnapshot {
  signals: MorningBriefSignal[];
  hasUrgentIssues: boolean;
  /** ISO timestamp of when this brief was computed */
  generatedAt: string;
  /** True if trust state degraded after brief was cached */
  trustWarning: boolean;
  /** Personalized greeting — "Good morning, Milad" */
  greeting: string;
  /** One-sentence business context — "3 issues need your attention" */
  summaryLine: string;
}

// --- Deep link map ---
// Maps alert_type to frontend route with pre-applied filter.
// Must stay in sync with frontend router.
const DEEP_LINK_MAP: Record<string, { module: string; deepLink: string }> = {
  // Order signals
  sla_breach:               { module: 'order-nexus',      deepLink: '/orders?filter=sla_breached' },
  operational:              { module: 'order-nexus',      deepLink: '/orders?filter=aging_72h' },
  inventory:                { module: 'order-nexus',      deepLink: '/orders?filter=out_of_stock' },
  customer:                 { module: 'order-nexus',      deepLink: '/orders?filter=address_issue' },
  // Financial signals
  revenue_at_risk:          { module: 'cashflow',         deepLink: '/cash-flow?focus=constrained' },
  missing_cogs:             { module: 'finances',         deepLink: '/finances?focus=missing_cogs' },
  // WMS signals
  wms_receive_arrived:      { module: 'wms',              deepLink: '/wms?filter=receive_pending' },
  wms_receive_exception:    { module: 'wms',              deepLink: '/wms?filter=receive_exceptions' },
  wms_stow_pending:         { module: 'wms',              deepLink: '/wms?filter=stow_pending' },
  wms_pick_exception:       { module: 'wms',              deepLink: '/wms?filter=pick_exceptions' },
  wms_pack_exception:       { module: 'wms',              deepLink: '/wms?filter=pack_exceptions' },
  wms_batch_ready_to_pack:  { module: 'wms',              deepLink: '/wms?filter=ready_to_pack' },
  wms_batch_ready_to_ship:  { module: 'wms',              deepLink: '/wms?filter=ready_to_ship' },
  // ── Supplier signals
  wms_supplier_rating:      { module: 'suppliers-portal', deepLink: '/suppliers-portal' },
  // ── Demand signals
  stockout_risk:            { module: 'demand',           deepLink: '/demand?filter=critical' },
};

const SEVERITY_PRIORITY: Record<string, number> = {
  critical: 1,
  warning:  3,
  info:     5,
};

// --- Resolver ---

export async function computeMorningBrief(input: {
  shopId: number;
}): Promise<MorningBriefSnapshot | null> {
  const { shopId } = input;

  // --- Trust gate ---
  // Owner/admin brief requires trusted data.
  // Never surface intelligence signals from stale or partial sync.
  // DEV BYPASS: In development, skip trust gate so the brief renders with seed data.
  // Remove this bypass before deploying to production.
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) {
    const trust = await getTrustFt2Snapshot({ shopId });
    if (trust.trustEligible !== true) {
      return null;
    }
  }

  // --- Fetch owner name + shop timezone for greeting ---
  const shopRow = await db('shops').where({ id: shopId }).select('timezone').first();
  const timezone = shopRow?.timezone ?? 'UTC';

  const ownerRow = await db('users as u')
    .join('shop_memberships as sm', 'sm.user_id', 'u.id')
    .where({ 'sm.shop_id': shopId, 'sm.role': 'owner' })
    .orderBy('sm.created_at', 'asc')
    .select('u.first_name')
    .first();

  const firstName = ownerRow?.first_name ?? null;

  // --- Read active, non-dismissed alerts ---
  // Ranked by severity (critical first) then revenue impact (highest first).
  const alerts = await db('alerts')
    .where({ shop_id: shopId, is_active: true })
    .whereNull('dismissed_at')
    .orderByRaw(`
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'warning'  THEN 2
        WHEN 'info'     THEN 3
        ELSE 4
      END ASC,
      revenue_impact DESC NULLS LAST
    `)
    .limit(5)
    .select('alert_key', 'alert_type', 'severity', 'title', 'message', 'revenue_impact');

  // --- Map to signals ---
  const signals: MorningBriefSignal[] = alerts.map((alert: any, index: number) => {
    const destination = DEEP_LINK_MAP[alert.alert_type] ?? {
      module: 'overview',
      deepLink: '/overview',
    };

    // Assign priority: first two criticals = P1/P2, first two warnings = P3/P4, rest = P5
    const basePriority = SEVERITY_PRIORITY[alert.severity] ?? 5;
    const priority = Math.min(5, basePriority + (index > 0 ? 1 : 0)) as 1 | 2 | 3 | 4 | 5;

    return {
      id: alert.alert_key,
      priority,
      title: alert.title,
      // Strip trailing revenue suffix injected by alerts aggregator (e.g. ".$42,952 at risk")
      // Revenue impact is surfaced separately via revenueImpact field — not in detail text.
      detail: alert.message.replace(/\.\$[\d,]+ at risk$/, '').trim(),
      module: destination.module,
      deepLink: destination.deepLink,
      revenueImpact: alert.revenue_impact != null ? Number(alert.revenue_impact) : null,
    };
  });

  const hasUrgentIssues = signals.some(s => s.priority <= 2);

  return {
    signals,
    hasUrgentIssues,
    generatedAt: new Date().toISOString(),
    trustWarning: false,
    greeting: computeGreeting(firstName, timezone),
    summaryLine: computeSummaryLine(signals.length, hasUrgentIssues),
  };
}

/**
 * Writes a computed brief to morning_brief_snapshots.
 * Upserts on shop_id — one active brief per shop.
 * Called by nightly job and on-demand refresh.
 */
export async function persistMorningBrief(
  shopId: number,
  brief: MorningBriefSnapshot | null,
  trx: typeof db
): Promise<void> {
  const now = new Date();
  // On-demand refresh cooldown: 15 minutes
  const nextRefresh = new Date(now.getTime() + 15 * 60 * 1000);

  await trx('morning_brief_snapshots')
    .insert({
      shop_id: shopId,
      signals: JSON.stringify(brief?.signals ?? []),
      has_urgent_issues: brief?.hasUrgentIssues ?? false,
      trust_eligible: brief !== null,
      trust_warning: brief?.trustWarning ?? false,
      greeting: brief?.greeting ?? null,
      summary_line: brief?.summaryLine ?? null,
      generated_at: now,
      next_refresh_at: nextRefresh,
      created_at: now,
      updated_at: now,
    })
    .onConflict('shop_id')
    .merge({
      signals: JSON.stringify(brief?.signals ?? []),
      has_urgent_issues: brief?.hasUrgentIssues ?? false,
      trust_eligible: brief !== null,
      trust_warning: brief?.trustWarning ?? false,
      greeting: brief?.greeting ?? null,
      summary_line: brief?.summaryLine ?? null,
      generated_at: now,
      next_refresh_at: nextRefresh,
      updated_at: now,
    });
}