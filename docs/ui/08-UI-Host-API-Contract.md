## UI Host API Contract — LaSyncro (Normative)

**Version:** 2.0
**Status:** **Authoritative / Normative**
**Owner:** frontend-platform

---

## 1. Purpose (Normative)

This document defines the **only allowed API surface** exposed by the LaSyncro UI host to frontend modules.

It is **normative**:

* Modules **must** follow it
* Host implementations **may change**
* Guarantees defined here **must never break**

If an API is not defined here, **modules must not rely on it**.

---

## 2. Design Principles (Non-negotiable)

1. **Declarative, not imperative**
2. **Renderer-agnostic**
3. **Runtime-first**
4. **Entitlements enforced centrally**
5. **No JSX or React types at the API boundary**

---

## 3. What Counts as Host API

Modules may import **only** from:

```ts
import { HostApi } from 'runtime'
import { registerRoute, registerNavItem } from 'runtime'
```

Modules must **never** import from:

```
apps/frontend/src/*
components/*
contexts/*
layouts/*
routes.tsx
```

Violations are contract failures.

---

## 4. Module Registry API (Required)

### `registerModule(descriptor)`

```ts
registerModule({
  id: string;           // required, stable
  name?: string;
  version?: string;
  icon?: string;
  category?: string;
});
```

Rules:

* Must be called **once**
* `id` is immutable across releases
* Used for telemetry, settings, debugging

---

## 5. Route Registry API (Authoritative)

### 5.1 `registerRoute(route)`

Registers **intent**, not rendering.

```ts
registerRoute({
  id: string;                    // stable, unique
  key: string;                   // stable nav/telemetry key
  name: string;                  // display name
  path: string;                  // absolute path (/orders)
  moduleId: string;              // owning module
  requiredModuleId?: string;     // entitlement gate
  requiredFlagId?: string;       // entitlement gate
  order?: number;                // nav ordering
  meta?: {
    showGatedPlaceholder?: boolean;
    [key: string]: any;
  };
});
```

### Explicitly forbidden

* JSX
* React components
* Layout references
* React Router flags

---

### 5.2 Host guarantees

The host **must**:

* Persist the route in a runtime registry
* Enforce entitlements via a single guard
* Resolve refresh & deep links
* Delegate rendering to `ModuleHost`
* Make the route visible to navigation registry

---

## 6. Rendering Model (Mandatory)

Routes **never render components directly**.

All module routes resolve through:

```tsx
<ModuleHost />
```

Static routes exist **only** as refresh bridges:

```tsx
<Route path="/orders/*" element={<ModuleHost />} />
<Route path="/modules/:moduleId/*" element={<ModuleHost />} />
```

If refresh breaks, the host is incomplete.

---

## 7. Navigation Registry API

### `registerNavItem(navItem)`

```ts
registerNavItem({
  id: string;
  path: string;          // must match registered route
  label: string;
  icon?: string;
  order?: number;
  category?: string;
});
```

Navigation visibility **must** respect the same entitlement guard as routing.

---

## 8. Navigation Helper API

### `navigate(path, options?)`

```ts
navigate('/orders/123', { replace?: boolean });
```

Rules:

* Host-owned
* Router-agnostic
* Modules must assume navigation may be denied

---

## 9. Entitlement Snapshot API

```ts
getEntitlements(): {
  modules: string[];
  flags: string[];
} | null;
```

Rules:

* `null` = unresolved
* Modules must not infer or cache entitlements
* All enforcement is host-owned

---

## 10. Lifecycle & Events

```ts
host.on(event, callback)
```

Allowed events:

* `route:enter`
* `route:leave`
* `entitlements:changed`
* `module:init`

Lifecycle hooks must **never** mutate routing or nav.

---

## 11. Forbidden Usage (Hard rules)

Modules must NOT:

* Import React Router
* Register JSX routes
* Provide layouts to host
* Redirect based on entitlements
* Read host state directly
* Touch DOM outside module root

Violations are CI failures.

---

## 12. Runtime Types (Single Source of Truth)

All shared types live in:

```
runtime/index.d.ts
```

Including:

* `HostApi`
* `RuntimeRoute`
* `NavItemDescriptor`
* `EntitlementSnapshot`

No other types are allowed.

---

## 13. Governance

Changes require:

* frontend-platform approval
* SemVer bump
* Migration notes
* Contract test updates

---

## Final Assertion

> **The Host API defines intent.
> The Host owns execution.
> Modules declare — they do not control.**

---
