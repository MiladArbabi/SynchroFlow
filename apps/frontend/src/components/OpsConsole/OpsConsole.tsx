// apps/frontend/src/components/OpsConsole/OpsConsole.tsx
//
// OPS-CONSOLE-01 — persistent right-side Ops Console (V1).
//
// The SINGLE top-nav attention surface. It replaces both the "Getting started"
// activation-checklist popover and the alerts bell popover. The console
// presents alerts; it manages none of them. GH-1147 retired the old /alerts
// management workspace (inbox / snoozed / resolved / rules): /alerts is now the
// notification module (Recent + Settings), and the rail's "Alert settings"
// footer opens its preferences in the Settings modal, /settings/alerts, over
// the merchant's current page.
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
//   WAITING — canonical shop-wide WAITING feed (GET /api/v1/operations/waiting,
//             see useWaiting.ts), mapped verbatim by buildWaitingRows — no
//             local lifecycle inference. Empty feed renders no section.
//   SETUP   — existing useActivationChecklist assembler, unchanged. Secondary:
//             collapsed until asked for, and always rendered below NOW.
//             GH-1156: its Opening Inventory row may carry a `command` action,
//             which this surface alone executes (runCommand below).
//             GH-1165: in first-entry mode (useActivationChecklist.firstEntry)
//             the dedicated map → count projection replaces it, expanded and
//             above NOW; the trigger auto-opens once (persisted server-side)
//             and Cmd/Ctrl+K opens straight into Global Search.
//   HISTORY — its own tab, never in OPEN. OPS-CONSOLE-HISTORY-01: canonical
//             shop-wide HISTORY V1 feed (GET /api/v1/operations/history, see
//             useHistory.ts), mapped verbatim by buildHistoryRows — no local
//             lifecycle inference, fetched only while the console is open,
//             never polls. A row here IS a canonically verified_resolved
//             Decision Engine outcome (order_constraints.resolved_at), so it
//             renders 'verified' (✓). Resolved alerts no longer power this
//             tab — that was a stale contract; resolved alerts remain
//             Alerts' own concern, not HISTORY's.
//
// All colour comes from useAppTheme() CSS-variable tokens, so light and dark
// both resolve from the theme rather than baked-in surface hexes.

import { type CSSProperties, type ReactNode, forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, IconButton, Tooltip, Badge, Slide, useMediaQuery } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EntityDetailModal } from '@lasyncro/shared/ui';

import { axiosInstance } from '../../api/axiosConfig';
import { useAppTheme } from '../../hooks/useAppTheme';
import useConfig from '../../hooks/useConfig';
import { useActivationChecklist } from '../../hooks/useActivationChecklist';
import { type Alert } from '../../pages/alerts/useAlerts';
import { alertDeepLink } from '../../pages/alerts/alertDeepLink';
import { useWaiting, type WaitingItem } from '../../pages/operations/useWaiting';
import { useHistory, type HistoryItem } from '../../pages/operations/useHistory';
import { OrderDetailModalBody } from '../../pages/orders/OrderDetailModalBody';
import { BatchDetailModalBody } from '../../pages/ft2-pages/BatchDetailModalBody';
import { VariantDetailModalHost } from '../../pages/ft2-pages/VariantDetailModalHost';
import { usePickBatches } from '../../pages/wms/usePickBatches';
import { useBulkSetPriority } from '../../pages/wms/useOrderPool';
import { useGlobalSearch, type GlobalSearchResult } from './useGlobalSearch';
import { OpsConsoleGlyph } from './OpsConsoleGlyph';
import { REDUCED_MOTION_QUERY, SHELL_MOTION } from '../ThemeToggle/shellMotion';
import {
  OPS_STATUS_GLYPH,
  buildHistoryRows,
  buildNowRows,
  buildSetupRows,
  buildWaitingRows,
  NOW_VISIBLE_LIMIT,
  openAttentionCount,
  type OpsCommand,
  type OpsRow,
} from './opsConsoleModel';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const OPS_SEARCH_HINT = 'FIND ORDER, SKU, BARCODE OR BATCH';

const ONBOARDING_FLAGS_QUERY_KEY = ['user-state', 'onboarding-flags'] as const;

/**
 * GH-1165 — dedicated server-side flag (user_states, via onboarding-flags) that
 * records the once-only first-entry auto-open. Deliberately not
 * checklist:completed or a spotlight key, and never a setup completion input.
 */
