// modules/wms/src/ui/components/ExecutionSessionShell.tsx
import type { ReactNode } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { ReceiveFooterButton, receiveMonoSx } from './receive/ReceiveSessionShell';

/**
 * SF-PICK-P1-SHARED-SHELL-01 — presentation-only execution session shell,
 * extracted verbatim from StowSessionPage (formerly StowSessionShell).
 *
 * Same grammar as ReceiveSessionShell (header, one task column, footer). It
 * owns no session state: each workflow (Stow, Pick) keeps its own business
 * state machine and passes labels, progress tones and callbacks in.
 * One DOM for every viewport.
 */

/** 'flagged' marks a stop completed with a reported shortage (Pick). */
export type ExecutionProgressTone = 'done' | 'flagged' | 'current' | 'idle';

export const EXECUTION_PROGRESS_COLOR: Record<ExecutionProgressTone, string> = {
  done: 'var(--good-ink)',
  flagged: 'var(--accent)',
  current: 'var(--ink)',
  idle: 'var(--rule)',
};

export interface ExecutionSessionShellProps {
  /** Workflow pill, e.g. 'STOW' or 'PICK'. */
  workflowLabel: string;
  /**
   * Expose the workflow pill as the page heading (h2). Optional so Stow's
   * established DOM (a plain span) is unchanged when omitted.
   */
  workflowAsHeading?: boolean;
  /** Optional header content before Back/Exit (e.g. Pick's connection badge). */
  headerAccessory?: ReactNode;
  /** Root data-testid; Stow keeps 'stow-session-shell' for compatibility. */
  testId: string;
  /** Accessible name of the header back button. */
  backAriaLabel: string;
  sourceLabel: string;
  positionLabel: string;
  progressLabel: string;
  bars: ExecutionProgressTone[];
  onBack?: () => void;
  onExit?: () => void;
  exitDisabled: boolean;
  map: ReactNode;
  /** Map and task as two equal panels; everything task-related stays on the right. */
  desktopMapLayout: boolean;
  footer?: ReactNode;
  overlay: ReactNode;
  children: ReactNode;
}

export function ExecutionSessionShell({
  workflowLabel,
  workflowAsHeading = false,
  headerAccessory,
  testId,
  backAriaLabel,
  sourceLabel,
  positionLabel,
  progressLabel,
  bars,
  onBack,
  onExit,
  exitDisabled,
  map,
  desktopMapLayout,
  footer,
  overlay,
  children,
}: ExecutionSessionShellProps) {
  const hasDesktopMapColumn = Boolean(map && desktopMapLayout);
  return (
    <Box
      data-testid={testId}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        bgcolor: 'var(--bg)',
        color: 'var(--ink)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        pb: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <Box
        component="header"
        sx={{
          flex: '0 0 auto',
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr) auto', md: '1fr auto 1fr' },
          alignItems: 'center',
          minHeight: { md: 64 },
          columnGap: 2,
          rowGap: 0.75,
          px: { xs: 2, md: 3 },
          pt: { xs: 'max(8px, env(safe-area-inset-top, 0px))', md: 0 },
          pb: { xs: 1, md: 0 },
          bgcolor: { xs: 'var(--bg)', md: 'var(--surface)' },
          borderBottom: { xs: 0, md: '1px solid var(--rule)' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, gridColumn: 1, gridRow: 1 }}>
          <Box
            component={workflowAsHeading ? 'h2' : 'span'}
            sx={{
              ...(workflowAsHeading && { m: 0 }),
              fontSize: { xs: 10, md: 11 },
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: '0.12em',
              color: 'var(--accent-text)',
              bgcolor: { xs: 'transparent', md: 'var(--accent-ghost)' },
              borderRadius: '100px',
              px: { xs: 0, md: '11px' },
              py: { xs: 0, md: '6px' },
              flexShrink: 0,
            }}
          >
            {workflowLabel}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: { xs: 12, md: 14 }, fontWeight: 500, color: 'var(--ink)' }}>
              {sourceLabel}
            </Typography>
            {positionLabel && (
              <Typography noWrap sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                {positionLabel}
              </Typography>
            )}
          </Box>
        </Box>
        <Box
          sx={{
            display: 'grid',
            justifyItems: { xs: 'stretch', md: 'center' },
            gap: 0.75,
            gridColumn: { xs: '1 / -1', md: 2 },
            gridRow: { xs: 2, md: 1 },
          }}
        >
          {bars.length > 0 && (
            <Box aria-hidden="true" sx={{ display: 'flex', gap: '4px', width: { xs: '100%', md: Math.min(bars.length * 56, 360) } }}>
              {bars.map((tone, index) => (
                <Box key={index} sx={{ flex: '1 1 0', height: 4, borderRadius: '2px', bgcolor: EXECUTION_PROGRESS_COLOR[tone] }} />
              ))}
            </Box>
          )}
          {progressLabel && (
            <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', ...receiveMonoSx }}>
              {progressLabel}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifySelf: 'end', gridColumn: { xs: 2, md: 3 }, gridRow: 1 }}>
          {headerAccessory}
          {onBack && (
            <IconButton onClick={onBack} aria-label={backAriaLabel} sx={{ width: 44, height: 44 }}>
              <ArrowLeft size={18} />
            </IconButton>
          )}
          {onExit && (
            <ReceiveFooterButton
              onClick={onExit}
              disabled={exitDisabled}
              sx={{
                height: 36,
                '&:hover': { bgcolor: 'var(--bg-2)', borderColor: 'var(--rule-2)' },
              }}
            >
              Exit
            </ReceiveFooterButton>
          )}
        </Box>
      </Box>

      <Box
        component="main"
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: hasDesktopMapColumn ? 1240 : { xs: '100%', md: 600 },
            m: { xs: 0, md: 'auto' },
            boxSizing: 'border-box',
            flex: { xs: '1 0 auto', md: '0 0 auto' },
            display: 'grid',
            gridTemplateColumns: hasDesktopMapColumn ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
            gap: { xs: 1.5, md: 4 },
            px: { xs: 2, md: 3 },
            pt: { xs: 1.5, md: 3 },
            pb: { xs: 1, md: 3 },
          }}
        >
          {hasDesktopMapColumn && (
            <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {map}
            </Box>
          )}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: { xs: 1.5, md: 2 },
              minWidth: 0,
              ...(hasDesktopMapColumn && {
                p: { md: 2, lg: 3 },
                justifyContent: 'space-between',
                border: '1px solid var(--rule)',
                borderRadius: '12px',
                bgcolor: 'var(--surface)',
              }),
            }}
          >
            {children}
            {!hasDesktopMapColumn && map}
          </Box>
        </Box>
      </Box>

      {footer && (
        <Box
          component="footer"
          sx={{ flex: '0 0 auto', display: 'flex', justifyContent: 'flex-end', px: 2, py: 1 }}
        >
          {footer}
        </Box>
      )}
      {overlay}
    </Box>
  );
}
