/**
 * ActivationSurfacePage
 * ---------------------
 * Visual controller for Activation surfaces.
 *
 * Responsibilities (NON-NEGOTIABLE):
 * - Interpret semantic language into visuals
 * - Encode uncertainty, risk, and resolution visually
 * - Maintain strict separation from language configs
 *
 * Explicitly NOT responsible for:
 * - Copy wording
 * - Business logic
 * - Feature behavior
 *
 * This file is the single source of truth for:
 * - Layout
 * - Typography
 * - Status → visual meaning
 */

import React from 'react';
import {
  Container,
  Typography,
  Button,
  Paper,
  useTheme,
  Box,
  Stack,
} from '@mui/material';

import {
  ActivationSurfaceProps,
} from '@lasyncro/shared/src/ui/activation/types';

/* -------------------------------------------------------------------------- */
/* Status → Visual Encoding                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Visual interpretation of semantic status.
 * Language provides the truth; visuals decide how it feels.
 */
type StatusVisual = {
  /** Human-readable label shown to users */
  label: string;

  /** MUI palette reference */
  color: string;

  /** Whether the status deserves visual emphasis */
  emphasis: boolean;
};

/**
 * Canonical status-to-visual map.
 * Any change to how "unknown" or "unverified" feels happens here.
 */
const STATUS_VISUAL_MAP: Record<string, StatusVisual> = {
  unknown: {
    label: 'Unknown',
    color: 'error.main',
    emphasis: true,
  },
  'not-visible': {
    label: 'Not visible',
    color: 'error.main',
    emphasis: true,
  },
  unverified: {
    label: 'Unverified',
    color: 'warning.main',
    emphasis: false,
  },
  'insufficient-data': {
    label: 'Insufficient data',
    color: 'text.secondary',
    emphasis: false,
  },
};

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

interface Props {
  /** Semantic activation configuration */
  config: ActivationSurfaceProps;

  /** Triggered when the user commits to activation */
  onActivate: () => void;
}

