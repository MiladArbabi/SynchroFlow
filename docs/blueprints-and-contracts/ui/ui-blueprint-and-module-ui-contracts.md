# LaSyncro — UI Blueprint & Module UI Contracts

**Audience:** Frontend engineers, UX designers, product managers, and integrators.
**Purpose:** Provide a single, actionable blueprint that defines how each LaSyncro module’s UI must be designed, structured, and delivered so the whole product is cohesive, scalable, testable and consistent with existing contracts and blueprints.

---

## 1 — Scope & Goals

* **Scope:** Frontend/UI layer only. No backend or API specification changes here — those live in separate docs (already present under `docs/blueprints-and-contracts/*` and `docs/entitlements/*`).
* **Primary goals:**

  * Make each module a **powerful, robust, independent** sub-application that **aligns** to LaSyncro global product UX + design system.
  * Reuse the Berry template where it speeds delivery, but adapt to LaSyncro component, theme and entitlement contracts.
  * Keep deliverables small and testable; use incremental FT0 → FT1 → FT2 rollout.
* **Non-goal:** Do **not** mix API/backend change requests here. UI work will reference backend contracts but won’t change them.

---

## 2 — Principles & Design Tenets

1. **Module Independence:** Each module (OrderNexus, Specter, SKU-OS, InsightCore, ReturnNexus, WMS-Lite, Problem Center, MarginCore) is an independently mountable UI slice with a well-defined public interface (props/state/events) and its own routes, contexts, and tests.
2. **Shared Design System:** A single theme + component layer (Material UI with Berry overrides) governs look-and-feel. Module-specific styles must be implemented as theme-aware variants — **no ad-hoc CSS** outside theme/component primitives.
3. **Entitlements First:** UI surfaces must read entitlements (modules + flags) from `EntitlementsContext` and hide/disable features accordingly. Gating behavior must match `docs/entitlements/*`.
4. **Composable Components:** Build reusable primitives (cards, tables, steppers, modals, chips) in `ui-component/*` and reference them from modules.
5. **Progressive Delivery:** FT0 implementations should be UX-complete but may show skeletons/faux-journeys; FT1 adds depth / backend integration.
6. **Performance & Accessibility:** Performance budgets per page; follow WCAG 2.1 AA baseline. Keyboard focus management, ARIA attributes, and semantic HTML are required.

---

## 3 — Deliverable Structure / File & Repo Conventions

Each module must follow the same directory structure under `apps/frontend/src/modules/<module-name>` (or `apps/frontend/src/components/<module-name>` if simpler). Example minimal layout:

```
modules/<module-name>/
  ├─ index.tsx              # default export: module router or mount component
  ├─ routes.tsx             # internal routes (route metadata + entitlementIds)
  ├─ components/            # presentational components (stateless)
  ├─ containers/            # smart components (data fetching, transform)
  ├─ hooks/                 # module-specific hooks (useSpecterConfig)
  ├─ contexts/              # local module contexts (ModuleUIContext)
  ├─ styles/                # CSS-in-JS variants, theme extensions (if needed)
  ├─ tests/                 # unit + integration tests
  └─ README.md              # module-specific developer notes + contracts
```

**Naming & exports**

* Prefer `PascalCase` for components; `kebab-case` for folder names.
* All module root `index.tsx` must export a React component usable by the global routes system.
* Include a `routes.tsx` that exports a `RouteConfig[]` with entitlement metadata (`requiredModuleId`, `requiredFlagId`) aligned with `apps/frontend/src/routes.tsx` shape.

---

## 4 — Theming & Design System (Berry + MUI)

**Single source of truth:** `apps/frontend/src/themes/*` is canonical.

* Use `ThemeProvider` at the top-level (`ThemeCustomization`) — do not shadow with mismatched theme providers except for deliberate “light-on-dark” micro-themes (e.g., widget light cards in dark mode) implemented via `createTheme(theme, {...})`.
* **Overrides:** Reuse Berry overrides in `themes/overrides/*` and keep LaSyncro-specific overrides in a small fork (apply minimal patching, not full duplication).
* **Palette and typography:** Use `buildPalette` and theme variables; modules must not hardcode color hexes — use `theme.palette.*` keys.
* **CSS variables:** Use `cssVariables` prefix (`CSS_VAR_PREFIX`) for cross-cutting runtime theming (e.g., brand color swap).
* **Component contract:** `ui-component/*` exports preferred components; ensure Berry components are wrapped/adapted (single agreed API) to match LaSyncro needs.

