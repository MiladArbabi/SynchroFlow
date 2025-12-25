// apps/frontend/src/components/EmptyStates/EmptyDashboardState.tsx

import React from 'react';
import {
  Box,
  Typography,
  Paper,
  LinearProgress
} from '@mui/material';

export function EmptyDashboardState() {
  return (
    <Box
      sx={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2
      }}
    >
      <Paper
        elevation={2}
        sx={{
          maxWidth: 520,
          width: '100%',
          p: 4,
          textAlign: 'center',
          borderRadius: 3
        }}
      >
        {/* Headline */}
        <Typography
          variant="h5"
          fontWeight={600}
          gutterBottom
        >
          Preparing your dashboard
        </Typography>

        {/* Calm explanatory copy */}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 3 }}
        >
          We’re syncing and analyzing your data.
          <br />
          This will only take a moment.
        </Typography>

        {/* Loader line */}
        <Box sx={{ mt: 3 }}>
          <LinearProgress
            sx={{
              height: 6,
              borderRadius: 999,
              backgroundColor: (theme) =>
                theme.palette.action.hover,
              '& .MuiLinearProgress-bar': {
                borderRadius: 999,
              }
            }}
          />
        </Box>
      </Paper>
    </Box>
  );
}
