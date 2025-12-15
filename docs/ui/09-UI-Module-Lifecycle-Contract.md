# UI Module Lifecycle Contract

**Version:** 2.0  
**Status:** Normative — Enforced  
**Owner:** UI Platform Architecture  
**Last updated:** 2025-12

---

## 1. Purpose

This contract defines the **authoritative lifecycle model** for LaSyncro UI modules.

It specifies:

- when a module is initialized,
- how it registers routes and navigation,
- how it reacts to routing and entitlement changes,
- how cleanup must be performed,
- and how the host communicates lifecycle events.

This contract is **normative**.  
Modules that deviate from it are considered non-compliant.

---

## 2. Architectural alignment

This lifecycle contract is explicitly aligned with:

- **08-UI-Host-API-Contract.md** (Host API surface)
- **05-UI-Routing-Contract.md** (routing & entitlements)
- **05-Minimal-UI-API-Contract.md** (consumption rules)

### Important clarification

The host **does not call arbitrary lifecycle functions** on modules.

Instead:

- Modules register themselves via `register(hostApi)`
- Modules subscribe to lifecycle **events** via `host.on(...)`

This ensures:

- deterministic behavior,
- testability,
- future MFE compatibility.

---

## 3. High-level lifecycle overview

```
┌─────────────────────────────┐
│ 0. Module Imported          │
│    (static import)          │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 1. Module Registration      │
│    register(hostApi)        │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 2. Declaration Phase        │
│    registerRoute()          │
│    registerNavItem()        │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 3. Initialization Event     │
│    host.on('module:init')   │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 4. Route Activation         │
│    host.on('route:enter')   │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 5. Runtime Updates          │
│    entitlements / context   │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 6. Route Deactivation       │
│    host.on('route:leave')   │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│ 7. Cleanup / Teardown       │
│    unsubscribe callbacks    │
└─────────────────────────────┘
```

This lifecycle applies to:

- statically bundled modules,
- dynamically loaded modules,
- future micro-frontends.

---

## 4. Phase-by-phase contract

### 4.1 Phase 0 — Module import

Occurs when the module entry file is imported.

**Rules:**

- No side effects
- No network calls
- No DOM access
- No host API usage

Only definitions and exports are allowed.

---

### 4.2 Phase 1 — Module registration

Each module **must export** a `register(hostApi)` function.

```typescript
export function register(host: HostApi) {
  // registration logic
}
```

**Rules:**

- Must be synchronous
- Must be idempotent
- Must be called exactly once per module instance

This is the only entry point into the module.

### 4.3 Phase 2 — Declaration phase

Inside `register(hostApi)`, the module declares its contributions.

**Routes**

```typescript
host.registerRoute({
  id: 'orders.list',
  path: '/orders',
  component: OrdersPage,
  requiredModuleId: 'order-nexus'
});
```

**Navigation**

```typescript
host.registerNavItem({
  id: 'orders',
  routeId: 'orders.list',
  label: 'Orders'
});
```

**Rules:**

- All declarations must be synchronous
- No conditional registration
- No async registration
- No re-registration later

### 4.4 Phase 3 — Initialization event

The host emits:

```typescript
host.on('module:init', () => {
  // module-level initialization
});
```

**Intended usage:**

- warm caches
- initialize analytics
- prepare internal services

**Rules:**

- Fired exactly once
- Must not register routes or nav items
- May start async work

### 4.5 Phase 4 — Route activation

Triggered when the user enters a route owned by the module.

```typescript
host.on('route:enter', (ctx) => {
  // ctx.routeId
  // ctx.path
  // ctx.params
});
```

**Allowed behavior:**

- fetch page-level data
- start subscriptions
- log analytics events

### 4.6 Phase 5 — Runtime updates

**Entitlements changed**

```typescript
host.on('entitlements:changed', (snapshot) => {
  // snapshot.modules
  // snapshot.flags
});
```

**Context updates (future-safe)**

Context changes may include:

- locale
- workspace
- theme

Modules must adapt without re-registering anything.

### 4.7 Phase 6 — Route deactivation

Triggered when the user leaves a module-owned route.

```typescript
host.on('route:leave', (ctx) => {
  // cleanup transient state
});
```

**Required cleanup:**

- stop timers
- cancel requests
- unsubscribe listeners

### 4.8 Phase 7 — Cleanup / teardown

Cleanup is implicit via unsubscribing from host events.

```typescript
const unsubscribe = host.on('route:enter', handler);

// later
unsubscribe();
```

**Occurs during:**

- hot reload
- module unload (future)
- host shutdown

No further host calls are allowed.

---

## 5. Lifecycle event reference

| Event name | Fired when |
|------------|------------|
| `module:init` | Module fully registered |
| `route:enter` | Route owned by module becomes active |
| `route:leave` | Leaving module-owned route |
| `entitlements:changed` | Entitlement snapshot updated |

These are the only supported lifecycle events.

---

## 6. Context object shapes

**Route context**

```typescript
{
  routeId: string;
  path: string;
  params?: Record<string, string>;
}
```

**Entitlement snapshot**

```typescript
{
  modules: string[];
  flags: string[];
}
```

---

## 7. Forbidden behaviors

Modules must never:

- register routes or nav items asynchronously
- register after `module:init`
- assume lifecycle order beyond this contract
- access host internals
- create cross-module singletons
- rely on implicit cleanup

Violations are CI-fatal.

---

## 8. Testing & enforcement

This contract is enforced by:

- static analysis of `register(hostApi)`
- contract test harness
- runtime validation
- CI gating

A module that violates lifecycle rules will not ship.

---

## 9. Versioning & change management

Any lifecycle change requires:

- architecture approval
- semver-major bump
- migration guide
- updated runtime types
- updated contract tests
