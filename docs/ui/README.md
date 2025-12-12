# README — UI Contracts, Blueprints & Module Tooling (LaSyncro)

**Purpose:** This repository section holds the canonical UI *contracts*, module blueprints, module scaffolding tooling and the tiny runtime helpers that let frontend feature modules attach themselves to the LaSyncro host safely. This README explains the 12 core UI documents, where related code and templates live, how to scaffold / validate / test modules, and the practical next steps for an engineer picking up the work.

If you only read one thing: follow the *Quick start* and the *Handoff checklist* at the end.

---

# Table of contents

1. Quick start — dev commands and immediate tasks
2. Project map — the 12 docs and their supporting files (one-by-one)
3. Code & templates locations (what to edit when)
4. How to add a new UI module (step-by-step)
5. Contract tests & CI (what runs where)
6. Migration & runtime helpers (registerRoute, ProtectedRoute semantics, entitlements)
7. Troubleshooting & common failure modes
8. Handoff checklist — prioritized tasks for the next engineer
9. Appendix — examples & useful snippets

---

# 1 — Quick start

Clone, install, and run the validation & contract tests locally:

```bash
# From repo root
# prefer a clean lockfile state (we use npm workspaces)
npm ci

# Validate module descriptors (fast)
node scripts/validate-modules.js

# Run UI contract tests (single-threaded)
npx jest tests/contract --runInBand

# Typecheck relevant packages
npx tsc -p modules/shared/tsconfig.json
```

If you want to scaffold a module (dev only):

```bash
node scripts/scaffold-ui-module.js <module-id> --force
# Example:
node scripts/scaffold-ui-module.js order-nexus-test --force
```

---

# 2 — Project map — the 12 documents + what sits with them

The docs live under `docs/ui/`. Each document is described below with its purpose, owner suggestions, and the code/artifacts that must be kept in sync.

> List of the 12 documents (files):
> `docs/ui/01-UI-Module-Index.md`
> `docs/ui/02-Component-Library-Contract.md`
> `docs/ui/03-Design-Tokens-Contract.md`
> `docs/ui/04-UI-Layout-Contract.md`
> `docs/ui/05-Minimal-UI-API-Contract.md`
> `docs/ui/05-UI-Routing-Contract.md` *(routing draft)*
> `docs/ui/06-UI-Primitives-Contract.md`
> `docs/ui/07-UI-Module-Composition-Contract.md`
> `docs/ui/08-UI-Host-API-Contract.md`
> `docs/ui/09-UI-Module-Lifecycle-Contract.md`
> `docs/ui/10-UI-Module-Folder-Structure-Guide.md`
> `docs/ui/11-UI-Module-Scaffolding-CLI.md`
> `docs/ui/12-UI-Module-Contract-Rules.md`

Below are short, actionable descriptions for each.

---

## 01 — UI Module Index (`docs/ui/01-UI-Module-Index.md`)

**Purpose:** Single-page inventory of product & infra UI modules (routes, owners, entitlements, blueprint link).
**Keep in sync with:** `apps/frontend/src/routes.tsx`, `modules/*/descriptor.json`.
**Action items:** Add blueprint stubs (under `docs/ui/04-Module-UI-Blueprints/`) and set owner/reviewer for each module.

---

## 02 — Component Library Contract (`docs/ui/02-Component-Library-Contract.md`)

**Purpose:** Authoritative minimal API for host-provided UI primitives (Button/Input/DataGrid/etc).
**Keep in sync with:** `apps/frontend/src/ui-component/` (implementation), Storybook stories, tests.
**Action items:** Ensure any new primitive is added in the contract and Storybook + unit tests exist.

---

## 03 — Design Tokens Contract (`docs/ui/03-Design-Tokens-Contract.md`)

**Purpose:** Canonical tokens (color, spacing, typography, radii, shadows, z-index).
**Keep in sync with:** token files (suggested `tokens/` or `modules/shared/src/tokens/`), MUI theme mapping, design-system source of truth.
**Action items:** Add token JSON + mapping examples to MUI theme. Add token-driven dark-mode examples to Storybook.

---

## 04 — UI Layout Contract (`docs/ui/04-UI-Layout-Contract.md`)

