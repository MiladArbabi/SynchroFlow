# ACI Platform Roadmap & Task Tracker (v2.4)
**Vision:** Evolve from a passive dashboard into an active, "Digital Chief of Staff."
**Source of Truth:** [ACI Comprehensive Blueprint](./BLUEPRINT.md)
**Log of Achievements:** [CHANGELOG](../CHANGELOG.md)

---

## Progress Summary
- **Phases:** 6 + **Phase 1.5 Bridge** (ACTIVE)
- **Total Issues Logged:** 62 → **48** (corrected to actual issue count)
- **Completed:** 20/48 (42%)
- **Blocked:** 1/48 (2%)
- **Remaining:** 27/48 (56%)

---

## 🎯 Definition of Done (The "4 C's")
No feature is "done" until it is verifiable against the [ACI Blueprint's "4 C's" framework](BLUEPRINT.md#4-operational-framework-the-4-cs-litmus-test).
1.  **Context:** Is the mode-specific question answered in < 3s?
2.  **Causation:** Does it explain "why" (not just "what")?
3.  **Clear Path Forward:** Does it have a `CoachTrigger`, `AutomationTrigger`, etc.?
4.  **Closed Loop:** Does the system learn from the user's interaction?
**Free Tier Compliance:** Does it demonstrate clear upgrade value through strategic teasers?

---

## Phase 1: Foundation (Survival Mode)
**Focus:** Perfect the "Survival Mode" Intelligence Layer.
**Key Deliverable:** Best-in-class free dashboard that meets the 4 C's standard.
**Enhanced Deliverable:** Market-dominating free analytics with GA4-beating simplicity

### ✅ Phase 1 Completed (**21 Issues**) 🎉
* **#616:** Flaky E2E Authentication
* **#790:** SalesByTrafficSourceWidget retrofitted to 4 C's framework - All 5 starter widgets now meet the 4 C's standard (Context, Causation, Clear Path Forward, Closed Loop)"
* **#789:** Build Feedback Processing System (v1) 
* **#788:** Build `CoachTrigger` Component|
* **#787:** Build `BaseTrigger` Component
* **#727:** Verify database migrations and seed data
* **#728:** Test API endpoints return expected data shapes
* **#729:** Confirm authentication flow works end-to-end
* **#730:** Validate environment variables and configuration
* **#731:** Write critical path E2E test (Dashboard Happy Path) ✅ **COMPLETED**
* **#732:** Verify widget loading states (skeletons) ✅ **COMPLETED**
* **#733:** Test API error scenarios and error boundaries ✅ **COMPLETED**
* **#734:** Confirm emotional status borders change appropriately
* **#736:** Test EnhancedWidgetShell with real API data
* **#737:** Test Loading State Layout Stability ✅ **COMPLETED**
* **#749:** Implement MVP User State System
* **#762:** Implement Cost-Effective Widget Registry System
* **#763:** Build 5 Starter Plan widgets (Data/Context Layer)
* **#769:** Resolve C++ Dependency & Shopify Scopes
* **(#706):** EPIC-002: Core Visual & Technical Foundation
* **(#707):** EPIC-003: 'Survival Tier' (Phase 1)
* **(#705):** EPIC-001: The 'First-Mile' (Day 1-7)

### 🎯 E2E Testing Strategy - Phase 1 Focus

#### ✅ **CORE TESTS STABLE - 19/19 TESTS PASSING**
- **Authentication Flow** (`auth.spec.ts`, `auth.setup.spec.ts`) - Fully operational
- **Dashboard Widget Loading** - Core functionality verified
- **Critical Path Coverage** - Main user journeys tested
- **Loading State Tests** - Skeleton screens, error boundaries ✅ **COMPLETED**
- **Layout Stability** - Prevent layout shifts during loading ✅ **COMPLETED**

#### ✅ **WEEK 1 COMPLETED**
| ID | Task | Status | Timeline |
| --- | --- | --- | --- |
| **#732** | **[P1]** Add Widget Loading State Tests | ✅ **COMPLETED** | Skeleton screens, error boundaries |
| **#737** | **[P1]** Test Loading State Layout Stability | ✅ **COMPLETED** | Prevent layout shifts during loading |

#### ⚡ **MEDIUM PRIORITY - WEEK 2**
| ID | Task | Status | Timeline |
| --- | --- | --- | --- |
| **#735** | **[P2]** Test Widget Responsive Behavior | 🎯 **WEEK 2** | Mobile, tablet, desktop layouts |
| **#739** | **[P2]** Test Multiple Widget Rendering | 🎯 **WEEK 2** | All 5 starter widgets simultaneously |
| **#738** | **[P2]** Verify No Console Errors | 🎯 **WEEK 2** | Browser error monitoring |

#### 📋 **LOW PRIORITY - WEEK 3**
| ID | Task | Status | Timeline |
| --- | --- | --- | --- |
| **#740** | **[P3]** Test Store Connection Error States | 🎯 **WEEK 3** | Connection failure scenarios |
| **#772** | **[P3]** Enhance ConnectionErrorModal Tests | 🎯 **WEEK 3** | Modal interaction flows |
| **#773** | **[P3]** Test Pre-flight Validation | 🎯 **WEEK 3** | Store name validation |

### ⏳ Phase 1 Backlog (Pending)
| ID | Task | Status | Details |
| --- | --- | --- | --- |
| **#771** | **[P1]** Implement OAuth 'SadPath' | ⛔️ **BLOCKED** | (Shopify platform limitation) |
| **#764** | **[P2]** Extract UI Template Components | ⏳ **PENDING** | (Legacy P2) |
| **#765** | **[P2]** Implement Progressive Data Processing | ⏳ **PENDING** | (Legacy P2) |
| **#668** | **[P2]** Create 'Get Help' documentation | ⏳ **PENDING** | (Legacy P2) |
| **#741** | **[P3]** Test back button and navigation flows | ⏳ **PENDING** | (Legacy P3) |
| **#742** | **[P3]** Test complete onboarding flow | ⏳ **PENDING** | (Review & update existing test) |
| **#743** | **[P3]** Run full test suite and check coverage | ⏳ **PENDING** | (Legacy P3) |
| **#744** | **[P3]** Verify tests catch breaking changes | ⏳ **PENDING** | (Legacy P3) |
| **#745** | **[P3]** Confirm CI pipeline runs tests on PRs | ⏳ **PENDING** | (Legacy P3) |
| **#774** | **[P3]** Handle Advanced API Errors | ⏳ **PENDING** | (Legacy P3) |
| **#746** | **[P4]** Build Day 2 "First Aha!" interception modal | ⏳ **PENDING** | (Legacy P4) |
| **#747** | **[P4]** Build Day 3 "First Win" magic button flow | ⏳ **PENDING** | (Legacy P4) |
| **#766** | **[P4]** Implement Sandbox Experience for New Users | ⏳ **PENDING** | (Legacy P4) |
| **#775** | **[P4]** Implement 'Find My Stores' (Google) | ⏳ **PENDING** | (Legacy P4) |

---

## 🚧 Phase 1.5: Data Distribution & Free Tier Enhancement (CURRENT FOCUS)
**Focus:** Activate the "Muscle" (Operations Layer). Ensure Sidenav pages (Orders, Customers, etc.) receive real data.
**Key Deliverable:** Fully functional list and detail views for core commerce entities.
**Enhanced Focus:** Bridge Intelligence Layer to Operations Layer with market-dominating free features
**Business Impact:** Transform free plan from dashboard-only to comprehensive operational intelligence

| ID | Task | Status | Details |
| --- | --- | --- | --- |
| **#804** | **[Epic]** Phase 1.5: Core Data Distribution | ⏳ **PENDING** | **[Current Goal]** |
| **#805** | Build `/api/v1/orders` pipeline | ⏳ **PENDING** | For OrdersPage/Order360 |
| **#806** | Build `/api/v1/customers` pipeline | ⏳ **PENDING** | **[Next Up]** For CustomersPage |
| **#807** | Build `/api/v1/products` pipeline | ⏳ **PENDING** | For ProductsPage |
| **#808** | Build Echo Hub data pipeline | ⏳ **PENDING** | For Echo Hub |
**#809** | **[NEW]** Implement Confidence Indicators in Free Tier | ⏳ **PENDING** | Build trust with accuracy scoring |
**#810** | **[NEW]** Implement Free-Tier Action Hierarchy | ⏳ **PENDING** | Learn (full) → Simulate (limited) → Tease Execute |
**#811** | **[NEW]** Add Viral Sharing Features | ⏳ **PENDING** | Share insights, referral bonuses |
**#812** | **[NEW]** Implement Strategic TeaserTriggers | ⏳ **PENDING** | Blurred conversion rates, growth features |
**#813** | **[NEW]** Enhance Starter Widgets with GA4-Beating Simplicity | ⏳ **PENDING** | Comparators, one-click explanations |
**#814** | **[NEW]** Add Free Tier Metrics Dashboard | ⏳ **PENDING** | Track activation, conversion, viral coefficient |

---

## Phase 2: Growth Engine (Spark Plan)
**Focus:** Launch "Growth Mode" Intelligence Layer.
**Key Deliverable:** $99/month conversion-focused plan.
**Enhanced Foundation:** Now builds on complete Phase 1.5 data distribution
**Conversion Advantage:** Leverages proven free tier engagement for higher conversion rates

### ⏳ Phase 2 Backlog (Pending)
| ID | Task | Status | Details |
| --- | --- | --- | --- |
| **#791** | Build `TeaserTrigger` Component | ⏳ **BACKLOG** | (Blueprint 5.2) |
| **#792** | Build Interactive Simulators (L2) | ⏳ **BACKLOG** | (Blueprint 2.1, 4.3) |
| **#793** | Build `ConversionTrackerWidget` (4 C's) | ⏳ **BACKLOG** | (Re-scopes #767) |
| **#794** | Build `AOVWidget` & `CLVWidget` (4 C's) | ⏳ **BACKLOG** | (Re-scopes #767) |
**#815** | **[NEW]** Enhanced Conversion Analytics | ⏳ **BACKLOG** | Builds on Phase 1.5 customer/order data |
**#816** | **[NEW]** Advanced Personalization Features | ⏳ **BACKLOG** | Leverages free tier learning data |
**#809** | Refactor: Move Widget Insight Logic to Backend API | ⏳ **PENDING** | (Phase 2 prep) |
| **(#708)**| EPIC-004: 'Growth Tier' (Phase 2) | ⏳ **BACKLOG** | (Legacy Epic) |

#### 🔮 **E2E Testing Strategy - Phase 2 Focus**
- **Paid Feature Gates** - Spark plan conversion flows
- **Interactive Simulators** - L2 simulation interactions
- **Advanced Widget Testing** - ConversionTracker, AOV, CLV widgets
- **Enhanced Testing:** Now includes testing upgrade flows from enhanced free tier

---

## Phase 3: Platform Expansion (Ignition Plan)
**Focus:** Launch "Architect Mode" with WMS-lite (Operations Layer L2).
**Key Deliverable:** $349/month "spreadsheet replacement."
**Data Advantage:** Now builds on complete operational data foundation from Phase 1.5
**Trust Advantage:** Leverages free tier confidence indicators and user trust

### ⏳ Phase 3 Backlog (Pending)
| ID | Task | Status | Details |
| --- | --- | --- | --- |
| **#795** | Build `ProfitMarginTrackerWidget` (4 C's) | ⏳ **BACKLOG** | (Blueprint 8.1) |
| **#796** | Build WMS-lite (PO, Receiving, Pick Lists) | ⏳ **BACKLOG** | (Operations Layer L2) |
| **#797** | Build `AutomationTrigger` Component | ⏳ **BACKLOG** | (Blueprint 5.2) |
| **#748** | Build `GMROIWidget` (4 C's) | ⏳ **BACKLOG** | (Legacy P4, re-scoped) |
**#817** | **[NEW]** Enhanced WMS-lite Integration | ⏳ **BACKLOG** | Builds on Phase 1.5 product/inventory data |
| **(#709)**| EPIC-005: 'Architect Tier' (Phase 3) | ⏳ **BACKLOG** | (Legacy Epic) |

#### 🔮 **E2E Testing Strategy - Phase 3 Focus**
- **WMS-lite Operations** - PO, Receiving, Pick List flows
- **Automation Triggers** - Workflow automation testing
- **Advanced Analytics** - GMROI, Profit Margin widgets

---

## Phase 4: Enterprise Scale (Clarity Plan)
**Focus:** Launch Echo Hub (L2) & Governance Layer (L4).
**Key Deliverable:** $799/month "frankenstack consolidation."
**Adoption Advantage:** Free tier viral features create enterprise awareness
**Trust Foundation:** Governance builds on free tier confidence indicators

### ⏳ Phase 4 Backlog (Pending)
| ID | Task | Status | Details |
| --- | --- | --- | --- |
| **#798** | Build Echo Hub (Team Orchestration) | ⏳ **BACKLOG** | (Operations Layer L2) |
| **#799** | Build `OrchestrationTrigger` Component | ⏳ **BACKLOG** | (Blueprint 5.2) |
| **#800** | Build `ApprovalTrigger` Component | ⏳ **BACKLOG** | (Blueprint 5.3) |
| **#801** | Build `ConfidenceIndicator` Component | ⏳ **BACKLOG** | (Blueprint 5.3) |
| **#818** | **[NEW]** Enhanced Enterprise Features | ⏳ **BACKLOG** | Builds on viral free tier network effects |

#### 🔮 **E2E Testing Strategy - Phase 4 Focus**
- **Team Orchestration** - Echo Hub collaboration flows
- **Governance Layer** - Approval workflows, confidence indicators
- **Enterprise Integration** - Multi-user, permission testing

---

## 🎯 New Success Metrics for Enhanced Free Tier
 
 ### **Free Tier Health Dashboard**
 ```typescript
 interface FreeTierMetrics {
   activationRate: number; // >40% using weekly (NEW)
   timeToTrust: number; // <14 days target (ENHANCED)
   insightAcceptanceRate: number; // >40% excellent
   viralCoefficient: number; // >0.5 target (NEW)
   freeToPaidConversion: number; // 25% target in 90 days (ENHANCED)
   competitiveWinRate: number; // % switching from GA4/Shopify Analytics (NEW)
 }
 ```
 
 ### **Enhanced E2E Testing Strategy - Phase 1.5 Focus**
 - **Free Tier Flows**: Viral sharing, teaser interactions, confidence indicators
 - **Data Distribution**: Complete flow from Shopify → API → Sidenav pages
 - **Upgrade Pathways**: Testing free → Spark conversion triggers
 - **Competitive Scenarios**: GA4 migration flows, Shopify Analytics replacement

---

## Phase 5: Optimization (Optimize Plan)
**Focus:** Deploy Predictive AI & Personalization (Learning Layer L3).

### ⏳ Phase 5 Backlog (Pending)
* (No issues logged yet)

---

## Phase 6: Autonomy (Autonomous Plan)
**Focus:** Deploy Reinforcement Learning & Autonomous Features.

### ⏳ Phase 6 Backlog (Pending)
* (No issues logged yet)

---

## 🗑️ Test File Cleanup Actions

### ✅ **KEEP & ENHANCE**
- `auth.spec.ts` - Core authentication flows
- `auth.setup.spec.ts` - Test state management  
- `dashboard-page.spec.ts` - Main dashboard functionality

### 🔄 **REVIEW & UPDATE**
- `onboarding-flow.spec.ts` - Align with current DashboardStateManager
- `kore.spec.ts` - Verify Kore system integration status
- `kore-trigger.spec.ts` - Validate CoachTrigger implementation

### ✅ **DEPRECATE & ARCHIVE**
- `customer-360.spec.ts` - Legacy page architecture
- `order-360-page.spec.ts` - Legacy page architecture
- `orders-page.spec.ts` - Legacy page architecture

---

## ⛔️ Superseded & Deprecated Issues
* **#767:** `Build Paid-Only Advanced Widgets` (Superseded by `#793` & `#794`)
* **#804, #805, #806, #807, #808:** (Duplicate/non-existent - replaced by #812-#816)
* **#707:** EPIC-003: 'Survival Tier' (Completed - merged into Phase 1)
* **#705:** EPIC-001: The 'First-Mile' (Completed - merged into Phase 1)

---

**Updated**: 
- ✅ Marked **#731**, **#732**, **#733**, **#737** as COMPLETED
- ✅ Updated completion count: **21/47 (45%)** completed
- ✅ Noted 19/19 tests passing in E2E testing suite
- ✅ Updated Phase 1 progress with completed loading state tests
- ✅ Enhanced E2E Testing Strategy section with current status

**E2E Testing Milestone Achieved**: Comprehensive dashboard testing suite with loading states, error handling, and layout stability now fully operational.