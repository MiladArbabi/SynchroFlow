# `13-developer-onboarding-compliance.md`

## Developer Contract — Locked v1 (SKU-OS)

> SKU-OS is the CNS subsystem responsible for **product health, degradation modeling, and product-level attention ranking**.
> 
> It MUST operate deterministically, must never recompute upstream truths, and must emit stable, InsightCore-ready analytics reflecting true product condition.

### Overview
This contract defines what SKU-OS MUST do, MUST NOT do, and MAY do in v1. Any deviation requires **SKU-OS v2** with a formal migration plan.

---

### 8.1 Upstream Responsibilities — What SKU-OS MUST NOT Recompute

SKU-OS **MUST treat the following inputs as canonical and read-only**:

#### From **OrderNexus**
- Demand velocity (`unit_sales_7d`, `unit_sales_30d`)
- Order frequency (`order_count_7d`, `order_count_30d`)
- `returns_rate_30d`
- Average selling price
- Last order timestamp

**SKU-OS MUST NOT:**
- Parse raw orders
- Derive its own returns rate
- Infer profitability or margin

All of the above are exclusively OrderNexus responsibilities.

#### From **ReturnNexus**
- `inspectionResult`
- `reasonCategory`
- `issueRootCause`
- `restockable`
- Refund amounts per product line

**SKU-OS MUST NOT:**
- Invent new return quality categories
- Override or reinterpret return reasons
- Infer refund or financial outcomes

ReturnNexus is the **single source of truth** for return quality semantics.

#### From **ProblemCenter**
- Issue taxonomy
- Issue severity
- Issue root cause
- Timestamps & evidence metadata

**SKU-OS MUST NOT:**
- Classify issues
- Downgrade or re-map PC event severity
- Invent product quality events

ProblemCenter is the canonical source of warehouse/operational issues.

#### From **WMS-Lite** (OPTIONAL v1 input)
SKU-OS MAY consume read-only inspection or handling metadata, but:
- MUST NOT define its own quality classification
- MUST NOT override ReturnNexus mappings
- MUST NOT mutate WMS state or inventory

---

### 8.2 Core Responsibilities — What SKU-OS MUST Compute

SKU-OS MUST compute and persist:

1. **ProductHealthSnapshot**
2. **ProductAttentionRanking**
3. Derived product-level metrics:
   - `healthScore` (0–100)
   - `returnsRisk` (0–1)
   - `defectRate` (0–1)
   - `confidence` (low/medium/high)
   - Lifecycle tagging (hero/drifter/zombie/newborn)
   - `demandVelocity30d` (via OrderNexus feed)

4. **Degradation Application (Locked Tables)**  
   SKU-OS MUST apply degradation logic using ONLY:
   - `computeDegradationFromReturn`
   - `computeDegradationFromIssue`

Both must follow the **locked bucket and delta tables** (Section 3).  
SKU-OS may scale by quantity (linear only) but may NOT redefine deltas or semantics.

---

### 8.3 Output Responsibilities — What SKU-OS MUST Emit

#### 8.3.1 ProductHealthAnalyticsEvent → InsightCore (MANDATORY)
SKU-OS MUST emit one analytics record per recalculation:

```typescript
ProductHealthAnalyticsEvent {
  shopId: number;
  productId: number;
  healthScore: number;
  stockoutRisk?: number;   // v1 optional, but must exist if computed
  marginHealth: 'healthy' | 'at_risk' | 'critical' | 'unknown';
  confidence: 'low' | 'medium' | 'high';
  recalculatedAt: string;
}
```

**This MUST fire:**
- On event-driven recalcs (demand, return, quality)
- During daily catch-up batch
- Whenever degradation applied shifts healthScore meaningfully

InsightCore depends on these events for CNS scoring.

#### 8.3.2 Product Attention API (MANDATORY)
SKU-OS MUST expose a deterministic API returning:

```typescript
{
  data: [{
    productId: number;
    attentionScore: number;
    primaryReason: string;
    urgency: 'critical' | 'high' | 'medium' | 'low';
    expectedImpact: string;
  }],
  meta: {
    total_at_risk: number;
    recalculated_at: string | null;
    confidence_summary: {
      high: number;
      medium: number;
      low: number;
    }
  }
}
```

**Rules:**
- Empty list MUST be treated as "all clear"
- Unknown/null values MUST follow the Null Handling Contract (Section 1.1)

---

### 8.4 Free-Tier Behavior (FTEP v1.1 Compliance)

SKU-OS participates in Free Tier and MUST expose:

```typescript
sku-os.freeTierState       // 'visible' | 'free_tier_active' | 'free_tier_exhausted' | 'locked'
sku-os.freeTierRemaining   // number | null
```

