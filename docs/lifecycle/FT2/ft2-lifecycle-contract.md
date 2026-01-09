# 📜 FT2 Lifecycle Contract (As-Is)

> **Status:** Canonical, scan-verified, test-enforced
> **Scope:** Backend FT2 lifecycle only
> **Effective:** Immediately
> **Nature:** Descriptive (As-Is), non-prescriptive
>
> This document records the **current, implemented reality** of FT2 in the system.
> It does **not** define future semantics, UX meaning, or roadmap intent.

---

## 1. FT2 Definition (As-Is)

**FT2** is a **backend lifecycle phase** representing a **confirmed capability graduation**.

FT2 is:

* Explicit
* Latched
* Backend-owned
* Non-inferable
* Non-reversible (unless data is deleted)

FT2 is **not** a readiness level, confidence score, or UI state.

---

## 2. Entry Authority (Exclusive)

FT2 may be entered **only** via:

```
POST /api/v1/lifecycle/ft2/confirm
(confirmFt2)
```

This endpoint is the **single authoritative entry point**.

No other path may enter FT2.

---

## 3. FT2 Entry Preconditions (Observed)

Before FT2 can be entered:

1. The user must already be at **FT1**
2. FT2 eligibility must evaluate to `eligible === true`
3. An **explicit confirmation action** must occur

Eligibility evaluation alone **does not** change lifecycle phase.

---

## 4. FT2 Latch Semantics (`ft2_state`)

FT2 is persisted by writing a row to:

```
ft2_state
```

### Verified properties:

* One row per `shop_id`
* Enforced by unique constraint
* Idempotent writes (`onConflict().ignore()`)
* Never auto-deleted
* Never overwritten

FT2 therefore acts as a **hard capability latch**.

---

## 5. FT1 → FT2 Audit Semantics (Verified)

### 5.1 Audit Emission Rule

An audit event is written **if and only if**:

* FT2 confirmation occurs
* FT2 latch write is attempted
* The effective transition is `FT1 → FT2`

### 5.2 Audit Characteristics

Audit is written to:

```
lifecycle_audit_events
```

With:

* `from_phase = FT1`
* `to_phase = FT2`
* `occurred_at = db.fn.now()`

### 5.3 Idempotency

* Exactly **one** FT1 → FT2 audit per user
* Enforced by:

  * application guard
  * DB uniqueness constraint (`user_id, from_phase, to_phase`)
* Repeated confirmations do **not** emit additional audits

### 5.4 Explicit Non-Triggers

FT1 → FT2 audit is **never** emitted by:

* FT2 eligibility evaluation
* Paid entitlements
* Lifecycle resolution
* Frontend actions
* Page loads or refreshes

This is enforced by unit tests:

```
tests/unit/backend/lifecycle/ft2.confirm.audit.test.ts
```

---

## 6. Lifecycle Resolver Behavior (Observed)

`LifecycleService.resolveForUser()`:

* Returns `FT2` **only** when `ft2_state` exists
* Does **not** infer FT2 from:

  * eligibility
  * entitlements
  * readiness
  * audits

FT2 resolution is therefore **purely latch-based**.

---

## 7. Snapshot Projection (Non-Authoritative)

Upon FT2 audit, the system updates:

```
user_lifecycle_snapshot
```

This snapshot is:

* A projection
* Not a source of truth
* Safe to recompute
* Not used for lifecycle decisions

Lifecycle truth always derives from:

* `ft2_state`
* canonical resolver logic

---

## 8. What FT2 Definitively Does *Not* Mean

FT2 does **not** imply:

* Analytics correctness
* Insight quality
* KPI validity
* Optimization readiness
* UX unlock semantics
* Frontend routing authority

FT2 is a **backend capability state only**.

---

## 9. Monotonicity & Irreversibility (As-Is)

Once FT2 is entered:

* Lifecycle does not regress
* FT1 signals are no longer relevant
* Reset events are ignored
* Frontend cannot downgrade FT2

Any regression would require **explicit data deletion**.

---

## 10. Non-Goals (Explicit)

This document does **not** define:

* FT2 UX behavior
* FT2 feature set
* FT2 pricing meaning
* FT2 analytics semantics
* FT2 graduation criteria design

All such meaning is intentionally **out of scope**.

---

## FT2 Seal Statement

This document captures the **actual implemented FT2 lifecycle** as of now.

* Scan-verified
* Unit-tested
* Idempotent
* Explicit
* Backend-owned

Any future FT2 expansion **must** treat this contract as immutable baseline behavior.

---

**END OF FT2 AS-IS CONTRACT** 🔒
