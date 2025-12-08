# OnboardingContract v1 – Cross-Module Onboarding Framework for LaSyncro

> **Mission:** Provide a unified, predictable, **module-aware onboarding system** that:
>
> * Guides merchants through the **minimum set of actions required** for each installed module.
> * Reflects **real technical readiness** (not marketing).
> * Exposes **other modules as “locked” opportunities** to encourage cross-sell.
>
> Any deviation or new onboarding behavior MUST update this contract.

This contract governs:

* Module readiness signals
* Onboarding tasks (module-scoped)
* Task grouping & UI composition
* Cross-module dependencies
* “Add module later” behavior
* Interaction with `Ft0Phase` (FT0 dashboard state machine)
* Versioning rules

---

## 0. Principles

### 0.1 Onboarding is module-driven

Each module is responsible for defining:

* What **tasks** are required before the module is “ready”.
* What **signals** indicate a task is “done”.
* What **sections** of the product remain locked/unavailable until readiness.

Platform wiring (OnboardingTaskListTracker, FT0 flows) must consume those definitions – not invent them.

### 0.2 Tasks are grouped by module

Each module appears as a **collapsible section** in the onboarding task list:

* `platform` – Store Connection & Sync
* `orderNexus` – Orders & Profitability
* `returnNexus` – Returns & Financial Outcomes
* `wmsLite` – Warehouse Operations
* `problemCenter` – Issues & Quality
* `insightCore` – Analytics
* `skuOs` – Product Health
* `specter` – Customer Signals

Example:

```text
▼ Store Connection & Sync (Platform)
  ✔ Connect Shopify Store
  ✔ Complete First Sync

▼ Orders & Profitability (OrderNexus)
  ✔ Profitability Engine Activated
  ○ Confirm your operating mode

▼ Returns & Quality (ReturnNexus)
  ○ Process your first return

▼ Inventory & Warehouse (WMS-Lite)
  🔒 Install WMS-Lite to unlock

▼ Customer Signals (Specter)
  🔒 Install Specter to unlock
````

### 0.3 Tasks reflect **real** readiness

Tasks must:

* Map to **actual runtime state** and DB facts (migrations, events, rows).
* Represent the **minimum viable configuration & data** required for that module to provide value.
* Avoid vanity tasks (“click here to see a tooltip”) as blockers.

### 0.4 Add-module-later is a first-class path

When a merchant adds another module:

* A **new section** appears for that module.
* Only that module’s tasks appear inside the new section.
* Existing modules remain as they are (ready or not).
* Cross-sell visibility **increases**, but no existing flows break.

---

## 1. Canonical Types – Onboarding Engine

### 1.1 Module Keys

```ts
export type ModuleKey =
  | 'platform'        // Core store connection + sync
  | 'orderNexus'
  | 'returnNexus'
  | 'wmsLite'
  | 'problemCenter'
  | 'insightCore'
  | 'skuOs'
  | 'specter';
```

### 1.2 Readiness Signals

Readiness signals are **module-scoped** and emitted by backend “readiness providers”.
They are strongly shaped, not arbitrary strings.

export interface ReadinessSignal {
  key: string;           // e.g. 'orderNexus.ordersIngested'
  value: number | string | boolean;
  observedAt: string;    // ISO timestamp
}

**Contract:**

* All keys MUST start with a `ModuleKey` prefix and use dot notation.
* v1 **allowed keys** (non-exhaustive, but locked once used):

```ts
// Platform / Integration
'platform.integration.connected': boolean;
'platform.integration.syncCompleted': boolean;

// OrderNexus
'orderNexus.ordersIngested': number;          // rows in order_profitability
'orderNexus.profitabilityActive': boolean;    // at least one successful computeInitialProfit
'orderNexus.costModelHydrated': boolean;      // CostModelService returned a valid model
'orderNexus.costModelSource': 'finance' | 'local';
'orderNexus.costConfidenceScore': number;     // 0–1 aggregate confidence in cost data quality
'orderNexus.modeDetermined': boolean;         // ModePolicyManager has a mode
'orderNexus.modeExplicitlySet': boolean;      // merchant confirmed mode
'orderNexus.pipelineHealthy': boolean;        // SLA not catastrophically degraded
'orderNexus.missingCostCount': number;        // count of orders/SKUs missing cost data
'orderNexus.hasNegativeMarginOrder': boolean; // true if any order has net_profit < 0

