# 🔐 Analytics Module — FT2 Features & Offerings Blueprint

**(Observability-First, Cross-Module, Time-Agnostic by Default)**

**Status:** 🔒 CANONICAL • EVIDENCE-SYNCED • CONTRACT-SAFE
**Scope:** Analytics FT2 only
**Doctrine:** Truth Exposure Policy over Observability (not performance)

---

## 0. Analytics Prime Directive (Corrected)

> **Analytics owns observability aggregation and suppression — not time, not outcomes, not comparison.**

Analytics **does NOT own**:

* Time semantics
* Continuity
* Trends
* Comparisons
* Outcomes
* Performance framing
* Business meaning

Analytics **only owns**:

* Aggregating *observability* across modules
* Classifying *visibility vs blindness*
* Suppressing truth conservatively under FT2 rules

If time, continuity, or trends appear anywhere, they are:
*Owned upstream* or *future-gated*, **not Analytics-owned today**.

---

## 1. Analytics Truth Domain (As Actually Implemented)

From **verified code scans**, Analytics owns:

| Capability             | Ownership |
| ---------------------- | --------- |
| Data existence         | ✅         |
| Data absence           | ✅         |
| Observability volume   | ✅         |
| Blindness detection    | ✅         |
| Cross-module alignment | ✅         |
| Time semantics         | ❌         |
| Direction / trend      | ❌         |
| Outcome / success      | ❌         |
| Comparison             | ❌         |

Analytics is a **map of what can be seen** — nothing more.

---

## 2. Analytics Facts — What Exists (Verified)

Analytics Facts are **observability substrates**, not economic facts.

### Canonical Facts Surface (LOCKED)

```ts
AnalyticsFacts {
  shopId: number
  snapshotId: string
  extractedAt: string

  domains: {
    orders: {
      presence: boolean | null
      observationCount: number | null
      nullSurface: number | null
      firstSeenAt: string | null
      lastSeenAt: string | null
    }

    products: AnalyticsDomainFacts
    customers: AnalyticsDomainFacts
    finances: AnalyticsDomainFacts
  }
}
```

### Provenance Rules (Non-Negotiable)

* Orders → sourced from **Orders FT2 exposure**
* Products → canonical products truth
* Customers → canonical customers truth
* Finances → canonical financial transactions truth

Analytics **never** queries another module’s operational tables when an FT2 provider exists.

---

### What Facts Explicitly Are NOT

❌ Revenue
❌ Costs
❌ Margins
❌ Statuses
❌ Health
❌ KPIs
❌ Performance metrics

Facts only say: *something exists* or *nothing can be seen*.

---

## 3. Analytics Intelligence (Internal, Non-Commercial)

Analytics Intelligence exists **only to protect the surface**.

### What Intelligence Does

* Encodes ambiguity (`unknown`)
* Normalizes presence vs absence
* Classifies observation *volume* (not value)
* Enables safe suppression in FTEP

### What Intelligence Never Does

❌ Judge
❌ Predict
❌ Explain
❌ Compare
❌ Optimize
❌ Recommend

Intelligence is **structural glue**, not value.

---

## 4. Analytics FTEP — The Real Product Boundary

> **Analytics monetization does not add meaning — it removes suppression.**

FTEP decides:

* Which domains are visible
* Which domains are intentionally withheld
* How much blindness the user must confront

Analytics never exposes:

* Intelligence
* Classifications
* Reasoning

Only **raw observability survives**.

---

## 5. FT2-Free Analytics Offering

### *“Visibility Without Interpretation”*

FT2-Free answers exactly one question:

> **What data surfaces are observable right now?**

### 5.1 What FT2-Free Exposes

Per domain:

* `presence`
* `observationCount`
* `nullSurface`
* `firstSeenAt` / `lastSeenAt` (if lawful)

No summaries.
No judgments.
No comfort.

Nulls are **fully visible**.

---

### 5.2 What FT2-Free Explicitly Withholds

❌ Outcomes
❌ Trends
❌ Comparisons
❌ Time narratives
❌ Cross-snapshot meaning
❌ Success framing

If the user feels *guided*, FT2-Free has failed.

---

### 5.3 FT2-Free UX Intent

FT2-Free should feel:

* Sparse
* Neutral
* Slightly unsettling
* Responsibility-preserving

The correct emotional response is:

> *“I can see what exists — but I am on my own.”*

---

## 6. FT2-Paid Analytics Offering

### *“Persistence Without Explanation”*

Paid Analytics **does not change what Analytics knows**.

It changes **how much of reality the user is allowed to face**.

---

### 6.1 What Paid Unlocks (Future-Gated, Not Yet Active)

Paid **may unlock** — when implemented:

* Multiple snapshots (temporal depth)
* Continuity visibility
* Suppression relaxation
* Longer retention windows

Still:

❌ No deltas
❌ No percentages
❌ No benchmarks
❌ No targets

Time increases pressure.
Meaning remains forbidden.

---

### 6.2 What Paid Still Never Gets

Even at maximum entitlement:

❌ Profitability
❌ Efficiency
❌ Health
❌ Optimization
❌ Recommendations
❌ “Why”

If a paid user asks:

> “What should I do?”

Analytics must remain silent.

---

## 7. Cross-Module Analytics Rules (Enforced)

Analytics **may only expose observability** for a domain when:

* Analytics FT2 is unlocked
* AND the domain’s FT2 provider exists
* AND the domain’s FTEP permits exposure

| Scenario                    | Result                 |
| --------------------------- | ---------------------- |
| Analytics FT2, Orders FT2   | Orders observability   |
| Analytics FT2, Products FT2 | Products observability |
| Analytics FT2 only          | No domain visibility   |
| One side unpaid             | Suppressed             |

Truth requires **mutual permission**.

---

## 8. UI & Language Constraints (Hard Rules)

Analytics UI must:

* Avoid success language
* Avoid performance framing
* Avoid encouragement
* Avoid CTA-driven phrasing

Correct tone:

* Observational
* Factual
* Cold
* Slightly uncomfortable

Analytics **reveals**.
It never **reassures**.

---

## 9. Monetization Truth (Reality Check)

You do **not** sell Analytics by:

* Making it smarter
* Making it optimistic
* Making it explanatory

You sell Analytics by:

* Making self-deception impossible over time

FT2-Free:

> *You can see what exists.*

FT2-Paid:

> *You cannot escape what persists.*

That is the upgrade.

---

## 10. FINAL LOCK — Analytics FT2 Doctrine

> Analytics does not help users succeed.
> It removes their ability to lie to themselves.

> FT2 is not a feature.
> It is a boundary.

> Observability is the product.
> Suppression is the pricing lever.

This blueprint is now **CANONICAL, EVIDENCE-SYNCED, AND LOCKED**.

---