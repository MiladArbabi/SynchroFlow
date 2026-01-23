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
import { Routes, Route, Navigate } from 'react-router-dom';
import { useShopLifecycle } from './ShopLifecycleContext';

// FT1 pages (diagnostic / onboarding surfaces)
import OrdersPage from 'pages/OrdersPage';
import ProductsPage from 'pages/ProductsPage';
import CustomersPage from 'pages/CustomersPage';
import FinancesPage from 'pages/FinancesPage';

// FT2 pages (observability / governed truth surfaces)
import OrdersFT2Page from 'pages/OrdersFT2Page';
import CustomersFT2Page from 'pages/CustomersFT2Page';
import ProductsFT2Page from 'pages/ProductsFT2Page';
import FinancesFT2Page from 'pages/FinancesFT2Page';
import OverviewFT2Page from 'pages/OverviewFT2Page';

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
    /**
     * FT_MINUS_ONE / FT0:
     * - Routes MUST exist so ShopLifecycleGate can resolve moduleId
     * - Pages MUST NOT render
     * - ActivationSurface owns rendering
     */
    return (
      <Routes>
        <Route path="/trust/*" element={null} />
        <Route path="*" element={null} />
      </Routes>
    );
  }

  // ─────────────────────────────────────────────
  // FT1 — DIAGNOSTIC / ONBOARDING PHASE
  // ─────────────────────────────────────────────
  // These pages:
  // - Render FT1 modules only
  // - May show onboarding CTAs
  // - Must never render FT2 observability 
  // 
  // NOTE:
  // We reuse OverviewFT2Page here intentionally:
  // It is read-only
  // It does not depend on FT2-only data
  // Trust/orders will naturally render as — in FT1
  // This avoids duplicating an “OverviewFT1Page”
  if (phase === 'FT1_READY') {
  return (
    <Routes>
      {/* Root → canonical Overview */}
      <Route path="/" element={<Navigate to="/overview" replace />} />

      {/* RO — Reality Overview (FT1 surface) */}
      <Route path="/overview/*" element={<OverviewFT2Page />} />

      {/* ORDERS */}
      <Route path="/orders/*" element={<OrdersPage />} />

      {/* PRODUCTS */}
      <Route path="/products/*" element={<ProductsPage />} />

      {/* CUSTOMERS */}
      <Route path="/customers/*" element={<CustomersPage />} />

      {/* FINANCES */}
      <Route path="/finances/*" element={<FinancesPage />} />

      {/* Catch-all → Overview */}
      <Route path="*" element={<Navigate to="/overview" replace />} />
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
      {/* Root → canonical Overview */}
      <Route path="/" element={<Navigate to="/overview" replace />} />

      {/* RO — Reality Overview */}
      <Route path="/overview/*" element={<OverviewFT2Page />} />

      {/* ORDERS */}
      <Route path="/orders/*" element={<OrdersFT2Page />} />

      {/* PRODUCTS */}
      <Route path="/products/*" element={<ProductsFT2Page />} />

      {/* CUSTOMERS */}
      <Route path="/customers/*" element={<CustomersFT2Page />} />

      {/* FINANCES */}
      <Route path="/finances/*" element={<FinancesFT2Page />} />

      {/* Catch-all → Overview */}
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}

  return null;
}