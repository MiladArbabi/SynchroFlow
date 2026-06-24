# Finances Module — Architecture & System Design

**Module:** `finances` / `@lasyncro/finances`  
**Surface:** FT2 web app — two tabs: Intelligence + Margin  
**Status:** ✅ Fully working with real data (as of 2026-05-13)  
**Tier gate:** `finances.overview` requires `growth` tier (`usePlanEntitlement`)

---

## 1. Purpose

The Finances module answers the core SMB commerce question: **"Am I actually making money on what I'm shipping?"**

Not in aggregate — per order, per SKU, per constraint state.

**Target audience:** 1–10 operators, $100K–$50M revenue, own warehouse, high SKU complexity. Primary pain: data fragmentation, Excel chaos, no unified cost + revenue + warehouse view.

It has two tabs with distinct purposes:

### Intelligence Tab (`/finances`)

Answers: *What is my financial health right now? What needs immediate action?*

- Net margin pulse (revenue − cost − refunds)
- Cost coverage gap (how many SKUs have no cost entered)
- Refund leakage signal
- Blocked revenue at margin (cross-domain: warehouse operational state × financial reality)
- Negative margin order alert

### Margin Tab (`/finances/margin`)

Answers: *Which orders and SKUs are making or losing money?*

- Per-order margin breakdown (sortable, filterable by fulfillment status)
- Per-SKU margin breakdown (sortable, physical products only)
- Margin trend chart (30/90d)
- Margin distribution bar (min/avg/max)
- Negative margin SKU highlighting ("LOSING MONEY" badge)

**Cost entry** lives in `/products/costs` — not duplicated here. Intelligence tab CTAs navigate there directly.

---

## 2. Full Data Flow

```
Browser
  │
  ├── Tab 1: Intelligence (/finances)
  │     └── useFinancesIntelligence()
  │           └── GET /api/v1/modules/finances/intelligence
  │                 └── finances.intelligence.controller.ts
  │                       └── db.transaction (withTenant via SET LOCAL)
  │                             ├── order_margin_snapshot — net margin, avg margin %, negative orders
  │                             ├── refund_executions — total refunds (leakage)
  │                             ├── variants — cost coverage (unit_cost = 0 count)
  │                             └── orders_operational_control_snapshot — blocked revenue
  │
  ├── Tab 2: Margin (/finances/margin)
  │     ├── useMargin()
  │     │     └── GET /api/v1/modules/finances/margin
  │     │           └── finances.margin.controller.ts (db.transaction + SET LOCAL)
  │     │                 ├── order_margin_snapshot JOIN orders — summary + per-order list
  │     │                 └── order_fulfillment_status — status filter
  │     │
  │     ├── useSkuMargin()
  │     │     └── GET /api/v1/modules/finances/margin/sku
  │     │           └── finances.margin.sku.controller.ts (db.transaction + SET LOCAL)
  │     │                 └── order_revenue_units JOIN orders JOIN variants JOIN products
  │     │                       — physical products only (excludes gift_card, digital, service)
  │     │
  │     └── useMarginTrend(days)
  │           └── GET /api/v1/modules/finances/margin/trend?days=N
  │                 └── finances.margin.trend.controller.ts (db.transaction + SET LOCAL)
  │                       └── order_margin_snapshot JOIN orders — daily avg margin %, total margin
  │
  └── FT2 Snapshot (used by Intelligence tab for epistemic context)
        └── useFinancesFt2Snapshot(range)
              └── GET /api/v1/modules/finances/ft2
                    └── getFinancesFt2Snapshot()
                          └── buildFinancesFacts() → buildFinancesIntelligence() → buildFinancesFtep()
```

---

## 3. File Map

### Frontend

