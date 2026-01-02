# 📜 FT2 Capability Graduation Contract

> **Status:** Draft — implementation-aligned, pending formal seal
> **Scope:** Defines FT2 as a backend capability graduation.
> **Relationship:** Additive to **Lifecycle Contract (As-Is)**.
> **Non-Goals:** Pricing, entitlements, UX onboarding, recommendations.

---

## 1. Purpose & Scope

This document defines **FT2** as a **pure capability graduation** in the LaSyncro lifecycle.

FT2 asserts that the system has crossed from **diagnostic truth (FT1)** to **full analytical capability**, without implying:

* payment
* optimization
* recommendations
* alerts
* automation

This document **does not redefine** FT0 or FT1.

---

## 2. Relationship to As-Is Lifecycle Contract

This contract builds on the frozen document:

> **Lifecycle Contract (As-Is)** — FT_MINUS_ONE → FT0 → FT1

All guarantees, invariants, and constraints from the As-Is contract remain valid.

FT2 is:

* Forward-only
* Backend-authoritative
* Irreversible under normal operation

---

## 3. Canonical Definition of FT2

**FT2 = Full Analytical Capability Across Declared Domains**

At FT2, the system can:

* Reason over **complete, stable historical datasets**
* Produce **deterministic aggregates**
* Maintain **cross-domain analytical coherence**
* Detect and disclose **analytical degradation honestly**

FT2 answers the question:

> *“Can the system reason comprehensively about what is happening?”*

---

## 4. What FT2 Is Explicitly NOT

FT2 does **not** mean:

* Paid
* Unlimited commercial access
* KPI readiness
* Recommendations
* Optimization
* Alerts
* Automation

Those concerns belong to **orthogonal systems or later phases**.

---

## 5. FT2 Graduation Inputs (Capability Categories)

FT2 graduation requires **all** of the following categories to pass.

### 5.1 Data Coverage Sufficiency

* Sufficient historical depth per declared domain
* No systemic gaps in evaluation windows
* Known and bounded incompleteness

Coverage is required; perfection is not.

---

### 5.2 Signal Stability

* Signals are reproducible across recomputation
* No material variance under identical inputs
* No flapping or oscillation

If recomputation yields materially different outputs → FT2 is blocked.

---

### 5.3 Cross-Domain Coherence

The system can safely join:

* Orders ↔ Products
* Orders ↔ Customers
* Orders ↔ Finances (if enabled)

Orphaned or incoherent joins block FT2.

---

### 5.4 Analytical Contract Readiness

For every FT2-exposed surface:

* Inputs are explicit
* Outputs are deterministic
* Failure modes are known and representable

If a surface cannot explain *why it is wrong*, it cannot be FT2.

---

## 6. Graduation Decision Rules

FT2 graduation is explicitly latched and must be:

* Backend-computed
* Snapshot-based
* Deterministic
* Auditable
* Persisted

As-Implemented Rule

## FT2 is entered if and only if:

* FT1 is complete and
* A persisted ft2_state record exists for the shop

The lifecycle resolver reads this latch but never infers it.

### Explicitly forbidden triggers:

* Checklist completion
* User behavior
* UI interaction
* Time-in-system assumptions
* Feature usage
* Payment state
* Entitlements
* Plan tier

---

## 7. Irreversibility & Regression Rules

Once FT2 is reached:

* Lifecycle **does not regress** due to:

  * Data delays
  * Partial ingestion
  * Domain degradation
* Lifecycle **only resets** if:

  * Integration is explicitly removed **and**
  * Canonical data authority is lost

All other issues are handled via **degradation semantics**, not lifecycle regression.

---

## 8. FT1 → FT2 Transition Contract

The FT1 → FT2 transition is:

* Silent
* Non-narrative
* Non-ceremonial

At transition:

* Historical scope expands
* Aggregates stabilize
* Cross-domain joins activate

What does **not** change:

* UX mode
* Navigation
* Entitlements
* Product narrative

---

## 9. Degradation Semantics at FT2

FT2 may exist in:

* **HEALTHY**
* **DEGRADED**
* **PARTIAL**

During degradation:

* Lifecycle remains FT2
* Affected domains are explicitly marked
* Invalid aggregates are suppressed, not guessed
* Diagnostics remain available

Checklist and onboarding surfaces **must never reappear**.

---

## 10. Audit & Observability Requirements (As-Built)

FT2 graduation must emit exactly once:

lifecycle.transition.FT1_TO_FT2

This event is emitted at the moment the FT2 latch is written.

Required payload:
shopId
previousPhase
newPhase (FT2)
Timestamp
Evaluator version
Guarantees:
Immutable
Idempotent
Backend-only
Non-blocking

If emission fails, FT2 must still remain latched.
Observability failure must never affect lifecycle truth.

---

## 11. Explicit Non-Claims

FT2 does **not** guarantee:

* Business value
* Insight correctness
* User success
* Optimization quality

FT2 guarantees only **honest analytical capability**.

---

## 12. Amendment Rules

This contract may only be amended by:

* New scan-verified evidence
* Explicit amendment sections
* Versioned diffs

Silent reinterpretation is forbidden.

---

**END OF FT2 CAPABILITY GRADUATION CONTRACT (DRAFT)**

---