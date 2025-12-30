# `05-readiness-backlog-tests.md`

## Providers & Readiness Signals

### Current Implementation (FT0)

#### Already Added (in `readiness.providers.ts`):

```typescript
// Current readiness signals emitted:
skuOs.productCount           // Number of canonical products
skuOs.productHealthEvents    // v1 stub = productCount
sku-os.freeTierState        // Module access state
sku-os.freeTierRemaining    // Remaining free tier units
```

### Refinements Required (Next Patches)

#### 1. Signal Accuracy Improvements
* **Current Issue:** `skuOs.productHealthEvents` currently returns `productCount` as a stub
* **Required Fix:** Make `skuOs.productHealthEvents` reflect actual emitted events (count of events in last X days)
* **Implementation:**
  ```typescript
  // New logic:
  productHealthEvents = count of ProductHealthAnalyticsEvent in last 7 days
  ```

#### 2. Freshness Timestamps
* **New Signal:** `skuOs.lastProductHealthEventAt`
* **Purpose:** Track when the most recent health event was emitted
* **Use Case:** Detect stale health data and trigger recalculations

#### 3. Readiness Predicate
* **New Rule:** `canShowProductHealthDashboards`
* **Logic:** `has product health events AND productCount >= 1`
* **Implementation:**
  ```typescript
  canShowProductHealthDashboards = 
    skuOs.productHealthEvents >= 1 && 
    skuOs.productCount >= 1
  ```

#### 4. Signal Dependency Graph
```
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│   Platform Signals  │    │     SKU-OS Signals   │    │    UI Readiness     │
│                     │    │                      │    │                     │
│ • syncCompleted     │───▶│ • productCount       │───▶│ • Dashboard Access  │
│                     │    │ • productHealthEvents│    │ • Widget Display    │
│                     │    │ • lastEventAt        │    │                     │
│                     │    │ • freeTierState      │    │                     │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
```

---

## Backlog: What We Planned But NOT YET Implemented

### Priority 1: Core Health Model
1. **Real Health Model Implementation**
   * Seasonality detection and adjustment
   * Inventory lead time integration
   * Health decay algorithms for aging SKUs

2. **Degradation Reasons & Playbooks**
   * Tag-based degradation reason classification
   * Contextual playbook generation
   * Action prioritization engine

3. **Stockout Forecasting**
   * Lead time-based stockout projections
   * Open purchase order integration
   * Multi-location inventory consideration

### Priority 2: Eventing & Integration
4. **Advanced Event System**
   * `SkuHealthChangeEvent` emission on threshold crossings
   * Problem Center integration for persistent issues
   * Alert escalation workflows

5. **UI Widget Expansion**
   * Product Health trends visualization
   * Stockout forecast tables
   * Margin health distribution charts
   * Health map with filtering capabilities

### Priority 3: Extended Features
6. **Export & API Enhancements**
   * CSV export functionality
   * Advanced API queries with filtering
   * Bulk health status retrieval

7. **Integration Testing**
   * End-to-end testing pipeline
   * Performance benchmarking
   * Data consistency validation

### Priority 4: Quality & Performance
8. **Comprehensive Test Suite**
   * Unit tests for all scoring functions
   * Integration tests with canonical data
   * Load testing for large catalogs

9. **Monitoring & Observability**
   * Health score drift detection
   * Performance metric collection
   * Anomaly detection systems

---

## Tests & QA to Add

### Unit Tests

#### 1. Scoring Function Tests
```typescript
// Test suite for health score calculations
describe('HealthScore Calculations', () => {
  test('velocity → healthScore mapping', () => {
    // Test cases:
    // - Zero velocity → low health score
    // - High velocity → high health score
    // - Edge cases and boundary conditions
  });

  test('margin → marginHealth mapping', () => {
    // Test cases:
    // - Healthy margin ranges → 'healthy'
    // - At-risk margins → 'at_risk'
    // - Critical margins → 'critical'
    // - Missing cost data → 'unknown'
  });

  test('daysOfCover calculation', () => {
    // Test cases:
    // - Zero inventory → 0 days of cover
    // - High inventory, low velocity → high days of cover
    // - Edge cases with zero velocity
  });
});
```

