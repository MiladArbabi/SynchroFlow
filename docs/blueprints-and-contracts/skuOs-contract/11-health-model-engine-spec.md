# `11-health-model-engine-spec.md`

## Internal Product Health Model (Locked v1.1)

### Overview
The `ProductHealthSnapshot` is the internal state from which SKU-OS computes trends, degradation, attention rankings, and analytics events.

**Important:** Only `ProductHealthAnalyticsEvent` (the external event emitted to InsightCore) is public. SKU-OS may evolve internal fields ONLY if meaning remains aligned with this contract.

---

### 4.1 Canonical ProductHealthSnapshot Shape

#### Interface Definition (Locked Meaning, Evolvable Internally)
```typescript
export interface ProductHealthSnapshot {
  // Core identifiers
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

  // Demand fundamentals (from OrderNexus)
  demandVelocity30d: number;  // pulled from product_demand_signals.unit_sales_30d
  demandVelocity7d?: number;  // optional internal field
  lastOrderAt?: string;       // optional for recency weighting

  // Timestamps
  updatedAt: string;          // ISO timestamp when snapshot was last recalculated
}
```

#### Locked Semantics

| Field | Constraints | Source |
|-------|-------------|--------|
| `healthScore` | MUST always be 0–100 range | Computed internally |
| `stockoutRisk` | MUST always be 0–1 range | Computed internally |
| `marginHealth` | MUST be 'unknown' when costs missing | OrderNexus (via cost data) |
| `returnsRisk` | MUST be 0–1 range | ReturnNexus events + demand signals |
| `defectRate` | MUST be 0–1 range | ProblemCenter events |
| `confidence` | MUST reflect signal availability | Internal assessment |
| `demandVelocity30d` | MUST derive from OrderNexus only | `product_demand_signals` |
| `updatedAt` | MUST be ISO timestamp | Internal tracking |

#### Allowed Internal Evolution
SKU-OS MAY:
1. **Add additional internal scoring components**
2. **Refine weighting logic** (while maintaining semantic meaning)
3. **Extend snapshot with internal-only fields** (namespaced or not)
4. **Add caching metadata and performance hints**

**Constraint:** Allowed evolution MUST NOT change emitted analytics events.

---

### 4.2 Required Relationships (Locked)

#### 1. HealthScore Monotonicity with Degradation
```typescript
// Applying return or issue events MUST reduce healthScore (never increase it)
function applyDegradation(snapshot: ProductHealthSnapshot, effect: DegradationEffect): ProductHealthSnapshot {
  const newScore = snapshot.healthScore + effect.healthScoreDelta; // effect.healthScoreDelta ≤ 0
  return {
    ...snapshot,
    healthScore: Math.max(0, newScore) // Clamp at 0
  };
}
```

#### 2. StockoutRisk Dependencies
StockoutRisk MUST depend on:
- `demandVelocity30d` (primary)
- `lastOrderAt` (recency)
- (optional) inventory levels (via WMS Lite)

**Constraint:** MUST NOT recompute demand velocity; must consume from `product_demand_signals`.

#### 3. MarginHealth Rules
MarginHealth depends ONLY on COGS presence (for v1):
- `healthy` → COGS known AND net margin (from OrderNexus) acceptable
- `at_risk` → COGS known but margin below threshold
- `critical` → COGS known and margin severely low
- `unknown` → COGS missing

**Constraint:** SKU-OS MUST NOT infer margin from price alone.

#### 4. ReturnsRisk Growth Rules
ReturnsRisk grows ONLY via `ReturnAnalyticsEvents`:
- No internal handcrafted return logic
- Incremental growth per degradation event
- Capped at 1.0 maximum

#### 5. DefectRate Growth Rules
DefectRate grows ONLY via `ProductQualityEvent`:
- No inspection of raw warehouse data
- No recomputation of issue root causes
- Incremental growth per issue event

#### 6. Confidence Degradation Rules
Confidence MUST degrade when signals are missing:

| Condition | Confidence | Example |
|-----------|------------|---------|
| No demand data | low | `demandVelocity30d = 0` |
| No return or issue data | medium | No events in 30 days |
| Full signal surface + stable events | high | All signals present for ≥14 days |

---

### 4.3 HealthScore Composition (Allowed Internal Variation)

#### Required Model Structure
SKU-OS must implement a composite scoring model:

```typescript
healthScore = clamp(
  BASE +
  returnsImpact +
  issueImpact +
  demandStabilityImpact +
  marginHealthImpact,
  0, 100
);
```

#### Locked Constraints

| Component | Source | Constraints |
|-----------|--------|-------------|
| `returnsImpact` | Canonical tables | MUST use `computeDegradationFromReturn` |
| `issueImpact` | Canonical tables | MUST use `computeDegradationFromIssue` |
| `marginHealthImpact` | OrderNexus | MUST NOT include profit calculations |
| `BASE` | Internal | May be refined, not diverged semantically |
| Weighting factors | Internal | May be adjusted, must maintain monotonicity |

