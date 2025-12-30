Alright, let’s stop hand-waving and actually **freeze** this.

Below is a **sealed v1 Pricing & Tiers Contract** for LaSyncro:

* shared pricing model
* per-module plans
* feature boundaries per tier
* revenue model & ACV mapping
* rules for changes (v2 only)

If you later start “tweaking things” ad-hoc, you’ll be breaking your own system. This is meant to *prevent* that.

---

# 🔒 LaSyncro Pricing & Tiers – v1 Locked Blueprint & Contract

> **Mission:**
> Define a **consistent, modular pricing system** for all LaSyncro modules that:
>
> * supports Shopify apps + LaSyncro.com SaaS,
> * is aligned with merchant scale (ARR/complexity),
> * maximizes ACV while preserving frictionless entry,
> * clearly separates *Free vs Pro vs Elite vs Enterprise*.

Any change to:

* plan IDs
* their semantics
* included volumes
* feature boundaries
* base prices

requires a **v2 Pricing Contract** and a migration plan. No silent tweaks.

---

## 0. Global Pricing Primitives (Locked)

### 0.1 Plans

```ts
export type PricingPlanId =
  | 'FREE'
  | 'PRO'
  | 'PRO_PLUS'
  | 'ELITE'
  | 'ENTERPRISE';
```

Semantics (locked):

* `FREE`: acquisition only, no automation, no intelligence, hard volume caps.
* `PRO`: SMB self-serve, core automation; primary paid tier for < $2M ARR.
* `PRO_PLUS`: mid-market self-serve; heavier volume and features; for $2M–$10M ARR.
* `ELITE`: high-end self-serve / light sales assist; $10M–$25M ARR.
* `ENTERPRISE`: annual contracts & custom quotes; $25M+ ARR.

### 0.2 Generic Plan Shape (for all modules)

```ts
export interface ModulePricingPlan {
  moduleKey: ModuleKey;          // 'returnNexus' | 'sku-os' | ...
  planId: PricingPlanId;
  basePriceMonthlyUSD: number;
  availableOnShopify: boolean;   // ENTERPRISE is false
  availableDirectSaaS: boolean;  // all except FREE

  // Module-specific caps, stored as JSON for flexibility:
  limits: Record<string, number | null>; // e.g. { maxReturnsPerMonth: 300 }

  // For internal GTM tagging:
  recommendedMerchantARR: {
    min: number; // USD
    max: number | null; // null = no upper bound
  };
}
```

---

## 1. Global Feature Boundaries (Non-Negotiable)

These rules apply **across all modules**:

### 1.1 FREE Plan – Universal Rules

On `FREE`, a module:

* **MUST NOT**:

  * provide automation (no auto rules, no scheduled actions),
  * provide cross-module intelligence,
  * provide multi-warehouse / multi-location support,
  * expose APIs,
  * provide exports beyond very small samples,
  * provide historical analytics beyond **30 days**,
  * provide multi-user roles or permissions.

* **MUST**:

  * hard-limit volume (returns, SKUs, issues, etc.),
  * show clear upgrade CTAs,
  * include “Powered by LaSyncro” branding.

If you violate these, you undercut your entire revenue model.

### 1.2 PRO Plan – Universal Rules

* Includes:

  * core workflows,
  * meaningful automation (rules, alerts),
  * single-warehouse/single-location,
  * analytics up to **12 months**,
  * usage caps compatible with merchants up to ~$2M ARR.

### 1.3 PRO_PLUS Plan – Universal Rules

* Includes:

  * same as PRO plus:
  * larger volume caps,
  * more intelligence features,
  * some cross-module awareness (read-only),
  * basic integrations.

### 1.4 ELITE Plan – Universal Rules

* Includes:

  * “full fat” of the module for merchants up to ~ $25M ARR,
  * cross-module intelligence (within LaSyncro CNS),
  * multi-warehouse / multi-location,
  * deeper automation & workflows,
  * role-based access.

### 1.5 ENTERPRISE – Universal Rules