**Purpose:** Module-first layout interface: slots, ModuleLayoutProps, HostApi surface shape.
**Keep in sync with:** `modules/shared/src/ui-contracts.ts` (types), host layout code (slots & providers).
**Action items:** Convert any ad-hoc layout slot usage in modules to the slot contract.

---

## 05 — Minimal UI API Contract (`docs/ui/05-Minimal-UI-API-Contract.md`)

**Purpose:** Minimal runtime API + canonical primitive list modules must rely on (this is the single small host → module surface).
**Keep in sync with:** `modules/shared/src/ui-contracts.ts` and the runtime helper `apps/frontend/src/runtime/registerRoute.ts`.
**Action items:** Ensure HostApi functions exist and are stable; list required primitives mapping to `ui-component`.

---

## 05 (routing) — UI Routing Contract (`docs/ui/05-UI-Routing-Contract.md`)

**Purpose:** Canonical route descriptor, static vs dynamic registration, entitlements guard behavior and ProtectedRoute contract.
**Keep in sync with:** `apps/frontend/src/routes.tsx`, `apps/frontend/src/components/ProtectedRoute.tsx` (or wrapper), runtime `registerRoute` shim.
**Action items:** Implement `registerRoute()` shim in host and update router to use `mergeRoutes(staticRoutes)`.

---

## 06 — UI Primitives Contract (`docs/ui/06-UI-Primitives-Contract.md`)

**Purpose:** More complete details of primitives not covered in 02 (edge cases, virtualization, performance constraints).
**Keep in sync with:** primitives implementation and tests (e.g., DataGrid virtualization needs).
**Action items:** Harden performance tests for heavy primitives.

---

## 07 — UI Module Composition Contract (`docs/ui/07-UI-Module-Composition-Contract.md`)

**Purpose:** Rules for composing modules (dependencies / requiredModules / entitlements / allowed imports).
**Keep in sync with:** module descriptor validation script `scripts/validate-modules.js`.
**Action items:** Add validation checks for `requiredModules` and `entitlements` shape.

---

## 08 — UI Host API Contract (`docs/ui/08-UI-Host-API-Contract.md`)

**Purpose:** The host-side APIs (HostApi, telemetry, nav registry, event bus) with exact method names & behaviours.
**Keep in sync with:** host runtime implementations (router, nav, telemetry).
**Action items:** Implement the minimal HostApi and add unit tests for it.

---

## 09 — UI Module Lifecycle Contract (`docs/ui/09-UI-Module-Lifecycle-Contract.md`)

**Purpose:** `register()`, `mount`, `onMount`, `onActivate`, `onDeactivate`, `onUnmount` contract rules.
**Keep in sync with:** modules' `ModuleEntry.tsx` implementations and `tests/contract` harness.
**Action items:** Add lifecycle unit tests to modules; ensure host calls hooks in expected order.

---

## 10 — UI Module Folder Structure Guide (`docs/ui/10-UI-Module-Folder-Structure-Guide.md`)

**Purpose:** Recommended folder layout inside each `modules/<module>/` package.
**Keep in sync with:** `scripts/templates/ui-module/` and the scaffold script.
**Action items:** Keep scaffold templates current with the guide.

---

## 11 — UI Module Scaffolding CLI (`docs/ui/11-UI-Module-Scaffolding-CLI.md`)

**Purpose:** Docs for `scripts/scaffold-ui-module.js` (usage, tokens, templates).
**Keep in sync with:** `scripts/scaffold-ui-module.js` and `scripts/templates/ui-module/`.
**Action items:** Update README sections inside the doc when you change template tokens or file list.

---

## 12 — UI Module Contract Rules (`docs/ui/12-UI-Module-Contract-Rules.md`)

**Purpose:** High-level governance: review/approval process, deprecation policy, testing & CI requirements.
**Keep in sync with:** org policies and CI workflows.
**Action items:** Add explicit UICR process (UI Change Request) and approval owners.

---

# 3 — Code & templates locations (what to edit where)

Small map of important files and directories the handoff engineer will need:

* `modules/shared/src/ui-contracts.ts`
  — canonical TypeScript interfaces for HostApi, ModuleDescriptor, RouteDescriptor, EntitlementSnapshot, etc. **Single source of truth for types.**

