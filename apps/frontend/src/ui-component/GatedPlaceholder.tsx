// apps/frontend/src/ui-component/GatedPlaceholder.tsx
import React from 'react';
import { Box, Button, Typography, Paper } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export interface GatedPlaceholderProps {
  routeName: string;
  missingModules?: string[];
  missingFlags?: string[];
  upgradeRoute?: string; // optional
}

export default function GatedPlaceholder({
  routeName,
  missingModules = [],
  missingFlags = [],
  upgradeRoute,
}: GatedPlaceholderProps) {
  const navigate = useNavigate();

  const handleUpgrade = () => {
    if (upgradeRoute) {
      navigate(upgradeRoute);
    } else {
      // fallback: open account settings or billing page if available
      navigate('/account/settings');
    }
  };

  const handleBack = () => {
    navigate('/dashboard');
  };

  return (
    <Box display="flex" alignItems="center" justifyContent="center" height="100%">
      <Paper elevation={1} sx={{ p: 4, maxWidth: 720 }}>
        <Typography variant="h5" gutterBottom>
          Access required
        </Typography>
        <Typography variant="body1" sx={{ mb: 2 }}>
          The page <strong>{routeName}</strong> requires additional product access.
        </Typography>

        {missingModules.length > 0 && (
          <Typography variant="body2" sx={{ mb: 1 }}>
            You are missing: {missingModules.join(', ')}
          </Typography>
        )}
        {missingFlags.length > 0 && (
          <Typography variant="body2" sx={{ mb: 1 }}>
            Required flags: {missingFlags.join(', ')}
          </Typography>
        )}

        <Box mt={3} display="flex" gap={1}>
          <Button variant="contained" onClick={handleUpgrade} data-testid="gated-upgrade">
            Upgrade / Get access
          </Button>
          <Button variant="outlined" onClick={handleBack} data-testid="gated-back">
            Back to dashboard
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
