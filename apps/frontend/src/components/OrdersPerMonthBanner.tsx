/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/components/OrdersPerMonthBanner.tsx
import React, { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  ButtonGroup,
  Typography,
} from '@mui/material';
import { axiosInstance } from 'api/axiosConfig';
import { useAuth } from 'contexts/AuthContext';
import { useDashboardState } from 'contexts/DashboardStateContext';
import { useIntegration } from 'contexts/IntegrationContext';

type OrdersPerMonthSegment =
  | '1-50'
  | '51-200'
  | '201-500'
  | '501-1000'
  | '1000+';

const SEGMENTS: OrdersPerMonthSegment[] = [
  '1-50',
  '51-200',
  '201-500',
  '501-1000',
  '1000+',
];

export const OrdersPerMonthBanner: React.FC = () => {
  const { accessToken } = useAuth();
  const { userState, refetchUserState } = useDashboardState();
  const { syncStatus } = useIntegration();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shopifyConnected = userState?.user.shopify_connected ?? false;
  const currentSegment = userState?.user.orders_per_month_segment ?? null;

  // Only show after initial sync completes, and only if Shopify is connected
  const syncCompleted = syncStatus === 'COMPLETED';

  const shouldShow =
    shopifyConnected &&
    syncCompleted &&
    !currentSegment;

  if (!shouldShow) {
    return null;
  }

  const handleSelect = async (segment: OrdersPerMonthSegment) => {
    if (!accessToken) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await axiosInstance.patch(
        '/api/v1/user-state/state',
        { orders_per_month_segment: segment },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      // Pull fresh user state so everyone sees the updated value
      await refetchUserState();
    } catch (err: any) {
      console.error('[OrdersPerMonthBanner] Failed to update segment', err);
      const msg =
        err?.response?.data?.error ||
        'Failed to save your orders per month segment. Please try again.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Alert
      severity="info"
      sx={{ mb: 2 }}
      data-testid="orders-per-month-banner"
    >
      <AlertTitle>Help us calibrate your insights</AlertTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="body2">
          Roughly how many Shopify orders do you process per month?
          This helps us tune your default dashboards and analytics.
        </Typography>

        <Box sx={{ mt: 1 }}>
          <ButtonGroup
            variant="outlined"
            size="small"
            aria-label="Orders per month selector"
          >
            {SEGMENTS.map((segment) => (
              <Button
                key={segment}
                disabled={isSubmitting}
                onClick={() => handleSelect(segment)}
                data-testid={`orders-per-month-option-${segment}`}
              >
                {segment}
              </Button>
            ))}
          </ButtonGroup>
        </Box>

        {error && (
          <Typography
            variant="caption"
            color="error"
            data-testid="orders-per-month-error"
          >
            {error}
          </Typography>
        )}
      </Box>
    </Alert>
  );
};