// ReturnNexus
'returnNexus.installationActive': boolean;    // module installed + entitlements
'returnNexus.hasReturnCase': boolean;         // at least one ReturnCase exists
'returnNexus.hasDecisionEvent': boolean;      // ReturnDecisionEvent emitted
'returnNexus.hasReturnAnalytics': boolean;    // at least one ReturnAnalyticsEvent

// WMS-Lite
'wmsLite.connected': boolean;                 // integration/tenant enabled
'wmsLite.firstInventoryMovementAt': string | null;  // ISO or null
'wmsLite.firstReturnInspectionAt': string | null;   // ISO or null

// ProblemCenter
'problemCenter.issuesCreated': number;        // rows in ps_issues
'problemCenter.integrationHealthy': boolean;  // event pipeline OK

// InsightCore
'insightCore.hasOrderAnalytics': boolean;     // OrderAnalyticsEvent ingested
'insightCore.hasReturnAnalytics': boolean;    // ReturnAnalyticsEvent ingested
'insightCore.hasProductHealth': boolean;      // ProductHealthAnalyticsEvent ingested
'insightCore.hasCostModelAnalytics': boolean; // CostModelAnalyticsEvent ingested

// SKU OS
'skuOs.productHealthEvents': number;          // ProductHealthAnalyticsEvent count (v1 minimum)
'skuOs.healthCoverageRatio': number;          // 0–1 fraction of active SKUs with a recent health score
'skuOs.hasStockoutRiskProducts': boolean;     // true if any product has stockoutRisk above threshold
'skuOs.attentionListSize': number;            // size of current "needs attention" list from Product Attention API

// Specter
'specter.configured': boolean;                // basic config saved
'specter.firstNudgeSeen': boolean;            // optional

Free Tier Signals (FTEP v1.1)

Free-tier behavior is governed by the Module Free Tier Exposure Policy (FTEP v1.1) defined in:

docs/entitlements/FreeTierPolicy.md

modules/shared/src/contracts/free-tier.ts

Each module must expose two free-tier signals into onboarding:

{moduleId}.freeTierState

Type: ModuleAccessState from @lasyncro/shared

Allowed values:

visible

free_tier_active

free_tier_exhausted

locked

{moduleId}.freeTierRemaining

Type: number | null

null means “not applicable or unlimited” (e.g. paid plan or disabled FTEP)

0 means “quota reached / exhausted”

Concretely, for v1.1 we expect (moduleId uses the code IDs, not UI labels):

platform.freeTierState / platform.freeTierRemaining

order-nexus.freeTierState / order-nexus.freeTierRemaining

return-nexus.freeTierState / return-nexus.freeTierRemaining

wms-lite.freeTierState / wms-lite.freeTierRemaining

problem-center.freeTierState / problem-center.freeTierRemaining

insight-core.freeTierState / insight-core.freeTierRemaining

sku-os.freeTierState / sku-os.freeTierRemaining

specter.freeTierState / specter.freeTierRemaining

UI contract:

free_tier_active → tasks and CTAs behave normally

free_tier_exhausted → tasks become read-only, CTA becomes “Upgrade”

locked → module renders as a locked section with upgrade messaging

visible → module tab is visible but not yet “active” (e.g. pre-FT0 module)

### 1.3 Module Readiness Snapshot

```ts
export interface ModuleReadinessSnapshot {
  moduleKey: ModuleKey;

  // From module registry / entitlements
  isInstalled: boolean;

  // True only when all required tasks for this module are complete
  isReady: boolean;

  // Module-defined flags, derived from signals (e.g. ['COST_MODEL_FALLBACK_ACTIVE'])
  flags: string[];

  // Raw signals used to derive isReady / flags
  signals: ReadinessSignal[];

  lastEvaluatedAt: string; // ISO
}
```