* **Annual only (ACV)**.
* Includes:

  * custom limits / SLAs,
  * priority support,
  * implementation services,
  * security/compliance add-ons.

---

## 2. Module Pricing & Feature Matrices (Locked v1)

We’ll go module by module.

---

### 2.1 ReturnNexus – Returns & Exchanges

**Usage axis:** number of returns per month.

#### 2.1.1 Pricing

| Plan       | PlanId     | MRR (USD)               | Returns / Month | Shopify?       | Direct SaaS? | ARR Range (Recommended) |
| ---------- | ---------- | ----------------------- | --------------- | -------------- | ------------ | ----------------------- |
| Free       | FREE       | $0                      | 10              | ✅              | ❌            | < $300k ARR             |
| Pro        | PRO        | $49                     | 300             | ✅              | ✅            | $300k–$2M               |
| Pro+       | PRO_PLUS   | $99                     | 1,000           | ✅              | ✅            | $1M–$8M                 |
| Elite      | ELITE      | $299                    | 5,000           | ✅              | ✅            | $5M–$25M                |
| Enterprise | ENTERPRISE | custom (from ~$12k ACV) | custom          | ❌ (quote only) | ✅            | $20M+                   |

These caps are **locked v1 semantics** for ReturnNexus.

#### 2.1.2 Feature by Plan

**FREE (ReturnNexus)**

* Customer returns portal (basic)
* Up to 10 returns/month
* Single reason per return
* Manual approval only
* No automations
* No labels
* No exchanges
* No analytics, just a simple list
* LaSyncro branding visible, non-removable

**PRO**

* Up to 300 returns/month
* Auto-approval for simple cases (basic rules)
* Email notifications for staff
* Refund to original payment (simple)
* Return reason codes (basic)
* Basic analytics (30 days history)
* Simple embedded portal customization (logo & color)

**PRO_PLUS**

* Up to 1,000 returns/month
* Advanced rules:

  * SKU-based conditions
  * blacklist SKUs
  * return window rules
* Exchanges (size/color/variant)
* Photo uploads in portal
* Moderation queue (approve/decline)
* Integration with shipping labels (1 provider)
* Return analytics (12 months: rate, top SKUs, reasons)

**ELITE**

* Up to 5,000 returns/month
* Multi-step exchanges (cross-SKU)
* Automated partial refunds
* Segmented policies by geography or channel
* Basic consolidation suggestions (combine returns on same order)
* Integration hooks:

  * read WMS-Lite intake status
  * read SKU OS health to flag at-risk products
* Role-based access (ops vs support)
* SLA metrics (time to approve/refund)

**ENTERPRISE**

* Unlimited returns
* Custom policies per region / brand
* Deep integration with:

  * WMS-Lite (physical inspections)
  * ProblemSolve (quality issues)
  * InsightCore (returns + profitability analytics)
* Dedicated success manager
* Audit logging
* Priority support & uptime SLAs

---

### 2.2 SKU OS – Inventory Health & Product Risk

**Usage axis:** number of active SKUs.

#### 2.2.1 Pricing

| Plan       | PlanId     | MRR (USD)               | Max SKUs | Shopify? | Direct SaaS? | ARR Range |
| ---------- | ---------- | ----------------------- | -------- | -------- | ------------ | --------- |
| Free       | FREE       | $0                      | 30       | ✅        | ❌            | < $500k   |
| Pro        | PRO        | $79                     | 1,000    | ✅        | ✅            | $500k–$3M |
| Pro+       | PRO_PLUS   | $149                    | 3,000    | ✅        | ✅            | $1M–$10M  |
| Elite      | ELITE      | $399                    | 10,000   | ✅        | ✅            | $5M–$25M  |
| Enterprise | ENTERPRISE | custom (from ~$18k ACV) | custom   | ❌        | ✅            | $10M+     |

#### 2.2.2 Feature by Plan

**FREE (SKU OS)**

* Up to 30 SKUs
* Basic low-stock alerts (threshold)
* Basic over-stock alert (simple days-of-supply heuristic)
* 7-day velocity only
* Single location only
* No forecasting
* No degradation logic
* No exports

