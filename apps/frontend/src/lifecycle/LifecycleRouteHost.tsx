import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { useShopLifecycle } from './ShopLifecycleContext';

import { DashboardPage } from 'pages/DashboardPage';
import OrdersPage from 'pages/OrdersPage';
import ProductsPage from 'pages/ProductsPage';
import CustomersPage from 'pages/CustomersPage';
import AnalyticsPage from 'pages/AnalyticsPage';
import FinancesPage from 'pages/FinancesPage';

export function LifecycleRouteHost() {
  const { phase } = useShopLifecycle();

  // 🔒 FT_MINUS_ONE + FT0 → NO ROUTES EXIST
  if (phase === 'FT_MINUS_ONE' || phase === 'FT0_PREPARING' || phase === 'FT0_SYNCING') {
    return null;
  }

  // 🔵 FT1 routes
  if (phase === 'FT1_READY') {
    return (
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/orders/*" element={<OrdersPage />} />
        <Route path="/products/*" element={<ProductsPage />} />
        <Route path="/customers/*" element={<CustomersPage />} />
        <Route path="/analytics/*" element={<AnalyticsPage />} />
        <Route path="/finances/*" element={<FinancesPage />} />
      </Routes>
    );
  }

  // 🟣 FT2 routes (explicit later)
  if (phase === 'FT2_READY') {
    return null; // intentionally empty for now
  }

  return null;
}