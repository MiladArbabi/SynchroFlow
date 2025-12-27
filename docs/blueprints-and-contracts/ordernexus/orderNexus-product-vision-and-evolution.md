# **Document 5: OrderNexus - Product Vision & Evolution**
**Version:** 2.0 (Locked Blueprint)
**Last Updated:** 2025-01-15
**Related Documents:**
- OrderNexus - Core Architecture & Boundaries
- OrderNexus - CNS Integration Blueprint

---

# 🔵 OrderNexus — CNS Module Blueprint (LOCKED v2.0)

## 15. Job To Be Done (JBTD)

OrderNexus replaces "Revenue Vanity" with "Profit Reality" by revealing the precise unit economics of every single transaction.

**Typical merchant mindset:**
> "Revenue was up 20%, we're doing great."

**Reality:** shipping, fees, ads, and returns quietly erased the margin.

OrderNexus behaves like a forensic profit engine:

* **Per order,** it computes what actually hit the bank.
* **Per cohort,** it reveals why certain slices of the business bleed while others print money.

## 16. Phase Model

OrderNexus evolves in three phases, which map to feature + pricing maturity, not code branches.

### Phase 1 — "The Accountant" (FT0–FT1 Core)

**Goal:** Accurate historical reporting.  
**Question answered:** *"What did I really make yesterday / last week / last month?"*

**Capabilities:**

* Ingest orders into canonical form.
* Apply static COGS per SKU (from SKU-OS or manual).
* Deduct known:
* payment fees (Stripe/Shopify)
* shipping label costs
* platform fees where possible.
* Compute stable, auditable per-order profitability.

**Merchant actions:**

* Fill missing COGS.
* Confirm shipping & fee assumptions.
* Review per-order Profit Autopsy.

### Phase 2 — "The Analyst" (Growth)

**Goal:** Explain drivers of profitability.  
**Question answered:** *"Why is margin low in this country/channel/segment?"*

**Capabilities:**

* Overhead allocation rules (marketing, tools, ops) into per-order economics.
* Basic return impact from ReturnNexus (actual vs expected profit).
* Profitability slicing:
* by channel / traffic source
* by geography
* by SKU class / bundle group.
* Profit tiers / personas (Winners, Drifters, Bleeders).

**Merchant actions:**

* Define overhead distribution rules.
* Investigate profit drivers by channel / region / SKU cohort.
* Tune tolerance thresholds for alerts (e.g. "flag <15% margin in EU").

### Phase 3 — "The CFO" (Architect)

**Goal:** Actively shape future profitability.  
**Question answered:** *"How do I increase net margin by 2–3 points without reckless guessing?"*

**Capabilities:**

* **Simulation Sandbox (what-if scenarios):**
* price change
* shipping cost rise
* fee changes
* CAC / paid traffic shocks.
* Prescriptive suggestions (long term, not FT0):
* recommended price adjustments per SKU or range
* suggested shipping rule adjustments
* warnings on structurally unprofitable bundles.
* Integration with InsightCore and Specter for demand + elasticity-aware decisions.

**Merchant actions:**

* Run "what if" scenarios before changing price / shipping.
* Accept or reject suggested changes.
* Configure automated guardrails (e.g. "block new campaigns on SKUs under 10% margin").

## 17. Analytics Primitives — The Profit Ledger

OrderNexus owns the canonical per-order **Profit Ledger**.

Per `canonical_order_id`, we persist a **Profit Ledger row** with at least:

* `gross_revenue`
* `landed_cost_total`  
  * COGS + inbound freight / duties where available.
* `fulfillment_cost_actual`  
  * Pick/pack + label, or best estimate.
* `transaction_fees_total`  
  * Payment gateway + platform fees.
* `acquisition_cost_attributed`  
  * Per-order CAC; can be 0 or estimated.
* `overhead_allocated`  
  * Allocated fixed/variable overhead from MarginCore/Config.
