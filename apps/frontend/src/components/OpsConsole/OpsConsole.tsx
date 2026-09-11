// apps/frontend/src/components/OpsConsole/OpsConsole.tsx
//
// OPS-CONSOLE-01 — persistent right-side Ops Console (V1).
//
// The SINGLE top-nav attention surface. It replaces both the "Getting started"
// activation-checklist popover and the alerts bell popover. The alerts
// subsystem is untouched and still authoritative: /alerts remains the advanced
// management workspace (inbox / snoozed / resolved / rules, acknowledge, snooze,
// resolve, filter) and is reachable from the rail's "Manage alerts" footer. The
// console presents alerts; it manages none of them.
//
// The trigger stays in the topnav; the surface is a right-side rail rather than
// a modal:
// the panel is an ordinary fixed-position element, NOT a MUI Modal/Drawer, so
// the application behind it stays visible AND clickable and the merchant's
// route/state is untouched while it is open.
//
// Data authority (see opsConsoleModel.ts for the rules):
//   NOW     — canonical live alert inbox, passed down from the topnav, which
//             is the single shell-level owner of that poll. No second poll is
//             created here. ACTIONABLE-ONLY and capped at five by default.
//   WAITING — omitted in V1: no shop-wide intervention/verification read exists.
//   SETUP   — existing useActivationChecklist assembler, unchanged. Secondary:
//             collapsed until asked for, and always rendered below NOW.
//   HISTORY — its own tab, never in OPEN: alerts the backend closed
//             (resolved_at), fetched only while the console is open; historical
//             status never polls. These are alert-lifecycle facts, not verified
//             Decision Engine outcomes, so they render neutral ('closed'),
//             never green ✓.
//
// All colour comes from useAppTheme() CSS-variable tokens, so light and dark
// both resolve from the theme rather than baked-in surface hexes.

import { useMemo, useState } from 'react';
import { Box, Typography, IconButton, Tooltip, Badge } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Terminal, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { axiosInstance } from '../../api/axiosConfig';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useActivationChecklist } from '../../hooks/useActivationChecklist';
import { useAlerts, type Alert } from '../../pages/alerts/useAlerts';
import { alertDeepLink } from '../../pages/alerts/alertDeepLink';
import {
  OPS_STATUS_GLYPH,
  buildAlertHistoryRows,
  buildNowRows,
  buildSetupRows,
  buildWaitingRows,
  NOW_VISIBLE_LIMIT,
  openAttentionCount,
  type OpsRow,
} from './opsConsoleModel';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * RESPONSIVE LAYOUT CONTRACT
 * --------------------------
 * Exported so the responsive rules are assertable rather than buried in sx.
 * Below the `sm` breakpoint (MUI default 600px — the project defines no custom
 * breakpoints) every one of these resolves to its `xs` value, so 320 / 375 /
 * 390px all get the full-viewport rail.
 *
 * `100vw` (not `100%`): the panel is position:fixed, so `100%` resolves against
 * whatever containing block an ancestor happens to establish — that is what left
 * a strip of the app visible at 390px. `100vw` is measured against the viewport,
 * and the project already uses 100vw for shell-level widths (AppLayout, SpikeLayout).
 */
export const OPS_CONSOLE_WIDTH = { xs: '100vw', sm: 340 } as const;
/**
 * Grid placement of the CTA cell: its own auto column on sm, and a compact
 * second row spanning the subject columns on xs.
 */
export const OPS_ROW_ACTION_COLUMN = { xs: '2 / -1', sm: 'auto' } as const;
/** xs wraps the subject freely; sm keeps the accepted two-line clamp. */
export const OPS_ROW_SUBJECT_CLAMP = { xs: 'unset', sm: 2 } as const;

function useChecklistDismissed() {
  return useQuery<Record<string, boolean>>({
    queryKey: ['user-state', 'onboarding-flags'],
    queryFn: async () => (await axiosInstance.get('/api/v1/user-state/onboarding-flags')).data,
    staleTime: 60_000,
  });
}

// ─── ROW ──────────────────────────────────────────────────────────────────────