export const OPS_CONSOLE_INTRO_SEEN_KEY = 'ops-console:intro-seen';
const OPS_CONSOLE_INTRO_SEEN_URL = '/api/v1/user-state/ops-console/intro-seen';
/** Delay between the trigger pulse and the once-only first-entry auto-open. */
export const OPS_CONSOLE_AUTO_OPEN_DELAY_MS = 650;

/** Cmd on macOS, Ctrl elsewhere — the Global Search shortcut modifier. */
function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * GH-1156 — stable merchant copy for a failed opening-count start. The
 * backend's own public message is used only when it carries the start
 * endpoint's stable OPENING_START_* code; anything else (network, RBAC,
 * entitlement) falls back to this sentence.
 */
export const OPENING_START_FALLBACK_ERROR = 'The opening count could not be started. Try again.';

function openingStartErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { code?: unknown; error?: unknown } } })
    ?.response?.data;
  if (
    typeof data?.code === 'string' && data.code.startsWith('OPENING_START_')
    && typeof data.error === 'string' && data.error
  ) {
    return data.error;
  }
  return OPENING_START_FALLBACK_ERROR;
}

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
    queryKey: ONBOARDING_FLAGS_QUERY_KEY,
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
function OpsConsoleRow({
  row,
  onNavigate,
  onOrderEntity,
  onCommand,
  pendingCommand = null,
  commandError = null,
}: {
  row: OpsRow;
  onNavigate: (route: string) => void;
  /**
   * HISTORY-ORDER-ENTITY-01 — invoked for a `kind: 'order_entity'` action.
   * Optional: every existing NOW/WAITING/SETUP/issue-1114 row is `kind:
   * 'navigate'`, so most call sites never need it.
   */
  onOrderEntity?: (lasyncroOrderId: string) => void;
  /** GH-1156 — invoked for a `kind: 'command'` action. Never navigates. */
  onCommand?: (command: OpsCommand) => void;
  /** GH-1156 — the command currently in flight, if any. */
  pendingCommand?: OpsCommand | null;
  /** GH-1156 — last failure of this row's command, if any. */
  commandError?: string | null;
}) {
  const pal = useAppTheme();

  // A closed alert row is quiet but must stay READABLE — dimming the whole row
  // made it unreadable in light mode. Only genuinely retired rows are faded.
  const faded = row.status === 'verified' || row.status === 'dismissed';
  const quiet = faded || row.status === 'closed';
  // Cardize actionable work only. HISTORY never gets elevation.
  const isCard = row.section !== 'HISTORY' && Boolean(row.action);
  const command = row.action?.kind === 'command' ? row.action.command : null;
  const commandPending = command !== null && pendingCommand === command;
  const rowCommandError = command !== null ? commandError : null;

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
        {row.subtitle && (
          <Box
            component="span"
            sx={{ display: 'block', fontSize: 10, color: pal.ink3, fontWeight: 400 }}
          >
            {row.subtitle}
          </Box>
        )}
        {rowCommandError && (
          <Box
            component="span"
            role="alert"
            data-testid={`ops-row-error-${row.id}`}
            sx={{ display: 'block', fontSize: 10, color: 'var(--critical-ink)', fontWeight: 400 }}
          >
            {rowCommandError}
          </Box>
        )}
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
            disabled={commandPending}
            aria-busy={commandPending || undefined}
            onClick={() => {
              // HISTORY-ORDER-ENTITY-01: branch on the action's own kind —
              // navigate is the existing V1 route CTA (NOW/WAITING/SETUP/
              // issue 1114), order_entity opens the canonical Order Entity Modal.
              // GH-1156: command runs in place and never navigates.
              const action = row.action!;
              if (action.kind === 'order_entity') {
                onOrderEntity?.(action.lasyncroOrderId);
              } else if (action.kind === 'command') {
                if (commandPending) return;
                onCommand?.(action.command);
              } else {
                onNavigate(action.route);
              }
            }}
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
              '&:disabled': { cursor: 'default', opacity: 0.62, bgcolor: 'transparent' },
            }}
          >
            {row.action.kind === 'command'
              ? (commandPending ? 'Starting…' : row.action.label)
              : `${row.action.label} →`}
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

