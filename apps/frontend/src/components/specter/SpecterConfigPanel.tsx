// apps/frontend/src/components/specter/SpecterConfigPanel.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Divider,
  TextField,
  Switch,
  FormControlLabel,
  Stack,
  Button,
  Alert,
} from '@mui/material';
import { useSpecterConfig } from 'contexts/SpecterConfigContext';
import type { SpecterConfigShape } from 'api/specter';

export const SpecterConfigPanel: React.FC = () => {
  const {
    config,
    isLoading,
    isSaving,
    error,
    saveConfig,
  } = useSpecterConfig();

  const [primarySalesChannel, setPrimarySalesChannel] = useState('');
  const [enableOnboardingNudges, setEnableOnboardingNudges] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  // Hydrate local form state whenever config changes
  useEffect(() => {
    if (!config) {
      setPrimarySalesChannel('');
      setEnableOnboardingNudges(true);
      return;
    }

    setPrimarySalesChannel(config.primarySalesChannel ?? '');
    setEnableOnboardingNudges(
      typeof config.enableOnboardingNudges === 'boolean'
        ? config.enableOnboardingNudges
        : true
    );
  }, [config]);

  const handleSave = async () => {
    setLocalError(null);

    const trimmedChannel = primarySalesChannel.trim();
    if (!trimmedChannel) {
      setLocalError('Primary channel is required.');
      return;
    }

    // Merge with existing config to preserve fields like businessStage
    const nextConfig: SpecterConfigShape = {
      ...(config || {}),
      primarySalesChannel: trimmedChannel,
      enableOnboardingNudges,
    };

    try {
      await saveConfig(nextConfig);
    } catch (err: any) {
      // saveConfig already sets context error; this is just a local echo
      setLocalError(err?.message || 'Failed to save configuration.');
    }
  };

  const isBusy = isLoading || isSaving;

  return (
    <Box
      data-testid="specter-config-panel"
      sx={{ mt: 3, maxWidth: 480 }}
    >
      <Typography variant="h6" gutterBottom>
        Specter nudges & onboarding
      </Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Configure how Specter understands your primary sales channel and whether
        it should show onboarding nudges inside the dashboard.
      </Typography>

      <Divider sx={{ mb: 2 }} />

      {(error || localError) && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          data-testid="specter-config-error"
        >
          {localError || error}
        </Alert>
      )}

      <TextField
        fullWidth
        margin="normal"
        label="Primary channel"
        value={primarySalesChannel}
        onChange={(e) => setPrimarySalesChannel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isBusy) {
            e.preventDefault();
            handleSave();
          }
        }}
        disabled={isBusy}
        inputProps={{
          'data-testid': 'specter-primary-channel-input',
          'aria-label': 'Primary channel',
        } as any}
        // Alternatively, you can use InputProps with inputComponent
        InputProps={{
          'aria-label': 'Primary channel',
        }}
      />

      <FormControlLabel
        control={
          <Switch
            checked={enableOnboardingNudges}
            onChange={(e) => setEnableOnboardingNudges(e.target.checked)}
            inputProps={{ role: 'checkbox' }}
          />
        }
        label="Enable onboarding nudges"
      />

      <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
        <Button
          variant="contained"
          color="primary"
          disabled={isBusy}
          onClick={handleSave}
          data-testid="specter-config-save-button"
        >
          {isBusy ? 'Saving…' : 'Save'}
        </Button>
      </Stack>
    </Box>
  );
};
