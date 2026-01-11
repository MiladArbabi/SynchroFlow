## 🔒 FT2-Free Entitlement Contract — **SEALED (v1.0)**

This is the **authoritative, non-negotiable contract** for FT2-Free.
Anything outside this is a violation.

---

### 1️⃣ Scope

* Applies **only after FT2 latch** is written.
* Applies **at shop level**, not user level.
* **Additive only**. Never revokes prior entitlements.

---

### 2️⃣ What FT2-Free GRANTS

**Modules (observability-only):**

* `order-nexus`
* `products`
* `customers`
* `analytics`
* `finances`

**Guarantees:**

* Read-only FT2 surfaces
* Governed truth exposure only
* No lifecycle inference
* No pricing semantics

---

### 3️⃣ What FT2-Free EXPLICITLY DOES NOT GRANT

❌ No paid / premium flags
❌ No write access
❌ No historical depth beyond FT2-safe windows
❌ No configuration or control surfaces
❌ No seat expansion semantics
❌ No role differentiation
❌ No dashboard entitlement gating (dashboard is lifecycle-gated only)

---

### 4️⃣ Enforcement Rules

* Granted **only via** `grantFt2FreeBaselineForShop(shopId)`
* Must be **idempotent**
* Must be **safe to re-run**
* Must **never**:

  * Inspect lifecycle
  * Inspect billing
  * Inspect user roles
  * Mutate or delete entitlements

---

### 5️⃣ Frontend Alignment (Guaranteed)

* FT2 routes exist **only** when lifecycle = `FT2_READY`
* Module rendering is guarded by:

  * `EntitlementBoundary` (resolution)
  * `ModuleAccessGate` (module presence)
* Dashboard FT2 is **not entitlement-gated by design**

---

### 6️⃣ Contract Status

**SEALED — v1.0**

Any change requires:

* New version
* Explicit migration
* Re-seal

---