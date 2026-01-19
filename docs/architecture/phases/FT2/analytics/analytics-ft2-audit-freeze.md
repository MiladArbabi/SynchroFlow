# 🔒 FT2 CONTRACT AUDIT

## Analytics / InsightCore

**Status:** 🔒 LOCKED • SEALED • EVIDENCE-COMPLETE
**Audit Type:** Contract Truth Audit
**Scope:** **Analytics FT2 Observability Exposure**
**Doctrine:** FT2 Truth Exposure Policy (Non-inferential, Non-explanatory)

---

## 0. Contract Definition

This document defines the **authoritative Analytics FT2 contract as it exists today**.

A field, signal, or behavior **exists only if proven by scan**.
Intent, roadmap, or conceptual desire **do not constitute contract**.

If a signal is not exposed by `AnalyticsFT2Exposure`, it **does not exist**.

---

## 1. Contract Boundary (Authoritative)

### Backend Authority

```ts
getAnalyticsFt2Snapshot()
```

**Immutable pipeline:**

```
Analytics Facts
 → Analytics Intelligence
   → Analytics FTEP
     → Analytics FT2 Exposure
```

### Frontend Authority

```http
GET /api/v1/modules/analytics/ft2
```

No other endpoint, provider, adapter, or module participates in Analytics FT2 truth.

---

## 2. Canonical FT2 Analytics Exposure Shape

### 🔐 **AnalyticsFT2Exposure (SEALED)**

```ts
{
  snapshot: {
    id: string;
    extractedAt: string;
  };

  domains: {
    orders: AnalyticsDomainExposure | null;
    products: AnalyticsDomainExposure | null;
    customers: AnalyticsDomainExposure | null;
    finances: AnalyticsDomainExposure | null;
  };
}
```

This shape is **final, minimal, and authoritative**.

There is:

* ❌ no outcome
* ❌ no trend
* ❌ no money
* ❌ no intelligence leakage

---

### 🔐 **AnalyticsDomainExposure (SEALED)**

```ts
{
  presence: boolean | null;
  observationCount: number | null;
  nullSurface: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}
```

This is **pure observability**, nothing else.

---

## 3. Field-Level Contract Audit (Exhaustive)

---

### 3.1 `snapshot`

#### `snapshot.id`

* **Type:** `string`
* **Source:** Analytics Facts
* **Exposure:** Always exposed
* **Nullability:** Never null
* **Semantics:** Snapshot identity only
* **UI Behavior:** Rendered verbatim

#### `snapshot.extractedAt`

* **Type:** `string` (ISO timestamp)
* **Source:** Analytics Facts
* **Exposure:** Always exposed
* **Nullability:** Never null
* **Semantics:** Extraction moment, not business time
* **UI Behavior:** Rendered verbatim

🔒 **Contract Rule:**
Snapshot metadata is **always visible**, regardless of domain observability.

---

### 3.2 `domains`

Each domain is **independently observable and independently suppressible**.

---

### 3.2.1 `domains.<domain>` (Orders / Products / Customers / Finances)

* **Type:** `AnalyticsDomainExposure | null`
* **Suppression Rule:**

  * `null` → observability itself is unknown
  * object → observability is known (even if absent)

🔒 **Contract Rule:**
`null` means **withheld by policy**, not “empty”.

---

### 3.3 Domain Exposure Fields

#### `presence`

* **Type:** `boolean | null`
* **Source:** Analytics Intelligence
* **Semantics:**

  * `true` → at least one observable fact exists
  * `false` → explicitly zero observable facts
  * `null` → observability unknown
* **UI Rendering:**

  * `true` → “Yes”
  * `false` → “No”
  * `null` → “—”

---

#### `observationCount`

* **Type:** `number | null`
* **Source:** Analytics Facts (or FT2 upstream module)
* **Semantics:** Raw count of observed entities
* **Null Semantics:** Unknown, not zero
* **UI Rendering:** Rendered verbatim or `—`

---

#### `nullSurface`

