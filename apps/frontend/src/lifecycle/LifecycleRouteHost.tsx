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
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useShopLifecycle } from './ShopLifecycleContext';
import { CircularProgress, Box } from '@mui/material';

/**
 * EAGER IMPORTS (FLY-03)
 * ─────────────────────────
 * These three render during early lifecycle phases (FT0, FT_MINUS_ONE, boot)
 * before React.Suspense has settled — they must remain eagerly loaded.
 * Everything else is lazy.
 */
import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';
import SyncAnimationPage from 'activation/SyncAnimationPage';
import ConnectStorePage from 'pages/authentication/ConnectStorePage';

/**
 * LAZY PAGE IMPORTS (FLY-03)
 * ──────────────────────────
 * All app pages are lazy-loaded — they split into separate chunks and
 * are only downloaded when the user navigates to that route.
 *
 * Impact: reduces initial JS download from 2.8MB to ~500KB for new users
 * landing on /login or /register. Subsequent navigation loads chunks on demand.
 *
 * INVARIANT: never convert SyncAnimationPage, ConnectStorePage, or
 * EmptyDashboardState to lazy — they render before Suspense is available.
 */

// FT1 pages
const AhaMomentPage = lazy(() => import('pages/ft1-pages/AhaMomentPage'));
const OrdersPage = lazy(() => import('pages/ft1-pages/OrdersPage'));
const ProductsPage = lazy(() => import('pages/ft1-pages/ProductsPage'));
const CustomersPage = lazy(() => import('pages/ft1-pages/CustomersPage'));
const FinancesPage = lazy(() => import('pages/ft1-pages/FinancesPage'));

// FT2 pages
const AlertsPage = lazy(() => import('pages/ft2-pages/AlertsPage'));
const OrdersFT2Page = lazy(() => import('pages/ft2-pages/OrdersFT2Page'));
const OrderDetailPage = lazy(() => import('pages/ft2-pages/OrderDetailPage'));
const CustomersFT2Page = lazy(() => import('pages/ft2-pages/CustomersFT2Page'));
const ProductsFT2Page = lazy(() => import('pages/ft2-pages/ProductsFT2Page'));
const FinancesFT2Page = lazy(() => import('pages/ft2-pages/FinancesFT2Page'));
const OverviewFT2Page = lazy(() => import('pages/ft2-pages/OverviewFT2Page'));
const OrderFlowPage = lazy(() => import('pages/ft2-pages/OrderFlowPage'));
const ReturnsFT2Page = lazy(() => import('pages/ft2-pages/ReturnsFT2Page'));
const OrdersOutboundPage = lazy(() => import('pages/ft2-pages/OrdersOutboundPage'));
const OrdersInboundPage = lazy(() => import('pages/ft2-pages/OrdersInboundPage'));
const CashFlowPage = lazy(() => import('pages/ft2-pages/CashFlowPage'));
const DemandPage = lazy(() => import('pages/ft2-pages/DemandPage'));
const WmsPage = lazy(() => import('pages/ft2-pages/WmsPage'));
const SuppliersPortalPage = lazy(() => import('pages/ft2-pages/SuppliersPortalPage'));
const FloorPlanningPage = lazy(() => import('pages/ft2-pages/FloorPlanningPage'));
const WmsAnalyticsPage = lazy(() => import('pages/ft2-pages/WmsAnalyticsPage'));
const ShopSettingsPage = lazy(() => import('pages/ft2-pages/ShopSettingsPage'));
const MembersPage = lazy(() => import('pages/ft2-pages/MembersPage'));
const MemberDetailPage = lazy(() => import('pages/ft2-pages/MemberDetailPage'));
const ProblemCenterPage = lazy(() => import('pages/ft2-pages/ProblemCenterPage'));

/**
 * PAGE SUSPENSE FALLBACK
 * ──────────────────────
 * Shown while a lazy page chunk is downloading.
 * Kept minimal — a centred spinner matching the app accent colour.
 * Replace with a skeleton if per-page skeletons are added later.
 */
function PageLoader() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <CircularProgress sx={{ color: 'var(--accent)' }} />
    </Box>
  );
}

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
    const connectParam = params.get('connect');
    // 'success' = direct/reconnect OAuth completion
    // 'app_store' = Shopify App Store install completion (handleShopifyInstall flow)
    // Both mean OAuth just finished — show sync animation, never the manual
    // shop-domain entry screen (Shopify prohibits this for App Store installs).
    if (connectParam === 'success' || connectParam === 'app_store') {
      return <SyncAnimationPage />;
    }
    if (location.pathname !== '/') {
      return <Navigate to="/" replace />;
    }
    return <ConnectStorePage />;
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
    <Suspense fallback={<PageLoader />}>
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
    </Suspense>
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
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Root → canonical Overview */}
        <Route path="/" element={<Navigate to="/overview" replace />} />
        {/* RO — Reality Overview */}
      <Route path="/overview/*" element={<OverviewFT2Page />} />

      {/* ORDERS — specific sub-routes must come before wildcard */}
      <Route path="/orders/flow" element={<OrderFlowPage />} />
      <Route path="/orders/blocked" element={<Navigate to="/orders/flow" replace />} />
      <Route path="/orders/pool" element={<Navigate to="/orders/flow" replace />} />
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
      <Route path="/fulfillment/*" element={<Navigate to="/orders/flow" replace />} />

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
    </Suspense>
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