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

The Problem Center is LaSyncro's physical warehouse exception triage surface. It is the single destination where all anomalous physical items — items that cannot continue through their normal workflow — are collected, tracked, and resolved.

**Core principle:** Every exception in every WMS workflow (pick, pack, stow, receive, returns) produces one outcome: the operator physically moves the item to a designated problem bin, and one `problem_center_tasks` row is created. The owner/admin resolves it. Resolution always has an inventory consequence.

**What it is NOT:**

- Not an order-exception surface (order constraints live in `order_constraints` + Order Nexus)
- Not an inventory intelligence surface (SKU Gaps handles product-side data quality)
- Not a customer issue tracker

---

## 2. Actors & Permissions

| Actor | Capability |
|---|---|
| **Operator** | Reports exceptions from pick/pack/stow/receive workflows. Sees tasks assigned to them or unassigned pool (first-to-claim). Physically moves items to problem bin. |
| **Owner / Admin** | Sees all tasks across all operators. Resolves tasks with resolution action. Configures problem bin location. |

Role filtering is enforced in `httpGetProblemTasks` — operators only see pool + tasks assigned to themselves.

---

## 3. Data Model [LIVE — Migration 0103]

**File:** `apps/backend/migrations/20260429190901_0103_create_problem_center_tasks.ts`

### 3.1 Table: `problem_center_tasks`

| Column | Type | Notes |
|---|---|---|
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
```
open → investigating → resolved | discarded | returned_to_supplier
```

**`problem_center_source`**
```
pick | pack | stow | receive | returns
```

### 3.3 Related table: `shop_wms_settings` (relevant columns)

| Column | Purpose |
|---|---|
| `problem_bin_location` | Configurable per-shop (e.g. `WH-1-PROBLEM`). Copied into task at creation. |
| `prob_label_sequence` | Auto-incrementing integer. Atomically incremented on each task creation. |

⚠️ **Known issue:** `problem_bin_location` is currently empty string `''` in seeded data (not `null`, not a valid location code). Must be configured by owner before tasks are meaningful.

---

## 4. Exception Taxonomy

### 4.1 Exception Types (by source)

| Source | Exception Type | Meaning |
|---|---|---|
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
|---|---|---|---|
| `re_stow` | `resolved` | Creates new stow task — item re-enters inventory | ❌ PLANNED |
| `discard` | `resolved` | Writes `damage` movement → decrements `inventory_truth` | ✅ LIVE |
| `write_off` | `resolved` | Writes `shrinkage` movement → decrements `inventory_truth` | ✅ LIVE |
| `return` | `returned_to_supplier` | Future: creates return PO line | ❌ PLANNED |
| `quarantine` | `resolved` | No inventory movement — item held indefinitely | ✅ LIVE |
| `find_replacement` | `investigating` | No movement — triggers replacement search | ✅ LIVE (backend) / ❌ PLANNED (UI) |

---

## 5. PROB Label System [LIVE]

Every task creation atomically:

1. Increments `shop_wms_settings.prob_label_sequence`
2. Generates label: `PROB-{shopId}-{sequence padded to 4 digits}` (e.g. `PROB-1-0001`)
3. Creates a `barcode_print_jobs` row for physical label printing
4. Copies current `problem_bin_location` into the task row

The PROB label is the physical tracking token. Operator prints and attaches it to the item before moving to problem bin.

---

## 6. API Endpoints [LIVE]

All routes: `authenticateToken` + `requireFt2` + `requireTier('core')`