| File | Role |
|---|---|
| `apps/frontend/src/pages/ft2-pages/FinancesFT2Page.tsx` | Gate + tab router — `ModuleTabBar` + `Routes` |
| `apps/frontend/src/pages/ft2-pages/FinancesIntelligencePage.tsx` | Intelligence tab — date range bar + signal rendering |
| `apps/frontend/src/pages/ft2-pages/FinancesMarginPage.tsx` | Margin tab — date range bar (drives trend days) + margin UI |
| `apps/frontend/src/pages/finances/useFinancesIntelligence.ts` | Hook: `GET /finances/intelligence` |
| `apps/frontend/src/pages/finances/useFinancesFt2Snapshot.ts` | Hook: `GET /finances/ft2` |
| `apps/frontend/src/pages/finances/useFinancesFt2Adapter.ts` | Pure adapter — snapshot → `FinancesModuleFT2Props` |
| `apps/frontend/src/pages/finances/useMargin.ts` | Hook: `GET /finances/margin` |
| `apps/frontend/src/pages/finances/useSkuMargin.ts` | Hook: `GET /finances/margin/sku` |
| `apps/frontend/src/pages/finances/useMarginTrend.ts` | Hook: `GET /finances/margin/trend` |

### Module UI

| File | Role |
|---|---|
| `modules/finances/src/ui/pages/FinancesModuleFT2.tsx` | Margin tab UI — pulse cards, distribution bar, trend chart, SKU + order tables |
| `modules/finances/src/ui/pages/FinancesModule.tsx` | FT1 fallback |

### Backend — API Layer

| File | Role |
|---|---|
| `apps/backend/src/api/finances/finances.routes.ts` | **Canonical router** — all finances routes registered here |
| `apps/backend/src/api/finances/finances.ft2.controller.ts` | `GET /ft2` — FT2 epistemic snapshot |
| `apps/backend/src/api/finances/finances.intelligence.controller.ts` | `GET /intelligence` — aggregated intelligence signals |
| `apps/backend/src/api/finances/finances.margin.controller.ts` | `GET /margin` — shop summary + per-order breakdown |
| `apps/backend/src/api/finances/finances.margin.sku.controller.ts` | `GET /margin/sku` — per-SKU margin (physical only) |
| `apps/backend/src/api/finances/finances.margin.trend.controller.ts` | `GET /margin/trend` — daily margin trend |
| `apps/backend/src/api/finances/finances.epistemic.controller.ts` | `GET /epistemic` — explicit epistemic truth surface |
| `apps/backend/src/api/finances/index.ts` | Re-exports `finances.routes.ts` |

### Backend — Services

| File | Role |
|---|---|
| `apps/backend/src/services/finances-ft2.provider.ts` | Orchestrates Facts → Intelligence → FTEP pipeline. Wraps `buildFinancesFacts` in `withTenant`. |
| `apps/backend/src/services/finances-facts/FinancesFacts.service.ts` | Raw DB facts — revenue, refunds, timeseries. Accepts `trx?` — always called via `withTenant`. |
| `apps/backend/src/services/finances-intelligence/FinancesIntelligence.service.ts` | Pure computation — no DB. Classifies blind spots, confidence, decision safety. |
| `apps/backend/src/services/finances-ftep/FinancesFtep.service.ts` | Truth exposure policy — strips sensitive intelligence, downgrades to FT2-safe observability. |

---

## 4. API Contracts

### `GET /api/v1/modules/finances/intelligence`

**Auth:** `authenticateToken` + `requireFt2`  
**State-based** — not period-scoped. Reflects current shop financial reality.

```typescript
{
  totalRevenue: number;          // SUM(gross_revenue) from order_margin_snapshot
  totalCost: number;             // SUM(estimated_cost) from order_margin_snapshot
  totalMargin: number;           // SUM(gross_margin) from order_margin_snapshot
  avgMarginPct: number;          // AVG(margin_pct) * 100
  totalRefunds: number;          // SUM(total_refund_amount) from refund_executions
  netMargin: number;             // totalMargin - totalRefunds
  netMarginPct: number | null;   // netMargin / totalRevenue * 100
  negativemarginOrders: number;  // COUNT WHERE margin_pct < 0
  costCoverage: {
    totalVariants: number;       // active variants count
    zeroCostCount: number;       // active variants with unit_cost = 0
    coveragePct: number | null;  // % with cost entered
  };
  blockedRevenue: number | null;       // from orders_operational_control_snapshot
  blockedMarginValue: number | null;   // blockedRevenue × (avgMarginPct / 100)
  constrainedOrders: number | null;    // from orders_operational_control_snapshot
}
```

### `GET /api/v1/modules/finances/margin`

**Auth:** `authenticateToken` + `requireFt2`  
**Query params:** `status` (all | pending | fulfilled), `page`, `limit` (max 100)