---

## 5 — Shared Primitives & Component Library

Create (or stabilize) the following components inside `apps/frontend/src/ui-component` as canonical primitives:

* Card shells (widget shells) — supports loading / empty / error states.
* Data tables (extended DataGrid wrapper) — server-side pagination hooks.
* Form primitives (ValidatedTextField, DatePicker wrapper).
* Modal system (root-level modal manager with stacking).
* Toasts / notifications (notistack integration).
* Breadcrumbs, TopNavbar, Sidebar, Footer (consistent header/navigation).
* CoachTrigger / KoreTrigger primitives (insight interactions).
* Onboarding banners and post-sync skeleton components.

**Contracts for components:** document PropTypes / TS interfaces in `ui-component/README.md`. All components must support:

* `data-testid` props where used in tests,
* `sx` or `className` overrides,
* accessibility props.

---

## 6 — Module-specific UI Contracts

For each module produce a small contract file (one-liner + examples) inside `docs/blueprints-and-contracts/<module>/ui-contract.md`. The contract must include:

1. **Primary entry component** — `ModuleMount(props: { shopId?: number })`.
2. **Routes** — `routes.tsx` list and entitlement gating.
3. **Public events** — emitted events (e.g., `onConfigure`, `onUpgradeRequested`) and shape.
4. **Required contexts** — which global contexts it needs (Auth, Entitlements, Integration, Ops).
5. **Data requirements** — endpoints the UI consumes (names only, not spec changes), expected shape keys.
6. **Skeleton & error UX** — what to show while loading, error messaging strategy.
7. **Performance budget** — initial bundle size target and data fetch limits.

Create one for each: `OrderNexus`, `Specter`, `SKU-OS`, `InsightCore`, `ReturnNexus`, `WMS-Lite`, `Problem Center`, `MarginCore`.

---

## 7 — Entitlements & Gating

* Use `EntitlementsContext` from `apps/frontend/src/contexts/EntitlementsContext.tsx`.
* Every route and feature must declare `requiredModuleId` or `requiredFlagId` in `routes.tsx` and in widget registry entries. UI must fall back to:

  * Hidden route (if no entitlement),
  * Upgrade CTA (if user action requires upgrade) — use `UpgradePathUXSpec.md`.
* FT0 behavior: show onboarding banners (connect store) and post-sync skeletons; do **not** surface paid-only features.

---

## 8 — Onboarding & FT0 UX

* Follow `docs/onboarding/FT0-REALITY.md` and `dashboard-and-layout/v1.0_overview.md`.
* Key components to implement in FT0:

  * Connect-store modal + DataSyncing modal (with simulated progress).
  * Empty dashboard states and post-sync skeletons.
  * First-insight progressive reveal: use `OpsContext` / `proactiveInsights`.
* Use `modules/*.dist` code (specter/order-nexus) behavior to simulate the backend where necessary during FT0.

---

## 9 — Data fetching & State Management

* Use `react-query` for all server state (already in repo). Standardize query keys (e.g., `['module', 'resource', id]`).
* Local UI state: prefer Context APIs per module for complex interactions (e.g., `SpecterConfigContext` already exists).
* Global state: only for truly global concerns (`AuthContext`, `Entitlements`, `DashboardState`, `Integration`).
* Side effects & polling: keep polling in integration context (like `IntegrationContext`) not inside components.

---

## 10 — Routes & Multi-App Linking

* Integrate modules into global route registry `apps/frontend/src/routes.tsx` via `RouteConfig` signature used in project. Each module exports `RouteConfig[]`.
* For multi-app linking (e.g., between LaSyncro and Aurora or other subapps), use the `MultiAppLinking` doc pattern: open external links in new tab with `noopener,noreferrer`, send telemetry event on navigation.

---

## 11 — Testing Strategy

* Unit tests: component props + behavior (Jest + React Testing Library).
* Integration tests: react-query + mock axios; test gating logic via `EntitlementsContext`.
* End-to-end (playwright): Smoke flows for FT0 onboarding (connect, sync, first insight).
* Required: each module must include `tests/coverage.md` with minimal coverage target (e.g., 70% component-level).

---

