# UI Blueprint — Current Frontend Implementation (LaSyncro)

**Audience:** engineers, product managers, and designers working on FT0 → FT1 UI for OrderNexus, SKU-OS, Specter, and InsightCore.
**Tone:** professional, structured, actionable.

---

## Executive summary

The LaSyncro frontend is a React + MUI (v5) monorepo app (Vite) using a modular architecture: global providers (Auth, Entitlements, Integration, DashboardState), a panel-based `Layout`, a widget registry for dashboard composition, and an FT0-focused onboarding flow (FT0 state machine). The design system is centralized under `src/themes` and widgets live under `src/components/widgets`. Onboarding readiness and module gating are driven by backend signals surfaced via `EntitlementsContext` and `DashboardStateContext`. The UI is production-ready for FT0: core dashboard, onboarding modals (connect + sync), specter endpoints, widget shells, and initial entitlements gating. No module-specific UI (OrderNexus, SKU-OS, Specter, InsightCore) has been fully implemented yet — work focuses on wiring, contracts, and readiness signals.

---

# Table of contents

1. Codebase entry points & key files
2. High-level architecture & runtime flow
3. Theme & styling system
4. Layout & navigation (Sidenav / panels)
5. Contexts & global state (Auth, Entitlements, Integration, DashboardState)
6. FT0 onboarding state machine and UX patterns
7. Widget system — registry, shells, and layout
8. Module gating & entitlements integration
9. APIs (frontend ↔ backend) used by UI flows
10. Tests & developer tooling coverage
11. Gaps, risks, and constraints for FT0→FT1 UI implementation
12. Actionable roadmap / recommended next steps (with priorities & small patches)

---

# 1 — Codebase entry points & key files (quick map)

Root: `apps/frontend/src`

* App / layout:

  * `App.tsx` — app bootstrap (providers, router).
  * `main.tsx` — Vite entry.
  * `Layout.tsx` — top-level panel layout using `react-resizable-panels`.
  * `layouts/AppLayout/SidenavContent.tsx` — side navigation rendering and entitlement filtering.
  * `routes.tsx` — route definitions + entitlement metadata.

* Theming:

  * `themes/index.tsx` — Theme provider composition (createTheme, overrides, custom palettes).
  * `themes/*` — palette, typography, overrides, custom-shadows.

* Providers / contexts:

  * `contexts/AuthContext.tsx`
  * `contexts/EntitlementsContext.tsx`
  * `contexts/IntegrationContext.tsx`
  * `contexts/DashboardStateContext.tsx`

* Onboarding:

  * `onboarding/dispatchOnboardingAction.ts` — adapter to execute backend onboarding actions in the UI.
  * `types/onboarding.ts` — FT0 phase enum.

* Dashboard & widgets:

  * `pages/DashboardPage.tsx` — core dashboard page, FT0 logic + modal triggers + `WidgetLayoutWithRegistry`.
  * `components/DashboardStateManager/DashboardStateManager.tsx` — decides skeleton / empty / widgets.
  * `components/widgets/*` — registry, widget implementations, `EnhancedWidgetShell`.
  * `components/EmptyStates/EmptyDashboardState.tsx`
  * `components/ConnectStoreModal.tsx`, `DataSyncingModal.tsx`, `ConnectStoreBanner.tsx`.

* Specter / module light UI:

  * Minimal routes/controllers exist; specter UI not yet implemented beyond API endpoints server-side. Frontend has the wiring to show onboarding nudges (e.g., commented `SpecterOnboardingBanner`).

---

# 2 — High-level architecture & runtime flow

1. **Providers boot** in `App.tsx`: Auth → Entitlements → DashboardState → Integration → Theme.
2. **Auth** rehydrates session from `localStorage`. When authenticated, contexts fetch:

   * `Entitlements` (`/api/v1/entitlements/me`) → modules & flags
   * `DashboardState` (`/api/v1/user-state/state`) → user state (detected_mode, shopify_connected)
   * `Integration` (`/api/v1/integrations/sync-status`) → sync state & progress
3. `Layout` renders Sidenav (filtered by entitlements) + DashboardPage area.
4. `DashboardPage` derives FT0 phase from Integration/Modal state and drives:

   * Connect modal (pre-flight + OAuth)
   * Sync modal (simulated progress UX)
   * DashboardStateManager -> decides skeleton or widget layout.
5. `WidgetLayoutWithRegistry` constructs widgets via `useWidgetRegistry()` which combines `WIDGET_REGISTRY` and entitlement checks to return allowed widgets. Each widget is wrapped with `EnhancedWidgetShell`.
6. Onboarding & module readiness signals are surfaced by the backend; `EntitlementsContext` gating decides which routes/widgets are visible.

---

# 3 — Theme & styling system

