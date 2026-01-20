# 🔒 LaSyncro Entitlement Contract — **v1.0 (SEALED)**

**Status:** Sealed / Canonical
**Effective:** Immediately
**Scope:** Entitlements only
**Lifecycle Coverage:** FT1 → FT2
**Excluded:** FT-1, FT0, future modules not yet implemented
**Authority:** Backend (sole)

---

## 1. Purpose

This contract defines the **authoritative entitlement model** for LaSyncro, governing:

* Access to system capabilities
* Delegation to users and roles
* FT2-Free vs FT2-Paid differentiation
* Constraint-based value control
* Deterministic, auditable evaluation

This contract explicitly decouples:

* lifecycle
* entitlements
* billing

---

## 2. Hard Invariants (Locked)

The following are **non-negotiable**:

1. **Lifecycle ≠ Entitlements**
2. **Billing ≠ Lifecycle**
3. **Backend is the sole authority**
4. **Shop owns all capabilities**
5. **Users exercise capabilities via delegation**
6. **Multi-seat is first-class (free + paid)**
7. **FT2 is a capability phase, not a paywall**
8. **FT2-Free and FT2-Paid coexist**
9. **FT2 truth-only constraint is enforced**
10. **Automation is always explicit**
11. **Constraint lifting is the only paid mechanism**
12. **Soft downgrade is the default**
13. **Time is first-class**
14. **All entitlement changes are auditable**
15. **Evaluation is deterministic**

Any system violating these is **out of contract**.

---

## 3. Canonical Entitlement Primitives (Locked)

The system is defined **only** by these primitives:

1. Capability
2. Access Mode (`read | observe | interact | automate`)
3. Constraint
4. Grant (with source)
5. Subject (shop / role / user)
6. Role
7. Seat
8. Temporal Scope
9. Revocation Mode
10. Audit Event

No additional primitives may be introduced without amendment.

---

## 4. Lifecycle Interaction Rules (Locked)

### FT-1

* ❌ No entitlements allowed

### FT0

* ❌ No entitlements allowed

### FT1

* ✅ Transitional entitlements allowed
* ❌ No product value
* ✅ Diagnostic-only access
* ⏱ Temporal until FT2

### FT2

* ✅ Full entitlement model applies
* ❌ Lifecycle inference forbidden
* ✅ Free and paid differentiated by constraints only

---

## 5. FT2-Free Baseline (Locked)

FT2-Free grants **truth-only, constrained access**:

* Analytics: read, ≤30 days
* Orders: observe, ≤30 days
* Products: read, current state only
* Customers: read-only
* Dashboards: observe, truth-only
* Specter: observe, no scoring
* ❌ No exports
* ❌ No automation
* ❌ No execution modules

All grants:

* `source = system_default`
* `revocation = soft`

---

## 6. FT2-Paid Deltas (Locked)

FT2-Paid **only** lifts constraints or adds access modes:

* Unlimited historical ranges
* Finer granularity
* Interaction + automation where explicitly granted
* Execution modules (e.g. WMS-Lite) are paid-only
* Seats and roles expanded commercially

All paid grants:

* `source = commercial`
* Never inferred
* Never mutate lifecycle

---

## 7. Evaluation Order (Locked)

```
Shop Capabilities
→ FT2-Free Constraints
→ FT2-Paid Deltas (if any)
→ User Role Delegation
→ Temporal Rules
→ Revocation Rules
```

Same inputs **must always** yield the same output.

---

## 8. Reconciliation Record (Sealed)

Validated against:

* ✅ Analytics
* ✅ Order Nexus

Explicitly excluded:

* 🚫 WMS-Lite (not implemented)
* 🚫 Echo Hub (not implemented)

---

## 9. Amendment Policy (Strict)

Any change requires:

1. Written amendment
2. Explicit diff
3. Scope declaration
4. Non-retroactive effect

Silent drift is forbidden.

---

## 10. Seal Statement

This document is now the **single source of truth** for LaSyncro entitlements.

All future:

* schemas
* APIs
* enforcement layers
* billing integrations

**must conform** to this contract.

---