#### 2. Risk Calculation Tests
```typescript
describe('Risk Calculations', () => {
  test('stockoutRisk computation', () => {
    // Verify 0-1 range
    // Test monotonic behavior
    // Validate with known scenarios
  });

  test('confidence band assignment', () => {
    // Test data completeness → confidence mapping
    // Verify consistency across scenarios
  });
});
```

### Integration Tests

#### 1. Data Pipeline Integration
```typescript
describe('SKU-OS Data Pipeline', () => {
  test('seed canonical_products + order_line_items', async () => {
    // Setup test data
    // Run SKU-OS recalculation
    // Assert fact_product_health rows inserted
    // Validate health score values
  });

  test('event-driven updates', async () => {
    // Simulate order events
    // Verify health score updates
    // Check event emission
  });
});
```

#### 2. Readiness Provider Tests
```typescript
describe('Readiness Providers', () => {
  test('skuOs.productCount calculation', () => {
    // Mock database rows
    // Verify accurate product count
    // Test edge cases (0 products, large counts)
  });

  test('skuOs.productHealthEvents accuracy', () => {
    // Mock event data
    // Verify event counting logic
    // Test time window filtering
  });

  test('free tier state transitions', () => {
    // Test all state transitions
    // Verify signal emissions
    // Validate UI impact
  });
});
```

### End-to-End Tests

#### 1. User Journey Tests
```typescript
describe('End-to-End User Journey', () => {
  test('UI widget shows top-10 at-risk after sync', async () => {
    // Complete integration sync
    // Trigger health calculations
    // Verify widget displays correct data
    // Validate sorting and prioritization
  });

  test('onboarding completion flow', async () => {
    // Simulate new merchant setup
    // Verify readiness signals
    // Check task completion
    // Validate UI state transitions
  });
});
```

#### 2. Performance Tests
```typescript
describe('Performance Testing', () => {
  test('large catalog processing', async () => {
    // Load 10,000+ products
    // Measure calculation time
    // Verify memory usage
    // Check database load
  });

  test('concurrent user access', async () => {
    // Simulate multiple merchants
    // Test concurrent calculations
    // Verify data isolation
  });
});
```

### Test Data Strategy

#### 1. Test Data Generation
```typescript
// Factory functions for test data
const createTestProduct = (overrides = {}) => ({
  product_id: 1,
  shop_id: 1,
  product_title: 'Test Product',
  created_at: new Date().toISOString(),
  ...overrides
});

const createTestOrderLineItem = (overrides = {}) => ({
  line_item_id: 1,
  product_id: 1,
  shop_id: 1,
  quantity: 10,
  unit_price: 29.99,
  estimated_unit_cost: 15.00,
  ...overrides
});
```

#### 2. Scenario Coverage
```typescript
// Key test scenarios
const testScenarios = {
  // Demand patterns
  HIGH_DEMAND: { velocity: 100, inventory: 50 },
  LOW_DEMAND: { velocity: 5, inventory: 100 },
  NO_DEMAND: { velocity: 0, inventory: 10 },
  
  // Margin scenarios
  HEALTHY_MARGIN: { price: 100, cost: 40 },
  AT_RISK_MARGIN: { price: 100, cost: 80 },
  CRITICAL_MARGIN: { price: 100, cost: 95 },
  UNKNOWN_MARGIN: { price: 100, cost: null },
  
  // Return scenarios
  HIGH_RETURNS: { return_rate: 0.25 },
  LOW_RETURNS: { return_rate: 0.02 },
  NO_RETURNS: { return_rate: 0 },
};
```

### QA Checklist

#### Pre-Deployment Validation
- [ ] All unit tests passing
- [ ] Integration tests completed
- [ ] End-to-end tests verified
- [ ] Performance benchmarks met
- [ ] Data migration tested
- [ ] Rollback procedures validated

#### Post-Deployment Monitoring
- [ ] Health score stability monitoring
- [ ] Event emission verification
- [ ] Dashboard performance tracking
- [ ] Error rate monitoring
- [ ] User feedback collection

### Test Environment Requirements

#### 1. Infrastructure
- Isolated test database
- Mock external service endpoints
- Performance testing environment
- CI/CD pipeline integration

#### 2. Data Requirements
- Anonymized production data samples
- Edge case data sets
- Performance stress test data
- Migration test data sets

#### 3. Monitoring & Reporting
- Test coverage reports
- Performance benchmark tracking
- Defect tracking integration
- Release readiness dashboards

---