**Rules:**
- Free Tier metric = **skus**
- maxUnits = **5**
- resetPeriod = **monthly**

**Free Tier affects:**
- How many SKUs get full health scoring
- Which widgets are enabled in SKU-OS views
- Whether SKU-OS surfaces detailed degradation reasoning

SKU-OS MUST NOT disable ingestion or CNS analytics when free tier is exhausted; instead, it degrades UI surfaces and hides advanced views.

---

### 8.5 SLA Guarantees (MUST)

SKU-OS MUST:
1. **Process return & issue events** within **<2 minutes**
2. **Recompute health for updated SKUs** immediately
3. **Run a daily global batch** before **06:00 AM shop-local**
4. **Never allow >10% of SKUs** to be stale by >6 hours
5. **Emit degraded analytics** (with lowered confidence) when upstream signals fail

These SLAs are **observable guarantees** for CNS & InsightCore.

---

### 8.6 Degradation Safety Rules (MUST)

SKU-OS MUST:
1. **Clamp per-event healthScoreDelta** ≥ -15 per SKU per day
2. **Clamp healthScore** to the range 0–100
3. **Treat missing COGS/margin input** as:
   ```typescript
   marginHealth = "unknown"
   healthScore adjustment = 0
   ```
4. **Treat missing demand velocity** as:
   ```typescript
   confidence = "low"
   ```

**SKU-OS MUST NOT:**
- Invent smoothing factors beyond linear quantity scaling
- Apply compounding multipliers
- Use ML, statistical models, or heuristics that change degradation semantics (v1)

---

### 8.7 Behavior Under Upstream Degradation (MUST)

#### If upstream data fails:

**Demand Feed Stale:**
- `healthScore` remains but `confidence="low"`

**ReturnAnalyticsEvent missing:**
- `returnsRisk` unchanged
- Event flagged for InsightCore

**ProblemCenter issues missing:**
- `defectRate` unchanged
- Confidence lowered

SKU-OS MUST communicate degradation explicitly in its analytics events.

---

### 8.8 What SKU-OS MAY Do (Forward-Compatible)

These are allowed but optional behaviors, forward compatible with v2:
- Basic stockout estimation based on velocity (no forecasting)
- Simple lifecycle tagging heuristics
- Optional incorporation of WMS read-only metadata (no reclassification)
- Per-SKU confidence boosting if multiple event types align

These MAY evolve without version bump as long as:
- Degradation mappings remain unchanged
- External contracts remain compatible
- Outputs remain deterministic for identical inputs

---

### 8.9 Explicitly Forbidden (Requires v2)

SKU-OS v1 MUST NOT:
1. **Perform demand forecasting**
2. **Make reorder recommendations**
3. **Change refund or return-related data**
4. **Write inventory or warehouse state**
5. **Infer new return categories**
6. **Generate pricing or profitability insights**
7. **Trigger customer-specific or SKU-specific interventions**
8. **Execute workflows**
9. **Query or mutate WMS stock levels**
10. **Bundle SKUs into new analytical groupings without InsightCore**

Any of these will require **SKU-OS v2** and a formal migration plan.

---

### 8.10 Summary (Compliance Checklist)

A SKU-OS implementation is v1-compliant **only if all the following are true:**

- [ ] **Uses canonical degradation maps** without modification
- [ ] **Consumes OrderNexus, ReturnNexus, ProblemCenter inputs** without recomputing
- [ ] **Emits ProductHealthAnalyticsEvent** on every recalculation
- [ ] **Updates ProductAttention API** with contract-mandated shape
- [ ] **Participates in free tier** with correct signals & remaining units
- [ ] **Meets latency & freshness SLAs**
- [ ] **Degrades gracefully** on upstream failure
- [ ] **Never modifies inventory, orders, returns, issues, or profitability records**
- [ ] **Does not introduce new return/issue categories**
- [ ] **HealthScore always within 0–100** and deterministic for same inputs

**If any box cannot be checked → the implementation is NOT SKU-OS v1.**

---

## Onboarding & Readiness — SKU-OS (Locked v1)

### Overview
SKU-OS is a CNS intelligence module. Its onboarding is intentionally lightweight: SKU-OS should become "ready" as soon as there is enough product activity for the system to compute a meaningful initial health score.

This aligns with the OrderNexus & InsightCore readiness definitions.

---

### 9.1 SKU-OS Readiness Rule (Locked)

A shop is considered **SKU-OS ready** when:

1. **Integration sync is completed**
   ```typescript
   platform.integration.syncCompleted === true
   ```

2. **At least one product has a measurable demand or event history**
   Defined as:
   ```typescript
   skuOs.productHealthEvents >= 1
   ```
   Where a "product health event" is:
   - Impact from ReturnAnalyticsEvent, or
   - Impact from ProductQualityEvent, or
   - Initial health calculation triggered by demand signals

