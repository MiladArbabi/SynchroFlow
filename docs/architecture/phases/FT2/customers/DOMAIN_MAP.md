# 🔒 Customers FT2 Canon — Ecommerce SMB Edition

## + Alignment Planes Handoff (Authoritative)

**Status:** 🔒 LOCKED  
**Applies to:** Backend · Modules · Frontend · Product · Monetization  
**FT Level:** **FT2 is terminal**  
**Last Updated:** Now  
**Change Policy:** Explicit RFC only  

---

## 0. Executive Intent (Read First)

Customers FT2 is **not** an analytics module.  
It is the **Customer Nervous System (CNS)** for Ecommerce SMBs.

Its job is not to:

* optimize
* advise
* predict
* recommend
* persuade

Its only job is to:
> **Make customer reality observable, bounded, and undeniable — including what is *not* observable.**

FT2 is the epistemic floor of the product.  
Everything above it either respects this truth or becomes manipulation.

This document locks that floor.

---

## 1. FT2 Is the Top (Non-Negotiable)

There is:

* ❌ no FT3
* ❌ no FT2+
* ❌ no hidden "advanced" semantics

There is only:

| Tier | Meaning |
|------|---------|
| **FT2 (Free)** | More downgrades, more blindness |
| **FT2 (Paid)** | Fewer downgrades, same truth |

### Absolute Rule
>
> **Monetization may remove blindness.  
> Monetization may never add truth.**

If a signal cannot exist in **FT2-Free in downgraded form**, it must not exist at all.

---

## 2. Customers FT2 — Canonical Domains (LOCKED)

FT2 consists of **22 canonical domains**.

They are final.  
They are atomic.  
They are non-overlapping.

No additions.  
No merges.  
No silent expansion.

---

### **Domain 1 — Identity Presence Reality**

**Question:** Do customers exist as identifiable entities?  
**Truth owned:** Entity existence, identity observability  
**FT2 Signals:** `customersPresent: boolean | null`, `identityCoverage: complete | partial | unknown`

### **Domain 2 — Activity Presence Reality**

**Question:** Is there *any* observable customer activity?  
**Truth owned:** Existence of activity, silence as a signal  
**FT2 Signals:** `sessionsPresent: boolean | null`, `activityObserved: boolean | null`  
**Rule:** `false` ≠ `null`. Silence is meaningful **only if observable**.

### **Domain 3 — Engagement Structure Reality**

**Question:** Is customer behavior structurally meaningful?  
**Truth owned:** Depth existence only  
**FT2 Signals:** `multiStepSessionsPresent: boolean | null`, `averageSessionDepthPresent: boolean | null`  
**Rule:** No averages. No scores. No "quality".

### **Domain 4 — Surface Breadth Reality**

**Question:** Do customers explore more than one surface?  
**Truth owned:** Cross-surface existence  
**FT2 Signal:** `surfaceBreadthPresent: boolean | null`

### **Domain 5 — Returning Behavior Reality**

**Question:** Do customers come back?  
**Truth owned:** Returning existence  
**FT2 Signal:** `returningSessionsPresent: boolean | null`  
**Rule:** No cohorts. No retention math. No attribution.

### **Domain 6 — Exit & Abandonment Reality**

**Question:** Do customers leave without engaging?  
**Truth owned:** Early disengagement existence  
**FT2 Signals:** `exitIntentDetected: boolean | null`, `exitWithoutInteractionPresent: boolean | null`  
**Rule:** No severity. No cause. No blame.

### **Domain 7 — Journey Structure Reality**

**Question:** Do customer journeys exhibit *any* structure?  
**Truth owned:** Funnel marker existence  
**FT2 Signal:** `funnelsDetected: boolean | null`  
**Rule:** Not funnel performance. Structural observability only.

### **Domain 8 — Observability Coverage Reality (TRUST)**

**Question:** Is activity absence meaningful or unknowable?  
**Truth owned:** Observability certainty  
**FT2 Signal:** `dataCoverage: complete | insufficient | unknown`  
**Rule:** Not data quality. Epistemic confidence.

### **Domain 9 — Directional Movement Reality (LOSSY)**

**Question:** Is activity directionally changing?  
**Truth owned:** Directional movement without magnitude  
**FT2 Signal:** `activityDirection: up | down | flat | unknown | null`  
**State:** Always `null` in FT2 due to no continuity.

### **Domain 10 — Instrumentation Gaps Reality (META-OBSERVABILITY)**

**Question:** What *could not* be observed due to missing instrumentation?  
**Truth owned:** Observability blind spots  
**FT2 Signal:** `instrumentationGaps: InstrumentationGap[] | null`  
**Examples:** `page_depth`, `surface_breadth`, `returning_flag`, `exit_intent`, `funnels`

