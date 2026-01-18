# 🔍 LaSyncro FT2 Canonical Blueprint

**Specter & Customers Modules**

**Scope:** FT2 Scoped → FT2 Paid
**Audience:** Architecture · Product · Trust · Monetization
**Status:** **Canonical · Locked**

---

# Core FT2 Law (Applies to All Modules)

FT2 is **not insight**.
FT2 is **not optimization**.
FT2 is **not advice**.

FT2 is:

> **Permissioned exposure to observable reality — downgraded by policy.**

Every FT2 module follows:

```
Facts → Intelligence → FTEP → FT2 UI
```

If a module violates this, it is **not FT2**.

---

# PART I — SPECTER FT2

## 1. Specter Truth Domain (Locked)

| Module  | Owns Truth About                           |
| ------- | ------------------------------------------ |
| Specter | **User interaction & behavioral presence** |

Specter:

* Is **not analytics**
* Is **not attribution**
* Is **not funnel analysis**
* Is **not optimization**

Specter records **only what was observably captured**.

---

## 2. Specter FT2 — The Only Question It Answers

> *“Is user interaction observably occurring in this system?”*

It does **not** answer:

* why users act
* what actions to take
* what behavior means for revenue
* whether performance is good or bad

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

Each layer:

* Has one responsibility
* Is independently testable
* May not leak into the next

---

## 4. Layer 1 — SpecterFacts

### Owns Raw Truth Only

Examples of facts:

* `sessionsObserved`
* `eventsObserved`
* `lastInteractionAt`
* `signalCoverage`

Rules:

* All values may be `null`
* No interpretation
* No scoring
* No classification

> `null` means **no observable truth**, not zero.

---

## 5. Layer 2 — SpecterIntelligence (Internal Only)

May classify internally:

* presence status (`present | absent | unknown`)
* engagement direction (`up | flat | unknown`)
* signal sufficiency flags

Rules:

* Intelligence **never escapes**
* Missing facts collapse intelligence to `unknown`
* No persistence access

---

## 6. Layer 3 — SpecterFTEP (Truth Exposure Policy)

### What Specter FT2 Is Allowed to Expose

Users may see:

* Whether interaction presence exists
* Whether behavioral signals are observable
* Whether data is missing or suppressed

### What Is Explicitly Hidden

❌ Engagement scores
❌ Funnels
❌ Drop-off language
❌ Optimization hints
❌ Explanations

Uncertainty is rendered as `null`.

---

## 7. Specter FT2 — Free vs Paid (Canonical)

### FT2 Scoped (Free)

* Recent snapshot only
* Presence visibility
* Explicit data gaps
* Trust-building surface

### FT2 Paid

* Longer observation window
* Broader signal coverage
* Cross-module correlation (paid only)
* Still **no recommendations**

---

## 8. Why Users Pay for Specter FT2

Users upgrade because:

> **They are already losing money by not knowing whether users are actually interacting.**

Paid Specter FT2:

* Removes behavioral blindness
* Exposes broken instrumentation
* Reveals silent churn
* Prevents false confidence in analytics tools

It does **not** optimize.

It **prevents self-deception**.

---

# PART II — CUSTOMERS FT2

## 9. Customers Truth Domain (Locked)

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

## 10. Customers FT2 — The Only Question It Answers

> *“What customers exist, and what relationship state are they in?”*

It does **not** answer:

* who is valuable
* who will churn
* who should be targeted
* who to market to

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

Architecture mirrors Specter exactly.

---

## 12. Layer 1 — CustomersFacts

### Owns Raw Identity Truth

Examples:

* `customersObserved`
* `knownCustomers`
* `anonymousCustomers`
* `firstSeenAt`
* `lastSeenAt`

Rules:

* No scoring
* No segmentation
* No value judgment
* Nulls preserved

---

## 13. Layer 2 — CustomersIntelligence (Internal Only)

May internally classify:

* relationship presence
* growth direction
* identity completeness

Rules:

* Intelligence never exposed
* Missing facts collapse to `unknown`
* Deterministic only

---

## 14. Layer 3 — CustomersFTEP

### What Customers FT2 Is Allowed to Expose

Users may see:

* How many customers exist
* Whether identities are mostly known or anonymous
* Whether customer presence is growing or flat

### What Is Never Exposed

❌ LTV
❌ Cohorts
❌ Churn risk
❌ Marketing advice
❌ Predictive claims

---

## 15. Customers FT2 — Free vs Paid

### FT2 Scoped (Free)

* Snapshot of customer existence
* Identity completeness visibility
* Explicit nulls

### FT2 Paid

* Full customer surface
* Historical depth
* Cross-module correlation (with Orders / Specter if paid)
* Still **no prediction**

---

## 16. Why Users Pay for Customers FT2

Users upgrade because:

> **They cannot manage a relationship they cannot see clearly.**

Paid Customers FT2:

* Reveals how many customers are actually known
* Exposes reliance on anonymous traffic
* Prevents CRM overconfidence
* Grounds decisions in reality

It saves money by **preventing bad assumptions**, not by promising growth.

---

# PART III — Cross-Module FT2 (Paid Only)

## 17. Specter × Customers (Correlation, Not Causation)

When both paid entitlements exist:

* Behavior presence may be observed alongside identity presence
* Still no scoring
* Still no explanation
* Still no advice

> **Correlation is allowed. Explanation is not.**

---

## 18. Why This Architecture Monetizes Cleanly

Users upgrade because:

* FT2 Scoped shows **that reality exists**
* FT2 Paid removes **blind zones**
* Downgrading feels like choosing ignorance

LaSyncro does **not** sell:

❌ Insights
❌ Hacks
❌ Growth tricks

LaSyncro sells:

> **Permissioned access to reality.**

---

## 19. Final Lock (Specter & Customers FT2)

* No inference
* No advice
* No emotional language
* No hidden intelligence
* No semantic drift

---

## 🔒 FINAL STATEMENT

> **Specter FT2 shows whether users exist and act.
> Customers FT2 shows who exists and in what state.
> Paid FT2 removes blindness — not responsibility.**

This blueprint is **canonical**.
Any deviation requires **new scans and architectural review**.

---

### Where this leaves us (important)

You now have:

1. **Products / SKU-OS FT2** — sealed
2. **FT2 4-layer doctrine** — enforced
3. **Specter & Customers FT2 blueprint** — aligned
4. A clean foundation to:

   * design FT2 visual primitives
   * scale across modules
   * monetize without trust debt
