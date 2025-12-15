# 12 — UI Module Contract Rules (ENFORCED)

**Version:** 2.0  
**Status:** Locked & Enforced  
**Owner:** UI Platform Architecture

This document defines the **non-negotiable rules** every UI module in LaSyncro must follow.

It does **not** introduce new architecture.
It **codifies enforcement** of the contracts defined in Docs 07–11.

If a rule appears here, it is:

- machine-checkable
- CI-enforced
- required for merge

---

## 1. Authoritative sources

This document derives its rules from:

- 07 — UI Module Composition Contract
- 08 — UI Host API Contract
- 09 — UI Module Lifecycle Contract
- 10 — UI Module Folder Structure Guide
- 11 — UI Module Scaffolding CLI

If a conflict exists, **Docs 07–09 win**.

---

## 2. Required exports (absolute)

Every module **MUST** export:

### 2.1 `ModuleDescriptor`

```ts
export const descriptor = {
  id: string,
  version: string,
  displayName: string,
  mountPath?: string,
  entitlements?: string[]
}
````

Rules:

- Metadata only
- No routes
- No nav items
- No logic

---

### 2.2 `register(host: HostApi)`

```ts
export function register(host: HostApi) {
  // synchronous only
}
```

Rules:

- MUST be synchronous
- MUST be idempotent
- MUST call host APIs directly
- MUST return `{ mount?, lifecycle? }`
- MUST NOT return routes or nav descriptors

---

## 3. Route & navigation rules (strict)

### 3.1 Routes

- MUST be registered via `host.registerRoute()`
- MUST be registered **inside `register(host)`**
- MUST include `id`, `path`, `component`
- MUST declare entitlement via `requiredModuleId` if gated

❌ Returning routes is forbidden
❌ Registering routes asynchronously is forbidden
❌ File-system scanning is forbidden

---

### 3.2 Navigation

- MUST be registered via `host.registerNavItem()`
- MUST reference an existing `routeId`
- MUST NOT contain entitlement logic

---

## 4. Lifecycle rules (Doc 09 only)

Allowed lifecycle hooks:

```ts
export const lifecycle = {
  onInit?,
  onRouteEnter?,
  onRouteLeave?,
  onEntitlementChange?,
  onContextChange?,
  onDestroy?
}
```

Rules:

- Hooks are optional
- Hooks must be pure
- Hooks must not register routes/nav
- Hooks must tolerate repeated calls

All other lifecycle shapes are invalid.

---

## 5. Import boundaries (hard enforcement)

Modules MUST NOT import from:

```
apps/frontend/**
modules/** (other than self)
runtime/* (runtime behavior)
```

Modules MAY import:

- runtime **types**
- ui primitives
- shared packages
- local module files

Violation = CI failure.

---

## 6. Side-effect rules

❌ No side-effects at file scope
❌ No global state mutation
❌ No route/nav registration outside `register()`

All behavior must be triggered by the host lifecycle.

---

## 7. CI enforcement layers

CI enforces this contract via:

### 7.1 Contract tests

Located in:

```
tests/contract/<module-id>.contract.test.ts
```

They assert:

- register(host) exists
- module registers ≥1 route
- module registers nav items correctly
- lifecycle hooks are callable
- idempotency

---

### 7.2 Static analysis

- Forbidden imports
- Top-level side effects
- Missing required exports

---

### 7.3 Build validation

- Independent TypeScript build
- Declaration output exists
- No runtime dependency leaks

---

## 8. Forbidden patterns (auto-fail)

❌ Async `register()`
❌ Returning routes or nav items
❌ Descriptor-driven routing
❌ File-system inferred modules
❌ Importing host internals
❌ Multiple module entrypoints
❌ Mutating entitlements snapshot

---

## 9. Migration guidance

If a module violates this contract:

1. Move all registration logic into `register(host)`
2. Convert descriptor routes/nav → host API calls
3. Align lifecycle to Doc 09
4. Remove forbidden imports
5. Add/update contract test

---

## 10. Enforcement authority

- CI is the final arbiter
- Platform Architecture owns exceptions
- No local overrides allowed

---
