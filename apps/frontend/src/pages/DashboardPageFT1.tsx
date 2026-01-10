// apps/frontend/src/pages/DashboardPage.tsx
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

import { OnboardingUIActionsContext } from 'contexts/OnboardingUIActionsContext';
import { FT1HeroArrival } from 'components/ft1/FT1HeroArrival';
import { useAuth } from 'contexts/AuthContext';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';

import { OrdersModule } from '@lasyncro/order-nexus';
import { FinancesModule } from '@lasyncro/finances';
import { SpecterModule } from '@lasyncro/specter';
import { ProductsModule } from '@lasyncro/products';
import { AnalyticsModule } from '@lasyncro/analytics';

import { mapOrdersFt1Props } from './orders/useOrdersFt1Adapter';
import { mapFinancesFt1Props } from './finances/useFinancesFt1Adapter';
import { mapSpecterFt1Props } from './customers/useSpecterFt1Adapter';
import { mapProductsFt1Props } from './products/useProductsFt1Adapter';
import { mapAnalyticsFt1Props } from './analytics/useAnalyticsFt1Adapter';

import { useOrderNexusAhaAdapter } from 'wiring/orderNexusAhaAdapter';
import { useFinancesAhaAdapter } from 'wiring/financesAhaAdapter';
import { useSpecterAhaAdapter } from 'wiring/specterAhaAdapter';
import { useProductsAhaAdapter } from 'wiring/productsAhaAdapter';
import { useAnalyticsAhaAdapter } from 'wiring/analyticsAhaAdapter';

export const DashboardPageFT1: React.FC = () => {
  console.warn('[MOUNT] DashboardPageFT1');

  const navigate = useNavigate();
  const { user } = useAuth();
  const shopId = user?.shop_id;

  const readinessQuery = useOnboardingReadiness(!!shopId, shopId);

  const ordersProps = readinessQuery.data && mapOrdersFt1Props(readinessQuery.data);
  const financesProps = readinessQuery.data && mapFinancesFt1Props(readinessQuery.data);
  const specterProps = readinessQuery.data && mapSpecterFt1Props(readinessQuery.data);
  const productsProps = readinessQuery.data && mapProductsFt1Props(readinessQuery.data);
  const analyticsProps = readinessQuery.data && mapAnalyticsFt1Props(readinessQuery.data);

  const orderNexusIntent = useOrderNexusAhaAdapter();
  const financesIntent = useFinancesAhaAdapter();
  const specterIntent = useSpecterAhaAdapter();
  const productsIntent = useProductsAhaAdapter();
  const analyticsIntent = useAnalyticsAhaAdapter();

  const uiActions = useMemo(
    () => ({
      openModal: (id: string) =>
        console.warn('[DashboardPage] openModal (passive)', id),
      navigate: (path: string) => navigate(path),
    }),
    [navigate]
  );

  return (
    <OnboardingUIActionsContext.Provider value={uiActions}>
      <Stack spacing={3}>
        {shopId && <FT1HeroArrival shopId={shopId} />}

        <Grid container spacing={3}>
          {/* === REVENUE FOUNDATION === */}
          <Grid size={{ xs: 12 }}>
            <Paper elevation={0} sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Revenue foundation
                </Typography>

                <Grid container spacing={3}>
                 <Grid size={{ xs: 12, md: 6 }}>
                   {ordersProps && (
                     <OrdersModule
                       {...ordersProps}
                       onIntent={orderNexusIntent}
                     />
                   )}
                 </Grid>
              
                 <Grid size={{ xs: 12, md: 6 }}>
                   {financesProps && (
                     <FinancesModule
                       {...financesProps}
                       onIntent={financesIntent}
                     />
                   )}
                 </Grid>
               </Grid>
              </Stack>
            </Paper>
          </Grid>

          {/* === DATA & SIGNALS === */}
          <Grid size={{ xs: 12 }}>
            <Paper elevation={0} sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Data & signals
                </Typography>
                
                <Grid container spacing={3}>
                 <Grid size={{ xs: 12, md: 6 }}>
                   {productsProps && (
                     <ProductsModule
                       {...productsProps}
                       onIntent={productsIntent}
                     />
                   )}
                 </Grid>
              
                 <Grid size={{ xs: 12, md: 6 }}>
                   {specterProps && (
                     <SpecterModule
                       {...specterProps}
                       onIntent={specterIntent}
                     />
                   )}
                 </Grid>
               </Grid>
              </Stack>
            </Paper>
          </Grid>

          {/* === INSIGHTS (OPTIONAL / FUTURE) === */}
          {analyticsProps && (
            <Grid size={{ xs: 12 }}>
              <Paper elevation={0} sx={{ p: 3 }}>
                <Stack spacing={2}>
                  <Typography variant="subtitle1" fontWeight={600}>
                    Insights
                  </Typography>

                  <AnalyticsModule
                    {...analyticsProps}
                    onIntent={analyticsIntent}
                  />
                </Stack>
              </Paper>
            </Grid>
          )}
        </Grid>
      </Stack>
    </OnboardingUIActionsContext.Provider>
  );
};