### **Domain 11 — Data Freshness Reality**

**Question:** Is the extracted data temporally valid for this window?  
**Truth owned:** Freshness vs staleness  
**FT2 Signal:** `dataFreshness: boolean | null`  
**Rule:** No SLAs. No urgency. No alarms.

### **Domain 12 — Cross-Domain Consistency Reality**

**Question:** Do observed signals logically contradict each other?  
**Truth owned:** Internal coherence  
**FT2 Signal:** `consistencyIssues: ConsistencyIssue[] | null`  
**Examples:** Depth without sessions, funnels without activity, returning without sessions  
**Rule:** No diagnosis. No resolution. Just contradiction.

---

### **NEW: Domain 13 — Abandoned Cart Reality**

**Question:** Do potential customers leave before completing purchases?  
**Truth owned:** Intent-to-purchase abandonment existence  
**FT2 Signal:** `cartAbandonmentPresent: boolean | null`  
**Rule:** Not conversion rate. Not "how many". Just "does abandonment exist?"

### **NEW: Domain 14 — Multi-Channel Identity Reality**

**Question:** Is the same customer visible across multiple platforms?  
**Truth owned:** Cross-platform customer coherence  
**FT2 Signal:** `crossChannelIdentityPresent: boolean | null`  
**Rule:** Critical for Amazon → Shopify → Instagram customers.

### **NEW: Domain 15 — Loyalty Signal Reality**

**Question:** Are there any repeat purchase patterns?  
**Truth owned:** Loyalty behavior existence (not program)  
**FT2 Signal:** `repeatPurchasePatternPresent: boolean | null`  
**Rule:** Not CLV, not "value," just pattern existence.

### **NEW: Domain 16 — Support Load Reality**

**Question:** Does customer activity generate support burden?  
**Truth owned:** Support-causing customer activity  
**FT2 Signal:** `supportGeneratingActivityPresent: boolean | null`  
**Rule:** Not ticket count. Not CSAT. Just "does this activity create work?"

### **NEW: Domain 17 — Seasonal Pattern Reality**

**Question:** Does customer behavior show temporal patterns?  
**Truth owned:** Patterned behavior over time  
**FT2 Signal:** `seasonalPatternsDetected: boolean | null`  
**Rule:** Not "what's the pattern?" Just "is there any pattern?"

### **NEW: Domain 18 — Payment Failure Reality**

**Question:** Do customers experience payment failures?  
**Truth owned:** Transaction failure at point of sale  
**FT2 Signal:** `paymentFailuresPresent: boolean | null`  
**Rule:** Critical SMB cash flow signal.

### **NEW: Domain 19 — Shipping Address Reality**

**Question:** Are customer locations consistent and deliverable?  
**Truth owned:** Address validity and consistency  
**FT2 Signal:** `addressIssuesPresent: boolean | null`  
**Rule:** Not "which addresses." Just "are there issues?"

### **NEW: Domain 20 — Discount Dependency Reality**

**Question:** Do customers only engage during promotions?  
**Truth owned:** Promotion-dependent engagement  
**FT2 Signal:** `promotionDependentActivityPresent: boolean | null`  
**Rule:** Critical for margin health.

### **NEW: Domain 21 — Mobile vs Desktop Reality**

**Question:** Do customer behaviors differ by device?  
**Truth owned:** Device-based behavioral divergence  
**FT2 Signal:** `deviceBehaviorDivergencePresent: boolean | null`  
**Rule:** Not "what's the difference." Just "is there difference?"

### **NEW: Domain 22 — Returning vs New Customer Divergence**

**Question:** Do new and returning customers behave differently?  
**Truth owned:** Cohort behavioral divergence  
**FT2 Signal:** `newVsReturningDivergencePresent: boolean | null`  
**Rule:** Critical for SMBs balancing acquisition vs retention.

---

## 3. Architectural Laws (Absolute)

These apply to **every FT2 domain**:

1. One domain → one question
2. Facts are raw and dumb
3. Intelligence classifies only
4. FTEP downgrades only
5. `null` is first-class
6. Unknown propagates aggressively
7. No lifecycle mutation
8. No advice
9. No optimization
10. No "helpfulness"

Violation = rollback.

---

## 4. Free vs Paid (Policy, Not Architecture)

**Principle**
> Paid removes blindfolds.  
> Free never lies.

### Examples (Illustrative)