### 1.4 Tasks & Sections (TaskList Tracker Contract)

```ts
export interface OnboardingTaskCompletionRule {
  signalKey: string;   // must match a ReadinessSignal.key
  operator: '==' | '>=' | '>' | 'exists';
  value?: number | string | boolean;
}

export interface OnboardingTaskAction {
  type:
    | 'OPEN_CONNECT_MODAL'
    | 'NAVIGATE'
    | 'OPEN_MODULE_SETTINGS'
    | 'SHOW_DOCS';
  target?: string; // route or module slug, depending on type
}

export interface OnboardingTask {
  id: string;                    // globally unique, e.g. 'orderNexus.ingestFirstOrders'
  moduleKey: ModuleKey;

  labelKey: string;              // i18n key, not raw text
  descriptionKey?: string;

  required: boolean;             // required for module isReady
  completionRule: OnboardingTaskCompletionRule;

  action?: OnboardingTaskAction; // optional click behavior
}

export interface OnboardingSection {
  id: string;               // e.g. 'platform', 'orderNexus'
  moduleKey: ModuleKey;
  titleKey: string;         // i18n key

  // If true, section renders as “locked / upsell” when module not installed.
  lockedIfNotInstalled: boolean;

  tasks: OnboardingTask[];
}
```

These types are the **only supported contract** between:

* Backend readiness providers, and
* Frontend `OnboardingTaskListTracker` / FT0 flows.

---

## 2. Platform – Store Connection & Sync (`moduleKey: 'platform'`)

### 2.1 Readiness Rule

```ts
platformReady(shopId) = 
  platform.integration.connected === true &&
  platform.integration.syncCompleted === true
```

### 2.2 Tasks

**Section:** `id = 'platform'`, `titleKey = 'onboarding.platform.sectionTitle'`, `lockedIfNotInstalled = false`.

Tasks:

1. **Connect Shopify Store**

```ts
{
  id: 'platform.connectShopify',
  moduleKey: 'platform',
  labelKey: 'onboarding.platform.connectShopify.title',
  descriptionKey: 'onboarding.platform.connectShopify.description',
  required: true,
  completionRule: {
    signalKey: 'platform.integration.connected',
    operator: '==',
    value: true
  },
  action: { type: 'OPEN_CONNECT_MODAL' }
}
```

2. **Complete First Sync**

```ts
{
  id: 'platform.completeFirstSync',
  moduleKey: 'platform',
  labelKey: 'onboarding.platform.completeFirstSync.title',
  required: true,
  completionRule: {
    signalKey: 'platform.integration.syncCompleted',
    operator: '==',
    value: true
  }
}
```

3. **Tell us your monthly order volume** (optional nudging task)

```ts
{
  id: 'platform.setOrderVolumeSegment',
  moduleKey: 'platform',
  labelKey: 'onboarding.platform.setOrderVolumeSegment.title',
  required: false, // NOT a blocker for readiness
  completionRule: {
    signalKey: 'platform.ordersPerMonthSegment',
    operator: 'exists'
  },
  action: {
    type: 'OPEN_MODULE_SETTINGS',
    target: 'platform.ordersPerMonth'
  }
}
```

Note: `platform.ordersPerMonthSegment` is an optional, additional signal; it MUST NOT be required for `platformReady`.

---

## 3. OrderNexus – Orders & Profitability (`moduleKey: 'orderNexus'`)

### 3.1 Readiness Definition (aligned with OrderNexus blueprint)

From the OrderNexus blueprint, `OrderNexusReady(shopId)` requires:

1. Shopify integration exists + initial sync completed.
2. At least one order ingested & profitability computed.
3. Cost model hydrated (local or finance).
4. Mode policy determined (auto or explicit).
5. Ingestion pipeline SLA healthy enough for FT0.
6. Cost confidence above a minimum floor.