/**
 * MICRO-CARD + DETERMINISTIC GRID
 * -------------------------------
 * Actionable rows (NOW, and expanded incomplete SETUP) render as compact
 * micro-cards. HISTORY rows stay flat and quiet — no elevation, no border, no
 * hover transform: they are a record, not work.
 *
 * Layout is CSS GRID, not flex-with-nowrap. Under flex the subject and the CTA
 * competed for the same line and the subject could paint under the CTA. Grid
 * gives each its own column, so collision is structurally impossible:
 *
 *   sm+ :  glyph(10px) | subject minmax(0,1fr) | meta auto | CTA auto
 *   xs  :  glyph(10px) | subject minmax(0,1fr) | meta auto
 *                        CTA on row 2, right-aligned, spanning cols 2..-1
 *
 * The meta cell is ALWAYS rendered (empty when there is no meta) so column
 * positions never shift and the CTA cannot slide into the meta column.
 * No absolute positioning is used for layout.
 */
function OpsConsoleRow({ row, onNavigate }: { row: OpsRow; onNavigate: (route: string) => void }) {
  const pal = useAppTheme();

  // A closed alert row is quiet but must stay READABLE — dimming the whole row
  // made it unreadable in light mode. Only genuinely retired rows are faded.
  const faded = row.status === 'verified' || row.status === 'dismissed';
  const quiet = faded || row.status === 'closed';
  // Cardize actionable work only. HISTORY never gets elevation.
  const isCard = row.section !== 'HISTORY' && Boolean(row.action);

  const glyphColor =
    row.status === 'attention'
      ? (row.tone === 'warning' ? 'var(--warning-ink)' : 'var(--critical-ink)')
    : row.status === 'verified' ? 'var(--confirm-ink)'
    : row.status === 'actionable' ? 'var(--accent)'
    // 'closed' deliberately falls through to neutral ink — an alert closing is
    // not a completion claim, so it never borrows the confirm token.
    : pal.ink4;

  return (
    <Box
      data-testid={`ops-row-${row.id}`}
      data-status={row.status}
      data-section={row.section}
      data-card={isCard ? 'true' : 'false'}
      sx={{
        // position:relative scopes the absolutely-positioned sr-only node to
        // its own row. Without it the nearest positioned ancestor was the
        // panel, so every row's hidden node was laid out against the panel and
        // contributed to the panel's overflow rather than the row's.
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: {
          xs: '10px minmax(0, 1fr) auto',
          sm: '10px minmax(0, 1fr) auto auto',
        },
        alignItems: 'center',
        columnGap: '6px',
        rowGap: '3px',
        boxSizing: 'border-box',
        maxWidth: '100%',
        ...(isCard
          ? {
              // Intrinsic height — no minHeight. Compact padding only.
              mx: '7px', my: '3px',
              px: '7px', py: '4px',
              borderRadius: '6px',
              border: `0.5px solid ${pal.rule}`,
              // Existing theme tokens; no hardcoded colour.
              boxShadow: pal.shadow,
              bgcolor: pal.surface,
              transition: 'transform 140ms ease-out, box-shadow 140ms ease-out, border-color 140ms ease-out',
              '&:hover': {
                borderColor: pal.rule2,
                boxShadow: pal.shadowMd,
                transform: 'translateY(-1px)',
              },
              // Settle back ~1px while the real CTA is pressed. Scoped to the
              // CTA so the card never implies it is itself clickable.
              '&:has(button:active)': { transform: 'translateY(0)' },
              '@media (prefers-reduced-motion: reduce)': {
                transition: 'box-shadow 140ms ease-out, border-color 140ms ease-out',
                '&:hover': {
                  borderColor: pal.rule2,
                  boxShadow: pal.shadowMd,
                  transform: 'none',
                },
                '&:has(button:active)': { transform: 'none' },
              },
            }
          : {
              px: 1.5, py: 0.75,
              borderBottom: `0.5px solid ${pal.rule}`,
              bgcolor: 'transparent',
              '&:last-of-type': { borderBottom: 'none' },
              '&:hover': { bgcolor: pal.rowHover },
            }),
        opacity: faded ? 0.62 : 1,
      }}
    >
      {/* Severity/context for assistive tech only — never visible text, and
          never a title attribute (that produced a native tooltip). */}
      {row.a11yLabel && (
        <Box
          component="span"
          data-testid={`ops-row-sr-${row.id}`}
          sx={{
            position: 'absolute', width: 1, height: 1, p: 0, m: '-1px',
            overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
            border: 0,
          }}
        >
          {row.a11yLabel}
        </Box>
      )}

      {/* COL 1 — glyph */}
      <Typography
        aria-hidden
        sx={{ fontFamily: MONO, fontSize: 12, lineHeight: 1, color: glyphColor }}
      >
        {OPS_STATUS_GLYPH[row.status]}
      </Typography>

      {/* COL 2 — subject, minmax(0,1fr): the only column allowed to give way */}
      <Typography
        data-testid={`ops-row-label-${row.id}`}
        sx={{
          fontFamily: MONO, fontSize: 11.5, minWidth: 0,
          // xs wraps as far as it needs; sm keeps the accepted two-line clamp.
          display: { xs: 'block', sm: '-webkit-box' },
          WebkitLineClamp: OPS_ROW_SUBJECT_CLAMP,
          WebkitBoxOrient: 'vertical',
          overflow: { xs: 'visible', sm: 'hidden' },
          overflowWrap: 'anywhere',
          lineHeight: 1.35,
          color: quiet ? pal.ink3 : pal.ink,
        }}
      >
        {row.label}
      </Typography>

      {/* COL 3 — meta. Always present so the grid columns never shift. */}
      <Typography
        data-testid={`ops-row-meta-${row.id}`}
        sx={{ fontFamily: MONO, fontSize: 10, color: pal.ink4, whiteSpace: 'nowrap' }}
      >
        {row.meta ?? ''}
      </Typography>

      {/* COL 4 (sm) / ROW 2 (xs) — CTA. Intrinsic width, never shrinks. */}
      {row.action && (
        <Box
          data-testid={`ops-row-action-wrap-${row.id}`}
          sx={{
            display: 'flex', justifyContent: 'flex-end',
            gridColumn: OPS_ROW_ACTION_COLUMN,
            minWidth: 0,
          }}
        >
          <Box
            component="button"
            type="button"
            onClick={() => onNavigate(row.action!.route)}
            sx={{
              fontFamily: MONO, fontSize: 10, lineHeight: 1.5,
              px: '6px', py: '1px',
              // Never shrink, never wrap: a shrinking CTA is how the label got
              // clipped, and a wrapping one is how it grew the card.
              flexShrink: 0, whiteSpace: 'nowrap',
              bgcolor: 'transparent', color: 'var(--accent)',
              border: '0.5px solid var(--accent-border)', borderRadius: '4px',
              cursor: 'pointer',
              '&:hover': { bgcolor: 'var(--accent-ghost)' },
            }}
          >
            {row.action.label} →
          </Box>
        </Box>
      )}
    </Box>
  );
}

