### **Host → Module API Surface Contract**

**Version:** 1.0
**Status:** Locked & Enforced
**Owner:** UI Platform Architecture

---

# **1. Purpose**

This contract defines the **complete, stable API surface** provided by the LaSyncro **Host UI Platform** to any module.

A module may only use what is defined here.

If it’s not in this contract → the module **must not import or rely on it**.

This ensures:

* No accidental dependency on host internals
* No cross-module leakage
* Stable behavior across versions
* Guaranteed compatibility for all modules

This contract is enforced via:

* Type declarations (`runtime/index.d.ts`)
* Host unit tests
* Module contract tests
* CI bundle checks

---

# **2. What Counts as “Host API”?**

Anything exposed under:

```
import { ... } from 'runtime'
import { ... } from 'runtime/<feature>'
```

—and nothing else.

Modules are **forbidden** from importing directly from:

```
apps/frontend/src/*
components/*
contexts/*
pages/*
layouts/*
utils/*
```

or any implementation detail not explicitly defined in this contract.

---

# **3. Host API Overview**

| API Category                | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| **Module Registry API**     | Register and unregister a module with the host       |
| **Route Registry API**      | Declare module routes                                |
| **Navigation Registry API** | Declare sidebar/top-nav items                        |
| **Layout Slot API**         | Access layout slots (future capability)              |
| **Host Lifecycle API**      | Callbacks and events the host exposes                |
| **Utility/Helpers**         | Stable primitives (navigation, entitlement snapshot) |

Everything listed below is part of the *official* API surface.

---

# **4. Module Registry API (Required)**

### **4.1 `registerModule(descriptor)`**

Registers a module with the host:

```ts
registerModule({
  id: string;
  name?: string;
  version?: string;
  icon?: string;
  category?: string;
});
```

**Rules:**

* Must be called exactly **once per module**.
* `id` must be unique.
* Module metadata is used by settings pages, analytics, and debugging.

---

### **4.2 `unregisterModule(id: string)`**

Used only in:

* Test environments
* Hot-reload scenarios
* Module unload environments (future)

Never needed in production code.

---

### **4.3 `getRegisteredModules()`**

Retrieves the list of modules known to the host.

Read-only.

---

# **5. Route Registry API (Required)**

## 5.1 `registerRoute(routeDescriptor)`

Registers a route belonging to the module.

```ts
registerRoute({
  id: string;                 // required
  path: string;               // required
  name?: string;
  component: React.FC;        // required
  layout?: React.FC;          // required for module pages
  requiredModuleId?: string;
  requiredFlagId?: string;
  meta?: Record<string, any>;
  upgradeRoute?: string;
  order?: number;             // default: 1000
});
```

### **Host guarantees**

The host:

* Stores the route in the merged registry
* Enforces entitlement checks
* Renders the module layout for module pages
* Redirects unauthorized users
* Makes the route available to navigation registry

### **Module responsibilities**

* Must supply a layout for module pages.
* Must not define conflicting routes.
* Must not override host routes.

---

## 5.2 `unregisterRoute(id: string)`

Used in tests and future hot-reload systems.

---

## 5.3 `getRegisteredRoutes()`

Returns the final merged route list (static + dynamic).

Modules should treat this as **read-only**.

---

# **6. Navigation Registry API (Optional)**

Modules may define their navigation items.

### **6.1 `registerNavItem(navItem)`**

```ts
registerNavItem({
  id: string;
  routeId: string;         // must refer to registered route
  label: string;
  icon?: string;
  order?: number;          // determines sidebar position
  category?: string;       // optional grouping
});
```

### **6.2 `unregisterNavItem(id)`**

Tests only.

### **6.3 `getRegisteredNavItems()`**

Read-only. The host sorts nav items by order automatically.

---

# **7. Layout Slot API (Reserved / Limited)**

The host defines global layout areas:

* **topBar**
* **sideNav**
* **modulePageShell**
* **actionBar** (future)
* **breadcrumbs** (future)

### Future API Surface (documented now, shipped later)

```ts
host.layoutSlots.register('my-slot-id', MyComponent);
```

Modules **may not use this yet** — implementing modules using future APIs will fail CI.

---

# **8. Host Lifecycle API**

Modules may optionally use lifecycle hooks.

### **8.1 `host.on(eventName, callback)`**

Allowed events:

```
'route:enter'
'route:leave'
'entitlements:changed'
'module:init'
```

### Example:

```ts
host.on('route:enter', (ctx) => {
  console.log('Entered route', ctx.routeId);
});
```

### Event context:

```ts
{
  routeId: string;
  path: string;
  params?: Record<string, string>;
}
```

---

# **9. Navigation Helper API**

### **9.1 `navigate(path: string, options?)`**

Simple wrapper around `window.history` (and compatible with React Router).

```ts
navigate('/orders/123', { replace: true });
```

### Host guarantees:

* Works in all environments (SPA + micro-frontend future)
* No dependency on react-router hooks from modules

---

# **10. Entitlement Snapshot API**

Modules may read the entitlement snapshot at runtime:

```ts
host.getEntitlements(): {
  modules: string[];
  flags: string[];
}
```

This is **read-only**.

Modules must **not** implement their own entitlements logic.

---

# **11. Error Boundary Hooks (Optional)**

Module screens may throw, and the host will catch them.

Modules may define:

```ts
export const lifecycle = {
  onError(error, info) {
    // module-level crash analytics
  }
}
```

---

# **12. Forbidden API Usage**

Modules must NEVER:

* Import from `apps/frontend/src/*`
* Import from host React Router
* Access Redux store
* Import MUI theme directly
* Add their own global CSS
* Mutate design tokens
* Manipulate host navigation DOM
* Modify host error boundaries
* Use window-level navigation listeners

Violations break contract and will fail contract tests.

---

# **13. Runtime Types Provided to Modules**

All types made available to modules live in:

```
runtime/index.d.ts
```

Including:

* `RouteDescriptor`
* `ModuleDescriptor`
* `NavItemDescriptor`
* `HostApi`
* `LifecycleHooks`

Modules must not rely on types outside this file.

---

# **14. CI Contract Enforcement**

CI ensures that:

* All modules import only allowed APIs
* No cross-module imports occur
* All required exports exist
* No missing layout wrappers
* Route IDs are unique
* Module IDs are unique

Contract drift is not tolerated.

---

# **15. Versioning & Governance**

Changes require:

* Architecture approval
* Semver bump
* Migration guide if breaking
* Update to contract tests
* Regeneration of runtime types

---

# **Document 08 Complete.**

---