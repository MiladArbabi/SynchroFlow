// apps/frontend/src/components/SyncProgressBanner.tsx
import React from 'react';
import { Alert, AlertTitle, Box, LinearProgress, Typography } from '@mui/material';
import { useIntegration } from 'contexts/IntegrationContext';

/**
 * FT0 sync banner:
 * - Shows while the initial Shopify sync is running.
 * - Uses IntegrationContext as the single source of truth.
 * - Disappears automatically when sync completes or no integration exists.
 */
export const SyncProgressBanner: React.FC = () => {
  const {
   hasIntegrationRecord,
   isSyncComplete,
   syncStatus,
   progress,
 } = useIntegration();

  // statuses that represent "sync is ongoing / not fully done"
  const inProgressStatuses: string[] = [
    'PENDING',
    'SYNCING_PRODUCTS',
    'SYNCING_ORDERS',
    'SYNCING_LINE_ITEMS',
    'SYNCING_INVENTORY',
    'SYNCING_SHOP',
    'COMPLETING'
  ];

  const isInProgress =
    hasIntegrationRecord &&
    !isSyncComplete &&
    inProgressStatuses.includes(syncStatus as string);
  
  if (import.meta.env.DEV) {
    console.debug('[SyncProgressBanner]', {
      hasIntegrationRecord,
      isSyncComplete,
      syncStatus,
      progress,
      isInProgress,
    });
  }

  if (!isInProgress) {
    return null;
  }

  const pct = Number.isFinite(progress?.percentage)
    ? Math.min(Math.max(progress.percentage, 0), 100)
    : 0;

  return (
    <Alert
      severity="info"
      sx={{ mb: 2 }}
      data-testid="sync-progress-banner"
    >
      <AlertTitle>Importing your Shopify data…</AlertTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="body2">
          We’re pulling in your last 90 days of products, orders, and line items.
          You can explore the dashboard while we finish the sync.
        </Typography>

        <Box sx={{ mt: 1 }}>
          <LinearProgress
            variant={pct > 0 && pct < 100 ? 'determinate' : 'indeterminate'}
            value={pct || undefined}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
            <Typography variant="caption">
              Status: {syncStatus || 'PENDING'}
            </Typography>
            {pct > 0 && (
              <Typography variant="caption">
                {pct}% complete
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
    </Alert>
  );
};
