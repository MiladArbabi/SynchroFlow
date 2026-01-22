# `03-ft1-implementation-spec.md`

## FT1 (First Expansion — High Value)

### Goal
Make SKU-OS actionable — enable playbooks, alerts, and finer signals.

---

### FT1 Scope

#### 1. Enhanced Health Model
* **Seasonality & Time-Series Analysis:**
  * Implement velocity smoothing across multiple windows (7/30/90 days)
  * Apply time-series analysis for demand patterns and seasonality detection
* **Inventory Intelligence:**
  * Incorporate inventory lead times (if WMS or vendor receipts available)
  * Use inbound receipt data to compute projected stockout dates
  * Implement product health decay and SKU age tracking
* **Advanced Risk Detection:**
  * Add `degradationReason` tags per product:
    * `low_velocity`
    * `high_return_rate`
    * `low_margin`
    * `supply_delay`
    * `quality_issues`
    * `seasonal_dip`

#### 2. Playbooks & Quick Actions
* **Replenishment Workflow:**
  * "Create replenish suggestion" — direct integration with WMS / Reorder engine
  * Automated reorder quantity suggestions based on forecast and lead time
* **Margin Optimization:**
  * "Flag product for price review" — integration with Price recommendations or MarginCore
  * Margin erosion alerts and optimization suggestions
* **Alert System:**
  * "Create product health alert" — customizable notification system
  * Threshold-based alerts for health score changes

#### 3. Enhanced UI Widgets
* **Product Health Dashboard:**
  * Product Health time series visualization (trend analysis)
  * Stockout forecast table with projected dates
  * Margin Health distribution charts
  * Health map (grid view) with advanced filtering capabilities
* **Interactive Components:**
  * Drill-down capabilities for each SKU
  * Historical comparison views
  * Export functionality for reports

#### 4. Advanced Eventing System
* **Threshold-Based Events:**
  * Emit `SkuHealthChangeEvent` when `healthScore` crosses critical thresholds (≤50)
  * Configurable threshold levels for different risk categories
* **Problem Center Integration:**
  * Automatic creation of Problem Center tickets for persistent issues
  * Correlation between product health and operational issues
  * Resolution tracking and impact measurement

#### 5. Tier-Based Feature Access
* **Free Tier Limitations:**
  * Limited to critical SKU list (top 10-20 at-risk products)
  * 7-day velocity window only
  * Basic health scoring without forecasts
* **Paid Features:**
  * Full product list access
  * Advanced forecasting capabilities
  * Playbooks and automated actions
  * Extended historical data (90+ days)
  * Customizable alert rules
  * Export capabilities and API access

#### 6. Performance & Scalability
* **Batch Processing Optimization:**
  * Efficient recalculation for large product catalogs
  * Incremental updates for real-time data changes
* **Caching Strategy:**
  * Implement caching layer for frequently accessed health scores
  * Stale data detection and automatic refresh

#### 7. Integration Points
* **WMS Integration:**
  * Real-time inventory level synchronization
  * Receipt and shipment tracking for stockout prediction
* **Reorder Engine Integration:**
  * Direct API calls for replenishment suggestions
  * Purchase order tracking and impact analysis
* **Notification System:**
  * Integration with existing notification infrastructure
  * Multi-channel alerts (in-app, email, mobile)

#### 8. Analytics Enhancement
* **Advanced Metrics:**
  * Product lifecycle stage identification (new, growth, mature, decline)
  * Contribution margin analysis
  * Turnover rate optimization suggestions
* **Predictive Analytics:**
  * Stockout probability scoring
  * Margin erosion early warning system
  * Return rate trend analysis

---

### Technical Considerations

#### Data Requirements
* **Enhanced Data Sources:**
  * WMS inventory data (real-time stock levels)
  * Vendor lead time information
  * Historical weather/seasonal data (optional)
  * Promotional calendar integration

#### Implementation Complexity
* **Medium-High Complexity:**
  * Requires integration with multiple external systems
  * Advanced statistical models for forecasting
  * Real-time data processing pipelines
  * Complex UI/UX for advanced features

#### Success Metrics for FT1
* **Adoption Metrics:**
  * Percentage of merchants using playbooks
  * Alert creation and resolution rates
  * Widget engagement metrics
* **Business Impact:**
  * Reduction in stockout occurrences
  * Improvement in margin health scores
  * Decrease in time-to-action for at-risk SKUs

---