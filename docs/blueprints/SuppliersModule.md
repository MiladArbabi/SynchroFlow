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
| SOURCING-UX-COGNITIVE-01 | P1 | 🔄 IN PROGRESS — Sourcing screen has high cognitive load and weak decision hierarchy when entered from a blocked order. Slice 1A (targeted recovery foundation) closed / verified / deployed 2026-09-03; Slice 1B and the Unified Sourcing Worklist remain — see below |

### SOURCING-UX-COGNITIVE-01 | IN PROGRESS | P1

The umbrella issue is **IN PROGRESS**, not closed. Slice 1A is delivered and
verified; Slices 1B, 2 and 3 remain outstanding. See **Delivery status** below.

#### Sourcing architecture — two levels

*Ratified 2026-09-03, superseding the earlier three-level model (L1 Sourcing
Overview / L2 Variant-SKU Worklist / L3 Detail). The former L1 and L2 are
merged; **there is no separate Sourcing Overview screen**.*

| Level | Surface | Answers |
|---|---|---|
| **Level 1** | Unified Sourcing Worklist | *Where do I need to act?* — portfolio awareness, prioritization, categorization, filtering, sorting, search, and the actionable variant/SKU list, all on one surface |
| **Level 2** | Product / Variant Sourcing Detail | *How do I resolve this exact SKU?* — the complete sourcing decision for one canonical variant |

Portfolio-level information is expressed **through the working list itself** —
summary and filter controls, categories, counts, sorting, status-based grouping
— rather than on a screen the merchant must first pass through.

An order-originated targeted recovery **bypasses the Unified Sourcing Worklist
and enters the Detail level directly** — the merchant already knows which
product is in trouble. Slice 1A built the foundation of that Detail level.

#### Lean-screen principle

When portfolio summary and operational work concern the same underlying objects,
prefer:

> summary → **filter / sort / categorize the working surface**

over:

> summary → **navigate to another overview or worklist screen**

The goal is less navigation, less duplicated information, lower cognitive load,
and less onboarding effort.

"One screen" does **not** mean "show every field at once". The worklist stays
lean and uses progressive disclosure; decision-heavy content belongs at the
Detail level.

#### Cross-module UX consistency

The Unified Sourcing Worklist should reuse laSyncro's established operational
list conventions, in particular the interaction grammar already used in Order
Flow:

> categorize → filter → scan → select → act

Familiar concepts to reuse where they fit: category/group headings with counts,
compact operational rows, search and filter controls near the list, urgency or
priority shown in-row, consistent action placement, and collapsible categories.

This is a requirement for **shared interaction grammar, not an identical screen
structure** — Sourcing is not required to copy Order Flow's three-column layout.

#### Worklist / Detail boundary

The worklist stays compact. Candidate row-level information: product / variant /
SKU identity, a small image, the primary attention reason, still to source,
available and inbound, blocked-order count, supplier readiness, purchasing
state, and one contextual action such as *Review →*.

Supplier ranking, MOQ detail, supplier alternatives, PO mechanics and other
decision-heavy content belong at the Detail level.

#### Status model

Four orthogonal internal dimensions are preserved — **attention**, **supplier
readiness**, **purchasing stage**, **coverage**. They must **not** be flattened
into a single canonical status field.

Merchant-facing categories are *derived* from those dimensions. Examples
discussed: Needs action · Ready to order · Needs supplier · Covered by inbound ·
Queued. These are worklist and categorization concepts, **not** a newly
persisted status enum.

#### Original observation (historical — 2026-09-02)

*Live-browser observation from ORD-DECISION-01 Slice 2 (2026-09-02). Preserved
because it is how the defect was discovered; it is not a description of current
behaviour.*

Route **as observed at that time**: `/suppliers-portal/sourcing?variantId=<constraint.target_id>`
— `variantId` only, entered via "Source this item" on an Out of Stock order.

**Routing is correct and is not the defect.** The link resolves to the
right variant and loads the right Sourcing context. The problem is what
the merchant meets on arrival.

#### Problem

- Difficult to interpret what belongs to the **blocked variant** versus
  the **general sourcing page** — arriving with a specific shortage in
  mind, the merchant cannot tell which parts of the screen are about
  that shortage.
