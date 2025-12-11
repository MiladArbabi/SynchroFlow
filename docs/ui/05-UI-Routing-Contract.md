**Status:** Draft — Frontend routing contract for LaSyncro (module-aware)

**Purpose**
Provide a single, actionable contract for how routes are declared, registered, guarded, and resolved in the LaSyncro frontend. This contract is deliberately implementation-aware (it documents the current static `routes.tsx` pattern) while specifying the runtime APIs that modules must use when we move toward module-first dynamic registration. The goal: allow every UI module to expose routes in a safe, entitlements-aware, and testable way, without letting modules reach into host internals.

---

## Table of contents

1. Scope & goals
2. RouteDescriptor (canonical shape)
3. Host routing API (what the host must provide)
4. Route registration patterns (static and dynamic)
5. Route guards & entitlements checks (behavior rules)
6. Protected route UI contract (placeholder + upgrade CTA)
7. Navigation & cross-module navigation rules
8. Examples (based on `apps/frontend/src/routes.tsx`)
9. Contract tests & CI checks
10. File placement & governance
11. Required repo evidence (quick scans)

---

## 1. Scope & goals

This contract covers client-side routing only (frontend SPA: React + react-router). It **does not** define backend endpoints. It covers:

* the canonical shape for route metadata,
* how routes are registered (static list or dynamic module registration),
* the entitlements-based guard rules and UX when a route is gated,
* a small host API surface modules should use to register routes and navigate,
* testable expectations (what CI must validate).

Why this matters: routing is the single integration point between host and modules. Clear rules prevent accidental exposure of gated features, inconsistent nav, and tight coupling to host internals.

---

## 2. RouteDescriptor (canonical shape)

All routes — whether declared statically or registered dynamically — must conform to this canonical TypeScript shape:

```ts
type RouteType = 'collapse' | 'route';

interface RouteDescriptor {
  id: string;              // unique id (e.g. 'orders.list' or 'orders.details')
  type: RouteType;
  name: string;            // friendly display name
  key: string;             // unique key for sids/nav
  icon?: React.ReactNode | string;
  path: string;            // react-router path, absolute or relative to mountPath
  component: React.ReactNode | React.ComponentType<any>;
  mountPath?: string;      // optional — if the module is mounted under a base path
  requiredModuleId?: string;
  requiredFlagId?: string;
  exact?: boolean;         // if using react-router vX semantics
  order?: number;          // navigation ordering hint
  navGroup?: string;       // optional grouping for side nav
  meta?: Record<string, any>;
}
```

Notes:

* `id` and `key` must be stable across releases (used in telemetry, entitlement checks).
* `path` must be URI-safe and may contain params (e.g. `/orders/:id`).
* `component` may be a lazy-loaded `React.lazy` factory for code-splitting.

---

## 3. Host routing API (what the host provides)

The host (LaSyncro shell) exposes the following minimal routing APIs. Modules should **never** import host internals — use these APIs passed via `HostApi` (described in the UI Layout Contract) or via a well-documented runtime registration function.

```ts
// Called by host or module to register a route at runtime
function registerRoute(route: RouteDescriptor): void;

// Remove a previously-registered route (used in hot reload/unmount)
function unregisterRoute(routeId: string): void;

// Query registered routes (read-only)
function getRegisteredRoutes(): RouteDescriptor[];

// Navigate programmatically (module -> host navigation)
function navigate(path: string, options?: { replace?: boolean, state?: any }): void;

// Gate check helper (pure): uses entitlements snapshot
function isRouteEnabled(route: RouteDescriptor, entitlements: EntitlementSnapshot | null): boolean;
```

Implementation detail: currently the host uses a static `routes.tsx` array and a pure `isRouteEnabled` helper; the contract above preserves that shape while allowing `registerRoute` to append to the effective routes list at runtime.

---

## 4. Route registration patterns

Two supported patterns — both allowed during transition to full module-first architecture:

### 4.1 Static registration (current)

* A central `routes.tsx` exports a `RouteConfig[]` array.
* The host reads `routes` and renders `<Routes>` / Sidenav from that list.
* Each route object must include entitlement metadata (`requiredModuleId`, `requiredFlagId`) if appropriate.
* Example: `apps/frontend/src/routes.tsx`

Pros: simple, explicit; low runtime complexity.
Cons: requires rebuild to add routes; less dynamic.

### 4.2 Dynamic registration (module-first)

* Modules register routes via `registerRoute()` during their `register(hostApi)` or `moduleEntry()` call.
* Host merges dynamic routes with static ones and reconciles ordering and nav placement.
* Host must persist routes ordering deterministically and provide consistent keys for telemetry.

Fallback behavior: if a dynamically registered route is gated and entitlements unknown, host must treat it as disabled (show skeleton/gated placeholder) until entitlements resolution completes.

---

## 5. Route guards & entitlements checks

**Behavior rules** (must be followed):

1. If a route has neither `requiredModuleId` nor `requiredFlagId` → always enabled.
2. If a route has gating metadata and `entitlements === null` (unknown) → hide route or show skeleton **not** the real page. Do **not** render sensitive or incomplete views while entitlements are unresolved.
3. If a route has `requiredModuleId` and it is not present in `entitlements.modules` → host must not allow navigation to route; either:

   * show a gated placeholder with CTA to upgrade; or
   * redirect to a safe landing page (e.g. `/dashboard`) with contextual message.
