/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/activation/ActivationSurfacePage.tsx
//
// PURPOSE:
// Canonical renderer for ActivationSurface doctrine.
// This file MUST render the full ActivationSurfaceProps contract.
// No logic. No decisions. No activation state.
//
// Instrumentation:
// - data-testid markers added for doctrine validation & future tests
//

import React from 'react';
import {
  Box,
  Container,
  Stack,
  Typography,
  Divider,
  Button,
} from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

interface Props {
  config: ActivationSurfaceProps;
  onActivate: () => void;
}

export default function ActivationSurfacePage({ config, onActivate }: Props) {
  const {
    identity,
    blindness,
    absenceProof,
    valueAfterActivation,
    momentum,
    commitmentGradient,
    postActivation,
    primaryCTA,
    trust,
  } = config;

  return (
    <Container maxWidth="md" data-testid="activation-surface-page">
      <Stack spacing={6} sx={{ py: 8 }}>

        {/* 1️⃣ Identity */}
        {identity && (
          <Typography
            variant="h2"
            textAlign="center"
            data-testid="activation-identity"
          >
            {identity.title}
          </Typography>
        )}

        {/* 2️⃣ Blindness — HERO (MANDATORY) */}
        <MainCard data-testid="activation-blindness">
          <Typography variant="h4">
            {blindness.content}
          </Typography>
        </MainCard>

        {/* 3️⃣ Ignorance / Absence Proof */}
        {absenceProof && (
          <MainCard data-testid="activation-absence">
            <Typography variant="body1">
              {absenceProof.content}
            </Typography>
          </MainCard>
        )}

        {/* 4️⃣ Irreversible Truth (MANDATORY CONCEPT) */}
        <MainCard data-testid="activation-irreversible-truth">
          <Typography variant="body1">
            Decisions are already being made. Activation only determines
            whether they’re informed.
          </Typography>
        </MainCard>

        {/* 5️⃣ Post-Activation Certainty (Single Outcome) */}
        {valueAfterActivation && (
          <MainCard data-testid="activation-certainty">
            <Typography variant="body1">
              {valueAfterActivation.content}
            </Typography>
          </MainCard>
        )}

        {/* 6️⃣ Momentum / Commitment Gradient (Optional) */}
        {momentum && (
          <MainCard data-testid="activation-momentum">
            {momentum.content}
          </MainCard>
        )}

        {commitmentGradient && (
          <MainCard data-testid="activation-commitment">
            {commitmentGradient.content}
          </MainCard>
        )}

        {/* 7️⃣ Primary CTA + Trust (PLACEMENT IS NON-NEGOTIABLE) */}
        <MainCard data-testid="activation-cta-zone">
          <Stack spacing={3} alignItems="center">
            <Button
              variant="contained"
              size="large"
              fullWidth
              onClick={() => {
                console.log('[ActivationSurfacePage] CTA CLICKED');
                onActivate();
              }}
              data-testid="activation-primary-cta"
            >
              {primaryCTA.label}
            </Button>

            <Divider flexItem />

            <Stack
              spacing={0.5}
              alignItems="center"
              data-testid="activation-trust"
            >
              {trust.bullets.map((line, idx) => (
                <Typography
                  key={idx}
                  variant="caption"
                  color="text.secondary"
                >
                  {line}
                </Typography>
              ))}
            </Stack>
          </Stack>
        </MainCard>

        {/* 8️⃣ Post-Click Expectation (Deterministic System Behavior) */}
        {postActivation && (
          <MainCard data-testid="activation-post-activation">
            {postActivation.content}
          </MainCard>
        )}

      </Stack>
    </Container>
  );
}
