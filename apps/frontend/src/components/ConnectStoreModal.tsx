/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/components/ConnectStoreModal.tsx
import React, { useState, FormEvent, useRef } from 'react';
import { axiosInstance } from 'api/axiosConfig';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Grid,
  Box,
  Typography,
  CircularProgress,
  Paper, // For the cards
  ButtonBase, // To make cards clickable
  Theme,
  InputAdornment,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import IconComponent from './Icon';
import { useAuth } from 'contexts/AuthContext';

// --- Analytics ---
import { useUiEvents } from 'analytics/useUiEvents';

// --- Define our Platform Card (inspired by Berry's SubCard) ---
const PlatformCard = styled(ButtonBase)(({ theme }: { theme: Theme }) => ({
  width: '100%',
  padding: theme.spacing(3),
  textAlign: 'center',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  transition: 'border-color 0.2s',
  '&:hover': {
    borderColor: theme.palette.primary.main,
    backgroundColor: theme.palette.action.hover
  }
}));

// --- Platform definitions ---
type PlatformID = 'shopify' | 'quickbooks' | 'amazon';

const PLATFORMS: { id: PlatformID; name: string; icon: string; requiresInput: boolean }[] = [
  // 'ShopifyLogo' is not a valid Lucide icon, 'Store' is.
  { id: 'shopify', name: 'Shopify', icon: 'Store', requiresInput: true },
  // 'Database' is valid.
  { id: 'quickbooks', name: 'QuickBooks', icon: 'Database', requiresInput: false },
  // 'AmazonLogo' is not valid, 'Package' is.
  { id: 'amazon', name: 'Amazon', icon: 'Package', requiresInput: false }
];

interface ConnectStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectStoreModal: React.FC<ConnectStoreModalProps> = ({ isOpen, onClose }) => {
  /* console.log('[ConnectStoreModal] render', { isOpen }); */
  
  const { emit } = useUiEvents();
  const [shopName, setShopName] = useState('');
  const { accessToken } = useAuth(); 
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformID | null>(null);
  const [syncState, setSyncState] = useState<'form' | 'syncing' | 'error'>('form');
  const [error, setError] = useState('');
  
    /**
   * ANALYTICS: flow correlation
   * Each modal session = one flow_id
   */
  const flowIdRef = useRef<string | null>(null);
  const didNavigateBackRef = useRef(false);
  const hasClosedRef = useRef(false);
  /**
   * ANALYTICS NOTE:
   * MUI Dialog fires onClose twice (button + backdrop).
   * This guard ensures single analytics emission.
   */
  const lastSelectedPlatformRef = useRef<PlatformID | null>(null);
  const lastStepRef = useRef<'platform_selection' | 'details'>('platform_selection');

  /**
   * ANALYTICS CONTRACT
   * ------------------
   * Ensures all integration events share consistent shape
   * → critical for funnel queries in PostHog
   */
  const buildIntegrationPayload = (overrides: Record<string, unknown> = {}) => ({
    flow_id: flowIdRef.current ?? 'missing', // CRITICAL: ties events together
    platform: overrides.platform ?? 'unknown',
    step: overrides.step ?? 'unknown',
    state: overrides.state ?? 'form',
    ts: Date.now(),
    ...overrides,
  });
  
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // AUTH-016: debug log scoped to actual submit, not every render
    console.log('[DEBUG] handleSubmit triggered', { selectedPlatform });
    if (!selectedPlatform) {
      // --- ANALYTICS: invalid submit (no platform selected) ---
      emit('integration.connect.failed', {
        reason: 'no_platform_selected'
      });
      return;
    }

    setSyncState('syncing');
    setError('');

    console.log('[DEBUG] emitting integration.connect.started');
    // --- ANALYTICS: connection started ---
    emit(
      'integration.connect.started',
      buildIntegrationPayload({
        platform: selectedPlatform,
        step: 'details',
      })
    );