```typescript
{
  summary: {
    order_count: number;
    total_revenue: number;
    total_cost: number;
    total_margin: number;
    avg_margin_pct: number;
    min_margin_pct: number;
    max_margin_pct: number;
  };
  orders: Array<{
    order_id: string;
    gross_revenue: string;
    estimated_cost: string;
    gross_margin: string;
    margin_pct: string;
    fulfillment_status: string | null;
    evaluated_at: string;
  }>;
  pagination: { page: number; limit: number };
}
```

### `GET /api/v1/modules/finances/margin/sku`

**Auth:** `authenticateToken` + `requireFt2`  
**Query params:** `order` (asc | desc), `limit` (max 100)  
**Filters:** `product_type NOT IN ('gift_card', 'digital', 'service')` — physical products only

```typescript
{
  data: Array<{
    lasyncro_variant_id: string;
    sku: string | null;
    title: string | null;
    total_units_sold: number;
    gross_revenue: number;
    estimated_cost: number;
    gross_margin: number;
    margin_pct: number;
  }>;
}
```

### `GET /api/v1/modules/finances/margin/trend`

**Auth:** `authenticateToken` + `requireFt2`  
**Query params:** `days` (7–90, default 30)

```typescript
{
  data: Array<{
    date: string;
    avg_margin_pct: number;
    total_margin: number;
    total_revenue: number;
    order_count: number;
  }>;
  days: number;
}
```

### `GET /api/v1/modules/finances/ft2`

**Auth:** `authenticateToken` + `requireFt2`  
**Query params:** `preset` (FT2DateRangePreset), `from`, `to`  
**Returns:** `FinancesFT2Exposure` — epistemic snapshot (revenue observed, blind spots, decision safety, refund reality, cost reality, timeseries)

---

## 5. Database Tables Read

| Table | RLS Type | Used For |
|---|---|---|
| `order_margin_snapshot` | Strict ALL | Per-order margin facts — gross revenue, estimated cost, gross margin, margin % |
| `orders` | Strict ALL | Revenue aggregation (FT2 snapshot), JOIN anchor for margin queries |
| `refund_executions` | Strict ALL | Refund leakage — total refund amount |
| `variants` | Strict ALL | Cost coverage — `unit_cost = 0` count |
| `products` | Strict ALL | Product type filter — exclude gift cards, digital, service from SKU margin |
| `order_revenue_units` | Strict ALL | Per-SKU margin aggregation |
| `order_fulfillment_status` | Strict ALL | Status filter on per-order margin list |
| `orders_operational_control_snapshot` | Strict ALL | Blocked revenue at margin (cross-domain signal) |

**⚠️ All queries use `db.transaction` + `SET LOCAL app.current_tenant` or `withTenant`. Bare `db()` calls silently return 0 rows.**

---

## 6. RLS Pattern

`FinancesFacts.service.ts` accepts optional `trx` — always called via `withTenant` in the provider:

```typescript
// finances-ft2.provider.ts
const facts = await withTenant(input.shopId, (trx) => buildFinancesFacts(input, trx));

// FinancesFacts.service.ts
export async function buildFinancesFacts(
  input: BuildFinancesFactsInput,
  trx?: Knex | Knex.Transaction  // injected by withTenant — never call bare db() on RLS tables
): Promise<FinancesFacts> {
  const qb = trx ?? db;  // always use qb
  ...
}
```

Controllers use inline `db.transaction` + `SET LOCAL`:

```typescript
const result = await db.transaction(async (trx) => {
  await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
  return trx('order_margin_snapshot as oms')...
});
```

---

## 7. Frontend Architecture

### Tab Structure

```
FinancesFT2Page (gate + ModuleTabBar)
  ├── /finances          → FinancesIntelligencePage
  └── /finances/margin   → FinancesMarginPage
```

**`PlanGate feature="finances.overview"`** wraps the entire module — requires `growth` tier.

### Sidenav

```typescript
// SidenavContent.tsx relatedPaths
finances: ['/finances/margin'],
```

### Intelligence Tab Signals

| Signal | Source hook | Severity |
|---|---|---|
| Net margin % + amount after refunds | `useFinancesIntelligence` | Pulse card |
| Gross revenue / total cost / refund leakage / avg margin % | same | Pulse cards |
| Cost coverage % bar + missing count | same | Coverage bar |
| Negative margin orders | same | Critical signal |
| Refund leakage | same | Warning signal |
| Blocked revenue at margin | same | Warning signal (null when no operational snapshot) |
| Missing costs CTA → `/products/costs` | same | Warning signal |

