# `10-degradation-mapping-tables.md`

## Canonical Degradation Mapping (LOCKED v1.1)

### Overview
SKU-OS must convert *returns quality* and *warehouse quality issues* into deterministic negative impact on `healthScore`. This mapping is **canonical**, centralized, and MUST NOT be forked by modules.

**Key Principles:**
- SKU-OS MAY adjust internal heuristics, but the **bucket + delta tables are immutable for v1.1**
- All degradation is additive and reduces health unless bucket = NONE
- Mappings are based on canonical enums from upstream modules

---

### 3.1 Degradation Buckets (Locked)

#### Interface Definition
```typescript
export type DegradationBucket = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface DegradationEffect {
  bucket: DegradationBucket;
  healthScoreDelta: number;   // negative = degradation, positive = healing
}
```

#### Bucket Semantics
| Bucket | Health Impact | Typical Use Cases |
|--------|--------------|-------------------|
| `NONE` | No impact | Customer misuse, expected returns |
| `LOW` | Minor impact (-1 to -3) | Low-severity issues, minor defects |
| `MEDIUM` | Moderate impact (-4 to -6) | Packaging issues, fulfillment errors |
| `HIGH` | Severe impact (-7 to -10) | Manufacturing defects, quality failures |

---

### 3.2 Returns-Driven Degradation (ReturnNexus → SKU-OS)

#### Classification Rules
SKU-OS MUST classify returns using the canonical cross-mapping of:
- `InspectionResult`
- `IssueRootCause`

Both come from ReturnNexus and MUST be treated as opaque enums.

#### 3.2.1 Canonical Table (Locked)

| InspectionResult | IssueRootCause | Bucket | Δ Health |
|------------------|----------------|--------|----------|
| APPROVED_REFUND_SCRAP | MANUFACTURING_QUALITY | HIGH | -10 |
| APPROVED_REFUND_SCRAP | PACKAGING_QUALITY | HIGH | -10 |
| APPROVED_REFUND_SCRAP | CARRIER_DAMAGE | MEDIUM | -6 |
| APPROVED_REFUND_RESTOCKABLE | MANUFACTURING_QUALITY | MEDIUM | -5 |
| APPROVED_REFUND_RESTOCKABLE | PACKAGING_QUALITY | MEDIUM | -5 |
| APPROVED_REFUND_RESTOCKABLE | CARRIER_DAMAGE | LOW | -3 |
| PARTIAL_REFUND | FULFILLMENT_ERROR | MEDIUM | -5 |
| PARTIAL_REFUND | CUSTOMER_EXPECTATIONS | LOW | -2 |
| PARTIAL_REFUND | CUSTOMER_MISUSE | LOW | -2 |
| REJECTED_REFUND | CUSTOMER_MISUSE | NONE | 0 |
| REJECTED_REFUND | CUSTOMER_EXPECTATIONS | LOW | -1 |
| REJECTED_REFUND | MANUFACTURING_QUALITY | MEDIUM | -4 |
| ANY | UNKNOWN | LOW | -2 |

#### 3.2.2 Selection Rules (Locked)

##### Primary Lookup
1. **Exact Match:** (inspectionResult, issueRootCause) → use corresponding row
2. **Fallback Match:** (inspectionResult, UNKNOWN) → use if available
3. **Default:** { bucket: 'LOW', healthScoreDelta: -2 }

##### Implementation Logic
```typescript
function lookupDegradation(
  inspectionResult: InspectionResult,
  issueRootCause: IssueRootCause
): DegradationEffect {
  // Try exact match
  const exactMatch = table.find(row => 
    row.inspectionResult === inspectionResult &&
    row.issueRootCause === issueRootCause
  );
  
  if (exactMatch) return exactMatch;
  
  // Fallback to UNKNOWN for this inspection result
  const unknownMatch = table.find(row => 
    row.inspectionResult === inspectionResult &&
    row.issueRootCause === 'UNKNOWN'
  );
  
  if (unknownMatch) return unknownMatch;
  
  // Ultimate fallback
  return {
    bucket: 'LOW',
    healthScoreDelta: -2
  };
}
```

---

### 3.3 Quantity Scaling (Locked)

#### Scaling Formula
SKU-OS MAY scale degradation by units returned relative to units ordered.

**Canonical Formula:**
```typescript
ratio = unitsOrdered ? Math.min(1, unitsReturned / unitsOrdered) : 1;
effect.healthScoreDelta = baseDelta * ratio;
```

#### Important Rules:
1. **Scaling Modifies Δ, NOT Bucket:** Bucket classification remains unchanged
2. **Maximum Ratio:** Capped at 1.0 (100% of units ordered)
3. **Zero Units Ordered:** Defaults to ratio = 1 (full degradation)

#### Example:
```
Base delta = -10
unitsReturned = 1
unitsOrdered = 5

→ ratio = 0.2
→ adjusted delta = -2
→ bucket remains unchanged
```