Expressed as signals:

```ts
orderNexusReady(shopId) =
  platform.integration.syncCompleted === true &&
  orderNexus.ordersIngested >= 1 &&
  orderNexus.profitabilityActive === true &&
  orderNexus.costModelHydrated === true &&
  orderNexus.modeDetermined === true &&
  orderNexus.pipelineHealthy === true &&
  orderNexus.costConfidenceScore >= 0.2
```

`orderNexus.costModelSource` and `orderNexus.pipelineHealthy` are **flags**, not blockers, unless the degradation is catastrophic.

**3.2 Tasks (Onboarding Checklist):**

Section:
id = 'orderNexus', titleKey = 'onboarding.orderNexus.sectionTitle', lockedIfNotInstalled = true.

1. Review your first Profit Autopsy (hero moment)
{
  id: 'orderNexus.reviewProfitAutopsy',
  moduleKey: 'orderNexus',
  labelKey: 'onboarding.orderNexus.reviewProfitAutopsy.title',
  descriptionKey: 'onboarding.orderNexus.reviewProfitAutopsy.description',
  required: true,
  completionRule: {
    // We only consider the task "done" once we have at least one
    // ingested order AND profitability has been computed.
    signalKey: 'orderNexus.profitabilityActive',
    operator: '==',
    value: true
  },
  action: {
    type: 'NAVIGATE',
    target: '/orders' // or specific Profit Autopsy view
  }
}

2. Fix missing costs so your profit is real
{
  id: 'orderNexus.resolveMissingCosts',
  moduleKey: 'orderNexus',
  labelKey: 'onboarding.orderNexus.resolveMissingCosts.title',
  descriptionKey: 'onboarding.orderNexus.resolveMissingCosts.description',
  required: true,
  completionRule: {
    // Task is "done" when there are no more missing costs in the ledger.
    signalKey: 'orderNexus.missingCostCount',
    operator: '==',
    value: 0
  },
  action: {
    type: 'NAVIGATE',
    target: '/products' // or a dedicated "Missing Costs" view
  }
}

3. Check your Bleed Feed (unprofitable orders)
{
  id: 'orderNexus.checkBleedFeed',
  moduleKey: 'orderNexus',
  labelKey: 'onboarding.orderNexus.checkBleedFeed.title',
  descriptionKey: 'onboarding.orderNexus.checkBleedFeed.description',
  required: false,
  completionRule: {
    // Becomes relevant when at least one order is negative-margin.
    signalKey: 'orderNexus.hasNegativeMarginOrder',
    operator: '==',
    value: true
  },
  action: {
    type: 'NAVIGATE',
    target: '/orders/bleeders' // canonical Bleed Feed route
  }
}

4. Confirm your operating mode (Survival / Growth / Architect)
{
  id: 'orderNexus.confirmMode',
  moduleKey: 'orderNexus',
  labelKey: 'onboarding.orderNexus.confirmMode.title',
  descriptionKey: 'onboarding.orderNexus.confirmMode.description',
  required: false, // strongly recommended but not a hard readiness gate
  completionRule: {
    signalKey: 'orderNexus.modeDetermined',
    operator: '==',
    value: true
  },
  action: {
    type: 'OPEN_MODULE_SETTINGS',
    target: 'orderNexus.mode'
  }
}

Note:

`orderNexus.costModelHydrated`, `orderNexus.pipelineHealthy`, and `orderNexus.costConfidenceScore` remain part of the readiness rule (3.1), not of end-user-facing tasks. We don’t need a separate “Calibrate cost model” onboarding step to block value; we’ll still introduce that as a UX flow, but it doesn’t belong as a v1 hard task blocker.

This keeps the Profit Autopsy and Missing Costs as the core FT0 experience, with Bleed Feed as the first “oh shit” insight and Mode as a phase-2 optimization.

---

## 4. ReturnNexus – Returns & Financial Outcomes (`moduleKey: 'returnNexus'`)

