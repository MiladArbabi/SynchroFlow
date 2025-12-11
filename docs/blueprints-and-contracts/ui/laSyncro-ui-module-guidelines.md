# LaSyncro UI Module Guidelines — Directive Document

**Purpose:**
This document is the canonical directive for designing and implementing the UI for every LaSyncro module. It defines standards, folder/contract conventions, UX constraints, telemetry and testing requirements, and acceptance criteria so each module is powerful, robust, scalable, and consistent across the platform — while remaining independently deployable and testable.

---

## 1 — High-level principles (must follow)

1. **Single source of truth for design tokens**

   * All colors, spacing, typography, elevations, and component tokens live in `apps/frontend/src/ui/tokens`.
   * No module-specific palettes. Theme adapter maps template (Berry) tokens → LaSyncro tokens.

2. **Component contract-first**

   * Pages import only canonical primitives (`apps/frontend/src/ui/*`) — never raw MUI in page-level code.
   * Components must accept typed props and expose minimal responsibilities.

3. **Module isolation & clear boundaries**

   * Each module sits under `apps/frontend/src/modules/<module>/ui`.
   * Modules may only depend on `modules/shared` contracts and `apps/frontend/src/ui/*` primitives.

4. **Thin pages, smart components**

   * Pages compose presentational pieces and orchestrate domain hooks. Business logic and API calls live in `hooks/` and `services/`.

5. **Contracts & DTOs**

   * All request/response types defined in `modules/shared/src/contracts` and imported by UI. No duplicate types in modules.

6. **Permission-first rendering**

   * UI must read `useEntitlements()` and `useAuth()`. Gated features must hide and show upgrade CTA (never throw).

7. **Feature-flagged rollouts**

   * New UI behind a feature flag + entitlement check. Provide dev override.

8. **Telemetry and observability**

   * All user actions emit standardized telemetry via `apps/frontend/src/ui/analytics.ts`. No raw tokens or PII in telemetry.

9. **Test-first delivery**

   * Storybook story + unit tests + Playwright e2e for critical flows before merge to `main`.

10. **Performance & accessibility baseline**

    * Route-level code splitting for modules. Virtualized lists for large tables.
    * Basic axe accessibility checks and keyboard-first interactions.

---

## 2 — Folder & file conventions (copy/paste template)

Every module UI follows this folder pattern:

```
apps/frontend/src/modules/<module>/ui/
├─ index.tsx                # module entry: exports routes and module manifest entry
├─ routes.tsx               # module routes (gated)
├─ README.md                # module purpose, feature flags, owners
├─ components/
│  ├─ <Feature>/            # presentational components only
│  │  ├─ <Comp>.tsx
│  │  └─ <Comp>.stories.tsx
├─ hooks/
│  ├─ use<Module>List.ts    # react-query hooks, caching keys
│  └─ use<Module>Actions.ts # mutations + optimistic update logic
├─ services/
│  ├─ api.ts                # typed axios calls (import token from useAuth wrapper)
│  └─ contracts.ts          # import shared types; only module-specific types allowed
├─ tests/
│  └─ <Comp>.spec.ts
└─ stories/
   └─ module.stories.tsx
```

Naming:

* `components/` = pure presentational (no direct API calls).
* `hooks/` = all data fetching, caching, polling, background tasks.
* `services/api.ts` = endpoint definitions and thin adapters.
* `index.tsx` must export a `ModuleManifest` entry (see Manifest section).

---

## 3 — Module manifest (required)

Each module must register in `apps/frontend/src/modules/manifest.ts`:

```ts
export interface ModuleManifest {
  id: string;                // e.g. 'order-nexus'
  title: string;
  routeBase: string;         // '/orders'
  requiredModuleIds?: string[];
  requiredFlagIds?: string[];
  menu?: { label: string; icon?: string; order?: number };
  entryComponent?: React.ComponentType;
}

export const MODULES: ModuleManifest[] = [
  { id: 'order-nexus', title: 'Orders', routeBase: '/orders', menu: { label: 'Orders', icon: 'Orders' } },
  ...
];
```

The main app constructs navigation and route guards from this manifest.

---

## 4 — UI primitives & shared services (must exist before module work)

Create and use these shared pieces located under `apps/frontend/src/ui/`:

* `Button`, `Card`, `Modal`, `DataGrid` (wrapper), `FormField`, `Toast`, `Icon`, `Avatar`, `EmptyState`, `Skeleton`.
* `analytics.ts` — wrapper for PostHog: `track(moduleId, component, action, meta)`.
* `permission.tsx` — `<IfModule moduleId="...">`.
* `error-boundary.tsx` — reusable error UI and telemetry on error.
* `events/` — client to normalize SSE / WS incoming events.

**Rule:** Stories must exist for each primitive.

---

## 5 — Data & hook patterns (React Query)

* Use React Query for caching. Query keys structured as: `['<module>', '<resource>', params]`.
* Hooks should export: `{ data, isLoading, error, refresh }`.
* Mutations must support optimistic updates and rollback on failure.
* Long-running/async operations (imports, exports) are polled with `usePolling()` helper and surface jobId for later retrieval.

Example hook signature:

```ts
export function useOrders(params: OrdersQueryParams) {
  return useQuery(['order-nexus','orders', params], fetchOrdersFn, { keepPreviousData: true, staleTime: 30_000 });
}
```

---

## 6 — Entitlements & feature gating