---

### 3.4 ProblemCenter Issue-Driven Degradation (Locked)

#### Input Taxonomy
ProblemCenter owns the only warehouse issue taxonomy. SKU-OS maps:
- `IssueType`
- `IssueSeverity`

#### 3.4.1 Canonical Table (Locked)

| IssueType | Severity | Bucket | Δ Health |
|-----------|----------|--------|----------|
| PRODUCT_DEFECT | HIGH/CRITICAL | HIGH | -8 |
| PRODUCT_DEFECT | MEDIUM | MEDIUM | -5 |
| PRODUCT_DEFECT | LOW | LOW | -2 |
| PACKAGING_DEFECT | HIGH/CRITICAL | MEDIUM | -5 |
| PACKAGING_DEFECT | MEDIUM | LOW | -3 |
| PACKAGING_DEFECT | LOW | LOW | -1 |
| SHIPPING_DAMAGE | HIGH/CRITICAL | MEDIUM | -5 |
| SHIPPING_DAMAGE | MEDIUM | LOW | -3 |
| SHIPPING_DAMAGE | LOW | LOW | -1 |
| MISSING_ITEM | ANY | MEDIUM | -5 |
| WRONG_ITEM | ANY | MEDIUM | -5 |
| OTHER_FULFILLMENT_ERROR | ANY | LOW | -2 |

#### 3.4.2 Selection Rules

##### Severity Equivalence
- `HIGH` and `CRITICAL` are equivalent for mapping purposes

##### Lookup Logic
1. **Primary:** (IssueType, Severity) exact match
2. **Fallback:** { bucket: 'LOW', healthScoreDelta: -2 }

##### Implementation
```typescript
function lookupIssueDegradation(
  issueType: IssueType,
  severity: IssueSeverity
): DegradationEffect {
  // Normalize severity: treat HIGH and CRITICAL as HIGH
  const normalizedSeverity = 
    severity === 'CRITICAL' ? 'HIGH' : severity;
  
  // Find exact match
  const match = table.find(row => 
    row.issueType === issueType &&
    (row.severity === normalizedSeverity || row.severity === 'ANY')
  );
  
  return match || {
    bucket: 'LOW',
    healthScoreDelta: -2
  };
}
```

---

### 3.5 Combined Returns + Issue Impact (Locked)

#### Co-occurrence Rules
If both `ReturnAnalyticsEvent` and `ProductQualityEvent` occur for the same product in the same day:

1. **Sum Deltas:** SKU-OS MAY sum healthScoreDelta values
2. **Daily Clamp:** MUST clamp daily degradation to maximum

#### Daily Degradation Limit
```typescript
const maxDailyDegradation = -15;
const healthScoreDelta = Math.max(healthScoreDeltaSum, -15);
```

#### Important Notes:
- **Bucket Does Not Change:** Only the cumulative delta clamps
- **Individual Events Tracked:** Each event's degradation still recorded separately
- **Time Window:** "Same day" defined by calendar date in shop's timezone

#### Example Scenario:
```
Day 1:
- Return event: -10 delta
- Issue event: -8 delta
- Total: -18 delta
- Clamped to: -15 delta
- Bucket remains the highest of individual events
```

---

### 3.6 Canonical Helper Interfaces (Must Exist)

#### Input Interfaces
```typescript
export interface DegradationInputFromReturn {
  inspectionResult: InspectionResult;
  issueRootCause: IssueRootCause;
  unitsReturned: number;
  unitsOrdered?: number;  // Optional for ratio calculation
}

export interface DegradationInputFromIssue {
  issueType: IssueType;
  severity: IssueSeverity;
}
```

#### Required Helper Functions
SKU-OS MUST expose these helper functions:

```typescript
/**
 * Computes degradation effect from a return event
 * Implements canonical table + quantity scaling
 */
export function computeDegradationFromReturn(
  input: DegradationInputFromReturn
): DegradationEffect {
  // Implementation must follow:
  // 1. Table lookup (Section 3.2.1)
  // 2. Quantity scaling (Section 3.3)
  // 3. Fallback rules (Section 3.2.2)
}

/**
 * Computes degradation effect from a quality issue event
 * Implements canonical table (Section 3.4.1)
 */
export function computeDegradationFromIssue(
  input: DegradationInputFromIssue
): DegradationEffect {
  // Implementation must follow:
  // 1. Table lookup (Section 3.4.1)
  // 2. Severity normalization (HIGH/CRITICAL equivalence)
  // 3. Fallback rules (Section 3.4.2)
}
```

#### Implementation Requirements
1. **Deterministic:** Same inputs → same outputs
2. **Idempotent:** Repeated calls with same inputs → same results
3. **Thread-safe:** Safe for concurrent execution
4. **Performance:** O(1) lookup time

