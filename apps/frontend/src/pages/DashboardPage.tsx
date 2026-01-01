// apps/frontend/src/pages/DashboardPage.tsx
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingUIActionsContext } from 'contexts/OnboardingUIActionsContext';
import { FT1HeroArrival } from 'components/ft1/FT1HeroArrival';
import { useAuth } from 'contexts/AuthContext';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import MainCard from 'ui-component/cards/MainCard';
import { Typography } from '@mui/material';

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
  const readinessQuery = useOnboardingReadiness(
    !!shopId,
    shopId
  );

  const platformModule = readinessQuery.data?.modules.find(
    m => m.moduleId === 'platform'
  );

  const ordersProps = readinessQuery.data
    ? mapOrdersFt1Props(readinessQuery.data)
    : null;

  const onOrderNexusIntent = useOrderNexusAhaAdapter();

  const financesProps = readinessQuery.data
    ? mapFinancesFt1Props(readinessQuery.data)
    : null;

  const onFinancesIntent = useFinancesAhaAdapter();

  const analyticsProps = readinessQuery.data
  ? mapAnalyticsFt1Props(readinessQuery.data)
  : null;

  const onAnalyticsIntent = useAnalyticsAhaAdapter();

  const specterProps = readinessQuery.data
  ? mapSpecterFt1Props(readinessQuery.data)
  : null;

  const onSpecterIntent = useSpecterAhaAdapter();

  const productsProps = readinessQuery.data
  ? mapProductsFt1Props(readinessQuery.data)
  : null;

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
      <div>
        {shopId && <FT1HeroArrival shopId={shopId} />}
        {/* === FT1 DIAGNOSTICS (READ-ONLY) === */}
        {platformModule && (
          <MainCard title={platformModule.displayName}>
            {import.meta.env.DEV && (
              console.info('[FT1][Dashboard] Platform diagnostic rendered', {
                shopId,
                isReady: platformModule.isReady,
              })
            )}

            <Typography variant="body2" color="text.secondary">
              {platformModule.tasks?.[0]?.label}
            </Typography>
          </MainCard>
        )}

        {/* === ORDER-NEXUS FT1 DIAGNOSTICS === */}
        {ordersProps && (
          <OrdersModule
            {...ordersProps}
            onIntent={onOrderNexusIntent}
          />
        )}

        {specterProps && (
            <SpecterModule
              {...specterProps}
              onIntent={onSpecterIntent}
            />
        )}

        {productsProps && (
          <ProductsPage {...productsProps}
           onIntent={onProductsIntent}
          />
        )}

        {analyticsProps && (
          <AnalyticsModule
            {...analyticsProps}
            onIntent={onAnalyticsIntent}
          />
        )}

        {financesProps && (
          <FinancesModule
            {...financesProps}
            onIntent={onFinancesIntent}
          />
        )}

      </div>
    </OnboardingUIActionsContext.Provider>
  );
};