| Method | Path | Handler | Status | Notes |
|---|---|---|---|---|
| `GET` | `/api/v1/wms/problem-center` | `httpGetProblemTasks` | ✅ LIVE | Role-filtered list of open/investigating tasks |
| `POST` | `/api/v1/wms/problem-center` | `httpCreateProblemTask` | ✅ LIVE | Creates task + PROB label + print job |
| `POST` | `/api/v1/wms/problem-center/:taskId/resolve` | `httpResolveProblemTask` | ✅ LIVE | Resolves with action + cascade |
| `GET` | `/api/v1/wms/problem-center/:taskId/replacement` | `httpFindReplacementForTask` | ✅ LIVE | Finds same variant at other locations with sufficient stock |
| `GET` | `/api/v1/wms/problem-center/pick-exceptions` | `httpGetProblemCenterExceptions` | ✅ LIVE | Legacy: reads `pick_exceptions` table directly |
| `POST` | `/api/v1/wms/problem-center/pick-exceptions/:exceptionId/resolve` | `httpResolveException` | ✅ LIVE | Legacy: resolves `pick_exceptions` row (note-only, no cascade) |

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
  "problem_bin": "WH-1-PROBLEM"
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
|---|---|---|---|
| **Pick** | `POST /api/v1/wms/batch/:id/exception` | `httpReportPickException` | None at report time — on resolve |
| **Stow** | `POST /api/v1/wms/stow-tasks/:taskId/exception` | `httpReportStowException` | `shrinkage` or `damage` written immediately |
| **Pack** | Pack scan exception flow | Pack controller | ❌ `wms_pack_exception` alert not firing (ISSUE-006 — open) |
| **Receive** | Receive rejection | Receive controller | Via `receive_rejection` exception type |
| **Returns** | Return shortfall / repackaging | Returns controller | Via `returns` source |

⚠️ **Stow exceptions write inventory movement immediately** (at report time), before resolution. This differs from pick exceptions which defer the movement to resolve time. This inconsistency should be unified — tracked as INV-PC-01.

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

The resolve button opens a modal. Current modal accepts a **free-text note only** and calls `POST /api/v1/wms/problem-center/pick-exceptions/:exceptionId/resolve` (the **legacy endpoint** — not `httpResolveProblemTask`).

This means:

- Resolution action selector is NOT shown to the user
- No downstream cascade fires (no stow task created, no inventory movement written)
- `httpResolveProblemTask` with its full cascade logic is **never called from the frontend**

Tracked as **INV-PC-03** — highest priority open item.

---

## 9. Open Issues

| ID | Priority | Status | Description |
|---|---|---|---|
| **INV-PC-01** | P2 | 🔴 OPEN | Stow exceptions write inventory movement immediately at report time; pick exceptions defer to resolve. Inconsistent — should unify to deferred (resolve-time) movement writes |
| **INV-PC-02** | P3 | 🔴 OPEN | `ProblemCenterModuleFT2` uses legacy `PickException` type with stubbed fields (`quantity_found=0`, `lasyncro_line_item_id=task_id`). Module needs its own native type aligned to `problem_center_tasks` shape |
| **INV-PC-03** | P1 | 🔴 OPEN | Resolve modal calls legacy `pick-exceptions` endpoint (note-only, no cascade). Must be rewired to `httpResolveProblemTask` with action selector UI — `re_stow`, `discard`, `write_off`, `return`, `quarantine` |
| **INV-PC-04** | P1 | 🔴 OPEN | `re_stow` resolution creates no stow task — cascade not implemented. Must create `stow_tasks` row so item re-enters inventory workflow |
| **INV-PC-05** | P2 | 🔴 OPEN | `return` resolution creates no PO return line — cascade not implemented |
| **INV-PC-06** | P2 | 🔴 OPEN | Replacement finder (`GET /problem-center/:taskId/replacement`) has no frontend surface — when `find_replacement` action selected, replacement locations must render inline |
| **INV-PC-07** | P2 | 🔴 OPEN | `problem_bin_location` is empty string in seeded `shop_wms_settings` — must be non-empty for PROB label + operator instructions to be meaningful. Add validation + onboarding prompt |
| **INV-PC-08** | P3 | 🔴 OPEN | Pack exception alert (`wms_pack_exception`) never fires — `packScan.service.ts` has no call to alert system (ISSUE-006 carried forward) |
| **INV-PC-09** | P3 | 🔴 OPEN | Operator post-exception instruction ("Move to problem bin: X") does not show if `problem_bin_location` is empty — should guard and prompt owner to configure |
| **INV-PC-10** | P3 | 🔴 OPEN | No mobile `ProblemCenterScreen` in React Native app — operators resolve on web only |

