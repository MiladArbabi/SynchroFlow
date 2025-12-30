# SKU OS — Product Health & Inventory Intelligence (CNS Module Blueprint v1.1)

> **Mission:** Serve as the CNS layer responsible for *product-level health, risk detection, and attention prioritization*, powered by normalized demand, returns-quality, and issue-quality signals.

This document defines the **locked v1.1 contract** between:

- SKU OS (product health engine)
- OrderNexus (demand & returns-rate)
- ReturnNexus (returns-quality truth)
- ProblemCenter (canonical warehouse issue model)
- InsightCore (analytics propagation)
- WMS Lite (optional read-only context)

Any change to locked interfaces requires creating `SKU-OS_v2.md` and a migration plan.

---

## 0. Role, Mission & Module Boundaries

### 0.1 Role in the CNS Architecture

**Module ID:** `sku-os`  
**Module Layer:** CNS Intelligence → Inventory Domain

**Purpose:**  
Answer the questions:

- “Which products need attention today?”
- “Why are they at risk?”
- “What should I do next?”

SKU OS provides:

- Product Health Scores (0–100)
- Stockout Risk
- Returns & Defect Risk integrations
- Attention Rankings & Reasoning
- Upstream analytics events for InsightCore

### 0.2 SKU OS *Owns*

**Product Health Intelligence:**

- The full scoring engine
- HealthScore decomposition
- Confidence rules & degradation model

**Degradation Mapping Logic (Locked):**

- Deterministic mapping from:
  - Return quality (`InspectionResult × IssueRootCause`)
  - Warehouse issues (`IssueType × IssueSeverity`)
- Controlled evolution under versioning

**Product Attention API:**

- Ranking
- Attention reasons
- Confidence summary
- Empty-state semantics

**ProductHealthAnalyticsEvent:**

- SKU OS is the *only* producer of this analytics signal.

### 0.3 SKU OS *Does NOT Own*

SKU OS consumes — but NEVER reinterprets — the following domains:

|        Domain               | Owner       |          SKU OS Rule           |
|-----------------------------|-------------|--------------------------------|
| Order profitability         | OrderNexus  | MUST NOT recompute or override |
| Returns lifecycle/decisions | ReturnNexus | MUST treat their quality enums as canonical |
| Warehouse operations & inventory ledger | WMS Lite | Read-only; SKU OS does not mutate stock |
| Warehouse issue detection | ProblemCenter | MUST consume their canonical issue taxonomy |
| Customer intent, cohorts, or LTV | Specter | MUST not infer customer attributes |
| Global analytics warehouse | InsightCore | SKU OS only publishes analytics events |

> **Boundary Rule:**  
> SKU OS decides *“Product X is at risk and here’s why”* using standardized degradation tables.  
> SKU OS MUST NOT invent alternative root-cause mappings or its own version of returns or issue taxonomies.

---

## 1. Core v1 Output Contracts

### 1.1 Product Attention API – Empty Set & Null Handling (Locked)

> **Purpose:** Drive the “N products that need attention today” UI.

**Empty set behavior:**

// When NO products are at risk:
{
  data: [],
  meta: {
    total_at_risk: 0,
    recalculated_at: null,  // explicitly null when empty
    confidence_summary: {
      high: 0,
      medium: 0,
      low: 0
    }
  }
}

// UI MUST show: "🎉 All products look healthy today!"

**Null field handling (UI contract, no interpretation drift):**

const NULL_HANDLING_RULES = {
  days_of_supply: {
    display: 'Days of supply: —',
    tooltip: 'Not enough data to estimate yet.'
  },
  estimated_margin: {
    display: 'Margin: Unknown',
    cta: 'Add cost to unlock margin insights'
  },
  margin_health: {
    when: 'unknown',
    display: 'Margin health: ❓ Unknown',
    tooltip: 'We need cost data to assess margin health'
  }
};

The **shape** of the product attention API is locked; we’re only clarifying inputs and degradation rules.

### 1.2 ProductHealthAnalyticsEvent → InsightCore (Locked)

SKU OS exposes (unchanged):

// sku-os → insight-core

export interface ProductHealthAnalyticsEvent {
  shopId: number;
  productId: number;
  healthScore: number;          // 0–100
  stockoutRisk: number;         // 0–1
  marginHealth: 'healthy' | 'at_risk' | 'critical' | 'unknown';
  confidence: 'low' | 'medium' | 'high';
  recalculatedAt: string;       // ISO
}

SKU OS is the **only producer** of `ProductHealthAnalyticsEvent`.

---

## 2. Inputs — Who Feeds SKU OS, and What Is Canonical (LOCKED v1.1)

SKU OS is a **pure consumer** of upstream signals.  
It MUST NOT generate its own interpretations of returns or issues.  
It MUST NOT infer profitability or inventory ledger truth.

Below are the only approved sources of truth SKU OS may use.

---

## 2.1 OrderNexus → SKU OS — Demand, Velocity & Returns Rate

SKU OS uses demand & returns-rate ONLY from OrderNexus’ canonical demand table.

### 2.1.1 Canonical Table (Owned by OrderNexus)

sql
CREATE TABLE product_demand_signals (
  shop_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,

  order_count_7d INTEGER DEFAULT 0,
  order_count_30d INTEGER DEFAULT 0,

  unit_sales_7d INTEGER DEFAULT 0,
  unit_sales_30d INTEGER DEFAULT 0,

  returns_rate_30d DECIMAL(4,3),   -- 0–1, computed by OrderNexus using ReturnNexus truth
  avg_selling_price DECIMAL(10,2),

  last_order_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (shop_id, product_id)
);

2.1.2 Locked Rules
SKU OS must treat this table as read-only.

SKU OS must NOT recompute returns rate; it comes from OrderNexus which merges ReturnNexus outcomes.

SKU OS must NOT derive demand from raw Shopify data — only canonical demand feeds it.

Missing rows MUST be treated as:

{
  unit_sales_30d: 0,
  order_count_30d: 0,
  returns_rate_30d: 0,
  last_order_at: null,
  avg_selling_price: null
}
This allows SKU OS to compute:

demandVelocity

stockoutRisk

lifecycle tags (hero, drifter, zombie)

2.2 OrderNexus → SKU OS — Real-Time Demand Events (Optional v1)
SKU OS may optionally receive incremental events for real-time health updates:

// order-nexus → sku-os
export interface OrderCompletedEvent {
  shopId: number;
  orderId: string;
  lineItems: Array<{ productId: number; quantity: number; finalPrice: number }>;
  completedAt: string;
}

