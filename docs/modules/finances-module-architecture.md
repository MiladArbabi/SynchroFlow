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

| ID | Description |
|---|---|
| — | `netResult` in FT2 snapshot always null — no sovereign cost layer. Use `/intelligence` endpoint for net margin instead. |
| — | `trendDirection` always `unknown` — never computed from timeseries. Phase 2 item. |
| — | `daily_operational_brief_snapshot` always empty — snapshot worker disabled. `blockedRevenue` from operational snapshot may be null in dev. |
| — | Margin trend chart `y-axis` domain hardcoded `[0, 100]` — negative margin shops will have clipped chart. Fix when negative margin data exists. |
| — | `/finances/costs` tab removed — cost entry lives in `/products/costs`. Intelligence tab CTAs navigate there directly. |

---

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