**PRO**

* Up to 1,000 SKUs
* Stockout-risk scoring (simple level)
* 7 & 30-day velocity
* Basic days-of-supply
* Tagging of fast/slow movers
* Manual lead-time per SKU
* Simple restock recommendations
* CSV export of SKU list & health

**PRO_PLUS**

* Up to 3,000 SKUs
* Improved stockout risk (lead-time aware)
* Over-stock detection w/ aging
* Per-supplier and per-category views
* Top risk SKUs board (attention view)
* Simple 30-day forecast (orders/units)
* Combined view across 2 inventory locations (aggregated)

**ELITE**

* Up to 10,000 SKUs
* Multi-location view (per location + global)
* Return-driven degradation inputs (from ReturnNexus)
* Issue-driven degradation (from ProblemSolve)
* Degradation engine as in SKU OS blueprint
* Segment-level attention (by category/supplier)
* Forecast overlays (base + adjusted)
* Cross-module hints (SKUs causing high returns / issues)

**ENTERPRISE**

* Unlimited SKUs
* Multi-warehouse modeling (with WMS-Lite)
* Custom health scoring components
* Deeper forecast features (seasonality, campaigns)
* Dedicated analyst support / onboarding
* Private SLA & support

---

### 2.3 WMS-Lite – Warehouse Execution

**Usage axis:** number of warehouse users and warehouses.

#### 2.3.1 Pricing

| Plan       | PlanId     | MRR (USD)               | Users  | Warehouses | Shopify? | Direct SaaS? |
| ---------- | ---------- | ----------------------- | ------ | ---------- | -------- | ------------ |
| Free       | FREE       | $0                      | 1      | 1          | ✅        | ❌            |
| Pro        | PRO        | $99                     | 3      | 1          | ✅        | ✅            |
| Pro+       | PRO_PLUS   | $199                    | 10     | 1          | ✅        | ✅            |
| Elite      | ELITE      | $499                    | 25     | 1          | ✅        | ✅            |
| Enterprise | ENTERPRISE | custom (from ~$20k ACV) | custom | 2+         | ❌        | ✅            |

#### 2.3.2 Feature by Plan

**FREE (WMS-Lite)**

* 1 user, 1 warehouse
* Simple receiving
* Manual inventory updates
* Single “bin” concept (no deep layout)
* Basic picking list generation (PDF)
* No return intake
* No pack/ship workflows
* No mobile UI

**PRO**

* 3 users
* Zones, shelves, bins
* Basic mobile picklists
* Receive → stow flows
* Simple packing confirmation
* Basic inventory ledger (append-only)
* Single warehouse

**PRO_PLUS**

* 10 users
* Batch picking
* Pick path suggestions (simple)
* Pack verification (scan items)
* Return intake (mark as returned)
* Basic latency metrics (pick, receive)
* Per-user activity log (simple)

**ELITE**

* 25 users, 1 warehouse
* Return inspection capture (physical condition only)
* Camera-based receive & return flows
* SLA metrics for return inspections
* Advisories from OrderNexus (FulfillmentProfitSignal)
* Advanced picking options (wave, zone)
* Warehouse performance dashboards

**ENTERPRISE**

* Unlimited users
* Multiple warehouses
* Custom routing logic
* WMS → ERP integrations
* 24/7 support & SLAs
* Implementation services

---

### 2.4 ProblemSolve – Issues & Quality

**Usage axis:** issue count per month.

#### 2.4.1 Pricing

| Plan       | PlanId     | MRR (USD)               | Issue Volume / Month | Shopify? | Direct SaaS? |
| ---------- | ---------- | ----------------------- | -------------------- | -------- | ------------ |
| Free       | FREE       | $0                      | 20                   | ✅        | ❌            |
| Pro        | PRO        | $49                     | 500                  | ✅        | ✅            |
| Pro+       | PRO_PLUS   | $99                     | 2,000                | ✅        | ✅            |
| Elite      | ELITE      | $249                    | 10,000               | ✅        | ✅            |
| Enterprise | ENTERPRISE | custom (from ~$12k ACV) | custom               | ❌        | ✅            |

