# README — UI Contracts, Runtime Architecture & Module Tooling (LaSyncro)

**Purpose**
This directory documents the **canonical UI architecture** of LaSyncro: how the host app boots, how runtime UI modules register routes and navigation, how entitlements are enforced, and how engineers safely add or migrate modules without breaking routing, auth, or refresh behavior.

If you read only one thing: read **Quick start**, **Runtime routing model**, and **Handoff checklist**.

---

## Table of contents

1. Quick start
2. High-level UI runtime architecture (host vs modules)
3. Project map — the 12 UI contract documents
4. Runtime routing model (static + dynamic)
5. Entitlements & ProtectedRoute semantics
6. Adding a new UI module (step-by-step)
7. Code & template locations
8. Contract tests & CI
9. Troubleshooting & failure modes
10. Handoff checklist
11. Appendix — examples

---

## 1 — Quick start

```bash
# from repo root
npm ci

# validate module descriptors
node scripts/validate-modules.js

# run UI contract tests
npx jest tests/contract --runInBand

# typecheck shared UI contracts
npx tsc -p modules/shared/tsconfig.json
```

Scaffold a new UI module (dev only):

```bash
node scripts/scaffold-ui-module.js <module-id> --force
# example
node scripts/scaffold-ui-module.js order-nexus-test --force
```

---

## 2 — High-level UI runtime architecture

LaSyncro uses a **host-driven, runtime-extensible UI architecture**.

### Host responsibilities (apps/frontend)

The host owns:

* Authentication & session state
* Entitlements resolution
* Static routes (`/dashboard`, `/login`, etc.)
* Layout (AppLayout, sidenav, topbar)
* Runtime registries (routes, nav, telemetry)
* Protection & gating (`ProtectedRoute`)

### Module responsibilities (modules/*)

Each UI module:

* Declares a **descriptor** (`descriptor.json`)
* Registers routes & nav items at runtime
* Supplies React components for pages
* Declares required entitlements
* Does **not** control auth, routing guards, or layout

Modules attach themselves to the host via **HostApi** at runtime.

---

## 3 — Project map: the 12 UI documents

Docs live under `docs/ui/`. These describe **contracts**, not implementation details.

```
docs/ui/
├─ 01-UI-Module-Index.md
├─ 02-Component-Library-Contract.md
├─ 03-Design-Tokens-Contract.md
├─ 04-UI-Layout-Contract.md
├─ 05-Minimal-UI-API-Contract.md
├─ 05-UI-Routing-Contract.md
├─ 06-UI-Primitives-Contract.md
├─ 07-UI-Module-Composition-Contract.md
├─ 08-UI-Host-API-Contract.md
├─ 09-UI-Module-Lifecycle-Contract.md
├─ 10-UI-Module-Folder-Structure-Guide.md
├─ 11-UI-Module-Scaffolding-CLI.md
└─ 12-UI-Module-Contract-Rules.md
```

Each document must be kept in sync with **code**, not vice-versa.

---

## 4 — Runtime routing model (this is critical)

### There are **three kinds of routes** in LaSyncro

#### 1. Static host routes (compile-time)

Defined in:

```
apps/frontend/src/routes.tsx
```

Examples:

* `/dashboard`
* `/login`
* `/analytics`
* `/finances`

These always exist and are rendered immediately.

---

#### 2. Runtime-registered module routes

Registered **after boot** via:

```ts
hostApi.registerRoute({
  id: 'orders-home',
  path: '/orders',
  component: OrdersPage,
  requiredModuleId: 'order-nexus'
});
```

Stored in:

```
apps/frontend/src/runtime/registerRoute.ts
```

Accessed via:

```ts
getRegisteredRoutes()
```

These routes **do not exist at initial render**.

---

#### 3. Static bridge routes (required for refresh & deep links)

Because runtime routes are async, **every module with a top-level path MUST have a static bridge**:

```tsx
<Route path="/orders/*" element={<ModuleHost />} />
```

Without this:

* `/orders` works on click
* `/orders` FAILS on refresh

This is intentional and documented behavior.

---

## 5 — Entitlements & ProtectedRoute semantics

### `ProtectedRoute` is authoritative

File:

