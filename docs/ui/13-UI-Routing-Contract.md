# UI Routing Contract — LaSyncro (Normative)

**Status:** **Authoritative / Normative**
**Owner:** frontend-platform
**Scope:** Frontend runtime routing, module registration, entitlements guarding
**Applies to:** All current and future UI modules

---

## 1. Purpose (Normative)

This document defines the **mandatory routing rules** for LaSyncro’s frontend.

It is **normative**, not descriptive:

* Modules **must** follow this contract
* Host implementations **may evolve**, but **must preserve these guarantees**
* Any deviation is considered a **breaking architectural violation**

This contract exists to ensure:

* Route persistence across refresh & deep links
* Safe, centralized entitlement enforcement
* Decoupling between modules and host internals
* Predictable navigation, even under async entitlement resolution

---

## 2. Core Principles (Non-Negotiable)

### 2.1 Runtime-first routing

All feature routes are **registered at runtime**.

Static routes:

* are **not** the source of truth
* exist **only** as bootstrap and refresh bridges
* must never encode feature logic

> If a route does not survive refresh without a static bridge, the architecture is incomplete.

---

### 2.2 Module ownership of routes

* Every feature route belongs to **exactly one module**
* Modules declare intent; the host owns enforcement
* Modules never manipulate router internals directly

---

### 2.3 Centralized guarding

Entitlement checks **must not** be duplicated.

All of the following **must** use the same guard logic:

* Route rendering
* Side navigation visibility
* Programmatic navigation
* Deep-link refresh resolution

The canonical guard is `isRouteEnabled(...)`.

---

### 2.4 Asynchronous entitlements are first-class

`entitlements === null` means **unknown**, not denied.

**During this state:**

* No redirects
* No silent failures
* No partial feature rendering

Only loading or neutral placeholders are allowed.

---

## 3. Canonical Runtime Route Model

Modules do **not** define React Router routes directly.

They declare **runtime route descriptors**, owned and normalized by the host.

```ts
interface RuntimeRoute {
  id: string;                    // stable, globally unique
  key: string;                   // stable key (telemetry, nav)
  name: string;                  // human-readable
  path: string;                  // absolute path (e.g. /orders)
  moduleId: string;              // owning module
  requiredModuleId?: string;     // entitlement gate (module)
  requiredFlagId?: string;       // entitlement gate (flag)
  order?: number;                // navigation ordering hint
  meta?: {
    showGatedPlaceholder?: boolean;
    [key: string]: any;
  };
}
```

**Explicitly forbidden:**

* React components in route descriptors
* Direct JSX binding
* React Router–specific flags (`exact`, etc.)

Rendering is handled by the **ModuleHost**, not the route.

---

## 4. Host Responsibilities (Mandatory)

The host **must**:

1. Maintain a **runtime route registry**
2. Provide deterministic APIs:

   * `registerRoute(route)`
   * `getRegisteredRoutes()`
3. Merge:

   * static bridge routes
   * runtime module routes
4. Enforce entitlement guards **centrally**
5. Guarantee refresh & deep-link safety

### Static bridge rule (mandatory)

For every top-level module route (`/orders`), the host **must** provide a static bridge:

```tsx
<Route path="/orders/*" element={<ModuleHost />} />
```

This is **not optional**.

---

## 5. Module Responsibilities (Mandatory)

Modules **must**:

1. Register routes **only** inside their `register(hostApi)` entry
2. Declare entitlement requirements declaratively
3. Assume:

   * entitlements may be unresolved
   * navigation may be denied
4. Never:

   * redirect based on entitlements
   * import router internals
   * hardcode fallbacks

### Example (normative)

```ts
export function register(hostApi: HostApi) {
  hostApi.registerRoute({
    id: 'orders.home',
    key: 'orders',
    name: 'Orders',
    path: '/orders',
    moduleId: 'order-nexus',
    requiredModuleId: 'order-nexus',
    order: 200
  });

  hostApi.addNavItem({
    id: 'orders',
    label: 'Orders',
    path: '/orders',
    order: 200
  });
}
```

---

## 6. Rendering Model (Authoritative)

### 6.1 ModuleHost is the only renderer

* Routes never render pages directly
* `ModuleHost` resolves:

  * active module
  * internal module routing
  * lifecycle hooks

```tsx
<Route path="/modules/:moduleId/*" element={<ModuleHost />} />
<Route path="/orders/*" element={<ModuleHost />} /> // static bridge
```

---

## 7. Guarding & Entitlement Semantics (Strict)

### 7.1 Guard algorithm (normative)

Given `(route, entitlements)`:

1. **No gating metadata** → allow
2. **Entitlements = null**

   * show loading boundary
   * do not redirect
3. **Missing required module/flag**

   * show `GatedPlaceholder` (preferred)
   * or redirect to safe route (`/dashboard`)
4. **Satisfied** → render via `ModuleHost`

This logic **must be identical** everywhere.

---

## 8. Navigation Rules (Mandatory)

* Modules must navigate via host APIs or router hooks
* Cross-module navigation **must assume denial**
* Host intercepts gated navigation attempts

Forbidden:

* `window.location` (except external)
* guessing entitlement state
* manual redirects

---

## 9. Refresh & Deep Link Guarantees

The system **must guarantee**:

| Scenario              | Expected Result    |
| --------------------- | ------------------ |
| `/orders` refresh     | Orders page loads  |
| `/orders/:id` refresh | Order detail loads |
| Entitlements pending  | Loading boundary   |
| Entitlement denied    | Gated placeholder  |
| Module removed        | Safe redirect      |

If any of these fail, the routing system is **broken**.

---

## 10. Testing & CI Requirements (Mandatory)

Every module **must** include:

1. Route registration test
2. Entitlement = null test
3. Entitlement denied test
4. Refresh/deep-link test (via static bridge)
5. Nav visibility test

Host CI **must** fail if:

* routes bypass guards
* redirects occur during entitlement resolution
* static bridges are missing

---

## 11. Governance

Changes to:

* route model
* guard semantics
* registration APIs

require approval from **frontend-platform**.

Modules that violate this contract **must not be merged**.

---

## 12. Final Assertion (Non-negotiable)

> **If a route works on click but not on refresh, the architecture is wrong.**

This contract exists to ensure that never happens again.

---
