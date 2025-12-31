# `12-forecasting-sla-integration.md`

## Demand Forecasting & Replenishment (Phase 2 – Interface-Only, Locked Semantics)

### Overview
Forecasting is **NOT implemented in SKU-OS v1**. This section exists to lock:
- The **interfaces**
- The **data contracts**
- The **semantic guarantees**

...so that future forecasting engines can be integrated **without breaking SKU-OS v1 consumers** (InsightCore, Inventory widgets, WMS-Lite, CNS Context Engine).

---

### 6.1 Purpose & Constraints

#### Purpose
Provide SKU-OS with a stable **forecasting contract** so that advanced planning (Phase 2+) can be added without API churn.

#### Constraints for v1
1. **SKU-OS v1 MUST NOT:**
   - Generate forecasts
   - Create reorder recommendations
   - Compute elasticity
   - Override inventory ledger values
   - Run statistical or ML engines

2. **SKU-OS v1 MUST expose interfaces only** — no implementations

3. **All forecasting values must be:**
   - Optional
   - Nullable
   - Ignored by SKU-OS v1 consumers

This ensures SKU-OS remains predictable and light while future CNS forecasting evolves independently.

---

### 6.2 Forecasting Input Envelope (Stable v1 Contract)

#### Interface Definition
All forecasting engines must consume the same canonical envelope:

```typescript
export interface ForecastingInput {
  // Core identifiers
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
```

#### Locked Rules
1. **No Signal Modification:** SKU-OS MUST NOT modify or reinterpret demand signals
2. **No Inventory Inference:** SKU-OS MUST NOT infer multi-location stock or reorder logic
3. **Additive Nature:** All forecasting inputs MUST remain additive — no breaking changes

#### Example Usage
```typescript
// v1 usage: pass-through only
function prepareForecastingInput(
  snapshot: ProductHealthSnapshot,
  demand: DemandSignals
): ForecastingInput {
  return {
    shopId: snapshot.shopId,
    productId: snapshot.productId,
    unitSales7d: demand.unit_sales_7d,
    unitSales30d: demand.unit_sales_30d,
    orderCount7d: demand.order_count_7d,
    orderCount30d: demand.order_count_30d,
    lastOrderAt: demand.last_order_at,
    stockAvailable: null, // v1: always null
    supplierLeadTimeDays: null, // v1: always null
    currentHealthScore: snapshot.healthScore,
    confidence: snapshot.confidence,
    generatedAt: new Date().toISOString()
  };
}
```

---

### 6.3 Forecasting Output Envelope (Locked v1 Contract)

#### Interface Definition
Forecasting engines (Phase 2+) MUST output:

```typescript
export interface EnhancedDemandForecast {
  // Core forecasts
  baseDemand: number | null;          // nullable for v1
  enhancedForecast: number | null;    // v1: always null
  confidence: 'low' | 'medium' | 'high';
  
  // Risk metrics
  stockoutProbability: number | null; // 0–1 or null (v1)
  
  // Recommendations
  reorderRecommendation: ReorderRecommendation | null;
}
```

#### Locked Semantics
1. **All fields MUST allow `null` in v1**
2. **SKU-OS v1 MUST set ALL fields to `null`, except `confidence`**
3. **CNS and widgets MUST treat null as "no forecast available"**

#### v1 Implementation
```typescript
// v1 no-op implementation
const NO_FORECAST: EnhancedDemandForecast = {
  baseDemand: null,
  enhancedForecast: null,
  stockoutProbability: null,
  reorderRecommendation: null,
  confidence: 'low' // Use snapshot confidence
};
```

---

### 6.4 ReorderRecommendation Contract (Stable for Future Versions)

#### Interface Definition
Future forecasting engines may return:

```typescript
export interface ReorderRecommendation {
  productId: number;
  recommendedQuantity: number;
  urgency: 'critical' | 'high' | 'medium';
  reason: string;

  // Supply chain context
  supplierLeadTimeDays: number | null;   // from WMS or merchant config
  expectedStockoutDate: string | null;   // ISO
  
  // Financial context
  estimatedCost: number | null;          // currency not enforced
  expectedROI: number | null;            // simple ratio or null
  
  // Reliability indicator
  confidence: 'low' | 'medium' | 'high';
}
```

#### Locked Rules
1. **SKU-OS v1 MUST NEVER compute or emit a `ReorderRecommendation`**
2. **Widgets MUST hide reorder UI until forecasting is enabled**
3. **No field names may change without a v2 contract**
4. **All future engines MUST adhere to the shape above**

