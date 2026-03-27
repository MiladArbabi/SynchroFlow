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
import { Routes, Route, Navigate } from 'react-router-dom';
import { useShopLifecycle } from './ShopLifecycleContext';

// FT1 pages (diagnostic / onboarding surfaces)
import OrdersPage from 'pages/ft1-pages/OrdersPage';
import ProductsPage from 'pages/ft1-pages/ProductsPage';
import CustomersPage from 'pages/ft1-pages/CustomersPage';
import FinancesPage from 'pages/ft1-pages/FinancesPage';

// FT2 pages (observability / governed truth surfaces)
import OrdersFT2Page from 'pages/ft2-pages/OrdersFT2Page';
import CustomersFT2Page from 'pages/ft2-pages/CustomersFT2Page';
import ProductsFT2Page from 'pages/ft2-pages/ProductsFT2Page';
import FinancesFT2Page from 'pages/ft2-pages/FinancesFT2Page';
import OverviewFT2Page from 'pages/ft2-pages/OverviewFT2Page';

// NOTE:
// - Never reuse FT1 pages for FT2

export function LifecycleRouteHost() {
  const { phase } = useShopLifecycle();

  /**
   * ✅ FT0 — SYSTEM SYNC / PREPARATION PHASE
   *
   * MUST render visible UI.
   * Blank screen here = critical UX failure.
   */
  if (
    phase === 'FT_MINUS_ONE' ||
    phase === 'FT0' ||
    phase === 'FT0_PREPARING' ||
    phase === 'FT0_SYNCING'
  ) {

    console.info('[LIFECYCLE_ROUTE_FT0_RENDER]', {
      phase,
      ts: performance.now(),
    });
    return (
      <div style={{ padding: 24 }}>
        <h3>Setting up your workspace…</h3>

        {phase === 'FT0_SYNCING' && (
          <p>Syncing your data from Shopify…</p>
        )}

        {phase === 'FT0_PREPARING' && (
          <p>Finalizing your data…</p>
        )}

        {phase === 'FT_MINUS_ONE' && (
          <p>Waiting for activation…</p>
        )}

        <div style={{ marginTop: 16, fontSize: 12, opacity: 0.6 }}>
          <strong>Phase:</strong> {phase}
        </div>
      </div>
    );
  }

  /**
   * ✅ FT1 lifecycle phase (no readiness required)
   * UI must render immediately when lifecycle = FT1
   */
  if (phase === 'FT1' || phase === 'FT1_READY') {
  return (
    <Routes>
      {/* Root → canonical Overview */}
      <Route path="/" element={<Navigate to="/overview" replace />} />

      /**
        * FT1 MUST NEVER RENDER FT2 PAGES
        * --------------------------------
        * Using FT2 pages here causes:
        * - crashes (missing FT2 contracts)
        * - mixed lifecycle UI
        */
        <Route path="/overview/*" element={<OrdersPage />} />

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