export interface OrderReturnedEvent {
  shopId: number;
  orderId: string;
  lineItems: Array<{ productId: number; quantity: number }>;
  returnedAt: string;
}
Rules
OrderCompletedEvent drives velocity only (recency, 7-day/30-day adjustments).

OrderReturnedEvent adjusts net demand only (not quality signals).

SKU OS must not derive quality from returns — this comes from ReturnNexus.

2.3 ReturnNexus → SKU OS — Canonical Returns Quality (LOCKED)
ReturnNexus provides the only source of truth for returns-quality inputs.

export interface ReturnAnalyticsEvent {
  shopId: number;
  returnId: string;
  orderId: string;
  productId: string;
  quantity: number;

  reasonCategory: ReturnReasonCategory;
  inspectionResult: InspectionResult;
  issueRootCause: IssueRootCause;

  refundAmount: number;
  currency: string;
  restockable: boolean;

  processedAt: string;  // ISO timestamp
}
Locked Rules
SKU OS MUST treat:

ReturnReasonCategory

InspectionResult

IssueRootCause

restockable

as opaque, canonical enums from returns-quality-contract.

SKU OS MUST NOT:

re-interpret,

overwrite,

derive secondary meanings from them.

All degradation mapping MUST reference the canonical tables (defined later).

2.4 ProblemCenter → SKU OS — Canonical Product Quality Events (LOCKED)
ProblemCenter owns the only warehouse-quality and inspection issue model in the CNS.

export interface ProductQualityEvent {
  shopId: number;
  productId: string;

  issueType: IssueType;
  severity: IssueSeverity;
  sourceStep: IssueSourceStep;
  issueId: string;

  occurredAt: string; // ISO timestamp
}
Locked Rules
SKU OS MUST consume this event as-is.

SKU OS MUST NOT generate or mutate quality events.

SKU OS MUST NOT maintain its own issue taxonomy.

SKU OS MUST map this input using the canonical degradation table in §3.

ProblemCenter → SKU OS is the exclusive quality pipeline.

2.5 WMS Lite → SKU OS — Optional Raw Inspection Context (Read-Only)
SKU OS MAY consume ReturnInspectionEvent from WMS Lite for richer raw fields, but:

SKU OS MUST NOT derive root-cause from WMS codes.

SKU OS MUST NOT generate its own mapping from physical condition to:

InspectionResult

IssueRootCause

If any conflict occurs, ReturnNexus truth wins, followed by ProblemCenter truth.

2.6 InsightCore — Downstream Consumer (Analytics)
InsightCore is not an input; it is the downstream analytics consumer of:

ProductHealthAnalyticsEvent
SKU OS MUST publish this event after each health recalculation.

2.7 Summary Table — Module Responsibilities (Locked)
Signal / Table Owner SKU OS Role
product_demand_signals OrderNexus Read-only
ReturnAnalyticsEvent ReturnNexus Read-only, degrade health
ProductQualityEvent ProblemCenter Read-only, degrade health
ReturnInspectionEvent WMS Lite Optional raw hints (read-only)
ProductHealthAnalyticsEvent SKU OS SKU OS must emit

---

## 3. Canonical Degradation Mapping (LOCKED v1.1)

SKU-OS must convert *returns quality* and *warehouse quality issues* into deterministic
negative impact on `healthScore`.  
This mapping is **canonical**, centralized, and MUST NOT be forked by modules.

SKU-OS MAY adjust internal heuristics, but the **bucket + delta tables are immutable for v1.1**.

---

## 3.1 Degradation Buckets (Locked)

export type DegradationBucket = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface DegradationEffect {
  bucket: DegradationBucket;
  healthScoreDelta: number;   // negative = degradation
}
All degradation is additive and reduces health unless bucket = NONE.

3.2 Returns-Driven Degradation (ReturnNexus → SKU-OS)
SKU-OS MUST classify returns using the canonical cross-mapping of:

InspectionResult

IssueRootCause

Both come from ReturnNexus and MUST be treated as opaque enums.

3.2.1 Canonical Table (Locked)
InspectionResult IssueRootCause Bucket Δ Health
APPROVED_REFUND_SCRAP MANUFACTURING_QUALITY HIGH -10
APPROVED_REFUND_SCRAP PACKAGING_QUALITY HIGH -10
APPROVED_REFUND_SCRAP CARRIER_DAMAGE MEDIUM -6
APPROVED_REFUND_RESTOCKABLE MANUFACTURING_QUALITY MEDIUM -5
APPROVED_REFUND_RESTOCKABLE PACKAGING_QUALITY MEDIUM -5
APPROVED_REFUND_RESTOCKABLE CARRIER_DAMAGE LOW -3
PARTIAL_REFUND FULFILLMENT_ERROR MEDIUM -5
PARTIAL_REFUND CUSTOMER_EXPECTATIONS LOW -2
PARTIAL_REFUND CUSTOMER_MISUSE LOW -2
REJECTED_REFUND CUSTOMER_MISUSE NONE 0
REJECTED_REFUND CUSTOMER_EXPECTATIONS LOW -1
REJECTED_REFUND MANUFACTURING_QUALITY MEDIUM -4
ANY UNKNOWN LOW -2

3.2.2 Selection Rules (Locked)
Exact (inspectionResult, issueRootCause) match → use it.

If missing, fallback to (inspectionResult, UNKNOWN).

If still missing, default:

{ bucket: 'LOW', healthScoreDelta: -2 }
3.3 Quantity Scaling (Locked)
SKU-OS MAY scale degradation by units returned relative to units ordered.

Canonical Formula:

ratio = unitsOrdered ? min(1, unitsReturned / unitsOrdered) : 1;

effect.healthScoreDelta = baseDelta * ratio;
Important:
Scaling modifies Δ, NOT bucket.

Example:
Base delta = -10

unitsReturned = 1

unitsOrdered = 5

→ ratio = 0.2
→ adjusted delta = -2.

3.4 ProblemCenter Issue-Driven Degradation (Locked)
ProblemCenter owns the only warehouse issue taxonomy.

SKU-OS maps:

IssueType

IssueSeverity

to degradation via the canonical table:

3.4.1 Canonical Table (Locked)
IssueType Severity Bucket Δ Health
PRODUCT_DEFECT HIGH/CRITICAL HIGH -8
PRODUCT_DEFECT MEDIUM MEDIUM -5
PRODUCT_DEFECT LOW LOW -2
PACKAGING_DEFECT HIGH/CRITICAL MEDIUM -5
PACKAGING_DEFECT MEDIUM LOW -3
PACKAGING_DEFECT LOW LOW -1
SHIPPING_DAMAGE HIGH/CRITICAL MEDIUM -5
SHIPPING_DAMAGE MEDIUM LOW -3
SHIPPING_DAMAGE LOW LOW -1
MISSING_ITEM ANY MEDIUM -5
WRONG_ITEM ANY MEDIUM -5
OTHER_FULFILLMENT_ERROR ANY LOW -2