    try {
      // Step 1: Call our new BE endpoint
      const params = {
        platform: selectedPlatform,
        ...(selectedPlatform === 'shopify' && { shop: shopName })
      };

      if (selectedPlatform === 'shopify' && !shopName.trim()) {
        // --- ANALYTICS: invalid input ---
        emit('integration.connect.failed', {
          platform: 'shopify',
          reason: 'missing_shop_name'
        });
        return;
      }

      // Add the 'headers' object with the access token
      const { data } = await axiosInstance.get('/api/v1/integrations/oauth/initiate', {
          params,
          headers: {
            Authorization: `Bearer ${accessToken}`
        }
      });

      // Step 2: On success, redirect to the platform's auth URL
      if (data.authorizationUrl) {

        console.log('[DEBUG] emitting integration.connect.redirected');
        // --- ANALYTICS: user redirected to OAuth ---
        emit(
          'integration.connect.redirected',
          buildIntegrationPayload({
            platform: selectedPlatform,
            step: 'redirect',
          })
        );

        /**
         * ANALYTICS CRITICAL:
         * Give PostHog time to flush BEFORE navigation.
         * Without this, success events are lost → funnel corruption.
         */
        setTimeout(() => {
          window.location.href = data.authorizationUrl;
        }, 150);
      }
    } catch (_err) {
      const errorMessage = 'Failed to initiate connection. Please try again.';
      setError(errorMessage);
      setSyncState('form'); // Return to the form

      // --- ANALYTICS: connection failed ---
    emit(
        'integration.connect.failed',
        buildIntegrationPayload({
          platform: selectedPlatform,
          step: 'details',
          error: 'init_failed',
        })
      );
    }
  };

  const resetForm = () => {
    setSelectedPlatform(null);
    setShopName('');
    setError('');
    setSyncState('form');
  };

  // Handle modal close
  const handleClose = () => {

    // Only allow close if not in the middle of syncing
    if (syncState !== 'syncing') {
      
      // --- PREVENT FALSE DROP-OFF AFTER BACK ---
      if (didNavigateBackRef.current) {
        didNavigateBackRef.current = false;
        return;
      }

      // --- PREVENT DOUBLE ANALYTICS (NOT UI) ---
      if (!hasClosedRef.current) {
        hasClosedRef.current = true;

        emit(
          'integration.connect.cancelled',
          buildIntegrationPayload({
            platform: lastSelectedPlatformRef.current ?? 'none',
            step: lastStepRef.current,
            state: syncState,
          })
        );
      }

      // --- RESET ANALYTICS SESSION STATE ---
      lastSelectedPlatformRef.current = null;
      lastStepRef.current = 'platform_selection';
      didNavigateBackRef.current = false;

      setTimeout(() => {
        hasClosedRef.current = false;
      }, 0);

      /**
       * ANALYTICS NOTE:
       * Reset close guard after event loop tick
       * so next modal interaction is tracked correctly.
       */

      onClose();

      // --- RESET FLOW ---
      flowIdRef.current = null;
      /**
       * ANALYTICS:
       * New modal session = new funnel
       */

      setTimeout(resetForm, 300);
    }
  };

  const handleBack = () => {
    // --- ANALYTICS: user stepped back in flow ---
    emit(
      'integration.connect.back',
      buildIntegrationPayload({
        platform: lastSelectedPlatformRef.current,
        step: lastStepRef.current,
        from_step: lastStepRef.current,
        to_step: 'platform_selection',
      })
    );

    setSelectedPlatform(null);
    setError('');

    // reset step tracking
    lastStepRef.current = 'platform_selection';
    didNavigateBackRef.current = true;
  };

  // --- [START POSTHOG] ---
  // New handler to track which platform was selected
  const handlePlatformSelect = (platform: PlatformID, platformName: string) => {
    // --- INIT FLOW ---
    if (!flowIdRef.current) {
      flowIdRef.current = crypto.randomUUID();
      console.info('[analytics] new flow_id', flowIdRef.current);
    }

    setSelectedPlatform(platform);
    lastSelectedPlatformRef.current = platform;

    /**
     * ANALYTICS NOTE:
     * Persist platform selection outside React state to avoid
     * stale closure issues during modal close.
     */

    lastStepRef.current = 'details';
    /**
     * ANALYTICS NOTE:
     * Step must be persisted outside React state
     * to avoid reset before cancel.
     */

    // --- ANALYTICS: platform selected ---
    emit(
      'integration.platform.selected',
      buildIntegrationPayload({
        platform,
        step: 'details',
      })
    );
  };
  // --- [END POSTHOG] ---

  // --- Dynamic Content Rendering ---
  let dialogTitle = 'Connect a Data Source';
  let dialogContent: React.ReactNode;
  let dialogActions: React.ReactNode;

  const platformInfo = selectedPlatform ? PLATFORMS.find(p => p.id === selectedPlatform) : null;

  if (syncState === 'syncing') {
    // --- SYNCING VIEW ---
    dialogTitle = 'Redirecting to Connect...';
    dialogContent = (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
        <CircularProgress />
        <Typography variant="h5" sx={{ mt: 3 }}>
          Please wait...
        </Typography>
        <DialogContentText sx={{ mt: 1 }}>
          We are securely redirecting you to {platformInfo?.name}.
        </DialogContentText>
      </Box>
    );
    dialogActions = (
      <DialogActions sx={{ p: 3 }}>
        <Button disabled fullWidth variant="contained">
          Please wait...
        </Button>
      </DialogActions>
    );
  } else if (selectedPlatform === null) {
    // --- 1. PLATFORM SELECTION GRID ---
    dialogContent = (
      <>
        <DialogContentText sx={{ mb: 3 }}>
          Select a platform to begin your scoped live trial.
        </DialogContentText>
        <Grid container spacing={2}>
          {PLATFORMS.map((platform) => (
            <Grid size={{ xs: 12, sm: 4 }} key={platform.id}>
              {/* --- [START POSTHOG] --- */}
              {/* Updated onClick to use the new tracking handler */}
              <PlatformCard onClick={() => handlePlatformSelect(platform.id, platform.name)}>
              {/* --- [END POSTHOG] --- */}
                <Box>
                  {/* Assuming IconComponent can take a name prop */}
                  <IconComponent name={platform.icon as any} size="xl" />
                  <Typography variant="h6" sx={{ mt: 1 }}>
                    {platform.name}
                  </Typography>
                </Box>
              </PlatformCard>
            </Grid>
          ))}
        </Grid>
      </>
    );
    dialogActions = (
      <DialogActions sx={{ p: 3 }}>
        <Button fullWidth onClick={handleClose} variant="outlined" color="info">
          Cancel
        </Button>
      </DialogActions>
    );
  } else if (selectedPlatform === 'shopify') {
    // --- 2. SHOPIFY INPUT STEP ---
    dialogTitle = 'Connect Shopify';
    dialogContent = (
      <>
        <DialogContentText sx={{ mb: 3 }}>
          Please enter your Shopify store name to continue.
        </DialogContentText>
        <TextField
          autoFocus
          required
          margin="dense"
          id="shop-name"
          label="Shop Name"
          type="text"
          fullWidth
          variant="outlined"
          placeholder="my-store"
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <Typography color="info" sx={{ pl: 0.5 }}>
                  .myshopify.com
                </Typography>
              </InputAdornment>
            )
          }}
        />
        {error && <Typography color="error" variant="body2" sx={{ mt: 2 }}>{error}</Typography>}
      </>
    );
    dialogActions = (
      <DialogActions sx={{ p: 3 }}>
        <Grid container spacing={2} sx={{ width: '100%' }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Button fullWidth onClick={handleBack} variant="outlined" color="info">
              Back
            </Button>
          </Grid>
         <Grid size={{ xs: 12, sm: 4 }}>
            {/* THEME-001: accent orange — not color="primary" (MUI blue) */}
            <Button fullWidth type="submit" variant="contained"
              sx={{ bgcolor: 'var(--accent)', color: '#fff', '&:hover': { bgcolor: 'var(--accent-hover)' } }}>
              Connect
            </Button>
          </Grid>
        </Grid>
      </DialogActions>
    );
  } else {
    // --- 3. OTHER PLATFORMS (NO INPUT) ---
    dialogTitle = `Connect ${platformInfo?.name}`;
    dialogContent = (
      <>
        <DialogContentText>
          You will be redirected to {platformInfo?.name} to authorize the connection.
        </DialogContentText>
        {error && <Typography color="error" variant="body2" sx={{ mt: 2 }}>{error}</Typography>}
      </>
    );
    dialogActions = (
      <DialogActions sx={{ p: 3 }}>
        <Grid container spacing={2} sx={{ width: '100%' }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Button fullWidth onClick={handleBack} variant="outlined" color="info">
              Back
            </Button>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            {/* THEME-001: accent orange — not color="primary" (MUI blue) */}
            <Button fullWidth type="submit" variant="contained"
              sx={{ bgcolor: 'var(--accent)', color: '#fff', '&:hover': { bgcolor: 'var(--accent-hover)' } }}>
              Connect
            </Button>
          </Grid>
        </Grid>
      </DialogActions>
    );
  }

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      data-testid="connect-store-modal-open"
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent>{dialogContent}</DialogContent>
        {dialogActions}
      </form>
    </Dialog>
  );
};