* `net_profit_absolute`
* `net_margin_percent`
* `profit_tier`  
  * `'winner' | 'drifter' | 'bleeder' | 'loss_leader'`

**Leakage + diagnostics**

* `leakage_amount`  
  * Difference vs the expected standard model; anomaly budget.
* `leakage_severity_index` (0–1)  
  * Normalized indicator of how abnormal this order is from a cost/profit perspective.
* `profitability_dna`  
  * `'cac-heavy' | 'shipping-heavy' | 'sku-heavy' | 'discount-heavy' | 'refund-prone' | 'cross-sell-seeder' | 'high-margin-hero' | 'low-margin-filler'`.

* `profit_causation`:
  * `primary`: `'shipping' | 'fees' | 'cogs' | 'discounts' | 'returns' | 'cac' | 'overhead'`
  * `secondary`: `string[]`

**Confidence & overrides**

* `cost_confidence_score` (0–1)  
  * Quality of cost inputs (COGS completeness, override frequency, stability).
* `attribution_confidence_score` (0–1)  
  * Reliability of acquisition cost attribution.
* `overrides`:
  * `user_marked_loss_leader?: boolean`
  * `user_adjusted_cost?: boolean`
  * `user_adjusted_attribution?: boolean`
  * `user_annotated_reason?: string`

**Versioning (for auditability)**

* `profit_version_id`
* `previous_profit_version_id?`
* `delta_reason?`  
  * `'cogs_update' | 'fee_change' | 'shipping_update' | 'return_event' | 'manual_override' | 'config_change'`

This schema is the **conceptual contract**; the SQL table in §10 must remain compatible with these fields, even if some are stored in JSONB in v1 and later split out into columns.

This allows:

* time-travel profit history,
* batch recomputation,
* transparent corrections.

## 18. Core Widgets & Surfaces

### 18.1 Free Tier / Always-On Surfaces (FT0, within FTEP limits)

These are the minimum experiences OrderNexus must always offer while within free-tier usage.

* **Profit Autopsy Card (Hero)**
    For an individual order: visual breakdown of revenue vs cost components (bar or waterfall). Clear *"You actually made X"* statement. This is the primary FT0 "Aha!" moment.

* **Bleed Feed (Recent Loss-Making Orders)**
    List of top N most recent orders with negative net profit. Shows: order id, revenue, net profit, primary cause (from `profit_causation.primary`).

* **Missing Costs Counter**
    "X orders missing COGS" + CTA to "Fix missing costs." Drives data integrity and keeps merchants engaged.

* **Basic Profit Trendline**
    Net margin % over time (daily/weekly). FT0 variant is read-only, no deep segmentation, no simulation.

* **Simple "Profit by Channel" Snapshot (Lite)**
    Very shallow breakdown: e.g. top 3 channels with revenue and net margin %. No deep drilldowns in FT0.

*These surfaces remain accessible while `order-nexus.freeTierState === 'free_tier_active'` (see FTEP contract).*

### 18.2 Growth / Paid Surfaces (Beyond Free Tier)

These become progressively paywalled beyond basic free tier limits and/or plan:

* **Full Profitability Explorer**
    Pivotable view: by channel, region, SKU class, bundle group, new vs returning, etc. Heatmaps, treemaps, sortable tables.

* **Fee Structure Analysis**
    "Where does your margin go?" Treemap: COGS vs shipping vs CAC vs fees vs overhead.

* **Profitability Personas / Cohort Cards**
    "Bleeder SKUs", "Sleeper Winners", "High Volume / Low Margin", "Return-Prone".

* **Simulation Sandbox (Architect tier hero)**
    Ask *"What if…"* about: prices, shipping costs, fee changes, CAC shifts. Output: how many orders / cohorts flip from Winner → Drifter → Bleeder.

* **Automated Profit Rules & Alerts**
    e.g. "Flag orders under 10% margin," "alert when shipping exceeds X% of revenue." Integration with Problem Center for persistent "profit problems".