#### Example Implementation (Allowed)
```typescript
interface HealthScoreComponents {
  base: number;                 // e.g., 85
  returnsImpact: number;        // negative, from canonical tables
  issueImpact: number;          // negative, from canonical tables
  demandStabilityImpact: number;// ± small adjustment
  marginHealthImpact: number;   // 0 if unknown, negative if at_risk/critical
}

function calculateHealthScore(components: HealthScoreComponents): number {
  const rawScore = 
    components.base +
    components.returnsImpact +
    components.issueImpact +
    components.demandStabilityImpact +
    components.marginHealthImpact;
  
  return Math.max(0, Math.min(100, rawScore));
}
```

---

### 4.4 When SKU-OS Pushes Analytics Events

#### Emission Trigger Rules
Every time a product snapshot updates, SKU-OS MUST emit:

```typescript
ProductHealthAnalyticsEvent {
  shopId,
  productId,
  healthScore,
  stockoutRisk,
  marginHealth,
  confidence,
  recalculatedAt
}
```

#### Field Mapping Requirements
Fields derived from `ProductHealthSnapshot` MUST map 1:1:

| Analytics Event Field | Snapshot Field | Transformation |
|----------------------|----------------|----------------|
| `healthScore` | `healthScore` | Direct mapping |
| `stockoutRisk` | `stockoutRisk` | Direct mapping |
| `marginHealth` | `marginHealth` | Direct mapping |
| `confidence` | `confidence` | Direct mapping |
| `recalculatedAt` | `updatedAt` | Direct mapping |

#### Prohibited Inclusions
SKU-OS MUST NOT include in analytics events:
1. Proprietary fields
2. Module-specific flags
3. Raw degradation details
4. Derivative metrics not part of the locked event contract
5. Internal debugging information

---

### 4.5 Version Stability Rules

#### Allowed Changes (v1.1 → v1.x)
SKU-OS MAY:
1. **Add internal fields** (non-breaking)
2. **Adjust internal weighting** (semantics preserved)
3. **Expand logic for confidence scoring** (within defined ranges)
4. **Maintain additional time windows** (internal only)
5. **Add internal caching** (transparent to consumers)

#### Prohibited Changes (Require v2)
SKU-OS MAY NOT:
1. **Change meaning** of `healthScore`, `marginHealth`, `stockoutRisk`, `returnsRisk`, `defectRate`
2. **Change degradation table values** (v1.1 locked)
3. **Introduce positive health boosts** without explicit v2 contract
4. **Modify or rename fields** in `ProductHealthAnalyticsEvent`

#### Version Change Requirements
Any prohibited change requires:
1. **New contract file:** `SKU-OS_v2.md`
2. **Migration of analytics consumers**
3. **Version bump** in InsightCore compatibility matrix
4. **Dual operation period** (v1.1 and v2.0 concurrently)

---

### 4.6 Health Snapshot Lifecycle (Locked Expectations)

#### SKU-OS MUST:
1. **Start with neutral baseline** (e.g., healthScore = 85 recommended, not mandated)
2. **Apply degradation incrementally** upon each event
3. **Recompute snapshot at least:**
   - On demand event
   - On return event
   - On issue event
   - Daily batch (before 6 AM shop local time)

#### Healing Model Constraints
SKU-OS MAY implement "slow healing" model over time, BUT:
1. **MUST NOT exceed prior healthScore baseline**
2. **MUST NOT diminish visibility** of returns or issue signals within 30 days
3. **MUST NOT counteract negative deltas** artificially
4. **Healing must be extremely conservative** (phase 2+ feature)

#### Example Healing Implementation
```typescript
interface HealingPolicy {
  // Only heal if no negative events in healing period
  healingPeriodDays: number;        // e.g., 30
  maxDailyHealing: number;          // e.g., 0.5
  requireStableDemand: boolean;     // e.g., true
  excludeRecentDegradation: boolean;// e.g., true (last 7 days)
}

function applyHealing(
  snapshot: ProductHealthSnapshot,
  policy: HealingPolicy
): ProductHealthSnapshot {
  // Implementation must respect constraints
  // Healing rate: ≤ policy.maxDailyHealing
  // Total healing: ≤ original baseline
  // No healing if recent degradation
}
```

---

## Health Engine – How SKU OS Uses Inputs (Locked v1.1)

### 5.1 Overview of Health Flow (Locked Behavior)

#### Canonical Recalculation Sequence
Every recalculation follows this exact sequence:

