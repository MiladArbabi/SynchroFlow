# `07-sql-free-tier-ux-risks.md`

## Example SQLs & Useful Sketches

### 1. Sales Velocity Calculation

#### Basic 30-Day Velocity:
```sql
-- Sales velocity (units per day last 30d)
SELECT 
  li.canonical_product_id AS product_id,
  SUM(li.quantity) / 30.0 AS avg_units_per_day,
  SUM(li.quantity) AS total_units_30d,
  COUNT(DISTINCT o.platform_order_id) AS order_count_30d
FROM canonical_order_line_items li
JOIN canonical_orders o 
  ON o.platform_order_id = li.platform_order_id 
  AND o.shop_id = li.shop_id
WHERE li.shop_id = :shopId 
  AND o.order_created_at >= NOW() - INTERVAL '30 days'
GROUP BY li.canonical_product_id;
```

#### Multi-Window Velocity Analysis:
```sql
-- 7, 30, 90 day velocity windows
SELECT 
  li.canonical_product_id AS product_id,
  
  -- 7-day window
  SUM(CASE WHEN o.order_created_at >= NOW() - INTERVAL '7 days' 
           THEN li.quantity ELSE 0 END) / 7.0 AS velocity_7d,
  
  -- 30-day window
  SUM(CASE WHEN o.order_created_at >= NOW() - INTERVAL '30 days' 
           THEN li.quantity ELSE 0 END) / 30.0 AS velocity_30d,
  
  -- 90-day window
  SUM(CASE WHEN o.order_created_at >= NOW() - INTERVAL '90 days' 
           THEN li.quantity ELSE 0 END) / 90.0 AS velocity_90d,
  
  -- Velocity trend (7d vs 30d)
  CASE 
    WHEN SUM(CASE WHEN o.order_created_at >= NOW() - INTERVAL '30 days' THEN li.quantity ELSE 0 END) > 0
    THEN (
      SUM(CASE WHEN o.order_created_at >= NOW() - INTERVAL '7 days' THEN li.quantity ELSE 0 END) / 7.0
    ) / (
      SUM(CASE WHEN o.order_created_at >= NOW() - INTERVAL '30 days' THEN li.quantity ELSE 0 END) / 30.0
    )
    ELSE 1.0
  END AS velocity_trend_ratio

FROM canonical_order_line_items li
JOIN canonical_orders o 
  ON o.platform_order_id = li.platform_order_id 
  AND o.shop_id = li.shop_id
WHERE li.shop_id = :shopId
  AND o.order_created_at >= NOW() - INTERVAL '90 days'
GROUP BY li.canonical_product_id;
```

### 2. Days of Cover Calculation

#### Basic Days of Cover:
```sql
-- Days of cover (requires inventory_truth table)
SELECT 
  p.product_id,
  p.product_title,
  COALESCE(inv.on_hand, 0) AS current_inventory,
  vel.avg_units_per_day,
  CASE 
    WHEN vel.avg_units_per_day > 0 
    THEN COALESCE(inv.on_hand, 0) / vel.avg_units_per_day
    ELSE NULL 
  END AS days_of_cover_raw,
  
  -- Capped days of cover for extreme values
  LEAST(
    COALESCE(inv.on_hand, 0) / NULLIF(vel.avg_units_per_day, 0),
    365
  ) AS days_of_cover_capped
  
FROM canonical_products p
LEFT JOIN (
  -- Velocity subquery
  SELECT 
    canonical_product_id,
    SUM(quantity) / 30.0 AS avg_units_per_day
  FROM canonical_order_line_items li
  JOIN canonical_orders o 
    ON o.platform_order_id = li.platform_order_id 
    AND o.shop_id = li.shop_id
  WHERE li.shop_id = :shopId
    AND o.order_created_at >= NOW() - INTERVAL '30 days'
  GROUP BY canonical_product_id
) vel ON vel.canonical_product_id = p.product_id
LEFT JOIN inventory_truth inv 
  ON inv.sku = p.sku 
  AND inv.shop_id = p.shop_id
WHERE p.shop_id = :shopId;
```