* **Type:** `number | null`
* **Source:** Analytics Facts
* **Semantics:** Degree of observational blindness
* **Interpretation:** ❌ Forbidden
* **UI Rendering:** Rendered verbatim or `—`

---

#### `firstSeenAt`

* **Type:** `string | null`
* **Source:** Analytics Facts
* **Semantics:** First lawful observation timestamp
* **Null Semantics:** No temporal anchor
* **UI Rendering:** `—` when null

---

#### `lastSeenAt`

* **Type:** `string | null`
* **Source:** Analytics Facts
* **Semantics:** Last lawful observation timestamp
* **Null Semantics:** No temporal anchor
* **UI Rendering:** `—` when null

---

## 4. Signal Provenance Matrix

| Signal               | Origin Layer | Derived From        | Exposure Allowed | UI Visible |
| -------------------- | ------------ | ------------------- | ---------------- | ---------- |
| snapshot.id          | Facts        | Generator           | Yes              | Yes        |
| snapshot.extractedAt | Facts        | System time         | Yes              | Yes        |
| domain.presence      | Intelligence | Observability facts | Yes              | Yes        |
| observationCount     | Facts / FT2  | Raw counts          | Yes              | Yes        |
| nullSurface          | Facts        | Blindness metric    | Yes              | Yes        |
| firstSeenAt          | Facts        | Lawful timestamps   | Yes              | Yes        |
| lastSeenAt           | Facts        | Lawful timestamps   | Yes              | Yes        |
| money                | —            | —                   | ❌                | ❌          |
| outcomes             | —            | —                   | ❌                | ❌          |
| trends               | —            | —                   | ❌                | ❌          |
| explanations         | —            | —                   | ❌                | ❌          |

---

## 5. Intelligence Contract (Locked)

### Intelligence Purpose

Analytics Intelligence **does not judge quality, performance, or success**.

It only classifies **observability state**.

---

### Intelligence States (Per Domain)

| Input Condition                   | presence | observationLevel | continuity   |
| --------------------------------- | -------- | ---------------- | ------------ |
| presence = null                   | unknown  | unknown          | unknown      |
| presence = false                  | absent   | none             | missing      |
| presence = true + partial data    | present  | low / partial    | intermittent |
| presence = true + full timestamps | present  | full             | continuous   |

🔒 **Contract Rule:**
Intelligence never emits `null`.
Ambiguity is encoded as `'unknown'`.

---

## 6. Null Semantics (Strict)

| Layer        | Meaning of `null`              |
| ------------ | ------------------------------ |
| Facts        | Data absent at source          |
| Intelligence | ❌ never uses null              |
| FTEP         | Truth intentionally suppressed |
| FT2 Exposure | Honest absence                 |
| UI           | Rendered as `—`                |

Null is **never reinterpreted** downstream.

---

## 7. Explicit Non-Contractual Signals

The following **do not exist in the Analytics FT2 contract**, regardless of code elsewhere:

| Signal          | Status |
| --------------- | ------ |
| outcome         | ❌      |
| trend           | ❌      |
| revenue         | ❌      |
| percentages     | ❌      |
| KPIs            | ❌      |
| recommendations | ❌      |

---

## 8. Explicit Non-Guarantees

Analytics FT2 **does not guarantee**:

* Completeness
* Accuracy beyond upstream truth
* Business relevance
* Explanations
* Actionability
* Consistency across domains

---

## 9. End-to-End Contract Integrity

**Verified by scan:**

* Analytics consumes FT2 where required
* No domain intelligence leaks
* No facts are inferred
* No UI reconstruction occurs
* No silent defaults exist

---

## 10. FINAL SEALED VERDICT

> **The Analytics / InsightCore FT2 contract is a pure observability surface.**
>
> It exposes *what is visible*, *what is absent*, and *what is unknowable* —
> without explanation, judgment, or advice.
>
> Every exposed field is deliberate.
> Every suppressed domain is intentional.
> Every `—` is truthful.
>
> **This contract is LOCKED, SEALED, and EVIDENCE-FINAL.**

---