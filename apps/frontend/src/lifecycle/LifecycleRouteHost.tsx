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
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useShopLifecycle } from './ShopLifecycleContext';

// FT1 pages (diagnostic / onboarding surfaces)
import AhaMomentPage from 'pages/ft1-pages/AhaMomentPage';
import OrdersPage from 'pages/ft1-pages/OrdersPage';
import ProductsPage from 'pages/ft1-pages/ProductsPage';
import CustomersPage from 'pages/ft1-pages/CustomersPage';
import FinancesPage from 'pages/ft1-pages/FinancesPage';
import WelcomePage from 'pages/onboarding/WelcomePage';
import AlertsPage from 'pages/ft2-pages/AlertsPage';

// FT2 pages (observability / governed truth surfaces)
import OrdersFT2Page from 'pages/ft2-pages/OrdersFT2Page';
import OrderDetailPage from 'pages/ft2-pages/OrderDetailPage';
import CustomersFT2Page from 'pages/ft2-pages/CustomersFT2Page';
import ProductsFT2Page from 'pages/ft2-pages/ProductsFT2Page';
import FinancesFT2Page from 'pages/ft2-pages/FinancesFT2Page';
import OverviewFT2Page from 'pages/ft2-pages/OverviewFT2Page';
import FulfillmentQueuePage from 'pages/ft2-pages/FulfillmentQueuePage';
import BlockedOrdersPage from 'pages/ft2-pages/BlockedOrdersPage';
import ReleaseQueuePage from 'pages/ft2-pages/ReleaseQueuePage';
import ReturnsFT2Page from 'pages/ft2-pages/ReturnsFT2Page';
import OrdersOutboundPage from 'pages/ft2-pages/OrdersOutboundPage';
import OrdersInboundPage from 'pages/ft2-pages/OrdersInboundPage';
import CashFlowPage from 'pages/ft2-pages/CashFlowPage';
import DemandPage from 'pages/ft2-pages/DemandPage';

import WmsPage from 'pages/ft2-pages/WmsPage';
import SuppliersPortalPage from 'pages/ft2-pages/SuppliersPortalPage';
import FloorPlanningPage from 'pages/ft2-pages/FloorPlanningPage';
import WmsAnalyticsPage from 'pages/ft2-pages/WmsAnalyticsPage';

import ShopSettingsPage from 'pages/ft2-pages/ShopSettingsPage';
import MembersPage from 'pages/ft2-pages/MembersPage';
import MemberDetailPage from 'pages/ft2-pages/MemberDetailPage';
import ProblemCenterPage from 'pages/ft2-pages/ProblemCenterPage';

import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';
import SyncAnimationPage from 'activation/SyncAnimationPage';

// NOTE:
// - Never reuse FT1 pages for FT2

export function LifecycleRouteHost() {
  const { phase, readiness, isBooting } = useShopLifecycle();
  const location = useLocation();

  console.log('[ROUTE_HOST_RENDER]', {
    phase,
    readiness,
    ts: performance.now(),
  });

  // FT0 must be checked BEFORE FT_MINUS_ONE.
  // After OAuth, phase briefly stays FT_MINUS_ONE on the client
  // until polling catches up. Checking FT0 first ensures SyncAnimationPage
  // renders immediately once the backend confirms FT0.
  if (phase === 'FT0' || phase === 'FT0_PREPARING') {
    console.info('[LIFECYCLE_ROUTE_FT0]', { phase, ts: performance.now() });
    return <SyncAnimationPage />;
  }

  // FT_MINUS_ONE handled — renders WelcomePage
  if (phase === 'FT_MINUS_ONE') {
    // OAuth just completed — backend hasn't written FT0 snapshot yet
    // but connect=success signals we're in the sync window.
    // Show SyncAnimationPage immediately rather than flashing WelcomePage.
    const params = new URLSearchParams(location.search);
    if (params.get('connect') === 'success') {
      return <SyncAnimationPage />;
    }
    if (location.pathname !== '/') {
      return <Navigate to="/" replace />;
    }
    return <WelcomePage />;
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
      // Aha moment owns the /overview route in FT1
      <Route path="/overview/*" element={<AhaMomentPage />} />

      {/* ORDERS */}
      <Route path="/orders/*" element={<OrdersPage />} />

      {/* ORDERS — OUTBOUND (shipped + tracking) */}
      <Route path="/orders/outbound" element={<OrdersOutboundPage />} />

      {/* ORDERS — INBOUND (WMS receiving) */}
      <Route path="/orders/inbound" element={<OrdersInboundPage />} />

      {/* PRODUCTS */}
      <Route path="/inventory/*" element={<ProductsPage />} />

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

      {/* ORDERS — specific sub-routes must come before wildcard */}
      <Route path="/orders/blocked" element={<BlockedOrdersPage />} />
      <Route path="/orders/pool" element={<ReleaseQueuePage />} />
      <Route path="/orders/outbound" element={<OrdersOutboundPage />} />
      <Route path="/orders/inbound" element={<OrdersInboundPage />} />
      <Route path="/orders/:orderId" element={<OrderDetailPage />} />
      <Route path="/orders/*" element={<OrdersFT2Page />} />

      {/* PRODUCTS */}
      <Route path="/inventory/*" element={<ProductsFT2Page />} />

      {/* CUSTOMERS */}
      <Route path="/customers/*" element={<CustomersFT2Page />} />

      {/* FINANCES */}
      <Route path="/finances/*" element={<FinancesFT2Page />} />

      {/* FULFILLMENT QUEUE */}
      <Route path="/fulfillment/*" element={<FulfillmentQueuePage />} />

      {/* ALERTS */}
      <Route path="/alerts/*" element={<AlertsPage />} />

      {/* RETURNS */}
      <Route path="/returns/*" element={<ReturnsFT2Page />} />

      {/* CASH FLOW */}
      <Route path="/cashflow/*" element={<CashFlowPage />} />

      {/* DEMAND */}
      <Route path="/demand/*" element={<DemandPage />} />

      {/* WMS */}
      {/* /wms/analytics must precede /wms/* — wildcard would shadow it otherwise */}
      <Route path="/wms/analytics" element={<WmsAnalyticsPage />} />
      <Route path="/wms/*" element={<WmsPage />} />

      {/* SUPPLIERS PORTAL */}
      <Route path="/suppliers-portal/*" element={<SuppliersPortalPage />} />

      {/* FLOOR PLANNING */}
      <Route path="/floor-planning/*" element={<FloorPlanningPage />} />

      {/* PROBLEM-CENTER */}
      <Route path="/problem-center/*" element={<ProblemCenterPage />} />

      {/* SHOP SETTINGS */}
      <Route path="/settings/*" element={<ShopSettingsPage />} />
      
      {/* TEAM — member & role management (WM-31) */}
      <Route path="/team/:userId" element={<MemberDetailPage />} />
      <Route path="/team/*" element={<MembersPage />} />

      {/* Catch-all → Overview */}
      <Route path="*" element={<Navigate to="/overview" replace />} />
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