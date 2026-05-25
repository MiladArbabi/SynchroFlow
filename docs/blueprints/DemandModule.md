# Demand Module — Audit Blueprint

**LaSyncro | Sprint 4 Audit | May 25, 2026**
**Status: Audited — Live and functional, DS violations, UX gaps**

---

## 1. Module Structure

**Route:** `/demand` (single page, no sub-routes)
**Sidenav:** Standalone item, `requiredModuleId: 'demand'`
**Tier gate:** `PlanGate feature="demand.forecasting"` → requires `growth` tier
**Route registration:** `LifecycleRouteHost.tsx` line 223 — `/demand/*`

---

## 2. Backend

### Endpoint

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/api/v1/modules/demand` | ✅ Live | Single endpoint, requires `growth` tier |

### How it works

Pure on-the-fly computation — no dedicated demand tables. Every GET runs 5 SQL queries:

1. 30-day velocity per variant (`order_revenue_units` + `orders`)
2. Prev 30-day velocity (days 31–60) — for trend direction
3. Supplier lead time (`purchase_order_line_items` + `purchase_orders` + `suppliers`)
4. All-time units sold per variant
5. Inventory truth + variant details (`inventory_truth` + `variants`)

Results assembled in memory, sorted by urgency (critical → warning → healthy → no_velocity → overstocked), alert side-effects written on every call.

### Schema dependencies

| Table | Role |
|---|---|
| `order_revenue_units` | Units sold per variant per order |
| `orders` | Order timing for velocity window |
| `inventory_truth` | Current available stock (40 rows for shop 1) |
| `variants` | title, sku, unit_cost |
| `purchase_order_line_items` + `suppliers` | Lead time lookup |
| `alerts` | Written as side-effect on every GET (non-blocking upsert) |
| `revenue_projection_daily` | **Empty — unused. Future revenue forecast layer.** |

### Response shape

```json
{
  "computed_at": "ISO timestamp",
  "summary": {
    "total_variants_tracked": 33,
    "critical_reorder_count": 7,
    "warning_reorder_count": 0,
    "stockout_count": 9,
    "avg_days_of_stock": 555,
    "total_inventory_value": 116955
  },
  "variants": [/* DemandVelocity[] sorted by urgency */]
}
```

### Urgency classification

| Urgency | Condition |
|---|---|
| `critical` | available_qty <= 0, OR days_of_stock <= 7 |
| `warning` | days_of_stock <= 14 |
| `healthy` | days_of_stock > 14 and <= 90 |
| `overstocked` | days_of_stock > 90 |
| `no_velocity` | velocity_per_day == 0 |

### Known backend issues

- `supplier_lead_time_days` is null for all 33 variants — no received POs yet. Service silently defaults to 14 days for reorder qty calculation but returns null in response. All suggested reorder quantities are estimates against an arbitrary constant.
- `avg_days_of_stock: 555` is mean-skewed by high-stock zero-velocity variants. Misleading as a summary stat — needs weighted median or split reporting (critical count vs healthy count).
- Alert writes happen inside a GET endpoint. Every demand page load mutates the `alerts` table. Design smell — should be a background job, not a read side-effect.
- `revenue_projection_daily` is completely empty. Future forecasting infrastructure not yet built.

---

## 3. Frontend

### Files

| File | Role |
|---|---|
| `apps/frontend/src/pages/ft2-pages/DemandPage.tsx` | Gate page — wires useDemand, currency, warehouse grid/occupancy hooks |
| `apps/frontend/src/pages/products/useDemand.ts` | Fetches `/api/v1/modules/demand` |
| `modules/demand/src/ui/pages/DemandModuleFT2.tsx` | Module component — 425 lines |

### What DemandPage passes to DemandModuleFT2

- `data` — demand intelligence result
- `isLoading` / `isError`
- `currency` — displayCurrency, locale, rates (multi-currency support wired)
- `gridLocations` — warehouse grid locations (for occupancy section)
- `gridOccupancy` — per-bin stock data (for occupancy progress bar)

### Design system violations

| Location | Violation | Rule |
|---|---|---|
| `DemandModuleFT2.tsx` line 74 | `cardBg: '#1C2740'` hardcoded dark hex | CSS variables only |
| `DemandModuleFT2.tsx` line 77–78 | `textPrimary: '#F0EEE8'`, `textSecond: '#6B7280'` hardcoded | CSS variables only |
| `DemandModuleFT2.tsx` line 198 | `fontWeight: 700` on Critical chip | Max weight 500 |
| `DemandModuleFT2.tsx` line 311 | `border: '1px solid var(--rule)'` | Must be `0.5px solid` |

---

## 4. Visual Audit

| Route | Light mode | Dark mode | Notes |
|---|---|---|---|
| `/demand` | ✅ Renders correctly | ⚠️ Card bg is navy `#1C2740` — visually inconsistent with rest of app dark surface | All data live |