#### Example Future Usage
```typescript
// Example Phase 2+ implementation
const reorderRecommendation: ReorderRecommendation = {
  productId: 12345,
  recommendedQuantity: 100,
  urgency: 'high',
  reason: 'Stockout expected in 7 days',
  supplierLeadTimeDays: 14,
  expectedStockoutDate: '2024-02-15T00:00:00Z',
  estimatedCost: 500.00,
  expectedROI: 2.5,
  confidence: 'medium'
};
```

---

### 6.5 Forecasting Engine Integration Boundary (Locked)

#### Abstract Interface
SKU-OS MUST integrate forecasting **only via an injected engine**, never internally:

```typescript
export interface ForecastingEngine {
  /**
   * Generate demand forecast for a product
   * @param input Canonical forecasting input
   * @returns Enhanced demand forecast (null fields in v1)
   */
  forecast(input: ForecastingInput): Promise<EnhancedDemandForecast>;
}
```

#### Locked Constraints
1. **SKU-OS MUST run forecasting AFTER healthScore calculation**
2. **SKU-OS MUST NOT persist forecasting outputs inside its own tables**
3. **SKU-OS MUST treat forecasting outputs as ephemeral metadata**
4. **InsightCore alone decides how (and if) forecast data is stored or visualized**

#### Integration Pattern
```typescript
class SKUOSHealthEngine {
  private forecastingEngine: ForecastingEngine;
  
  async calculateHealth(
    snapshot: ProductHealthSnapshot,
    demand: DemandSignals
  ): Promise<ProductHealthSnapshot> {
    // 1. Calculate core health (v1 responsibility)
    const healthSnapshot = this.computeHealth(snapshot, demand);
    
    // 2. Optionally call forecasting (v1: no-op)
    const forecastInput = this.prepareForecastInput(healthSnapshot, demand);
    const forecast = await this.forecastingEngine.forecast(forecastInput);
    
    // 3. Attach forecast as metadata (not persisted)
    return {
      ...healthSnapshot,
      _metadata: {
        forecast, // Ephemeral, not part of core health
        forecastGeneratedAt: new Date().toISOString()
      }
    };
  }
}
```

---

### 6.6 v1 Implementation Requirements (Explicit)

#### Required v1 Behavior
In SKU-OS v1:

```typescript
class NoOpForecastingEngine implements ForecastingEngine {
  async forecast(input: ForecastingInput): Promise<EnhancedDemandForecast> {
    // v1: Always return null forecasts
    return {
      baseDemand: null,
      enhancedForecast: null,
      stockoutProbability: null,
      reorderRecommendation: null,
      confidence: input.confidence // Pass through from input
    };
  }
}
```

#### Implementation Guarantees
This ensures:
1. **No accidental forecasting leakage**
2. **No premature surface area**
3. **No cross-module contradiction**
4. **Clean upgrade path to v2**

---

### 6.7 CNS Context Interaction (Locked)

#### Contextual Adaptation Rules
Forecasting MUST be interpreted in CNS through InsightCore once enabled.

**SKU-OS MUST NOT:**
1. **Vary forecasting by CNS "mode"** (Survival/Growth/Architect)
2. **Apply urgency coloring** based on forecasts
3. **Apply business framing** to forecast data
4. **Surface CTAs** based on forecasts

#### Responsibility Division
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│    SKU-OS       │    │   InsightCore   │    │      CNS        │
│                 │    │                 │    │                 │
│ • Raw Forecast  │───▶│ • Store Forecast│───▶│ • Mode Context  │
│ • Basic Metrics │    │ • Add Context   │    │ • Urgency       │
│                 │    │ • Apply Colors  │    │ • Framing       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

### 6.8 Future v2 Upgrade Path (Informational)

#### v2 Capabilities
When SKU-OS forecasting is activated in v2:

**SKU-OS MAY:**
- Call an ML/heuristic forecasting engine
- Combine demand signals with health & returns signals
- Generate reorder recommendations based on lead time

**SKU-OS MUST NOT:**
- Rewrite ReturnNexus or ProblemCenter signals
- Generate inconsistent degraded vs forecasted signals
- Mutate inventory ledger

#### Migration Strategy
```typescript
// Version detection and routing
function getForecastingEngine(version: 'v1' | 'v2'): ForecastingEngine {
  switch (version) {
    case 'v1':
      return new NoOpForecastingEngine();
    case 'v2':
      return new MLForecastingEngine({
        modelPath: '/models/demand-forecast-v1',
        minDataPoints: 30,
        confidenceThreshold: 0.7
      });
  }
}
```

---

### 6.9 Summary of v1 Guarantees (Locked)

SKU-OS v1 provides:

| Guarantee | Implementation |
|-----------|----------------|
| **No forecasting logic** | `NoOpForecastingEngine` |
| **Stable forecasting interfaces** | Locked TypeScript interfaces |
| **Null-safe forecasting outputs** | All fields nullable |
| **CNS interpretation handled elsewhere** | InsightCore responsibility |
| **Forward compatibility** | v2-ready interfaces |

---

## Integration SLAs & Quality Gates (Locked v1)

### Overview
SKU-OS depends on **three upstream signal streams**:

1. **Demand signals** → from OrderNexus  
2. **Returns quality signals** → from ReturnNexus  
3. **Product quality & issue signals** → from ProblemCenter  

And optionally:
4. **Inventory context** → from WMS-Lite (read-only, not required)

**To guarantee consistent CNS intelligence, SKU-OS MUST meet the following SLAs and quality gates:**

---

### 7.1 Data Flow SLAs (v1 Hard Requirements)

#### 7.1.1 Demand Signals (OrderNexus → SKU-OS)

```yaml
Latency Target:       < 5 minutes
Freshness Target:     > 99% of products updated within 60 minutes
Completeness Target:  > 99.9% of normalized orders reflected in velocity signals
```

**Contract:**
- SKU-OS MUST recalculate `demandVelocity30d` **every time new demand signals arrive**
- OrderNexus is the *single source of truth* for:
  - `unit_sales_7d`, `unit_sales_30d`
  - `order_count_7d`, `order_count_30d`
  - `returns_rate_30d`
- SKU-OS MUST NOT infer demand from raw orders

#### 7.1.2 Returns Quality Stream (ReturnNexus → SKU-OS)

```yaml
Latency Target:     < 2 minutes from ReturnOutcomeEvent → SKU-OS health update
Freshness Target:   Daily recalc of all SKU health by 06:00 shop-local time
Completeness:       100% ingestion of ReturnAnalyticsEvent
```

**Rules:**
- SKU-OS MUST apply degradation using the **canonical mapping** (Section 3)
- No local reclassification is allowed
- Any ReturnAnalyticsEvent failure MUST surface to monitoring

#### 7.1.3 Product Quality Stream (ProblemCenter → SKU-OS)

```yaml
Latency Target:     < 2 minutes
Completeness:       100% of ProductQualityEvent must be processed
Freshness Window:   SKU-OS MUST recalc within 30 minutes if backlog is detected
```

**Quality signals are essential for the `defectRate` and `healthScore` pipeline.**

SKU-OS MUST:
- Apply canonical degradation tables (Section 3.4)
- Treat missing or stale issue streams as a CRITICAL health risk

---

### 7.2 Health Score Recalculations (Locked v1 Expectations)

#### 7.2.1 Event-Driven Recalc (Real Time)
**Triggered by:**
- Demand updates
- ReturnAnalyticsEvent
- ProductQualityEvent

```yaml
Latency Target: < 2 minutes from event → updated ProductHealthSnapshot
```

**Contract:**
- SKU-OS MUST update:
  - `healthScore`
  - `stockoutRisk` (if available in v2)
  - `returnsRisk`
  - `defectRate`
  - `confidence`
- SKU-OS MUST emit a new ProductHealthAnalyticsEvent to InsightCore

#### 7.2.2 Daily Batch Recalc (Catch-All Sweep)

```yaml
Time Window: Must complete before 06:00 AM shop-local
Purpose: Re-sync long-tail SKUs with sparse data
```

**SKU-OS MUST:**
- Verify demand signal freshness
- Recompute stale SKUs
- Emit ProductHealthAnalyticsEvent for stale/updated items

**This daily batch ensures the CNS always has a complete picture.**

---

### 7.3 Monitoring (What "Healthy SKU-OS" Means)

#### 7.3.1 Demand Pipeline Monitoring

```yaml
Alert if:
  • orders_to_products_latency > 10 minutes
  • > 5% of active products missing updated demand signals
```

These signals must surface through the OpsIntel monitoring system (CNS layer).

#### 7.3.2 Returns & Quality Monitoring

```yaml
Alert if:
  • ReturnAnalyticsEvent stream is silent > 24h for shops with active returns
  • ProductQualityEvent stream is silent > 24h on shops with WMS/PC usage
  • > 1% of degradation mappings fail or default unexpectedly
```

SKU-OS MUST NOT continue silently if quality data is missing — CNS needs explicit fail signals.

#### 7.3.3 Health Score Stability Monitoring

```yaml
Alert if:
  • > 15% of SKUs change > 25 points in healthScore in a 1-hour window
  • median confidence falls below "medium" for > 6 hours
  • > 10% of SKUs have null or stale healthScore for > 6 hours
```