* **Prescriptive Pricing & Rule Suggestions (Long term)**
    Powered by OrderNexus + InsightCore + Specter. Example recommendations:
* "Increase price of SKU X by 7% to maintain target margin given rising CAC."
* "Raise shipping fee in Region B to cover structural cost increases."
* "Stop offering free shipping on this bundle; it creates Bleeders."

## 19. Actions & Clear Paths

Every insight must resolve into a next step. OrderNexus must support at least:

* **Retrofit COGS**
    Bulk apply COGS to historical orders (via SKU-OS / cost settings).
* **Stop the Bleeding**
    Jump from a loss-making order / cohort directly to: SKU config in SKU-OS, shipping / fulfillment rules in WMS Lite (future).
* **Mark as Loss Leader**
    Explicit merchant override: "This was intentionally unprofitable." Adjusts thresholds and prevents false alarms.
* **Dispute Label / Cost Spike (Phase 2)**
    Flag abnormal shipping / fee charges for manual review.

All of these feed into a **Closed Loop** where: `user fixes data → OrderNexus recomputes → Problem Center reflects reduced issues`.

## 20. Closed Loop & Learning

OrderNexus must support learning from corrections:

* **Cost Confidence Score per SKU/vendor:** repeated manual corrections → lowered confidence → prompts deeper integration (CSV import, ERP sync).
* **Leakage Tolerance:** dismissed alerts adjust local thresholds (per SKU category / region).
* **Attribution Tuning:** manual changes to acquisition source inform future attribution weights for that cohort.

*These are Phase 2+ behaviors, but the data fields for them must exist from v1 in the Profit Ledger.*

## 21. Free Tier Exposure & Gating (FTEP Alignment)

OrderNexus uses the global Free Tier policy:

* **Metric:** `orders`
* **Max Free Tier Units:** 50 orders per month

Signals produced by readiness providers:

* `order-nexus.freeTierState`: `ModuleAccessState`
* `order-nexus.freeTierRemaining`: `number | null`

**States:**

1. `visible` - Tab visible, module not yet initialized (no usage).
2. `free_tier_active` - Full free surfaces enabled (Profit Autopsy, Bleed Feed, basic trendline, simple profit-by-channel) up to 50 orders/month.
3. `free_tier_exhausted` - Free Tier limit reached. Read-only experience; CTAs focus on Upgrade and high-level summaries.
4. `locked` - No access (plan restriction). OrderNexus tab shows a `LockedFeaturePage` with value-driven pitch.

**Advanced intelligence surfaces are strictly paid:**

* Full Profitability Explorer (deep pivoting by cohort / DNA)
* Fee Structure Analysis / Profit Treemaps
* Simulation Sandbox ("what if cost / price / CAC changes?")
* Automated profit rules & alerts
* Prescriptive pricing / shipping / promo suggestions

These **must never** be fully available on the free tier, even within the first 50 processed orders.  
Free-tier merchants only see **teaser variants** or upsell stubs, not the complete interactive experience.

## 22. Contract Stability

The following are considered locked for v1 unless explicitly versioned:

* **Readiness signal names:**
* `orderNexus.ordersIngested`
* `orderNexus.profitabilityActive`
* `order-nexus.freeTierState`
* `order-nexus.freeTierRemaining`
* **FTEP configuration for OrderNexus:**
* `metric`: `orders`
* `maxUnits`: `50`
* `resetPeriod`: `monthly`
* The existence of the **Profit Autopsy Card** as the hero FT0 experience.
* The general structure of the **Profit Ledger** fields (names may be refined, but semantics stay).

**This is the v2.0 blueprint you freeze into your docs and your repo.**

If anyone deviates from these contracts without first versioning them (e.g. `OrderNexus_v3`), they're not building *OrderNexus* – they're building something else.

---

**End of Document 5: Product Vision & Evolution**