function SectionHeader({ label, count }: { label: string; count?: number }) {
  const pal = useAppTheme();
  return (
    <Box sx={{
      px: 1.5, py: 0.625, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      bgcolor: pal.bg2, borderBottom: `0.5px solid ${pal.rule}`,
    }}>
      <Typography sx={{
        fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
        color: pal.ink3,
      }}>
        {label}
      </Typography>
      {typeof count === 'number' && (
        <Typography sx={{ fontFamily: MONO, fontSize: 10, color: pal.ink4 }}>{count}</Typography>
      )}
    </Box>
  );
}

/** One-line disclosure control. Deliberately not a card and not a button row. */
function DisclosureLine({
  testId, expanded, onToggle, children,
}: {
  testId: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const pal = useAppTheme();
  return (
    <Box
      component="button"
      type="button"
      data-testid={testId}
      aria-expanded={expanded}
      onClick={onToggle}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.5,
        width: '100%', boxSizing: 'border-box', maxWidth: '100%',
        px: 1.5, py: 0.625, cursor: 'pointer', textAlign: 'left',
        bgcolor: 'transparent', border: 'none',
        borderBottom: `0.5px solid ${pal.rule}`,
        fontFamily: MONO, fontSize: 10, color: pal.ink4,
        outline: 'none',
        '&:focus': { outline: 'none' },
        '&:focus-visible': { outline: `2px solid ${pal.accent}`, outlineOffset: '-2px' },
        '&:hover': { color: pal.ink3, bgcolor: pal.rowHover },
      }}
    >
      {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      {children}
    </Box>
  );
}

function StateLine({ children }: { children: React.ReactNode }) {
  const pal = useAppTheme();
  return (
    <Typography sx={{ fontFamily: MONO, fontSize: 11, color: pal.ink4, px: 1.5, py: 1.25 }}>
      {children}
    </Typography>
  );
}