3.4.2 Selection Rules
HIGH and CRITICAL are equivalent for mapping.

If (IssueType, Severity) lacks a row → fallback:

{ bucket: 'LOW', healthScoreDelta: -2 }
3.5 Combined Returns + Issue Impact (Locked)
If both ReturnAnalyticsEvent and ProductQualityEvent occur for same product in the same day:

SKU-OS MAY sum deltas BUT MUST clamp daily degradation:

maxDailyDegradation = -15;
Meaning:

healthScoreDelta = max(healthScoreDeltaSum, -15);
Bucket does not change — only the cumulative delta clamps.

3.6 Canonical Helper Interfaces (Must Exist)

export interface DegradationInputFromReturn {
  inspectionResult: InspectionResult;
  issueRootCause: IssueRootCause;
  unitsReturned: number;
  unitsOrdered?: number;
}

export interface DegradationInputFromIssue {
  issueType: IssueType;
  severity: IssueSeverity;
}
SKU-OS MUST expose these helper functions:

export function computeDegradationFromReturn(
  input: DegradationInputFromReturn
): DegradationEffect;

export function computeDegradationFromIssue(
  input: DegradationInputFromIssue
): DegradationEffect;
Both MUST implement the tables + ratio logic above.

3.7 What SKU-OS MUST NOT Do (Locked)
SKU-OS MUST NOT:

Recompute IssueRootCause from raw WMS fields.

Invent new degradation categories or buckets.

Change table values without a version bump (v2).

Interpret customer behavior (Specter job).

Infer profitability impact (OrderNexus job).

Generate its own quality or return signals.

SKU-OS is a translation layer, not a re-interpreter of returns/quality truth.

---

## 4. Internal Product Health Model (Locked v1.1)

The `ProductHealthSnapshot` is the internal state from which SKU-OS computes trends,
degradation, attention rankings, and analytics events.

Only **ProductHealthAnalyticsEvent** (the external event emitted to InsightCore) is public.
SKU-OS may evolve internal fields ONLY if meaning remains aligned with this contract.

---

## 4.1 Canonical ProductHealthSnapshot Shape (Locked Meaning, Evolvable Internally)

```ts
export interface ProductHealthSnapshot {
  shopId: number;
  productId: number;

  // Core health dimensions
  healthScore: number;       // 0–100 composite score
  stockoutRisk: number;      // 0–1 probability estimate
  marginHealth: 'healthy' | 'at_risk' | 'critical' | 'unknown';
  returnsRisk: number;       // 0–1 derived from return events + returns_rate_30d
  defectRate: number;        // 0–1 driven by ProblemCenter ProductQualityEvents

  // Confidence in calculations (data completeness + stability)
  confidence: 'low' | 'medium' | 'high';

  // Demand fundamentals
  demandVelocity30d: number;  // pulled from product_demand_signals.unit_sales_30d
  demandVelocity7d?: number;  // optional internal field
  lastOrderAt?: string;       // optional for recency weighting

  // Timestamps
  updatedAt: string;          // ISO timestamp when snapshot was last recalculated
}
Locked semantics:

healthScore MUST always be in 0–100 range.

stockoutRisk MUST always be 0–1.

marginHealth = 'unknown' MUST be used when costs are missing (SKU-OS does NOT infer or recompute COGS).

confidence MUST reflect availability of demand, return, and issue signals.

demandVelocity30d MUST derive exclusively from OrderNexus demand signals, NOT from raw Shopify, NOT from SKU-OS recomputation.

Allowed internal evolution:

You may add additional internal scoring components.

You may refine weighting logic.

You may extend snapshot with internal-only fields (namespaced or not), as long as emitted analytics events are unchanged.

4.2 Required Relationships (Locked)
SKU-OS MUST enforce the following meaning-level rules:

healthScore is monotonic with degradation
Applying return or issue events MUST reduce healthScore (never increase it).

stockoutRisk must depend on demand AND (optionally) inventory
SKU-OS may use:

demandVelocity30d

lastOrderAt

future integration with inventory levels (via WMS Lite)

but MUST NOT recompute demand velocity.

marginHealth depends ONLY on COGS presence (for v1)

healthy → COGS known AND net margin (from OrderNexus) acceptable

unknown → COGS missing
SKU-OS MUST NOT infer margin from price alone.

returnsRisk grows only via ReturnAnalyticsEvents
SKU-OS must not use its own handcrafted return logic.

defectRate grows only via ProductQualityEvent
SKU-OS must not inspect raw warehouse data or recompute issue root causes.

confidence must degrade when signals are missing
Example:

No demand data → low

No return or issue data → medium

Full signal surface + stable events → high

4.3 HealthScore Composition (Allowed Internal Variation)
SKU-OS must implement a composite scoring model:

ts
Copy code
healthScore = clamp(
    BASE
  + returnsImpact
  + issueImpact
  + demandStabilityImpact
  + marginHealthImpact
, 0, 100);
Locked constraints:

returnsImpact and issueImpact MUST come from canonical tables.

marginHealthImpact MUST NOT include profit calculations (OrderNexus job).

SKU-OS may refine BASE or add weighting factors, but not diverge semantically.

4.4 When SKU-OS Pushes Analytics Events
Every time a product snapshot updates, SKU-OS MUST emit:

ts
Copy code
ProductHealthAnalyticsEvent {
  shopId,
  productId,
  healthScore,
  stockoutRisk,
  marginHealth,
  confidence,
  recalculatedAt
}
Fields derived from ProductHealthSnapshot MUST map 1:1.

SKU-OS MUST NOT include:

proprietary fields

module-specific flags

raw degradation details

derivative metrics not part of the locked event contract

Only the canonical event shape is emitted.

4.5 Version Stability Rules
SKU-OS MAY:

add internal fields

adjust internal weighting

expand logic for confidence scoring

maintain additional time windows

add internal caching

SKU-OS MAY NOT:

change meaning of healthScore, marginHealth, stockoutRisk, returnsRisk, defectRate

change degradation table values (v1.1 locked)

introduce positive health boosts without explicit v2 contract

modify or rename fields in ProductHealthAnalyticsEvent

Any such change requires:

new contract file: SKU-OS_v2.md

migration of analytics consumers

version bump in InsightCore compatibility matrix

4.6 Health Snapshot Lifecycle (Locked Expectations)
SKU-OS MUST:

Start with a neutral baseline (e.g., healthScore = 85 recommended, but not mandated).

Apply degradation incrementally upon each event.

Recompute snapshot at least:

on demand event

on return event

on issue event

daily batch (before 6 AM shop local time)

Ensure:

no cumulative degradation beyond daily clamp

no oscillation that contradicts canonical tables

SKU-OS MAY implement a “slow healing” model over time, BUT:

MUST NOT exceed prior healthScore baseline

MUST NOT diminish visibility of returns or issue signals within 30 days

MUST NOT counteract negative deltas artificially

Healing must be extremely conservative (phase 2+).

---

## 5. Health Engine – How SKU OS Uses Inputs (Locked v1.1)

SKU-OS must implement a deterministic, event-driven scoring model that applies
**canonical degradation** from returns + issues and **demand dynamics** from OrderNexus.

This section defines the *only permitted v1.1 semantics* for the health engine.

---

## 5.1 Overview of Health Flow (Locked Behavior)

Every recalculation follows this canonical sequence:

1. **Load or create baseline ProductHealthSnapshot**  
2. **Apply ReturnAnalyticsEvent degradation** (via canonical table)  
3. **Apply ProductQualityEvent degradation** (via canonical table)  
4. **Apply demand-based adjustments**  
5. **Clamp final healthScore ∈ [0, 100]**  
6. **Recompute stockoutRisk**  
7. **Recompute confidence**  
8. **Persist updated snapshot**  
9. **Emit ProductHealthAnalyticsEvent**

SKU-OS MUST NOT reorder degradation steps or override the canonical tables.

---

## 5.2 Return-Driven Degradation (Locked)

SKU-OS MUST compute return degradation ONLY using:

```

