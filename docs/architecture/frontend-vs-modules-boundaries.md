# Frontend (`apps/frontend`) vs Modules (`modules/*`)

## Boundary, Ownership & Import Contract

**Status:** 🔒 LOCKED
**Applies to:** All engineers, all code, all tests
**Last enforced:** 2025-12-21

---

## 1. Purpose of This Document

This document exists to **eliminate ambiguity** around:

* What lives in `apps/frontend`
* What lives in `modules/*`
* Who owns logic vs rendering
* How imports must work
* Why deep imports are forbidden

If this document is violated, **the architecture regresses**, even if the code “works”.

---

## 2. High-Level Mental Model (Non-Negotiable)

> **`modules/*` define capabilities.
> `apps/frontend` composes experiences.**

One does **not** replace the other.
They serve **different layers of the system**.

---

## 3. Directory Roles (Authoritative)

### 3.1 `modules/*` — Product Capabilities (Portable)

```
modules/
├── shared/
├── order-nexus/
├── products/
├── analytics/
├── customers/
└── finances/
```

**Modules represent:**

* Business capabilities
* Reusable logic
* UI building blocks
* Domain semantics

They are designed to be:

* Portable
* Testable in isolation
* Reused across apps
* Buildable independently

---

### 3.2 `apps/frontend` — Host Application (Composition Layer)

```
apps/frontend/
├── src/
│   ├── activation/
│   ├── routes/
│   ├── layout/
│   ├── wiring/
│   └── app.tsx
```

**The frontend app:**

* Owns routing
* Owns navigation
* Owns activation gating
* Owns orchestration
* Owns side effects

It **does not own domain logic**.

---

## 4. Ownership Model (Hard Lines)

| Concern                     | Owner            |
| --------------------------- | ---------------- |
| Business logic              | `modules/*`      |
| Domain state machines       | `modules/*`      |
| Derivation logic            | `modules/*`      |
| Activation semantics        | `modules/shared` |
| UI contracts                | `modules/shared` |
| Module UI components        | `modules/*`      |
| Routing                     | `apps/frontend`  |
| Navigation                  | `apps/frontend`  |
| Modals                      | `apps/frontend`  |
| OAuth initiation            | `apps/frontend`  |
| API calls                   | `apps/frontend`  |
| Environment-specific wiring | `apps/frontend`  |

If ownership is unclear, **it belongs in the module** — until proven otherwise.

---

## 5. Import Rules (This Is Where Most Failures Happen)

### 5.1 Absolute Rule

> **No file may import from another package’s `src/` directory.**

This includes:

* frontend
* backend
* tests
* scripts

❌ **Forbidden**

```ts
import { X } from 'modules/shared/src/activation/deriveFT0Phase';
```

✅ **Required**

```ts
import { X } from '@lasyncro/shared/activation';
```

---

## 6. Why Deep Imports Are Forbidden

Deep imports:

* Bypass public contracts
* Break build boundaries
* Break Jest resolution
* Break package encapsulation
* Create invisible coupling
* Make refactors impossible

If something is not exported, **it does not exist**.

---

## 7. Package Export Model (Canonical)

Each module exposes a **deliberate public surface**.

Example: `modules/shared/package.json`

```json
{
  "name": "@lasyncro/shared",
  "exports": {
    ".": "./dist/index.js",
    "./activation": "./dist/activation/index.js",
    "./ui/activation": "./dist/ui/activation/index.js"
  }
}
```

### Implication

If you want to import it:

* it must be exported
* it must be built
* it must be stable

If it’s not exported:

> **you are not allowed to use it**

## 7.1 Build Format Invariant for Shared Modules (MANDATORY)

All packages under `modules/*` that are consumed by `apps/frontend`
**MUST be built as native ESM**.

### Rationale

The frontend build uses **Vite + Rollup**, which requires
**statically analyzable ESM exports**.

CommonJS re-exports (e.g. `module.exports`, `__exportStar`) are NOT
reliably analyzable by Rollup and will cause build-time failures even
when TypeScript type-checking passes.

### Enforced Rules

* ✅ `modules/shared` **must emit ESM**
* ❌ `modules/shared` must NOT emit CommonJS
* ❌ No frontend consumer may rely on CJS interop
* ❌ “It works in Jest” is NOT sufficient

### Required Compiler Settings