## 12 — Accessibility & Internationalization

* WCAG 2.1 AA baseline.
* All components must support `aria-*`, keyboard navigation, and focus management (e.g., when modals open set focus).
* Text must be externalized to `i18n` strings in `locales` folder. Modules must load localized strings via project `i18n` patterns.

---

## 13 — Performance & Bundle Strategy

* Each module should be code-split and lazy-loaded via route-level `React.lazy()` and `Suspense`, or the existing `Loadable` wrapper.
* FT0 shell must remain small: target initial bundle < 200KB gzipped for core shell (excluding module chunks).
* Use `react-query` caching policies and server-side pagination/streaming for large datasets.

---

## 14 — Developer Experience & Onboarding

* Each module must include `README.md` with:

  * `start` instructions,
  * list of required env vars,
  * mock server / fixtures to run FT0 flows.
* Document component contract and include storybook stories (re-using `apps/frontend/src/stories/*` pattern) for every major component.

---

## 15 — Migration Plan (Berry → LaSyncro)

1. **Inventory:** We already scanned Berry template and LaSyncro. Map Berry components → LaSyncro `ui-component` primitives.
2. **Adapter Layer:** Create small adapter wrappers in `ui-component/berry-adapters/*` to normalize APIs.
3. **Gradual substitution:** Replace one primitive at a time (Button, Card, DataGrid) with Berry-derived component adapted to LaSyncro theme.
4. **QA checks:** Visual diff and accessibility checks per substitution.

---

## 16 — Docs & Contracts to Create (Actionable list — small steps)

For each item below create a doc (one-liners followed by where to place them). I will ask you to run small scans and paste outputs so I can finish these docs based on facts.

1. `docs/ui/module-ui-contracts/<module>-ui-contract.md` — for every module (OrderNexus, Specter, SKU-OS, InsightCore, ReturnNexus, WMS-Lite, Problem Center, MarginCore).
2. `docs/ui/component-contracts.md` — canonical prop/behavior contracts for each `ui-component/*` primitive (Card, DataGrid, Modal, Form primitives).
3. `docs/ui/theme-integration.md` — exact instructions for using `ThemeCustomization` and `themes/overrides` (mapping Berry keys → LaSyncro keys).
4. `docs/ui/onboarding-ui-spec.md` — FT0 onboarding UX flows, skeletons and required telemetry events.
5. `docs/ui/entitlements-ui-spec.md` — UI gating rules and upgrade CTA patterns, referencing `docs/entitlements/*`.
6. `docs/ui/testing-guides.md` — unit/integration/e2e patterns + required data fixtures.
7. `docs/ui/performance-budget.md` — per-page budget targets and bundle splitting rules.
8. `modules/*/README.md` — generate templates for each module (tiny file) to standardize dev onboarding.

---

## 17 — Roadmap & Phase Deliverables (small increments)

* **Phase 0 (Preparation, 1 week)**

  * Create the 8 docs listed above as skeletons filled with known facts (I can produce templates).
  * Create `ui-component/README.md` and baseline storybook stories.
* **Phase 1 (FT0 core, 2–3 weeks)**

  * Implement Dashboard shell, Connect-store modal, DataSyncing modal, Empty states, Widget registry integration.
  * Implement `OrderMetricsWidget`, `TopProductsWidget` etc using existing implementations as template.
* **Phase 2 (FT1 module depth)**

  * Complete module UIs for Specter, OrderNexus, SKU-OS, InsightCore with real API hooks and entitlements gating.
* **Phase 3 (Polish & accessibility)**

  * Full QA, performance optimization, final visual polish and storybook documentation.

---

## 18 — Checklist (Before Coding Starts)

* [x] Theme provider and `ui-component` primitives audited (we scanned `apps/frontend/src/themes`, `ui-component`).
* [x] Entitlements & Dashboard state contexts exist (`EntitlementsContext`, `DashboardStateContext`).
* [x] Existing widget patterns (EnhancedWidgetShell, widget-registry) present and reusable.
* [ ] Create module UI contract docs (one per module). **(Required)**
* [ ] Create `component-contracts.md`. **(Required)**
* [ ] Create `theme-integration.md`. **(Required)**
* [ ] Create `onboarding-ui-spec.md`. **(Required)**
* [ ] Create `testing-guides.md` and `performance-budget.md`. **(Required)**

---