These alerts prevent runaway compounding logic or broken upstream feeds.

---

### 7.4 Business Impact Metrics (Strategic, Not Blocking)

These metrics do not break the contract but inform CNS dashboards:

```yaml
stockout_prevention_rate:         % of predicted stockouts actually prevented
inventory_turnover_improvement:   Reduction in days-of-supply vs baseline
return_related_degradation:       % of SKUs at-risk due to returnsRisk/defectRate
defect_trend_improvement:         Trend in quality-driven issues month-over-month
```

InsightCore will consume these for full CNS reporting.

---

### 7.5 SLA Degradation Behavior (Locked v1)

#### If Demand Pipeline Fails
- SKU-OS MUST freeze `demandVelocity30d` and set:
  ```typescript
  confidence = 'low'
  stockoutRisk = null // for v1
  ```
- Emit degraded ProductHealthAnalyticsEvent

#### If ReturnAnalyticsEvent Pipeline Fails
- SKU-OS MUST set:
  ```typescript
  returnsRisk = snapshot.returnsRisk   // no increment
  confidence = 'low'
  ```
- Emit degraded event with explicit flag

#### If ProductQualityEvent Pipeline Fails
- SKU-OS MUST NOT assume "no issues"
- SKU-OS MUST apply:
  ```typescript
  defectRate = snapshot.defectRate // no increments
  confidence = 'low'
  ```
- Emit degraded event

**CNS consumers MUST treat low-confidence events as warning states.**

---

### 7.6 Summary (Locked v1 Commitments)

#### SKU-OS v1 MUST:
1. **Process all upstream signals** with <2 min latency
2. **Produce consistently updated** ProductHealthAnalyticsEvent records
3. **Provide complete coverage** of active SKUs via daily batch
4. **Degrade gracefully** when upstream modules fail
5. **Surface operational health** to CNS monitoring

#### SKU-OS v1 MUST NEVER:
1. **Infer data owned by OrderNexus, ReturnNexus, or ProblemCenter**
2. **Modify inventory or returns states**
3. **Generate forecasting or reorder outputs** (v1)

---

### 7.7 Compliance Verification

#### SLA Monitoring Implementation
```typescript
interface SLAMonitor {
  // Track latency for each stream
  demandLatency: Map<number, Date>; // shopId → last update
  returnsLatency: Map<number, Date>;
  issuesLatency: Map<number, Date>;
  
  // Check SLA compliance
  checkDemandSLA(shopId: number): boolean {
    const lastUpdate = this.demandLatency.get(shopId);
    if (!lastUpdate) return false;
    
    const minutesSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60);
    return minutesSinceUpdate < 10; // 10-minute threshold
  }
  
  // Generate alerts
  generateAlerts(): SLAAlert[] {
    const alerts: SLAAlert[] = [];
    
    // Check each shop
    for (const [shopId, lastDemandUpdate] of this.demandLatency) {
      if (!this.checkDemandSLA(shopId)) {
        alerts.push({
          type: 'DEMAND_SLA_VIOLATION',
          shopId,
          severity: 'critical',
          message: `Demand pipeline exceeded 10-minute SLA`
        });
      }
    }
    
    return alerts;
  }
}
```

#### Quality Gate Implementation
```typescript
class QualityGate {
  private metrics: QualityMetrics;
  
  evaluateHealthScoreStability(snapshots: ProductHealthSnapshot[]): boolean {
    // Check for excessive volatility
    const changes = snapshots.map(s => s.healthScore);
    const volatility = calculateVolatility(changes);
    
    // Alert if > 15% of SKUs change > 25 points in 1 hour
    const significantChanges = changes.filter(change => Math.abs(change) > 25);
    const percentSignificant = (significantChanges.length / changes.length) * 100;
    
    return percentSignificant <= 15 && volatility < 0.5;
  }
  
  evaluateConfidenceLevels(snapshots: ProductHealthSnapshot[]): boolean {
    const lowConfidence = snapshots.filter(s => s.confidence === 'low');
    const percentLow = (lowConfidence.length / snapshots.length) * 100;
    
    // Alert if median confidence is low for > 6 hours
    return percentLow <= 50;
  }
}
```

#### Implementation Checklist
- [ ] Demand latency monitoring implemented
- [ ] Returns completeness tracking
- [ ] Issue stream freshness validation
- [ ] Health score stability checks
- [ ] Confidence level monitoring
- [ ] Alert generation and routing
- [ ] Graceful degradation mechanisms
- [ ] SLA violation logging and reporting

---