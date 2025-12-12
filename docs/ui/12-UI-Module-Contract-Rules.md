# 12 — UI Module Contract Rules (STRICT)

This document defines the **strict, enforceable contract** every UI module in LaSyncro must follow. The goal is to guarantee consistent module shape, predictable lifecycle, safe host interaction, and machine-checkable rules so CI can block regressions that break modularity.

## Summary (TL;DR)

* Modules must export a `register(host)` async function (or default export with `register`).
* `register()` returns a `registration` object with lifecycle hooks: `mount`, `onMount`, `onActivate`, `onDeactivate`, `onUnmount`.
* Modules must *not* import host internals (no `apps/frontend/src/*` imports); instead use the `host` passed to `register()` or host-provided globals documented here.
* Modules must **declare** UI primitives (routes, navItems, navGroups) in their descriptor and either call the host API *or return* them from `mount`/`onMount` so the harness can assert registration.
* CI enforces rules via unit contract tests, ESLint plugin checks, and a tiny validation script.

---

## 1. Export shape (required)

A UI module must export one of the following:

```ts
// ESM default
export default { register };

// Named export
export async function register(host: HostApi) { /* ... */ }
```

`register(host)` must be a function (sync or async). The test harness will call it and expect a `registration` object (or function) back.

### Required return shape

The value returned by `register()` must be an object containing at least a `mount` property. Lifecycle hooks are optional but recommended.

```ts
{
  mount: () => any | Promise<any>,
  onMount?: (ctx) => Promise<void> | void,
  onActivate?: (ctx) => Promise<void> | void,
  onDeactivate?: (ctx) => Promise<void> | void,
  onUnmount?: (ctx) => Promise<void> | void,
}
```

If `register()` returns a function directly, tests will treat it as `mount`.

---

## 2. Declaring UI primitives (routes / nav)

Modules declare their UI surface via a `descriptor` object (or by calling `host.registerRoute` / `host.addNavItem`). Prefer *declarative descriptors* so static tooling can analyze modules.

Descriptor example:

```ts
export const descriptor = {
  id: 'order-nexus',
  name: 'Order Nexus',
  version: '0.1.0',
  routes: [{ id: 'orders', path: '/orders', component: OrdersPage, requiredModuleId: 'order-nexus' }],
  navItems: [{ id: 'orders', title: 'Orders', path: '/orders', order: 50 }],
};
```

### Rules

* Every route must include `id`, `path`, and `component` (or `lazyComponent` reference). `requiredModuleId` optional but encouraged.
* `navItems` must include `id`, `title`, and `path`.
* Modules must either **call** the `host.registerRoute()` and `host.addNavItem()` inside `register()`/`mount`, or **return** the descriptors in a canonical location where the harness will extract them.

---

## 3. Host API usage only — No runtime file-level imports

Modules **must not** import host internal modules directly. Forbidden import patterns (examples):

* `import { something } from 'apps/frontend/src/...'`
* `import { registerRoute } from 'runtime/registerRoute'` (host runtime functions must be consumed via the `host` object passed to `register()`)

Allowed pattern (host-provided):

```ts
export async function register(host) {
  host.registerRoute(...);
  host.addNavItem(...);
}
```

This rule guarantees module isolation and allows modules to be compiled and tested in isolation.

---

## 4. Lifecycle semantics

* `mount` is executed when the host mounts the module UI. It may return descriptors if the module prefers to return instead of calling host APIs.
* `onMount` is called once after the host completes mounting; use for async bootstrapping.
* `onActivate` / `onDeactivate` are for route-level activation (optional).
* `onUnmount` will be called before module unload/HMR.

All lifecycle hooks should be resilient: swallow expected host errors and only throw in fatal conditions.

---

## 5. Forbidden behaviors (CI-enforced)

CI will fail modules that:

* Import host implementation paths via path aliases (see `forbidden-imports` list).
* Mutate global state on module import (immutability at file-top-level). All side-effects must be in lifecycle hooks.
* Access `window` host APIs directly instead of the `host` object (except for read-only config snapshots intentionally allowed).

---

## 6. Test harness & CI enforcement

We provide three enforcement layers:

1. **Contract Jest tests** (`tests/contract/*.contract.test.ts`) — load each module with the harness, assert:

   * `register(host)` exists and returns `registration`.
   * `host.registerRoute()` or returned descriptor registered expected routes.
   * `host.addNavItem()` or returned nav items present.
   * Lifecycle hooks present and callable.

2. **ESLint rule** (`eslint-plugin-lasyncro`) — a small custom rule to detect forbidden imports (matching alias patterns like `apps/frontend/*`, `runtime/*` direct imports) and disallow top-level side-effects (no `registerRoute()` calls at top-level).

3. **Build-time validation script** (`scripts/validate-modules.js`) — scans `modules/*/src` for `descriptor` objects and runs a JSON schema validator to confirm the descriptor shape.

CI job steps (example):

* `npm run lint:modules` (ESLint with plugin)
* `npm run test:contract` (`npx jest tests/contract --runInBand`)
* `node ./scripts/validate-modules.js`

If any of these fail, the PR is blocked.

---

## 7. Minimal ESLint rule spec (for `eslint-plugin-lasyncro`)

* Rule `lasyncro/no-host-imports`: error when import path matches: `^apps/frontend/`, `^runtime/`, `^ui-component/` (configurable allow-list).
* Rule `lasyncro/no-top-level-side-effects`: error when module calls host APIs at file scope (e.g., `registerRoute(...)` executed outside of function).

---

## 8. Example contract test (reference)

See `tests/contract/contractHarness.ts` and example test `tests/contract/orderNexus.contract.test.ts` — the harness mocks `host` and asserts `state.registeredRoutes` and `state.navItems`.

Add to CI: `tests/contract/**/*.contract.test.ts` run under `backend` (node) project.

---

## 9. Migration guidance

For existing modules that violate the new rules:

1. Convert top-level `registerRoute()` calls to either:

   * Call `host.registerRoute()` inside `register()`; or
   * Return `descriptor.routes` from `mount`/`register()` and let host register them.
2. Remove direct imports from `apps/frontend/*` and instead use host-provided APIs passed to `register(host)`.
3. Add descriptor validation and unit tests to show compliance.

---

## 10. Quick onboarding checklist for new module authors

1. Run `npm run scaffold:ui-module <module-id>` (creates canonical structure).
2. Open `src/ModuleEntry.ts` — ensure `register(host)` uses `host.registerRoute()` and `host.addNavItem()`.
3. Add `descriptor` with `routes` and `navItems` and unit tests under `modules/<id>/test` that call the harness locally.
4. Push — CI will validate.

---

## 11. Where to enforce & next steps

* Add `tests/contract` to CI pipeline.
* Add `eslint-plugin-lasyncro` rules in `.eslintrc` and run `npm run lint:modules` in CI.
* Add `scripts/validate-modules.js` to fail PRs if descriptors are malformed.

---

## Appendix A — Descriptor JSON schema (draft)

{
  type: 'object',
  required: ['id', 'routes'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'string' },
    routes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id','path'],
        properties: {
          id: { type: 'string' },
          path: { type: 'string' }
        }
      }
    },
    navItems: { type: 'array' }
  }
}

---
