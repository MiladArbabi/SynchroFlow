# LaSyncro — Sourcing & Reorder Recommendation Playbook

> **Created:** 2026-06-29. **Status:** Direction decided. Recommendation algorithm NOT yet designed — next session's focus.

## 1. Why Reorder Changed Direction

Original mechanism (REPL-001, still functional): Demand's reorder signal deep-links to Suppliers Portal, pre-filling one PO line item with `suggested_reorder_qty`. Confirmed gap: zero MOQ enforcement or visibility anywhere in the codebase — `grep -rn "moq"` across the backend only touches the supplier's own stored field, never a submitted quantity.

A popup-based MOQ check was designed, then abandoned in favor of a **dedicated page** (same architectural shape as Order Flow — a surface that owns a whole class of decisions, fed by deep-links, with live recompute) once it became clear the real need is supplier *comparison and recommendation*, not just a quantity warning.

## 2. Confirmed Facts (ground truth, 2026-06-29)

- `suppliers` table already has a full unused scorecard: `on_time_rate`, `fill_rate`, `defect_rate`, `avg_delivery_days`, `moq`, `lead_time_days` — all computed by `supplierRating.service.ts`, **used in zero recommendation/comparison logic anywhere.**
- No stored supplier link exists on `variants`. Supplier lineage is derived *only* from the most recent received PO containing that variant (`demandIntelligence.service.ts`), defaulting lead time to 14 days when no history exists.
- Multi-supplier-per-variant query returned 0 rows in current data (no variant has >1 historical supplier yet) — does not rule out future need; dataset is tiny (3 of 17 variants have any order history at all).
- **Decision: no `default_supplier_id` FK.** Locking a single default would regress the flexibility the data model already implicitly allows (each PO's supplier is independent of the variant). The recommendation page must compute fresh each time, ranking a variant's full supplier history, never assuming "last used = correct again."
- `purchase_orders.status` enum: `draft, ordered, confirmed, in_production, shipped, partially_received, received, cancelled`. `draft` maps directly onto "to be ordered" tracking — no new field needed.
- "Never-ordered-before, now reordered" counter: recommended as **persistent, derived live** via `MIN(poli.created_at)` grouped by variant (same technique as `customerLtv.service.ts`'s `first_order_at`) — not a stored counter that could drift. UI placement (candidate: Demand's pulse card, which already shows `critical_reorder_count`/`warning_reorder_count`) is suggested, **not locked.**
- "Total products to be ordered" — `ModuleTab.count` already supports a badge on the new Purchasing tab. Exact scope (global vs. per-supplier) was raised but not reconfirmed after the pivot to a dedicated page — **open, settle when designing the algorithm.**

## 3. Structural Plumbing (confirmed mechanical, not yet executed)

Three files, three small additions — routing is not the hard part:
- `apps/frontend/src/runtime/navBootstrap.ts` — new sidenav child under Purchasing (`id: 'suppliers'` duplicate between parent and child also needs fixing in this same edit, per explicit decision).
- `apps/frontend/src/pages/ft2-pages/purchasingSubTabs.ts` — new `ModuleTab` entry (can carry the count badge from §2).
- `apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx` — new `<Route>` + new `view` value passed to `SuppliersPortalModuleFT2`. **Not yet confirmed:** whether `view`'s prop type is a strict union needing a code change to extend, or already permissive — pending verification.

Tab/page name used as a placeholder throughout tonight's discussion ("Sourcing") — **not yet confirmed as final**, decide before implementation.

## 4. Not Yet Designed

The actual recommendation logic: how `on_time_rate` / `fill_rate` / `defect_rate` / `avg_delivery_days` / `moq` / `lead_time_days` combine into a single "this supplier fits this product" signal. This is the next workshop.

## 5. Update — 2026-06-29, plumbing shipped

§3's structural plumbing is done, not just confirmed mechanical: `navBootstrap.ts`, `purchasingSubTabs.ts`, `SuppliersPortalPage.tsx`, and `SuppliersPortalModuleFT2.tsx` (type widened to `'pos' | 'suppliers' | 'sourcing'`, three-way branch replacing the old binary ternary) all updated and verified live. Tab name "Sourcing" is final. The placeholder view (`PurchasingSourcingView`) renders "Sourcing recommendations are coming soon" — §4's algorithm is still the only thing standing between this tab and a real feature.