- Immediate shortage resolution is visually mixed with broader
  purchasing work; the urgent single-variant task and routine restocking
  occupy the same visual plane.
- Supplier ranking, quantity, **Add to queue**, **Create PO**, Sourcing
  Pulse, onboarding/help cards, and unrelated products all compete for
  attention simultaneously. Nothing sequences the decision.
- The merchant cannot quickly determine what happened, what is missing,
  what supply already exists, or what action is recommended.
- The distinction between **Add to queue** and **Create PO** is
  insufficiently clear in the context of resolving an active order
  shortage — the merchant cannot tell which one actually unblocks the
  order.

#### Desired UX contract

A merchant arriving from "Source this item" should immediately
understand, in this order:

1. blocked product / variant;
2. current order shortage;
3. available stock;
4. confirmed inbound / existing commitments where known;
5. true unsecured gap;
6. supplier + MOQ implications;
7. difference between queueing demand and creating a PO;
8. recommended next action, with a plain-language reason.

Items 4-6 depend on work already designed elsewhere and must not be
re-specified here — see
`docs/playbooks/sourcing-recommendation-playbook.md` §7.6 (how
preference resolution changes the Sourcing page) and §8 (MOQ
accumulation). This issue records the **information hierarchy and
decision-clarity defect**, not a new recommendation engine.

#### Scope (historical — as recorded 2026-09-02)

At the time of the observation this was an **open follow-up only**: the
Sourcing screen was not to be redesigned or reimplemented as part of
ORD-DECISION-01. Slice 2's routing contract was verified and closed, and this
was downstream UX work needing its own brief. That brief has since been written
and Slice 1A executed against it — see **Delivery status** below, which
supersedes this paragraph as the current position.

Note: §5 Visual Audit above covers only the Open POs and Suppliers tabs
— the Sourcing tab has never had an equivalent visual audit, which is
plausibly why this went unrecorded until an order-side flow led into it.

---

#### Delivery status

**Slice 1A — Targeted Recovery Foundation — CLOSED / VERIFIED / DEPLOYED 2026-09-03.**

Slice 1A delivers Level 2 (Detail) *understanding* only. It is a read surface: it does not
resolve the blocked order, create a purchase order, queue a reorder request,
assign a supplier, alter inventory, receive stock, or resolve an order
constraint. Supplier ranking and MOQ mechanics are unchanged.

What it delivers:

- **Identity** — the targeted variant is named on arrival: image (or a stable
  neutral placeholder when there is none), product title, variant title, SKU.
- **Purchasing truth** — available, open demand, committed inbound, short now
  and still to source, all server-derived and displayed without the merchant
  doing arithmetic.
- **Blocking / originating context** — which orders are waiting on this
  variant, and which one the merchant arrived from.
- **Hierarchy** — identity → purchasing truth → blocking/originating context →
  supplier candidates and existing supplier mechanics, in that order.
- **Generic-content suppression** — in targeted mode, Never Ordered Before,
  Sourcing Pulse and the generic Supplier Preferences administration block are
  suppressed. Generic mode (no `variantId`) preserves all three unchanged.
- **Three mutually-exclusive target states** — `ok`, `not_found`, `error`.
- **Read-only boundary** — opening targeted sourcing mutates nothing.

#### Route contract

| | Route |
|---|---|
| **Initially observed (2026-09-02)** | `/suppliers-portal/sourcing?variantId=<canonical_variant_id>` |
| **Generic targeted (current)** | `/suppliers-portal/sourcing?variantId=<canonical_variant_id>` |
| **Order-originated targeted (current)** | `/suppliers-portal/sourcing?variantId=<canonical_variant_id>&orderId=<canonical_order_id>` |

`variantId` is the canonical sourcing subject. `orderId` is **optional context
only** — it is the canonical internal `orders.lasyncro_order_id`, never an
external Shopify id or display order number, and it must not affect open
demand, available, committed inbound, `short_now`, `still_to_source`, or
blocking-order derivation.

`originating_order_id` is populated **only** when the supplied canonical
`orderId` is one of the server-derived blocking orders for that variant. An
unrelated same-tenant `orderId` yields `originating_order_id = null`.

#### Purchasing truth — canonical formulas

