// modules/overview/src/ui/pages/OverviewModuleFT2.tsx
//
// OVERVIEW
//
// LAYOUT:
//   HEADER (date · greeting)
//   ────────────────────────────────────────────────────────────
//   BODY  [  Live map / mapContent (~75%)  |  OPERATIONS PULSE (~25%)  ]
//   (no mapContent → Operations Pulse is the primary body surface)
//
// RULES: No alpha(). No useTheme(). No fontFamily overrides. No 0.5px borders.
//        CSS vars for adaptive colors; direct hex only for severity tokens.
//        Severity palette: #E5484D critical · #D9A23B watch · #4CAF7A on-track.

import { Fragment, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { formatCurrencyCompact, ModuleErrorBoundary, OperationalContextShell } from '@lasyncro/shared/ui';

// ─── TYPES ────────────────────────────────────────────────────

export interface OverviewModuleFT2DataProps {
  trust: {
    dataFreshness: 'fresh' | 'stale' | 'unknown' | null;
    syncCoverage: 'complete' | 'partial' | 'missing' | 'unknown' | null;
    crossSourceConsistency: 'consistent' | 'inconsistent' | 'unknown' | null;
    trustEligible: boolean | null;
  } | null;
  context: {
    ordersObserved: number | null;
    productsObserved: number | null;
    customersObserved: number | null;
  };
  snapshot: {
    orders: { revenueTotal: number | null; currency: string | null } | null;
    products: null;
    customers: null;
  };
  alignment: {
    demandReality?: 'aligned' | 'divergent' | 'unknown';
    operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
    engagementRevenue?: 'aligned' | 'divergent' | 'unknown';
  } | null;
  pulse: {
    /** Today's gross revenue. */
    revenueToday: number | null;
    /** Delta vs yesterday's gross revenue. */
    revenueDeltaVsYesterday: number | null;
    /** Revenue exposed but not yet lost. */
    atRiskRevenue: number | null;
    /** Revenue blocked from shipping. */
    blockedRevenue: number | null;
    /** Dominant block domain: inventory | customer | operational | none. */
    topBlockingType: string | null;
  } | null;
  userName?: string | null;
  currency?: string;
  morningBrief?: {
    signals: {
      id: string;
      priority: 1 | 2 | 3 | 4 | 5;
      title: string;
      detail: string;
      module: string;
      deepLink: string;
      revenueImpact: number | null;
      /** Original alert_type from the alerts aggregator — e.g. "sla_breach", "revenue_at_risk". */
      alertType?: string;
      /** Short age/recency label — e.g. "14d oldest", "6 orders". Server-provided. */
      ageLabel?: string | null;
      /** Specific CTA label — e.g. "Review queue", "Reorder". Falls back to module default. */
      actionLabel?: string | null;
      /** Expandable sub-items (SKUs, orders, etc.) */
      tags?: string[];
    }[];
    hasUrgentIssues: boolean;
    generatedAt: string;
    trustWarning: boolean;
    greeting: string | null;
    summaryLine: string | null;
  } | null;
}

export interface OverviewOperationsPulse {
  orders: {
    readyCount: number;
    blockedCount: number;
    blockedRevenue: number;
    pastSlaCount: number;
    pastSlaRevenue: number;
  };
  fulfillment: {
    activeBatchCount: number;
    pickingBatchCount: number;
    packingBatchCount: number;
  };
  inventory: {
    awaitingInventoryCount: number;
    awaitingInventoryRevenue: number;
  };
  inbound: {
    receiveAtDockUnits: number;
    awaitingStowUnits: number;
  };
}

export type OverviewModuleFT2Props = OverviewModuleFT2DataProps & {
  /**
   * Consolidated state for operational warnings rendered outside Morning Brief.
   * `unknown` prevents positive copy while those sources are loading or failed.
   */
  operationalWarningState: 'clear' | 'warning' | 'unknown';
  /**
   * UX-OWNERSHIP-01: Overview is status-only. Global Ops Console is the
   * external action owner, with the top nav as its sole entry point.
   * OVERVIEW-SCREEN-OPT-01: onNavigate is invoked only by Operations Pulse
   * domain groups, as contextual navigation (never remediation). When absent,
   * the pulse renders non-interactively.
   */
  onNavigate?: (deepLink: string) => void;
  onRefreshBrief?: () => void;
  isRefreshingBrief?: boolean;
  onResolveAll?: () => void;
  /**
   * Rendered in the ~75% map slot.
   * When absent, Operations Pulse is the primary body surface.
   * Tier gate and zone guard are resolved by the page layer — module is layout-only.
   */
  mapContent?: ReactNode;
  /**
   * OV-V1: structured Operations Pulse values, composed by the page from
   * canonical sources.
   */
  operationsPulse: OverviewOperationsPulse;
  /**
   * OVERVIEW-SCREEN-OPT-01: when true, Operations Pulse is not rendered at all
   * (the Ops Console is open and owns attention). The map grid keeps its
   * two-column track list; the empty second column is deliberate.
   */
  suppressOperationsPulse?: boolean;
  /**
   * CROSS-SCREEN-UX-01: header Tier-2 ghost "Export →", same utility slot as
   * the Orders and Inventory headers. The page owns the handler (it opens the
   * canonical ExportDrawer); this is not an onNavigate context route. Hidden
   * when absent.
   */
  onExport?: () => void;
};

// ─── HELPERS ──────────────────────────────────────────────────

function timeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

// ─── OV-V1: OPERATIONS PULSE COMPOSITION ──────────────────────
//
// Compact orientation header · map slot · Operations Pulse.
// Whole-operation situational awareness only. Reads ONLY operationsPulse —
// never Morning Brief (no signals, greeting, summary, freshness or refresh),
// never Business Pulse. When onNavigate is supplied, each whole domain group is
// one contextual navigation button (PULSE_CONTEXT_ROUTES) — never remediation,
// never per-metric actions. Without onNavigate the pulse is non-interactive.

const PULSE_CONTEXT_ROUTES = {
  Orders: '/orders/flow',
  Fulfillment: '/wms',
  Inventory: '/orders/flow?constraint=inventory',
  Inbound: '/wms',
} as const;

type PulseDomain = keyof typeof PULSE_CONTEXT_ROUTES;

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function PulseRow({ text, tone = 'default' }: { text: string; tone?: 'default' | 'muted' | 'clear' }) {
  return (
    <Typography
      component="span"
      sx={{
        display: 'block',
        fontSize: 12.5,
        lineHeight: 1.45,
        fontWeight: tone === 'default' ? 500 : 400,
        color: tone === 'clear' ? 'var(--good-ink)' : tone === 'muted' ? 'var(--ink-3)' : 'var(--ink)',
      }}
    >
      {text}
    </Typography>
  );
}

function PulseGroup({
  label,
  rows,
  onNavigate,
}: {
  label: PulseDomain;
  rows: ReactNode[];
  onNavigate?: (deepLink: string) => void;
}) {
  const contents = (
    <>
      <Typography component="span" sx={{ display: 'block', fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: '2px' }}>
        {label}
      </Typography>
      {/* Whitespace between rows keeps each fact textually separate for
          assistive tech; the flex column ignores it visually. */}
      {rows.map((row, i) => <Fragment key={i}>{i > 0 ? ' ' : null}{row}</Fragment>)}
    </>
  );

  return (
    <Box
      role="group"
      aria-label={label}
      sx={{ display: 'flex', flexDirection: 'column', gap: '2px', py: '10px', borderTop: '0.5px solid var(--rule)', '&:first-of-type': { borderTop: 'none', pt: 0 } }}
    >
      {onNavigate ? (
        <Box
          component="button"
          type="button"
          aria-label={`Open ${label} operational context`}
          onClick={() => onNavigate(PULSE_CONTEXT_ROUTES[label])}
          sx={{
            // Native button reset — the group keeps its existing presentation.
            appearance: 'none',
            font: 'inherit',
            color: 'inherit',
            textAlign: 'left',
            bgcolor: 'transparent',
            border: 'none',
            m: 0,
            // Horizontal inset offset by negative margin so the hover surface
            // does not shift content or change the group's dimensions.
            px: '8px',
            mx: '-8px',
            py: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            borderRadius: '6px',
            cursor: 'pointer',
            transition: 'background-color 0.12s',
            '&:hover': { bgcolor: 'var(--bg-3)' },
            '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
          }}
        >
          {contents}
        </Box>
      ) : (
        contents
      )}
    </Box>
  );
}

function OperationsPulse({
  pulse,
  currency,
  onNavigate,
}: {
  pulse: OverviewOperationsPulse;
  currency: string;
  onNavigate?: (deepLink: string) => void;
}) {
  const money = (v: number) => formatCurrencyCompact(v, currency);
  const { orders, fulfillment, inventory, inbound } = pulse;

  const orderRows: ReactNode[] = [<PulseRow key="ready" text={`${orders.readyCount} ready`} />];
  if (orders.blockedCount > 0) {
    orderRows.push(<PulseRow key="blocked" text={`${orders.blockedCount} blocked · ${money(orders.blockedRevenue)}`} />);
  }
  if (orders.pastSlaCount > 0) {
    orderRows.push(<PulseRow key="sla" text={`${orders.pastSlaCount} past SLA · ${money(orders.pastSlaRevenue)}`} />);
  }

  const fulfillmentRows: ReactNode[] = [
    <PulseRow
      key="active"
      text={`${fulfillment.activeBatchCount} active ${pluralize(fulfillment.activeBatchCount, 'batch', 'batches')}`}
    />,
  ];
  if (fulfillment.activeBatchCount > 0) {
    fulfillmentRows.push(
      <PulseRow key="stages" tone="muted" text={`${fulfillment.pickingBatchCount} picking · ${fulfillment.packingBatchCount} packing`} />
    );
  }

  const inventoryRows: ReactNode[] = inventory.awaitingInventoryCount > 0
    ? [<PulseRow key="waiting" text={`${inventory.awaitingInventoryCount} awaiting inventory · ${money(inventory.awaitingInventoryRevenue)}`} />]
    : [<PulseRow key="clear" tone="clear" text="Clear" />];

  const inboundRows: ReactNode[] = [];
  if (inbound.receiveAtDockUnits > 0) inboundRows.push(<PulseRow key="dock" text={`${inbound.receiveAtDockUnits} at dock`} />);
  if (inbound.awaitingStowUnits > 0) inboundRows.push(<PulseRow key="stow" text={`${inbound.awaitingStowUnits} awaiting stow`} />);
  if (inboundRows.length === 0) inboundRows.push(<PulseRow key="clear" tone="clear" text="Clear" />);

  return (
    <Box
      component="section"
      role="region"
      aria-label="Operations pulse"
      sx={{
        minWidth: 0,
        boxSizing: 'border-box',
        bgcolor: 'var(--surface)',
        border: '0.5px solid var(--rule)',
        borderRadius: '14px',
        px: '18px',
        py: '14px',
        display: 'flex',
        flexDirection: 'column',
        // Content-height and top-aligned: never stretch to the map row height.
        alignSelf: 'start',
      }}
    >
      <Typography component="h2" sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1, mb: '12px' }}>
        Operations
      </Typography>
      <PulseGroup label="Orders" rows={orderRows} onNavigate={onNavigate} />
      <PulseGroup label="Fulfillment" rows={fulfillmentRows} onNavigate={onNavigate} />
      <PulseGroup label="Inventory" rows={inventoryRows} onNavigate={onNavigate} />
      <PulseGroup label="Inbound" rows={inboundRows} onNavigate={onNavigate} />
    </Box>
  );
}

