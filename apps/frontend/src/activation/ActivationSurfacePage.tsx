/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';
import {
  Container,
  Typography,
  Button,
  Paper,
  useTheme,
  Box,
} from '@mui/material';
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

interface Props {
  config: ActivationSurfaceProps;
  onActivate: () => void;
}

export default function ActivationSurfacePage({ config, onActivate }: Props) {
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

  // Shared visual container style (visuals preserved)
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
      {/* 1️⃣ Identity — isolated */}
      {identity && (
        <Typography
          variant="h4"
          fontWeight={800}
          textAlign="center"
          sx={{ mb: 4, letterSpacing: -0.5 }}
          data-testid="activation-identity"
        >
          {identity.title}
        </Typography>
      )}

      {/* 2️⃣ Core Square Outlet */}
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
        {/* BLINDNESS — dominant, broken (row 1, full width) */}
        <Box sx={{ gridColumn: 'span 3', gridRow: 'span 1' }}>
          <Paper
            elevation={0}
            sx={{
              ...shapeStyle,
              borderLeft: `6px solid ${theme.palette.error.main}`,
            }}
            data-testid="activation-blindness"
          >
            {blindness.content}
          </Paper>
        </Box>

        {/* ABSENCE PROOF — left column (rows 2–3) */}
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
              <Typography variant="body2" fontWeight={500}>
                {absenceProof.content}
              </Typography>
            </Paper>
          </Box>
        )}

        {/* IRREVERSIBLE TRUTH — middle cell (row 2, col 2) */}
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
              align='center'
            >
              Decisions are already being made. Activation only determines
              whether those decisions are informed.
            </Typography>
          </Paper>
        </Box>

        {/* VALUE AFTER ACTIVATION — middle row, right */}
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
                {valueAfterActivation.content}
              </Typography>
            </Paper>
          </Box>
        )}

        {/* CTA — bottom right, escape hatch */}
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

            {/* Trust — must be immediately under CTA */}
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

      {/* 3️⃣ Post-Activation — secondary, visible */}
      {postActivation && (
        <Typography
          variant="caption"
          sx={{
            mt: 4,
            opacity: 0.6,
            textAlign: 'center',
            maxWidth: '80%',
          }}
          data-testid="activation-post"
        >
          {postActivation.content}
        </Typography>
      )}
    </Container>
  );
}
