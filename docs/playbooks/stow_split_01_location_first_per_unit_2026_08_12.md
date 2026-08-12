# STOW-SPLIT-01 — Location-First Per-Unit Split Stow

**Status:** CLOSED  
**Implemented and runtime verified:** 2026-08-12  
**Scope:** Webapp Stow session, backend per‑unit confirmation, inventory‑unit movement identity, persisted progress, split‑bin execution, refresh/resume, Shopify quantity delta

---

## 1. Problem

The historical webapp Stow workflow treated a task as a bulk quantity:

```text
location
→ product
→ quantity confirmation
→ review
→ commit
```

That model did **not** represent the physical warehouse operation required for split stow.

A task containing multiple physical units must allow:

```text
unit 1 → A-1
unit 2 → A-2
```

without completing the task after the first confirmation, losing the active scanner, or moving both units to the same destination.

The old frontend also treated browser‑local `remainingQty` as completion truth. After refresh or Fast Refresh a partially completed task could be reconstructed from the original task total, causing the final physical scan to leave the UI showing work remaining even though the backend had already completed the task.

---

## 2. Final Operator Contract

```text
Brief
  ↓
scan location
  ↓
ACTIVE bin
  ↓
scan one unit
  ↓
commit one physical unit
  ↓
remain ACTIVE
  ├─ scan another unit
  ├─ scan another bin → switch ACTIVE bin
  └─ persisted task complete → next task / Complete
```

The active location is session‑level sticky state.

A location scan changes the active destination.

A unit scan performs the physical mutation.

A task completes **only** when persisted cumulative placement reaches the task quantity.

---

## 3. UX Contract

### Inactive bin

```text
No active bin · INACTIVE
Scan a bin barcode to begin.
```

### Active bin

```text
A-1 · ACTIVE
0 placed here · 2 remaining
Scan a unit, or scan another bin to move.
```

### Successful placement

```text
Unit placed · LSU-...
```

### Rejected placement

The error remains visible until the next scan and explains:

- what failed in warehouse terms;
- what the operator should do next.

Technical backend/service/database wording is retained in the browser console for diagnostics and is **never** rendered directly to the operator.

### Cognitive‑load decisions

Webapp Stow intentionally does **not** render:

- quantity‑confirm controls;
- bulk shortfall/review state;
- Summary‑before‑commit screen;
- NodeTrack;
- duplicate active‑location alerts;
- LSU chip lists;
- redundant linear progress.

Persistent operational context is limited to:

```text
Stow N of M
active bin
placed-here count
remaining units
one scan input
last scan result
```

---

## 4. Scanner Contract

Once a location is active, one scanner accepts both location and item scans.

**Resolution order:**

```text
scan
  ↓
try location resolution first
  ├─ valid location → activate/switch bin
  └─ not a location → resolve item barcode
                         ↓
                    validate task/unit
                         ↓
                    commit exactly 1
```

The scanner is protected by a **synchronous ref lock** in addition to React state. Two rapid scanner events must never create concurrent physical mutations.

---

## 5. Location Assignment Contract

A Stow destination may be assigned while a task is:

```text
pending
in_progress
```

This is required for split stow.

**Example:**

- task quantity = 2
- A‑1 active → scan LSU‑1 → `quantity_placed = 1`
- scan A‑2 → task remains `in_progress` → destination becomes A‑2 → no inventory movement yet
- scan LSU‑2 → physical unit moves to A‑2 → `quantity_placed = 2` → task completed

Changing destination **never** retroactively changes the location of units already stowed.

---

## 6. Per‑Unit Backend Contract

Each physical confirm receives:

```ts
quantity_placed = 1
lasyncro_unit_id = concrete LSU
```

`confirmStow()` accumulates:

```text
placedNow = number of physical units moved by this transaction
quantity_placed = persisted cumulative placed quantity
```

and returns:

```ts
{
  isFullyPlaced,
  quantityPlaced,
  quantityTotal,
  placedNow
}
```

Task status becomes `completed` only when:

```text
quantity_placed >= quantity
```

Otherwise it remains `in_progress`.

---

## 7. HTTP Authoritative Progress Contract

```http
GET /api/v1/wms/stow-tasks
```

exposes:

```text
quantity
quantity_placed
```

```http
POST /api/v1/wms/stow-tasks/:id/confirm
```

returns:

```json
{
  "stow_task_id": "...",
  "status": "in_progress | completed",
  "is_fully_placed": false,
  "quantity_placed": 1,
  "quantity_total": 2,
  "placed_now": 1
}
```