* **MUI v5** is used with `createTheme` and `ThemeProvider` in `themes/index.tsx`.
* Supports **light/dark palettes**, CSS vars (via `cssVariables`), theme overrides (`themes/overrides`), typography and custom shadows.
* `EnhancedWidgetShell` creates an **inverted light-card theme** inside dark mode for "light islands".
* Theme options are configured from `useConfig()` (borderRadius, fontFamily, presetColor).
* Styling conventions:

  * Heavy use of `sx` prop for local styles.
  * Styled components for re-usable cards (e.g., `PlatformCard` in `ConnectStoreModal`).

**Implication:** Theme is centralized and flexible. Widgets should rely on theme tokens (palette, spacing) and prefer `sx` for per-component overrides.

---

# 4 — Layout & navigation

* `Layout.tsx` uses `react-resizable-panels` to create a two-panel layout:

  * Left: `Sidenav` (collapsible)
  * Right: `DashboardPage` / Outlet
* `SidenavContent.tsx`:

  * Uses `EntitlementsContext` to filter `routes` via `filterRoutesByEntitlements`.
  * Uses `SimpleBar` for scroll area and renders `MenuList`.
  * Accepts `isConnected` & `onOpenModal` props (ConnectStore UI).
* `routes.tsx`:

  * Routes carry `requiredModuleId` and `requiredFlagId` metadata for gating.
  * `isRouteEnabled` enforces gating logic.

**Implication:** Navigation is ready to surface module-specific pages when module UI is implemented. Use `requiredModuleId` to gate module pages/widgets.

---

# 5 — Contexts & global state

Key contexts:

* **AuthContext**

  * Rehydrates from `localStorage`.
  * Provides `login`, `logout`, `accessToken`.
  * Integrates PostHog identification.
* **EntitlementsContext**

  * Fetches `/api/v1/entitlements/me`.
  * Exposes `hasModule(moduleId)` and `hasFlag(flagId)`.
  * Used by `Sidenav` and `WidgetRegistry` for gating.
* **IntegrationContext**

  * Polls `/api/v1/integrations/sync-status`.
  * Derives `hasIntegrations`, `isFirstTimeSync`, `progress`, `syncStatus`.
  * Drives FT0 phase & modals.
* **DashboardStateContext**

  * Fetches `/api/v1/user-state/state`.
  * Exposes `userState` including `detected_mode`, `shopify_connected`, `first_insight_delivered`.
  * Drives `currentView` (empty | survival | growth | architect) used by widget selection.

**Implication:** UI is strongly data-driven. Module readiness and onboarding rely on back-end signals surfaced via these contexts.

---

# 6 — FT0 onboarding state machine and UX patterns

* FT0 phases represented by `Ft0Phase` (`PRE_CONNECT`, `CONNECTING`, `SYNCING`, `POST_SYNC_SKELETON`, `STEADY_STATE`).
* `DashboardPage` derives the phase from:

  * `hasIntegrations`
  * `syncStatus`
  * modal visibility (`isConnectModalOpen`, `isSyncModalOpen`)
  * `showPostSyncSkeleton`
* `DashboardStateManager` maps FT0 phase to UI state:

  * Pre-connect/Loading → `EmptyDashboardState` (with `ConnectStoreBanner`).
  * Syncing / Post-sync skeleton → skeletons and modals.
  * Steady-state → `WidgetLayoutWithRegistry`.
* Key UX elements:

  * `ConnectStoreModal` with pre-flight API call and PostHog instrumentation.
  * `DataSyncingModal` simulates progress for an "Aha!" UX.
  * `ConnectStoreBanner` CTA for connecting store.

**Implication:** Onboarding UX is central and consistent. Module-specific onboarding tasks (OrderNexus missing costs, SKU-OS health availability, Specter config) should plug into this FT0 UX via the same phase & modal patterns and by exposing actions through `OnboardingUIActionsContext` and `dispatchOnboardingAction`.

---

# 7 — Widget system — registry, shell, layout

* **Registry approach**:

  * `components/widgets/widget-registry.tsx` defines `WIDGET_REGISTRY` with survival/growth/architect groups and `WidgetDefinition` metadata.
  * `useWidgetRegistry()` (hook) chooses widgets for the user based on `DashboardState` and `Entitlements`.
* **Layout**:

  * `WidgetLayoutWithRegistry` maps registry entries to `EnhancedWidgetShell` instances.
  * `EnhancedWidgetShell` provides consistent header, body state machine (loading/empty/error), footer intelligence, and action buttons.
* **Widget contract**:

  * `WidgetContentProps` define common props: title, subtitle, metricConfig, primaryAction, isLoading, isEmpty, intelligenceLevel, etc.