function SearchResultTypeLabel({ type }: { type: GlobalSearchResult['type'] }) {
  return (
    <Typography
      sx={{
        fontFamily: MONO,
        fontSize: 9,
        lineHeight: 1,
        letterSpacing: '0.12em',
        color: 'var(--accent)',
        minWidth: 46,
      }}
    >
      {type === 'variant' ? 'PRODUCT' : type.toUpperCase()}
    </Typography>
  );
}

function OpsGlobalSearch({
  open,
  query,
  onQueryChange,
  activeIndex,
  onActiveIndexChange,
  onActivate,
  inputRef,
}: {
  open: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onActivate: (result: GlobalSearchResult) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const pal = useAppTheme();
  const search = useGlobalSearch(query, open);
  const trimmed = query.trim();
  const results = search.data?.results ?? [];
  const showResults = trimmed.length >= 2;
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    onActiveIndexChange(results.length > 0 ? 0 : -1);
  }, [onActiveIndexChange, query, results.length]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // GH-1165 — a query/results Escape clears and stays in search; an empty
      // focused Escape leaves search. Neither navigates nor closes the rail.
      if (query.length > 0) {
        onQueryChange('');
        onActiveIndexChange(-1);
      } else {
        event.currentTarget.blur();
      }
      return;
    }

    if (!showResults || results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onActiveIndexChange(activeIndex < 0 ? 0 : Math.min(activeIndex + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      onActiveIndexChange(activeIndex <= 0 ? 0 : activeIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = results[activeIndex >= 0 ? activeIndex : 0];
      if (selected) onActivate(selected);
    }
  };

  return (
    <Box
      sx={{
        flexShrink: 0,
        borderBottom: `0.5px solid ${pal.rule}`,
        bgcolor: 'transparent',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          py: 0.75,
        }}
      >
        <Typography aria-hidden sx={{ fontFamily: MONO, fontSize: 12, color: pal.ink3 }}>
          &gt;
        </Typography>
        <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
          {!searchFocused && query.length === 0 && (
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                pointerEvents: 'none',
              }}
            >
              <Typography
                data-testid="ops-search-idle-hint"
                sx={{
                  fontFamily: MONO,
                  fontSize: 12,
                  lineHeight: 1.4,
                  color: pal.ink4,
                }}
              >
                {OPS_SEARCH_HINT}
              </Typography>
              <Typography
                data-testid="ops-search-idle-caret"
                sx={{
                  fontFamily: MONO,
                  fontSize: 12,
                  lineHeight: 1.4,
                  color: pal.ink4,
                  animation: 'opsCaretBlink 1.1s steps(1) infinite',
                  '@keyframes opsCaretBlink': {
                    '0%, 48%': { opacity: 1 },
                    '49%, 100%': { opacity: 0 },
                  },
                }}
              >
                _
              </Typography>
            </Box>
          )}
          <Box
            component="input"
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={handleKeyDown}
            aria-label="Search orders, products, SKUs, barcodes, or batches"
            placeholder={OPS_SEARCH_HINT}
            data-testid="ops-global-search-input"
            sx={{
              width: '100%',
              boxSizing: 'border-box',
              p: 0,
              border: 'none',
              outline: 'none',
              bgcolor: 'transparent',
              color: pal.ink,
              fontFamily: MONO,
              fontSize: 12,
              lineHeight: 1.4,
              caretColor: pal.accent,
              '&::placeholder': {
                color: searchFocused ? pal.ink4 : 'transparent',
                opacity: 1,
              },
              '&:focus': { outline: 'none' },
            }}
          />
        </Box>
      </Box>

      {trimmed.length === 1 && <StateLine>Keep typing…</StateLine>}
      {showResults && search.isLoading && <StateLine>Searching…</StateLine>}
      {showResults && search.isError && <StateLine>Search unavailable.</StateLine>}
      {showResults && !search.isLoading && !search.isError && results.length === 0 && (
        <StateLine>No results.</StateLine>
      )}
      {showResults && results.length > 0 && (
        <Box role="listbox" aria-label="Search results" sx={{ pb: 0.5 }}>
          {results.slice(0, 6).map((result, index) => (
            <Box
              key={`${result.type}:${result.id}`}
              component="button"
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              data-testid={`ops-search-result-${result.type}-${result.id}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onActivate(result)}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr)',
                columnGap: 0.75,
                rowGap: 0.25,
                width: '100%',
                px: 1.5,
                py: 0.625,
                textAlign: 'left',
                border: 'none',
                borderTop: `0.5px solid ${pal.rule}`,
                bgcolor: index === activeIndex ? pal.accentGhost : 'transparent',
                color: pal.ink,
                cursor: 'pointer',
                '&:hover': { bgcolor: pal.rowHover },
              }}
            >
              <SearchResultTypeLabel type={result.type} />
              <Typography sx={{ fontFamily: MONO, fontSize: 11.5, color: pal.ink, minWidth: 0 }}>
                {result.label}
              </Typography>
              <Box />
              {(result.secondary || result.meta) && (
                <Typography sx={{ fontFamily: MONO, fontSize: 10, color: pal.ink4, minWidth: 0 }}>
                  {[result.secondary, result.meta].filter(Boolean).join(' · ')}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
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
  /**
   * OPS-CONSOLE-WAITING-01 — canonical shop-wide WAITING feed. Owned and
   * fetched internally via useWaiting() by default; overridable for tests
   * only, mirroring `deepLink`.
   */
  waitingItems?: WaitingItem[];
  /**
   * OPS-CONSOLE-HISTORY-01 — canonical shop-wide HISTORY V1 feed. Owned and
   * fetched internally via useHistory() by default; overridable for tests
   * only, mirroring `waitingItems`.
   */
  historyItems?: HistoryItem[];
  /**
   * GH-1165 — explicit Global Search intent (Cmd/Ctrl+K). Each increment above
   * zero focuses the search input; zero (manual open, auto-open) never does.
   */
  searchFocusRequest?: number;
}

/**
 * GH-1158 — presentation lifecycle only. The rail slides in from the right and
 * reverses out on the shell motion curve; it stays mounted through the exit
 * transition and unmounts once it completes (mountOnEnter/unmountOnExit), so a
 * closed console still mounts nothing and runs none of its queries. Reduced
 * motion collapses the transition to zero. Geometry, content, search and
 * navigation contracts all live unchanged in OpsConsolePanelSurface.
 */
export function OpsConsolePanel(props: OpsConsoleProps) {
  const reduceMotion = useMediaQuery(REDUCED_MOTION_QUERY);

  return (
    <Slide
      in={props.open}
      direction="left"
      appear
      mountOnEnter
      unmountOnExit
      timeout={reduceMotion ? 0 : SHELL_MOTION.durationMs}
      easing={SHELL_MOTION.easing}
    >
      <OpsConsolePanelSurface {...props} />
    </Slide>
  );
}

const OpsConsolePanelSurface = forwardRef<HTMLDivElement, OpsConsoleProps & { style?: CSSProperties }>(function OpsConsolePanelSurface({
  alerts,
  deepLink = alertDeepLink,
  open,
  onClose,
  waitingItems,
  historyItems,
  searchFocusRequest = 0,
  style,
}, ref) {
  const pal = useAppTheme();
  const nav = useNavigate();
  const [tab, setTab] = useState<'OPEN' | 'HISTORY'>('OPEN');
  const [showCompletedSetup, setShowCompletedSetup] = useState(false);
  // Presentational only — no persistence, no new authority.
  const [nowExpanded, setNowExpanded] = useState(false);
  const [setupExpanded, setSetupExpanded] = useState(false);
  // GH-1165 — first-entry SETUP is expanded by default.
  const [firstEntrySetupExpanded, setFirstEntrySetupExpanded] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchFocusRequest > 0) searchInputRef.current?.focus({ preventScroll: true });
  }, [searchFocusRequest]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [modalSubtitle, setModalSubtitle] = useState<string | undefined>();
  const [modalFooter, setModalFooter] = useState<ReactNode>(null);

  const {
    items, isLoading: setupLoading, isError: setupError, refreshOpeningInventory,
    firstEntry = false, firstEntryItems,
  } = useActivationChecklist();
  const { data: flags } = useChecklistDismissed();
  const setupDismissed = flags?.['checklist:completed'] === true;
  const pickBatchesQuery = usePickBatches({ enabled: open });
  const selectedBatch = useMemo(
    () => pickBatchesQuery.data?.batches.find((batch) => batch.pick_batch_id === selectedBatchId) ?? null,
    [pickBatchesQuery.data?.batches, selectedBatchId]
  );
  const bulkSetPriority = useBulkSetPriority();
  const onPriorityFlag = useCallback(
    async (orderIds: string[], _flagged: boolean) => {
      await bulkSetPriority.mutateAsync(orderIds);
    },
    [bulkSetPriority]
  );
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setActiveSearchIndex(-1);
  }, []);
  const handleCloseOrderDetail = useCallback(() => {
    setSelectedOrderId(null);
    setModalTitle('');
    setModalSubtitle(undefined);
    setModalFooter(null);
  }, []);
  const activateSearchResult = useCallback((result: GlobalSearchResult) => {
    clearSearch();
    if (result.type === 'order') {
      setSelectedBatchId(null);
      setSelectedVariantId(null);
      setSelectedOrderId(result.id);
      return;
    }
    if (result.type === 'batch') {
      setSelectedOrderId(null);
      setSelectedVariantId(null);
      setSelectedBatchId(result.id);
      return;
    }

    setSelectedOrderId(null);
    setSelectedBatchId(null);
    setSelectedVariantId(result.id);
  }, [clearSearch]);

  /**
   * HISTORY-ORDER-ENTITY-01 — opens the SAME canonical Order Entity Modal
   * (EntityDetailModal + OrderDetailModalBody, wired below) a HISTORY row's
   * `kind: 'order_entity'` action targets. Mirrors activateSearchResult's
   * own order branch: clear any other open entity selection first so only
   * one modal is ever driven at a time.
   */
  const openOrderEntity = useCallback((lasyncroOrderId: string) => {
    setSelectedBatchId(null);
    setSelectedVariantId(null);
    setSelectedOrderId(lasyncroOrderId);
  }, []);

  // OPS-CONSOLE-HISTORY-01 — canonical shop-wide HISTORY V1 feed. Never
  // polls (useHistory forces refetchInterval off); gated on `open` so a
  // closed console costs nothing. `historyItems` is override-only (tests);
  // production always reads the live query result.
  const historyQuery = useHistory({ enabled: open });
  const resolvedHistoryItems = historyItems ?? historyQuery.data?.items ?? [];

  // Actionable-only, in backend rank order — no client-side sorting anywhere.
  const nowRows = useMemo(() => buildNowRows(alerts, deepLink), [alerts, deepLink]);
  // OPS-CONSOLE-WAITING-01 — canonical shop-wide WAITING feed. `waitingItems`
  // is override-only (tests); production always reads the live query result.
  // A loading/error/empty feed resolves to [] and therefore never renders a
  // WAITING section — no synthesized rows.
  const waitingQuery = useWaiting();
  const resolvedWaitingItems = waitingItems ?? waitingQuery.data?.items ?? [];
  const waitingRows = useMemo(() => buildWaitingRows(resolvedWaitingItems), [resolvedWaitingItems]);
  const setupRows = useMemo(() => (setupDismissed ? [] : buildSetupRows(items)), [items, setupDismissed]);
  const firstEntryRows = useMemo(
    () => (firstEntry ? buildSetupRows(firstEntryItems ?? []) : []),
    [firstEntry, firstEntryItems],
  );
  const firstEntryRemaining = firstEntryRows.filter((r) => r.status !== 'verified').length;
  const historyRows = useMemo(() => buildHistoryRows(resolvedHistoryItems), [resolvedHistoryItems]);

  // The cap is a rendering decision. The COUNT is always the full actionable
  // total, so a hidden row is never an uncounted row.
  const nowVisibleRows = nowExpanded ? nowRows : nowRows.slice(0, NOW_VISIBLE_LIMIT);
  const nowHiddenCount = nowRows.length - nowVisibleRows.length;

  const openSetupRows = setupRows.filter((r) => r.status !== 'verified');
  const doneSetupRows = setupRows.filter((r) => r.status === 'verified');
  const allSetupComplete = setupRows.length > 0 && openSetupRows.length === 0;

  const goto = (route: string) => { nav(route); };

  // GH-1156 — console-owned command execution. The ref blocks a duplicate
  // POST before React re-renders the disabled CTA; completion is never
  // inferred here — the row's next state comes only from the canonical
  // readiness/progress re-read after a successful start.
  const [pendingCommand, setPendingCommand] = useState<OpsCommand | null>(null);
  const [commandErrors, setCommandErrors] = useState<Partial<Record<OpsCommand, string>>>({});
  const commandInFlight = useRef(false);
  const runCommand = useCallback(async (command: OpsCommand) => {
    if (command !== 'opening_inventory_start') return;
    if (commandInFlight.current) return;
    commandInFlight.current = true;
    setPendingCommand(command);
    setCommandErrors((prev) => ({ ...prev, [command]: undefined }));
    try {
      // No body: the canonical start service owns shop, cohort and replay.
      await axiosInstance.post('/api/v1/wms/opening-inventory/start');
      await refreshOpeningInventory?.();
    } catch (error) {
      setCommandErrors((prev) => ({ ...prev, [command]: openingStartErrorMessage(error) }));
    } finally {
      commandInFlight.current = false;
      setPendingCommand(null);
    }
  }, [refreshOpeningInventory]);
  const commandErrorFor = (row: OpsRow) =>
    row.action?.kind === 'command' ? commandErrors[row.action.command] ?? null : null;

  // While the exit transition plays the rail is visual only: hidden from
  // assistive tech, out of the tab order, and click-through.
  const exiting = !open;

  return (
    <Box
      ref={ref}
      style={style}
      role="complementary"
      aria-label="Ops Console"
      aria-hidden={exiting || undefined}
      inert={exiting}
      data-testid="ops-console"
      data-state={exiting ? 'closing' : 'open'}
      sx={{
        pointerEvents: exiting ? 'none' : undefined,
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

      <OpsGlobalSearch
        open={open}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        activeIndex={activeSearchIndex}
        onActiveIndexChange={setActiveSearchIndex}
        onActivate={activateSearchResult}
        inputRef={searchInputRef}
      />

      {/* BODY */}
      {/* The single scroll container. minHeight:0 lets it actually shrink
          inside the flex column instead of pushing the footer out of view. */}
      <Box data-testid="ops-console-body" sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {tab === 'OPEN' ? (
          <>
            {/* GH-1165 — FIRST-ENTRY: while opening reconciliation is
                canonically required and incomplete, the dedicated two-step
                setup (map → count) comes first and expanded. Once readiness
                reports reconciled this block is gone and the mature NOW-first
                composition below is unchanged. */}
            {firstEntry && (
              <>
                <Box
                  data-testid="ops-first-entry-intro"
                  sx={{ px: 1.5, py: 1, borderBottom: `0.5px solid ${pal.rule}` }}
                >
                  <Typography sx={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: pal.ink }}>
                    Start here
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: 10.5, color: pal.ink3, mt: 0.25 }}>
                    See what needs your attention and what to do next.
                  </Typography>
                </Box>
                <DisclosureLine
                  testId="ops-first-entry-setup-toggle"
                  expanded={firstEntrySetupExpanded}
                  onToggle={() => setFirstEntrySetupExpanded((v) => !v)}
                >
                  SETUP · {firstEntryRemaining} remaining
                </DisclosureLine>
                {firstEntrySetupExpanded && firstEntryRows.map((row) => (
                  <OpsConsoleRow
                    key={row.id}
                    row={row}
                    onNavigate={goto}
                    onCommand={(command) => { void runCommand(command); }}
                    pendingCommand={pendingCommand}
                    commandError={commandErrorFor(row)}
                  />
                ))}
              </>
            )}

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
                for, so unfinished onboarding never competes with live work.
                GH-1165: replaced by the first-entry block above while
                first-entry mode holds. */}
            {!firstEntry && !setupDismissed && (
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
                          <OpsConsoleRow
                            key={row.id}
                            row={row}
                            onNavigate={goto}
                            onCommand={(command) => { void runCommand(command); }}
                            pendingCommand={pendingCommand}
                            commandError={commandErrorFor(row)}
                          />
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
            <SectionHeader label="HISTORY" count={historyRows.length} />
            {historyQuery.isError ? (
              <StateLine>History unavailable.</StateLine>
            ) : historyQuery.isLoading ? (
              <StateLine>Loading history…</StateLine>
            ) : historyRows.length === 0 ? (
              <StateLine>Nothing verified resolved yet.</StateLine>
            ) : (
              historyRows.map((row) => (
                <OpsConsoleRow key={row.id} row={row} onNavigate={goto} onOrderEntity={openOrderEntity} />
              ))
            )}
          </>
        )}
      </Box>

      {/* FOOTER — the single, non-primary handoff to notification preferences
          (/settings/alerts, GH-1147). It is not an operational workspace; the
          console deliberately carries no alert-management controls. */}
      <Box
        component="button"
        type="button"
        data-testid="ops-manage-alerts"
        onClick={() => nav('/settings/alerts')}
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
        Alert settings →
      </Box>

      <EntityDetailModal
        entityId={selectedBatchId}
        onClose={() => setSelectedBatchId(null)}
        title={`Batch ${selectedBatchId?.slice(0, 8).toUpperCase() ?? ''}`}
        subtitle={
          selectedBatch
            ? `${selectedBatch.status.replace(/_/g, ' ')} · ${selectedBatch.release_trigger ?? 'standard'} release`
            : undefined
        }
        maxWidth="md"
      >
        {selectedBatch && (
          <BatchDetailModalBody
            batch={selectedBatch}
            onNavigateToOrder={(orderId) => {
              setSelectedBatchId(null);
              setSelectedOrderId(orderId);
            }}
          />
        )}
      </EntityDetailModal>

      <EntityDetailModal
        entityId={selectedOrderId}
        onClose={handleCloseOrderDetail}
        title={modalTitle}
        subtitle={modalSubtitle}
        maxWidth="md"
        footerActions={modalFooter}
      >
        {selectedOrderId && (
          <OrderDetailModalBody
            orderId={selectedOrderId}
            onTitleReady={setModalTitle}
            onSubtitleReady={setModalSubtitle}
            onNavigateToOrder={setSelectedOrderId}
            onFooterReady={setModalFooter}
            onPriorityFlag={onPriorityFlag}
            onClose={handleCloseOrderDetail}
          />
        )}
      </EntityDetailModal>

      <VariantDetailModalHost
        variantId={selectedVariantId}
        onClose={() => setSelectedVariantId(null)}
      />
    </Box>
  );
});

// ─── TOPNAV TRIGGER ───────────────────────────────────────────────────────────

export function OpsConsoleButton({
  alerts,
  deepLink = alertDeepLink,
}: Pick<OpsConsoleProps, 'alerts' | 'deepLink'>) {
  const pal = useAppTheme();
  // OVERVIEW-SCREEN-OPT-01 — open/closed is shared ConfigContext state so the
  // Overview page can withdraw Operations Pulse while the console is open.
  const { state, dispatch } = useConfig();
  const open = state.isOpsConsoleOpen;

  // GH-1165 — first-entry onboarding uses the shared Ops open-state authority;
  // query/cache state remains local to the onboarding behavior.
  const queryClient = useQueryClient();
  const { items, firstEntry = false, firstEntryItems } = useActivationChecklist();
  const { data: flags, isSuccess: flagsLoaded } = useChecklistDismissed();
  const setupDismissed = flags?.['checklist:completed'] === true;

  // GH-1165 — Global Search intent. Zero means "open without focusing search"
  // (manual click, auto-open); Cmd/Ctrl+K increments it.
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [pulse, setPulse] = useState(false);

  // GH-1165 — once-only first-entry auto-open. Eligible only on positive
  // evidence: canonical first-entry mode AND a loaded flag read that lacks the
  // intro-seen key. Loading, failed or missing state never opens (fail
  // closed). The ref makes the claim once per mount; the persisted flag makes
  // it once per user across remounts and reloads.
  const introSeen = flags?.[OPS_CONSOLE_INTRO_SEEN_KEY] === true;
  const autoOpenEligible = firstEntry === true && flagsLoaded === true && !introSeen;
  const introClaimed = useRef(false);
  // Held in a ref so claimIntro stays stable and never reschedules the timer.
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  const claimIntro = useCallback(() => {
    if (introClaimed.current) return;
    introClaimed.current = true;
    // Records only that the intro ran; it never touches setup completion.
    axiosInstance.post(OPS_CONSOLE_INTRO_SEEN_URL)
      .then(() => {
        queryClientRef.current.setQueryData<Record<string, boolean>>(
          ONBOARDING_FLAGS_QUERY_KEY,
          (old) => ({ ...(old ?? {}), [OPS_CONSOLE_INTRO_SEEN_KEY]: true }),
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!autoOpenEligible || introClaimed.current) return undefined;
    setPulse(true);
    // The claim happens when the timer fires, not when it is scheduled, so a
    // cancelled schedule (unmount, StrictMode re-run) never burns the intro.
    const timer = setTimeout(() => {
      if (introClaimed.current) return;
      claimIntro();
      setSearchFocusRequest(0);
      dispatch({ type: 'SET_OPS_CONSOLE', payload: true });
    }, OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoOpenEligible, claimIntro, dispatch]);

  // Opening the console by any explicit means while the intro is pending
  // consumes it, so it can never pop open again behind the merchant.
  const autoOpenEligibleRef = useRef(autoOpenEligible);
  autoOpenEligibleRef.current = autoOpenEligible;

  const toggleFromTrigger = () => {
    if (autoOpenEligibleRef.current) claimIntro();
    setSearchFocusRequest(0);
    dispatch({ type: 'SET_OPS_CONSOLE', payload: !open });
  };

  // GH-1165 — Cmd+K (macOS) / Ctrl+K (elsewhere): open if closed, then focus
  // Global Search. The browser's own binding is suppressed.
  useEffect(() => {
    const mac = isMacPlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || event.altKey || event.shiftKey) return;
      const modifier = mac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!modifier) return;
      event.preventDefault();
      if (autoOpenEligibleRef.current) claimIntro();
      dispatch({ type: 'SET_OPS_CONSOLE', payload: true });
      setSearchFocusRequest((n) => n + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [claimIntro, dispatch]);
  // Open attention is still computed from exactly one authority (isOpenRow over
  // NOW + SETUP), but the trigger no longer PRINTS it: the alerts bell already
  // shows a number for largely the same inbox, and two adjacent counters read as
  // two different truths. The trigger shows presence; the rail's section headers
  // remain the visible, authoritative counts.
  // GH-1165: in first-entry mode SETUP is the first-entry projection the rail
  // actually presents.
  const badge = openAttentionCount([
    ...buildNowRows(alerts, deepLink),
    ...(firstEntry
      ? buildSetupRows(firstEntryItems ?? [])
      : setupDismissed ? [] : buildSetupRows(items)),
  ]);
  const hasAttention = badge > 0;

  return (
    <>
      <Tooltip title={open ? '' : 'Ops Console'}>
        <IconButton
          size="small"
          disableRipple
          onClick={toggleFromTrigger}
          aria-label={`Ops Console — ${badge} open`}
          aria-expanded={open}
          data-state={open ? 'open' : 'closed'}
          data-pulse={pulse ? 'true' : undefined}
          onAnimationEnd={() => setPulse(false)}
          sx={{
            borderRadius: '8px',
            color: open || hasAttention ? 'var(--accent)' : 'text.secondary',
            // GH-1158 — open state takes the accent wash; keyboard focus draws
            // the accent ring, pointer focus leaves nothing behind.
            bgcolor: open ? pal.accentGhost : 'transparent',
            boxShadow: open ? `inset 0 0 0 1px ${pal.accentBorder}` : 'none',
            outline: 'none',
            transition: 'background-color 150ms ease, box-shadow 150ms ease, color 150ms ease',
            '&:hover': {
              bgcolor: open ? pal.accentGhost : pal.bg2,
              color: 'var(--accent-hover)',
            },
            '&.Mui-focusVisible': { boxShadow: `0 0 0 2px ${pal.accent}` },
            // GH-1165 — single first-entry pulse ahead of the auto-open, on
            // the shell's one motion language (GH-1158).
            '&[data-pulse="true"]': {
              animationName: 'opsTriggerPulse',
              animationDuration: `${SHELL_MOTION.durationMs}ms`,
              animationTimingFunction: SHELL_MOTION.easing,
              animationIterationCount: 1,
              '@keyframes opsTriggerPulse': {
                '0%': { boxShadow: `0 0 0 0 ${pal.accentBorder}` },
                '100%': { boxShadow: '0 0 0 8px transparent' },
              },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            },
          }}
        >
          <Badge
            data-testid="ops-console-trigger-badge"
            variant="dot"
            invisible={!hasAttention || open}
            sx={{
              '& .MuiBadge-badge': {
                minWidth: 6, height: 6, borderRadius: '50%',
                bgcolor: pal.accent,
              },
            }}
          >
            <OpsConsoleGlyph open={open} />
          </Badge>
        </IconButton>
      </Tooltip>

      <OpsConsolePanel
        alerts={alerts}
        deepLink={deepLink}
        open={open}
        onClose={() => {
          setSearchFocusRequest(0);
          dispatch({ type: 'SET_OPS_CONSOLE', payload: false });
        }}
        searchFocusRequest={searchFocusRequest}
      />
    </>
  );
}
