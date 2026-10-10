# Problem Center — System Blueprint

**LaSyncro | WMS-Lite Subsystem**
**Version:** 1.0
**Date:** May 27, 2026
**Status:** Living Document — Updated Against Implementation

> ⚠️ This document reflects verified implementation state as of **May 27, 2026**.
> Sections marked **[LIVE]** are implemented and deployed.
> Sections marked **[PLANNED]** are designed but not yet built.

---

## 1. Purpose & Product Philosophy

The Problem Center is LaSyncro's pre-shipment physical warehouse exception triage surface. It is the canonical merchant-facing destination for execution exceptions raised while inventory moves through Receive → Stow → Pick → Pack.

**Core principle:** Warehouse execution exceptions from receive, stow, pick, and pack are resolved through the Problem Center. Post-shipment return and recovery problems belong to the Returns module, not the Problem Center.

> **Ownership clarification — 2026-09-14:** Returns is explicitly outside the Problem Center's canonical product ownership. Existing `return_shortfall` / `repackaging_required` writes into `problem_center_tasks` are transitional implementation coupling and remain pending migration into Returns-owned resolution. Slice 3A.3 did not change those backend write paths.

**What it is NOT:**

- Not an order-exception surface (order constraints live in `order_constraints` + Order Nexus)
- Not an inventory intelligence surface (SKU Gaps handles product-side data quality)
- Not a customer issue tracker

---

## 2. Actors & Permissions

| Actor | Capability |
| --- | --- |
| **Operator** | Reports exceptions from pick/pack/stow/receive workflows. Sees tasks assigned to them or unassigned pool (first-to-claim). Physically moves items to problem bin. |
| **Owner / Admin** | Sees all tasks across all operators. Resolves tasks with resolution action. Configures problem bin location. |

Role filtering is enforced in `httpGetProblemTasks` — operators only see pool + tasks assigned to themselves.

---

## 3. Data Model [LIVE — Migration 0103]

**File:** `apps/backend/migrations/20260429190901_0103_create_problem_center_tasks.ts`

### 3.1 Table: `problem_center_tasks`

| Column | Type | Notes |
| --- | --- | --- |
| `problem_task_id` | uuid PK | `gen_random_uuid()` |
| `shop_id` | integer FK → `shops` | RLS enforced |
| `status` | `problem_center_status` | Enum — see lifecycle below |
| `source` | `problem_center_source` | Enum — which workflow created this |
| `source_exception_id` | uuid nullable | Links back to originating exception record (no FK — source tables vary) |
| `lasyncro_variant_id` | uuid | The affected variant |
| `quantity` | integer | Physical units flagged |
| `exception_type` | text | Specific failure mode — see taxonomy below |
| `problem_bin_location` | text | Copied from `shop_wms_settings.problem_bin_location` at task creation time |
| `notes` | text | PROB label (e.g. `PROB-1-0001`) — auto-generated |
| `assigned_operator_id` | integer nullable | If set, only that operator sees it |
| `claimed_by` | integer nullable | Operator who claimed the task |
| `resolution_action` | text nullable | Set on resolve — see action taxonomy below |
| `resolution_notes` | text nullable | Free-text from resolver |
| `resolved_by` | integer nullable | userId who resolved |
| `resolved_at` | timestamp nullable | Null while `investigating` |
| `created_at` | timestamp | Auto |
| `updated_at` | timestamp | Auto |

**RLS:** `problem_center_tasks_tenant_isolation` policy — `shop_id = current_setting('app.current_tenant')::int`

### 3.2 Enums

**`problem_center_status`**

```ts
open → investigating → resolved | discarded | returned_to_supplier
```

**`problem_center_source`**

```ts
pick | pack | stow | receive | returns
```

### 3.3 Related table: `shop_wms_settings` (relevant columns)