function OverviewModuleV1({
  operationsPulse,
  mapContent,
  userName,
  currency = 'USD',
  suppressOperationsPulse = false,
  onNavigate,
  onExport,
}: OverviewModuleFT2Props) {
  const greetingText = userName ? `Good ${timeOfDay()}, ${userName}.` : `Good ${timeOfDay()}.`;

  return (
    <Box sx={{ p: { xs: 2, md: '24px 40px' }, display: 'flex', flexDirection: 'column', gap: '20px', bgcolor: 'var(--bg)', minHeight: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {/* ── COMPACT ORIENTATION HEADER — Live status belongs to the topnav ──
          Identity column + utility slot, same breakpoint wrap as the Orders
          and Inventory domain headers. */}
      <Box sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 1.5,
      }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 500, color: '#1D9E75', textTransform: 'uppercase', letterSpacing: '0.12em', lineHeight: 2 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.15, letterSpacing: '-0.01em' }}>
            {greetingText}
          </Typography>
        </Box>
        {onExport && (
          <Box
            component="button"
            type="button"
            onClick={onExport}
            sx={{
              display: 'inline-flex', alignItems: 'center', flexShrink: 0, mt: 0.5,
              px: '12px', py: '6px', fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
              color: 'var(--accent-text)', bgcolor: 'transparent', border: '0.5px solid var(--accent-border)',
              borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 },
              '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
            }}
          >
            Export →
          </Box>
        )}
      </Box>

      {/* ── BODY — shared OperationalContextShell: map ~75% + Operations
          Pulse ~25%; single column below lg. Suppression withdraws only the
          rail content, so the map surface is never remounted. ── */}
      {mapContent ? (
        <OperationalContextShell
          primary={mapContent}
          rail={<OperationsPulse pulse={operationsPulse} currency={currency} onNavigate={onNavigate} />}
          suppressRail={suppressOperationsPulse}
        />
      ) : (
        <Box sx={{ minWidth: 0, maxWidth: 560 }}>
          {!suppressOperationsPulse && <OperationsPulse pulse={operationsPulse} currency={currency} onNavigate={onNavigate} />}
        </Box>
      )}
    </Box>
  );
}

// ─── EXPORT ───────────────────────────────────────────────────

export default function OverviewModuleFT2(props: OverviewModuleFT2Props) {
  return (
    <ModuleErrorBoundary moduleName="overview">
      <OverviewModuleV1 {...props} />
    </ModuleErrorBoundary>
  );
}
