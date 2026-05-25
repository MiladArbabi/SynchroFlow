# Finances Module — Audit Blueprint

**LaSyncro | Sprint 4 Audit | May 25, 2026**
**Status: Audited — Production-ready, DS cleanup needed, no UX rebuild required**

---

## 1. Module Structure

**Routes:**

- `/finances` → Intelligence (FinancesFT2Page → FinancesIntelligencePage)
- `/cashflow` → Cash Flow (CashFlowPage — standalone route, own ModuleTabBar)
- `/finances/margin` → Margin (FinancesFT2Page → FinancesMarginPage)

**Sidenav:** Finances accordion, 3 children. `requiredModuleId: 'cashflow'`.

**Route registration:** `LifecycleRouteHost.tsx` — `/finances/*` (FT2 block line 208) + `/cashflow/*` (line 220). CashFlow is a separate top-level route, not a child of `/finances`.

**ModuleTabBar:** Present on all three routes — FinancesFT2Page mounts it for /finances and /finances/margin, CashFlowPage mounts its own copy for /cashflow. No navigation black hole.

---

## 2. Backend — Confirmed Endpoints

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/api/v1/modules/finances/ft2` | ✅ Live | 14-key intelligence snapshot |
| GET | `/api/v1/modules/finances/intelligence` | ✅ Live | Net margin, cost coverage, blocked revenue |
| GET | `/api/v1/modules/finances/margin` | ✅ Live | 42 orders, summary + per-order breakdown |
| GET | `/api/v1/modules/finances/margin/sku` | ⚠️ Live but empty | Returns `{skus: []}` — query may have bug |
| GET | `/api/v1/modules/finances/margin/trend` | ✅ Live | Daily margin trend for chart |
| GET | `/api/v1/modules/cashflow` | ✅ Live | summary, buckets (4), projection_60d (9 days), by_constraint, po_outflows |
| GET | `/api/v1/modules/finances/epistemic` | ✅ Wired | Epistemic truth surface |
| GET | `/api/v1/modules/finances` | ❌ 404 | No root handler — all routes are sub-paths |

### Intelligence response (live data)

```json
{
  "totalRevenue": 42962.55,
  "totalCost": 14085,
  "totalMargin": 28877.55,
  "avgMarginPct": 66.4,
  "netMarginPct": 66.8,
  "costCoverage": { "totalVariants": 40, "zeroCostCount": 12, "coveragePct": 70 },
  "blockedRevenue": 7070.25,
  "blockedMarginValue": 4694.65,
  "constrainedOrders": 5
}
```

### Cashflow summary (live data)

```json
{
  "realized_revenue": 39671.45,
  "pending_revenue": 7909.55,
  "at_risk_revenue": 7070.25,
  "total_refunded": 179.85,
  "inventory_value": 116955,
  "net_cash_position": 39491.60,
  "working_capital_locked": 124864.55
}
```

### Cashflow projection — notable finding

Base case goes negative from Jun 15 and worsens weekly. Mathematically correct — $190k+ in pending PO commitments against insufficient revenue velocity. This is a real signal, not a bug.

### Margin data (live)

- 42 orders analysed, avg margin 66.4%, range 58.2–77.6%
- `order_margin_snapshot`: 42 rows, all computed May 24

---

## 3. Schema

| Table | Rows (shop_id=1) | Purpose |
|---|---|---|
| `order_margin_snapshot` | 42 | Per-order margin: gross_revenue, estimated_cost, gross_margin, margin_pct |
| `order_revenue_units` | seeded | Line item revenue data feeding margin computation |
| `revenue_projection_daily` | 0 | **Empty — unused.** Future revenue forecast layer. |

---

## 4. Frontend — File Map

| File | Role |
|---|---|
| `apps/frontend/src/pages/ft2-pages/FinancesFT2Page.tsx` | Gate + tab router for /finances and /finances/margin |
| `apps/frontend/src/pages/ft2-pages/FinancesIntelligencePage.tsx` | Intelligence tab — Financial Pulse + Cost Coverage + Signals |
| `apps/frontend/src/pages/ft2-pages/FinancesMarginPage.tsx` | Margin tab — fetches margin, SKU margin, trend. Passes to FinancesModuleFT2 with 9 props null. |
| `apps/frontend/src/pages/ft2-pages/CashFlowPage.tsx` | CashFlow — standalone page with own ModuleTabBar. Currency + settings wired. |
| `modules/finances/src/ui/pages/FinancesModuleFT2.tsx` | Finance + Margin module — 455 lines |
| `modules/cashflow/src/ui/pages/CashFlowModuleFT2.tsx` | CashFlow module — 570 lines |

### Key cross-module CTAs wired

- "$180 lost to refunds → View Margin" — routes to `/finances/margin`
- "$4,695 gross profit trapped → Unblock Orders" — routes to Orders module
- "12 SKUs missing cost → Fix in Products" — routes to `/inventory/costs`
- "Enter missing costs to unlock full margin intelligence →" — routes to `/inventory/costs`

### FinancesMarginPage — partial prop population

`FinancesModuleFT2` is mounted with 9 of 14 FT2 intelligence props set to null. Only margin, skuMargin, marginTrend, and currency are wired. The remaining 9 props (context, timeAwareness, timeline, blindSpots, etc.) are null — the component handles them gracefully, rendering only the margin surface.

### Design system violations

| Location | Violation | Rule |
|---|---|---|
| `FinancesModuleFT2.tsx` line 131 | `cardBg: '#1C2740'` hardcoded dark hex | CSS variables only |
| `FinancesModuleFT2.tsx` lines 133–134 | `textPrimary: '#F0EEE8'`, `textSecond: '#8B8F9A'` | CSS variables only |
| `FinancesModuleFT2.tsx` lines 337, 345, 354, 367, 393 | `'#22C55E'`, `'#EF4444'`, `'#6366F1'` hardcoded | CSS variables or theme.palette.* |
| `FinancesModuleFT2.tsx` multiple | `border: '1px solid'`, `borderLeft: '3px solid'` | Must be `0.5px solid` |
| `FinancesModuleFT2.tsx` line 143 | `fontWeight: 700` | Max weight 500 |
| `CashFlowModuleFT2.tsx` line 100 | `cardBg: '#1C2740'` | CSS variables only |
| `CashFlowModuleFT2.tsx` lines 102–103 | `textPrimary`, `textSecond` hardcoded | CSS variables only |
| `CashFlowModuleFT2.tsx` lines 404–406, 445–447 | `#DC2626`, `#2563EB`, `#16A34A` in recharts stroke | **Acceptable exception** — recharts cannot consume CSS variables in stroke props |
| `CashFlowModuleFT2.tsx` lines 282, 287 | `#DC2626`, `#16A34A` outside recharts | Must use theme.palette.* |

