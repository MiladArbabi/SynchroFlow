// apps/frontend/src/pages/DashboardPage.tsx
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stack, Typography, Paper } from '@mui/material';

import { OnboardingUIActionsContext } from 'contexts/OnboardingUIActionsContext';
import { FT1HeroArrival } from 'components/ft1/FT1HeroArrival';
import { useAuth } from 'contexts/AuthContext';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';

import OrdersModule from '@lasyncro/order-nexus';
import { mapOrdersFt1Props } from './orders/useOrdersFt1Adapter';
import { useOrderNexusAhaAdapter } from 'wiring/orderNexusAhaAdapter';

import FinancesModule from '@lasyncro/finances';
import { mapFinancesFt1Props } from './finances/useFinancesFt1Adapter';
import { useFinancesAhaAdapter } from 'wiring/financesAhaAdapter';

import { AnalyticsModule } from '@lasyncro/analytics';
import { mapAnalyticsFt1Props } from './analytics/useAnalyticsFt1Adapter';
import { useAnalyticsAhaAdapter } from 'wiring/analyticsAhaAdapter';

import { SpecterModule } from '@lasyncro/specter';
import { mapSpecterFt1Props } from './customers/useSpecterFt1Adapter';
import { useSpecterAhaAdapter } from 'wiring/specterAhaAdapter';

import ProductsPage from '@lasyncro/products';
import { mapProductsFt1Props } from './products/useProductsFt1Adapter';
import { useProductsAhaAdapter } from 'wiring/productsAhaAdapter';

interface DashboardPageProps {
  handleSidenavToggle: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const shopId = user?.shop_id;

  // --- FT1 READINESS (SOURCE OF TRUTH) ---
  const readinessQuery = useOnboardingReadiness(!!shopId, shopId);

  const ordersProps = readinessQuery.data
    ? mapOrdersFt1Props(readinessQuery.data)
    : null;
  const financesProps = readinessQuery.data
    ? mapFinancesFt1Props(readinessQuery.data)
    : null;
  const analyticsProps = readinessQuery.data
    ? mapAnalyticsFt1Props(readinessQuery.data)
    : null;
  const specterProps = readinessQuery.data
    ? mapSpecterFt1Props(readinessQuery.data)
    : null;
  const productsProps = readinessQuery.data
    ? mapProductsFt1Props(readinessQuery.data)
    : null;

  const onOrderNexusIntent = useOrderNexusAhaAdapter();
  const onFinancesIntent = useFinancesAhaAdapter();
  const onAnalyticsIntent = useAnalyticsAhaAdapter();
  const onSpecterIntent = useSpecterAhaAdapter();
  const onProductsIntent = useProductsAhaAdapter();

  // --- UI ACTIONS (PASSIVE) ---
  const uiActions = useMemo(
    () => ({
      openModal: (id: string) => {
        console.warn(
          '[DashboardPage] openModal called but dashboard is passive:',
          id
        );
      },
      navigate: (path: string) => navigate(path),
    }),
    [navigate]
  );

  // --- RENDER ---
  return (
    <OnboardingUIActionsContext.Provider value={uiActions}>
      <Stack spacing={4}>
        {shopId && <FT1HeroArrival shopId={shopId} />}

        {/* ================= FOUNDATION STATUS ================= */}
        <Paper elevation={1} sx={{ p: 3 }}>
          <Typography variant="h5" gutterBottom>
            Foundation Status
          </Typography>

          <Stack spacing={3}>
            {ordersProps && (
              <OrdersModule
                {...ordersProps}
                onIntent={onOrderNexusIntent}
              />
            )}

            {productsProps && (
              <ProductsPage
                {...productsProps}
                onIntent={onProductsIntent}
              />
            )}

            {financesProps && (
              <FinancesModule
                {...financesProps}
                onIntent={onFinancesIntent}
              />
            )}
          </Stack>
        </Paper>

        {/* ================= BEHAVIOR & SIGNALS ================= */}
        <Paper elevation={1} sx={{ p: 3 }}>
          <Typography variant="h5" gutterBottom>
            Behavior & Signals
          </Typography>

          <Stack spacing={3}>
            {specterProps && (
              <SpecterModule
                {...specterProps}
                onIntent={onSpecterIntent}
              />
            )}

            {analyticsProps && (
              <AnalyticsModule
                {...analyticsProps}
                onIntent={onAnalyticsIntent}
              />
            )}
          </Stack>
        </Paper>
      </Stack>
    </OnboardingUIActionsContext.Provider>
  );
};