### 4.1 Readiness Definition (aligned with ReturnNexus blueprint §11)

ReturnNexus is considered “ready” when:

1. Integration/sync completed (platform).
2. At least one **authorized** return case exists.
3. At least one **refund/decision** has been computed.
4. Return analytics are flowing.

Expressed as:

```ts
returnNexusReady(shopId) =
  platform.integration.syncCompleted === true &&
  returnNexus.installationActive === true &&
  returnNexus.hasReturnCase === true &&
  returnNexus.hasDecisionEvent === true
```

If WMS-Lite is installed, `wmsLite.firstReturnInspectionAt` becomes a **desirable** but not mandatory addition for v1 readiness.

### 4.2 Tasks

**Section:** `id = 'returnNexus'`, `titleKey = 'onboarding.returnNexus.sectionTitle'`, `lockedIfNotInstalled = true`.

Tasks:

1. **Activate returns**

```ts
{
  id: 'returnNexus.activate',
  moduleKey: 'returnNexus',
  labelKey: 'onboarding.returnNexus.activate.title',
  required: true,
  completionRule: {
    signalKey: 'returnNexus.installationActive',
    operator: '==',
    value: true
  },
  action: {
    type: 'OPEN_MODULE_SETTINGS',
    target: 'returnNexus.settings'
  }
}
```

2. **Process your first return**

```ts
{
  id: 'returnNexus.firstReturnProcessed',
  moduleKey: 'returnNexus',
  labelKey: 'onboarding.returnNexus.firstReturnProcessed.title',
  required: true,
  completionRule: {
    signalKey: 'returnNexus.hasDecisionEvent',
    operator: '==',
    value: true
  }
}
```

3. **Enable warehouse inspections (when WMS-Lite installed)** – optional but recommended

```ts
{
  id: 'returnNexus.enableWmsInspections',
  moduleKey: 'returnNexus',
  labelKey: 'onboarding.returnNexus.enableWmsInspections.title',
  required: false,
  completionRule: {
    signalKey: 'wmsLite.firstReturnInspectionAt',
    operator: 'exists'
  },
  action: {
    type: 'NAVIGATE',
    target: '/wms/returns' // example route
  }
}
```

---

## 5. WMS-Lite – Warehouse Operations (`moduleKey: 'wmsLite'`)

### 5.1 Readiness Definition (aligned with WMS-Lite blueprint)

Minimal readiness:

1. WMS-Lite is enabled for the tenant.
2. At least one **inventory movement** exists.

```ts
wmsLiteReady(shopId) =
  wmsLite.connected === true &&
  wmsLite.firstInventoryMovementAt != null
```

Return inspections are optional for v1 readiness, but required for “full returns pipeline” value.

### 5.2 Tasks

**Section:** `id = 'wmsLite'`, `titleKey = 'onboarding.wmsLite.sectionTitle'`, `lockedIfNotInstalled = true`.

Tasks:

1. **Connect WMS-Lite / enable warehouse operations**

```ts
{
  id: 'wmsLite.connect',
  moduleKey: 'wmsLite',
  labelKey: 'onboarding.wmsLite.connect.title',
  required: true,
  completionRule: {
    signalKey: 'wmsLite.connected',
    operator: '==',
    value: true
  },
  action: {
    type: 'OPEN_MODULE_SETTINGS',
    target: 'wmsLite.settings'
  }
}
```

2. **Register your first inventory movement** (receive / stow / pick)

```ts
{
  id: 'wmsLite.firstInventoryMovement',
  moduleKey: 'wmsLite',
  labelKey: 'onboarding.wmsLite.firstInventoryMovement.title',
  required: true,
  completionRule: {
    signalKey: 'wmsLite.firstInventoryMovementAt',
    operator: 'exists'
  }
}
```

3. **Perform your first return inspection** (optional, but unlocks full returns quality pipeline)