| Signal | Free | Paid |
|--------|------|------|
| `activityDirection` | `unknown` | `up` / `down` |
| `instrumentationGaps` | `hidden` | `exposed` |
| `cartAbandonmentPresent` | `null` | `boolean` |
| `crossChannelIdentityPresent` | `null` | `boolean` |
| Counts | ❌ (never) | ❌ (never) |

Paid **never** adds:

* counts
* ratios
* explanations
* recommendations

---

## 5. Alignment Planes (Post-FT2 Phase)

Alignment Planes activate **only after FT2 is complete and stable**.

They:

* add **no new signals**
* compare existing truths across modules

---

### Alignment Plane Definition
>
> An Alignment Plane exposes whether two realities **agree, diverge, or cannot be compared**.

No causes.  
No blame.  
No fixes.

---

### **Alignment Plane #1 — Demand Reality**

**Customers ↔ Orders**  
`demandAlignment: aligned | divergent | unknown`

### **Alignment Plane #2 — Engagement ↔ Revenue**

**Customers ↔ Finance**  
`engagementRevenueAlignment: aligned | divergent | unknown`

### **Alignment Plane #3 — Customer ↔ Product Reality**

**Customers ↔ Inventory/Product**  
`customerProductAlignment: aligned | divergent | unknown`

### **Alignment Plane #4 — Cross-Domain Trust Plane**

**All Domains**  
`crossDomainTrust: aligned | divergent | unknown`

### **NEW: Alignment Plane #5 — Cart ↔ Purchase Reality**

**Customers ↔ Orders**  
`cartPurchaseAlignment: aligned | divergent | unknown`  
**Question:** Do cart abandonments align with actual lost orders?

### **NEW: Alignment Plane #6 — Customer ↔ Inventory Reality**

**Customers ↔ Inventory**  
`customerInventoryAlignment: aligned | divergent | unknown`  
**Question:** Do customer views align with inventory availability?

### **NEW: Alignment Plane #7 — Acquisition ↔ Retention Reality**

**Customers ↔ Customers**  
`acquisitionRetentionAlignment: aligned | divergent | unknown`  
**Question:** Do new customer signals align with retention signals?

### **NEW: Alignment Plane #8 — Channel ↔ Customer Reality**

**Marketing ↔ Customers**  
`channelCustomerAlignment: aligned | divergent | unknown`  
**Question:** Do channel investments align with actual customer behavior?

### **NEW: Alignment Plane #9 — Support ↔ Purchase Reality**

**Support ↔ Customers ↔ Orders**  
`supportPurchaseAlignment: aligned | divergent | unknown`  
**Question:** Do support patterns align with purchase patterns?

### **NEW: Alignment Plane #10 — Promo ↔ Profit Reality**

**Customers ↔ Finance**  
`promoProfitAlignment: aligned | divergent | unknown`  
**Question:** Do promotional engagement patterns align with profitability?

---

## 6. Why This Becomes a Must-Have for Ecommerce SMBs

Most tools answer:  
> "What happened?"

FT2 answers:  
> **"What do you *not actually know* about your customers?"**

That moment collapses false confidence.  
Once contradictions, gaps, and blindness are visible across 22 domains, users cannot unsee them.

SMBs aren't drowning in data—they're drowning in **incomplete data across 10+ silos**.  
This FT2 forces visibility into the gaps between:

* Who sees the product vs who buys it
* Who buys once vs who buys again  
* What works on mobile vs desktop
* What happens with vs without promotions
* What customers intend vs what actually happens

That is the lock-in.

---

## 7. Mandatory Build Order

1. Lock FT2 domains (this document) ✅
2. Implement all Facts layers
3. Implement Intelligence (classification only)
4. Implement FTEP (downgrade only)
5. Stabilize boring UI rendering
6. Introduce Alignment Planes
7. Decide Free vs Paid exposure

Skipping steps creates semantic debt.

---

## 8. Enforcement Checklist

* [ ] No new signal without domain
* [ ] No paid-only truth
* [ ] No frontend inference
* [ ] No backend explanations
* [ ] No counts
* [ ] No ratios
* [ ] No optimization language
* [ ] No recommendations
* [ ] No customer "value" scoring
* [ ] No hidden attribution models
* [ ] No channel performance comparisons
* [ ] No "ideal customer" profiling
* [ ] No LTV calculations
* [ ] No churn predictions
* [ ] No engagement scoring
* [ ] No "health" metrics
* [ ] No conversion rate optimization
* [ ] No A/B test results

---

## 🔐 Final Lock Statement

FT2 is the **epistemic foundation** of the platform.

If this layer lies, everything above it manipulates.  
If this layer is clean, the product becomes unavoidable.

This canon is **locked**.