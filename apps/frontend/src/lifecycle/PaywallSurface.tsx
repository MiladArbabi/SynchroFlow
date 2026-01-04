//apps/frontend/src/lifecycle/PaywallSurface.tsx
import React from 'react';
import { Box, Typography, Button, Paper, Stack } from '@mui/material';

interface PaywallSurfaceProps {
  moduleId: string;
  onUpgrade?: () => void;
}

export function PaywallSurface({ moduleId, onUpgrade }: PaywallSurfaceProps) {

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
            Unlock {moduleId}
          </Typography>

          <Typography variant="body2" color="text.secondary">
             <Button variant="contained" size="large" onClick={onUpgrade}>
              Request access
             </Button>
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