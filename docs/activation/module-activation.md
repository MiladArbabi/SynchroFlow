# Module Activation Contract

**Status:** 🔒 Locked
**Audience:** Frontend, Backend, Module Authors
**Applies to:** All modules under `modules/*`
**Last Updated:** 2025-12-23

---

## 1. Purpose of This Contract

This document defines **how modules participate in activation**.

It exists to prevent:

* Modules inventing their own activation rules
* Dashboard ↔ module desynchronization
* Logic leakage into frontend composition
* “It worked on dashboard but not in module” failures

If a module violates this contract, **the architecture is broken**, even if the UI “works”.

---

## 2. Core Principle (Non-Negotiable)

> **Modules do not decide whether they are active.
> They are told.**

Modules:

* Do **not** infer activation
* Do **not** check user fields
* Do **not** inspect FT phases
* Do **not** talk to integrations
* Do **not** call activation APIs

They **render based on a single input**:
👉 their slice of the **Activation Surface**

---

## 3. Single Source of Truth

### Authoritative Input

Each module receives activation state exclusively via:

```ts
activationSurface.modules[moduleId]
```

Provided by:

```
GET /api/v1/activation/verdict
```

Anything else is forbidden.

---

## 4. Module Activation State Model

### Canonical States

```ts
type ModuleActivationState =
  | 'LOCKED'
  | 'ACTIVATABLE'
  | 'ACTIVE';
```

These states are:

* Finite
* Exhaustive
* Stable

No module may introduce additional states.

---

## 5. State Semantics (Strict)

### LOCKED

* Module cannot function
* User cannot activate
* Data must not be shown
* CTA may be hidden or disabled

Typical causes:

* FT0 not completed
* Missing entitlement
* Missing integration

---

### ACTIVATABLE

* Module is eligible for activation
* CTA **must** be shown
* No real data is rendered
* Activation is a conscious user action

This is a **decision moment**, not a loading state.

---

### ACTIVE

* Module is fully live
* Real data is rendered
* Activation UI disappears
* Module behaves normally

This state is **terminal** until entitlement is revoked.

---

## 6. What Modules Are Allowed To Do

### ✅ Allowed

Modules may:

* Render different UI per activation state
* Show skeletons in ACTIVATABLE
* Show messaging in LOCKED
* Display CTA provided by surface
* Be completely stateless regarding activation

Example:

```ts
switch (activation.state) {
  case 'LOCKED':
    return <LockedState />;

  case 'ACTIVATABLE':
    return <ActivationSurface {...activation} />;

  case 'ACTIVE':
    return <LiveModule />;
}
```

---

## 7. What Modules Are Forbidden To Do

### ❌ Forbidden (Hard Rules)

Modules must NOT:

* Inspect `user.first_insight_delivered`
* Check `sync_status`
* Read FT phases
* Query integrations
* Call activation endpoints
* Store activation state locally
* Cache activation decisions
* Derive readiness heuristics

Example of **illegal code**:

```ts
if (orders.length > 0) { ... }        // ❌
if (user.shopify_connected) { ... }   // ❌
if (ft0Phase === 'COMPLETED') { ... } // ❌
```

If you need this logic → it belongs in **backend derivation**.

---

## 8. Module ↔ Frontend Boundary

### Ownership Split

| Concern                   | Owner            |
| ------------------------- | ---------------- |
| Activation truth          | Backend          |
| Activation derivation     | Backend + shared |
| Activation UI composition | Frontend         |
| Module rendering          | Module           |
| Activation decision       | **Never module** |

Modules **consume**, never **decide**.

---

## 9. Activation UI Responsibility

Modules **do not implement activation flows**.

All activation UI:

* Lives in `apps/frontend`
* Uses shared UI contracts
* Is triggered via `actionId`
* Is routed through `CommerceActivationGate`

Modules only expose:

* Capability UI
* Domain-specific messaging
* Post-activation behavior

---

## 10. Refresh & Navigation Guarantees

A module must:

* Behave identically on:

  * Page refresh
  * Deep link
  * Route change
* Never rely on mount timing
* Never “unlock” after refresh

If refresh changes module state → **bug**.

---

## 11. Testing Requirements

Every module must have tests that:

* Render in all three activation states
* Use mocked Activation Surface input
* Avoid any backend assumptions

If a test needs user/integration state:

> **The module API is wrong**

---

## 12. Failure Modes & Root Causes

| Symptom                        | Root Cause              |
| ------------------------------ | ----------------------- |
| Module stuck in FT0            | Module ignoring surface |
| Module active before dashboard | Module self-deriving    |
| Activation CTA missing         | Surface not passed      |
| Refresh breaks module          | Local state misuse      |

---

## 13. Enforcement Checklist (Code Review)

Before merging module code, verify:

* [ ] No imports from activation logic
* [ ] No access to user/integration state
* [ ] Activation comes from props/context only
* [ ] No FT phase checks
* [ ] No local activation state
* [ ] Surface used verbatim

Fail any → **reject PR**.

---

## 14. Evolution Rules

### Allowed

* Adding new activation surface fields
* Enhancing ACTIVATABLE UI
* Improving ACTIVE rendering

### Forbidden

* Adding module-specific activation logic
* Introducing hidden states
* Shortcutting FT lifecycle
* Backend calls from modules

---

## 15. Final Lock Statement

> **Modules are capabilities, not decision-makers.
> They execute — they do not judge.**

This contract is **structural**, not stylistic.

Breaking it will:

* Desync dashboard and modules
* Create untestable behavior
* Make activation un-debuggable

🔒 **Locked. Enforced. Non-negotiable.**

---