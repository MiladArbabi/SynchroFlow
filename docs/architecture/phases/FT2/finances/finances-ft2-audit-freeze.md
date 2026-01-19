# 🔒 Finances / marginCore — FT2 Contract Audit (LOCKED v2)

**Contract Type:** FT2 Snapshot Exposure
**Authority:** `finances-ft2.provider.ts`
**Pipeline:** Facts → Intelligence → FTEP → FT2 UI
**Mutation:** ❌ None allowed
**Interpretation:** ❌ None allowed
**Status:** **SEALED**

---

## 1. Contract Ownership & Scope

### Authoritative Owner

* **Backend Domain:** `marginCore`
* **Exposure Gate:** `finances-ftep`
* **Consumer:** Finances FT2 UI **only**

### Explicit Non-Consumers

* FT2 Evaluator
* FT2 Latch
* Dashboard FT2
* Any other domain module

Finances FT2 is **isolated by design** and **non-authoritative** for system decisions.

---

## 2. Canonical Input Domain (Facts Boundary)

### Source Tables (Canonical DB)

* `canonical_orders`

No joins.
No enrichment.
No inferred data sources.

---

## 3. FT2 Snapshot — Top-Level Shape (LOCKED)

```ts
FinancesFT2Exposure {
  context: Context;
  timeAwareness: TimeAwareness | null;
  timeline: Timeline | null;
  blindSpots: BlindSpots | null;
  decisionSafety: DecisionSafety | null;
  profitPreconditions: ProfitPreconditions | null;
  refundReality: RefundReality | null;
}
```

❌ No intelligence objects
❌ No numeric derivations
❌ No confidence math
❌ No explanations

Any expansion requires **explicit FT2 versioning**.

---

## 4. Context Object (Observational Facts)

### Contract

```ts
context: {
  revenueObserved: number | null;
  netObserved: number | null;
}
```

### Semantics (Locked)

| Field             | Meaning                         | Null Means               |
| ----------------- | ------------------------------- | ------------------------ |
| `revenueObserved` | Sum of canonical revenue        | No authoritative revenue |
| `netObserved`     | Revenue − costs (if computable) | Net cannot be asserted   |

**Rules**

* Context contains **facts only**
* No formatting
* No currency assumptions
* No rounding guarantees

---

## 5. Time Awareness (Downgraded Temporal Signal)

### Contract

```ts
timeAwareness:
  | {
      history: 'sufficient' | 'insufficient';
    }
  | null;
```

### Semantics

Answers **one question only**:

> “Is there enough history to talk about time at all?”

* No bucket counts exposed
* No continuity labels
* No thresholds revealed
* Null means: *system refuses to speak*

---

## 6. Timeline (Observational Only)

### Contract

```ts
timeline:
  | {
      bucket: 'day';
      points: {
        from: string;
        to: string;
        revenueObserved: number | null;
      }[];
    }
  | null;
```

### Rules

* Revenue only
* No net
* No trends
* No gap filling
* No inference

Timeline is **evidence**, not analysis.

---

## 7. Blind Spots (Explicit Unknowns)

### Contract

```ts
blindSpots:
  | {
      costs: 'unknown' | 'known';
      refunds: 'unknown' | 'known';
      history: 'insufficient' | 'sufficient';
    }
  | null;
```

### Semantics

Blind spots state **what the system does not know**, not why.

* No causes
* No remediation
* No severity

This is **truthful absence**, not guidance.

---

## 8. Decision Safety (Downgraded Risk Signal)

### Contract

```ts
decisionSafety:
  | {
      status: 'safe' | 'unsafe' | 'unknown';
    }
  | null;
```

### Rules

* Conservative by design
* Null means *risk cannot be assessed*
* Does **not** imply correctness
* Does **not** grant permission

Decision safety is **observational caution**, not advice.

---

## 9. Profit Preconditions (Validity Gate)

### Contract

```ts
profitPreconditions:
  | {
      status: 'ready' | 'not_ready';
    }
  | null;
```

### Semantics

Answers only:

> “Is profit even a valid concept yet?”

* No magnitude
* No margin
* No promises

If `not_ready`, profit signals are **structurally meaningless**.

---

## 10. Refund Reality (Observability Check)

### Contract

```ts
refundReality:
  | {
      status: 'known' | 'unknown';
    }
  | null;
```

### Semantics

* Known = refund facts exist
* Unknown = no refund evidence

No materiality.
No impact analysis.
No assumptions.

---

## 11. Explicitly Suppressed Intelligence (NON-CONTRACTUAL)

The following **exist internally** and **must never leak**:

| Signal          | Status   |
| --------------- | -------- |
| `marginPct`     | ❌ sealed |
| `lossReason`    | ❌ sealed |
| bucket counts   | ❌ sealed |
| continuity math | ❌ sealed |
| confidence math | ❌ sealed |

Any exposure is a **hard FT2 violation**.

---

## 12. Null Semantics (Global, Locked)

> **Null means: “Truth cannot be asserted.”**

Null does **not** mean:

* zero
* false
* negative
* pending
* error

Null is **honest silence**.

---

## 13. UI Contract Guarantees

### UI Responsibilities

* Render `null` as `—`
* Display only
* Never infer
* Never compute

### UI Prohibitions

* ❌ No math
* ❌ No defaults
* ❌ No explanations
* ❌ No derived labels

UI is a **read-only lens**, not a narrator.

---

## 14. Cross-Module Guarantees (Sealed)

* Finances does **not** affect FT2 eligibility
* Finances does **not** block actions
* Finances does **not** feed evaluators
* Finances does **not** leak into analytics

This module **observes itself only**.

---

## 15. Contract Invariants (Non-Negotiable)

These invariants **must never be broken** without a new FT2 version:

1. Facts remain canonical-only
2. Intelligence remains suppressible
3. All signals may be null
4. No numeric reasoning in FT2
5. UI remains observational
6. No cross-domain coupling

---

## 16. Violation Checklist (Future Audits)

Any of the following is a **hard violation**:

* UI computing profit or margin
* Profit shown when preconditions are not ready
* Refund impact inferred without facts
* Decision safety used as permission
* Costs defaulted to zero
* Timeline used to imply trend
* Any module depending on Finances FT2

---

## 17. Final Seal

**Status:** ✅ **LOCKED & SEALED (v2)**
**Interpretation Allowed:** ❌ None
**Mutation Allowed:** ❌ None
**Expansion Allowed:** ❌ Only via explicit FT2 versioning

If something feels missing:

> It is missing **on purpose**.

If something feels conservative:

> That is **correct**.

**End of Finances / marginCore FT2 Contract Audit (v2).**

---