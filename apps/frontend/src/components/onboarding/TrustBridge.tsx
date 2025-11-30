//apps/frontend/src/components/onboarding/TrustBridge.tsx
import React from 'react';
import { useTheme } from '@mui/material/styles';
import { Box, Stack, Typography } from '@mui/material';
import { IconLock, IconShieldCheck } from '@tabler/icons-react';

// We can use this as a standalone component or inside a modal
export const TrustBridge = () => {
  const theme = useTheme();

  // Use our new semantic colors from the theme
  const subtleBgColor = theme.palette.mode === 'light' 
    ? theme.palette.grey[50]  // Slate-50
    : theme.palette.grey[700]; // Slate-700
  
  const iconColor = theme.palette.text.secondary; // Slate-500

  return (
    <Box
      sx={{
        p: 2,
        backgroundColor: subtleBgColor,
        borderRadius: 1, // 8px
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      <Stack spacing={1.5}>
        {/* Header */}
        <Stack direction="row" spacing={1.5} alignItems="center">
          <IconLock size={20} color={iconColor} />
          <Typography variant="h5" component="div">
            Your Data is 100% Secure
          </Typography>
        </Stack>
        
        {/* Trust Points List */}
        <Stack spacing={1} sx={{ pl: 3.5 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <IconShieldCheck size={16} color={iconColor} />
            <Typography variant="body2" color="textSecondary">
              **Read-Only Access:** We only read, never write. Your data is yours, always.
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <IconShieldCheck size={16} color={iconColor} />
            <Typography variant="body2" color="textSecondary">
              **Bank-Level Security:** Your credentials are encrypted using 256-bit encryption.
            </Typography>
          </Stack>
        </Stack>
      </Stack>
    </Box>
  );
};