3. **SKU-OS free-tier access is not locked**
   Readiness does NOT require paid plan, but:
   ```typescript
   sku-os.freeTierState !== 'locked'
   ```

**Readiness does NOT require:**
- Perfect demand data
- Full cost completeness
- WMS integration
- Returns integration
- Quality integration

SKU-OS intentionally provides "minimum viable insight" even with partial data.

---

### 9.2 Required Readiness Signals (Produced by SKU-OS Provider)

SKU-OS MUST emit these signals to the onboarding engine:

```typescript
skuOs.productCount               // number of canonical products
skuOs.productHealthEvents        // number of health events (≥1 for readiness)
sku-os.freeTierState             // ModuleAccessState
sku-os.freeTierRemaining         // number | null
```

**Optional signals that MAY be added in v1.2+:**
```typescript
skuOs.healthRecalculatedRecently // boolean
skuOs.atRiskSkuCount             // number of SKUs with healthScore < 50
skuOs.highStockoutRiskCount      // number of SKUs with stockoutRisk > 0.7
```

---

### 9.3 Onboarding Tasks (TaskList Tracker)

**Section Configuration:**
```yaml
id: 'skuOs'
moduleKey: 'skuOs'
titleKey: 'onboarding.skuOs.sectionTitle'
lockedIfNotInstalled: true
```

SKU-OS has only **one required task** for readiness, and **one optional task** for value activation.

#### 1) Required Task — Receive Your First Product Health Event
```typescript
{
  id: 'skuOs.firstProductHealthEvent',
  moduleKey: 'skuOs',
  labelKey: 'onboarding.skuOs.firstProductHealthEvent.title',
  descriptionKey: 'onboarding.skuOs.firstProductHealthEvent.description',
  required: true,
  completionRule: {
    signalKey: 'skuOs.productHealthEvents',
    operator: '>=',
    value: 1
  }
}
```

**Meaning:** SKU-OS becomes meaningful when at least one SKU receives demand, return, or quality data.

#### 2) Optional Task — Review Product Health
```typescript
{
  id: 'skuOs.reviewProductHealth',
  moduleKey: 'skuOs',
  labelKey: 'onboarding.skuOs.reviewProductHealth.title',
  descriptionKey: 'onboarding.skuOs.reviewProductHealth.description',
  required: false,
  completionRule: {
    signalKey: 'skuOs.productCount',
    operator: '>=',
    value: 1
  },
  action: {
    type: 'NAVIGATE',
    target: '/products/health'
  }
}
```

**Purpose:** Help merchants explore SKU-OS insights once the system has enough data.

---

### 9.4 Free Tier Gating in Onboarding

SKU-OS participates in FTEP v1.1:
```typescript
metric: 'skus'
maxUnits: 5
resetPeriod: 'monthly'
```

#### Onboarding UI Behavior

**While `free_tier_active`:**
- All SKU-OS tasks appear normally
- CTA chip performs real action (navigate)

**While `free_tier_exhausted`:**
- Tasks become **read-only**
- CTA chip is replaced with `"Upgrade"`
- Navigation is disabled or directs to upgrade route

**While `locked`:**
- Entire SKU-OS section collapses to a single upsell row:
  ```
  "SKU-OS is a paid module. Upgrade to unlock product health insights."
  ```

**While `visible`:**
- Module appears but is not yet activated (e.g., no synced products)

---

### 9.5 Add-Module-Later Behavior (Locked)

If SKU-OS is installed **after** FT0 onboarding:

1. A new section appears **below OrderNexus**
2. It contains the two SKU-OS tasks described above
3. No cross-module tasks appear (SKU-OS never blocks other modules)
4. Readiness is achieved once the first health event is emitted

---

### 9.6 CNS Interpretation Boundary (Important)

SKU-OS MUST NOT:
- Change its scoring based on merchant mode
- Render survival/growth/architect variants
- Change urgency or tone

CNS Core + InsightCore interpret SKU-OS outputs (`healthScore`, `returnsRisk`, `defectRate`) according to `CnsContextSnapshot`.

SKU-OS MUST remain a **pure computing module**.

---

### 9.7 Final v1 Readiness Checklist

A shop is SKU-OS Ready when:

- [ ] `platform.integration.syncCompleted === true`
- [ ] `skuOs.productHealthEvents >= 1`
- [ ] `sku-os.freeTierState !== 'locked'`
- [ ] SKU-OS provider emits all required signals
- [ ] SKU-OS produces valid ProductHealthAnalyticsEvent

Only then does `ModuleReadinessSnapshot.isReady = true`.

---