```
apps/frontend/src/components/ProtectedRoute.tsx
```

Responsibilities:

* Block unauthenticated users
* Wait for entitlements to resolve
* Enforce route-level entitlements
* Handle **runtime route timing**

### Critical rule (non-negotiable)

> Runtime module routes MUST NOT be rejected before modules finish registering.

Therefore `ProtectedRoute` **explicitly allows**:

```ts
/orders/*
/modules/*
```

during bootstrap if the user is authenticated.

This prevents:

* Redirect loops
* Refresh failures
* Broken deep links

If you change this logic, you must update:

* This README
* `docs/ui/05-UI-Routing-Contract.md`

---

## 6 — Adding a new UI module (step-by-step)

1. Scaffold:

```bash
node scripts/scaffold-ui-module.js <module-id> --force
```

2. Implement descriptor:

```json
{
  "id": "order-nexus",
  "displayName": "Orders",
  "entitlements": ["order-nexus"]
}
```

3. Implement `ModuleEntry.register()`:

```ts
export function register(hostApi: HostApi) {
  hostApi.registerRoute({
    id: 'orders-home',
    path: '/orders',
    component: OrdersPage,
    requiredModuleId: 'order-nexus'
  });

  hostApi.addNavItem({
    id: 'orders',
    label: 'Orders',
    path: '/orders'
  });
}
```

4. Add **static bridge route** in host:

```tsx
<Route path="/orders/*" element={<ModuleHost />} />
```

5. Validate & test:

```bash
node scripts/validate-modules.js
npx jest tests/contract --runInBand
```

---

## 7 — Code & template locations

### Canonical contracts (single source of truth)

```
modules/shared/src/ui-contracts.ts
```

Defines:

* HostApi
* RouteDescriptor
* NavItemDescriptor
* EntitlementSnapshot
* ModuleDescriptor

---

### Runtime helpers (host)

```
apps/frontend/src/runtime/
├─ registerRoute.ts
├─ registerNav.ts
├─ ModuleHost.tsx
├─ ModuleBootstrap.tsx
```

---

### Auth & entitlements

```
apps/frontend/src/contexts/
├─ AuthContext.tsx
├─ EntitlementsContext.tsx
```

---

## 8 — Contract tests & CI

CI workflow:

```
.github/workflows/ci-ui-modules.yml
```

Runs:

* Descriptor validation
* Contract tests
* Type checks

Each module **must** have:

* Descriptor schema validity
* `register()` contract test
* Route entitlement behavior test

---

## 9 — Troubleshooting (real failure modes)

### ❌ `/orders` works on click but not refresh

Cause:

* Missing static bridge route

Fix:

```tsx
<Route path="/orders/*" element={<ModuleHost />} />
```

---

### ❌ Redirect to `/dashboard` on refresh

Cause:

* `ProtectedRoute` rejecting runtime route before registration

Fix:

* Allow `/orders` + `/modules/*` during bootstrap

---

### ❌ White screen on load

Cause:

* `FormattedMessage` without `id`
* Intl error bubbles without boundary

Fix:

* Always provide `id`
* Wrap app in `IntlErrorBoundary`

---

## 10 — Handoff checklist (do not skip)

**High priority**

1. Keep static bridge routes in sync with module mount paths
2. Never entitlement-gate runtime routes synchronously
3. Treat `modules/shared/src/ui-contracts.ts` as law
4. Update docs when touching routing or auth

**Medium**

5. Add route-contract tests to every module scaffold
6. Storybook coverage for gated states

**Low**

7. Governance process (UICR) in doc 12
8. Auto-generated per-module README

---

## 11 — Appendix

### registerRoute example

```ts
hostApi.registerRoute({
  id: 'orders-home',
  path: '/orders',
  component: OrdersPage,
  requiredModuleId: 'order-nexus'
});
```

### Static bridge example

```tsx
<Route path="/orders/*" element={<ModuleHost />} />
```

---

## Final note (read this)

This architecture is **intentionally conservative**:

* Refresh must never break
* Auth must never race routing
* Runtime extensibility must not compromise stability

If you simplify it and something “mysteriously” breaks later — it’s because you violated one of the contracts documented here.
