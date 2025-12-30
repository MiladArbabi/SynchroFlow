# `06-patch-plan-execution.md`

## Patch Plan — Prioritized (Patch by Patch, Small → Large)

### Overview
This patch plan outlines a phased implementation approach for SKU-OS, moving from quick wins to comprehensive features. Each patch builds upon the previous, ensuring stability and incremental value delivery.

---

### Patch 0 — Readiness Signal Hardening (Quick Win)

#### Objective
Make `skuOs.productHealthEvents` reflect actual events & add `lastProductHealthEventAt`. Prevent readiness endpoint false negatives.

#### Why It's Important
Onboarding must be honest about SKU-OS readiness. Current stub implementation gives false positives.

#### Technical Scope
- **Files to Modify:** `apps/backend/src/onboarding/readiness.providers.ts`
- **Database Queries:**
  ```sql
  -- Count actual product health events
  SELECT COUNT(DISTINCT product_id) 
  FROM fact_product_health 
  WHERE shop_id = :shopId 
    AND recalculated_at >= NOW() - INTERVAL '7 days';
  
  -- Get last event timestamp
  SELECT MAX(recalculated_at)
  FROM fact_product_health 
  WHERE shop_id = :shopId;
  ```

#### Implementation Steps
1. Update `skuOs.productHealthEvents` to query `fact_product_health` table
2. Add `skuOs.lastProductHealthEventAt` timestamp field
3. Update provider logic to handle missing data gracefully
4. Add test coverage for new signals

#### Success Criteria
- `skuOs.productHealthEvents` returns actual event count, not product count
- `lastProductHealthEventAt` accurately reflects most recent health calculation
- Onboarding tasks show correct completion status

#### Estimated Effort: 1-2 days

---

### Patch 1 — FT0 Scoring Job (Urgent)

#### Objective
Implement a scheduled job (daily) that calculates health scores for all products and emits `ProductHealthAnalyticsEvent`.

#### Why It's Important
Provides the data InsightCore & UI expect. Foundation for all SKU-OS functionality.

#### Technical Scope
- **New Worker:** `apps/backend/src/workers/sku-os-health-scorer.ts`
- **Schedule:** Daily, configurable via cron
- **Processing Logic:**
  1. Aggregate last 30d sales velocity per product
  2. Compute healthScore using weighted combination
  3. Emit events for each product (or top N for free tier)

#### Implementation Steps
1. Create scoring worker with batch processing capabilities
2. Implement velocity calculation from `canonical_order_line_items`
3. Develop health scoring algorithm:
   ```text
   healthScore = clamp(
     100 * (
       0.5 * norm_daysOfCover + 
       0.3 * norm_margin + 
       0.2 * norm_velocity
     ), 0, 100
   )
   ```
4. Add event emission to message bus
5. Implement error handling and retry logic
6. Add logging and monitoring

#### Success Criteria
- Daily job runs successfully
- All products receive health scores
- Events are properly emitted
- Performance: <5 minutes for 10,000 SKUs

#### Estimated Effort: 3-5 days

---

### Patch 2 — Emit to InsightCore (FT0 Integration)

#### Objective
Hook scoring job to send `ProductHealthAnalyticsEvent` to InsightCore ingestion endpoint.

#### Why It's Important
InsightCore requires these events for dashboards and cross-module analytics.

#### Technical Scope
- **Producer:** SKU-OS event emitter
- **Consumer:** InsightCore ingestion endpoint (exists in InsightCore blueprint)
- **Integration:** Message bus or direct API call

#### Implementation Steps
1. Configure event routing to InsightCore
2. Implement event validation and schema enforcement
3. Add delivery confirmation and retry logic
4. Set up monitoring for event delivery success/failure
5. Create fallback mechanisms for InsightCore downtime

#### Success Criteria
- Events successfully delivered to InsightCore
- `fact_product_health` table populated
- End-to-end latency < 5 minutes
- 99.9% delivery success rate

#### Estimated Effort: 2-3 days

---

### Patch 3 — UI Widget & Gating (FT0 UI)

#### Objective
Implement frontend widget showing Top-10 At-Risk SKUs with proper free-tier gating.

#### Why It's Important
Merchant "aha" moment and value demonstration.

#### Technical Scope
- **Frontend Component:** Top-10 At-Risk SKUs widget
- **API Endpoint:** `/api/sku-os/at-risk-products`
- **Free Tier Logic:** Limit to 10 SKUs for free tier
- **Onboarding Integration:** Update onboarding manifest

#### Implementation Steps
1. Create React component for at-risk SKU display
2. Implement API endpoint with pagination and filtering
3. Add free-tier gating logic:
   ```typescript
   const visibleSKUs = isFreeTier ? 
     atRiskSKUs.slice(0, 10) : 
     atRiskSKUs;
   ```