---

## 5. Visual Audit

| Route | State | Notes |
|---|---|---|
| `/finances` | ✅ Live, data-rich | Financial Pulse tiles, Cost Coverage bar, 3 cross-module signal CTAs |
| `/cashflow` | ✅ Live | 60-day projection chart (3 scenarios), Gross Profit Reality, action tiles |
| `/finances/margin` | ✅ Live | Summary tiles, margin distribution, trend chart (1 data point), By Order + By SKU tables |

**UX assessment:** Finances is largely consistent with FT2 design language. Signal-line approach, stat tiles, and cross-module CTAs match Overview and Orders. Does NOT require a full UX rebuild — only DS cleanup.

---

## 6. Known Issues

| ID | Priority | Description |
|---|---|---|
| FIN-01 | P2 | Hardcoded hex theme (`#1C2740`, `#F0EEE8`, `#8B8F9A`) in FinancesModuleFT2 and CashFlowModuleFT2 |
| FIN-02 | P2 | `#22C55E`, `#EF4444`, `#6366F1` hardcoded outside recharts in FinancesModuleFT2 — must use theme.palette.* |
| FIN-03 | P2 | `#DC2626`, `#16A34A` hardcoded outside recharts in CashFlowModuleFT2 |
| FIN-04 | P2 | `border: '1px solid'` and `borderLeft: '3px solid'` throughout FinancesModuleFT2 |
| FIN-05 | P2 | `fontWeight: 700` in FinancesModuleFT2 |
| FIN-06 | P2 | `/margin/sku` endpoint returns empty array — SKU margin table shows data in By SKU tab via different query path, but dedicated SKU endpoint broken |
| FIN-07 | P3 | Margin trend chart has only 1 data point (May 24) — not enough data for a useful chart on clean seed |
| FIN-08 | P3 | By SKU tab shows test/test1/test2 at 100% margin (zero cost) — seed data noise, not a bug |
| FIN-09 | P3 | `revenue_projection_daily` empty and unused — future forecasting layer not built |
| FIN-10 | ✅ Acceptable | Chart line colors (`#DC2626`, `#2563EB`, `#16A34A`) hardcoded in recharts stroke props — recharts cannot consume CSS variables. Documented exception. |

---

## 7. Workshop Verdict

**Keep all three sub-modules. No cuts. No UX rebuild needed.**

The Finances module is the second-strongest intelligence surface after Overview. The cross-module CTA pattern (finances sees the problem → routes to the fix surface) is the right architecture and should be the model for rebuilding Inventory Intelligence.

The cashflow projection with 3 scenarios directly addresses "can I make payroll?" — the highest-anxiety question for any SMB operator. The negative base case on clean seed is mathematically correct and demonstrates the system is working.

**What needs work:**

1. DS cleanup — hex theme, fontWeight, borders (FIN-01 through FIN-05)
2. `/margin/sku` endpoint fix (FIN-06)

**What is production-ready as-is:**

- Intelligence tab with cross-module signal CTAs
- CashFlow projection chart and action tiles
- Margin By Order table and distribution visualization
