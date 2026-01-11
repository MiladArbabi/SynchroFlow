## 💳 FT2-Paid Entitlement Deltas — **ADD-ONLY CONTRACT (v1.0)**

This defines **what changes when a shop moves from FT2-Free → FT2-Paid**.
Nothing here alters lifecycle, routing, or FT2 eligibility.
**Entitlements only. Additive only.**

---

## 1️⃣ Scope & Invariants

**Applies when:**

* Lifecycle is already `FT2_READY`
* Billing system confirms paid state (outside this contract)

**Hard invariants:**

* ❌ No lifecycle reads
* ❌ No revocation of FT2-Free entitlements
* ❌ No implicit behavior
* ❌ No UI coupling
* ✅ Pure additive module/flag grants

---

## 2️⃣ Baseline Reminder (FT2-Free)

Already granted (do not repeat logic):

Modules:

* `order-nexus`
* `products`
* `customers`
* `analytics`
* `finances`

*No paid flags present.*

---

## 3️⃣ FT2-Paid: **Additive Module Deltas**

> These modules **do not exist** in FT2-Free.

```text
+ specter_intelligence
+ forecasting
+ anomaly_detection
```

Rules:

* Each module is **explicit**
* Each module is **independently gateable**
* No implied access through flags alone

---

## 4️⃣ FT2-Paid: **Additive Flag Deltas (per module)**

### 🔍 Orders / Order Nexus

```text
+ orders:deep_history
+ orders:causal_breakdowns
+ orders:anomaly_annotations
```

### 📦 Products

```text
+ products:demand_signals
+ products:inventory_risk
```

### 👥 Customers

```text
+ customers:cohort_analysis
+ customers:behavioral_patterns
```

### 📊 Analytics

```text
+ analytics:advanced_metrics
+ analytics:comparative_windows
+ analytics:export
```

### 💰 Finances

```text
+ finances:margin_intelligence
+ finances:cost_drift_detection
```

### 🧠 Specter

```text
+ specter:inference_engine
+ specter:cross_domain_reasoning
```

---

## 5️⃣ Semantic Rules (Critical)

* **Modules unlock surfaces**
* **Flags unlock depth**
* Flags without their parent module are inert
* Modules without flags expose **paid-safe defaults only**

---

## 6️⃣ Backend Grant Function (Conceptual Contract)

> *Not implementation yet — this is the contract.*

```ts
grantFt2PaidDeltasForShop(shopId)
```

Must:

* Insert rows into `shop_module_entitlements`
* Use `source = 'ft2_paid'`
* Be idempotent
* Never delete or downgrade

---

## 7️⃣ Frontend Guarantees

* `ModuleAccessGate` controls module visibility
* Flags are consumed **inside FT2 adapters only**
* No FT1 code path may read these flags
* No routing changes

---

## 8️⃣ Explicitly Out of Scope (v1.0)

❌ Seats
❌ Roles
❌ Usage limits
❌ Trials
❌ Grace periods
❌ Proration
❌ Billing state checks
❌ “Premium” magic flags

Those are **separate contracts**.

---

## 9️⃣ Contract Status

**FT2-Paid Deltas — SEALED (v1.0)**

Any future change requires:

* New delta set
* Version bump
* Explicit migration
* Re-seal

---