/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/activation/ActivationSurfacePage.tsx
import React from 'react';
import {
  Box,
  Container,
  Stack,
  Typography,
  Divider,
  Button
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
    primaryCTA,
    trust
  } = config;

  return (
    <Container maxWidth="md">
      <Stack spacing={6} sx={{ py: 8 }}>

        {/* Identity */}
        {identity && (
          <Typography variant="h2" textAlign="center">
            {identity.title}
          </Typography>
        )}

        {/* Blindness — HERO */}
        <MainCard>
          <Typography variant="h4">
            {blindness.content}
          </Typography>
        </MainCard>

        {/* Supporting Proofs */}
        <Stack spacing={3}>
          {absenceProof && (
            <MainCard>
              <Typography variant="body1">
                {absenceProof.content}
              </Typography>
            </MainCard>
          )}

          {valueAfterActivation && (
            <MainCard>
              <Typography variant="body1">
                {valueAfterActivation.content}
              </Typography>
            </MainCard>
          )}
        </Stack>

        {/* Conversion Zone */}
        <MainCard>
          <Stack spacing={3} alignItems="center">
            <Button
              variant="contained"
              size="large"
              fullWidth
              onClick={onActivate}
            >
              {primaryCTA.label}
            </Button>

            <Divider flexItem />

            <Stack spacing={0.5} alignItems="center">
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

      </Stack>
    </Container>
  );
}