* **Gating**:

  * Widgets can set `requiredModuleId` or `requiredFlagId`. `getWidgetsForUser()` enforces gating.

**Implication:** Implement module UI (OrderNexus, SKU-OS, Specter, InsightCore) as self-contained widgets that conform to `WidgetContentProps` and register them in `WIDGET_REGISTRY` under appropriate phase (survival/growth/architect). Use `EnhancedWidgetShell` for consistent look and actions.

---

# 8 — Module gating & entitlements integration

* Entitlements are fetched once per session (`/api/v1/entitlements/me`) and used widely:

  * Sidenav route visibility.
  * Widget registry gating.
  * Potential onboarding task visibility (via `dispatchOnboardingAction`).
* Backend readiness signals determine entitlements; frontend receives modules/flags and uses `hasModule()` checks.

**Implementation note:** For FT0 UI tasks:

* Map backend readiness signals to modules via the entitlements API (backend should expose module installed/ready signals in `/entitlements/me`).
* For tasks that need CTAs (e.g., "Fix missing costs"), emit onboarding actions from the backend and use `dispatchOnboardingAction` to trigger `navigate()` or `openModal()`.

---

# 9 — Frontend ↔ Backend API surfaces used

* `/api/v1/entitlements/me` — modules & flags (gating).
* `/api/v1/user-state/state` — `DashboardStateContext` (detected_mode, connected flags).
* `/api/v1/integrations/sync-status` — sync state & progress (IntegrationContext).
* `/api/v1/integrations/oauth/initiate` — start OAuth (ConnectStoreModal pre-flight).
* Onboarding readiness endpoint: `/api/v1/onboarding/readiness?shopId=...` (backend provides ReadinessSignal array) — consumed indirectly via entitlements/readiness providers server-side; frontend expects entitlements & onboarding actions.
* Module-specific endpoints (to implement UI):

  * e.g. OrderNexus: `/api/v1/order-nexus/*` (profitability, missing cost counts)
  * SKU-OS: producer emits `ProductHealthAnalyticsEvent` and backend provides `/api/v1/sku-os/top-risk` or similar.
  * Specter: `/api/v1/specter/:shopId/state` (exists on backend).
  * InsightCore: `/api/v1/insight-core/*` (analytics ingestion / facts)

**Implication:** Ensure backend exposes compact, cacheable endpoints optimized for UI consumption (paginated lists, top-N endpoints, lightweight summaries).

---

# 10 — Tests & developer tooling

* Jest config at root; tests exist for many backend modules; frontend uses React Testing Library and Playwright for e2e.
* Playwright config exists for e2e (`playwright.config.ts` and `playwright-report`).
* `test:setup` script to reset DB and run migrations/seeds.
* UI tests: `test-utils.tsx` helper present.
* Components include storybook scaffolding (`.storybook`).

**Implication:** Add unit tests for any widget components and integration tests to validate entitlements gating and onboarding modal flows. For Specter & SKU-OS widgets, include mock API data in tests.

---

# 11 — Gaps, risks, and constraints for FT0 → FT1 UI work

### Gaps

* **Module-specific UI not implemented:** OrderNexus, SKU-OS, Specter, InsightCore lack dedicated pages/widgets (only backend readiness and event plumbing exist).
* **Onboarding action wiring:** `dispatchOnboardingAction` exists, but backend onboarding actions must conform to the FE adapter (`navigate`, `openModal`, `openExternal`) — ensure backend uses these action types.
* **API endpoints for module data:** Need concise read endpoints for top-N widgets (e.g., Top-10 at-risk SKUs, Profit Autopsy summary).
* **Widget layout/responsiveness:** Current layout renders widgets stacked; no grid/dragging/responsive cols implemented yet.
* **Performance considerations:** Large per-product scans (sku-os) should be summarized server-side (top-N) rather than full catalog in the browser.

### Risks

* **Stale entitlements state:** If entitlements are cached long, UI may not reflect newly installed modules. `EntitlementsProvider.refresh()` exists but must be triggered after installation flows.
* **PII leakage in events:** Specter and other event payloads may contain sensitive data; frontend must avoid rendering raw payloads.
* **Theme inversion complexity:** `EnhancedWidgetShell` creates ad hoc inverted themes for light cards in dark mode — ensure accessibility (contrast).
* **Onboarding complexity explosion:** Multiple modules onboarding flows must be orchestrated into FT0 phase without conflicting UX.

---

# 12 — Actionable roadmap & recommended next steps (prioritized)

Below are small, TDD-friendly patches and tasks to enable FT0 module UIs (OrderNexus, SKU-OS, Specter, InsightCore):

## Priority 0 — Safety & plumbing (small patches)