The response is the **authoritative** result of the committed transaction.

Frontend completion must use:

```text
is_fully_placed
```

and remaining work must be derived from:

```text
quantity_total - quantity_placed
```

**Never** determine Stow completion from:

```text
browserRemaining - 1
```

---

## 8. Refresh/Resume Invariant

On session bootstrap:

```ts
remaining = max(task.quantity - task.quantity_placed, 0)
```

The same calculation is used when auto‑advancing to another already‑partial task.

This allows a browser refresh, reconnect or frontend remount to reconstruct the warehouse state from persisted database truth.

**Runtime regression verification proved:**

- task quantity = 2
- first unit committed at A‑1 → `quantity_placed = 1`
- browser/session resumed → UI still rendered **1 remaining**
- active destination switched to A‑2
- second unit committed → UI transitioned to **Stow complete**

---

## 9. Inventory‑Unit Movement Identity

`inventory_movements.reference_id` is UUID.

The scanner identity is:

```text
LSU-xxxxxxxx
```

but ledger identity must therefore be:

```text
inventory_units.id
```

Before writing per‑unit movements, Stow resolves:

```text
lasyncro_unit_id → inventory_units.id
```

and fails closed if an inventory‑unit UUID cannot be resolved.

Movement rows use:

```ts
reference_type = 'inventory_unit'
reference_id   = inventory_units.id
```

The LSU remains the human/scanner‑facing immutable unit identifier.

---

## 10. Inventory Conservation

For an ordinary received inbound unit:

```text
WH-{shopId}-ROOT  -1
destination bin   +1
```

Both movements belong to the same physical inventory‑unit UUID.

Split stow therefore produces **independent movement pairs** for each unit rather than one task‑scoped bulk movement.

---

## 11. Shopify Synchronization Invariant

A per‑unit confirm must synchronize only what that transaction physically placed.

**Correct:**

```ts
quantityDelta = confirmResult.placedNow
```

**Incorrect:**

```ts
quantityDelta = stowTask.quantity
```

Using total task quantity on every confirm would double‑count or multiply‑count a task that is stowed incrementally or across several locations.

Failure of the external Shopify synchronization remains non‑fatal to the already‑committed internal warehouse transaction and is logged for reconciliation.

---

## 12. Frontend Callback Contract

The Stow confirm callback returns the authoritative response rather than `Promise<void>`.

Conceptually:

```ts
onConfirmStow(...) → Promise<WmsStowConfirmResult>
```

The module must **never** replace a missing confirm adapter with a silent `Promise.resolve()`.

If the adapter is unavailable, the workflow rejects explicitly and tells the operator to return to Operations and retry.

---

## 13. Runtime Verification

### Split‑bin Completion Fixture

**Product:**

```text
INV10B Split Fixture
SKU / barcode: INV10B-SPLIT-01
```

**Verified task:**

```text
20dbc118-3c13-4147-8354-b493fe00295d
quantity = 2
quantity_placed = 2
status = completed
```

**Physical result:**

```text
LSU-890fcf24 → A-1
LSU-bcdb3116 → A-2
```

**Ledger result:**

```text
LSU-890fcf24
  WH-1-ROOT  -1
  A-1        +1

LSU-bcdb3116
  WH-1-ROOT  -1
  A-2        +1
```

No open Stow task remained for the variant.

### Refresh/Resume Regression Fixture

**Task:**

```text
327db8aa-46d0-461c-9ace-8b4fc572a12c
```

After first physical placement:

```text
quantity = 2
quantity_placed = 1
status = in_progress

LSU-5c23f01e
  status = stowed
  current_location_code = A-1

LSU-53d4a0aa
  status = received
```

The resumed UI showed:

```text
A-1 ACTIVE
1 placed here · 1 remaining
```

The active bin was then switched to A‑2 and the second unit committed.

**Final state:**

```text
task
  quantity = 2
  quantity_placed = 2
  location_code = A-2
  status = completed

LSU-5c23f01e → A-1
LSU-53d4a0aa → A-2
```

**Final ledger:**

```text
LSU-5c23f01e
  WH-1-ROOT  -1
  A-1        +1

LSU-53d4a0aa
  WH-1-ROOT  -1
  A-2        +1
```

Open tasks for the variant: **0**

The UI transitioned automatically to:

```text
Stow complete
```

---

## 14. Verification Gates Passed

