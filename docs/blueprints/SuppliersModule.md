# Suppliers Module — Audit Blueprint

**LaSyncro | Sprint 4 Audit | May 25, 2026**
**Status: Audited — Production-ready core, DS cleanup needed, scorecard uninitialized**

---

## 1. Module Structure

**Routes:** `/suppliers-portal` (Open POs) · `/suppliers-portal/suppliers` (Suppliers)
**Sidenav:** Standalone item — `id: 'suppliers'`, title **"Purchasing"** *(renamed from "Suppliers," June 2026 nav restructure)*
**Route registration:** `LifecycleRouteHost.tsx` — `/suppliers-portal/*`
**ModuleTabBar:** Added June 2026 — `PURCHASING_SUB_TABS` (`apps/frontend/src/pages/ft2-pages/purchasingSubTabs.ts`), rendered by `SuppliersPortalPage.tsx`. Splits the former single fused page (POs + Suppliers on one scroll) into two routed sub-views. *Supersedes this section's prior claim that no tab bar was needed.*

---

## 2. Backend — Confirmed Endpoints

All routes require `authenticateToken` + `requireFt2` + `requireAction`.

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/api/v1/suppliers` | ✅ Live | Returns `{suppliers: []}` with `open_po_count` computed |
| POST | `/api/v1/suppliers` | ✅ Wired | Create supplier (now refetches list) |
| PATCH | `/api/v1/suppliers/:id` | ✅ Wired | Update supplier (name/contact/moq/lead_time_days) |
| DELETE | `/api/v1/suppliers/:id` | ✅ Wired | Soft-delete (`active=false`) — preserves PO FK history |
| GET | `/api/v1/suppliers/purchase-orders` | ✅ Live | Returns `{purchase_orders: []}` with supplier name + line counts |
| POST | `/api/v1/suppliers/purchase-orders` | ✅ Wired | Create PO |
| GET | `/api/v1/suppliers/purchase-orders/:poId/line-items` | ✅ Wired | Line items per PO |
| PATCH | `/api/v1/suppliers/purchase-orders/:poId/status` | ✅ Wired | Status advance |
| PATCH | `/api/v1/suppliers/purchase-orders/:poId` | ✅ Wired | PO edit |
| POST | `/api/v1/suppliers/purchase-orders/:poId/receive` | ✅ Wired | Legacy receive (pre-WMS) |
| POST | `/api/v1/suppliers/purchase-orders/:poId/receive-jobs` | ✅ Wired | Create WMS receive job |
| GET | `/api/v1/suppliers/receive-jobs` | ✅ Live | Returns `{receive_jobs: []}` — 0 jobs on clean seed |
| GET | `/api/v1/suppliers/receive-jobs/:jobId` | ✅ Wired | Single receive job |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/claim` | ✅ Wired | Claim job |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/inspect` | ✅ Wired | Inspect line |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/close` | ✅ Wired | Close job |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/exception` | ✅ Wired | Report exception |

---

## 3. Schema

### `suppliers` (2 rows)

| Field | Notes |
|---|---|
| `on_time_rate`, `fill_rate`, `defect_rate` | All null — computed on PO `received`/`partially_received` transition. Never triggered on clean seed. |
| `avg_delivery_days` | Null — needs completed receive jobs |
| `total_pos` | 0 on both suppliers — counter not incrementing (bug or trigger not firing) |
| `open_po_count` | Computed at query time |
| `moq` | Supplier-level minimum order qty (units), nullable. Captured at supplier create/edit. Reorder qty must round up to this (REPL-002 guard, future). |
| `lead_time_days` | Days PO-sent → goods-received, nullable. Feeds reorder-by date = today + (days_of_stock − lead_time_days) (REPL-004, future). |

> **Sprint (2026-06-21):** Added supplier-level `moq` + `lead_time_days` (base migration `0094`). Standalone supplier CRUD on the portal (add/edit/remove via reusable `SupplierFormDialog`); delete is soft (`active=false`). `httpGetSuppliers` now filters `active=true` and returns moq/lead_time. Next: REPL-002 MOQ guard in CreatePoDialog, REPL-004 reorder-by-date planner in the Demand bridge.

### `purchase_orders` (3 rows)

| Status | Supplier | Units | ETAs | Line Items |
|---|---|---|---|---|
| `shipped` | Wool & Co | 25 | May 28 2026 | 2 |
| `confirmed` | Linen House | 65 | Jun 3 2026 | 2 |
| `ordered` | Wool & Co | 100 | Jun 10 2026 | 3 |

### `purchase_order_line_items` (7 rows)

Key fields: `lasyncro_variant_id`, `quantity_ordered`, `quantity_received`, `unit_cost_cents`

### `receive_jobs` (0 rows)

No receive jobs initiated — WMS receive pipeline not started.

### `supplier_product_preferences` (0 rows — table not yet created)

> **Added 2026-07-10.** Full design in `sourcing-recommendation-playbook.md §7`.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `shop_id` | int FK | RLS tenant key |
| `supplier_id` | int FK | References `suppliers.id`, `ON DELETE CASCADE` |
| `scope_type` | text | `'variant' \| 'product' \| 'product_type'` — most specific wins |
| `scope_id` | text | Variant ID, product ID, or product_type string per scope_type |
| `priority` | smallint | 1 = primary, 2 = backup. Lower wins within same scope |
| `note` | text | Merchant's free-text reasoning. No structured conditions in v1 |
| `created_by` | int FK | User who created — traceability |
| `created_at` | timestamptz | — |
| `updated_at` | timestamptz | — |

**Unique constraint:** `(shop_id, scope_type, scope_id, supplier_id)` — one preference
row per supplier+scope combination.

**RLS:** tenant isolation policy on `shop_id`.

**Resolution specificity (enforced in backend, not DB):**
`variant` > `product` > `product_type`. When multiple rows match a variant,
the most specific scope_type wins; ties broken by `priority ASC`.

**Status:** Migration not yet written. Table does not exist in DB as of 2026-07-10.
Depends on: nothing new (FKs reference existing `shops` and `suppliers` tables).
Blocks: MOQ accumulation system (`sourcing-recommendation-playbook.md §8`).

---

## 4. Frontend — File Map

| File | Role |
|---|---|
| `apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx` | Gate page — PO/supplier/receive callbacks wired; renders `ModuleTabBar` + nested `<Routes>` (June 2026 — see §1) |
| `apps/frontend/src/pages/ft2-pages/purchasingSubTabs.ts` | `PURCHASING_SUB_TABS` definition — Open POs / Suppliers |
| `apps/frontend/src/pages/suppliers-portal/useSuppliersPortal.ts` | Fetches suppliers + POs |
| `modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx` | Full module — 1,372 lines. Split June 2026 into `PurchasingPosView` / `PurchasingSuppliersView`, dispatched via `view` prop; tab bar/routing intentionally kept out of this file (package-boundary rule — see `apps/frontend` ↔ `modules/*` import restrictions) |

### Key integrations wired in SuppliersPortalPage

- **Demand → Suppliers handoff** — reads `?action=create-po&variantId=&sku=&qty=&description=` params, auto-opens PO creation dialog with variant pre-filled, clears params after reading. Full loop complete.
- **Suppliers → WMS receive** — `navigate('/wms?receiveJobId=...')`, `SuppliersPortalModuleFT2.tsx` line 848 (inside `PurchasingPosView`'s `PoAccordion.handleReceive` post-split) — creates receive job then routes operator directly to WMS receive session. **This is the canonical, documented implementation referenced in §8 — `OrdersInboundPage.tsx` independently duplicates this same sequence, in violation of its own spec.**

### Design system violations

| Location | Violation | Rule |
|---|---|---|
| Lines 302, 327, 583, 614–617, 626, 701, 775, 803, 868 | `fontWeight: 700` | Max weight 500 |
| Line 301 | `border: '1px solid'` | Must be `0.5px solid` |
| No hardcoded hex detected | ✅ Clean | Better than Demand/Inventory/WMS |

---

## 5. Visual Audit

| Route | State | Notes |
|---|---|---|
| `/suppliers-portal` (Open POs tab) | ✅ Live | POs in accordion, "+ New PO" CTA working |
| `/suppliers-portal/suppliers` (Suppliers tab) | ✅ Live | Supplier cards, "+ Add Supplier" CTA working |

**What renders — Open POs tab:**

- Page title **"Purchasing"** + signal line "Purchase orders and ETAs." *(retitled from "Suppliers," June 2026 — see §1)*
- "Open Purchase Orders" section — accordion rows with supplier name, status badge, ETA, units, line count
- Closed/cancelled POs collapsed by default
- Status badges: Shipped (blue), Confirmed (blue), Sent (blue) — see issue SUP-01

**What renders — Suppliers tab:**

- "Suppliers" section — accordion rows with open PO count, on-time/fill rating badges
- "+ Add Supplier" CTA

**UX observations:**

- Supplier scorecard (on_time_rate, fill_rate, defect_rate) will be empty for all new tenants until first PO is fully received — no empty state messaging for this
- No filtering or search on PO list — will become unwieldy at 20+ POs
- POs and Suppliers no longer share one scroll — each has its own route/tab now (was one fused page; see §1)

---

## 6. Known Issues

| ID | Priority | Description |
|---|---|---|
| SUP-01 | ✅ Resolved | `ordered` status intentionally displays as "Sent" — explicit label mapping on line 139. Correct operator-facing language. |
| SUP-02 | P2 | `fontWeight: 700` throughout SuppliersPortalModuleFT2 — DS max is 500 |
| SUP-03 | P2 | `border: '1px solid'` line 301 — must be `0.5px solid` |
| SUP-04 | P2 | `total_pos` counter is 0 on both suppliers despite 3 POs existing — recompute trigger not firing |
| SUP-05 | P2 | Supplier scorecard fields all null on clean seed — no empty state or "complete your first receive to unlock ratings" messaging |
| SUP-06 | P3 | No PO list filtering or search — will degrade at scale |
| SUP-07 | P3 | Page title/signal line not using FT2 typography pattern (22px/500 title, 13px/ink-3 signal) |

---

## 7. Workshop Verdict

**Keep. No cuts. Strong cross-module integration.**

The Suppliers module is the operational hub for inbound stock management. The two completed integration loops — Demand → Suppliers (stockout → PO creation) and Suppliers → WMS (PO shipped → receive session) — make this module genuinely differentiated. An SMB operator can go from "this SKU is stocked out" to "receive job open in warehouse" without leaving the app.

**What needs work before production:**

1. DS cleanup — fontWeight and border violations (SUP-02, SUP-03)
2. Status label verification (SUP-01)
3. `total_pos` counter fix (SUP-04)
4. Empty state for uninitialised scorecard (SUP-05)

**What is production-ready as-is:**

- PO lifecycle (create → confirm → ship → receive)
- Demand handoff with pre-filled PO dialog
- WMS receive session navigation
- Supplier management (create, view)

---

## 8. Relationship to Orders/Inbound (`/orders/inbound`) — relocated spec + open contradiction

*Relocated from `OrdersModule.md` §8, June 2026 nav restructure — Inbound moved out of Orders into this module's domain.*

### Original design intent (Inbound)

> "What it is NOT: Not a receiving execution surface — that's the mobile `ReceiveJobScreen`. Not a duplicate of the Suppliers portal — that's at `/suppliers-portal`."

[full original spec: PO lifecycle, role-split table, "critical missing link" inventory-credit feature — see git history of OrdersModule.md for verbatim content]

### Contradiction with this document, §4 and §7

This module's own §4 documents `SuppliersPortalModuleFT2.tsx`'s `PoAccordion.handleReceive` performing the exact action Inbound's spec rules out — `navigate('/wms?receiveJobId=...')` after creating a receive job — and §7 names this integration as one of two reasons the module is "genuinely differentiated." Live code audit (June 2026) confirms `OrdersInboundPage.tsx` independently implements the same create-job → navigate-to-WMS sequence, in violation of its own spec, duplicating a feature this document treats as a strength, not a gap to fill twice.

**Recommendation, pending your sign-off:** Inbound's receive-execution code should be removed, returning it to read-only triage per its original spec — not because the feature is wrong, but because Suppliers Portal already owns it correctly, documented and praised. This is a code fix, not a redesign; the design decision already exists in writing.