#### Advanced Days of Cover with Lead Time:
```sql
-- Days of cover with supplier lead time consideration
SELECT 
  p.product_id,
  inv.on_hand,
  vel.avg_units_per_day,
  sup.lead_time_days,
  
  -- Days until stockout considering current inventory
  CASE 
    WHEN vel.avg_units_per_day > 0 
    THEN inv.on_hand / vel.avg_units_per_day
    ELSE NULL 
  END AS days_until_stockout,
  
  -- Effective days of cover (subtracting lead time)
  CASE 
    WHEN vel.avg_units_per_day > 0 
    THEN (inv.on_hand / vel.avg_units_per_day) - sup.lead_time_days
    ELSE NULL 
  END AS effective_days_of_cover,
  
  -- Stockout risk classification
  CASE 
    WHEN vel.avg_units_per_day IS NULL OR vel.avg_units_per_day = 0 THEN 'no_demand'
    WHEN inv.on_hand IS NULL THEN 'no_inventory_data'
    WHEN (inv.on_hand / vel.avg_units_per_day) <= sup.lead_time_days THEN 'immediate_risk'
    WHEN (inv.on_hand / vel.avg_units_per_day) <= (sup.lead_time_days * 1.5) THEN 'near_term_risk'
    ELSE 'sufficient'
  END AS stockout_risk_level
  
FROM canonical_products p
LEFT JOIN inventory_truth inv 
  ON inv.sku = p.sku 
  AND inv.shop_id = p.shop_id
LEFT JOIN (
  SELECT canonical_product_id, SUM(quantity) / 30.0 AS avg_units_per_day
  FROM canonical_order_line_items
  WHERE shop_id = :shopId
    AND created_at >= NOW() - INTERVAL '30 days'
  GROUP BY canonical_product_id
) vel ON vel.canonical_product_id = p.product_id
LEFT JOIN supplier_lead_times sup 
  ON sup.product_id = p.product_id 
  AND sup.shop_id = p.shop_id;
```

### 3. Health Score Heuristic (Pseudo-code)

```sql
-- Simplified health score calculation
WITH product_metrics AS (
  SELECT 
    p.product_id,
    
    -- Normalized metrics (0-1 scale)
    -- Days of cover normalization (target: 30 days)
    LEAST(
      COALESCE(doc.days_of_cover, 0) / 30.0, 
      1.0
    ) AS norm_days_of_cover,
    
    -- Margin normalization (assuming target margin > 40%)
    CASE 
      WHEN pm.net_margin IS NULL THEN 0.5  -- Unknown margin = neutral
      ELSE LEAST(pm.net_margin / 0.4, 1.0)
    END AS norm_margin,
    
    -- Velocity normalization (target: >10 units/day)
    LEAST(
      COALESCE(vel.avg_units_per_day, 0) / 10.0, 
      1.0
    ) AS norm_velocity,
    
    -- Return rate penalty (0-1, higher is worse)
    COALESCE(returns.return_rate_30d, 0) AS return_penalty
    
  FROM canonical_products p
  LEFT JOIN days_of_cover_data doc ON doc.product_id = p.product_id
  LEFT JOIN product_margins pm ON pm.product_id = p.product_id
  LEFT JOIN velocity_data vel ON vel.product_id = p.product_id
  LEFT JOIN return_rates returns ON returns.product_id = p.product_id
  WHERE p.shop_id = :shopId
)
SELECT 
  product_id,
  
  -- Health score formula
  LEAST(GREATEST(
    100 * (
      0.5 * norm_days_of_cover + 
      0.3 * norm_margin + 
      0.2 * norm_velocity -
      0.1 * return_penalty
    ),
    0
  ), 100) AS health_score,
  
  -- Component scores for debugging
  norm_days_of_cover,
  norm_margin,
  norm_velocity,
  return_penalty
  
FROM product_metrics;
```

### 4. Top At-Risk SKUs Query

