# 🔍 LaSyncro FT2 Canonical Blueprint

## Specter & Customers Modules

**Scope:** FT2 Scoped → FT2 Paid
**Audience:** Architecture, Product, Trust, Monetization
**Status:** Canonical

---

# PART I — SPECTER FT2

## 1. What Specter Owns (Truth Domain)

| Module  | Owns Truth About                        |
| ------- | --------------------------------------- |
| Specter | **User behavior & interaction reality** |

Specter is **not analytics**.
It does **not** explain *why* users behave.
It only records **what interactions occurred** and **what was observable**.

---

## 2. Specter FT2 — User-Visible Value

### FT2 Answers One Question Only

> *“What user behavior is observably happening in my system?”*

Not:

* why it happened
* what to do about it
* what it means for revenue

---

## 3. Specter FT2 — Layered Architecture

```
Persistence (events, sessions, signals)
   ↓
SpecterFacts
   ↓
SpecterIntelligence
   ↓
SpecterFTEP
   ↓
Specter FT2 Provider
   ↓
Specter FT2 API / UI
```

---

## 4. Layer 1 — SpecterFacts

### Owns

* Session existence
* Event counts
* Interaction timestamps
* Behavioral presence

### Examples of Raw Facts

* sessionsObserved
* eventsObserved
* lastInteractionAt
* signalCoverage

All nullable.
All timestamped.
No semantics.

---

## 5. Layer 2 — SpecterIntelligence

### Internal Classification Only

Specter Intelligence may derive:

* presence status (present / absent / unknown)
* engagement direction (up / flat / unknown)
* signal sufficiency flags

This **never escapes** the module.

---

## 6. Layer 3 — SpecterFTEP (Truth Exposure Policy)

### What Specter FT2 Exposes

Users can see:

* Whether user behavior is present
* Whether engagement signals exist
* Whether data is sufficient or missing

### What Is Explicitly Hidden

* No engagement scores
* No reasons
* No funnels
* No optimization hints
* No “drop-off” language

Uncertainty is visible as `null`.

---

## 7. Specter FT2 — Free vs Paid

### FT2 Scoped (Free)

* Recent snapshot only
* Presence visibility
* Missing data explicitly shown
* Trust-building

### FT2 Paid

* Longer observation window
* More complete signal coverage
* Cross-module exposure allowed (with Orders / Customers paid)
* Still **no recommendations**

---

## 8. Why Users Pay for Specter FT2

Users pay because:

> **They are already losing money by not knowing if users are actually interacting.**

Paid Specter FT2:

* Removes behavioral blindness
* Exposes broken tracking
* Reveals silent churn
* Prevents false confidence in analytics tools

It doesn’t optimize.
It **prevents self-deception**.

---

# PART II — CUSTOMERS FT2

## 9. What Customers Owns (Truth Domain)

| Module    | Owns Truth About                           |
| --------- | ------------------------------------------ |
| Customers | **Customer identity & relationship state** |

Customers does **not** own:

* revenue
* orders
* behavior
* sentiment

It owns **who exists and in what relationship state**.

---

## 10. Customers FT2 — User-Visible Value

### FT2 Answers One Question Only

> *“What customers exist, and what is their relationship state?”*

Not:

* who is valuable
* who will churn
* who to target

---

## 11. Customers FT2 — Layered Architecture

```
Persistence (canonical_customers)
   ↓
CustomersFacts
   ↓
CustomersIntelligence
   ↓
CustomersFTEP
   ↓
Customers FT2 Provider
   ↓
Customers FT2 API / UI
```

---

## 12. Layer 1 — CustomersFacts

### Owns Raw Truth

Examples:

* customersObserved
* knownCustomers
* anonymousCustomers
* firstSeenAt
* lastSeenAt

No scoring.
No segmentation.
No value judgments.

---

## 13. Layer 2 — CustomersIntelligence

### Internal Signals

May classify:

* relationship presence (exists / absent / unknown)
* growth direction (up / flat / unknown)
* identity completeness flags

Still internal.
Never exposed directly.

---

## 14. Layer 3 — CustomersFTEP

### What Customers FT2 Exposes

Users can see:

* How many customers exist
* Whether identities are mostly known or anonymous
* Whether customer presence is growing or stagnant

### What Is Never Exposed

* LTV
* Cohorts
* Churn risk
* Recommendations
* Marketing advice

---

## 15. Customers FT2 — Free vs Paid

### FT2 Scoped (Free)

* Snapshot of customer existence
* Identity completeness visibility
* Nulls visible

### FT2 Paid

* Full customer surface
* Historical depth
* Cross-module truth with Orders & Specter (if paid)
* Still **no predictive claims**

---

## 16. Why Users Pay for Customers FT2

Users pay because:

> **They cannot manage a relationship they cannot see clearly.**

Paid Customers FT2:

* Reveals how many customers are actually known
* Exposes reliance on anonymous traffic
* Prevents overconfidence in CRM tools
* Grounds growth decisions in reality

This saves money by:

* preventing bad marketing spend
* reducing mis-targeted campaigns
* stopping fake growth narratives

---

# PART III — Cross-Module FT2 (Paid Only)

## 17. Specter × Customers (Paid)

When both entitlements exist:

* Customer presence can be observed alongside behavior presence
* Still no causation
* Still no scoring
* Still no advice

> **Correlation is allowed. Explanation is not.**

---

## 18. Why This Architecture Monetizes Cleanly

Users upgrade because:

* FT2 Scoped shows **there is truth**
* FT2 Paid removes **blind zones**
* Downgrading feels like choosing ignorance

LaSyncro never sells:

* insights
* hacks
* “growth”

It sells:

> **Permissioned access to reality.**

---

## 19. Final Lock (Specter & Customers)

* No inference
* No advice
* No emotional language
* No hidden intelligence

---

## Final Statement

> **Specter FT2 shows whether users exist and act.
> Customers FT2 shows who exists and in what state.
> Paid FT2 removes blindness — not responsibility.**

This blueprint is **canonical**.