* Module folders: `modules/<module-id>/` (examples present)

  * `modules/order-nexus/` (actual module)
  * `modules/specter/`
  * `modules/shared/`
  * `modules/order-nexus-test/`, `modules/my-test-module/` (scaffolds)
  * inside each module: `src/ui/ModuleEntry.tsx`, `src/descriptor.json`, `ModuleEntry.stub.js`, `package.json`, `tsconfig.json`

* Scaffolding:

  * `scripts/scaffold-ui-module.js` — create a module scaffold using templates and tokens.
  * `scripts/templates/ui-module/` — template files:

    * `ModuleEntry.tsx` / `.hbs`
    * `ModuleDescriptor.ts` / `.hbs`
    * `package.json.hbs`
    * `tsconfig.json.hbs`
    * `src/descriptor.json.hbs`
    * example page/component files

* Host runtime helpers:

  * `apps/frontend/src/runtime/registerRoute.ts` — *(recommended shim)* where the `registerRoute`, `unregisterRoute`, `mergeRoutes` helpers live.
  * `apps/frontend/src/components/ProtectedRouteWrapper.tsx` — canonical protective wrapper for gating.
  * `apps/frontend/src/contexts/EntitlementsContext.tsx` — entitlements provider + `useEntitlements()`.

* CI workflow:

  * `.github/workflows/ci-ui-modules.yml` — validates modules + runs contract tests in CI.

* Contract tests harness:

  * `tests/contract/contractHarness.ts` and `tests/contract/*` — the test harness used to validate modules' `register()` contract.

---

# 4 — How to add a new UI module (step-by-step)

1. Run scaffold:

   ```bash
   node scripts/scaffold-ui-module.js <module-id> --force
   ```

   This creates `modules/<module-id>/` with `src/ui/ModuleEntry.tsx`, `ModuleDescriptor.ts`, `src/descriptor.json`, `package.json`, `tsconfig.json`, example pages.

2. Fill the module:

   * Implement `ModuleDescriptor` (id, displayName, mountPath, entitlements, register function).
   * Implement `ModuleEntry.register(hostApi)` to call `hostApi.registerRoute()` and `hostApi.addNavItem()` and return `mount` + lifecycle hooks.
   * Add UI pages & components under `src/ui/pages` and `src/ui/components`.

3. Add tests:

   * Add `modules/<module-id>/tests/route-contract.spec.tsx` (template provided).
   * Add `ModuleEntry.stub.js` usage if needed for contract harness.

4. Validate:

   ```bash
   node scripts/validate-modules.js
   npx jest tests/contract --runInBand
   ```

5. Commit only the module folder + `package.json` / minor lockfile changes. If lockfile changes after scaffolding, run `npm install` and commit the regenerated `package-lock.json` (we regenerate lockfile once per consistent scaffold).

---

# 5 — Contract tests & CI

**What CI does (file):** `.github/workflows/ci-ui-modules.yml`
It runs:

* `node scripts/validate-modules.js` — validates module descriptors + presence of `descriptor.json`.
* `npx jest tests/contract --runInBand` — runs contract tests (host harness + module stubs).

**Per-module checks modules must include:**

* descriptor shape test
* register() returns `mount` and lifecycle hooks if needed
* route entitlements resilience tests (entitlements === null, missing entitlement behavior)
* navigation test (mock host expects `navigate()` calls)

**Where to add new CI checks:** Add to `tests/contract/` or per-module `modules/<module>/tests` and ensure CI picks them up.

---

# 6 — Migration & runtime helpers (summary & where to change)

We want to support **dynamic** module registration while keeping a stable static route list during migration.

**Key helpers you must maintain:**

* `registerRoute(route)` — runtime entry for modules to add routes.

  * Location recommended: `apps/frontend/src/runtime/registerRoute.ts`
  * Host must call `mergeRoutes(staticRoutes)` and render the merged list.

* `ProtectedRouteWrapper` — enforces gating contract:

  * Location recommended: `apps/frontend/src/components/ProtectedRouteWrapper.tsx`
  * Rules enforced:

    * No gating metadata → render
    * `entitlements === null` → show lightweight loading skeleton
    * Missing entitlement → show `GatedPlaceholder`

* `EntitlementsContext` / `useEntitlements()`:

  * Location: `apps/frontend/src/contexts/EntitlementsContext.tsx`
  * Must expose `EntitlementSnapshot | null` (null while resolving).
  * Host should replace placeholder fetch logic with real subscription to entitlement state.

