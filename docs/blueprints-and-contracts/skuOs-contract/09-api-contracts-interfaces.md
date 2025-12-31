# `09-api-contracts-interfaces.md`

## Core v1 Output Contracts (Locked)

### 1.1 Product Attention API – Empty Set & Null Handling (Locked)

#### Purpose
Drive the "N products that need attention today" UI by providing prioritized, actionable product health data.

#### Empty Set Behavior

```typescript
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
```

#### Null Field Handling (UI Contract)
The following rules ensure consistent UI behavior without interpretation drift:

```typescript
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
```

**Important:** The **shape** of the product attention API is locked; we're only clarifying inputs and degradation rules.

---

### 1.2 ProductHealthAnalyticsEvent → InsightCore (Locked)

SKU OS exposes the following interface (unchanged):

```typescript
// sku-os → insight-core
export interface ProductHealthAnalyticsEvent {
  shopId: number;
  productId: number;        // canonical product id
  healthScore: number;      // 0–100
  stockoutRisk: number;     // 0–1
  marginHealth: 'healthy' | 'at_risk' | 'critical' | 'unknown';
  confidence: 'low' | 'medium' | 'high';
  recalculatedAt: string;   // ISO timestamp
}
```

**Critical Rule:** SKU OS is the **only producer** of `ProductHealthAnalyticsEvent`.

---

## Inputs — Who Feeds SKU OS, and What Is Canonical (LOCKED v1.1)

SKU OS is a **pure consumer** of upstream signals with strict ingestion rules:

1. **MUST NOT** generate its own interpretations of returns or issues
2. **MUST NOT** infer profitability or inventory ledger truth
3. **MUST** treat approved sources as canonical

Below are the only approved sources of truth SKU OS may use.

---

### 2.1 OrderNexus → SKU OS — Demand, Velocity & Returns Rate

#### 2.1.1 Canonical Table (Owned by OrderNexus)

```sql
CREATE TABLE product_demand_signals (
  shop_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,

  -- Demand metrics
  order_count_7d INTEGER DEFAULT 0,
  order_count_30d INTEGER DEFAULT 0,

  unit_sales_7d INTEGER DEFAULT 0,
  unit_sales_30d INTEGER DEFAULT 0,

  -- Returns rate computed by OrderNexus using ReturnNexus truth
  returns_rate_30d DECIMAL(4,3),   -- 0–1
  
  -- Pricing information
  avg_selling_price DECIMAL(10,2),

  -- Timestamps
  last_order_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (shop_id, product_id)
);
```

#### 2.1.2 Locked Rules
1. **Read-Only:** SKU OS must treat this table as read-only
2. **No Recomputation:** SKU OS must NOT recompute returns rate
3. **Canonical Source:** Only canonical demand feeds SKU OS
4. **Missing Row Handling:** Missing rows MUST be treated as:
   ```typescript
   {
     unit_sales_30d: 0,
     order_count_30d: 0,
     returns_rate_30d: 0,
     last_order_at: null,
     avg_selling_price: null
   }
   ```

**Allowed Computations:** SKU OS can compute:
- `demandVelocity`
- `stockoutRisk`
- lifecycle tags (hero, drifter, zombie)

---

### 2.2 OrderNexus → SKU OS — Real-Time Demand Events (Optional v1)

#### Event Types
SKU OS may optionally receive incremental events for real-time health updates:

```typescript
// order-nexus → sku-os
export interface OrderCompletedEvent {
  shopId: number;
  orderId: string;
  lineItems: Array<{
    productId: number;
    quantity: number;
    finalPrice: number;
  }>;
  completedAt: string;
}

export interface OrderReturnedEvent {
  shopId: number;
  orderId: string;
  lineItems: Array<{
    productId: number;
    quantity: number;
  }>;
  returnedAt: string;
}
```

#### Rules
1. **Velocity Only:** `OrderCompletedEvent` drives velocity only (recency, 7-day/30-day adjustments)
2. **Net Demand Only:** `OrderReturnedEvent` adjusts net demand only (not quality signals)
3. **No Quality Inference:** SKU OS must not derive quality from returns — this comes from ReturnNexus

---

### 2.3 ReturnNexus → SKU OS — Canonical Returns Quality (LOCKED)

#### Event Interface
ReturnNexus provides the only source of truth for returns-quality inputs:

```typescript
export interface ReturnAnalyticsEvent {
  shopId: number;
  returnId: string;
  orderId: string;
  productId: string;
  quantity: number;

  // Canonical enums (must be treated as opaque)
  reasonCategory: ReturnReasonCategory;
  inspectionResult: InspectionResult;
  issueRootCause: IssueRootCause;

  // Financial data
  refundAmount: number;
  currency: string;
  restockable: boolean;

  // Timestamps
  processedAt: string;  // ISO timestamp
}
```

#### Locked Rules
SKU OS MUST treat the following as opaque, canonical enums from returns-quality-contract:
- `ReturnReasonCategory`
- `InspectionResult`
- `IssueRootCause`
- `restockable`

SKU OS MUST NOT:
1. Re-interpret these values
2. Overwrite them
3. Derive secondary meanings from them

**All degradation mapping MUST reference the canonical tables** (defined in Section 3).

---

### 2.4 ProblemCenter → SKU OS — Canonical Product Quality Events (LOCKED)

#### Event Interface
ProblemCenter owns the only warehouse-quality and inspection issue model in the CNS:

```typescript
export interface ProductQualityEvent {
  shopId: number;
  productId: string;

  // Canonical issue taxonomy
  issueType: IssueType;
  severity: IssueSeverity;
  sourceStep: IssueSourceStep;
  issueId: string;

  // Timestamp
  occurredAt: string; // ISO timestamp
}
```

#### Locked Rules
1. **Consume As-Is:** SKU OS MUST consume this event as-is
2. **No Generation:** SKU OS MUST NOT generate or mutate quality events
3. **No Alternative Taxonomy:** SKU OS MUST NOT maintain its own issue taxonomy
4. **Canonical Mapping:** SKU OS MUST map this input using the canonical degradation table

**Critical:** ProblemCenter → SKU OS is the exclusive quality pipeline.

---

### 2.5 WMS Lite → SKU OS — Optional Raw Inspection Context (Read-Only)

#### Permissions & Restrictions
SKU OS MAY consume `ReturnInspectionEvent` from WMS Lite for richer raw fields, but:

1. **No Root-Cause Derivation:** SKU OS MUST NOT derive root-cause from WMS codes
2. **No Alternative Mapping:** SKU OS MUST NOT generate its own mapping from physical condition to:
   - `InspectionResult`
   - `IssueRootCause`

#### Conflict Resolution
If any conflict occurs:
1. **Primary:** ReturnNexus truth wins
2. **Secondary:** ProblemCenter truth wins

---

### 2.6 InsightCore — Downstream Consumer (Analytics)

#### Role Clarification
InsightCore is **not an input**; it is the downstream analytics consumer of:
- `ProductHealthAnalyticsEvent`

#### SKU OS Responsibility
SKU OS MUST publish this event after each health recalculation.

---

### 2.7 Summary Table — Module Responsibilities (Locked)

| Signal / Table | Owner | SKU OS Role |
|----------------|-------|-------------|
| `product_demand_signals` | OrderNexus | Read-only |
| `ReturnAnalyticsEvent` | ReturnNexus | Read-only, degrade health |
| `ProductQualityEvent` | ProblemCenter | Read-only, degrade health |
| `ReturnInspectionEvent` | WMS Lite | Optional raw hints (read-only) |
| `ProductHealthAnalyticsEvent` | SKU OS | SKU OS must emit |

---

## Interface Stability & Evolution

### Backward Compatibility Rules

#### Allowed Changes
1. **Internal Fields:** Add private/internal fields not exposed in contracts
2. **Performance Optimizations:** Improve algorithms without changing outputs
3. **Monitoring Enhancements:** Add logging and telemetry
4. **Configuration Expansion:** Add optional configuration parameters

#### Breaking Changes (Require v2)
1. **Field Removal:** Removing any field from published interfaces
2. **Type Changes:** Changing data types of published fields
3. **Enum Expansion:** Adding values that could break existing switch statements
4. **Contract Violations:** Changing any locked rule in this document

### Versioning Strategy

```typescript
interface ContractVersion {
  major: 1;      // Breaking changes
  minor: 1;      // Backward-compatible additions
  patch: number; // Bug fixes
}

// Version header in all events
interface VersionedEvent {
  _contractVersion: ContractVersion;
  // ... event data
}
```

### Migration Requirements

For any breaking change:
1. **Deprecation Period:** Minimum 30 days notice
2. **Dual Support:** Both old and new versions during transition
3. **Migration Tools:** Automated data transformation utilities
4. **Documentation:** Clear upgrade guides

### Testing Requirements

#### Contract Compliance Tests
```typescript
describe('SKU OS Contract Compliance', () => {
  test('ProductHealthAnalyticsEvent shape', () => {
    // Verify all required fields exist
    // Verify type signatures
    // Verify enum value constraints
  });

  test('Input consumption rules', () => {
    // Verify no mutation of upstream data
    // Verify canonical enum usage
    // Verify read-only access patterns
  });
});
```

#### Integration Tests
```typescript
describe('Cross-Module Integration', () => {
  test('OrderNexus → SKU OS data flow', () => {
    // Verify demand signal consumption
    // Verify no recomputation of returns rate
  });

  test('ReturnNexus → SKU OS quality flow', () => {
    // Verify canonical enum preservation
    // Verify degradation mapping application
  });
});
```

### Error Handling Requirements

#### Input Validation
```typescript
function validateInputEvent(event: any): ValidationResult {
  // Must validate:
  // 1. Required fields present
  // 2. Field types correct
  // 3. Enum values within canonical sets
  // 4. Timestamps valid ISO strings
}
```

#### Graceful Degradation
```typescript
interface DegradedMode {
  reason: 'missing_data' | 'invalid_input' | 'upstream_failure';
  fallbackBehavior: 'use_last_known' | 'use_defaults' | 'skip_calculation';
  confidence: 'low';
  timestamp: string;
}
```

### Monitoring & Observability

#### Required Metrics
```typescript
interface ContractMetrics {
  // Input metrics
  orders_processed: number;
  returns_processed: number;
  issues_processed: number;
  
  // Output metrics
  health_events_emitted: number;
  attention_updates: number;
  
  // Quality metrics
  input_validation_errors: number;
  contract_violations: number;
  degradation_mapping_misses: number;
}
```

#### Alert Conditions
```typescript
const ALERT_THRESHOLDS = {
  // Input alerts
  no_orders_24h: { shops: ['active'] },
  no_returns_48h: { shops: ['has_return_history'] },
  
  // Output alerts
  no_health_events_12h: { severity: 'critical' },
  contract_violation: { severity: 'critical' },
  
  // Performance alerts
  processing_latency_5min: { threshold: '2 minutes' },
  error_rate_1h: { threshold: '1%' }
};
```

---