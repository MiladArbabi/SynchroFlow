// WMS-BRIEF-SYSTEM-01A — shared WMS task-session Brief.
//
// A physical WMS task owns the viewport from its Brief onward, so every Brief
// presents the same composition: session identity, title, a compact fact
// rail, operational steps, optional notice, inline start/claim error, and an
// action row. Presentation only — the host page owns all state, the start /
// claim boundary and session exit.
//
// Actions are slots, not config: each caller renders its own Tier-1 primary
// button (WMS_TIER1_ACTION_SX) and its own non-mutating secondary/leave
// button, so CTA tier grammar stays visible at the call site. No scanner
// execution control belongs on a Brief.
import type { ReactNode } from 'react';
import { Alert, Box, Paper, Typography } from '@mui/material';

export interface WmsSessionBriefFact {
  label: string;
  value: ReactNode;
}

export interface WmsSessionBriefProps {
  /** Stable session identity (task label, batch reference). */
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  facts: readonly WmsSessionBriefFact[];
  /** Operational next steps, rendered as an ordered list. */
  steps?: readonly string[];
  /** Optional task-specific notice shown after the steps. */
  notice?: ReactNode;
  /** Inline start/claim error; the operator stays on the Brief. */
  error?: string | null;
  primaryAction: ReactNode;
  secondaryAction?: ReactNode;
}

export function WmsSessionBrief({
  eyebrow,
  title,
  description,
  facts,
  steps,
  notice,
  error,
  primaryAction,
  secondaryAction,
}: WmsSessionBriefProps) {
  return (
    <Box sx={{ p: '30px 24px', maxWidth: 720, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography
          sx={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-text)', mb: 0.5 }}
        >
          {eyebrow}
        </Typography>

        <Typography
          component="h1"
          sx={{
            fontSize: 26,
            fontWeight: 600,
            color: 'var(--ink)',
            lineHeight: 1.1,
          }}
        >
          {title}
        </Typography>

        {description && (
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 300,
              color: 'var(--ink-3)',
              mt: 0.75,
            }}
          >
            {description}
          </Typography>
        )}
      </Box>

      <Paper
        variant="outlined"
        sx={{
          px: 2,
          py: 1.5,
          mb: 2,
          borderRadius: '6px',
          bgcolor: 'background.paper',
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr 1fr',
            md: `repeat(${Math.min(Math.max(facts.length, 1), 4)}, minmax(0, 1fr))`,
          },
          gap: 1,
        }}
      >
        {facts.map(({ label, value }) => (
          <Box key={label} sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              sx={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--ink-4)' }}
            >
              {label}
            </Typography>
            <Typography
              sx={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--ink)',
                overflowWrap: 'anywhere',
              }}
            >
              {value}
            </Typography>
          </Box>
        ))}
      </Paper>

      {steps && steps.length > 0 && (
        <Box
          component="ol"
          sx={{
            m: 0,
            mb: 2,
            pl: 2.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
          }}
        >
          {steps.map((step) => (
            <Typography key={step} component="li" sx={{ fontSize: 13, color: 'var(--ink-2)' }}>
              {step}
            </Typography>
          ))}
        </Box>
      )}

      {notice}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        {primaryAction}
        {secondaryAction}
      </Box>
    </Box>
  );
}