* `modules/shared/src/ui-contracts.ts` is the canonical type shape; keep it updated when HostApi or route/descriptor shapes change.

---

# 7 — Troubleshooting — common failure modes & fixes

* **`npm ci` failing due to lockfile mismatch after scaffolding**
  If new workspace packages were added by scaffold, the lockfile will be out of sync. Fix: run `npm install` at repo root, commit updated `package-lock.json`, then run `npm ci` for clean installs in CI.

* **TypeScript errors complaining about missing `@types`**
  Ensure `@types/node`, `@types/jest`, etc. are installed at repo root (devDependencies) or in appropriate workspace.

* **Tests failing because entitlements shape differs**
  Ensure `modules/shared/src/ui-contracts.ts` matches the `EntitlementsContext` shape used in `ProtectedRouteWrapper` and tests.

* **Watchman recrawl warnings on mac**
  Run `watchman watch-del <path>` and `watchman watch-project <path>` as suggested in the test logs, or increase watch limits.

* **Scaffolded module failing validate-modules**
  Check `src/descriptor.json` exists (scaffold copies it to module root). `scripts/validate-modules.js` requires descriptor fields; compare to other working modules.

* **Module contract tests pass locally but fail in CI**
  Ensure CI runs with the same Node/npm version (actions/setup-node@v4 uses node-version: '20' in CI workflows). Also ensure `npm ci` lockfile consistency.

---

# 8 — Handoff checklist — prioritized, actionable

High priority (blocking):

1. Wire `mergeRoutes(staticRoutes)` in host router and call `getRegisteredRoutes()` from `apps/frontend/src/runtime/registerRoute.ts`. (So dynamic routes can surface.)
2. Make `ProtectedRouteWrapper` the canonical wrapper used by the router. Replace duplicates.
3. Ensure `modules/shared/src/ui-contracts.ts` is imported by modules and host (type-level contract).
4. Add per-module `route-contract.spec.tsx` templates to module scaffolds so new modules include routing tests.

Medium priority (stability & docs):
5. Add Storybook stories covering `GatedPlaceholder`, `ModuleLayout` slots, and primitives used widely (DataGrid, Card).
6. Add token JSON and MUI mapping to shared tokens directory (and link `docs/ui/03-Design-Tokens-Contract.md` to that location).
7. Add an example module migration PR that converts `apps/frontend/src/pages/OrdersPage` into `modules/order-nexus` `ModuleEntry` with `register()`.

Lower priority (governance & polish):
8. Add UICR process to `docs/ui/12-UI-Module-Contract-Rules.md` (required reviewers, 2-release deprecation policy).
9. Add `scripts/generate-module-readme.sh` to automatically populate per-module README from blueprint template.

---

# 9 — Appendix — useful snippets & examples

**registerRoute usage (module register()):**

```ts
export function register(hostApi: HostApi) {
  hostApi.registerRoute({
    id: 'orders-home',
    name: 'Orders',
    key: 'orders',
    path: '/orders',
    component: OrdersPage,
    requiredModuleId: 'order-nexus',
    order: 100
  });
  hostApi.addNavItem({ id: 'orders', label: 'Orders', path: '/orders', order: 200 });
  return { mount: ModuleLayout };
}
```

**ProtectedRouteWrapper mapping in router:**

```tsx
const final = mergeRoutes(staticRoutes);
return (
  <Routes>
    {final.map(r => (
      <Route key={r.id} path={r.path} element={
         <ProtectedRouteWrapper descriptor={r}>
           <Suspense fallback={<Skeleton/>}>{React.createElement(r.component as any)}</Suspense>
         </ProtectedRouteWrapper>
      } />
    ))}
  </Routes>
)
```

**Where to update docs when changing API:**

* `docs/ui/05-Minimal-UI-API-Contract.md` — small API changes
* `modules/shared/src/ui-contracts.ts` — types + interfaces
* `scripts/validate-modules.js` — validation rules (descriptor schema)

---

# Final notes & ownership

* **Owner for this repo area:** `frontend-platform` (recommended).
* **Immediate next deliverable for the on-call engineer:** implement `registerRoute()` shim and wire `mergeRoutes()` into the host router; ensure `ProtectedRouteWrapper` is used for all route elements. Then run the contract tests.

---