1. **Entitlements refresh after module install**

   * Patch: Call `entitlements.refresh()` after connect flow completes (where backend signals module install).
   * Files: `ConnectStoreModal.tsx` success handler or `DashboardPage` post-sync flow.
   * Test: Unit test to assert `EntitlementsContext.refresh` called.

2. **Ensure onboarding action adapter supports backend action types**

   * Confirm `dispatchOnboardingAction` supports all types backend emits (`NAVIGATE`, `OPEN_MODULE_SETTINGS`, `OPEN_CONNECT_MODAL`, `OPEN_EXTERNAL`). Add mapping if needed.
   * Files: `onboarding/dispatchOnboardingAction.ts`
   * Test: unit tests for each action type.

## Priority 1 — FT0 widgets & API stubs (medium)

3. **OrderNexus: Profitability widget (Top-line)**

   * UI: Add `order-nexus` widget to `WIDGET_REGISTRY.survival` as `profit-autopsy-preview`.
   * API: Backend endpoint `/api/v1/order-nexus/summary` that returns `ordersIngested`, `missingCostCount`, `hasNegativeMarginOrder`, sample bleed orders (id, net_profit_est).
   * Files: `components/widgets/OrderNexusProfitSnapshot.tsx` + `widget-registry` entry.
   * Tests: UI unit tests with mocked API responses.

4. **SKU-OS: Top-10 At-Risk SKUs widget**

   * UI: Implement `TopAtRiskSkusWidget` that calls `/api/v1/sku-os/top-risk?limit=10`.
   * API: Backend returns list of ProductHealthAnalyticsEvent or summarized fields.
   * Gate: `requiredModuleId: 'sku-os'`.
   * Tests: unit + integration (mock data via `msw` or jest mocks).

5. **Specter: Shop state quick card**

   * UI: small card widget showing `lastIngestion`, `lastSync`, `sessionCount`, `config` with link to full Specter page.
   * API: existing `/api/v1/specter/:shopId/state` used.
   * Gate: `requiredModuleId: 'specter'`.
   * Tests: unit tests & e2e smoke for GET endpoint.

6. **InsightCore: analytics readiness card**

   * UI: card that shows `hasOrderAnalytics`, `hasReturnAnalytics`, `hasProductHealth`.
   * API: backend aggregated readiness signals or `/api/v1/insight-core/availability`.
   * Gate: `requiredModuleId: 'insight-core'`.

## Priority 2 — UX polish & FT1 readiness (larger)

7. **Widget placement & responsive grid**

   * Implementation: introduce grid-based layout (e.g., CSS grid / `react-grid-layout`) to place & reorder widgets for FT1.
   * Tests: visual snapshots + accessibility.

8. **Onboarding CTA integration**

   * When a backend readiness signal indicates a required action (e.g., `orderNexus.missingCostCount > 0`), show a dismissible onboarding banner in Dashboard or inside `OrderNexusProfitSnapshot` with CTA wired using `dispatchOnboardingAction`.
   * Add `OnboardingUIActionsContext` usage for `openModal` & `navigate`.

9. **Data caching & polling policies**

   * For heavy endpoints (SKU-OS top risk), implement server-side caching and use `react-query` with reasonable TTL and manual refetch triggers.

10. **Accessibility & contrast checks**

    * Verify the inverted light-card theme in `EnhancedWidgetShell` meets contrast guidelines (WCAG AA). Fix where necessary.

---

# 13 — Deliverables I will produce (if you want them next)

Pick any and I will produce ready-to-apply code diffs / specs:

* A. **Widget stubs** for OrderNexus, SKU-OS, Specter, InsightCore (TSX files + registry updates + tests).
* B. **Onboarding action adapter extension** with unit tests and mapping for backend action types.
* C. **Sidenav + Entitlements refresh** patch (call refresh after connect flow).
* D. **API contract specs** for the frontend endpoints each module needs (OpenAPI-style JSON + example responses).
* E. **Responsive widget grid** design + implementation plan and sample component.

---

# 14 — Closing notes and recommendations

* **Keep UI contracts minimal & server-driven:** Expose small, cacheable endpoints focused on summaries/top-N for widget consumption; avoid pulling large datasets into the browser.
* **Treat onboarding as cross-cutting but centralized:** Use existing FT0 phase and `OnboardingUIActionsContext` to ensure consistent experiences across modules.
* **Implement modules as self-contained widgets first:** Start with survival-phase widgets (Top-10, Profit Autopsy summary, Specter state) then expand into growth/architect flows.
* **Test early and often:** Add unit tests for widget shells, entitlements gating, and onboarding CTAs. Add one lightweight integration test that seeds readiness signals and asserts gating behavior.
* **Prioritize observability & privacy:** Instrument PostHog/metrics for onboarding events and ensure sensitive fields are not rendered.

---