```json
{
  "compilerOptions": {
    "module": "ES2020"
  }
}

---

## 7.2 Package Manager Constraint (MANDATORY)

This monorepo currently assumes **npm workspaces** as the package manager.

As a result:

- ❌ The `workspace:*` dependency protocol is **NOT supported**
- ✅ Local modules MUST be referenced by **name + exact version**

Example (correct):

```json
"@lasyncro/order-nexus": "0.1.0"
```

npm will automatically link the local workspace package when:

* the package name matches
* the version matches

Using `workspace:*` is only valid under pnpm or Yarn and **will break module
resolution under npm**, resulting in:

* TypeScript “Cannot find module” errors
* Jest resolution failures
* False assumptions that boundaries are broken

This is a **tooling invariant**, not a boundary exception.

---

## 8. Tests Are Not Special

Tests must follow **the same import rules as production code**.

Why?

Because:

* Tests validate public contracts
* Tests must reflect runtime reality
* Tests must fail if contracts are broken

If a test needs `src/` imports:

> **the module’s public API is incomplete**

Fix the module — not the test.

---

## 8.1 tsconfig Path Aliases Are NOT a Substitute for Modules

❌ Using `tsconfig.paths` to simulate workspace module resolution is forbidden.

If a module does not resolve via its **package name and exports**, then:

* the module is not correctly built
* the workspace dependency is misconfigured
* or the public API is incomplete

`tsconfig.paths` may be used **inside a package**, but must never be used to
cross package boundaries.

---

## 9. Frontend ↔ Module Interaction Pattern

### Correct Pattern

```
apps/frontend
  └─ imports module public API
        └─ modules/* (via package exports)
              └─ internal logic hidden
```

### Incorrect Pattern

```
apps/frontend
  └─ reaches into module internals
        └─ modules/*/src/**
```

The second pattern is **explicitly disallowed**.

## 9.1 Module Pages vs Frontend Pages (CRITICAL CLARIFICATION)

### The Rule (Non-Negotiable)

> **A module owns its FT1 page.  
> The frontend only mounts it.**

There must never be duplicate or mirrored “page” implementations
across `modules/*` and `apps/frontend`.

---

### Correct Pattern (Canonical)

```
modules/order-nexus/
└─ src/ui/pages/OrdersModule.tsx   ← FT1 page (logic + UI)

apps/frontend/
└─ src/pages/OrdersPage.tsx        ← route adapter ONLY
```

```tsx
// apps/frontend/src/pages/OrdersPage.tsx
import OrdersModule from '@lasyncro/order-nexus';

export default function OrdersPage() {
  return <OrdersModule />;
}
```

Responsibilities:

| Layer | Responsibility |
|-----|----------------|
| `modules/*` | FT1 UI composition, domain logic, deterministic rendering |
| `apps/frontend` | Routing, lifecycle gating, mounting only |

---

### Forbidden Patterns (Do NOT Do This)

❌ Creating wrapper re-exports inside modules:

```
modules/order-nexus/src/ui/OrdersModule.tsx
└─ re-exporting ./pages/OrdersModule
```

Reason:

* Adds no semantic value
* Obscures where logic actually lives
* Creates duplicate build artifacts
* Reintroduces page ownership ambiguity

---

❌ Duplicating page logic in frontend:

```
apps/frontend/src/pages/OrdersPage.tsx
└─ containing FT1 logic, hooks, or derivation
```

Frontend pages must remain **thin adapters only**.

---

### Enforcement Invariant

> **If a file only re-exports another file without adding semantics,
> it must not exist.**

Violating this rule is considered an architectural regression.

---

## 10. Activation Case Study (Concrete Example)

### What frontend may do

```ts
import { ActivationSurface } from '@lasyncro/shared/ui/activation';
```

* Render
* Pass props
* Handle actions

### What frontend may NOT do

```ts
import { deriveActivationVerdict } from '@lasyncro/shared/src/activation';
```

* Inspect verdicts
* Re-run derivation
* Infer readiness

That logic **belongs to the module layer**.

---

## 11. Dependency Direction (Always One-Way)

```
modules/*        ← NO imports from apps
     ↑
apps/frontend    ← may import from modules
```

If a module imports from `apps/frontend`, the architecture is already broken.

---

## 12. Enforced Invariants

* ❌ No `src/` imports across package boundaries
* ❌ No frontend logic inside modules
* ❌ No routing or modals inside modules
* ❌ No API calls inside modules
* ✅ Modules expose contracts
* ✅ Frontend composes behavior

---

## 13. Common Failure Modes (Recognize Them Early)

| Symptom                                 | Root Cause              |
| --------------------------------------- | ----------------------- |
| Jest cannot resolve module              | Deep import into `src/` |
| Works in dev, fails in build            | Bypassed public exports |
| Tight coupling between UI and logic     | Boundary violation      |
| Hard-to-refactor code                   | Implicit dependencies   |
| Activation logic duplicated in frontend | Ownership confusion     |

---

## 14. Enforcement Recommendations (Strongly Advised)

To keep this architecture intact:

1. ESLint rule banning `/src/` imports across packages
2. CI check ensuring imports only use package names
3. Tests validating module public APIs
4. Code review checklist referencing this document

---

## 15. Final Lock Statement

> **`modules/*` define what the system is.
> `apps/frontend` decides how it is experienced.**

Blurring this line **will** cause:

* logic duplication
* inconsistent behavior
* test failures
* architectural decay

This boundary is **not stylistic**.
It is **structural**.

🔒 **Locked. Enforced. Non-negotiable.**

---

## FT1 Data Wiring Pattern (Locked)

**Pattern:** Frontend Adapter → Module Props

apps/frontend
└─ useOrdersFt1Adapter
└─ onboarding-readiness API
└─ backend signal providers

### Rules
- Modules NEVER fetch data
- Modules NEVER read lifecycle state
- Modules ONLY receive props
- Frontend adapters NEVER infer scenarios

### Example (Orders FT1)

- Frontend:
  - fetches readiness
  - maps signals → props
- Module:
  - interprets props
  - renders deterministic UI

Violating this pattern reintroduces:
- lifecycle leaks
- duplicated logic
- untestable UI