computeDegradationFromReturn()

````

based on the locked table from Section 3.2.

Implementation pattern (allowed form):

```ts
applyReturnImpact(snapshot, returnEvents) {
  let health = snapshot.healthScore;
  let returnsRisk = snapshot.returnsRisk;

  for (const ev of returnEvents) {
    if (ev.productId !== snapshot.productId) continue;

    const effect = computeDegradationFromReturn({
      inspectionResult: ev.inspectionResult,
      issueRootCause: ev.issueRootCause,
      unitsReturned: ev.quantity,
      unitsOrdered: ev.unitsOrdered // optional
    });

    // healthScore MUST decrease (effect.healthScoreDelta is negative)
    health += effect.healthScoreDelta;

    // returns risk grows slowly but monotonically
    returnsRisk = Math.min(1, returnsRisk + 0.02);
  }

  return {
    ...snapshot,
    healthScore: clamp(health, 0, 100),
    returnsRisk
  };
}
````

**Locked constraints:**

- MUST use canonical table (no local overrides).
- MUST scale by unit ratio if provided.
- MUST NOT increase healthScore.
- MUST clamp daily degradation to ≥ −15 per productId.

---

## 5.3 Issue-Driven Degradation (Locked)

SKU-OS MUST compute issue-driven degradation ONLY using:

```
computeDegradationFromIssue()
```

based on canonical table from Section 3.4.

Example allowed implementation:

```ts
applyIssueImpact(snapshot, issues) {
  let health = snapshot.healthScore;
  let defectRate = snapshot.defectRate;

  for (const issue of issues) {
    if (issue.productId !== snapshot.productId) continue;

    const effect = computeDegradationFromIssue({
      issueType: issue.issueType,
      severity: issue.severity
    });

    health += effect.healthScoreDelta;

    defectRate = Math.min(1, defectRate + Math.abs(effect.healthScoreDelta) / 100);
  }

  return {
    ...snapshot,
    healthScore: clamp(health, 0, 100),
    defectRate
  };
}
```

**Locked constraints:**

- MUST use canonical issue degradation table.
- MUST NOT interpret WMS raw events; only ProblemCenter events.
- MUST NOT infer categories not in the shared taxonomy.
- Degradation MUST be ≤ 0.

---

## 5.4 Demand-Based Adjustments (Allowed, Non-Canonical)

Demand modifies **healthScore** and **stockoutRisk**, but:

- MUST NOT exceed bounds.
- MUST NOT override canonical degradation.
- MUST NOT recompute velocity; only consume from `product_demand_signals`.

Allowed internal algorithm:

```ts
applyDemandDynamics(snapshot, demand) {
  const velocity = demand.unit_sales_30d ?? 0;

  // reward stable demand with mild upward nudge (capped)
  const demandBonus =
    velocity > 20 ? +2 :
    velocity > 10 ? +1 :
    0;

  return {
    ...snapshot,
    healthScore: clamp(snapshot.healthScore + demandBonus, 0, 100)
  };
}
```

**Locked constraint:**
Demand MAY increase healthScore slightly, but **NEVER by more than +2 in a single recalculation**.

---

## 5.5 StockoutRisk Calculation (Allowed Formula Family)

SKU-OS MUST compute stockoutRisk based on:

- demandVelocity30d
- (optional) inventory quantity (if provided by WMS Lite)
- lastOrderAt recency

Minimum required model:

```ts
computeStockoutRisk(velocity30d, stockAvailable) {
  if (!velocity30d || velocity30d <= 0) return 0;

  const daysOfSupply = stockAvailable / (velocity30d / 30);
  return clamp(1 - daysOfSupply / 30, 0, 1);
}
```

**Locked constraints:**

- MUST be monotonic: lower stock → higher risk.
- MUST return 0–1.
- MUST NOT attempt to infer inventory ledger; accept only external quantities.

---

## 5.6 Confidence Scoring (Locked Semantics, Flexible Algorithm)

SKU-OS MUST compute a `confidence` score in:

```
'low' | 'medium' | 'high'
```

based on signal availability:

| Condition                                    | Confidence |
| -------------------------------------------- | ---------- |
| No demand signals OR no returns/issue events | low        |
| Demand + returns present, but unstable       | medium     |
| Demand stable + signals consistent ≥ 14 days | high       |

Allowed structure:

```ts
computeConfidence({ demand, returns, issues }) {
  if (!demand || demand.historyLength < 7) return 'low';
  if (!returns && !issues) return 'low';

  if (demand.historyLength < 14) return 'medium';
  return 'high';
}
```

The exact numeric thresholds MAY change internally, but semantic meanings MUST stay consistent.

---

## 5.7 SKU-OS Recalculation Cycle (Locked Order)

The full update cycle MUST execute in this order:

1. Load baseline snapshot
2. Apply return degradation
3. Apply issue degradation
4. Apply demand dynamics
5. Recompute stockoutRisk
6. Recompute confidence
7. Clamp final healthScore
8. Persist snapshot
9. Emit `ProductHealthAnalyticsEvent`

**Locked:**

- Return degradation MUST run before issue degradation.
- Demand MUST run after all degradation.

---

## 5.8 Emitted Analytics Event (Locked)

After every recalculation:

```ts
emitProductHealthAnalyticsEvent({
  shopId,
  productId,
  healthScore,
  stockoutRisk,
  marginHealth,
  confidence,
  recalculatedAt: new Date().toISOString()
});
```

**No additions, no omissions, no renaming.**

---

## 5.9 What SKU-OS MUST NOT Do

- MUST NOT recompute ⚠️:

  - return quality enums
  - issue root causes
  - return reasons
  - profit/margin per order
  - inventory at warehouse level
- MUST NOT combine WMS + ReturnNexus signals into new categories
- MUST NOT create new degradation tables
- MUST NOT apply positive “healing” without explicit v2 contract
- MUST NOT change event schema

This ensures SKU-OS stays strictly within its CNS node responsibility.

---

## 6. Demand Forecasting & Replenishment (Phase 2 – Interface-Only, Locked Semantics)

Forecasting is **NOT implemented in SKU-OS v1**.  
This section exists to lock:

- the **interfaces**,  
- the **data contracts**, and  
- the **semantic guarantees**  

…so that future forecasting engines can be integrated **without breaking SKU-OS v1 consumers** (InsightCore, Inventory widgets, WMS-Lite, CNS Context Engine).

---

## 6.1 Purpose & Constraints

**Purpose:**  
Provide SKU-OS with a stable **forecasting contract** so that advanced planning (Phase 2+) can be added without API churn.

**Constraints for v1:**

1. SKU-OS v1 MUST NOT:
   - generate forecasts,
   - create reorder recommendations,
   - compute elasticity,
   - override inventory ledger values,
   - run statistical or ML engines.

2. SKU-OS v1 MUST expose **interfaces only** — no implementations.

3. All forecasting values must be:
   - optional,
   - nullable,
   - ignored by SKU-OS v1 consumers.

This ensures SKU-OS remains predictable and light while future CNS forecasting evolves independently.

---

## 6.2 Forecasting Input Envelope (Stable v1 Contract)

All forecasting engines must consume the same canonical envelope:

```ts
export interface ForecastingInput {
  shopId: number;
  productId: number;