// ─── PANEL ────────────────────────────────────────────────────────────────────

export interface OpsConsoleProps {
  /** Canonical inbox alerts, owned and polled by the topnav. */
  alerts: Alert[];
  /**
   * Deep-link resolver. Defaults to the canonical shared ALERT_ROUTE_MAP in
   * pages/alerts/alertDeepLink.ts — the console never defines routes of its
   * own. Overridable for tests only.
   */
  deepLink?: (alert: Alert) => { route: string; label: string } | null;
  open: boolean;
  onClose: () => void;
}

export function OpsConsolePanel({
  alerts,
  deepLink = alertDeepLink,
  open,
  onClose,
}: OpsConsoleProps) {
  const pal = useAppTheme();
  const nav = useNavigate();
  const [tab, setTab] = useState<'OPEN' | 'HISTORY'>('OPEN');
  const [showCompletedSetup, setShowCompletedSetup] = useState(false);
  // Presentational only — no persistence, no new authority.
  const [nowExpanded, setNowExpanded] = useState(false);
  const [setupExpanded, setSetupExpanded] = useState(false);

  const { items, isLoading: setupLoading, isError: setupError } = useActivationChecklist();
  const { data: flags } = useChecklistDismissed();
  const setupDismissed = flags?.['checklist:completed'] === true;

  // Historical status never polls (useAlerts forces refetchInterval off for
  // anything but the inbox); gated on `open` so a closed console costs nothing.
  const resolvedQuery = useAlerts({ status: 'resolved' }, { enabled: open });
  const resolvedAlerts = resolvedQuery.data?.data ?? [];

  // Actionable-only, in backend rank order — no client-side sorting anywhere.
  const nowRows = useMemo(() => buildNowRows(alerts, deepLink), [alerts, deepLink]);
  const waitingRows = buildWaitingRows();
  const setupRows = useMemo(() => (setupDismissed ? [] : buildSetupRows(items)), [items, setupDismissed]);
  const historyRows = useMemo(() => buildAlertHistoryRows(resolvedAlerts), [resolvedAlerts]);

  // The cap is a rendering decision. The COUNT is always the full actionable
  // total, so a hidden row is never an uncounted row.
  const nowVisibleRows = nowExpanded ? nowRows : nowRows.slice(0, NOW_VISIBLE_LIMIT);
  const nowHiddenCount = nowRows.length - nowVisibleRows.length;

  const openSetupRows = setupRows.filter((r) => r.status !== 'verified');
  const doneSetupRows = setupRows.filter((r) => r.status === 'verified');
  const allSetupComplete = setupRows.length > 0 && openSetupRows.length === 0;

  const goto = (route: string) => { nav(route); };

  if (!open) return null;

  return (
    <Box
      role="complementary"
      aria-label="Ops Console"
      data-testid="ops-console"
      sx={{
        position: 'fixed', top: 56, right: 0, bottom: 0, zIndex: 1150,
        // xs: pinned to BOTH edges and sized against the viewport, so no strip
        // of the application can remain beside it. sm+ keeps the approved
        // 340px compact rail anchored to the right edge only.
        left: { xs: 0, sm: 'auto' },
        width: OPS_CONSOLE_WIDTH,
        maxWidth: '100vw',
        boxSizing: 'border-box',
        // ROOT CAUSE of the phantom bottom scroll (introduced by the xs width
        // fix): this was `overflowX: 'hidden'` with overflow-y left at its
        // default `visible`. Per CSS overflow, when one axis is not `visible`
        // the other axis's `visible` COMPUTES TO `auto` — so the panel silently
        // became a SECOND scroll container wrapped around the body's own
        // scroller, and its 0.5px borders plus the absolutely-positioned
        // sr-only nodes gave it a small scrollable overflow: blank scroll area
        // after the footer. Both axes hidden here, so the panel never scrolls
        // and the body below is the one and only scroller.
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        bgcolor: pal.surface,
        borderLeft: `0.5px solid ${pal.rule}`,
        boxShadow: pal.shadowMd,
      }}
    >
      {/* HEADER */}
      <Box sx={{
        px: 1.5, py: 1, flexShrink: 0,
        borderBottom: `0.5px solid ${pal.rule}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Typography sx={{
          fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', color: pal.ink,
        }}>
          OPS CONSOLE
        </Typography>
        <IconButton size="small" aria-label="Close Ops Console" onClick={onClose} sx={{ color: pal.ink3 }}>
          <X size={14} />
        </IconButton>
      </Box>

      {/* FILTERS — OPEN | HISTORY */}
      <Box role="tablist" sx={{ display: 'flex', flexShrink: 0, borderBottom: `0.5px solid ${pal.rule}` }}>
        {(['OPEN', 'HISTORY'] as const).map((key) => (
          <Box
            key={key}
            component="button"
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            sx={{
              flex: 1, py: 0.75, cursor: 'pointer',
              fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em',
              bgcolor: 'transparent', border: 'none',
              borderBottom: `1.5px solid ${tab === key ? 'var(--accent)' : 'transparent'}`,
              color: tab === key ? 'var(--accent)' : pal.ink4,
              // Pointer use must not leave the default blue rectangle behind;
              // keyboard focus stays clearly visible, drawn with the app accent
              // token rather than the UA/MUI default.
              outline: 'none',
              '&:focus': { outline: 'none' },
              '&:focus-visible': {
                outline: `2px solid ${pal.accent}`,
                outlineOffset: '-2px',
                bgcolor: pal.accentGhost,
              },
            }}
          >
            {key}
          </Box>
        ))}
      </Box>

      {/* BODY */}
      {/* The single scroll container. minHeight:0 lets it actually shrink
          inside the flex column instead of pushing the footer out of view. */}
      <Box data-testid="ops-console-body" sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {tab === 'OPEN' ? (
          <>
            {/* NOW — actionable operational work, backend rank preserved. The
                count is the full actionable total, not the rendered slice. */}
            <SectionHeader label="NOW" count={nowRows.length} />
            {nowRows.length === 0
              ? <StateLine>No operational items require action.</StateLine>
              : nowVisibleRows.map((row) => <OpsConsoleRow key={row.id} row={row} onNavigate={goto} />)}

            {nowHiddenCount > 0 && (
              <DisclosureLine
                testId="ops-now-show-more"
                expanded={false}
                onToggle={() => setNowExpanded(true)}
              >
                Show {nowHiddenCount} more
              </DisclosureLine>
            )}
            {nowExpanded && nowRows.length > NOW_VISIBLE_LIMIT && (
              <DisclosureLine
                testId="ops-now-show-less"
                expanded
                onToggle={() => setNowExpanded(false)}
              >
                Show less
              </DisclosureLine>
            )}

            {/* WAITING renders only when authoritative verification state exists. */}
            {waitingRows.length > 0 && (
              <>
                <SectionHeader label="WAITING" count={waitingRows.length} />
                {waitingRows.map((row) => <OpsConsoleRow key={row.id} row={row} onNavigate={goto} />)}
              </>
            )}

            {/* SETUP — always below NOW, and secondary: collapsed until asked
                for, so unfinished onboarding never competes with live work. */}
            {!setupDismissed && (
              <>
                {setupError ? (
                  <>
                    <SectionHeader label="SETUP" />
                    <StateLine>Setup status unavailable.</StateLine>
                  </>
                ) : setupLoading ? (
                  <>
                    <SectionHeader label="SETUP" />
                    <StateLine>Loading setup…</StateLine>
                  </>
                ) : allSetupComplete ? (
                  /* Every item done: one compact line instead of N completed
                     rows. Purely presentational — no flag is written, and the
                     rows are still derived from the same source truth. */
                  <Box
                    data-testid="ops-setup-complete"
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 0.75,
                      px: 1.5, py: 0.75,
                      borderBottom: `0.5px solid ${pal.rule}`,
                    }}
                  >
                    <Typography aria-hidden sx={{
                      fontFamily: MONO, fontSize: 12, lineHeight: 1, width: 10,
                      color: 'var(--confirm-ink)',
                    }}>
                      {OPS_STATUS_GLYPH.verified}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: 11.5, color: pal.ink3 }}>
                      Setup complete · {doneSetupRows.length}/{setupRows.length}
                    </Typography>
                  </Box>
                ) : openSetupRows.length > 0 ? (
                  <>
                    <DisclosureLine
                      testId="ops-setup-toggle"
                      expanded={setupExpanded}
                      onToggle={() => setSetupExpanded((v) => !v)}
                    >
                      SETUP · {openSetupRows.length} remaining
                    </DisclosureLine>

                    {setupExpanded && (
                      <>
                        {openSetupRows.map((row) => (
                          <OpsConsoleRow key={row.id} row={row} onNavigate={goto} />
                        ))}
                        {doneSetupRows.length > 0 && (
                          <>
                            <DisclosureLine
                              testId="ops-setup-completed-toggle"
                              expanded={showCompletedSetup}
                              onToggle={() => setShowCompletedSetup((v) => !v)}
                            >
                              {doneSetupRows.length} completed
                            </DisclosureLine>
                            {showCompletedSetup && doneSetupRows.map((row) => (
                              <OpsConsoleRow key={row.id} row={row} onNavigate={goto} />
                            ))}
                          </>
                        )}
                      </>
                    )}
                  </>
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
            <SectionHeader label="ALERT HISTORY" count={historyRows.length} />
            {resolvedQuery.isError ? (
              <StateLine>Alert history unavailable.</StateLine>
            ) : resolvedQuery.isLoading ? (
              <StateLine>Loading alert history…</StateLine>
            ) : historyRows.length === 0 ? (
              <StateLine>No closed alerts recorded.</StateLine>
            ) : (
              historyRows.map((row) => <OpsConsoleRow key={row.id} row={row} onNavigate={goto} />)
            )}
          </>
        )}
      </Box>

      {/* FOOTER — the single, non-primary path to the advanced alert workspace.
          /alerts stays the place to acknowledge, snooze, resolve, filter and
          manage rules; the console deliberately carries none of those controls. */}
      <Box
        component="button"
        type="button"
        data-testid="ops-manage-alerts"
        onClick={() => nav('/alerts')}
        sx={{
          flexShrink: 0, width: '100%', textAlign: 'left',
          boxSizing: 'border-box', maxWidth: '100%',
          px: 1.5, py: 0.875, cursor: 'pointer',
          bgcolor: 'transparent', border: 'none',
          borderTop: `0.5px solid ${pal.rule}`,
          fontFamily: MONO, fontSize: 10, color: pal.ink4,
          outline: 'none',
          '&:focus': { outline: 'none' },
          '&:focus-visible': { outline: `2px solid ${pal.accent}`, outlineOffset: '-2px' },
          '&:hover': { color: pal.ink3, bgcolor: pal.rowHover },
        }}
      >
        Manage alerts →
      </Box>
    </Box>
  );
}

// ─── TOPNAV TRIGGER ───────────────────────────────────────────────────────────

export function OpsConsoleButton({
  alerts,
  deepLink = alertDeepLink,
}: Pick<OpsConsoleProps, 'alerts' | 'deepLink'>) {
  const pal = useAppTheme();
  const [open, setOpen] = useState(false);
  const { items } = useActivationChecklist();
  const { data: flags } = useChecklistDismissed();
  const setupDismissed = flags?.['checklist:completed'] === true;

  // Open attention is still computed from exactly one authority (isOpenRow over
  // NOW + SETUP), but the trigger no longer PRINTS it: the alerts bell already
  // shows a number for largely the same inbox, and two adjacent counters read as
  // two different truths. The trigger shows presence; the rail's section headers
  // remain the visible, authoritative counts.
  const badge = openAttentionCount([
    ...buildNowRows(alerts, deepLink),
    ...(setupDismissed ? [] : buildSetupRows(items)),
  ]);
  const hasAttention = badge > 0;

  return (
    <>
      <Tooltip title={open ? '' : 'Ops Console'}>
        <IconButton
          size="small"
          onClick={() => setOpen((v) => !v)}
          aria-label={`Ops Console — ${badge} open`}
          aria-expanded={open}
          sx={{ color: hasAttention ? 'var(--accent)' : 'text.secondary' }}
        >
          <Badge
            data-testid="ops-console-trigger-badge"
            variant="dot"
            invisible={!hasAttention}
            sx={{
              '& .MuiBadge-badge': {
                minWidth: 6, height: 6, borderRadius: '50%',
                bgcolor: pal.accent,
              },
            }}
          >
            <Terminal size={18} strokeWidth={hasAttention ? 2.5 : 1.75} />
          </Badge>
        </IconButton>
      </Tooltip>

      <OpsConsolePanel
        alerts={alerts}
        deepLink={deepLink}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
