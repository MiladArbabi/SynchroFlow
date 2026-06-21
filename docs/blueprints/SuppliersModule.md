# Suppliers Module — Audit Blueprint

**LaSyncro | Sprint 4 Audit | May 25, 2026**
**Status: Audited — Production-ready core, DS cleanup needed, scorecard uninitialized**

---

## 1. Module Structure

**Route:** `/suppliers-portal` (single page, no sub-routes)
**Sidenav:** Standalone item — `id: 'suppliers'`
**Route registration:** `LifecycleRouteHost.tsx` line 231 — `/suppliers-portal/*`
**No ModuleTabBar** — correct. Single-surface module with no sub-navigation needed.

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

---

## 4. Frontend — File Map

| File | Role |
|---|---|
| `apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx` | Gate page — all PO/supplier/receive callbacks wired |
| `apps/frontend/src/pages/suppliers-portal/useSuppliersPortal.ts` | Fetches suppliers + POs |
| `modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx` | Full module — 899 lines |

### Key integrations wired in SuppliersPortalPage

- **Demand → Suppliers handoff** — reads `?action=create-po&variantId=&sku=&qty=&description=` params, auto-opens PO creation dialog with variant pre-filled, clears params after reading. Full loop complete.
- **Suppliers → WMS receive** — `navigate('/wms?receiveJobId=...')` on line 530 — creates receive job then routes operator directly to WMS receive session.

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
| `/suppliers-portal` | ✅ Live | 3 POs in accordion, 2 supplier cards, "+ New PO" CTA working |

**What renders:**

- Page title "Suppliers" + signal line "Purchase orders, ETAs, and supplier ratings."
- "Open Purchase Orders (3)" section — accordion rows with supplier name, status badge, ETA, units, line count
- "Suppliers (2)" section — accordion rows with open PO count badges
- Status badges: Shipped (blue), Confirmed (blue), Sent (blue) — see issue SUP-01

**UX observations:**

- Supplier scorecard (on_time_rate, fill_rate, defect_rate) will be empty for all new tenants until first PO is fully received — no empty state messaging for this
- No filtering or search on PO list — will become unwieldy at 20+ POs

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