### Margin Tab Features

- **Sortable columns:** Revenue, Cost, Margin, Margin %, Status (orders) + Units, Revenue, Cost, Margin, Margin % (SKUs)
- **Sort indicators:** ↑ green (ascending), ↓ red (descending)
- **Status filter:** All / Pending / Fulfilled (orders only)
- **Show top 20 / Show all** toggle for both tables
- **Negative margin rows:** red left border + `rgba(239,68,68,0.06)` background + "LOSING MONEY" badge
- **Margin color thresholds:** `>= 60%` green, `>= 40%` warning, `< 40%` red, `< 0%` #EF4444

### Theming

`FinancesModuleFT2.tsx` implements `useFinancesTheme()` (mirrors Overview/Orders/Products pattern):

```typescript
function useFinancesTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    isDark,
    cardBg:      isDark ? '#1C2740' : '#FFFFFF',
    border:      isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#8B8F9A' : '#6B7280',
    tileBg:      isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    chartBg:     isDark ? '#131C2B' : '#F8F9FA',
  };
}
```

`FinancesIntelligencePage.tsx` implements its own `useIntelligenceTheme()` (same token values, adds `pageBg`).

---

## 8. Facts → Intelligence → FTEP Pipeline

The FT2 snapshot follows the strict three-layer pipeline:

```
buildFinancesFacts()         — DB access only, no interpretation, nulls preserved
    ↓
buildFinancesIntelligence()  — pure computation, no DB, classifies blind spots + confidence
    ↓
buildFinancesFtep()          — strips sensitive intelligence, exposes FT2-safe observability only
```

**Key intelligence classifications:**

- `blindSpots.costsMissing` — `facts.totalCosts == null`
- `blindSpots.refundsMissing` — `facts.refundsObserved == null` (fact-based, NOT hardcoded)
- `decisionSafety` — `safe` only when coverage 100% + costs present + sufficient history
- `refundImpact` — `material` when `refundsObserved > 0`, `immaterial` when 0, `unknown` when null

**⚠️ `netResult` is always null** — `totalCosts` is hardcoded null in `FinancesFacts.service.ts` (no sovereign cost layer yet). Net result via the FT2 pipeline is therefore always `unknown`. The Intelligence tab computes net margin independently from `order_margin_snapshot` via the `/intelligence` endpoint instead.

---

## 9. Cross-Domain Signal — Blocked Revenue at Margin

The "blocked revenue at margin" signal is laSyncro-exclusive — requires both warehouse operational state and financial margin data:

```
orders_operational_control_snapshot.blocked_revenue   (warehouse domain)
    ×
AVG(order_margin_snapshot.margin_pct)                 (finances domain)
    =
blockedMarginValue                                    ("gross profit trapped in blocked orders")
```

Returns `null` gracefully when `orders_operational_control_snapshot` is empty (fresh install, no projection engine run yet).

CTA navigates to `/orders` — the owner resolves constraints there, which then unblocks fulfillment and realises the margin.

---

## 10. Known Issues / Gaps

### Screen-1 (Intelligence) Correctness Audit — 2026-06-23

