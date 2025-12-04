// apps/frontend/src/components/specter/SpecterOnboardingBanner.tsx
import React from 'react';
import { Alert, AlertTitle, Button, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useSpecterConfig } from 'contexts/SpecterConfigContext';

export const SpecterOnboardingBanner: React.FC = () => {
  const navigate = useNavigate();
  const { config, shouldShowOnboardingNudges, saveConfig } = useSpecterConfig();

  if (!shouldShowOnboardingNudges) {
    return null;
  }

  const primaryChannel = config?.primarySalesChannel || 'your main storefront';

  const handleDismiss = async () => {
    const nextConfig = {
      businessStage: config?.businessStage ?? 'survival',
      primarySalesChannel: config?.primarySalesChannel ?? '',
      enableOnboardingNudges: false
    };

    await saveConfig(nextConfig);
  };

  const handleConfigure = () => {
    navigate('/account/settings');
  };

  return (
    <Alert
      severity="info"
      sx={{ mb: 2 }}
      data-testid="specter-onboarding-banner"
      action={
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            onClick={handleConfigure}
            data-testid="specter-onboarding-configure"
          >
            Configure
          </Button>
          <Button
            size="small"
            onClick={handleDismiss}
            data-testid="specter-onboarding-dismiss"
          >
            Dismiss
          </Button>
        </Stack>
      }
    >
      <AlertTitle>Specter is ready to help</AlertTitle>
      <Typography variant="body2">
        We’ll start by watching <strong>{primaryChannel}</strong> and nudging you
        when there are cash, inventory, or margin opportunities.
        You can fine-tune this any time in Account Settings → Specter.
      </Typography>
    </Alert>
  );
};