  // Demand signals from OrderNexus
  unitSales7d: number;
  unitSales30d: number;
  orderCount7d: number;
  orderCount30d: number;
  lastOrderAt: string | null;

  // Optional: inventory context (from WMS Lite)
  stockAvailable?: number | null;
  supplierLeadTimeDays?: number | null;

  // Health context (from SKU-OS core)
  currentHealthScore: number;
  confidence: 'low' | 'medium' | 'high';

  // Timestamps
  generatedAt: string;
}
````

**Locked rules:**

- SKU-OS MUST NOT modify or reinterpret demand signals.
- SKU-OS MUST NOT infer multi-location stock or reorder logic.
- All forecasting inputs MUST remain additive — no breaking changes.

---

## 6.3 Forecasting Output Envelope (Locked v1 Contract)

Forecasting engines (Phase 2+) MUST output:

```ts
export interface EnhancedDemandForecast {
  baseDemand: number | null;          // nullable for v1
  enhancedForecast: number | null;    // v1: always null
  confidence: 'low' | 'medium' | 'high';
  stockoutProbability: number | null; // 0–1 or null (v1)
  reorderRecommendation: ReorderRecommendation | null;
}
```

**Locked semantics:**

- All fields MUST allow `null` in v1.
- SKU-OS v1 MUST set ALL fields to `null`, except `confidence`.
- CNS and widgets MUST treat null as “no forecast available.”

---

## 6.4 ReorderRecommendation Contract (Stable for Future Versions)

Future forecasting engines may return:

```ts
export interface ReorderRecommendation {
  productId: number;
  recommendedQuantity: number;
  urgency: 'critical' | 'high' | 'medium';
  reason: string;

  supplierLeadTimeDays: number | null;   // from WMS or merchant config
  expectedStockoutDate: string | null;   // ISO
  estimatedCost: number | null;          // currency not enforced
  expectedROI: number | null;            // simple ratio or null
  confidence: 'low' | 'medium' | 'high';
}
```

**Locked rules:**

- SKU-OS v1 MUST NEVER compute or emit a `ReorderRecommendation`.
- Widgets MUST hide reorder UI until forecasting is enabled.
- No field names may change without a v2 contract.
- All future engines MUST adhere to the shape above.

---

## 6.5 Forecasting Engine Integration Boundary (Locked)

SKU-OS MUST integrate forecasting **only via an injected engine**, never internally.

Allowed abstract interface:

```ts
export interface ForecastingEngine {
  forecast(input: ForecastingInput): Promise<EnhancedDemandForecast>;
}
```

**Locked constraints:**

- SKU-OS MUST run forecasting AFTER healthScore calculation.
- SKU-OS MUST NOT persist forecasting outputs inside its own tables.
- SKU-OS MUST treat forecasting outputs as ephemeral metadata.
- InsightCore alone decides how (and if) forecast data is stored or visualized.

---

## 6.6 v1 Implementation Requirements (Explicit)

In SKU-OS v1:

- `ForecastingEngine` MUST be a **no-op** implementation.
- All outputs MUST be:

```ts
{
  baseDemand: null,
  enhancedForecast: null,
  stockoutProbability: null,
  reorderRecommendation: null,
  confidence: snapshot.confidence
}
```

This ensures:

- no accidental forecasting leakage,
- no premature surface area,
- no cross-module contradiction.

---

## 6.7 CNS Context Interaction (Locked)

Forecasting MUST be interpreted in CNS through InsightCore once enabled.

SKU-OS MUST NOT:

- vary forecasting by CNS “mode” (Survival/Growth/Architect),
- apply urgency coloring,
- apply business framing,
- surface CTAs.

All contextual adaptation is InsightCore’s job (CNS layer), not SKU-OS’.

---

## 6.8 Future v2 Upgrade Path (Informational)

When SKU-OS forecasting is activated in v2:

- SKU-OS MAY:

  - call an ML/heuristic forecasting engine,
  - combine demand signals with health & returns signals,
  - generate reorder recommendations based on lead time.

- SKU-OS MUST NOT:

  - rewrite ReturnNexus or ProblemCenter signals,
  - generate inconsistent degraded vs forecasted signals,
  - mutate inventory ledger.

---

## 6.9 Summary of v1 Guarantees (Locked)

SKU-OS v1:

- ✔︎ Provides **no forecasting logic**
- ✔︎ Provides **stable forecasting interfaces**
- ✔︎ Provides **null-safe forecasting outputs**
- ✔︎ Lets InsightCore handle CNS interpretation
- ✔︎ Ensures forward compatibility with v2 forecasting engines

---

## 7. Integration SLAs & Quality Gates (Locked v1)

SKU-OS depends on **three upstream signal streams**:

1. **Demand signals** → from OrderNexus  
2. **Returns quality signals** → from ReturnNexus  
3. **Product quality & issue signals** → from ProblemCenter  

And optionally:

4. **Inventory context** → from WMS-Lite (read-only, not required)

**To guarantee consistent CNS intelligence, SKU-OS MUST meet the following SLAs and quality gates:**
---

## 7.1 Data Flow SLAs (v1 Hard Requirements)

### ➤ 7.1.1 Demand Signals (OrderNexus → SKU-OS)

```

Latency Target:       < 5 minutes
Freshness Target:     > 99% of products updated within 60 minutes
Completeness Target:  > 99.9% of normalized orders reflected in velocity signals

```

**Contract:**

- SKU-OS MUST recalculate `demandVelocity30d` **every time new demand signals arrive**.
- OrderNexus is the *single source of truth* for:
  - `unit_sales_7d`, `unit_sales_30d`
  - `order_count_7d`, `order_count_30d`
  - `returns_rate_30d`
- SKU-OS MUST NOT infer demand from raw orders.

---

### ➤ 7.1.2 Returns Quality Stream (ReturnNexus → SKU-OS)

```

Latency Target:     < 2 minutes from ReturnOutcomeEvent → SKU-OS health update
Freshness Target:   Daily recalc of all SKU health by 06:00 shop-local time
Completeness:       100% ingestion of ReturnAnalyticsEvent

```

**Rules:**

- SKU-OS MUST apply degradation using the **canonical mapping** (Section 3).
- No local reclassification is allowed.
- Any ReturnAnalyticsEvent failure MUST surface to monitoring (below).

---

### ➤ 7.1.3 Product Quality Stream (ProblemCenter → SKU-OS)

```

Latency Target:     < 2 minutes
Completeness:       100% of ProductQualityEvent must be processed
Freshness Window:   SKU-OS MUST recalc within 30 minutes if backlog is detected

```

Quality signals are essential for the **defectRate** and **healthScore** pipeline.

SKU-OS MUST:  

- Apply canonical degradation tables (Section 3.4).  
- Treat missing or stale issue streams as a CRITICAL health risk (monitoring rule below).  

---

## 7.2 Health Score Recalculations (Locked v1 Expectations)

SKU-OS MUST perform **two types of recalculations**:

### 7.2.1 Event-Driven Recalc (Real Time)

Triggered by:  

- demand updates  
- ReturnAnalyticsEvent  
- ProductQualityEvent  

```

Latency Target:     < 2 minutes from event → updated ProductHealthSnapshot

```

**Contract:**

- SKU-OS MUST update:
  - `healthScore`
  - `stockoutRisk` (if available in v2)
  - `returnsRisk`
  - `defectRate`
  - `confidence`

- SKU-OS MUST emit a new ProductHealthAnalyticsEvent to InsightCore.

---

### 7.2.2 Daily Batch Recalc (Catch-All Sweep)

```

Time Window:        Must complete before 06:00 AM shop-local
Purpose:            Re-sync long-tail SKUs with sparse data

```

SKU-OS MUST:

- Verify demand signal freshness  
- Recompute stale SKUs  
- Emit ProductHealthAnalyticsEvent for stale/updated items  

**This daily batch ensures the CNS always has a complete picture.**

---

## 7.3 Monitoring (What “Healthy SKU-OS” Means)

To maintain CNS guarantees, SKU-OS MUST monitor and expose the following metrics:

### ➤ 7.3.1 Demand Pipeline Monitoring

```

Alert if:
• orders_to_products_latency > 10 minutes
• > 5% of active products missing updated demand signals

```

These signals must surface through the OpsIntel monitoring system (CNS layer).

---

### ➤ 7.3.2 Returns & Quality Monitoring

```

Alert if:
• ReturnAnalyticsEvent stream is silent > 24h for shops with active returns
• ProductQualityEvent stream is silent > 24h on shops with WMS/PC usage
• > 1% of degradation mappings fail or default unexpectedly

```

SKU-OS MUST NOT continue silently if quality data is missing — CNS needs explicit fail signals.

---

### ➤ 7.3.3 Health Score Stability Monitoring

```

Alert if:
• > 15% of SKUs change > 25 points in healthScore in a 1-hour window
• median confidence falls below “medium” for > 6 hours
• > 10% of SKUs have null or stale healthScore for > 6 hours

```

These alerts prevent runaway compounding logic or broken upstream feeds.

---

## 7.4 Business Impact Metrics (Strategic, Not Blocking)

These metrics do not break the contract but inform CNS dashboards:

```

stockout_prevention_rate:         % of predicted stockouts actually prevented
inventory_turnover_improvement:   Reduction in days-of-supply vs baseline
return_related_degradation:       % of SKUs at-risk due to returnsRisk/defectRate
defect_trend_improvement:         Trend in quality-driven issues month-over-month

```

InsightCore will consume these for full CNS reporting.

---

## 7.5 SLA Degradation Behavior (Locked v1)

If any upstream signal stream degrades:

### If Demand Pipeline Fails

- SKU-OS MUST freeze `demandVelocity30d` and set:

```

confidence = 'low'
stockoutRisk = null (for v1)

```

- Emit degraded ProductHealthAnalyticsEvent.

### If ReturnAnalyticsEvent Pipeline Fails

- SKU-OS MUST set:

```

returnsRisk = snapshot.returnsRisk   (no increment)
confidence = 'low'

```

- Emit degraded event with explicit flag.

### If ProductQualityEvent Pipeline Fails

- SKU-OS MUST NOT assume “no issues.”
- SKU-OS MUST apply:

```

defectRate += 0   (no increments)
confidence = 'low'

```

- Emit degraded event.

**CNS consumers MUST treat low-confidence events as warning states.**

---

## 7.6 Summary (Locked v1 Commitments)

SKU-OS v1 MUST:

- Process **all** upstream signals with <2 min latency.
- Produce consistently updated ProductHealthAnalyticsEvent records.
- Provide complete coverage of active SKUs via daily batch.
- Degrade gracefully when upstream modules fail.
- Surface operational health to CNS monitoring.
- NEVER:

- infer data owned by OrderNexus, ReturnNexus, or ProblemCenter,  
- modify inventory or returns states,  
- generate forecasting or reorder outputs (v1).

---

## 8. Developer Contract — Locked v1 (SKU-OS)

> SKU-OS is the CNS subsystem responsible for **product health, degradation modeling, and product-level attention ranking**.
> It MUST operate deterministically, must never recompute upstream truths, and must emit stable,
> InsightCore-ready analytics reflecting true product condition.

This contract defines what SKU-OS MUST do, MUST NOT do, and MAY do in v1.
Any deviation requires **SKU-OS v2** with a formal migration plan.

---

## 8.1 Upstream Responsibilities — What SKU-OS MUST NOT Recompute

SKU-OS **MUST treat the following inputs as canonical and read-only**:

### From **OrderNexus**

- demand velocity (`unit_sales_7d`, `unit_sales_30d`)
- order frequency (`order_count_7d`, `order_count_30d`)
- `returns_rate_30d`
- average selling price
- last order timestamp

SKU-OS MUST NOT:

- Parse raw orders  
- Derive its own returns rate  
- Infer profitability or margin  

All of the above are exclusively OrderNexus responsibilities.

---

### From **ReturnNexus**

- `inspectionResult`
- `reasonCategory`
- `issueRootCause`
- `restockable`
- refund amounts per product line

SKU-OS MUST NOT:

- invent new return quality categories  
- override or reinterpret return reasons  
- infer refund or financial outcomes  

ReturnNexus is the **single source of truth** for return quality semantics.

---

### From **ProblemCenter**

- issue taxonomy
- issue severity
- issue root cause
- timestamps & evidence metadata

SKU-OS MUST NOT:

- classify issues  
- downgrade or re-map PC event severity  
- invent product quality events  

ProblemCenter is the canonical source of warehouse/operational issues.

---

### From **WMS-Lite**

(OPTIONAL v1 input)

SKU-OS MAY consume read-only inspection or handling metadata, but:

- MUST NOT define its own quality classification  
- MUST NOT override ReturnNexus mappings  
- MUST NOT mutate WMS state or inventory  

---

## 8.2 Core Responsibilities — What SKU-OS MUST Compute

SKU-OS MUST compute and persist:

1. **ProductHealthSnapshot**
2. **ProductAttentionRanking**
3. Derived product-level metrics:
   - `healthScore` (0–100)
   - `returnsRisk` (0–1)
   - `defectRate` (0–1)
   - `confidence` (low/medium/high)
   - lifecycle tagging (hero/drifter/zombie/newborn)
   - demandVelocity30d (via OrderNexus feed)

4. **Degradation Application (Locked Tables)**  
   SKU-OS MUST apply degradation logic using ONLY:
   - `computeDegradationFromReturn`
   - `computeDegradationFromIssue`

Both must follow the **locked bucket and delta tables** (Section 3).  
SKU-OS may scale by quantity (linear only) but may NOT redefine deltas or semantics.

---

## 8.3 Output Responsibilities — What SKU-OS MUST Emit

### 8.3.1 ProductHealthAnalyticsEvent → InsightCore (MANDATORY)

SKU-OS MUST emit one analytics record per recalculation:

```

ProductHealthAnalyticsEvent {
shopId
productId
healthScore
stockoutRisk?   // v1 optional, but must exist if computed
marginHealth
confidence
recalculatedAt
}

```

This MUST fire:

- On event-driven recalcs (demand, return, quality)  
- During daily catch-up batch  
- Whenever degradation applied shifts healthScore meaningfully  

InsightCore depends on these events for CNS scoring.

---

### 8.3.2 Product Attention API (MANDATORY)

SKU-OS MUST expose a deterministic API returning:

```

[
{
productId,
attentionScore,
primaryReason,
urgency,
expectedImpact
}
]

```

plus:

```

meta: {
total_at_risk,
recalculated_at,
confidence_summary
}

```

Rules:

- Empty list MUST be treated as “all clear.”
- Unknown/null values MUST follow the Null Handling Contract (Section 1.1).

---

## 8.4 Free-Tier Behavior (FTEP v1.1 Compliance)

SKU-OS participates in Free Tier.

SKU-OS MUST expose the following **readiness + entitlement signals**:

```

sku-os.freeTierState       // visible | free_tier_active | free_tier_exhausted | locked
sku-os.freeTierRemaining   // number | null

```

Rules:

- Free Tier metric = **skus**
- maxUnits = **5**
- resetPeriod = **monthly**

Free Tier affects:

- how many SKUs get full health scoring
- which widgets are enabled in SKU-OS views
- whether SKU-OS surfaces detailed degradation reasoning

SKU-OS MUST NOT disable ingestion or CNS analytics when free tier is exhausted;  
instead, it degrades UI surfaces and hides advanced views.

---

## 8.5 SLA Guarantees (MUST)

SKU-OS MUST:

- Process return & issue events within **<2 minutes**
- Recompute health for updated SKUs immediately
- Run a daily global batch before **06:00 AM shop-local**
- Never allow >10% of SKUs to be stale by >6 hours
- Emit degraded analytics (with lowered confidence) when upstream signals fail

These SLAs are **observable guarantees** for CNS & InsightCore.

---

## 8.6 Degradation Safety Rules (MUST)

SKU-OS MUST:

- Clamp per-event healthScoreDelta ≥ -15 per SKU per day
- Clamp healthScore to the range 0–100
- Treat missing COGS/margin input as:

```

marginHealth = "unknown"
healthScore adjustment = 0

```

- Treat missing demand velocity as:

```

confidence = "low"

```

SKU-OS MUST NOT:

- Invent smoothing factors beyond linear quantity scaling  
- Apply compounding multipliers  
- Use ML, statistical models, or heuristics that change degradation semantics (v1)

---

## 8.7 Behavior Under Upstream Degradation (MUST)

If upstream data fails:

**Demand Feed Stale:**  

- `healthScore` remains but `confidence="low"`

**ReturnAnalyticsEvent missing:**  

- `returnsRisk` unchanged  
- event flagged for InsightCore  

**ProblemCenter issues missing:**  

- `defectRate` unchanged  
- confidence lowered  

SKU-OS MUST communicate degradation explicitly in its analytics events.

---

## 8.8 What SKU-OS MAY Do (Forward-Compatible)

These are allowed but optional behaviors, forward compatible with v2:

- Basic stockout estimation based on velocity (no forecasting)
- Simple lifecycle tagging heuristics
- Optional incorporation of WMS read-only metadata (no reclassification)
- Per-SKU confidence boosting if multiple event types align

These MAY evolve without version bump as long as:

- degradation mappings remain unchanged  
- external contracts remain compatible  
- outputs remain deterministic for identical inputs  

---

## 8.9 Explicitly Forbidden (Requires v2)

SKU-OS v1 MUST NOT:

- Perform demand forecasting  
- Make reorder recommendations  
- Change refund or return-related data  
- Write inventory or warehouse state  
- Infer new return categories  
- Generate pricing or profitability insights  
- Trigger customer-specific or SKU-specific interventions  
- Execute workflows  
- Query or mutate WMS stock levels  
- Bundle SKUs into new analytical groupings without InsightCore  

Any of these will require **SKU-OS v2** and a formal migration plan.

---

## 8.10 Summary (Compliance Checklist)

A SKU-OS implementation is v1-compliant **only if all the following are true:**

- [ ] Uses canonical degradation maps without modification  
- [ ] Consumes OrderNexus, ReturnNexus, ProblemCenter inputs without recomputing  
- [ ] Emits ProductHealthAnalyticsEvent on every recalculation  
- [ ] Updates ProductAttention API with contract-mandated shape  
- [ ] Participates in free tier with correct signals & remaining units  
- [ ] Meets latency & freshness SLAs  
- [ ] Degrades gracefully on upstream failure  
- [ ] Never modifies inventory, orders, returns, issues, or profitability records  
- [ ] Does not introduce new return/issue categories  
- [ ] HealthScore always within 0–100 and deterministic for same inputs  

**If any box cannot be checked → the implementation is NOT SKU-OS v1.**

```

---

## 9. Onboarding & Readiness — SKU-OS (Locked v1)

SKU-OS is a CNS intelligence module.  
Its onboarding is intentionally lightweight: SKU-OS should become “ready”
as soon as there is enough product activity for the system to compute a meaningful
initial health score.

This aligns with the OrderNexus & InsightCore readiness definitions.

---

## 9.1 SKU-OS Readiness Rule (Locked)

A shop is considered **SKU-OS ready** when:

1. **Integration sync is completed**

```

platform.integration.syncCompleted === true

```

2. **At least one product has a measurable demand or event history**
Defined as:

```

sku-os.productHealthEvents >= 1

```
Where a “product health event” is:

- impact from ReturnAnalyticsEvent, or  
- impact from ProductQualityEvent, or  
- initial health calculation triggered by demand signals

3. **SKU-OS free-tier access is not locked**
Readiness does NOT require paid plan, but:

```

sku-os.freeTierState !== 'locked'

```

**Readiness does NOT require:**

- perfect demand data  
- full cost completeness  
- WMS integration  
- returns integration  
- quality integration  

SKU-OS intentionally provides “minimum viable insight” even with partial data.

---

## 9.2 Required Readiness Signals (Produced by SKU-OS Provider)

SKU-OS MUST emit these signals to the onboarding engine:

```

sku-os.productCount               // number
sku-os.productHealthEvents        // number
sku-os.freeTierState             // ModuleAccessState
sku-os.freeTierRemaining         // number | null

```

Optional signals that MAY be added in v1.2+:

```

sku-os.healthRecalculatedRecently // boolean
sku-os.atRiskSkuCount             // number
sku-os.highStockoutRiskCount      // number

```

---

## 9.3 Onboarding Tasks (TaskList Tracker)

**Section:**  
```

id = 'sku-os'
moduleKey = 'sku-os'
titleKey = 'onboarding.sku-os.sectionTitle'
lockedIfNotInstalled = true

```

SKU-OS has only **one required task** for readiness, and **one optional task** for value activation.

---

### 1) Required Task — Receive Your First Product Health Event

```

{
id: 'sku-os.firstProductHealthEvent',
moduleKey: 'sku-os',
labelKey: 'onboarding.sku-os.firstProductHealthEvent.title',
descriptionKey: 'onboarding.sku-os.firstProductHealthEvent.description',
required: true,
completionRule: {
signalKey: 'sku-os.productHealthEvents',
operator: '>=',
value: 1
}
}

```

**Meaning:**  
SKU-OS becomes meaningful when at least one SKU receives demand, return, or quality data.

---

### 2) Optional Task — Review Product Health

```

{
id: 'sku-os.reviewProductHealth',
moduleKey: 'sku-os',
labelKey: 'onboarding.sku-os.reviewProductHealth.title',
descriptionKey: 'onboarding.sku-os.reviewProductHealth.description',
required: false,
completionRule: {
signalKey: 'sku-os.productCount',
operator: '>=',
value: 1
},
action: {
type: 'NAVIGATE',
target: '/products/health'
}
}

```

Purpose:  
Help merchants explore SKU-OS insights once the system has enough data.

---

## 9.4 Free Tier Gating in Onboarding

SKU-OS participates in FTEP v1.1:

```

metric: 'skus'
maxUnits: 5
resetPeriod: 'monthly'

```

Onboarding UI behavior MUST follow:

### While `free_tier_active`:

- All SKU-OS tasks appear normally.
- CTA chip performs real action (navigate).

### While `free_tier_exhausted`:

- Tasks become **read-only**.
- CTA chip is replaced with:

```

"Upgrade"

```

- Navigation is disabled or directs to upgrade route.

### While `locked`:

- Entire SKU-OS section collapses to a single upsell row:

```

“SKU-OS is a paid module. Upgrade to unlock product health insights.”

```

### While `visible`:

- Module appears but is not yet activated (e.g. no synced products).

---

## 9.5 Add-Module-Later Behavior (Locked)

If SKU-OS is installed **after** FT0 onboarding:

1. A new section appears **below OrderNexus**.
2. It contains the two SKU-OS tasks described above.
3. No cross-module tasks appear (SKU-OS never blocks other modules).
4. Readiness is achieved once the first health event is emitted.

---

## 9.6 CNS Interpretation Boundary (Important)

SKU-OS MUST NOT:

- Change its scoring based on merchant mode  
- Render survival/growth/architect variants  
- Change urgency or tone  

CNS Core + InsightCore interpret SKU-OS outputs (healthScore, returnsRisk, defectRate) according to `CnsContextSnapshot`.

SKU-OS MUST remain a **pure computing module**.

---

## 9.7 Final v1 Readiness Checklist

A shop is SKU-OS Ready when:

- [ ] `platform.integration.syncCompleted === true`
- [ ] `sku-os.productHealthEvents >= 1`
- [ ] `sku-os.freeTierState !== 'locked'`
- [ ] SKU-OS provider emits all required signals  
- [ ] SKU-OS produces valid ProductHealthAnalyticsEvent  

Only then does `ModuleReadinessSnapshot.isReady = true`.

```

---