#### 2.4.2 Feature by Plan

**FREE (ProblemSolve)**

* Up to 20 issues/month
* Manual issue creation
* Basic fields: type, severity, title
* Single status path (open → resolved)
* No media
* No root cause codes
* No outbound events

**PRO**

* Up to 500 issues/month
* Media attachments (images)
* Standard workflow (OPEN, IN_PROGRESS, RESOLVED)
* Root cause fields
* Basic reporting: issues over time, by type/severity
* Link issues to orders & SKUs

**PRO_PLUS**

* Up to 2,000 issues/month
* More granular root causes
* Warehouse step dimension (receive/pick/pack/return)
* SLA timers (time to first action, resolution)
* Basic automation:

  * e.g. auto-assign based on type
* Alerts to Slack/email

**ELITE**

* Up to 10,000 issues/month
* Issues → SKU OS quality events (ProductQualityEvent)
* Issues → ReturnNexus context (ReturnQualityContextEvent)
* Issues → InsightCore analytics events
* Issues → Echo Hub tasks (IssueTaskPayload)
* Supplier & warehouse scorecards
* RCA views (repeat offenders: SKUs, suppliers, steps)

**ENTERPRISE**

* Unlimited issues
* Full RCA program features (audit logs, extra fields)
* Custom integrations (e.g. ticketing systems)
* Advanced reporting
* Dedicated support

---

### 2.5 MarginCore – Cost Models & Financial Intelligence

**Usage axis:** complexity, not raw volume; we still cap by merchant scale.

#### 2.5.1 Pricing

| Plan       | PlanId     | MRR (USD)               | Complexity               | Shopify? | Direct SaaS? |
| ---------- | ---------- | ----------------------- | ------------------------ | -------- | ------------ |
| Free       | FREE       | $0                      | Very basic               | ✅        | ❌            |
| Pro        | PRO        | $79                     | Basic multi-factor       | ✅        | ✅            |
| Pro+       | PRO_PLUS   | $149                    | Advanced configs         | ✅        | ✅            |
| Elite      | ELITE      | $399                    | Versioning + simulation  | ✅        | ✅            |
| Enterprise | ENTERPRISE | custom (from ~$15k ACV) | enterprise finance stack | ❌        | ✅            |

#### 2.5.2 Feature by Plan

**FREE (MarginCore)**

* One cost model
* Flat shipping cost
* Flat packaging cost
* Single payment fee %
* Single overhead %
* No versioning
* No simulation
* No integration to OrderNexus

**PRO**

* Multiple cost components:

  * Shipping tiers
  * Packaging per SKU or category
  * Payment fees with fixed + %
* Different models per channel
* Simple impact view on recent orders (no recomputation)

**PRO_PLUS**

* Multiple draft models
* “What if” simulation on last 7 days of orders
* Simple versioning (named cost models)
* Basic rules for min margin alerts
* Export of cost model settings

**ELITE**

* Full CostModelSnapshot and CostModelVersioning as in blueprint
* Recomputation policies per version
* “All orders since X” simulations
* Cost model history and change audit
* Integration to OrderNexus for profit computation
* Alerting for high cost-to-serve orders

**ENTERPRISE**

* Multi-region cost models
* Direct finance team workflow (approval, roles)
* Dedicated support & finance onboarding call
* Extended simulation windows (30–90 days)
* Custom integrations (ERP/BI)

---

### 2.6 OrderNexus – Order Profitability Engine

**Usage axis:** orders analyzed; but for simplicity in Shopify we don’t hard cap orders, we cap features & complexity.

#### 2.6.1 Pricing