```ts
{
  id: 'wmsLite.firstReturnInspection',
  moduleKey: 'wmsLite',
  labelKey: 'onboarding.wmsLite.firstReturnInspection.title',
  required: false,
  completionRule: {
    signalKey: 'wmsLite.firstReturnInspectionAt',
    operator: 'exists'
  }
}
```

---

## 6. ProblemCenter – Issues & Quality (`moduleKey: 'problemCenter'`)

### 6.1 Readiness Definition (aligned with ProblemCenter blueprint)

Minimal readiness:

1. Schema exists and ProblemCenter is enabled.
2. At least one issue has been created.
3. Integration pipelines for quality events are healthy.

Expressed as:

```ts
problemCenterReady(shopId) =
  problemCenter.issuesCreated >= 1 &&
  problemCenter.integrationHealthy === true
```

### 6.2 Tasks

**Section:** `id = 'problemCenter'`, `titleKey = 'onboarding.problemCenter.sectionTitle'`, `lockedIfNotInstalled = true`.

Tasks:

1. **Report your first warehouse issue**

```ts
{
  id: 'problemCenter.firstIssue',
  moduleKey: 'problemCenter',
  labelKey: 'onboarding.problemCenter.firstIssue.title',
  required: true,
  completionRule: {
    signalKey: 'problemCenter.issuesCreated',
    operator: '>=',
    value: 1
  },
  action: {
    type: 'NAVIGATE',
    target: '/problem-center/issues/new'
  }
}
```

2. **(Optional) Link issues to returns** (when ReturnNexus is installed)

```ts
{
  id: 'problemCenter.linkIssuesToReturns',
  moduleKey: 'problemCenter',
  labelKey: 'onboarding.problemCenter.linkIssuesToReturns.title',
  required: false,
  completionRule: {
    signalKey: 'returnNexus.hasReturnAnalytics',
    operator: '==',
    value: true
  },
  action: {
    type: 'NAVIGATE',
    target: '/problem-center/returns'
  }
}
```

---

## 7. InsightCore – Analytics (`moduleKey: 'insightCore'`)

### 7.1 Readiness Definition (aligned with InsightCore blueprint)

Minimal readiness:

* At least one `OrderAnalyticsEvent` ingested.

Full v1 readiness:

* Orders + at least one of: returns / product health / cost model analytics.

```ts
insightCoreMinimalReady(shopId) =
  insightCore.hasOrderAnalytics === true;

insightCoreFullReady(shopId) =
  insightCore.hasOrderAnalytics === true &&
  (
    insightCore.hasReturnAnalytics === true ||
    insightCore.hasProductHealth === true ||
    insightCore.hasCostModelAnalytics === true
  );
```

### 7.2 Tasks

**Section:** `id = 'insightCore'`, `titleKey = 'onboarding.insightCore.sectionTitle'`, `lockedIfNotInstalled = false` (always present as the platform’s analytics layer).

Tasks:

1. **Receive your first order analytics event**

```ts
{
  id: 'insightCore.firstOrderAnalytics',
  moduleKey: 'insightCore',
  labelKey: 'onboarding.insightCore.firstOrderAnalytics.title',
  required: true,
  completionRule: {
    signalKey: 'insightCore.hasOrderAnalytics',
    operator: '==',
    value: true
  }
}
```

2. **(Optional) Enable product health analytics**

```ts
{
  id: 'insightCore.productHealthAnalytics',
  moduleKey: 'insightCore',
  labelKey: 'onboarding.insightCore.productHealthAnalytics.title',
  required: false,
  completionRule: {
    signalKey: 'insightCore.hasProductHealth',
    operator: '==',
    value: true
  }
}
```

3. **(Optional) Enable returns analytics**

```ts
{
  id: 'insightCore.returnsAnalytics',
  moduleKey: 'insightCore',
  labelKey: 'onboarding.insightCore.returnsAnalytics.title',
  required: false,
  completionRule: {
    signalKey: 'insightCore.hasReturnAnalytics',
    operator: '==',
    value: true
  }
}
```

4. **(Optional) Enable cost model analytics**