- [x] location‑first workflow verified in real operator UI
- [x] sticky active bin verified
- [x] in‑progress destination switch verified
- [x] destination switch alone produced no physical movement
- [x] first unit remained at its original bin after active‑bin switch
- [x] exact LSU per‑unit commit verified
- [x] generic product scanner path exercised
- [x] source/destination movement conservation verified
- [x] movement UUID reference identity verified
- [x] cumulative `quantity_placed` verified
- [x] partial task remained `in_progress`
- [x] final task became completed `2/2`
- [x] authoritative confirm response wired through frontend
- [x] browser‑local completion decrement removed
- [x] refresh/resume reconstructed **1 remaining**
- [x] final scan auto‑transitioned to **Stow complete**
- [x] no open duplicate Stow task remained
- [x] Shopify sync delta changed from task total to `placedNow`
- [x] WMS targeted TypeScript check passed
- [x] source `git diff --check` passed

---

## 15. Files Changed

```text
apps/backend/src/api/wms/wms.controller.ts
apps/backend/src/services/wms/stow.service.ts
apps/frontend/src/pages/ft2-pages/WmsOperationsPage.tsx
modules/wms/src/ui/index.ts
modules/wms/src/ui/pages/StowSessionPage.tsx
modules/wms/src/ui/pages/WmsModuleFT2.tsx
docs/playbooks/wms_webapp_workflow_playbook.md
docs/playbooks/stow_split_01_location_first_per_unit_2026_08_12.md
```

No migration was required.

---

## 16. Related Contracts

```text
docs/playbooks/inv_block_04_stow_source_semantics_2026_08_10.md
docs/playbooks/stow_lsu_01_received_unit_source_fallback_2026_08_11.md
docs/playbooks/inv_proj_multiloc_01_inventory_rebuild_2026_08_11.md
docs/playbooks/wms_barcode_identity_resolution_playbook.md
```

---

## 17. Durable Invariants

- A location scan selects where future physical units will be placed; it does **not** move inventory by itself.
- One successful physical unit scan commits exactly **one** physical unit.
- Units already stowed **never** move merely because the active destination changes.
- Partial task progress is persisted in `stow_tasks.quantity_placed`.
- Browser state **never** decides warehouse completion.
- Ledger `reference_id` uses the inventory‑unit UUID, **not** the LSU string.
- A split task may finish with its physical units in several bins.
- Shopify receives only the quantity physically committed by the current confirm transaction.

---

## 18. Verification Commands

The following commands were used to confirm the playbook and contract alignment:

```zsh
cd /Users/miladarbabi/Codes/projects/SynchroFlow || return

print -r -- '=== DOCUMENTED STOW CURRENT CONTRACT ==='
grep -n -A95 -B10 \
'STOW-SPLIT-01 verified August 12, 2026' \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/wms_webapp_workflow_playbook.md

print -r -- '=== HISTORICAL CONTRACT MARKED SUPERSEDED ==='
grep -n -A28 -B5 \
'Historical Stow Contract — superseded August 12, 2026' \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/wms_webapp_workflow_playbook.md

print -r -- '=== NO AUTHORITATIVE OLD STOW LABEL ==='
grep -nF \
'### Stow *(next to audit)*' \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/wms_webapp_workflow_playbook.md

print -r -- '=== REFRESH CONTRACT DOCUMENTED ==='
grep -n -A30 -B8 \
'STOW-SPLIT-01 refresh invariant' \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/wms_webapp_workflow_playbook.md

print -r -- '=== NEW STOW-SPLIT PLAYBOOK ==='
sed -n '1,260p' \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/stow_split_01_location_first_per_unit_2026_08_12.md

print -r -- '=== NEW PLAYBOOK TAIL ==='
tail -120 \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/stow_split_01_location_first_per_unit_2026_08_12.md

print -r -- '=== STOW-SPLIT DOC REFERENCES ==='
grep -RIn \
'STOW-SPLIT-01' \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/wms_webapp_workflow_playbook.md \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/stow_split_01_location_first_per_unit_2026_08_12.md

print -r -- '=== DOC DIFF ==='
git diff -- \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/wms_webapp_workflow_playbook.md \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/stow_split_01_location_first_per_unit_2026_08_12.md

print -r -- '=== DOC DIFF CHECK ==='
git diff --check -- \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/wms_webapp_workflow_playbook.md \
  /Users/miladarbabi/Codes/projects/SynchroFlow/docs/playbooks/stow_split_01_location_first_per_unit_2026_08_12.md
```

---

*End of playbook*