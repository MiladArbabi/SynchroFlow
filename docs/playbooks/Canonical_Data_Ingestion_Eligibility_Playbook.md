# 📘 Canonical Data Ingestion & Eligibility Playbook

**(FT0 → FT2-Safe, Execution-Aware, Phase-Aligned)**

---

## 0. Core Principle (Non-Negotiable)

> **Never design ingestion from what you *wish* the data looked like.
> Design it from what you can *prove* exists.**

Everything else in this document enforces that rule.

---

## 1. Always Start With a HARD SCAN (No Code Changes)

### 1.1 Scan the Source (Platform Reality)

Before touching any code:

* Inspect **actual API responses**
* Log **real payloads** (not docs)
* Identify:

  * Fields that are **always present**
  * Fields that are **sometimes present**
  * Fields that are **conditionally protected**
  * Fields that are **never present without escalation**

📌 Output artifact:

```md
Source Field Matrix:
- guaranteed
- optional
- gated
- forbidden
```

If you skip this → **your ingestion will lie**.

---

### 1.2 Scan the Canonical DB (Storage Reality)

Inspect:

```sql
\d canonical_<domain>
\d canonical_<domain>_line_items
SELECT * FROM information_schema.columns WHERE table_name = '...';
```

Identify:

* NOT NULL constraints
* UNIQUE constraints
* Foreign keys
* Temporal expectations

📌 Output artifact:

```md
Canonical Storage Contract:
- must-have
- nullable
- derived later
```

If storage requires something the source cannot guarantee → **storage is wrong** (not the mapper).

---

### 1.3 Scan Eligibility Logic (Consumer Reality)

Search:

```bash
grep -R "<domain>" ft*-evaluator
grep -R "canonical_<domain>" services/
```

Answer:

* What unlocks phases?
* What is counted?
* What is advisory vs blocking?

📌 Output artifact:

```md
Eligibility Contract:
- Phase gates
- Minimum viable signals
- Advisory signals
```

---

## 2. Define the PHASE CONTRACT (Before Writing Code)

Every domain **must** be phase-scoped.

### Example: Revenue / Orders

| Phase | Required          | Forbidden            |
| ----- | ----------------- | -------------------- |
| FT0   | existence         | economics            |
| FT1   | counts + totals   | per-item attribution |
| FT2   | currency + totals | margins              |
| FT3+  | line economics    | guesses              |

📌 Write this **before** coding.

> If you can’t explain what the domain looks like at FT2 **in one paragraph**, you are not ready to ingest it.

---

## 3. Canonical Model Rules (This Saved You)

### 3.1 Canonical ≠ Complete

Canonical means:

* **Truthful**
* **Non-fabricated**
* **Phase-appropriate**

❌ Never:

* Default missing money to `0`
* Invent currency
* Backfill prices without source proof

✅ Always:

* Use `null`
* Mark advisory gaps
* Enrich later

---

### 3.2 Split Header Truth vs Detail Truth

**Pattern that worked (reuse everywhere):**

```ts
CanonicalEntity {
  // Tier 1: Phase-critical
  id
  shopId
  createdAt
  currency
  total

  // Tier 2: Enrichable
  lineItems[]
  costs
  attribution
}
```

Eligibility must **only** depend on Tier 1.

---

## 4. Mapper Design Rules (Hard-Won Lessons)

### 4.1 Mapper Is a Translator, Not a Fixer

Mapper rules:

* 1 source field → 1 canonical field
* No math
* No defaults
* No inference

```ts
totalPrice =
  node.totalPriceSet?.shopMoney?.amount != null
    ? Number(node.totalPriceSet.shopMoney.amount)
    : null;
```

If the mapper “fixes” data, **you will never know it was broken**.

---

### 4.2 Explicit Integrity Checks (Fail Loudly)

Inside ingestion:

```ts
if (
  !order.createdAt ||
  order.totalPrice == null ||
  !order.currency
) {
  throw new Error('[CANONICAL_ORDER_INVALID]');
}
```

This is not harsh — this is **self-defense**.

---

## 5. Ingestion Service Rules (Why You Unblocked)

### 5.1 Never Insert Partial Rows Blindly

* Insert **only** when phase requirements are met
* Skip (or defer) otherwise
* Log exactly why

This avoids:

* Corrupt canonical truth
* Silent FT2 blockers
* Debug hell

---

### 5.2 Line Items Must Be Optional by Default

Your bug proved this:

> Line items are enrichment, not eligibility.

Therefore:

* `unit_price` nullable
* `total_price` nullable
* Costs nullable

**Never block ingestion on enrichment fields.**

---

## 6. Eligibility Evaluator Rules (FT2 Stability)

### 6.1 Eligibility Must Be Binary and Explainable

FT2 logic must answer:

* Are orders present?
* Are totals present?
* Is currency present?

Not:

* Are margins correct?
* Are customers linked?
* Are costs known?

Those are **advisory**.

---

### 6.2 Evidence > Boolean

Every evaluator must emit:

```ts
{
  eligible: boolean,
  blockers: [],
  evidence: { ... }
}
```

This is why debugging worked.

---

## 7. UI / Product Semantics (Avoid Lying to Users)

### 7.1 Counts Must Match Phase Truth

If:

* 10 platform orders
* 8 canonical orders (valid)

Then:

* Show **8** in analytics
* Explain why 2 are excluded (advisory)

Never inflate numbers.

---

### 7.2 Advisory ≠ Error

Use:

* Warnings
* Tooltips
* Badges

Do not:

* Block dashboards
* Throw errors
* Hide progress

---

## 8. Operational Safety Checklist (MANDATORY)

Before declaring a domain “wired”:

* [ ] Canonical table populated
* [ ] Eligibility flips correctly
* [ ] DB constraints match mapper reality
* [ ] No fabricated defaults
* [ ] Restart-safe (cold boot works)
* [ ] Partial data does not crash pipeline
* [ ] Advisory gaps surfaced, not hidden

If any box is unchecked → **do not move on**.

---

## 9. How to Apply This to Any New Domain

Repeat **exact same steps** for:

* Customers
* Refunds
* Payouts
* Costs
* Attribution
* Fulfillment
* Inventory movements

Change **only**:

* Source scan
* Canonical schema
* Phase contract

Everything else stays the same.

---

## 10. The Meta Rule (Most Important)

> **Eligibility gates are not about perfection.
> They are about *safe progress*.**

You didn’t lower standards.
You **put them in the right phase**.

That’s real system architecture.

---