```sql
-- Top 10 at-risk SKUs (for free tier widget)
SELECT 
  p.product_id,
  p.product_title,
  ph.health_score,
  ph.stockout_risk,
  ph.margin_health,
  ph.confidence,
  
  -- Risk priority score (lower = higher risk)
  CASE 
    WHEN ph.stockout_risk > 0.7 THEN ph.stockout_risk * 100
    WHEN ph.margin_health = 'critical' THEN 80
    WHEN ph.margin_health = 'at_risk' THEN 60
    ELSE (100 - ph.health_score)
  END AS risk_priority,
  
  -- Primary risk reason
  CASE 
    WHEN ph.stockout_risk > 0.7 THEN 'high_stockout_risk'
    WHEN ph.margin_health = 'critical' THEN 'critical_margin'
    WHEN ph.margin_health = 'at_risk' THEN 'low_margin'
    WHEN ph.health_score < 30 THEN 'low_health_score'
    ELSE 'other_risk'
  END AS primary_risk_reason
  
FROM canonical_products p
JOIN fact_product_health ph 
  ON ph.product_id = p.product_id 
  AND ph.shop_id = p.shop_id
WHERE p.shop_id = :shopId
  AND ph.recalculated_at = (
    SELECT MAX(recalculated_at) 
    FROM fact_product_health 
    WHERE shop_id = :shopId
  )
  AND (ph.health_score < 50 OR ph.stockout_risk > 0.5 OR ph.margin_health IN ('critical', 'at_risk'))
ORDER BY risk_priority DESC, ph.health_score ASC
LIMIT 10;
```

---

## Free-tier Gating Recommendations

### Tier Feature Matrix

| Feature | Free Tier | Paid Tier |
|---------|-----------|-----------|
| **SKU Visibility** | Top 10 at-risk only | All products |
| **Refresh Rate** | Daily | Real-time + daily |
| **Historical Data** | 7 days | 90+ days |
| **Health Scoring** | Basic algorithm | Advanced + seasonal |
| **Forecasting** | None | Stockout forecasts |
| **Playbooks** | Read-only | Interactive + actions |
| **Degradation Reasons** | Limited tags | Full detail |
| **Export Capabilities** | None | CSV, API access |
| **Confidence Levels** | Basic | Advanced metrics |
| **Alerting** | None | Configurable alerts |
| **API Access** | Read-only limited | Full API access |

### Gating Implementation Strategy

#### 1. Backend Gating Logic:
```typescript
// Example: Feature gating based on tier
class sku-osFeatureGate {
  canAccessFullProductList(shop: Shop): boolean {
    return shop.tier !== 'free' || 
           shop.freeTierRemaining > 0;
  }
  
  canAccessForecasting(shop: Shop): boolean {
    return shop.tier === 'paid';
  }
  
  getVisibleSKULimit(shop: Shop): number {
    if (shop.tier === 'paid') return Infinity;
    if (shop.freeTierState === 'active') return 10;
    return 0;
  }
}
```

#### 2. API Response Gating:
```typescript
// Filter responses based on tier
function filterSKUHealthResponse(skus: SKUHealth[], shop: Shop): SKUHealth[] {
  if (shop.tier === 'paid') {
    return skus;
  }
  
  // Free tier: only show top N at-risk
  const atRiskSKUs = skus
    .filter(sku => sku.healthScore < 50 || sku.stockoutRisk > 0.5)
    .sort((a, b) => a.healthScore - b.healthScore)
    .slice(0, shop.freeTierRemaining || 10);
    
  return atRiskSKUs;
}
```

#### 3. UI Component Gating:
```jsx
// React component with tier-based rendering
const ProductHealthWidget = ({ shop }) => {
  const { tier, freeTierRemaining } = shop;
  
  if (tier === 'free' && freeTierRemaining === 0) {
    return <UpgradePrompt feature="sku-os" />;
  }
  
  const skuLimit = tier === 'paid' ? null : freeTierRemaining;
  
  return (
    <div>
      <SKUHealthList limit={skuLimit} />
      {tier === 'free' && (
        <FreeTierNotice 
          remaining={freeTierRemaining}
          upgradeLink="/upgrade"
        />
      )}
    </div>
  );
};
```

### Metrics to Gate for Premium
1. **`stockoutForecast`** — Projected stockout dates
2. **`degradationReasons`** — Detailed issue breakdown
3. **`daysOfCover`** — Advanced inventory metrics
4. **`velocityTrends`** — Historical velocity analysis
5. **`marginBreakdown`** — Detailed margin components

---

## UX & Clear Paths (Actions)

### Action Framework per SKU

Each SKU row must offer Clear Path actions based on merchant context:

#### 1. Survival Mode Actions:
```typescript
interface SurvivalActions {
  // Primary action for immediate risk
  "Mark for reorder": {
    event: "replenish_suggestion",
    priority: "critical",
    destination: "WMS/ReorderEngine",
    successFeedback: "Reorder request created"
  },
  
  // Secondary actions
  "Pause advertising": {
    event: "pause_marketing",
    priority: "medium",
    destination: "Specter",
    condition: "stockoutRisk > 0.8"
  },
  
  "Adjust pricing": {
    event: "price_review",
    priority: "medium",
    destination: "MarginCore",
    condition: "marginHealth = 'critical'"
  }
}
```