**What renders:**

- Signal line: "7 products at critical stockout risk" (orange)
- 4 stat tiles: Critical / Reorder Soon / Avg Days Stock / Inventory Value
- Warehouse Occupancy section: progress bar (8%), "1 of 13 bins stocked", "Pick zones: 0/12 stocked", "View in Warehouse →" cross-link
- Product table: PRODUCT / IN STOCK / SOLD 30D / DAYS LEFT / STATUS / ACTION
- 7 critical rows, all 0 stock, Critical badge, "Order X" CTA per row
- Collapsible: "26 healthy / overstocked / no-sales products"

**UX gaps observed:**

- "SOLD 30D" column shows values like "5 —" — the dash is a trend indicator with no legend. Unreadable to an operator.
- "Order X" CTA buttons — unverified whether wired or dead UI
- "Reorder Soon: 0" stat tile while 7 critical items exist — confusing. Critical IS reorder-urgent. Tile label needs rethinking.
- `555d` avg days of stock is displayed as-is — misleading summary

---

## 5. Known Issues

| ID | Priority | Description |
|---|---|---|
| DEM-01 | P2 | Hardcoded hex color theme (`#1C2740`, `#F0EEE8`, `#6B7280`) in DemandModuleFT2 — entire card theming bypasses CSS variables. Visible as navy card bg in dark mode. |
| DEM-02 | P2 | `fontWeight: 700` on Critical chip — DS max is 500 |
| DEM-03 | P2 | `border: '1px solid'` — must be `0.5px solid` |
| DEM-04 | P2 | "SOLD 30D" trend dash has no legend — operators cannot interpret it |
| DEM-05 | ✅ Resolved | "Order X" CTA is wired — navigates to `/suppliers-portal` with variant params pre-filled. Demand → PO creation loop is closed. |
| DEM-06 | P2 | "Reorder Soon: 0" stat tile label is misleading — critical items ARE reorder-urgent. Tile needs rethinking |
| DEM-07 | P2 | `avg_days_of_stock: 555` is mean-skewed — needs weighted median or split critical/healthy reporting |
| DEM-08 | P3 | Alert writes inside GET endpoint — should be background job |
| DEM-09 | P3 | `supplier_lead_time_days` always null — all reorder qty suggestions use hardcoded 14-day default |
| DEM-10 | P3 | `revenue_projection_daily` empty and unused — future forecast layer not built |

---

## 6. Workshop Verdict

**Keep. No cuts. Significant DS cleanup needed.**

The Demand module directly addresses one of the top SMB firefighting patterns: "I don't know which SKUs are about to run out until a customer complains." The velocity computation, urgency classification, and warehouse occupancy cross-link are all genuinely useful for the target user.

The "Order X" CTA is the highest-value interaction — if wired to pre-fill a PO in Suppliers portal, it closes the loop from signal to action in one click. That is differentiated. Must be verified and if dead, must be built.

**What this module needs before it's production-ready:**

1. DS cleanup — hardcoded hex theming replaced with CSS variables (DEM-01 is the most visible bug)
2. CTA verification (DEM-05)
3. Trend indicator legend or redesign (DEM-04)
4. Stat tile label fix (DEM-06)

**What it does not need:** More complexity. The single-page no-sub-tab structure is correct for this module.
EOF
echo "Demand blueprint written."