| Column | Purpose |
| --- | --- |
| `problem_bin_location` | Configurable per-shop (e.g. `PROBLEM`). The generic/manual Problem Center creation path requires it. GH-1049 server-owned Pick incident creation is different: the incident must still be created when this setting is absent, and stores `NULL` until downstream custody is handled. |
| `prob_label_sequence` | Auto-incrementing integer used by the generic/manual Problem Center label flow. GH-1049 server-owned Pick incident creation does not increment it or print a new PROB label. |

**INV-BLOCK-18 scope clarification — GH-1049:** the generic `/problem-center` creation path still fails closed when `shop_wms_settings.problem_bin_location` is null or empty. That rule does **not** apply to server-owned Pick incident creation from `httpReportPickException`; a real Pick discrepancy must be recorded even when physical Problem Bin configuration is incomplete.

---

## 4. Exception Taxonomy

### 4.1 Exception Types (by source)

| Source | Exception Type | Meaning |
| --- | --- | --- |
| `pick` | `item_missing` | Item not at expected bin location |
| `pick` | `short_pick` | Fewer units found than required |
| `pick` | `wrong_item` | Wrong product scanned at bin |
| `pick` | `product_defect` | Item physically damaged |
| `pack` | `product_defect` | Defect found during pack inspection |
| `pack` | `packaging_defect` | Packaging failure |
| `pack` | `wrong_item` | Wrong item in pick batch |
| `pack` | `order_cancelled` | Order cancelled mid-pack |
| `stow` | `item_missing` | Item missing during stow |
| `stow` | `product_defect` | Defect found during stow |
| `stow` | `packaging_defect` | Packaging defect on inbound |
| `stow` | `stow_failure` | Could not locate valid bin |
| `receive` | `receive_rejection` | Inbound unit rejected on inspection |
| `returns` | `repackaging_required` | Return needs repackaging before re-stow |
| `returns` | `return_shortfall` | Fewer units returned than expected |

### 4.2 Resolution Action Taxonomy

| `resolution_action` | Final Status | Inventory Cascade | Built |
| --- | --- | --- | --- |
| `re_stow` | `resolved` | GH-1202 outside-truth incidents only: creates a credit-only recovery stow task (`order_cancelled_mid_pick` / `return_restock`); confirm credits the destination bin | ✅ LIVE (restricted — GH-1238) |
| `discard` | `resolved` | GH-1202 outside-truth incidents only: record-only, no movement or truth change | ✅ LIVE (restricted — GH-1238) |
| `write_off` | `resolved` | GH-1202 outside-truth incidents only: record-only, no movement or truth change | ✅ LIVE (restricted — GH-1238) |
| `return` | `returned_to_supplier` | Future: creates return PO line | ❌ PLANNED |
| `quarantine` | `resolved` | GH-1202 outside-truth incidents only: credits exactly `task.quantity` into the validated, non-pickable problem bin (`location_transfer`) | ✅ LIVE (restricted — GH-1238) |
| `find_replacement` | `investigating` | Investigation only — no movement, never closes the incident; Pick/Pack shortage types | ✅ LIVE |

**GH-1238 — fail-closed resolution eligibility (2026-10-10).** Eligibility is
backend default-deny, decided from persisted incident evidence
(`apps/backend/src/services/wms/problemCenterResolutionPolicy.ts`). Any other
source × exception_type × action returns `409 RESOLUTION_NOT_ELIGIBLE` before
any task, inventory, alert, stow or reconciliation write.

| Incident | Eligible actions | Required evidence |
| --- | --- | --- |
| `pick/order_cancelled` | `re_stow`, `quarantine`, `discard`, `write_off` | the cancelled order in `source_exception_id`; no `source_pick_exception_id` |
| `returns/repackaging_required` | `re_stow`, `quarantine`, `discard`, `write_off` | the return job in `source_exception_id` |
| Pick/Pack `item_missing`, `missing_item`, `short_pick`, `wrong_item` | `find_replacement` (investigation only) | — |
| everything else (reconciliation, count, stow, receive, `return_shortfall`, Pick/Pack defects, unknown types) | none — UI shows "Needs investigation" | — |

