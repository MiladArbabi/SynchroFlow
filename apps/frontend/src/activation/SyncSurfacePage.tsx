// apps/frontend/src/activation/SyncSurfacePage.tsx
//
// PURPOSE:
// FT-0 Sync Surface — host-owned phase gate
// Rendered when integration exists but initial sync is NOT completed.
//
// RULES:
// - No decisions
// - No API calls
// - No polling
// - No side effects
// - Pure renderer only
//

import React from 'react';
import {
  Box,
  Container,
  Stack,
  Typography,
  LinearProgress,
} from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';

interface SyncSurfacePageProps {
  moduleTitle: string;
  syncStatus: string;
  progress: {
    current: number;
    total: number;
    percentage: number;
  };
}

export default function SyncSurfacePage({
  moduleTitle,
  syncStatus,
  progress,
}: SyncSurfacePageProps) {
  return (
    <Container maxWidth="sm" data-testid="sync-surface-page">
      <Stack spacing={6} sx={{ py: 8 }}>

        {/* 1️⃣ Identity */}
        <Typography variant="h2" textAlign="center" data-testid="sync-surface-title">
          {moduleTitle}
        </Typography>

        {/* 2️⃣ Deterministic Sync State */}
        <MainCard>
          <Stack spacing={3}>
            <Typography variant="body1" data-testid="sync-surface-status">
              We’re preparing your data. This is a one-time process.
            </Typography>

            <Box>
              <LinearProgress
                variant="determinate"
                value={progress.percentage}
                data-testid="sync-progress-bar"
              />
              <Typography
                variant="caption"
                display="block"
                textAlign="center"
                sx={{ mt: 1 }}
                data-testid="sync-surface-progress"
              >
                {progress.percentage}% complete
              </Typography>
            </Box>

            <Typography variant="caption" color="text.secondary">
              Status: {syncStatus}
            </Typography>
          </Stack>
        </MainCard>

        {/* 3️⃣ Deterministic Outcome */}
        <MainCard>
          <Typography variant="body2">
            Once syncing finishes, the full experience unlocks automatically.
          </Typography>
        </MainCard>

      </Stack>
    </Container>
  );
}