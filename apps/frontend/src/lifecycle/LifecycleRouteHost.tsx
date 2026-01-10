// apps/frontend/src/lifecycle/LifecycleRouteHost.tsx
//
// LifecycleRouteHost
// ------------------
// Authoritative router for ALL lifecycle phases.
//
// CORE PRINCIPLE:
// - Lifecycle phase decides WHICH PAGES exist
// - Pages themselves are lifecycle-agnostic
// - FT1 and FT2 MUST NOT share the same page
//
// WHY THIS EXISTS:
// - Prevent mixed FT1 + FT2 UI states
// - Avoid additive rendering bugs
// - Ensure clean mount / unmount boundaries
//
// HARD CONTRACTS:
// - FT1_READY → FT1 pages ONLY
// - FT2_READY → FT2 pages ONLY
// - Pages MUST NOT inspect lifecycle
// - Routing is the single source of truth
//
// If this file becomes complex, the architecture is broken.

import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { useShopLifecycle } from './ShopLifecycleContext';

// FT1 pages (diagnostic / onboarding surfaces)
import { DashboardPage } from 'pages/DashboardPage';
import OrdersPage from 'pages/OrdersPage';
import ProductsPage from 'pages/ProductsPage';
import CustomersPage from 'pages/CustomersPage';
import AnalyticsPage from 'pages/AnalyticsPage';
import FinancesPage from 'pages/FinancesPage';

// FT2 pages (observability / governed truth surfaces)
import OrdersFT2Page from 'pages/OrdersFT2Page';
import CustomersFT2Page from 'pages/CustomersFT2Page';
import ProductsFT2Page from 'pages/ProductsFT2Page';
import AnalyticsFT2Page from 'pages/AnalyticsFT2Page';
import FinancesFT2Page from 'pages/FinancesFT2Page';
import DashboardFT2Page from 'pages/DashboardFT2Page';

// NOTE:
// - Never reuse FT1 pages for FT2

export function LifecycleRouteHost() {
  const { phase } = useShopLifecycle();

  // ─────────────────────────────────────────────
  // PRE-FT1 — NO ROUTES MAY EXIST
  // ─────────────────────────────────────────────
  // Activation, syncing, and preparation phases
  // must not mount any application routes.
  if (
    phase === 'FT_MINUS_ONE' ||
    phase === 'FT0_PREPARING' ||
    phase === 'FT0_SYNCING'
  ) {
    return null;
  }

  // ─────────────────────────────────────────────
  // FT1 — DIAGNOSTIC / ONBOARDING PHASE
  // ─────────────────────────────────────────────
  // These pages:
  // - Render FT1 modules only
  // - May show onboarding CTAs
  // - Must never render FT2 observability
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

  // ─────────────────────────────────────────────
  // FT2 — OBSERVABILITY / GOVERNED TRUTH PHASE
  // ─────────────────────────────────────────────
  // Rules:
  // - FT2 pages are DIFFERENT pages
  // - FT1 pages MUST be unmounted
  // - Each module opts-in explicitly
  //
  // This prevents:
  // - Ghost FT1 CTAs
  // - Placeholder FT2 data
  // - Mixed mental models
  if (phase === 'FT2_READY') {
  return (
    <Routes>
      {/* DASHBOARD — FT2 */}
      <Route path="/dashboard" element={<DashboardFT2Page />} />

      {/* ORDERS */}
      <Route path="/orders/*" element={<OrdersFT2Page />} />

      {/* PRODUCTS */}
      <Route path="/products/*" element={<ProductsFT2Page />} />

      {/* CUSTOMERS */}
      <Route path="/customers/*" element={<CustomersFT2Page />} />

      {/* ANALYTICS */}
      <Route path="/analytics/*" element={<AnalyticsFT2Page />} />

      {/* FINANCES */}
      <Route path="/finances/*" element={<FinancesFT2Page />} />
    </Routes>
  );
}


  return null;
}