```typescript
function recalculateHealth(snapshot: ProductHealthSnapshot): ProductHealthSnapshot {
  // 1. Load or create baseline ProductHealthSnapshot
  let result = loadBaselineSnapshot();
  
  // 2. Apply ReturnAnalyticsEvent degradation (via canonical table)
  result = applyReturnImpact(result, returnEvents);
  
  // 3. Apply ProductQualityEvent degradation (via canonical table)
  result = applyIssueImpact(result, issueEvents);
  
  // 4. Apply demand-based adjustments
  result = applyDemandDynamics(result, demandData);
  
  // 5. Clamp final healthScore ∈ [0, 100]
  result.healthScore = clamp(result.healthScore, 0, 100);
  
  // 6. Recompute stockoutRisk
  result.stockoutRisk = computeStockoutRisk(result);
  
  // 7. Recompute confidence
  result.confidence = computeConfidence(result);
  
  // 8. Persist updated snapshot
  persistSnapshot(result);
  
  // 9. Emit ProductHealthAnalyticsEvent
  emitAnalyticsEvent(result);
  
  return result;
}
```

**Constraint:** SKU-OS MUST NOT reorder degradation steps or override canonical tables.

---

### 5.2 Return-Driven Degradation (Locked Implementation)

#### Required Function Usage
SKU-OS MUST compute return degradation ONLY using `computeDegradationFromReturn()`.

#### Implementation Pattern (Allowed Form)
```typescript
function applyReturnImpact(
  snapshot: ProductHealthSnapshot,
  returnEvents: ReturnAnalyticsEvent[]
): ProductHealthSnapshot {
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
```

#### Locked Constraints
1. **MUST use canonical table** (no local overrides)
2. **MUST scale by unit ratio** if provided
3. **MUST NOT increase healthScore** from returns
4. **MUST clamp daily degradation** to ≥ −15 per productId

---

### 5.3 Issue-Driven Degradation (Locked Implementation)

#### Required Function Usage
SKU-OS MUST compute issue-driven degradation ONLY using `computeDegradationFromIssue()`.

