# 🔐 UX Enforcement Contract

> **Status:** Canonical, binding  
> **Scope:** Enforces separation between lifecycle, UX mode, and entitlements  
> **Audience:** Engineers, reviewers, architects  
> **Intent:** Prevent UX, lifecycle, and payment drift through structural enforcement

This document defines **non-negotiable enforcement rules**.  
It exists to make violations **structurally impossible**, not discouraged.

---

## 1. Canonical Enforcement Axes

The system operates on **three orthogonal axes**.

| Axis        | Owner     | May Mutate      | May Infer |
|-------------|-----------|-----------------|-----------|
| Lifecycle   | Backend   | ❌              | ❌        |
| UX Mode     | Frontend  | ❌              | ❌        |
| Entitlement | Billing   | ✅ (scope only) | ❌        |

**Hard rule:**  
No axis may infer, override, or simulate another.

---

## 2. Mandatory Enforcement Layers

The following layers are **required**.  
Removing or bypassing them is a contract violation.

### 2.1 Lifecycle Gates (Routing Authority)

**Purpose:** Prevent illegal routes from mounting.

**Canonical guards:**
- `ShopLifecycleGate`
- `DashboardLifecycleShell`
- `ModuleLifecycleShell`

**Rules:**
- FT0 may not mount application surfaces
- FT1 may not mount KPI or aggregate truth surfaces
- FT2 may not mount onboarding or checklist surfaces

Violations **must throw in development**.

---

### 2.2 Surface Capability Guard (Required)

All analytical or truth-claiming surfaces **must** pass through a capability guard.

Conceptual shape (exact API may vary):

```ts
assertSurfaceAllowed({
  lifecycle,
  uxMode,
  entitlement,
  surfaceType
})
````

**Responsibilities:**

* Enforce lifecycle × UX × entitlement matrix
* Prevent silent truth inflation
* Centralize violation logic

**Failure behavior:**

* DEV → throw with explicit error
* PROD → render degradation placeholder

---

### 2.3 Scope Adapters (Entitlement-Only)

Entitlements may **only** affect scope.

Scope adapters may:

* Limit rows
* Limit time windows
* Mask columns

Scope adapters may **never**:

* Change lifecycle
* Change UX mode
* Hide degradation
* Simulate lower lifecycle behavior

Entitlements **do not define capability**.

---

## 3. Violation Policy

The following conditions are **developer errors**:

| Violation                      | Response |
| ------------------------------ | -------- |
| FT0 rendering analytics        | throw    |
| FT1 rendering KPIs             | throw    |
| FT2 rendering onboarding       | throw    |
| UX inferred from payment       | throw    |
| Capability inferred from scope | throw    |

Silent fallback is forbidden.

---

## 4. Degradation Rules (Non-Throwing)

The following conditions **must degrade**, not crash:

* Partial data
* Delayed ingestion
* Domain instability
* Insufficient confidence

**Allowed responses:**

* Disabled aggregates
* Explicit banners
* Masked outputs

**Forbidden responses:**

* Lifecycle downgrade
* Checklist reappearance
* Silent omission

---

## 5. Extension Rule (Future-Proofing)

Any new lifecycle phase, UX mode, or entitlement dimension **must**:

1. Be added explicitly to the enforcement matrix
2. Introduce a new backend latch if capability changes
3. Never reuse frontend transitional states
4. Never be inferred from payment state

Failure to meet all four invalidates the extension.

---

## 6. Authority Statement

This contract supersedes:

* Feature-level UX decisions
* Growth experiments
* Temporary workarounds

If enforcement blocks a feature, the feature is wrong — not the contract.

---

**END OF UX ENFORCEMENT CONTRACT**

---
