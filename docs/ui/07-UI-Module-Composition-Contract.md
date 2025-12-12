### **Hybrid Composition Contract (Strict externally, flexible internally)**

**Version:** 1.0
**Status:** Locked & Governed
**Owner:** UI Platform Architecture
**Applies to:** All LaSyncro modules (OrderNexus, Specter, SKU-OS, WMS Lite, ReturnNexus, InsightCore, Problem Center)

---

# **1. Purpose**

This contract defines **how a module composes its UI**, including:

* How the module presents itself to the host.
* How module routes, layouts, and screens must be structured.
* What the host guarantees and what the module must guarantee.
* What boundaries **must not be violated**.
* What lifecycle hooks exist.
* What minimum exports are required.
* What naming/structure conventions apply.

This document bridges all previous UI contracts:

* 02 Component Library Contract
* 03 Design Tokens Contract
* 04 Layout Contract
* 05 Routing Contract
* 06 UI Primitives Contract

This contract ensures that **modules remain autonomous but compatible**, while preventing architecture drift.

---

# **2. The Composition Model (Hybrid)**

Modules have:

### **Strict External Contract (host depends on this)**

❗ **Cannot be violated**

* Must export a **ModuleEntry.tsx**.
* Must export a **register(host)** function.
* Must export a **ModuleDescriptor** object.
* Must register routes using `registerRoute`.
* Must register module metadata using `registerModule`.
* Must supply a `ModuleLayout` wrapper.
* Must use Layout slots correctly.
* Must define entitlement requirements using fields defined in Routing Contract.
* Must not import from other modules' internals.

---

### **Flexible Internal Structure (module developers may choose)**

✔ Can vary by module

* How screens, components, hooks, and logic are organized inside the module.
* Whether screens are nested or flat.
* Whether features use local state, react-query, zustand, or redux-toolkit (as long as host boundaries aren’t crossed).
* Whether components are colocated with features.
* Whether additional sub-layouts exist inside the module.

---

# **3. Required Top-Level Structure**

All modules **must** follow this minimal tree:

```
modules/<module-name>/
  src/
    ModuleEntry.tsx
    ModuleDescriptor.ts
    ModuleLayout.tsx
    routes/
      index.ts     (optional; recommended)
    screens/       (optional naming)
    components/    (optional naming)
    hooks/         (optional)
    ...
  dist/
```

Internal folders are **allowed to vary**, but these three files are **mandatory**:

### **1 — ModuleDescriptor.ts**

Exports:

```ts
export const ModuleDescriptor = {
  id: 'order-nexus',
  name: 'Order Nexus',
  version: '1.0.0',

  // optional but recommended
  icon: 'orders',
  category: 'ops'
} as const;
```

### **2 — ModuleLayout.tsx**

Module-specific layout must wrap all module pages.

```tsx
export default function ModuleLayout({ children }) {
  return (
    <ModulePageShell title="Order Nexus">
      {children}
    </ModulePageShell>
  );
}
```

### **3 — ModuleEntry.tsx**

Must export `register(host)`.

```ts
export function register(host: HostApi) {
  host.registerModule(ModuleDescriptor);

  host.registerRoute({
    id: 'orders-list',
    path: '/orders',
    name: 'Orders',
    component: OrdersListScreen,
    layout: ModuleLayout,
    requiredModuleId: 'order-nexus'
  });

  // nav items (optional)
  host.registerNavItem({
    id: 'orders-nav',
    routeId: 'orders-list',
    label: 'Orders',
    icon: 'orders',
    order: 200
  });
}
```

---

# **4. Module Boundaries (Mandatory Rules)**

These protect the platform:

### ❌ Forbidden

* Importing any file from another module (no cross-module leakage).
* Directly manipulating the host router.
* Rendering pages without wrapping with ModuleLayout.
* Bypassing entitlement checks.
* Using global layout primitives incorrectly.
* Creating new design tokens — must follow 03 Design Tokens Contract.
* Creating custom versions of primitives defined in 06 UI Primitives Contract.

### ✔ Allowed

* Internal sub-layouts.
* Internal state management.
* Custom domain logic.
* Colocation of components/screens.
* Lazy-loading screens using dynamic import.
* Feature-level conditional rendering.

---

# **5. Allowed Imports (Strict)**

Modules may import from:

**Host-level APIs:**

```
runtime/registerRoute
runtime/registerModule
runtime/layoutSlots
runtime/host-api-types
```

**Platform primitives:**

```
ui/primitives/*
ui/components/*
```

**Design tokens:**

```
ui/tokens/*
```

**Shared code:**

```
@lasyncro/shared/*
```

**Local module code:**

```
./components/*
./screens/*
./hooks/*
```

---

# **6. Lifecycle Hooks (Optional)**

Modules may define lifecycle hooks:

```
onInit(host)
onBeforeRouteEnter(route, host)
onAfterRouteEnter(route, host)
```

These are optional and must be exported like:

```ts
export const lifecycle = {
  onInit: () => { ... },
  onAfterRouteEnter: (route) => { ... }
};
```

If present, host automatically calls them.

---

# **7. Layout Composition Rules**

Modules must wrap every screen using the module’s layout:

### Correct

```tsx
<Route
  path="/orders"
  element={
    <ModuleLayout>
      <OrdersListScreen />
    </ModuleLayout>
  }
/>
```

### Incorrect

```tsx
<Route path="/orders" element={<OrdersListScreen />} />   ❌
```

The host will enforce this by contract tests.

---

# **8. Routing Rules (Strict)**

Modules must use the Minimal Routing Contract:

Required fields for a route:

```
id
path
name
component
layout
requiredModuleId?      // entitlement
requiredFlagId?
meta?
upgradeRoute?
order?
```

Modules **MUST NOT:**

* Override global routes.
* Use unregistered route IDs.
* Register the same route twice.

---

# **9. Navigation Rules**

The module may optionally define nav items:

```ts
host.registerNavItem({
  id: 'orders-nav',
  routeId: 'orders-list',
  label: 'Orders',
  icon: 'orders',
  order: 200
});
```

Nav items:

* Must point to an existing routeId.
* Must not exceed order collision handling rules.

---

# **10. Required Test Coverage for Each Module**

Each module must include:

### **1 — Contract test**

Ensures:

* register() exists
* ModuleDescriptor valid
* registerRoute is used correctly
* layout is exported
* no boundary violations

### **2 — Screen-level tests**

At least 1 critical screen must have a render test.

### **3 — Entitlement gating test**

Confirms 403 screen or placeholder behavior.

---

# **11. Future Enforcement (Reserved)**

Future versions may introduce:

* Slot registry tests
* SSR compatibility rules
* Micro-frontend federation rules
* Auto-generated module API docs

---

# **12. Governance**

All changes to this document require:

* UI Platform approval
* Version bump
* Migration guide (if breaking)
* CI contract tests updated

---