```ts
{
  id: 'insightCore.costModelAnalytics',
  moduleKey: 'insightCore',
  labelKey: 'onboarding.insightCore.costModelAnalytics.title',
  required: false,
  completionRule: {
    signalKey: 'insightCore.hasCostModelAnalytics',
    operator: '==',
    value: true
  }
}
```

---

## 8. Specter – Customer Signals (`moduleKey: 'specter'`)

### 8.1 Readiness Definition

Minimal readiness:

```ts
specterReady(shopId) =
  specter.configured === true
```

Nudges and deeper behaviors are additive.

### 8.2 Tasks

**Section:** `id = 'specter'`, `titleKey = 'onboarding.specter.sectionTitle'`, `lockedIfNotInstalled = true`.

Tasks:

1. **Configure Specter settings**

```ts
{
  id: 'specter.configure',
  moduleKey: 'specter',
  labelKey: 'onboarding.specter.configure.title',
  required: true,
  completionRule: {
    signalKey: 'specter.configured',
    operator: '==',
    value: true
  },
  action: {
    type: 'OPEN_MODULE_SETTINGS',
    target: 'specter.settings'
  }
}
```

2. **Review your first nudge** (optional)

```ts
{
  id: 'specter.firstNudgeSeen',
  moduleKey: 'specter',
  labelKey: 'onboarding.specter.firstNudgeSeen.title',
  required: false,
  completionRule: {
    signalKey: 'specter.firstNudgeSeen',
    operator: '==',
    value: true
  }
}
```

---

## 9. SKU OS – Product Health (`moduleKey: 'skuOs'`)

### 9.1 Readiness Definition

Minimal readiness for SKU-OS is not “one event fired” — it’s “the health engine is actually covering the catalog enough to be useful.”

For v1, `skuOsReady(shopId)` requires:

1. Store integration & sync completed (so the product set is real).
2. At least one `ProductHealthAnalyticsEvent` generated.
3. A minimum fraction of active SKUs having a recent health score.

Expressed as signals:

```ts
skuOsReady(shopId) =
  platform.integration.syncCompleted === true &&
  skuOs.productHealthEvents >= 1 &&
  skuOs.healthCoverageRatio >= 0.5
  ```

### 9.2 Tasks

**Section:** `id = 'skuOs'`, `titleKey = 'onboarding.skuOs.sectionTitle'`, `lockedIfNotInstalled = true`.

Tasks:

1. **Activate your Product Health Scorecard**

{
  id: 'skuOs.firstProductHealthEvent',
  moduleKey: 'skuOs',
  labelKey: 'onboarding.skuOs.firstProductHealthEvent.title',
  descriptionKey: 'onboarding.skuOs.firstProductHealthEvent.description',
  required: true,
  completionRule: {
    // SKU-OS has generated at least one ProductHealthAnalyticsEvent
    signalKey: 'skuOs.productHealthEvents',
    operator: '>=',
    value: 1
  }
}

2. **Reach basic catalog coverage**
{
  id: 'skuOs.basicHealthCoverage',
  moduleKey: 'skuOs',
  labelKey: 'onboarding.skuOs.basicHealthCoverage.title',
  descriptionKey: 'onboarding.skuOs.basicHealthCoverage.description',
  required: true,
  completionRule: {
    // At least 50% of active SKUs have a recent health score
    signalKey: 'skuOs.healthCoverageRatio',
    operator: '>=',
    value: 0.5
  }
}

3. **Check your Stockout Risk Radar (optional, but ties to the high-leverage widget)**
{
  id: 'skuOs.checkStockoutRisk',
  moduleKey: 'skuOs',
  labelKey: 'onboarding.skuOs.checkStockoutRisk.title',
  descriptionKey: 'onboarding.skuOs.checkStockoutRisk.description',
  required: false,
  completionRule: {
    // Only relevant once there is at least one product with elevated stockout risk
    signalKey: 'skuOs.hasStockoutRiskProducts',
    operator: '==',
    value: true
  }
}