| Plan       | PlanId     | MRR (USD)               | Orders Scope               | Shopify? | Direct SaaS? |
| ---------- | ---------- | ----------------------- | -------------------------- | -------- | ------------ |
| Free       | FREE       | $0                      | last 30 orders             | ✅        | ❌            |
| Pro        | PRO        | $49                     | all orders (simple cost)   | ✅        | ✅            |
| Pro+       | PRO_PLUS   | $149                    | all orders (advanced cost) | ✅        | ✅            |
| Elite      | ELITE      | $399                    | integrated with MarginCore | ✅        | ✅            |
| Enterprise | ENTERPRISE | custom (from ~$20k ACV) | full CNS integration       | ❌        | ✅            |

#### 2.6.2 Feature by Plan

**FREE (OrderNexus)**

* Profitability view for last 30 orders only
* Basic cost model (flat shipping, payment fee)
* Simple profit status (good / bad)
* Basic list & top 5 unprofitable orders
* No export
* No channel breakdown

**PRO**

* All orders loaded
* Channel breakdown (Shopify channels)
* Per-order profit & margin %
* Basic profit status segments (healthy / at risk / unprofitable)
* Simple filters (by date, channel, tag)
* CSV export (limited rows)

**PRO_PLUS**

* Advanced cost options (shipping tiers, different fees)
* Segment profitability (by country, channel, tag)
* Customer-level profit summary (basic)
* Product-level profit summary (basic)
* Alert when % of unprofitable orders exceeds threshold

**ELITE**

* Full integration with MarginCore cost models
* Return-adjusted profitability (using ReturnNexus events)
* Quality-adjusted profitability (using ProblemSolve/SKU OS degradation inputs for cost-to-serve)
* VIP vs high-risk customer segments
* Profitability dashboards for channels & campaigns
* Advanced exports / API access

**ENTERPRISE**

* All of ELITE
* Custom dashboards via InsightCore
* SLA & support
* Multi-store / multi-brand consolidation
* Top-down profitability modeling (projection, scenario runs)

---

## 3. Revenue Model & ACV Targets (Locked Bands)

### 3.1 Target MRR / ACV by Merchant Size

| Merchant ARR | Typical Tier Mix                            | Expected MRR Range | Expected ARR/ACV |
| ------------ | ------------------------------------------- | ------------------ | ---------------- |
| $100k–$500k  | 0–1 Pro per module, mostly Free             | $0–$50             | $0–$600          |
| $500k–$2M    | 1–2 modules on Pro/Pro+                     | $50–$200           | $600–$2,400      |
| $2M–$10M     | 2–3 modules Pro+/Elite                      | $150–$600          | $1,800–$7,200    |
| $10M–$25M    | 3–4 modules Elite                           | $500–$2,000        | $6,000–$24,000   |
| $25M–$50M    | 4–6 modules Elite + some Enterprise add-ons | $1,500–$4,500      | $18,000–$54,000  |
| $50M+        | Enterprise suite                            | $12k–$150k ACV     | $12k–$150k       |

These are **planning bands** to ensure you’re not underpricing.

---

## 4. Governance: How Changes Are Allowed (or Not)

### 4.1 What is Locked in v1

* `PricingPlanId` enum and its semantics.
* For each module:

  * plan IDs
  * base monthly prices
  * primary volume caps (returns, SKUs, issues, users, etc.)
  * key feature boundaries (what belongs to free vs paid vs Elite).

### 4.2 What Can Change Without v2 (Limited)

Allowed (within v1, no contract bump):

* adding **new** features to higher plans (never downwards),
* minor UX improvements,
* changing internal implementation while preserving external behavior.

Not allowed without v2:

* moving features **down** from paid → free,
* lowering prices without adjustment plan,
* increasing free usage caps significantly,
* redefining plan semantics (e.g., making ELITE cheap).

If you do any of that, you’re breaking the system and need v2 + explicit migration.

---

## 5. Blunt Reality Check

* If you start “being generous” with free and Pro and leaking Elite features downward, you will **destroy your own ACV ladder**.
* If you try to be cute with custom deals all over the place, your pricing logic becomes meaningless, forecasting dies, and you lose control of margins.
* This contract is what prevents that: it forces discipline.
