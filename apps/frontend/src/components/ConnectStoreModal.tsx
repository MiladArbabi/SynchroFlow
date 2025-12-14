/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/components/ConnectStoreModal.tsx
import React, { useState, FormEvent } from 'react';
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

// --- [START POSTHOG] ---
import { usePostHog } from 'posthog-js/react';
// --- [END POSTHOG] ---

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
  const [shopName, setShopName] = useState('');
  const { accessToken } = useAuth(); 
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformID | null>(null);
  const [syncState, setSyncState] = useState<'form' | 'syncing' | 'error'>('form');
  const [error, setError] = useState('');

  // --- [START POSTHOG] ---
  const posthog = usePostHog();
  // --- [END POSTHOG] ---

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPlatform) return;

    setSyncState('syncing');
    setError('');

    // --- [START POSTHOG] ---
    posthog.capture('store_connection_initiated', {
      platform: selectedPlatform,
      // Only include shop_name if it's relevant (for Shopify)
      shop_name: selectedPlatform === 'shopify' ? shopName : undefined
    });
    // --- [END POSTHOG] ---

    try {
      // Step 1: Call our new BE endpoint
      const params = {
        platform: selectedPlatform,
        ...(selectedPlatform === 'shopify' && { shop: shopName })
      };

      // Add the 'headers' object with the access token
      const { data } = await axiosInstance.get('/api/v1/integrations/oauth/initiate', {
          params,
          headers: {
            Authorization: `Bearer ${accessToken}`
        }
      });

      // Step 2: On success, redirect to the platform's auth URL
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      }
    } catch (_err) {
      const errorMessage = 'Failed to initiate connection. Please try again.';
      setError(errorMessage);
      setSyncState('form'); // Return to the form

      // --- [START POSTHOG] ---
      posthog.capture('store_connection_failed', {
        platform: selectedPlatform,
        shop_name: selectedPlatform === 'shopify' ? shopName : undefined,
        error_message: errorMessage
      });
      // --- [END POSTHOG] ---
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
      
      // --- [START POSTHOG] ---
      // Capture a "cancel" event
      posthog.capture('store_connection_cancelled', {
        // This tells us which step they cancelled on
        current_step: selectedPlatform ? PLATFORMS.find(p => p.id === selectedPlatform)?.name : 'platform_selection'
      });
      // --- [END POSTHOG] ---

      onClose();
      setTimeout(resetForm, 300);
    }
  };

  const handleBack = () => {
    setSelectedPlatform(null);
    setError('');
  };

  // --- [START POSTHOG] ---
  // New handler to track which platform was selected
  const handlePlatformSelect = (platform: PlatformID, platformName: string) => {
    setSelectedPlatform(platform);
    posthog.capture('store_platform_selected', {
      platform_id: platform,
      platform_name: platformName
    });
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
            <Button fullWidth type="submit" variant="contained" color="primary">
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
            <Button fullWidth type="submit" variant="contained" color="primary">
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