---

## 10. Intended Full Workflow (Target State)

```
Operator encounters exception during pick/pack/stow/receive
  ↓
Reports exception in WMS mobile UI
  ↓
System creates problem_center_tasks row + PROB label print job
  ↓
Operator prints PROB label → attaches to item → moves to problem bin
  ↓
Operator sees instruction: "Move to {problem_bin_location}" (WH-1-PROBLEM)
  ↓
Owner/Admin opens Problem Center → sees all open tasks
  ↓
Selects resolution action per task:
  ├── re_stow      → new stow_task created → operator stows item correctly
  ├── discard      → damage movement written → inventory decremented
  ├── write_off    → shrinkage movement written → inventory decremented
  ├── return       → return PO line created → supplier defect_rate updated
  ├── quarantine   → item held, no movement
  └── find_replacement → replacement locations shown → operator picks from alt bin
  ↓
Task status → resolved | discarded | returned_to_supplier
  ↓
Inventory truth reflects reality
```

---

## 11. Resolution Cascade — Target Implementation

### `re_stow` (not yet built — INV-PC-04)
```
problem_center_tasks.status → 'resolved'
stow_tasks INSERT {
  lasyncro_variant_id, quantity,
  location_code: <operator-selected or auto-assigned>,
  source: 'problem_center',
  source_task_id: problem_task_id
}
```

### `discard` (LIVE)
```
problem_center_tasks.status → 'resolved'
inventory_movements INSERT { movement_type: 'damage', quantity_delta: -qty }
inventory_truth UPDATE { on_hand -= qty, available -= qty, sellable -= qty }
```

### `write_off` (LIVE)
```
problem_center_tasks.status → 'resolved'
inventory_movements INSERT { movement_type: 'shrinkage', quantity_delta: -qty }
inventory_truth UPDATE { on_hand -= qty, available -= qty, sellable -= qty }
```

### `return` (not yet built — INV-PC-05)
```
problem_center_tasks.status → 'returned_to_supplier'
purchase_order_line_items INSERT (return line)
suppliers UPDATE { defect_rate recalculated }
```

### `find_replacement` (backend LIVE, frontend PLANNED — INV-PC-06)
```
problem_center_tasks.status → 'investigating'
GET /problem-center/:taskId/replacement → replacement_locations[]
UI: operator directed to alt bin with available stock
```

---

## 12. Design System Contract

All Problem Center UI must comply with LaSyncro FT2 DS:

| Rule | Value |
|---|---|
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
|---|---|---|
| `re_stow` | Moved `inventory_truth.location_code` to PROBLEM bin | Creates `stow_tasks` row (`trigger=problem_center`, `source_task_id=taskId`). Item stays in problem bin physically; operator claims and confirms stow task to re-enter inventory. |
| `quarantine` | Shared branch with `re_stow` | Isolated: moves `inventory_truth.location_code` to problem bin only. No stow task created. |
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

### v1.3 — May 28, 2026

**INV-PC-02 — RESOLVED:** Native `ProblemTask` type replaces legacy `PickException`.

**Type changes:**

| Removed | Added |
|---|---|
| `PickException` | `ProblemTask` |
| `quantity_found` | — |
| `pick_batch_id` | `prob_label` (maps to `notes` column — PROB label) |
| `lasyncro_line_item_id` | `problem_bin_location` |
| `raised_by` | `status` (full enum) |
| `batch_short_id` | — |

**Table column changes:** REQ → QTY, FOUND removed, BATCH → PROB LABEL, BIN added.

**`useProblemCenter`:** Direct field mapping — no stub values. `total_unresolved` counts `open` + `investigating` status rows only.
