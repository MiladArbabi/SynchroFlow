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
import FulfillmentQueuePage from 'pages/ft2-pages/FulfillmentQueuePage';
import AlertsPage from 'pages/ft2-pages/AlertsPage';
import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';

// NOTE:
// - Never reuse FT1 pages for FT2

export function LifecycleRouteHost() {
  const { phase, readiness, isBooting } = useShopLifecycle();

  console.log('[ROUTE_HOST_RENDER]', {
    phase,
    readiness,
    ts: performance.now(),
  });

  if (phase === 'FT_MINUS_ONE') {
    console.warn('[TRACE_PHASE_FT_MINUS_ONE]', { ts: performance.now() });
  }

  if (phase === 'FT0' || phase === 'FT0_PREPARING') {
    console.warn('[TRACE_PHASE_FT0]', { ts: performance.now() });
  }

  /**
   * 🔥 UI LIFECYCLE MODEL (FINAL)
   * ----------------------------
   * FT_MINUS_ONE → activation
   * FT1 + !ready → loader
   * FT1 + ready → FT1 UI
   * FT2 → FT2 UI
   *
   * NOTE:
   * FT0 is backend-only and NOT observable in UI timeline.
   */
  
  /**
   * ⏳ BOOT LOADER (pre-lifecycle resolution)
   * ----------------------------------------
   * Prevents blank screen while waiting for first backend sync.
   */
  if (isBooting) {
    console.info('[LIFECYCLE_ROUTE_BOOTING]');
    return <EmptyDashboardState />;
  }

  if (phase === 'FT_MINUS_ONE') {
    console.info('[LIFECYCLE_ROUTE_ACTIVATION]', { phase, readiness });

    /**
     * 🔥 PRE-FT0 LOADER (UX FIX)
     * --------------------------
     * Backend FT0 is ingestion-driven and delayed.
     * We must show loader immediately once integration exists.
     *
     * Signal used:
     * - readiness !== null → system has begun backend interaction
     */
    if (readiness !== null) {
      console.warn('[LOADER_MOUNT_PRE_FT0]', {
        phase,
        ts: performance.now(),
      });

      return <EmptyDashboardState />;
    }

    /**
     * F-01 FIX — NO BLANK SCREEN
     * ---------------------------
     * readiness === null means lifecycle has not yet resolved.
     * Previously returned null → blank screen for events 1-24.
     *
     * Fix: show EmptyDashboardState immediately.
     * This covers the gap between OAuth success and first
     * readiness signal arriving from the backend.
     */
    return <EmptyDashboardState />;
  };

  /**
   * ✅ FT0 (initialization phase)
   * ----------------------------
   * Explicit loader while backend prepares system.
   */
  if (phase === 'FT0' || phase === 'FT0_PREPARING') {
    console.info('[LIFECYCLE_ROUTE_FT0]', {
      phase,
      ts: performance.now(),
    });

    console.warn('[LOADER_MOUNT]', {
      phase,
      ts: performance.now(),
    });

    return <EmptyDashboardState />;
  }

  /**
   * ✅ FT1 lifecycle phase (no readiness required)
   * UI must render immediately when lifecycle = FT1
   */
  if (phase === 'FT1' || phase === 'FT1_READY') {

    console.info('[LIFECYCLE_ROUTE_FT1_READY_RENDER]', {
      phase,
      readiness,
      ts: performance.now(),
    });

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

      {/* FULFILLMENT QUEUE */}
      <Route path="/fulfillment/*" element={<FulfillmentQueuePage />} />

      {/* Catch-all → Overview */}
      <Route path="*" element={<Navigate to="/overview" replace />} />

      {/* ALERTS */}
      <Route path="/alerts/*" element={<AlertsPage />} />
    </Routes>
  );
}

  /**
   * F-01 FALLTHROUGH GUARD
   * ----------------------
   * Any unhandled phase during transition must show the loader.
   * Never return null — blank screen destroys operator trust.
   */
  return <EmptyDashboardState />;
}