Here's the updated roadmap reflecting our new implementation strategy:

```markdown
# ACI Platform Roadmap & Task Tracker (v2.5)
**Vision:** Evolve from a passive dashboard into an active, "Digital Chief of Staff."
**Source of Truth:** [ACI Comprehensive Blueprint](./BLUEPRINT.md)
**Log of Achievements:** [CHANGELOG](../CHANGELOG.md)

---

## 🎯 Strategic Implementation Strategy

### **Phase 1: Immediate Stabilization (This Week)**
**Focus:** Robust PLG SaaS Foundation with Tiered Onboarding
- **Database Architecture Restructuring** - Separate platform users from store customers
- **Tiered Onboarding Experience** - Provide immediate value regardless of PCD status  
- **Customer Resolution Service** - Unified customer identity across platforms

### **Phase 2: Customer Intelligence (Next 2 Weeks)**
**Focus:** Complete Data Distribution & Cross-Entity Analytics
- **Customers API Implementation** - Real customer data pipeline
- **Products API Enhancement** - Complete products data distribution
- **Cross-Entity Relationships** - Orders ↔ Customers ↔ Products intelligence

### **Phase 3: Multi-Platform Scalability (Month 2)**
**Focus:** Platform Abstraction & Advanced Intelligence
- **Platform Abstraction Layer** - Shopify, WooCommerce, Amazon adapters
- **Unified Data Model** - Cross-platform customer resolution
- **Advanced Intelligence** - Predictive analytics across platforms

---

## Progress Summary
- **Phases:** 6 + **Phase 1.5 Bridge** (ACTIVE)
- **Total Issues Logged:** 62 → **48** (corrected to actual issue count)
- **Completed:** 22/48 (46%) - **UPDATED: Orders API Complete**
- **Blocked:** 0/48 (0%) - **UPDATED: PCD Access Resolved**
- **Remaining:** 26/48 (54%)

---

## 🎯 Definition of Done (The "4 C's")
No feature is "done" until it is verifiable against the [ACI Blueprint's "4 C's" framework](BLUEPRINT.md#4-operational-framework-the-4-cs-litmus-test).
1.  **Context:** Is the mode-specific question answered in < 3s?
2.  **Causation:** Does it explain "why" (not just "what")?
3.  **Clear Path Forward:** Does it have a `CoachTrigger`, `AutomationTrigger`, etc.?
4.  **Closed Loop:** Does the system learn from the user's interaction?
**Free Tier Compliance:** Does it demonstrate clear upgrade value through strategic teasers?

---

## Phase 1: Foundation (Survival Mode) - ✅ COMPLETED
**Focus:** Perfect the "Survival Mode" Intelligence Layer.
**Key Deliverable:** Best-in-class free dashboard that meets the 4 C's standard.

### ✅ Phase 1 Completed (**21 Issues**) 🎉
*All previous Phase 1 issues completed*

---

## 🚧 Phase 1.5: Robust PLG SaaS Foundation (CURRENT FOCUS)
**Focus:** Database restructuring, tiered onboarding, and customer resolution for multi-platform scalability.
**Key Deliverable:** Robust foundation that provides immediate value regardless of PCD status.
**Strategic Impact:** Transform from dashboard to indispensable commerce operations platform.

### ✅ Phase 1.5 Completed
| ID | Task | Status | Details |
| --- | --- | --- | --- |
| **#804** | **[Epic]** Phase 1.5: Core Data Distribution | ✅ **COMPLETED** | Orders API foundation built |
| **#805** | Build `/api/v1/orders` pipeline | ✅ **COMPLETED** | Real orders data flowing |
| **#819** | Implement Smart Sync Orchestrator | ✅ **COMPLETED** | PCD fallback strategy working |
| **#820** | Build Shopify Fallback Service | ✅ **COMPLETED** | Non-PCD sync operational |

### 🔄 Phase 1.5 Active Implementation
| ID | Task | Status | Timeline |
| --- | --- | --- | --- |
| **#821** | **[P1]** Database Restructuring: Customer Relationships | 🎯 **IMMEDIATE** | Fix customer_id constraints, add platform_customer_id |
| **#822** | **[P1]** Implement Tiered Onboarding Service | 🎯 **IMMEDIATE** | PCD_APPROVED, PCD_PENDING, BASIC_ACCESS tiers |
| **#823** | **[P1]** Build Customer Resolution Service | 🎯 **IMMEDIATE** | Map platform customers to internal records |
| **#806** | Build `/api/v1/customers` pipeline | 🎯 **WEEK 2** | Builds on customer resolution foundation |
| **#807** | Build `/api/v1/products` pipeline | 🎯 **WEEK 2** | Enhanced products data distribution |
| **#824** | **[NEW]** Implement Cross-Entity Analytics | 🎯 **WEEK 2** | Orders ↔ Customers ↔ Products intelligence |

### ⏳ Phase 1.5 Backlog (Strategic Enhancements)
| ID | Task | Status | Strategic Value |
| --- | --- | --- | --- |
| **#809** | Implement Confidence Indicators | ⏳ **PENDING** | Build trust with accuracy scoring |
| **#810** | Implement Free-Tier Action Hierarchy | ⏳ **PENDING** | Learn → Simulate → Tease Execute |
| **#811** | Add Viral Sharing Features | ⏳ **PENDING** | Share insights, referral bonuses |
| **#812** | Implement Strategic TeaserTriggers | ⏳ **PENDING** | Blurred conversion rates, growth features |
| **#813** | Enhance Starter Widgets with GA4-Beating Simplicity | ⏳ **PENDING** | Comparators, one-click explanations |
| **#814** | Add Free Tier Metrics Dashboard | ⏳ **PENDING** | Track activation, conversion, viral coefficient |

---

## Phase 2: Growth Engine (Spark Plan) - ON HOLD
**Focus:** Launch "Growth Mode" Intelligence Layer.
**Status:** ⏳ **AWAITING PHASE 1.5 COMPLETION**
*All Phase 2 tasks remain in backlog until robust foundation is established*

---

## Phase 3: Platform Expansion (Ignition Plan) - ON HOLD  
**Focus:** Launch "Architect Mode" with WMS-lite.
**Status:** ⏳ **AWAITING PHASE 1.5 COMPLETION**

---

## Phase 4: Enterprise Scale (Clarity Plan) - ON HOLD
**Focus:** Launch Echo Hub & Governance Layer.
**Status:** ⏳ **AWAITING PHASE 1.5 COMPLETION**

---

## 🛡️ Strategic Defense Layers Being Built

### **Technical Moats (Phase 1.5)**
1. **Unified Customer Intelligence** - Cross-platform customer views
2. **Multi-Platform Data Normalization** - Single source of truth
3. **Adaptive Onboarding** - Works immediately regardless of platform restrictions
4. **Real-time Sync Architecture** - Continuous data flow with graceful degradation

### **Business Moats (Phase 1.5)**
1. **PLG Funnel** - Free tier → Growth → Enterprise natural progression
2. **Multi-Platform Stickiness** - Integrated across channels = high switching cost
3. **Data Network Effects** - More platforms → Better insights → More value
4. **Workflow Embedding** - Deep operational integration creates dependency

---

## 📊 Success Metrics for Phase 1.5 Completion

- ✅ **Orders API serving real data**: COMPLETE
- 🔄 **Database restructuring**: IN PROGRESS (#821)
- 🔄 **Tiered onboarding**: IN PROGRESS (#822) 
- 🔄 **Customer resolution**: IN PROGRESS (#823)
- ⏳ **Customers API**: PENDING (#806)
- ⏳ **Products API enhancement**: PENDING (#807)
- ⏳ **Cross-entity analytics**: PENDING (#824)

---

## 🎯 Enhanced Success Metrics for PLG SaaS

### **Free Tier Health Dashboard**
```typescript
interface FreeTierMetrics {
  activationRate: number; // >40% using weekly
  timeToTrust: number; // <14 days target  
  insightAcceptanceRate: number; // >40% excellent
  viralCoefficient: number; // >0.5 target
  freeToPaidConversion: number; // 25% target in 90 days
  competitiveWinRate: number; // % switching from GA4/Shopify Analytics
  multiPlatformAdoption: number; // % users connecting multiple sales channels
}
```

### **Technical Foundation Metrics**
```typescript
interface TechnicalMetrics {
  pcdApprovalRate: number; // % successful PCD access
  syncSuccessRate: number; // % successful data syncs
  customerResolutionRate: number; // % platform customers matched
  crossPlatformAdoption: number; // % using multiple platforms
}
```

---

## 🔄 Updated E2E Testing Strategy - Phase 1.5 Focus

### **Immediate Testing Priorities**
- **Database Migration Tests** - Customer relationship restructuring
- **Tiered Onboarding Flows** - PCD_APPROVED vs PCD_PENDING experiences  
- **Customer Resolution Scenarios** - Platform customer matching logic
- **Multi-Platform Sync** - Cross-platform data normalization

### **Enhanced Test Coverage**
- **Free Tier Value Delivery** - Immediate ROI regardless of PCD status
- **Upgrade Pathway Testing** - Seamless transitions between tiers
- **Error Resilience** - Graceful handling of platform restrictions
- **Data Integrity** - Cross-entity relationship validation

---

**Updated Strategy**: We're building a robust PLG SaaS foundation that provides immediate value while creating strategic moats through multi-platform integration and adaptive onboarding.

**Next Immediate Actions**: Database restructuring (#821) → Tiered onboarding (#822) → Customer resolution (#823)
```

Key changes in this updated roadmap:

1. **Clear Strategic Phases** - Immediate stabilization → Customer intelligence → Multi-platform scalability
2. **Updated Progress** - Orders API marked complete, PCD access resolved
3. **New Priority Tasks** - Database restructuring, tiered onboarding, customer resolution
4. **Strategic Defense Layers** - Technical and business moats being built
5. **Enhanced Metrics** - PLG-focused success metrics
6. **Updated Testing Strategy** - Focus on new implementation priorities

This roadmap now reflects our shift from "quick fixes" to building a robust, scalable PLG SaaS foundation that can grow with our customers across multiple platforms.