#### 2. Growth Mode Actions:
```typescript
interface GrowthActions {
  "Promote product": {
    event: "create_campaign",
    priority: "high",
    destination: "Specter",
    condition: "healthScore > 70 && velocityTrend > 1.2",
    successFeedback: "Nudge campaign created"
  },
  
  "Bundle with related": {
    event: "create_bundle",
    priority: "medium",
    destination: "ProductEngine",
    condition: "hasRelatedProducts && velocity > 10"
  },
  
  "Cross-sell opportunity": {
    event: "cross_sell_setup",
    priority: "low",
    destination: "RecommendationEngine"
  }
}
```

#### 3. Architect Mode Actions:
```typescript
interface ArchitectActions {
  "Open health config": {
    event: "configure_thresholds",
    priority: "medium",
    destination: "SKU-OS Settings",
    configurable: ["thresholds", "notification_rules", "alert_triggers"]
  },
  
  "Create custom report": {
    event: "custom_report",
    priority: "low",
    destination: "InsightCore",
    parameters: ["dateRange", "metrics", "filters"]
  },
  
  "Set up automation": {
    event: "configure_automation",
    priority: "medium",
    destination: "WorkflowEngine",
    triggers: ["healthScore < 50", "stockoutRisk > 0.7"]
  }
}
```

### Closed-Loop Action System

#### Action Execution Flow:
```
1. Merchant selects action → System emits action event
2. External system processes action → Returns outcome
3. SKU-OS observes outcome → Records SkuHealthChangeEvent
4. System learns from outcome → Adjusts thresholds/triggers
```

#### Outcome Tracking:
```typescript
interface ActionOutcome {
  actionId: string;
  productId: number;
  actionType: string;
  executedAt: Date;
  expectedImpact: string;
  actualImpact: {
    healthScoreChange: number;
    daysToImpact: number;
    success: boolean;
    notes?: string;
  };
  usedForTraining: boolean;
}
```

#### Automated Threshold Tuning:
```typescript
// Example: Auto-adjust thresholds based on action success
function tuneStockoutThreshold(actionHistory: ActionOutcome[]): number {
  const successfulActions = actionHistory.filter(a => a.actualImpact.success);
  const avgDaysToImpact = successfulActions
    .map(a => a.actualImpact.daysToImpact)
    .reduce((a, b) => a + b, 0) / successfulActions.length;
    
  // Adjust threshold based on historical success
  return Math.max(0.5, 0.7 - (avgDaysToImpact / 100));
}
```

### UX Principles for Actions

1. **Clarity:** One primary action per SKU state
2. **Context:** Actions adapt to merchant mode (Survival/Growth/Architect)
3. **Confidence:** Show expected impact and confidence level
4. **Feedback:** Immediate feedback on action execution
5. **Learning:** System improves suggestions based on outcomes
6. **Accessibility:** Keyboard shortcuts and bulk actions

---

## Risks & Open Decisions (Callouts)

### High-Priority Risks

#### 1. **Cost Data Availability**
- **Risk:** `marginHealth` depends on `estimated_unit_cost`. If missing, marginHealth falls to `unknown`
- **Mitigation:**
  - UX to surface "missing cost" notifications
  - Link to OrderNexus task for cost import
  - Fallback to industry benchmarks
- **Decision Needed:** Should we infer margin from price history if cost missing?

#### 2. **Inventory Truth Reliability**
- **Risk:** Stockout forecasts need reliable on-hand + inbound data
- **Mitigation:**
  - Make forecasts optional with graceful fallbacks
  - Confidence scoring reflects data completeness
  - Manual inventory override capability
- **Decision Needed:** How to handle WMS vs manual inventory conflicts?

#### 3. **Contract Locking**
- **Risk:** `ProductHealthAnalyticsEvent` is locked — any change requires contract version update
- **Mitigation:**
  - Thorough testing before contract finalization
  - Versioned APIs with migration paths
  - Deprecation warnings for breaking changes
- **Decision Needed:** Should we add extension points to the contract?