| ID | Status | Description | Evidence | Fix |
|---|---|---|---|---|
| FIN-01 | ✅ RESOLVED 2026-06-23 | Headline "Net Margin" computed `gross_margin − refunds`, not true net, and mislabelled gross as net. `true_margin_pct` (purpose-built, WM-39) was never read. | Payload `netMargin==totalMargin`; `true_margin*` NULL on all 18 rows; `order_shipment_tracking` empty (0 shipments). | Backend surfaces `trueMargin`/`trueMarginPct`/`hasCarrierData` (`finances.intelligence.controller.ts`). Headline shows **Gross Margin** ("before shipping") when no carrier cost, switches to **True Margin** ("after shipping") once a label exists. Never labels gross as net. |
| FIN-02 | ✅ RESOLVED 2026-06-23 | **Revenue-completeness bug** (initial "stale snapshot" hypothesis disproven by audit). `computeOrderMargin` filtered `estimated_unit_cost > 0` at row level, dropping cost-less line items from **revenue** as well as cost. Order `c7bad89d…097c`: true 2365.85 → stored 1479.90, losing cost-less unit `7efbeddf…` (885.95). Caused the cross-screen revenue mismatch. | DB: `recon(line_total, cost>0 filter)=1479.90` vs `order.total_price=2365.85`; post-fix snapshot=2365.85, `remaining_drift=0`. | **Source fix** (`computeOrderMargin.service.ts`): revenue = `SUM(line_total)` over ALL units; cost = `SUM(...) FILTER (WHERE estimated_unit_cost>0)`; skip guard now on `cost_line_count`. A cost-less line correctly lowers margin instead of vanishing from revenue. **Hardening:** read-only `margin-snapshot-integrity.worker.ts` (every 5 min) detects future `snapshot.gross_revenue <> SUM(net_revenue)` drift and logs it — never writes. |
| FIN-03 | ✅ RESOLVED 2026-06-23 | Blocked-orders signal rendered at £0 and printed literal "null". Gate was `!= null` not `> 0`; title interpolated `constrainedOrders:null`. | `FinancesIntelligencePage.tsx:227/231`; payload `blockedRevenue:0, constrainedOrders:null`. | Gate now requires `blockedMarginValue > 0 && constrainedOrders > 0`; suppresses the £0/null card and the "null" leak. |

