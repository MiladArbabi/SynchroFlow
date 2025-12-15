# UI Module Folder Structure Guide

**Version:** 3.0  
**Status:** Normative — Enforced  
**Owner:** UI Platform Architecture  
**Audience:** Module authors, UI platform maintainers, CI/runtime owners

---

## 0. Purpose (What this document is — and is not)

This document defines the **filesystem-level structure** for LaSyncro UI modules.

It exists to ensure:

- deterministic builds
- predictable module entrypoints
- CI contract test compatibility
- long-term maintainability

This document **does not** define:
- runtime behavior
- routing rules
- lifecycle semantics
- entitlement logic

Those are defined in:
- 05 — UI Routing Contract
- 07 — UI Module Composition Contract
- 08 — UI Host API Contract
- 09 — UI Module Lifecycle Contract

If this document conflicts with any of the above, **this document is wrong**.

---

## 1. Core principles

### 1.1 Explicit over inferred
The host **never scans folders** to infer behavior.  
All behavior is declared via `register(hostApi)`.

### 1.2 Structure supports humans, not runtime
Folder layout exists to help developers reason about modules — not to drive execution.

### 1.3 Isolation by default
A module must compile, test, and reason about itself in isolation.

---

## 2. Canonical minimal structure (MANDATORY)

Every UI module **must** contain:

```

modules/<module-id>/
src/
ui/
ModuleEntry.tsx
ModuleDescriptor.ts
ModuleLayout.tsx
package.json
tsconfig.json

````

Nothing else is required.

---

## 3. Mandatory files (authoritative)

### 3.1 `ModuleDescriptor.ts`

Metadata only.

```ts
export const descriptor = {
  id: 'order-nexus',
  version: '1.0.0',
  displayName: 'Order Nexus',
  mountPath: '/orders',
  entitlements: ['order-nexus']
};
````

Rules:

* No logic
* No imports from host
* No side effects

---

### 3.2 `ModuleEntry.tsx`

The **only runtime entrypoint**.

```ts
export function register(host: HostApi) {
  host.registerRoute(...);
  host.registerNavItem(...);
}
```

Rules:

* Synchronous
* Idempotent
* No rendering
* No lifecycle logic
* No async work

---

### 3.3 `ModuleLayout.tsx`

Wraps **all pages belonging to the module**.

Rules:

* Must not access router directly
* Must use host-provided layout primitives
* Must not override global theme

---

## 4. Recommended internal structure (NON-AUTHORITATIVE)

Modules may organize internal code freely.

A common, recommended pattern:

```
src/
  ui/
    pages/
    components/
    hooks/
  domain/
    types/
    entities/
  api/
    client.ts
    services/
  state/
    queries/
    mutations/
```

This structure is **recommended**, not enforced.

---

## 5. Explicitly forbidden structures

The following are **not allowed**:

❌ `src/routes/` as a source of truth
❌ `src/navigation/` as a registry
❌ `lifecycle.ts` files
❌ filesystem-driven behavior
❌ host runtime imports
❌ cross-module imports

All runtime behavior must go through `HostApi`.

---

## 6. Testing placement & authority

### 6.1 Authoritative tests (CI-enforced)

Located at repo root:

```
tests/
  contract/
  unit/
  integration/
```

* Contract tests validate module compliance
* Runtime behavior is tested here

---

### 6.2 Module-local tests (developer-only)

Modules may include:

```
modules/<id>/src/__tests__/
```

These are:

* optional
* developer-scoped
* never relied upon by CI for contract enforcement

---

## 7. Contract test expectations

Every module must have a test in:

```
tests/contract/<module-id>.contract.test.ts
```

That test validates:

* `register(host)` exists
* routes are registered correctly
* nav items are registered correctly
* no forbidden imports
* idempotent behavior

---

## 8. Build & tsconfig expectations

Each module must:

* compile standalone
* emit `.d.ts`
* not rely on monorepo path hacks

Minimal `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"]
}
```

---

## 9. CI enforcement summary

CI will fail if a module:

* lacks required files
* violates Host API boundaries
* registers routes dynamically
* uses filesystem inference
* leaks cross-module imports
* violates routing or lifecycle contracts

---

## 10. Migration notes

If a module previously relied on:

* `routes/index.ts`
* `navigation/index.ts`
* `lifecycle.ts`

Those must be **deleted** and behavior moved into:

```ts
register(hostApi)
host.on(...)
```

---