4. **Review products that need attention (optional attention ranking)**
{
  id: 'skuOs.reviewAttentionList',
  moduleKey: 'skuOs',
  labelKey: 'onboarding.skuOs.reviewAttentionList.title',
  descriptionKey: 'onboarding.skuOs.reviewAttentionList.description',
  required: false,
  completionRule: {
    // "Needs attention" list is non-empty
    signalKey: 'skuOs.attentionListSize',
    operator: '>',
    value: 0
  }
}

---

## 10. Cross-Sell & Locked Sections

### 10.1 Locked groups for uninstalled modules

If `ModuleReadinessSnapshot.isInstalled === false`:

* `OnboardingSection.lockedIfNotInstalled === true` → section renders as:

```text
▼ Returns & Quality (ReturnNexus)
  Locked – requires ReturnNexus
  [Install ReturnNexus] button
```

* The frontend obtains install targets (e.g. “install return module”) from a **separate module registry**, not from this contract.
* No tasks are evaluated; completion rules are ignored.

### 10.2 Cross-sell principles

* Cross-sell is **read-only** in this contract – just visibility & grouping.
* No cross-module hard dependencies:

  * OrderNexus does NOT require Specter.
  * ReturnNexus does NOT require WMS-Lite (but has an optional task).
* Modules may **augment** each other’s sections via **optional, non-required tasks** only.

---

## 11. Add-Module-Later Behavior

When a new module is installed:

1. A new `ModuleReadinessSnapshot` is created with `isInstalled = true`, `isReady = false`.
2. A new `OnboardingSection` appears in the task list for that module.
3. All tasks for that module start incomplete.
4. Other modules’ snapshots and sections are unaffected.
5. A toast/banner may announce the new module (implementation detail, not contract).

When a module is removed:

1. `isInstalled = false`.
2. Its section either:

   * Disappears, or
   * Remains as a locked cross-sell section (implementation choice, but must be consistent).
3. InsightCore and other modules MUST degrade gracefully as specified in their own blueprints.

---

## 12. Interaction with `Ft0Phase` (Dashboard FT0 State Machine)

`Ft0Phase` (from `apps/frontend/src/types/onboarding.ts`):

```ts
export type Ft0Phase =
  | 'PRE_CONNECT'
  | 'CONNECTING'
  | 'SYNCING'
  | 'POST_SYNC_SKELETON'
  | 'STEADY_STATE';
```

### 12.1 Contract

* **PRE_CONNECT**

  * Only the `platform` section should be expanded and actionable.
  * All other sections:

    * If `isInstalled = true`: visible but visually blocked with “Connect your store first”.
    * If `isInstalled = false` & `lockedIfNotInstalled = true`: shown as locked cross-sell sections.

* **CONNECTING / SYNCING / POST_SYNC_SKELETON**

  * Platform tasks remain visible.
  * Module sections can show future tasks, but:

    * No module can be declared `isReady = true` until its readiness rule is satisfied via signals.
    * UI must respect `forceLoadingSkeleton` / `POST_SYNC_SKELETON` as a visual override.

* **STEADY_STATE**

  * Backend produces `ModuleReadinessSnapshot[]`.
  * Frontend renders:

    * Open sections for any installed module where `isReady = false`.
    * Collapsed sections with a “Completed” badge where `isReady = true`.
    * Collapsed locked sections for not-installed modules.

FT0 state decides **layout & timing**, but **never overrides** module readiness rules defined here.

---

## 13. Versioning

Any change to:

* Task definitions,
* Readiness signals,
* Module readiness rules,
* Required vs optional classification,
* Cross-module dependencies,

**requires**:

1. A new versioned contract file:

   * `/docs/onboarding/OnboardingContract_v2.md`

2. A migration plan covering:

   * `OnboardingTaskListTracker` wiring,
   * Module readiness providers (backend),
   * Dashboard gating / FT0 interactions,
   * Any persisted onboarding state (if/when introduced).

No ad-hoc edits to onboarding behavior are allowed outside this contract.

---

End of OnboardingContract v1.