```
short_now       = max(0, open_demand - available)
still_to_source = max(0, open_demand - available - committed_inbound)
```

- **Short now** — the current customer-demand gap, *before* counting anything
  already purchased.
- **Still to source** — what remains unsecured *after* committed inbound. This
  is the dominant merchant purchasing number and is rendered as such.

The two are distinct and must not be conflated: a merchant with stock already
inbound must not be told to re-order it.

#### Committed inbound — status semantics

Remaining quantities are counted from purchase orders in these five statuses:

`ordered` · `confirmed` · `in_production` · `shipped` · `partially_received`

Excluded: `draft` (not placed with anyone), `received` (already landed, so it
is in inventory truth, not inbound), `cancelled` (never arriving).

For a partially received line:

```
remaining = max(quantity_ordered - quantity_received, 0)
```

`reorder_requests` are **not** committed inbound — they are buying intent
pooled for MOQ accumulation, with no supplier commitment and no ETA.

This merchant-facing committed-inbound definition must not be collapsed into
the narrower demand-planning "reliable future inbound" concept used elsewhere.
Two questions, two definitions, both canonical.

#### Backend targeted response

Every pre-existing response field is preserved. Slice 1A additionally exposes:

`image_url` · `product_title` · `variant_title` · `sku` · `open_demand` ·
`available` · `committed_inbound` · `short_now` · `still_to_source` ·
`blocking_orders` · `originating_order_id`

- Unknown or non-tenant-owned target → **404**.
- Valid target with zero supplier recommendations → **200**, rendering the
  targeted identity and truth plus "No supplier history for this product yet."

#### Verification evidence (2026-09-03)

Automated:

| Gate | Result |
|---|---|
| Backend targeted integration | 15/15 PASS |
| Frontend targeted Sourcing | 10/10 PASS |
| Orders sourcing-entry regression | 3/3 PASS |
| Backend TypeScript | 0 errors |
| Frontend TypeScript | 0 target errors (19 unrelated baseline errors) |
| suppliers-portal build | PASS |
| Test ownership | UNOWNED=0, MULTI_OWNED=0 |
| Disposable integration DB | created → migrated → runtime OK → dropped, ORPHAN_DB_COUNT=0 |

Live browser: **LB-SRC-01 through LB-SRC-12 PASS**, on order #800001
(canonical `eea5bc08-d706-0ff9-62e9-cd08f9c05d4d`) → variant
`cb3592bc-1951-4c0b-aa39-306c5d6ef0dd` (QA Products / QA Shirt / QA-SHIRT-S),
showing Available 0 · Open demand 1 · Inbound 10 · Short now 1 ·
Still to source 0, with the neutral image placeholder, the originating order
800001, QA Test Supplier, and both Add to queue and Create PO still present.
Generic mode at `/suppliers-portal/sourcing` was separately verified to preserve
Supplier Preferences, Never Ordered Before and Sourcing Pulse.

Production certification — commit `41060ca8d3292e70796186bb2dbdef61620642bf`,
local HEAD equal to `origin/main`:

| Check | Result |
|---|---|
| `https://app.lasyncro.com/health` | HTTP 200 |
| `https://app.lasyncro.com/` | HTTP 200 |
| CI — UI modules | SUCCESS |
| CI / RLS Security Boundary | SUCCESS |
| Fly Deploy | SUCCESS |

The Fly workflow included successful privileged migrations, privileged
credential rejection on the runtime role, and runtime deployment. The worktree
was clean after certification.

#### Remaining work

| Slice | Scope | Status |
|---|---|---|
| **1B** | Targeted recovery **actions** / state transitions (Level 2) | OPEN |
| **2** | **Unified Sourcing Worklist** (Level 1) — portfolio awareness, categories, filters, sorting, search, actionable SKU/variant list, using laSyncro's familiar operational-list conventions | OPEN |

There is **no Slice 3**. The former Slice 3 (a separate L1 Sourcing Overview
screen) was removed when the architecture was reduced to two levels on
2026-09-03; its portfolio-awareness purpose is absorbed into the Unified
Sourcing Worklist.

Remaining cognitive-load follow-up (**not** a Slice 1A blocker, **not**
resolved): the existing large "Your best supplier, ranked automatically"
coachmark visually competes with purchasing truth in targeted mode.

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