4. If both `requiredModuleId` and `requiredFlagId` are present → both must be satisfied.
5. Route-level guards must run in a pure, predictable way — e.g. the `isRouteEnabled(route, entitlements)` helper must be used by all route resolution flows (Sidenav rendering, ProtectedRoute component, route guards in router).

**Security note:** Entitlements gating is a UX gate only — all sensitive data must still be protected on the backend. The client must never be the only enforcement mechanism.

---

## 6. Protected route UI contract (placeholder + upgrade CTA)

When a user navigates to a route they lack entitlement for, the host must show a consistent gated experience:

* Lightweight placeholder with:

  * Title (from route `name`)
  * Short message: "Feature unavailable on your plan"
  * Entitlement hint: which module or flag is missing
  * Primary CTA: "Upgrade" or "Request access" (navigates to `upgradeRoute` if supplied by entitlements backend)
  * Secondary CTA: "Return to dashboard"
* Accessible: keyboard focus, ARIA role `alert` for the message.
* Telemetry: log `"gated_route_attempt"` with `routeId` and missing entitlements.

This pattern already exists in the UI as `ProtectedRoute` usage. Modules should not duplicate gating UI — use host-provided `ProtectedRoute` or `GatedPlaceholder` primitives.

---

## 7. Navigation & cross-module navigation rules

* Modules must use the host `navigate()` API (or host-provided helper) for cross-module navigation. Do **not** `window.location` unless an external domain.
* When navigating to another module's route, prefer using `routeId` or named routes when available (host API can resolve `routeId -> path`) to avoid path string coupling.
* If the target route is gated and user lacks entitlement, host must intercept and show the gated placeholder rather than navigating silently.

---

## 8. Examples (derived from repo)

**a) Current static route config (excerpt)** — exists in `apps/frontend/src/routes.tsx`:

```ts
{
  type: "collapse",
  name: "Analytics",
  key: "analytics",
  icon: "📈",
  route: "/analytics",
  component: <AnalyticsPage />,
  requiredModuleId: "analytics",
}
```

**b) Pure helper for entitlement checks (already present)**:

The repo defines `isRouteEnabled(route, entitlements)` with the behavior: return true if no gating; if `entitlements` is null => false for gated routes; checks both modules and flags. This exact helper should be the canonical implementation used by host and modules.

---

## 9. Contract tests & CI checks

Every module must include CI checks that validate its routing behavior:

1. **Descriptor shape test** — A unit test that validates the module's route descriptors conform to `RouteDescriptor` (id/key uniqueness, required fields present).
2. **Mount path test** — If the module is mounted at `mountPath`, ensure all declared `path`s are relative or correctly prefixed.
3. **Entitlement resilience test** — Render the route under `entitlements === null` and assert it shows a loading skeleton or gated placeholder (not full UI).
4. **Protected route test** — Attempt to render a gated route with entitlements missing and assert the gated placeholder is shown.
5. **Navigation test** — If module calls `navigate(routeId)` or `navigate(path)`, ensure host helper is invoked; mocks can validate.

Add these to the module template (docs/ui/10-UI-Module-Readme-Template.md) and to the host CI contract harness.

---

## 10. File placement & governance

* This document: `docs/ui/05-UI-Routing-Contract.md` (you are viewing it here).
* Canonical host routing implementation lives at `apps/frontend/src/routes.tsx` and host route rendering in `apps/frontend/src/Layout` or `apps/frontend/src/Layout/MainLayout/...`.
* Any changes to `isRouteEnabled` or `routes` must be approved by UI Platform owner (see governance doc).

---

## 11. Required repo evidence (quick scans)

To finalize and convert this draft into a locked contract we must capture 2 small files from the repo (so the contract includes exact function signatures and exact file references). Please paste outputs for:

1. `apps/frontend/src/components/ProtectedRoute.tsx` — small file; this shows how route guarding is currently wired.

   ```
   sed -n '1,240p' apps/frontend/src/components/ProtectedRoute.tsx
   ```

2. `apps/frontend/src/contexts/EntitlementsContext.tsx` — shows entitlements snapshot shape and hooks.

   ```
   sed -n '1,240p' apps/frontend/src/contexts/EntitlementsContext.tsx
   ```

After you paste them I will:

* Update this document to include exact function names and example usage for `ProtectedRoute` and `useEntitlements()` (or equivalent).
* Produce a ready-to-drop-in `registerRoute()` shim (TS) for modules to use during module-first migration (a small helper module code snippet you can paste into host).

---

## Quick checklist for adoption (what to do next)

* [ ] Add `registerRoute` host shim (I will draft after the above scans).
* [ ] Add gated placeholder component to `ui-component` if not present.
* [ ] Add the five CI route checks into `docs/ui/08-UI-Testing-and-Contract-Test-Harness.md`.
* [ ] Convert a pilot module (OrderNexus or Specter) to use `registerRoute` dynamically as a migration proof.

---
