import React from 'react';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';

import { DashboardPageFT1 } from './DashboardPageFT1';
import { DashboardPageFT2 } from './DashboardPageFT2';

export const DashboardPage: React.FC = () => {
  const { phase } = useShopLifecycle();

  if (phase === 'FT2_READY') {
    return <DashboardPageFT2 />;
  }

  return (
     <DashboardPageFT1 />
  );
};