---

### 3.7 What SKU-OS MUST NOT Do (Locked)

#### Strict Prohibitions
SKU-OS MUST NOT perform any of the following actions:

1. **Recompute IssueRootCause from raw WMS fields**
   - Must use canonical enums from ReturnNexus only

2. **Invent new degradation categories or buckets**
   - Must use only the defined buckets (NONE, LOW, MEDIUM, HIGH)

3. **Change table values without a version bump**
   - Any change requires v2 contract and migration

4. **Interpret customer behavior**
   - Customer analysis is Specter's responsibility

5. **Infer profitability impact**
   - Profitability calculations are OrderNexus's responsibility

6. **Generate its own quality or return signals**
   - Must only consume, never produce these signals

#### SKU-OS Role Clarification
> SKU-OS is a **translation layer**, not a re-interpreter of returns/quality truth. It converts canonical upstream signals into health impacts using locked mappings.

#### Boundary Enforcement Examples

##### ✅ Allowed
```typescript
// Using canonical mappings
const effect = computeDegradationFromReturn({
  inspectionResult: 'APPROVED_REFUND_SCRAP',
  issueRootCause: 'MANUFACTURING_QUALITY',
  unitsReturned: 2,
  unitsOrdered: 10
});
// Returns: { bucket: 'HIGH', healthScoreDelta: -2 }
```

##### ❌ Prohibited
```typescript
// Creating custom mappings
const customEffect = {
  bucket: 'VERY_HIGH',  // Not a canonical bucket
  healthScoreDelta: -20 // Exceeds allowed range
};

// Reinterpreting enums
if (rawWMS.inspectionCode === 'DAMAGED') {
  // Cannot assign meaning to raw codes
  issueRootCause = 'CARRIER_DAMAGE'; // Must come from ReturnNexus
}

// Generating new signals
emitCustomQualityEvent({
  productId: 123,
  issueType: 'MY_CUSTOM_ISSUE', // Not in canonical taxonomy
  severity: 'HIGH'
});
```

#### Compliance Verification

##### Test Cases for Boundary Compliance
```typescript
describe('Degradation Mapping Compliance', () => {
  test('must not invent new buckets', () => {
    const result = computeDegradationFromReturn(validInput);
    const allowedBuckets = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];
    expect(allowedBuckets).toContain(result.bucket);
  });

  test('must not exceed table deltas', () => {
    const result = computeDegradationFromReturn(validInput);
    // Check against maximum delta from table
    expect(result.healthScoreDelta).toBeGreaterThanOrEqual(-10);
  });

  test('must respect quantity scaling', () => {
    const input = { ...validInput, unitsReturned: 1, unitsOrdered: 10 };
    const result = computeDegradationFromReturn(input);
    // Base delta -10 * 0.1 ratio = -1
    expect(result.healthScoreDelta).toBe(-1);
  });
});
```

##### Monitoring for Violations
```typescript
interface DegradationComplianceMetrics {
  // Track mapping usage
  exact_matches: number;
  unknown_fallbacks: number;
  default_fallbacks: number;
  
  // Track violations
  custom_buckets_detected: number;
  exceeded_daily_clamp: number;
  invalid_enum_values: number;
}
```

#### Migration Considerations

##### v1.1 to v2.0 Migration Path
If degradation tables need updating:
1. **New Table Version:** Create `degradation_mappings_v2` table
2. **Dual Support:** Support both v1.1 and v2.0 during transition
3. **Version Header:** Add `mappingVersion` to degradation results
4. **Gradual Rollout:** Migrate shops in batches
5. **Rollback Plan:** Ability to revert to v1.1 mappings

##### Example Migration Strategy
```typescript
interface DegradationEffectV2 extends DegradationEffect {
  mappingVersion: 'v1.1' | 'v2.0';
  // Additional fields for v2
}

function computeDegradation(
  input: DegradationInput,
  version: 'v1.1' | 'v2.0' = 'v1.1'
): DegradationEffectV2 {
  if (version === 'v1.1') {
    return { ...v1Result, mappingVersion: 'v1.1' };
  } else {
    return { ...v2Result, mappingVersion: 'v2.0' };
  }
}
```

---

### Summary Table: Degradation Rules Reference

| Aspect | Rule | Constraint |
|--------|------|------------|
| **Buckets** | 4 predefined buckets | NONE, LOW, MEDIUM, HIGH only |
| **Returns Mapping** | Table lookup | Exact match → fallback → default |
| **Issue Mapping** | Table lookup | HIGH/CRITICAL equivalence |
| **Quantity Scaling** | Linear scaling | ratio = min(1, returned/ordered) |
| **Daily Limit** | -15 maximum | Applies to sum of deltas |
| **Versioning** | Immutable in v1.1 | Changes require v2 contract |
| **Fallback** | {LOW, -2} | When no match found |

---