4. Integrate with onboarding task completion
5. Add loading states and error handling
6. Implement responsive design for all screen sizes

#### Success Criteria
- Widget displays correctly in dashboard
- Free tier restrictions properly enforced
- Onboarding task completes when conditions met
- Performance: < 2s load time

#### Estimated Effort: 3-4 days

---

### Patch 4 — FT1 Scoring & Forecasting

#### Objective
Implement advanced forecasting using lead time & receipts; add degradation reasons and Problem Center integration.

#### Why It's Important
Makes SKU-OS actionable and revenue impacting.

#### Technical Scope
- **Advanced Models:** Seasonality, time-series smoothing
- **Forecasting:** Stockout dates, demand projections
- **Degradation Reasons:** Tag-based issue classification
- **Problem Center Integration:** Automated ticket creation

#### Implementation Steps
1. Enhance scoring algorithm with:
   - 7/30/90 day velocity windows
   - Seasonality detection
   - Lead time integration
2. Implement stockout forecasting:
   ```sql
   projected_stockout_date = current_date + 
     (on_hand_inventory / avg_daily_velocity) - 
     lead_time_days
   ```
3. Add degradation reason tagging system
4. Integrate with Problem Center API for issue tracking
5. Create playbook generation system
6. Add advanced filtering and sorting capabilities

#### Success Criteria
- Accurate stockout forecasts
- Meaningful degradation reasons
- Seamless Problem Center integration
- Performance maintained with new features

#### Estimated Effort: 5-7 days

---

### Patch 5 — Alerts, Webhooks, and Exports

#### Objective
Implement alerting system, webhook integrations, and enhanced export capabilities.

#### Why It's Important
Monetization and retention through advanced features.

#### Technical Scope
- **Alert System:** Configurable health score thresholds
- **Webhooks:** External system integration
- **Export:** CSV, API, bulk data access
- **Advanced Dashboards:** Customizable views

#### Implementation Steps
1. Design and implement alert rule engine
2. Create webhook management interface
3. Build export functionality:
   ```typescript
   exportSKUHealth({
     format: 'csv' | 'json',
     filters: {...},
     dateRange: {...}
   })
   ```
4. Develop advanced dashboard widgets
5. Implement role-based access control
6. Add audit logging for all actions

#### Success Criteria
- Alerts trigger correctly based on configurable rules
- Webhooks deliver data to external systems
- Export functionality works for large datasets
- Performance maintained with concurrent users

#### Estimated Effort: 4-6 days

---

### Patch Dependencies & Sequencing

```
Week 1: Patch 0 + Patch 1 (Foundation)
├─┬ Patch 0: Readiness Signals (2 days)
└─┬ Patch 1: Scoring Job (5 days)

Week 2: Patch 2 + Patch 3 (Integration)
├─┬ Patch 2: InsightCore (3 days)
└─┬ Patch 3: UI Widget (4 days)

Week 3-4: Patch 4 (Advanced Features)
└─┬ Patch 4: FT1 Scoring (7 days)

Week 5: Patch 5 (Enterprise Features)
└─┬ Patch 5: Alerts & Exports (6 days)
```

### Risk Mitigation

#### Technical Risks
1. **Performance with Large Catalogs:**
   - Mitigation: Implement batch processing and indexing
   - Fallback: Progressive loading and pagination

2. **Data Consistency:**
   - Mitigation: Transactional updates and retry logic
   - Fallback: Manual recalculation triggers

3. **Integration Failures:**
   - Mitigation: Circuit breaker pattern and fallback APIs
   - Fallback: Offline mode with local caching

#### Business Risks
1. **Adoption Risk:**
   - Mitigation: Clear onboarding and value demonstration
   - Measurement: Track widget engagement and task completion

2. **Accuracy Concerns:**
   - Mitigation: Transparent confidence scoring
   - Feedback: Merchant override and adjustment capabilities

### Success Metrics by Patch

| Patch | Key Metrics | Target |
|-------|------------|--------|
| 0 | Readiness signal accuracy | 100% |
| 1 | Daily job success rate | >99% |
| 2 | Event delivery success | 99.9% |
| 3 | Widget engagement | >60% of merchants |
| 4 | Forecast accuracy | >85% within 7 days |
| 5 | Alert creation rate | >40% of at-risk SKUs |

### Rollback Plan

Each patch includes:
1. Database migration rollback scripts
2. Feature flag toggles
3. Data preservation strategies
4. Gradual rollout (10% → 50% → 100% of merchants)

### Post-Patch Validation

After each patch deployment:
1. **Automated Tests:** Run full test suite
2. **Smoke Tests:** Verify core functionality
3. **Performance Tests:** Ensure no regression
4. **User Acceptance:** Monitor error rates and user feedback
5. **Business Metrics:** Track impact on key KPIs

---