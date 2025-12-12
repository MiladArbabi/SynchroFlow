### **UI Module Lifecycle Contract**

**Version:** 1.0
**Status:** Locked
**Owner:** UI Platform Architecture

---

# **1. Purpose**

This contract defines the **complete lifecycle model** for LaSyncro UI modules.

It answers:

* **When does a module load?**
* **When does it register routes/nav items?**
* **When does it receive entitlement or context updates?**
* **How does the host notify modules about runtime events?**
* **How should modules clean up, reload, or rehydrate?**

This contract provides the *canonical* lifecycle the host guarantees to all modules.

---

# **2. Design Principles**

The lifecycle is designed around five principles:

1. **Deterministic execution**
   Modules must initialize in the same order every time.

2. **Side-effect isolation**
   Modules must not mutate host state except through official APIs.

3. **Graceful degradation**
   Modules must fail safely and not affect the host shell.

4. **Predictable rehydration**
   Modules must sync with entitlements, navigation, and layout changes.

5. **Future compatibility**
   Lifecycle must remain stable even when micro-frontend isolation is introduced.

---

# **3. High-Level Lifecycle Overview**

```
┌─────────────────────────────┐
│ 0. Module Imported (Static) │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 1. Module Bootstrap         │  ← host loads module entrypoint
│    registerModule()         │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 2. Registration Phase       │  ← module declares routes, nav, assets
│    registerRoute()          │
│    registerNavItem()        │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 3. Ready Phase              │  ← host acknowledges module as active
│    lifecycle.onInit()       │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 4. Activation Phase         │  ← user navigates to module page
│    lifecycle.onRouteEnter() │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 5. Runtime Updates          │
│    lifecycle.onEntitlementChange()
│    lifecycle.onContextChange()
└───────────────┬─────────────┘
                │
                ▼
┌──────────────────────────────┐
│ 6. Deactivation Phase        │  ← user leaves module route
│    lifecycle.onRouteLeave()  │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│ 7. Cleanup Phase (Optional)  │  ← hot reload, module unload
│    lifecycle.onDestroy()     │
└──────────────────────────────┘
```

This lifecycle applies to every module, regardless of whether it is:

* Statically linked
* Dynamically imported
* Lazy-loaded
* Loaded through future MFEs

---

# **4. Lifecycle Phases in Detail**

## **4.1 Phase 0 — Module Imported (Static)**

Occurs immediately when JS imports the module entrypoint.

The module **must not** execute side effects outside:

* `registerModule()`
* `registerRoute()`
* `registerNavItem()`

Anything else (network requests, DOM manipulation) is forbidden at import time.

---

## **4.2 Phase 1 — Module Bootstrap**

The module's entrypoint must register itself:

```ts
registerModule({
  id: 'order-nexus',
  name: 'Order Nexus',
  version: '1.0.0'
});
```

**Purpose:**

* Establish the module’s identity
* Prepare host tracking
* Enable debugging and analytics
* Make module visible to contract tests

**Rules:**

* Must be called once
* Must be called synchronously during module import
* Must use the module’s globally unique ID

---

## **4.3 Phase 2 — Registration Phase**

The module declares its UI contributions:

### **Routes**

```ts
registerRoute({
  id: 'orders-list',
  path: '/orders',
  component: OrdersPage,
  layout: ModulePageLayout,
  requiredModuleId: 'order-nexus'
});
```

### **Navigation Items**

```ts
registerNavItem({
  id: 'orders-nav',
  routeId: 'orders-list',
  label: 'Orders'
});
```

**All registration must be synchronous and deterministic.**

---

## **4.4 Phase 3 — Ready Phase**

After registration completes, the host notifies the module:

```ts
export const lifecycle = {
  onInit() {
    // initialize module-level analytics, preload data, etc.
  }
};
```

**Rules:**

* Called exactly once in module lifetime
* Must not register additional routes/nav items
* May start internal lazy loads
* May prepare caches

---

## **4.5 Phase 4 — Activation Phase (Route Enter)**

Triggered when the user enters a route owned by the module.

```ts
export const lifecycle = {
  onRouteEnter(ctx) {
    // ctx.routeId
    // ctx.path
    // ctx.params
  }
};
```

**Use cases:**

* Load module page-level data
* Start long-poll or subscription
* Track analytics events
* Warm caches

---

## **4.6 Phase 5 — Runtime Updates**

Modules may receive updates from the host:

### **Entitlements Changed**

```ts
onEntitlementChange(snapshot) {
  // snapshot.modules
  // snapshot.flags
}
```

### **Host Context Changed**

*(Workspace, language, theme, etc.)*

```ts
onContextChange(ctx) {
  // ctx.locale, ctx.workspaceId, ctx.theme, etc.
}
```

Modules must adapt without a full rerender.

---

## **4.7 Phase 6 — Deactivation Phase (Route Leave)**

Triggered when user navigates away from a module route.

```ts
onRouteLeave(ctx) {
  // clean up local transient state
}
```

**Use cases:**

* Stop timers/subscriptions
* Cancel pending requests
* Release in-memory data
* Reset transient UI state

---

## **4.8 Phase 7 — Cleanup Phase**

Called when:

* A module is hot-reloaded in development
* A module is disabled/uninstalled (future)
* The host is shutting down the module context

```ts
onDestroy() {
  // full cleanup
}
```

**Rules:**

* Module must release all resources
* No new registration calls allowed

---

# **5. Full Lifecycle Hook Specification**

A module may export an optional object:

```ts
export const lifecycle = {
  onInit: () => void,
  onRouteEnter: (ctx) => void,
  onRouteLeave: (ctx) => void,
  onEntitlementChange: (snapshot) => void,
  onContextChange: (ctx) => void,
  onDestroy: () => void
};
```

Hooks may be omitted; the host treats missing hooks as no-ops.

---

# **6. Lifecycle Context Shape**

### **6.1 Route Context**

```ts
{
  routeId: string;
  path: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}
```

---

### **6.2 Entitlement Snapshot**

```ts
{
  modules: string[];
  flags: string[];
}
```

---

### **6.3 Host Context**

```ts
{
  locale: string;
  workspaceId: string | null;
  theme: 'light' | 'dark' | string;
}
```

---

# **7. Forbidden Behaviors**

Modules must **never**:

* Register routes/nav items in async callbacks
* Re-register anything after onInit
* Modify other modules’ lifecycle handlers
* Access host context outside of the provided snapshot
* Create global singletons shared across modules
* Reliably depend on route order outside the contract

Violations trigger CI failures.

---

# **8. Testing Compliance (CI Gate)**

The lifecycle contract is validated by:

* Contract tests
* Module entrypoint static analysis
* Runtime checks
* Route/nav registration validators

Any deviation causes module rejection.

---

# **9. Versioning & Change Management**

Lifecycle changes require:

* Architecture review
* Semver major bump
* Migration documentation
* Regeneration of runtime type declarations

---

# **Lifecycle Contract Complete.**

---