#### Implementation Pattern
```typescript
function applyIssueImpact(
  snapshot: ProductHealthSnapshot,
  issues: ProductQualityEvent[]
): ProductHealthSnapshot {
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

#### Locked Constraints
1. **MUST use canonical issue degradation table**
2. **MUST NOT interpret WMS raw events** (only ProblemCenter events)
3. **MUST NOT infer categories** not in shared taxonomy
4. **Degradation MUST be ≤ 0**

---

### 5.4 Demand-Based Adjustments (Allowed, Non-Canonical)

#### Permitted Adjustments
Demand modifies **healthScore** and **stockoutRisk**, with constraints:

1. **MUST NOT exceed bounds** (0-100 for healthScore)
2. **MUST NOT override canonical degradation**
3. **MUST NOT recompute velocity** (only consume from `product_demand_signals`)

#### Allowed Internal Algorithm
```typescript
function applyDemandDynamics(
  snapshot: ProductHealthSnapshot,
  demand: DemandSignals
): ProductHealthSnapshot {
  const velocity = demand.unit_sales_30d ?? 0;

  // Reward stable demand with mild upward nudge (capped)
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

#### Locked Constraint
Demand MAY increase healthScore slightly, but **NEVER by more than +2 in a single recalculation**.

---

### 5.5 StockoutRisk Calculation (Allowed Formula Family)

#### Required Inputs
SKU-OS MUST compute stockoutRisk based on:
- `demandVelocity30d`
- (optional) inventory quantity (if provided by WMS Lite)
- `lastOrderAt` recency

#### Minimum Required Model
```typescript
function computeStockoutRisk(
  velocity30d: number,
  stockAvailable?: number
): number {
  if (!velocity30d || velocity30d <= 0) return 0;
  
  // Default if no inventory data
  if (stockAvailable === undefined || stockAvailable === null) {
    return 0.5; // Neutral risk when unknown
  }
  
  const daysOfSupply = stockAvailable / (velocity30d / 30);
  return clamp(1 - (daysOfSupply / 30), 0, 1);
}
```

#### Locked Constraints
1. **MUST be monotonic:** lower stock → higher risk
2. **MUST return 0–1**
3. **MUST NOT attempt to infer inventory ledger** (accept only external quantities)

#### Alternative Allowed Formula
```typescript
// Alternative with recency weighting
function computeStockoutRiskAdvanced(
  velocity30d: number,
  stockAvailable: number,
  lastOrderAt?: string
): number {
  const baseRisk = computeStockoutRisk(velocity30d, stockAvailable);
  
  // Adjust for recency (no orders in 7 days increases risk)
  if (lastOrderAt) {
    const daysSinceLastOrder = daysBetween(lastOrderAt, new Date());
    const recencyFactor = Math.min(1, daysSinceLastOrder / 14);
    return Math.min(1, baseRisk * (1 + recencyFactor * 0.3));
  }
  
  return baseRisk;
}
```

---

### 5.6 Confidence Scoring (Locked Semantics, Flexible Algorithm)

#### Required Confidence Factors
SKU-OS MUST compute `confidence` based on signal availability:

| Condition | Confidence | Implementation Example |
|-----------|------------|------------------------|
| No demand signals OR no returns/issue events | low | `demandVelocity30d = 0` |
| Demand + returns present, but unstable | medium | High variance in signals |
| Demand stable + signals consistent ≥ 14 days | high | Low variance, complete data |

#### Allowed Structure
```typescript
function computeConfidence(params: {
  demand: DemandSignals;
  returns: ReturnAnalyticsEvent[];
  issues: ProductQualityEvent[];
}): 'low' | 'medium' | 'high' {
  // Demand completeness
  if (!params.demand || params.demand.historyLength < 7) return 'low';
  
  // Event presence
  if (!params.returns.length && !params.issues.length) return 'low';
  
  // Stability
  if (params.demand.historyLength < 14) return 'medium';
  
  // Signal consistency
  const isStable = checkSignalStability(params);
  return isStable ? 'high' : 'medium';
}
```

**Note:** Exact numeric thresholds MAY change internally, but semantic meanings MUST stay consistent.

---

### 5.7 SKU-OS Recalculation Cycle (Locked Order)

#### Mandatory Execution Order
The full update cycle MUST execute in this exact order:

```typescript
// 1. Load baseline snapshot
const snapshot = loadBaseline(productId);

// 2. Apply return degradation (FIRST)
snapshot = applyReturnImpact(snapshot, returnEvents);

// 3. Apply issue degradation (SECOND)
snapshot = applyIssueImpact(snapshot, issueEvents);

// 4. Apply demand dynamics (THIRD)
snapshot = applyDemandDynamics(snapshot, demandData);

// 5. Recompute stockoutRisk
snapshot.stockoutRisk = computeStockoutRisk(snapshot);

// 6. Recompute confidence
snapshot.confidence = computeConfidence(snapshot);

// 7. Clamp final healthScore
snapshot.healthScore = clamp(snapshot.healthScore, 0, 100);

// 8. Persist snapshot
persistSnapshot(snapshot);

// 9. Emit analytics event
emitProductHealthAnalyticsEvent(snapshot);
```

#### Locked Order Rules
1. **Return degradation MUST run before issue degradation**
2. **Demand MUST run after all degradation**
3. **Confidence MUST be computed after all other calculations**
4. **Clamping MUST be the final healthScore adjustment**

---

### 5.8 Emitted Analytics Event (Locked)

#### Required Emission
After every recalculation:

```typescript
function emitProductHealthAnalyticsEvent(snapshot: ProductHealthSnapshot): void {
  const event: ProductHealthAnalyticsEvent = {
    shopId: snapshot.shopId,
    productId: snapshot.productId,
    healthScore: snapshot.healthScore,
    stockoutRisk: snapshot.stockoutRisk,
    marginHealth: snapshot.marginHealth,
    confidence: snapshot.confidence,
    recalculatedAt: new Date().toISOString()
  };
  
  publishToInsightCore(event);
}
```

#### Locked Format
**No additions, no omissions, no renaming** of fields.

---

### 5.9 What SKU-OS MUST NOT Do

#### Computation Prohibitions
SKU-OS MUST NOT recompute:
1. **Return quality enums** (ReturnNexus responsibility)
2. **Issue root causes** (ProblemCenter responsibility)
3. **Return reasons** (ReturnNexus responsibility)
4. **Profit/margin per order** (OrderNexus responsibility)
5. **Inventory at warehouse level** (WMS Lite responsibility)

#### Integration Prohibitions
SKU-OS MUST NOT:
1. **Combine WMS + ReturnNexus signals** into new categories
2. **Create new degradation tables** (without v2 contract)
3. **Apply positive "healing"** without explicit v2 contract
4. **Change event schema** (without migration plan)

#### Responsibility Boundary
This ensures SKU-OS stays strictly within its CNS node responsibility as a signal translator and health calculator, not a signal generator or reinterpretation engine.

---

### Compliance Verification Checklist

#### Health Model Compliance
- [ ] `healthScore` always 0-100
- [ ] `stockoutRisk` always 0-1
- [ ] Degradation applied monotonically
- [ ] Confidence reflects data completeness
- [ ] No internal fields leaked to analytics events

#### Engine Compliance
- [ ] Recalculation order preserved
- [ ] Canonical tables used exclusively
- [ ] Daily degradation clamped to -15
- [ ] Demand bonus capped at +2
- [ ] No signal reinterpretation
- [ ] Exact event schema maintained

#### Version Compliance
- [ ] Internal changes don't break contracts
- [ ] No v2 features in v1.1 implementation
- [ ] Migration paths considered for future changes
- [ ] Documentation matches implementation

---