- Terminal statuses `resolved`, `discarded` and `returned_to_supplier` all reject further resolution (`409 Task already resolved`).
- Ordinary (in-truth) quarantine, which rewrote a whole projection row, and stock-debiting discard / write-off inferred from a variant's single positive row are retired.
- **Open gap — GH-1240:** ordinary Pick incidents have no closing disposition. Their missing/defective units stay reserved at the allocation location (`recordShortPickPhysicalOutcome` releases only units found) and no resolution settles that residual reservation yet.
- Reconciliation conflicts close only through canonical physical recount/finalization, never through Problem Center actions.

---

## 5. PROB Label System [LIVE]

Every task creation atomically:

1. Increments `shop_wms_settings.prob_label_sequence`
2. Generates label: `PROB-{shopId}-{sequence padded to 4 digits}` (e.g. `PROB-1-0001`)
3. Creates a `barcode_print_jobs` row for physical label printing
4. Requires `shop_wms_settings.problem_bin_location`; if missing, returns `409` and rolls back creation. Otherwise copies the configured value into the task row.

The PROB label is the physical tracking token. Operator prints and attaches it to the item before moving to problem bin.

---

## 6. API Endpoints [LIVE]

All routes: `authenticateToken` + `requireFt2` + `requireTier('core')`

| Method | Path | Handler | Status | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/wms/problem-center` | `httpGetProblemTasks` | ✅ LIVE | Role-filtered list of open/investigating tasks |
| `POST` | `/api/v1/wms/problem-center` | `httpCreateProblemTask` | ✅ LIVE | Creates task + PROB label + print job. GH-1238: operator-reportable classifications only (Receive, Pack, Pick, Stow taxonomies); system-owned types (`returns/*`, `order_cancelled`, …) and non-positive-integer quantities → 400 before any write |
| `POST` | `/api/v1/wms/problem-center/:taskId/resolve` | `httpResolveProblemTask` | ✅ LIVE | Resolves with action + cascade |
| `GET` | `/api/v1/wms/problem-center/:taskId/replacement` | `httpFindReplacementForTask` | ✅ LIVE | Finds same variant at other locations with sufficient stock |
| `GET` | `/api/v1/wms/problem-center/pick-exceptions` | `httpGetProblemCenterExceptions` | ✅ LIVE | Legacy: reads `pick_exceptions` table directly |
| `POST` | `/api/v1/wms/problem-center/pick-exceptions/:exceptionId/resolve` | `httpRetiredPickExceptionResolve` | ❌ RETIRED (GH-1238) | Returns `410 PICK_EXCEPTION_DIRECT_RESOLVE_RETIRED`, writes nothing. It previously closed the Pick exception and paired task from a note alone |

### 6.1 Key Request/Response Shapes

**`POST /api/v1/wms/problem-center`**

```json
// Request
{
  "lasyncro_variant_id": "uuid",
  "quantity": 2,
  "exception_type": "product_defect",
  "source": "stow",
  "source_exception_id": "uuid (optional)"
}
// Response 201
{
  "problem_task_id": "uuid",
  "prob_label": "PROB-1-0004",
  "problem_bin": "PROBLEM"
}
```

**`POST /api/v1/wms/problem-center/:taskId/resolve`**

```json
// Request
{
  "resolution_action": "discard | write_off | re_stow | return | quarantine | find_replacement",
  "resolution_notes": "optional free text"
}
// Response 200
{ "problem_task_id": "uuid", "status": "resolved", "resolution_action": "discard" }

// Response 409 (GH-1238) when the source × type × action is not eligible or its
// persisted evidence is missing. Rejected before any write.
{ "error": "This resolution is not supported for this incident", "code": "RESOLUTION_NOT_ELIGIBLE", "reason": "action_not_supported_for_incident" }
```

**`GET /api/v1/wms/problem-center/:taskId/replacement`**

```json
// Response 200
{
  "task_id": "uuid",
  "variant_id": "uuid",
  "replacement_locations": [
    {
      "location_code": "WH-1-A-3",
      "available_quantity": 5,
      "on_hand_quantity": 5,
      "variant_title": "Blue Widget / L",
      "sku": "BW-L-001"
    }
  ]
}
```

---

## 7. Exception Cascade Wiring — Source Workflows

These are the flows that automatically create `problem_center_tasks` rows:

| Workflow | Trigger | Handler | Inventory Movement Written |
| --- | --- | --- | --- |
| **Pick** | `POST /api/v1/wms/batch/:id/exception` | `httpReportPickException` | None at report time — on resolve |
| **Stow** | `POST /api/v1/wms/stow-tasks/:taskId/exception` | `httpReportStowException` | `shrinkage` or `damage` written immediately |
| **Pack** | Pack scan exception flow | Pack controller | ❌ `wms_pack_exception` alert not firing (ISSUE-006 — open) |
| **Receive** | Receive rejection | Receive controller | Via `receive_rejection` exception type |
| **Returns — transitional coupling** | Return shortfall / repackaging | Returns controller | Existing runtime still writes `returns`-source tasks, but canonical ownership is Returns; migration pending |

✅ **Stow exceptions now defer inventory impact to resolve time** — unified with pick exceptions. `httpReportStowException` creates `problem_center_tasks` row only. `httpResolveProblemTask` writes the inventory movement on owner resolution (INV-PC-01 resolved May 31, 2026).

---

## 8. Frontend [LIVE]

### 8.1 Module

**Location:** `modules/problem-center/src/ui/pages/ProblemCenterModuleFT2.tsx`

**Design contract:**

- Table layout matching Returns module (same mental model, different domain)
- FT2 DS: CSS vars only, 0.5px borders, `fontWeight` max 500, no hardcoded hex
- Pagination: 10 rows per page, resets on filter change
- Stage color tokens: Pick=`#14B8A6`, Pack=`#3B82F6`, Stow=`#8B5CF6`, Receive=`#F59E0B`

### 8.2 Data Hook

**Location:** `apps/frontend/src/pages/problem-center/useProblemCenter.ts`

Maps `problem_center_tasks` shape → `PickException` contract (legacy type still used by module).

⚠️ **Shape mismatch:** The module uses `PickException` type (designed for `pick_exceptions` table). Fields like `quantity_found`, `pick_batch_id`, `lasyncro_line_item_id` are stubbed with placeholder values (`0`, task_id, task_id). This is a known technical debt — tracked as INV-PC-02.

### 8.3 Resolve Flow — Current State [PARTIAL]

> **Superseded.** INV-PC-03 (v1.1) rewired the modal to `httpResolveProblemTask`; GH-1238 (2026-10-10) retired the legacy endpoint (410). Options now mirror the §4.2 eligibility policy: no hidden default action, the pre-selected option is shown as checked, and incidents without a safe action show "Needs investigation". The text below is historical.

The resolve button opens a modal. Current modal accepts a **free-text note only** and calls `POST /api/v1/wms/problem-center/pick-exceptions/:exceptionId/resolve` (the **legacy endpoint** — not `httpResolveProblemTask`).

This means:

- Resolution action selector is NOT shown to the user
- No downstream cascade fires (no stow task created, no inventory movement written)
- `httpResolveProblemTask` with its full cascade logic is **never called from the frontend**

Tracked as **INV-PC-03** — highest priority open item.

---

## 9. Open Issues

| ID | Priority | Status | Description |
| --- | --- | --- | --- |
| **INV-PC-01** | P2 | ✅ RESOLVED | Stow exceptions now defer inventory impact to resolve time — unified with pick exceptions. `httpReportStowException` no longer writes `inventory_movements` at report time. Movement written by `httpResolveProblemTask` on owner resolution. |
| **INV-PC-02** | P3 | 🔴 OPEN | `ProblemCenterModuleFT2` uses legacy `PickException` type with stubbed fields (`quantity_found=0`, `lasyncro_line_item_id=task_id`). Module needs its own native type aligned to `problem_center_tasks` shape |
| **INV-PC-03** | P1 | ✅ RESOLVED | Resolve modal correctly calls `POST /api/v1/wms/problem-center/:taskId/resolve` → `httpResolveProblemTask` with full action selector UI (re_stow / discard / write_off / quarantine / find_replacement) |
| **INV-PC-04** | P1 | ✅ RESOLVED | `re_stow` creates a pending `stow_tasks` row with no destination. Operator assigns a valid active bin, then confirmation transfers inventory from `problem_center_tasks.problem_bin_location` → assigned bin. INV-BLOCK-11 closed the former root-source / invalid-destination inventory creation defect. |
| **INV-PC-05** | P2 | 🔴 OPEN | `return` resolution creates no PO return line — cascade not implemented |
| **INV-PC-06** | P2 | 🔴 OPEN | Replacement finder (`GET /problem-center/:taskId/replacement`) has no frontend surface — when `find_replacement` action selected, replacement locations must render inline |
| **INV-PC-07** | P2 | ✅ RESOLVED | `ProblemBinPrompt` banner shown in WmsPage when `problem_bin_location` is null/empty. Owner sets bin code inline (PATCH /wms/settings). `useWms` now fetches settings on load. |
| **INV-PC-08** | P3 | ✅ RESOLVED | Pack exception alerts now fire via `firePickExceptionAlert()` in `packDecision.service.ts` when blocking exceptions raised. Non-blocking exceptions fire via `wmsAlerts.service.ts`. |
| **INV-PC-09** | P3 | 🔴 OPEN | Operator post-exception instruction ("Move to problem bin: X") does not show if `problem_bin_location` is empty — should guard and prompt owner to configure |
| **INV-PC-10** | P3 | ✅ RESOLVED | `OperatorProblemCenterScreen` added as 5th tab in OperatorTabs. Read-only — shows open/investigating tasks, PROB label, bin location. Resolve remains owner-only (DispatchScreen). |

---

## 10. Intended Full Workflow (Target State)

```ts
Operator encounters exception during pick/pack/stow/receive
  ↓
Reports exception in WMS mobile UI
  ↓
System creates problem_center_tasks row + PROB label print job
  ↓
Operator prints PROB label → attaches to item → moves to problem bin
  ↓
Operator sees instruction: "Move to {problem_bin_location}" (for example, `PROBLEM`)
  ↓
Owner/Admin opens Problem Center → sees all open tasks
  ↓
Selects resolution action per task:
  ├── re_stow      → pending stow_task → operator selects valid active bin → problem bin → destination bin transfer
  ├── discard      → damage movement written → inventory decremented
  ├── write_off    → shrinkage movement written → inventory decremented
  ├── return       → return PO line created → supplier defect_rate updated
  ├── quarantine   → single stock-holding location moved to problem bin; ambiguous or   missing location → 409
  └── find_replacement → replacement locations shown → operator picks from alt bin
  ↓
Task status → resolved | discarded | returned_to_supplier
  ↓
Inventory truth reflects reality
```

---

## 11. Resolution Cascade — Live Implementation

> **GH-1238 (2026-10-10):** the in-truth `discard` / `write_off` debits described below are retired — those actions are now eligible only for GH-1202 outside-truth incidents, where they are record-only (§4.2). Problem Center resolution no longer creates `trigger: 'problem_center'` stow tasks; `re_stow` uses the credit-only `order_cancelled_mid_pick` / `return_restock` triggers. The sections below are kept as history.

### `re_stow` (LIVE — INV-PC-04 / INV-BLOCK-11)

```ts
problem_center_tasks.status → 'resolved'

stow_tasks INSERT {
lasyncro_variant_id,
quantity,
location_code: null,
trigger: 'problem_center',
source_task_id: problem_task_id
}

operator assigns destination:
warehouse_locations.active = true
warehouse_locations.type = 'bin'
destination != problem_center_tasks.problem_bin_location

confirm:
source = problem_center_tasks.problem_bin_location
destination = stow_tasks.location_code

inventory_truth:
source -= qty
destination += qty

inventory_movements:
location_transfer source -qty
location_transfer destination +qty
````

### `discard` (LIVE)

The full task quantity must be available at the single stock-holding location. If `task.quantity > available_quantity`, resolution returns `409` and the transaction rolls back, leaving the task open with no inventory movement or truth mutation.

```ts
require task.quantity <= available_quantity
problem_center_tasks.status → 'resolved'
inventory_movements INSERT { movement_type: 'damage', quantity_delta: -qty }
inventory_truth UPDATE { on_hand -= qty, available -= qty, sellable -= qty }
```

### `write_off` (LIVE)

**INV-BLOCK-16:** Write-offs are all-or-nothing. The full task quantity must be available at the single stock-holding location. The former `Math.min(task.quantity, available_quantity)` truncation was removed because it could partially write the ledger while resolving the full task. Insufficient available inventory now returns `409`; the transaction rolls back, the task remains open, and no movement or truth mutation is written.

**INV-NEG-ONHAND-01:** The final `inventory_truth` decrement is also guarded atomically by the database. Two concurrent Problem Center tasks may both initially read the same available quantity, but only a write whose row still has enough `on_hand_quantity` and `available_quantity` may decrement it. If another transaction consumed the stock first, the update affects zero rows, raises `WRITE_OFF_INSUFFICIENT_AVAILABLE`, and the whole transaction rolls back instead of allowing negative inventory.

```ts
require task.quantity <= available_quantity
problem_center_tasks.status → 'resolved'
inventory_movements INSERT { movement_type: 'shrinkage', quantity_delta: -qty }
inventory_truth UPDATE { on_hand -= qty, available -= qty, sellable -= qty }
  WHERE on_hand >= qty AND available >= qty
require updated_rows === 1 else rollback
```

### `return` (not yet built — INV-PC-05)

```ts
problem_center_tasks.status → 'returned_to_supplier'
purchase_order_line_items INSERT (return line)
suppliers UPDATE { defect_rate recalculated }
```

### `find_replacement` (backend LIVE, frontend PLANNED — INV-PC-06)

```ts
problem_center_tasks.status → 'investigating'
GET /problem-center/:taskId/replacement → replacement_locations[]
UI: operator directed to alt bin with available stock
```

---

## 12. Design System Contract

All Problem Center UI must comply with LaSyncro FT2 DS:

| Rule | Value |
| --- | --- |
| Borders | `0.5px solid var(--color-border-secondary)` |
| Font weight | Max `500` — never `600`, `700`, `bold` |
| Colors | CSS vars only — no hardcoded hex |
| Stage badges | Chip with `sx.backgroundColor` from stage token map (not MUI `color` prop) |
| Exception badges | MUI `color` prop: `error` \| `warning` \| `default` |
| Spacing | `var(--space-*)` tokens |

---

## 13. Changelog

### v1.1 — May 27, 2026

**INV-PC-03 — RESOLVED:** Resolve modal rewired to `httpResolveProblemTask`.

- Action selector UI replaces free-text-only modal
- Options filtered per `exception_type` via `RESOLUTION_OPTIONS` + `forTypes`
- `DEFAULT_ACTION` map sets sensible default per exception type at dialog open
- `onResolve(id, action, note)` — action now passed through to backend

**Cascade corrections applied:**

| Action | Previous behaviour | Correct behaviour |
| --- | --- | --- |
| `re_stow` | Could create a stow destination from the problem-bin value and confirmation could fall back to warehouse root as source | Creates a pending `stow_tasks` row with `location_code=null`. Operator must assign a valid active bin. Confirmation resolves the source from `problem_center_tasks.problem_bin_location` and writes a net-zero `location_transfer` pair from problem bin → destination bin. |
| `quarantine` | Shared branch with `re_stow`; later implementation rewrote every matching `inventory_truth.location_code`, causing split-stock primary-key collisions | Isolated: requires exactly one row with `on_hand_quantity > 0`, then moves only that row to the problem bin. Zero or multiple stock-holding locations return 409. No stow task or inventory movement is created. |
| `return` | In `VALID_ACTIONS` + `statusMap` | **Removed entirely.** Not a feasible workflow path — no return job infrastructure exists and shipping cost falls on owner. |

**Schema changes (base migration — dev reset applied):**

- `stow_task_trigger` enum: `problem_center` value added
- `stow_tasks.source_task_id` (uuid, nullable): links back to originating `problem_center_tasks` row

**Open issues updated:**

- INV-PC-03: ✅ RESOLVED
- INV-PC-04: ✅ RESOLVED (`re_stow` cascade now creates stow task)
- INV-PC-05: CLOSED — `return` resolution removed as not feasible

### v1.2 — May 27, 2026

**INV-PC-06 — RECLASSIFIED:** Replacement finder is NOT a Problem Center UI feature.
Replacement suggestions belong contextually inside pick-job and pack-job workflows:

- **Pick job:** Post-pick-list screen shows alternates for unresolved exceptions before handoff to pack (GH issue created)
- **Pack job:** "Item missing" button creates problem_center_tasks row + ships partial + notifies Problem Center (GH issue created)
The Problem Center remains a supervisor resolution queue only. Operators interact with replacement finder inside their active workflow, not from a supervisor table.
`GET /api/v1/wms/problem-center/:taskId/replacement` endpoint remains valid — will be consumed by pick-job completion screen in the pick-job refinement sprint.

---

## 11. Pack Decision Requests — Pending Decisions Strip [LIVE — May 30, 2026]

`PendingDecisionsStrip` component renders above the exceptions table in `ProblemCenterPage.tsx` whenever `pack_decision_requests` with `status=pending` exist for the shop.

**What it shows:**

- Exception type + order reference + batch short ID + time raised
- "Ship partial" (approve, `partial_shipment=true`) and "Hold order" (reject) actions
- Optional note dialog before confirming
- Polls `GET /api/v1/wms/pack/decision-requests?status=pending` every 10s

**Why here and not only in Alerts:**

- Alerts surface is optimised for triage (see it, route to module)
- Problem Center is the resolution surface — owner is already here to resolve exceptions
- Packer is blocked in real time — 10s poll here vs 30s poll on Alerts

**Full contract:** `docs/playbooks/wms_pack_decision_playbook.md`

### v1.3 — May 28, 2026

**INV-PC-02 — RESOLVED:** Native `ProblemTask` type replaces legacy `PickException`.

**Type changes:**

| Removed | Added |
| --- | --- |
| `PickException` | `ProblemTask` |
| `quantity_found` | — |
| `pick_batch_id` | `prob_label` (maps to `notes` column — PROB label) |
| `lasyncro_line_item_id` | `problem_bin_location` |
| `raised_by` | `status` (full enum) |
| `batch_short_id` | — |

**Table column changes:** REQ → QTY, FOUND removed, BATCH → PROB LABEL, BIN added.

**`useProblemCenter`:** Direct field mapping — no stub values. `total_unresolved` counts `open` + `investigating` status rows only.

### v1.4 — October 10, 2026 (GH-1238 / PC-SAFE-01)

- Fail-closed, default-deny resolution eligibility (§4.2), enforced in `problemCenterResolutionPolicy.ts`; `409 RESOLUTION_NOT_ELIGIBLE` with zero side effects.
- Every terminal status rejects re-resolution.
- In-truth quarantine (whole-row rewrite) and inferred-stock discard / write-off removed; GH-1202 outside-truth behaviour unchanged.
- Generic `POST /problem-center` rejects system-owned classifications and malformed quantities (400).
- Legacy `POST /problem-center/pick-exceptions/:exceptionId/resolve` retired (410); Order Detail hands off to Problem Center instead of closing Pick exceptions.
- Resolve dialog: no hidden `write_off` default, radio semantics, truthful Quarantine copy.
- Open: ordinary Pick recovery/settlement — GH-1240.