* At rendering points for routes and major features use:

  * `filterRoutesByEntitlements(manifestRoutes, entitlements)` for nav/routes.
  * `<IfModule moduleId="..."><Feature /></IfModule>` inside pages.
* If a feature is gated, replace it with a consistent `UpgradeCTA` component carrying:

  * brief locked message, required upgrade route, and single CTA button.
* If entitlements loading state is unresolved, hide gated routes (conservative).

---

## 7 — Telemetry & logging rules

* Event payload shape (all events): `{ moduleId, component, action, label?, value?, correlationId? }`. Implement in `ui/analytics`.
* No PII should be sent to analytics. Hash or redact customer IDs.
* Track: page views, CTA clicks, important mutation requests (create/approve/refund), and errors.
* For background jobs (export/import), emit start/complete/fail events with job metadata.

---

## 8 — Testing & Storybook

* **Stories:** Every component and major page must have a Storybook story showing:

  * happy path, empty state, loading, error.
* **Unit tests:** Hooks + pure logic. Mock network with MSW or React Query test utils.
* **Playwright e2e (smoke):** For each module, test the critical path (e.g., create an order → view Order360 → execute refund).
* **Visual regression:** Snapshot critical pages (Order360, Dashboard).
* **CI pipeline:** lint → unit tests → build → storybook build → e2e.

---

## 9 — Accessibility & internationalization

* Components must support `aria-*` attributes, keyboard-only navigation, and focus management for modals and menus.
* All text must be wrapped for i18n using the platform’s localization utility (`ui/i18n`).
* Provide high-contrast theme tokens; ensure color contrast ratios meet WCAG AA for text.

---

## 10 — Security & privacy constraints

* PII default: mask in lists; reveal on user interaction with audit log.
* Specter session data: lazy load and respect `privacy-guards` — surface anonymization settings in the UI.
* Telemetry must never include raw tokens or raw identifiers — use hashed/correlated ids.
* Audit logs for destructive operations (refunds, user data exports).

---

## 11 — Performance & bundling

* Route-level code splitting: lazy-load module routes.
* Virtualize large lists with `react-window` or `mui x` virtualization.
* Use resource hints (preload critical chunks) for first-load UX.
* Keep page JS budgets small: aim <150kb initial module chunk.

---

## 12 — UX patterns & component behavior

* **Empty states:** Always provide a clear next action (connect store, import SKUs, invite user).
* **Loading:** Use skeletons with meaningful shapes; avoid spinner-only screens.
* **Errors:** Show actionable messages and a telemetry-backed “Report” button.
* **Optimistic updates:** Show immediate UI effect with undo capability for destructive ops.
* **Bulk operations:** Use progress modal with cancel and async job polling.
* **Action confirmations:** For destructive actions show confirm modal with consequences and undo window.

---

## 13 — Module-specific directive (brief)

Each module must include a one-page README that states:

* Primary user goal & top 3 screens.
* Required backend endpoints (contract file references).
* Feature flags required.
* Entitlement IDs used.
* Telemetry event keys used.
* Performance cautions (expected list sizes).
* Tests to ship with PR.

Examples (short):

* **OrderNexus README**: orders list, order-360, bulk-actions. Contracts: `modules/shared/contracts/orders.ts`. Entitlement: `order-nexus`.
* **Specter README**: onboarding banner, config panel, session list. Must reference `modules/specter/src/compliance/privacy-guards.ts`.

---

## 14 — Acceptance criteria (per-module go/no-go)

Before merging a module to `main`:

1. All routes and pages render with canonical theme; no console errors.
2. All API calls use `services/api.ts` and typed contracts.
3. Stories cover components (happy / error / empty / loading).
4. Unit tests for hooks pass, and Playwright smoke for main flow passes.
5. Entitlements hide gated features; upgrade paths show consistent CTA.
6. Performance: list pages render first meaningful paint within 1.5s locally (suggestion).
7. Accessibility: no critical axe violations on main pages.
8. Telemetry: critical actions produce analytics events.

---

## 15 — Developer onboarding checklist (for each module PR)

* [ ] Add `README.md` with manifest, owner, tests, and endpoints.
* [ ] Add module manifest entry to central `modules/manifest.ts`.
* [ ] Create stories for every new component.
* [ ] Provide unit tests for hooks and logic.
* [ ] Create at least one Playwright smoke test (happy path).
* [ ] Wire telemetry events in `ui/analytics`.
* [ ] Add entitlement/feature flag gating.
* [ ] Ensure i18n for visible text.
* [ ] Run accessibility check and fix critical failures.
* [ ] Update central docs index with module brief.

---

## 16 — Suggested immediate actions (copy-pasteable)

1. Create `apps/frontend/src/ui/` primitives (Button, Card, Modal, DataGrid wrapper, Toast, analytics).
2. Add `apps/frontend/src/modules/manifest.ts` and register `order-nexus` + `specter`.
3. Generate a module skeleton script `scripts/new-module.sh` that creates the folder pattern above.

If you want, I will produce ready-to-paste templates for:

* `apps/frontend/src/ui/Button.tsx` + its story,
* `modules/manifest.ts` file,
* `scripts/new-module.sh` generator.

Tell me which template(s) you want and I’ll generate the exact files.

---

### Final note

These guidelines are intentionally strict: they prevent UI drift, reduce duplicate work, and make modules independently testable and shippable. Follow them exactly for the first two modules (OrderNexus, SKU-OS) — then we can consider relaxing patterns where justified by evidence.