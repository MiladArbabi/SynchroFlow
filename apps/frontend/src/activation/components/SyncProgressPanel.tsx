import React from 'react';
import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import { AlertTriangle, CheckCircle2, Clock, DatabaseZap } from 'lucide-react';
import {
  ACTIVATION_COLORS,
  ACTIVATION_TIMING,
  WORKFLOW_CLOSING_LINES,
} from '../activationMotionTokens';
import type { SyncCounts, SyncProgress } from '../hooks/useSyncStatus';

export interface SyncProgressPanelProps {
  status: string;
  counts: SyncCounts;
  progress: SyncProgress | null;
  lastError?: string | null;
  veryLongSync: boolean;
  isFirstActivation: boolean;
  /**
   * EXPERIENCE / DISPLAY progress projection. When provided, the bar and the
   * percentage read from this instead of the raw backend percentage so the bar
   * visibly builds through the film rather than snapping to 100%. Backend
   * status/progress stay the authority for everything else. Omitted on the
   * failure path, where the raw backend percentage is shown.
   */
  displayPercentOverride?: number;
  /** DISPLAY completion — bar reaches/greens at 100 only once this is true. */
  displayComplete?: boolean;
  /** When true the bar steps to its value instead of animating continuously. */
  reducedMotion?: boolean;
}

export function computeBackendProgressPercent(
  status: string,
  progress: SyncProgress | null
): number {
  if (status === 'COMPLETED') return 100;
  if (!progress) return 0;
  if (Number.isFinite(progress.percentage)) {
    return Math.max(0, Math.min(100, Math.round(progress.percentage)));
  }
  if (progress.total > 0) {
    return Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)));
  }
  return 0;
}

export function isBackendProgressIndeterminate(status: string, progress: SyncProgress | null): boolean {
  return status !== 'COMPLETED' && (!progress || progress.total <= 0);
}

const countLabel = (value: number, noun: string) =>
  `${value.toLocaleString()} ${noun}${value === 1 ? '' : 's'}`;

export const SyncProgressPanel: React.FC<SyncProgressPanelProps> = ({
  status,
  counts,
  progress,
  lastError,
  veryLongSync,
  isFirstActivation,
  displayPercentOverride,
  displayComplete,
  reducedMotion,
}) => {
  const backendPercent = computeBackendProgressPercent(status, progress);
  const usingDisplayProjection = typeof displayPercentOverride === 'number';
  const percent = usingDisplayProjection
    ? Math.max(0, Math.min(100, Math.round(displayPercentOverride)))
    : backendPercent;
  const indeterminate = usingDisplayProjection
    ? false
    : isBackendProgressIndeterminate(status, progress);
  const failed = status === 'FAILED' || status === 'ERROR';
  const complete = status === 'COMPLETED';
  const barComplete = usingDisplayProjection ? Boolean(displayComplete) : complete;

  return (
    <Box sx={{ minWidth: 0, width: '100%', maxWidth: 520 }} data-testid="sync-progress-panel">
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: failed
              ? 'error.main'
              : complete
                ? ACTIVATION_COLORS.completion
                : ACTIVATION_COLORS.workflowAction,
          }}
        />
        <Typography
          sx={{
            color: failed ? 'error.main' : ACTIVATION_COLORS.workflowAction,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {failed ? 'Sync needs attention' : complete ? 'Workspace ready' : 'Shopify sync in progress'}
        </Typography>
      </Box>

      <Typography
        component="h1"
        sx={{
          m: 0,
          color: ACTIVATION_COLORS.textPrimary,
          fontFamily: 'var(--serif)',
          fontSize: { xs: 34, sm: 42, lg: 52 },
          lineHeight: 1.04,
          fontWeight: 500,
          textWrap: 'balance',
        }}
      >
        {failed ? 'Sync interrupted.' : 'Building your LaSyncro workspace.'}
      </Typography>

      <Typography
        sx={{
          mt: 1.5,
          color: ACTIVATION_COLORS.textSecondary,
          fontSize: 15,
          lineHeight: 1.65,
          maxWidth: 460,
        }}
      >
        {failed
          ? 'Something went wrong while connecting your Shopify store. Reconnect when you are ready to try again.'
          : isFirstActivation
            ? 'We are importing the real products, orders, customers, and inventory counts that power your workspace.'
            : 'We are refreshing Shopify data for this workspace without showing the setup walkthrough again.'}
      </Typography>

      {failed && (
        <Box
          sx={{
            mt: 2.5,
            p: 2,
            border: '1px solid',
            borderColor: 'error.main',
            bgcolor: 'rgba(239,68,68,0.08)',
            borderRadius: 1,
            display: 'flex',
            gap: 1.25,
            alignItems: 'flex-start',
          }}
        >
          <AlertTriangle size={18} />
          <Typography sx={{ color: ACTIVATION_COLORS.textSecondary, fontSize: 13.5, lineHeight: 1.5 }}>
            {lastError || 'Shopify sync stopped before more details were available.'}
          </Typography>
        </Box>
      )}

      <Box sx={{ mt: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
          <Typography
            sx={{
              color: ACTIVATION_COLORS.textMuted,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Sync progress
          </Typography>
          <Typography sx={{ color: ACTIVATION_COLORS.workflowAction, fontFamily: 'var(--serif)', fontSize: 18 }}>
            {percent}%
          </Typography>
        </Box>
        <LinearProgress
          variant={indeterminate ? 'indeterminate' : 'determinate'}
          value={indeterminate ? undefined : percent}
          aria-label="Shopify sync progress"
          sx={{
            height: 4,
            borderRadius: 2,
            bgcolor: 'var(--bg-3)',
            '& .MuiLinearProgress-bar': {
              bgcolor: barComplete ? ACTIVATION_COLORS.completion : ACTIVATION_COLORS.workflowAction,
              transition: reducedMotion ? 'none' : 'transform 700ms cubic-bezier(0.4, 0, 0.2, 1)',
            },
          }}
        />
      </Box>

      <Stack spacing={1.25} sx={{ mt: 3 }} aria-label="Synced Shopify data">
        {[
          countLabel(counts.products ?? 0, 'product'),
          countLabel(counts.variants, 'variant'),
          countLabel(counts.orders, 'order'),
          countLabel(counts.customers, 'customer'),
        ].map((line) => (
          <Box key={line} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, color: ACTIVATION_COLORS.textSecondary }}>
            <DatabaseZap size={16} color={ACTIVATION_COLORS.workflowAction} />
            <Typography sx={{ fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>{line}</Typography>
          </Box>
        ))}
      </Stack>

      {veryLongSync && !failed && !complete && (
        <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 1.25, color: ACTIVATION_COLORS.textMuted }}>
          <Clock size={16} />
          <Typography sx={{ fontSize: 13.5 }}>
            Still bringing everything into LaSyncro. Larger catalogs can take a little longer.
            Your Shopify data is continuing to sync.
          </Typography>
        </Box>
      )}

      {complete && (
        <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 1.25, color: ACTIVATION_COLORS.completion }}>
          <CheckCircle2 size={17} />
          <Typography sx={{ fontSize: 13.5 }}>{WORKFLOW_CLOSING_LINES.join(' ')}</Typography>
        </Box>
      )}
    </Box>
  );
};