export default function ActivationSurfacePage({
  config,
  onActivate,
}: Props) {
  const theme = useTheme();

  const {
    identity,
    blindness,
    absenceProof,
    valueAfterActivation,
    postActivation,
    primaryCTA,
    trust,
  } = config;

  /* ------------------------------------------------------------------------ */
  /* Derived visual state                                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * Resolve visual meaning for blindness status.
   * Fallback ensures resilience against future enum expansion.
   */
  const statusVisual =
    STATUS_VISUAL_MAP[blindness.status] ??
    STATUS_VISUAL_MAP.unknown;

  // Instrumentation: visibility for debugging without polluting UI
  if (import.meta.env.DEV) {
    console.debug('[ActivationSurface]', {
      moduleId: config.moduleId,
      blindness,
      statusVisual,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Shared shape style (structural, not semantic)                              */
  /* ------------------------------------------------------------------------ */

  const shapeStyle = {
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    borderRadius: 4,
    p: { xs: 2, sm: 3 },
    backgroundColor: 'background.default',
    border: `1px solid ${theme.palette.divider}`,
    boxSizing: 'border-box' as const,
    overflow: 'hidden',
  };

  /* ------------------------------------------------------------------------ */
  /* Render                                                                    */
  /* ------------------------------------------------------------------------ */

  return (
    <Container
      maxWidth="sm"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 4,
      }}
      data-testid="activation-surface-page"
    >
      {/* -------------------------------------------------------------------- */}
      {/* 1️⃣ Identity — context, not persuasion                                */}
      {/* -------------------------------------------------------------------- */}

      {identity && (
        <Stack spacing={0.5}>
          <Typography
            variant="h4"
            fontWeight={800}
            textAlign="center"
            data-testid="activation-identity"
          >
            {identity.title}
          </Typography>

          <Typography
            variant="caption"
            fontWeight={100}
            sx={{ mb: 4, letterSpacing: -0.5 }}
          >
            {identity.subtitle}
          </Typography>
        </Stack>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* 2️⃣ Core Square — visual argument engine                               */}
      {/* -------------------------------------------------------------------- */}

      <Box
        sx={{
          width: '100%',
          aspectRatio: '1 / 1',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(3, 1fr)',
          gap: 2,
        }}
      >
        {/* ------------------------------------------------------------------ */}
        {/* BLINDNESS — dominant, unresolved                                   */}
        {/* ------------------------------------------------------------------ */}

        <Box sx={{ gridColumn: 'span 3', gridRow: 'span 1' }}>
          <Paper
            elevation={0}
            sx={{
              ...shapeStyle,
              borderLeft: `6px solid ${theme.palette.error.main}`,
            }}
            data-testid="activation-blindness"
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography variant="body1" fontWeight={700}>
                {blindness.subject}
              </Typography>

              <Typography
                variant="caption"
                sx={{
                  color: statusVisual.color,
                  fontWeight: statusVisual.emphasis ? 600 : 400,
                }}
              >
                {blindness.dimension}: {statusVisual.label}
              </Typography>
            </Box>
          </Paper>
        </Box>

        {/* ------------------------------------------------------------------ */}
        {/* ABSENCE PROOF — consequence, not drama                              */}
        {/* ------------------------------------------------------------------ */}

        {absenceProof && (
          <Box sx={{ gridColumn: 'span 1', gridRow: 'span 2' }}>
            <Paper
              elevation={0}
              sx={{
                ...shapeStyle,
                borderLeft: `4px solid ${theme.palette.error.main}`,
              }}
              data-testid="activation-absence"
            >
              <Typography variant="body2" fontWeight={100}>
                {absenceProof.riskStatement}
              </Typography>
            </Paper>
          </Box>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* IRREVERSIBLE TRUTH — neutral constraint                              */}
        {/* ------------------------------------------------------------------ */}

        <Box sx={{ gridColumn: 'span 1', gridRow: 'span 1' }}>
          <Paper
            elevation={0}
            sx={{
              ...shapeStyle,
              borderLeft: `2px solid ${theme.palette.grey[500]}`,
              backgroundColor: theme.palette.grey[100],
            }}
            data-testid="activation-constraint"
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ lineHeight: 1.3 }}
              align="center"
            >
              Decisions are already being made.
              Activation determines if they’re informed.
            </Typography>
          </Paper>
        </Box>

        {/* ------------------------------------------------------------------ */}
        {/* VALUE AFTER ACTIVATION — resolution                                 */}
        {/* ------------------------------------------------------------------ */}

        {valueAfterActivation && (
          <Box sx={{ gridColumn: 'span 1', gridRow: 'span 1' }}>
            <Paper
              elevation={0}
              sx={{
                ...shapeStyle,
                borderLeft: `3px solid ${theme.palette.success.main}`,
              }}
              data-testid="activation-value"
            >
              <Typography variant="body2" fontWeight={500}>
                {valueAfterActivation.outcome}
              </Typography>
            </Paper>
          </Box>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* CTA ZONE — commitment point                                         */}
        {/* ------------------------------------------------------------------ */}

        <Box sx={{ gridColumn: 'span 2', gridRow: 'span 1' }}>
          <Paper
            elevation={0}
            sx={{
              ...shapeStyle,
              backgroundColor: theme.palette.primary.main,
              color: 'primary.contrastText',
              alignItems: 'center',
              border: 'none',
            }}
            data-testid="activation-cta-zone"
          >
            <Button
              variant="contained"
              color="secondary"
              fullWidth
              onClick={onActivate}
              sx={{ fontWeight: 800, mb: 1, borderRadius: 2 }}
              data-testid="activation-primary-cta"
            >
              {primaryCTA.label}
            </Button>

            {/* Trust signals — anxiety reduction only */}
            {trust.bullets.map((line, idx) => (
              <Typography
                key={idx}
                variant="caption"
                sx={{ opacity: 0.85, fontSize: '0.65rem' }}
                data-testid="activation-trust"
              >
                {line}
              </Typography>
            ))}
          </Paper>
        </Box>
      </Box>

      {/* -------------------------------------------------------------------- */}
      {/* 3️⃣ Post-Activation — de-escalation                                   */}
      {/* -------------------------------------------------------------------- */}

      {postActivation && (
        <Typography
          variant="caption"
          sx={{
            mt: 1,
            opacity: 0.6,
            textAlign: 'center',
            maxWidth: '80%',
          }}
          data-testid="activation-post"
        >
          {postActivation.reflection}
        </Typography>
      )}
    </Container>
  );
}
