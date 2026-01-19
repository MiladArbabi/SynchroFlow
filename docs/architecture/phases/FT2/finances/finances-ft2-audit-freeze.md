# 🔒 Finances / marginCore — FT2 Contract Audit (LOCKED)

**Contract Type:** FT2 Snapshot Exposure
**Authority:** `finances-ft2.provider.ts`
**Pipeline:** Facts → Intelligence → FTEP → FT2 UI
**Mutation:** ❌ None allowed
**Interpretation:** ❌ None allowed
**Status:** **Sealed**

---

## 1. Contract Ownership & Scope

### Authoritative Owner

* **Backend:** `marginCore`
* **Exposure Gate:** Finances FTEP
* **Consumer:** Finances FT2 UI only

### Explicit Non-Consumers

* FT2 Evaluator
* FT2 Latch
* Dashboard FT2
* Any other domain module

Finances is **isolated by design**.

---

## 2. Canonical Input Domain (Facts Boundary)

### Source Tables (Canonical DB)

* `canonical_orders`

No other tables are permitted in this contract.

---

## 3. FT2 Snapshot — Top-Level Shape (LOCKED)

```ts
FinancesFT2Exposure {
  context: Context;
  outcome: Outcome | null;
  trend: Trend | null;
  dataCoverage: DataCoverage;
}
```

No additional fields may appear.
No optional expansion allowed without version bump.

---

## 4. Context Object (Observational Facts)

### Contract

```ts
context: {
  period: {
    from: string;
    to: string;
  };
  revenueObserved: number | null;
  netObserved: number | null;
}
```

### Field Semantics (Locked)

| Field             | Meaning                  | Null Means               |
| ----------------- | ------------------------ | ------------------------ |
| `period.from`     | Observation window start | never null               |
| `period.to`       | Observation window end   | never null               |
| `revenueObserved` | Sum of canonical revenue | no authoritative revenue |
| `netObserved`     | Net result (rev − cost)  | computation impossible   |

**Rules**

* These are **facts**, not conclusions
* No formatting
* No currency assumptions
* No rounding guarantees

---

## 5. Outcome Object (Downgraded Intelligence)

### Contract

```ts
outcome:
  | {
      status: 'positive' | 'negative' | 'unknown';
    }
  | null;
```

### Exposure Rules (Locked)

| Condition                        | outcome                  |
| -------------------------------- | ------------------------ |
| `netResult.status === 'unknown'` | `null`                   |
| `netResult.status === 'good'`    | `{ status: 'positive' }` |
| `netResult.status === 'bad'`     | `{ status: 'negative' }` |

### Critical Constraints

* Outcome is **binary directional only**
* Magnitude is intentionally hidden
* Confidence is intentionally hidden
* Null is a **valid, expected state**

---

## 6. Trend Object (Dormant, Locked)

### Contract

```ts
trend:
  | {
      direction: 'up' | 'down' | 'flat' | 'unknown';
    }
  | null;
```

### Current Truth

* When exposed, `direction === 'unknown'`
* When outcome is null → trend is null

Trend is **structurally present but functionally dormant**.

---

## 7. Data Coverage Object (Evidence Signal)

### Contract

```ts
dataCoverage: {
  completenessPct: number | null;
}
```

### Semantics (Locked)

| Value  | Meaning                      |
| ------ | ---------------------------- |
| `100`  | ≥1 canonical orders observed |
| `null` | zero canonical orders        |

**Rules**

* Coverage is **binary in practice**
* Coverage does **not** imply correctness
* Coverage does **not** imply completeness of costs

---

## 8. Intelligence Signals (NON-CONTRACTUAL)

The following **exist internally** but are **explicitly sealed off**:

| Signal                      | Status        |
| --------------------------- | ------------- |
| `marginPct`                 | ❌ suppressed  |
| `lossReason`                | ❌ suppressed  |
| raw intelligence confidence | ❌ nonexistent |

Any appearance of these in FT2 is a **contract violation**.

---

## 9. Null Semantics (Global, Locked)

### Global Rule

> **Null always means “truth cannot be asserted.”**

Null does **not** mean:

* zero
* false
* negative
* pending
* error

Null is **honest silence**.

---

## 10. UI Contract Guarantees

### UI Responsibilities

* Render `null` as `—`
* Never infer
* Never compute
* Never compensate

### UI Prohibitions

* ❌ No math
* ❌ No defaults
* ❌ No explanations
* ❌ No derived labels

UI is a **read-only lens**.

---

## 11. Cross-Module Guarantees (Sealed)

* Finances does **not** affect FT2 eligibility
* Finances does **not** contribute to system health
* Finances does **not** leak into analytics
* Finances does **not** block anything

This module **observes only itself**.

---

## 12. Contract Invariants (Non-Negotiable)

The following invariants **must never be broken** without a new FT2 version:

1. Facts must remain canonical-only
2. Intelligence must remain suppressible
3. Outcome may be null
4. Trend may be null
5. Costs may be null
6. UI must remain observational
7. No cross-domain coupling

---

## 13. Violation Checklist (For Future Audits)

Any of the following is a **hard violation**:

* UI computing net or margin
* Outcome shown when intelligence is unknown
* Costs defaulted to `0`
* Trend inferred from a single snapshot
* Dashboard consuming Finances implicitly
* Evaluator referencing Finances

---

## 14. Final Seal

**Status:** ✅ **LOCKED & SEALED**
**Interpretation Allowed:** ❌ None
**Mutation Allowed:** ❌ None
**Expansion Allowed:** ❌ Only via explicit FT2 versioning

This contract is **authoritative truth**, not a suggestion.

If something feels missing:

> It is missing **on purpose**.

If something feels conservative:

> That is **correct**.

**End of Finances / marginCore FT2 Contract Audit.**