#### 4. **Performance with Large Catalogs**
- **Risk:** Per-product aggregation must be efficient for 10K+ SKUs
- **Mitigation:**
  - Batch processing with progress tracking
  - Optimized indexing on `canonical_order_line_items`
  - Incremental updates instead of full recalculations
- **Decision Needed:** What's the acceptable latency for health score updates?

### Medium-Priority Risks

#### 5. **Data Freshness**
- **Risk:** Stale data leads to inaccurate health scores
- **Mitigation:**
  - Event-driven updates for critical changes
  - Stale data detection and alerts
  - Manual refresh triggers
- **Decision Needed:** How stale is "too stale" for health scoring?

#### 6. **Free Tier Abuse**
- **Risk:** Merchants might game the free tier system
- **Mitigation:**
  - Rate limiting on API calls
  - Anti-gaming detection algorithms
  - Clear upgrade incentives
- **Decision Needed:** Should free tier have usage-based limits?

#### 7. **Action Spam**
- **Risk:** Too many suggested actions overwhelm merchants
- **Mitigation:**
  - Intelligent action prioritization
  - Bulk action capabilities
  - "Snooze" functionality for less urgent items
- **Decision Needed:** Optimal number of suggested actions per day?

### Technical Decisions Required

#### 1. **Scoring Algorithm Precision**
- Should health scores be integers (0-100) or decimals (0.00-100.00)?
- How often should rounding/truncation occur?

#### 2. **Confidence Calculation**
- What specific data points drive confidence levels?
- Should confidence affect the displayed health score?

#### 3. **Historical Data Retention**
- How long to keep historical health scores?
- Should we aggregate or sample old data?

#### 4. **Cross-Shop Analytics**
- Should we compute cross-shop benchmarks?
- How to handle data privacy concerns?

### Business Decisions Required

#### 1. **Monetization Strategy**
- Should premium features be tiered (Basic/Pro/Enterprise)?
- What's the pricing model? Per SKU, per order, or flat fee?

#### 2. **Onboarding Experience**
- Should SKU-OS be opt-in or automatically enabled?
- How much hand-holding during initial setup?

#### 3. **Success Metrics**
- What KPIs define SKU-OS success?
- How to measure ROI for merchants?

### Risk Mitigation Timeline

```
Week 1-2: Address Critical Risks
├── Implement cost data fallback UX
├── Set up inventory data quality monitoring
└── Finalize and test locked contracts

Week 3-4: Address Performance Risks
├── Implement batch processing optimization
├── Set up performance monitoring
└── Create scaling plan for large catalogs

Week 5-6: Address Business Risks
├── Implement free tier abuse prevention
├── Design action prioritization system
└── Define success metrics and tracking
```

---

## Deliverables

### 1. Exact TypeScript Worker
**File:** `apps/backend/src/workers/sku-os-health-scorer.ts`
**Includes:**
- FT0 health score calculation logic
- Event emission to InsightCore
- Batch processing with error handling
- Comprehensive unit tests
- Configuration management

### 2. Readiness Provider Patch
**File:** `apps/backend/src/onboarding/readiness.providers.ts`
**Includes:**
- Accurate `sku-os.productHealthEvents` calculation
- `lastProductHealthEventAt` timestamp
- Free tier state integration
- Test coverage for all signals

### 3. SQL Diagnostics Script
**File:** `scripts/diagnostics/sku-os-health-check.sql`
**Includes:**
- Velocity calculation verification
- Sample health score generation
- Top risk SKU identification
- Data quality assessment queries

### 4. Frontend Widget Spec
**File:** `ui/components/SKUHealthWidget/Spec.md`
**Includes:**
- Component props interface
- Sample mock data structure
- Responsive design requirements
- Free tier gating implementation
- Action integration patterns

### Additional Deliverables

#### 5. API Documentation
- OpenAPI/Swagger specification
- Authentication requirements
- Rate limiting documentation
- Error code reference

#### 6. Monitoring Dashboard
- Health score distribution charts
- Data freshness indicators
- Action success rate tracking
- Performance metrics display

#### 7. Merchant Documentation
- Getting started guide
- Health score interpretation
- Action recommendation guide
- Troubleshooting common issues

#### 8. Integration Test Suite
- End-to-end test scenarios
- Performance benchmark tests
- Data consistency validation
- Rollback procedure verification

---

**End of Document Series for First File**