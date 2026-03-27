/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/EmptyStates/EmptyDashboardState.tsx

import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, LinearProgress, Fade, Paper } from '@mui/material';

export const EmptyDashboardState: React.FC = () => {
  // Loader is lifecycle-driven — no time-based progression
  const progress = 100;

  useEffect(() => {
    console.log('[LOADER_MOUNT]');
    return () => console.log('[LOADER_UNMOUNT]');
  }, []);

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <Fade in timeout={300}>
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            maxWidth: 520,
            width: '100%',
            p: 4,
            textAlign: 'center',
            backgroundColor: 'background.paper',
          }}
        >
          <Typography variant="h5" fontWeight={600} gutterBottom>
            Preparing your dashboard
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 4 }}
          >
            We’re syncing and analyzing your data.
            <br />
            This will only take a moment.
          </Typography>

          <LinearProgress
            variant="indeterminate"
            value={progress}
            sx={{
              height: 6,
              borderRadius: 3,
              backgroundColor: (theme) =>
                theme.palette.action.hover,
              '& .MuiLinearProgress-bar': {
                borderRadius: 3,
              },
            }}
          />
        </Paper>
      </Box>
    </Fade>
  );
};
