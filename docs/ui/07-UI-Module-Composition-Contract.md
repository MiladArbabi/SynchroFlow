# UI Module Composition Contract

**Version:** 2.0  
**Status:** Normative — Enforced  
**Owner:** UI Platform Architecture  
**Applies to:** All LaSyncro UI modules

---

## 1. Purpose

This contract defines **how UI modules are composed**, integrated, and isolated within the LaSyncro platform.

It specifies:

- what a module must expose,
- how it declares routes and navigation,
- how it integrates with the host (and only the host),
- what boundaries must never be crossed,
- how composition remains stable as the platform evolves.

This document is **normative**.  
Violations are CI-fatal.

---

## 2. Composition model (hybrid, by design)

Modules follow a **hybrid model**:

### A. Strict external contract (host-facing)

These rules are **non-negotiable**:

- A module **must export** a `register(hostApi)` function
- A module **must define** a `ModuleDescriptor`
- A module **must declare** routes via `host.registerRoute()`
- A module **must declare** navigation via `host.registerNavItem()` (optional)
- A module **must provide** a `ModuleLayout` for its pages
- A module **must not** access host internals directly
- A module **must not** import from other modules

The host depends on this contract.

---

### B. Flexible internal structure (module-owned)

Modules are free to decide:

- folder layout
- state management strategy
- screen organization
- internal sub-layouts
- data fetching approach

As long as the external contract is respected.

---

## 3. Required module structure

Each module **must** expose the following artifacts:

```

modules/<module-id>/
src/
ui/
ModuleEntry.tsx
ModuleDescriptor.ts
ModuleLayout.tsx
components/
pages/
hooks/
tests/
package.json

````

Folder naming inside `ui/` is flexible.  
The **three files above are mandatory**.

---

## 4. Required exports

### 4.1 ModuleDescriptor

```ts
export const descriptor = {
  id: 'order-nexus',
  version: '1.0.0',
  displayName: 'Order Nexus',
  mountPath: '/orders',
  entitlements: ['order-nexus']
};
````

**Rules:**

- `id` must be globally unique
- Descriptor is **data only**
- No logic, no side effects

---

### 4.2 ModuleLayout

Every module page is rendered inside this layout.

```tsx
export default function ModuleLayout({ children }) {
  return (
    <ModulePageShell title="Order Nexus">
      {children}
    </ModulePageShell>
  );
}
```

Modules must **not** bypass their layout.

---

### 4.3 ModuleEntry (`register(hostApi)`)

```ts
export function register(host: HostApi) {
  host.registerRoute({
    id: 'orders.list',
    path: '/orders',
    component: OrdersListPage,
    requiredModuleId: 'order-nexus'
  });

  host.registerNavItem({
    id: 'orders',
    routeId: 'orders.list',
    label: 'Orders',
    order: 200
  });
}
```

**Rules:**

- Must be synchronous
- Must be idempotent
- Must only use `hostApi`
- Must not render UI
- Must not subscribe to lifecycle events here

---

## 5. Host API usage rules

Modules may **only** interact with the platform via `HostApi`.

Allowed:

```ts
host.registerRoute(...)
host.registerNavItem(...)
host.navigate(...)
host.on('route:enter', ...)
```

Forbidden:

- importing `runtime/*`
- importing `apps/frontend/*`
- importing router hooks
- manipulating layout DOM
- accessing other modules

---

## 6. Lifecycle integration (event-driven)

Modules **do not export lifecycle hooks**.

Instead, they subscribe to host lifecycle events:

```ts
host.on('module:init', () => { ... });
host.on('route:enter', ctx => { ... });
host.on('route:leave', ctx => { ... });
host.on('entitlements:changed', snapshot => { ... });
```

This is the **only supported lifecycle mechanism**.

See:
📄 `09-UI-Module-Lifecycle-Contract.md`

---

## 7. Routing composition rules

Modules:

- **declare routes**
- **do not render `<Route>`**
- **do not control router configuration**

Each route descriptor must follow the Routing Contract (05).

Required fields:

```
id
path
component
requiredModuleId?
requiredFlagId?
order?
meta?
```

The host:

- merges routes
- applies entitlements
- renders layouts
- handles redirects

---

## 8. Navigation composition rules

Navigation is declarative.

```ts
host.registerNavItem({
  id: 'orders',
  routeId: 'orders.list',
  label: 'Orders',
  order: 200
});
```

Rules:

- `routeId` must exist
- ordering is advisory
- host owns final rendering

---

## 9. Boundary enforcement (hard rules)

Modules must never:

- import from another module
- re-register routes dynamically
- assume route order
- access host context directly
- override design tokens
- introduce global CSS
- implement their own entitlement logic

---

## 10. Required test coverage

Each module must include:

1. **Composition contract test**

   - `register()` exists
   - descriptor valid
   - routes registered
   - no forbidden imports

2. **Routing test**

   - route renders when entitled
   - gated placeholder when not

3. **Layout test**

   - pages render inside ModuleLayout

CI enforces all three.

---

## 11. Forward compatibility

This contract is compatible with:

- lazy loading
- micro-frontends
- SSR
- runtime federation

Modules written against this contract **will not need rewrites**.

---

## 12. Governance

Changes require:

- UI Platform approval
- semver bump
- migration guide
- updated contract tests
- updated runtime types

---
