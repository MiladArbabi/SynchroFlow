//apps/frontend/src/lifecycle/PaywallSurface.tsx
import React from 'react';
import { Box, Typography, Button, Paper, Stack } from '@mui/material';

interface PaywallSurfaceProps {
  scopeId: string;
  onUpgrade?: () => void;
}

export function PaywallSurface({ scopeId, onUpgrade }: PaywallSurfaceProps) {

  return (
    <Box
      sx={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 4,
      }}
      data-testid="paywall-surface"
    >
      <Paper
        elevation={0}
        sx={{
          maxWidth: 420,
          p: 4,
          textAlign: 'center',
          borderRadius: 3,
        }}
      >
        <Stack spacing={2}>
          <Typography variant="h5" fontWeight={800}>
            Unlock {scopeId}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            This module is available on a paid plan.
            Upgrade to continue.
          </Typography>

          <Button
            variant="contained"
            size="large"
            onClick={onUpgrade}
            sx={{ fontWeight: 700 }}
          >
            Upgrade plan
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}