**Deferred:** Consumables cost (tape/labels/box/dunnage) not modelled in true margin — [issue #1020](https://github.com/MiladArbabi/SynchroFlow/issues/1020). Out of scope for this audit.

**Carried to Screen 2 (Cash Flow):**

- **FIN-07 🟡** — Cash Flow `realized_revenue` ≠ Intelligence `totalRevenue` (post-rebuild: 16686.40 vs 32071.60). Different population: Cash Flow filters `order_fulfillment_status='fulfilled'`, Intelligence counts all margin-snapshot orders. To be pinned in Screen 2 audit — determine authoritative scope. Not a regression from FIN-02 (Intelligence side verified correct at 32071.60).

---

### Screen-2 (Cash Flow) Correctness Audit — 2026-06-23

| ID | Status | Description | Evidence | Fix |
|---|---|---|---|---|
| FIN-07 | ✅ RECLASSIFIED 2026-06-23 | Not a defect. Intel `totalRevenue` is the whole order book (`SUM(oms.gross_revenue)`); Cash Flow splits the same number into `realized` (fulfilled) + `pending` (paid-unfulfilled). On reseeded data: 3,177.35 ≡ 1,918.40 + 1,258.95. | API: `intel.totalRevenue=3177.35`; `cashflow.summary.realized_revenue=1918.40 + pending_revenue=1258.95=3177.35`. | No code change. UX-phase action: label Cash Flow's headline as **Realized** explicitly so cross-screen comparisons stop reading as inconsistency. |
| FIN-08 | ✅ VERIFIED CORRECT 2026-06-23 | Formula `workingCapital = inventoryValue + pendingRevenue` (`cashFlowProjection.service.ts:268`) is correct. Earlier "Working Capital == Inventory Value" observation was a coincidence on a dataset where `pending_revenue = 0`. | Today: 16,975 + 1,258.95 = 18,233.95 ✓ matches API exactly. | No code change. |
| FIN-09 | ✅ RESOLVED 2026-06-23 | 60-day projection rendered only **2 distinct series** (conservative ≠ base, but base ≡ optimistic). Comment said "blocked orders releasing"; code used `atRiskRevenue` (constrained orders). With at-risk=0 (common case), optimistic collapsed onto base. Even with at-risk>0, the source was semantically wrong (constrained ≠ blocked). | API pre-fix: `last={conservative:-7770.52, base:-4371.36, optimistic:-4371.36}`, `distinct:false`. Post-fix with injected `blocked_revenue=2500`: `optimistic:-1871.36` (= base + 2500), `distinct:true`. | New query `blockedRow` on `orders_operational_control_snapshot.blocked_revenue` (mirrors Intelligence's cross-domain field). `optimisticBoost = blockedRevenue` (`cashFlowProjection.service.ts:298`). Three scenarios now semantically and visually distinct whenever blocked orders exist. |
| FIN-10 | ✅ RESOLVED 2026-06-23 | Past-dated PO commitments (status `shipped`/`in-transit`, delivery overdue) were silently dropped from the projection by the week-1 lower bound (`expected_delivery_date >= today`), yet still emitted in `po_outflows` and surfaced in UI as "Upcoming." Under-modelled committed cash by $7,860 on the seed dataset (4 POs × ~$1,965). | API pre-fix: `week1.base=447.63` (overdue $7,860 not pulling). Post-fix: `week1.base=-7412.37` (drop of exactly $7,859.63 ✓). `po_total=$16,260` confirms all open PO commitments now flow through the projection. | Week-1 loop filter relaxed: `if (week === 1) return due < weekDate;` — week 1 sweeps every open PO with delivery date before end of week 1 (overdue + due-this-week). Other weeks unchanged (`[weekStart, weekDate)`). |

**Deferred:**
- **FIN-11 🟡** — `orders_operational_control_snapshot` and `order_margin_snapshot` are not populated by the dev seed (same class as FIN-02's original "no events to project" trap, different tables). `backfill:margin` covers `order_margin_snapshot`; the operational snapshot remains empty without a real reconciliation event flow. `orders_operational_control_snapshot` is also append-only (`IMMUTABILITY_VIOLATION` on DELETE). Logged for a later seed-completeness pass — does not block Screen 3.

**Carried to Screen 3 (Margin):**
- Initial register pending (FIN-06 was "Margin tab stuck on `Loading margin data…`" from the original screenshots).

---

### Screen-3 (Margin) Correctness Audit — 2026-06-23

| ID | Status | Description | Evidence | Fix |
|---|---|---|---|---|
| FIN-06 | ✅ RESOLVED 2026-06-23 | `/api/v1/modules/finances/margin` returned **HTTP 500** on every call: Postgres rejected `ROUND(AVG(oms.true_margin_pct) * 100, 1) FILTER (WHERE oms.true_margin_pct IS NOT NULL)` with `FILTER specified, but round is not an aggregate function`. The frontend's TanStack query stayed in `pending` indefinitely, freezing the Margin tab on **"Loading margin data…"** — the original screenshot's hang. | API pre-fix: HTTP 500 with the verbatim Postgres error. Trend endpoint (same DB) returned 30 orders / 3,177.35 revenue cleanly, proving the data existed and only the summary controller was broken. | `FILTER` clause moved onto the aggregate (`AVG`), not its wrapper: `ROUND(AVG(x) FILTER (WHERE x IS NOT NULL) * 100, 1)`. Post-fix: HTTP 200, summary `order_count:30, total_revenue:3177.35, total_margin:1852.35` (matches Intelligence exactly). |
| FIN-12 | ✅ RESOLVED 2026-06-23 | Knex returns pg NUMERIC + COUNT as strings to preserve precision. All three margin endpoints (`/margin`, `/margin/trend`, `/margin/sku`) leaked strings into the UI: `gross_revenue:"179.85"`, `margin_pct:"58.3"`, `order_count:"30"`. Frontend either silently `parseFloat()`s (rounding risk) or chart/sort components misbehave. `/margin` summary fields were already coerced via `Number(...)`; per-row arrays were not. | API pre-fix: `gross_revenue` type `"string"` on all three endpoints. Post-fix: type `"number"`, nulls preserved on `carrier_shipping_cost`/`true_margin*`. | Per-row `.map()` coercion via `Number()` on each endpoint's response. Nullable money/percent fields explicitly check `!= null` to preserve null instead of becoming 0. |
| FIN-13 | ⏭️ NOT A BUG | `min_margin_pct == max_margin_pct == avg_margin_pct == 58.3` across all 30 orders. Every order has identical unit price + cost. Dev-seed artifact (uniform unit economics), not a defect. Logged so we don't chase it on the next audit. | API: summary `min/max/avg_margin_pct = 58.3`. | N/A — would resolve naturally on real data with varied SKU prices/costs. |

### UX consistency sweep — 2026-06-23/24

Following correctness, all three Finances screens (Intelligence, Cash Flow, Margin) were reshaped from one-off "snowflake" layouts into the canonical FT2 patterns documented in `docs/playbooks/modules-ux-playbook.md` (Pattern A/B/C, Decision Group Reveal).

**Backend reshapes:**
- `cashFlowProjection.service.ts` — added `runway_days` (days of cash at current burn; `null` when cash-positive) and a `comparison` block (prior-period realized/pending/refunds totals + pct deltas, `compareDays` default 30).
- `finances.intelligence.controller.ts` — added `?from=&to=` parsing and a `comparison` block (current vs prior period totals + deltas), mirroring the Cash Flow shape.

**Margin (`FinancesMarginPage.tsx` / `FinancesModuleFT2.tsx`):**
- Dropped the 5–7 StatBox grid + Distribution block.
- Added **ProfitTrustPanel** — two grouped sections ("Cost knowledge" / "Leakage") with severity-colored rows, mirroring `ProductsWmsReadinessPage` byte-for-byte. Consumes the Intelligence endpoint's trust signals (cost coverage, true-margin coverage, refund leakage, negative-margin orders) via `useFinancesIntelligence()`.
- Headline sentence replaces the old multi-card summary: "Where is profit leaking? · $X gross margin · Y% avg · [true-margin status]".
- Trend chart and tables unchanged.

**Intelligence (`FinancesIntelligencePage.tsx`, full-file replace):**
- Headline: "How am I doing?" + margin value/pct + vs-prior delta.
- Canonical triage ("Needs a decision") + pulse rail (5 `PulseRow`s with deltas: Gross Revenue, True/Gross Margin, Refund Leakage, Avg Gross Margin, Cost Coverage) replacing the prior PulseCard grid.
- Time range from `FT2DateRangeBar` now drives the API range and comparison window.

**Cash Flow (`CashFlowModuleFT2.tsx`) — iterated through several passes:**
- Removed the "Needs a decision" triage card entirely — its signals (overdue POs, negative cash crossover, unlockable blocked revenue) now render as inline alert chips directly under the headline subline.
- "Upcoming PO commitments" moved into the triage card's former slot beside the Cash Pulse rail, closing the empty-space gap.
- PO list applies the Decision Group Reveal pattern: 3 visible + "See X more" / "Show less" (`PO_PREVIEW_LIMIT = 3`, matched to Cash Pulse rail height).
- 60-day projection chart restored full-width-equivalent (2-column: chart left, "Plan a new stock order" beside it on the right — always visible, no longer behind a toggle).
- Fixed a wiring bug where the what-if overlay (`whatIfChartData`) silently no-op'd after the always-visible refactor — a stale `whatIfOpen` gate (always `false`) blocked the subtraction math from ever running. Removed the dead gate; overlay now reacts live to amount/date changes.
- Merged the separate "Make this projection more accurate" panel into the Plan-a-new-order card itself: an inline `+ Adjust fixed costs & balance` toggle reveals accent-tinted overhead/balance fields in the same card (`Collapse`, `var(--accent-ghost)` background). Removed the now-redundant standalone Collapse block and the `⚙ Adjust` button from the chart header.
- Net effect: 2 zones (headline+chips → PO list/pulse/chart/plan-order) instead of 3, no empty space, scroll-free on standard viewports.

**Deferred — [issue #1022](https://github.com/MiladArbabi/SynchroFlow/issues/1022):** Cash Flow's projection currently models only PO commitments + flat monthly overhead. Tracked for a future sprint: manpower scaling with incoming POs, packaging materials, outbound shipping, 3PL fees, payment processor fees, marketing spend, returns cost, and per-category breakdown in the chart tooltip.

**Resolved — `FinancesIntelligenceData` / `FinancesComparison` type duplication (2026-06-24):** these types were independently defined inline in both `apps/frontend/src/pages/finances/useFinancesIntelligence.ts` and `modules/finances/src/ui/pages/FinancesModuleFT2.tsx`. Moved to `modules/shared/src/contracts/finances-intelligence.ts` as the canonical cross-module contract; both sites now import (or re-export, for back-compat) from there.

Exported via `modules/shared/src/ui-contracts.ts`, reached through the **`@lasyncro/shared/ui-contracts`** subpath — not the bare `@lasyncro/shared` package root. The bare-root import (`@lasyncro/shared`, which resolves to `dist/index.js`) caused `tsc` composite-project errors in `modules/finances` (`TS6059`/`TS6307`/`TS5055`: file not under `rootDir`, not listed in the project's file list, would overwrite an input file) — `index.js` aggregates runtime exports (e.g. the `ModuleEntry` default) alongside types, which the composite build couldn't reconcile across package boundaries. `ui-contracts` is a plain, type-only file with no such aggregation, matching the existing proven pattern used for `CurrencyContext`. **Invariant: new cross-module types intended for module consumption go through a dedicated subpath export (`ui-contracts`, `ui`, etc.), never the bare package root.**

## 11. Invariants — Do Not Violate

1. **Never use bare `db()` on RLS tables** — always `withTenant` or inline `db.transaction` + `SET LOCAL`
2. **`FinancesFacts.service.ts` must accept `trx?`** — always called via `withTenant` in provider
3. **SKU margin excludes non-physical products** — `product_type NOT IN ('gift_card', 'digital', 'service')`
4. **`refundsMissing` is fact-based** — `facts.refundsObserved == null`, never hardcoded
5. **Intelligence tab is state-based** — `/intelligence` endpoint is not period-scoped
6. **Margin tab date range drives trend days only** — `presetToDays()` maps preset → days for trend chart
7. **Cost entry is not duplicated** — `/products/costs` is the canonical surface; finances CTAs navigate there
8. **`blockedMarginValue` may be null** — always handle gracefully in UI, never assume operational snapshot exists

---

## 12. Key Commands

### Canonical dev reset sequence (FIN-02 hardening — 2026-06-23)

**STOP the dev backend first** (it holds DB sessions that block `DROP DATABASE`).

```bash
# In project root, with dev servers stopped:
npm run db:reset
npm run migrate --workspace ./apps/backend
DEV_SEED_MODE=full_data npm run seed --workspace ./apps/backend
npm run backfill:margin --workspace ./apps/backend
npm run dev   # restart in separate terminal
```

Or one-shot: `npm run dev:full-reset` (already wires backfill:margin after the seed).

**Why backfill:margin exists:** dev_seed writes source tables directly and emits no domain events. `order_margin_snapshot` writes are guarded by two invariants (PROJECTION_WRITE_VIOLATION + SNAPSHOT_WRITE_BLOCKED) requiring `synchroflow.projection` AND `synchroflow.reconciliation` GUCs. The backfill script sets both inside `withTenant`, mirroring `rebuildInventoryProjection.ts:78`. Never run from inside the seed transaction — a guarded-write failure aborts the whole seed.

**Why lifecycle seeding needs explicit tenant:** `user_lifecycle_snapshot` has FORCE ROW LEVEL SECURITY with WITH CHECK on `app.current_tenant`. Without `SET LOCAL "app.current_tenant" = '${shop.id}'` before the insert, the row silently fails the policy and the seed-success log lies. Fixed at `dev_seed.ts:199`.

```bash
# Test intelligence endpoint
curl -s "http://localhost:3000/api/v1/modules/finances/intelligence" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Test margin summary
curl -s "http://localhost:3000/api/v1/modules/finances/margin" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Test SKU margin (physical only)
curl -s "http://localhost:3000/api/v1/modules/finances/margin/sku" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Test margin trend
curl -s "http://localhost:3000/api/v1/modules/finances/margin/trend?days=30" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# RLS pen-test
docker exec -e PGPASSWORD=sf_app_pass synchroflow_db psql -U sf_app -d synchroflow_db -c "
BEGIN; SET LOCAL app.current_tenant = '999';
SELECT COUNT(*) FROM order_margin_snapshot
UNION ALL SELECT COUNT(*) FROM refund_executions;
COMMIT;"
# All counts must be 0

# Build
npm run build -w apps/backend
npm run build -w apps/frontend
npm run build -w modules/finances

# Find bare db() calls (RLS regression check)
grep -rn "await db(" apps/backend/src/services/finances*/ --include="*.ts" | grep -v dist/
```

---

## 13. Upgrade the Dev Shop Tier

After `npm run dev:full-reset`, the seed sets `growth` tier automatically via `dev_seed.ts`. If the UI shows a plan gate, re-login to get a fresh JWT — the 15-minute access token may be stale.

If `shop_subscriptions` is missing (fresh DB with no seed run):

```bash
docker exec -e PGPASSWORD=sf_user_pass synchroflow_db psql -U sf_user -d synchroflow_db -c "
INSERT INTO shop_subscriptions (shop_id, tier, billing_interval, status)
VALUES (1, 'growth', 'monthly', 'active')
ON CONFLICT (shop_id) DO UPDATE SET tier = 'growth', status = 'active';"
```
