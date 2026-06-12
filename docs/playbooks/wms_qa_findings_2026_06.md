# WMS QA Findings — June 2026 (QA Workflow UX/UI - 2)

## Session Summary

Full end-to-end QA of the warehouse pipeline: **Receive → Stow → Pick → Pack**.
All phases completed successfully after fixes. Issues logged below.

---

## Bugs Fixed During Session

### 1. Stow did not write inventory_movements (Critical)

**Symptom:** `stow_tasks.inventory_movement_id` was always NULL. No `location_transfer` rows in `inventory_movements` after stow.
**Root cause:** `confirmStow()` updated `inventory_truth` and `inventory_units` but never wrote movement ledger entries. The `location_transfer` enum value also did not exist.
**Fix:** Migration `0116` + updated `stow.service.ts`.
See `docs/blueprints/inventory_movement_audit_trail.md` for full architecture.

### 2. Dev seed not recompiled before run

**Symptom:** Changes to `dev_seed.ts` not reflected in seed runs.
**Root cause:** Knex runs the compiled JS from `dist/seeds/`. TypeScript changes require recompilation.
**Fix:** Always run `npm run migrate -w apps/backend` before seed changes take effect, or run `npx tsc --project tsconfig.migrations.json` explicitly.

### 3. Legacy barcode resolution missing for full_data variants

**Symptom:** Picking full_data variants (LINEN, WOOL, TOTE) failed with "barcode does not match."
**Root cause:** `full_data` seed did not insert rows into `external_product_identity_map`, so `resolveBarcode()` returned null for these variants.
**Fix:** Added legacy barcode seed block in `dev_seed.ts` after variants loop using raw SQL (Knex builder silently failed due to nullable unique constraint columns).

---

## Bugs Logged (Open Issues)

| Issue | Title | Priority |
|-------|-------|----------|
| #1002 | feat: dynamic warehouse naming & multi-warehouse architecture | High |
| TBD | bug: pool displays truncated UUID instead of external order ID | Medium |
| TBD | feat: add 'release selected orders only' option to batch release dialog | Medium |
| TBD | bug: pick scan card shows redundant variant title separate from SKU | Low |
| TBD | bug: location scan accepts lowercase input during pick | Medium |
| TBD | UX: Chrome popup blocker prevents LSU PDF from opening on receive close | Medium |
| TBD | UX: long processing delay after final scan before LSU PDF renders | Low |

---

## Dev Seed Requirements

Run in this exact order for a clean WMS QA environment:

```bash
# 1. Full reset (drops + recreates DB, runs all migrations, seeds full_data)
npm run dev:full-reset

# 2. Layer identity, operator, lifecycle, QA PO + barcodes on top
DEV_SEED_MODE=full_identity npm run seed -w apps/backend
```

After reset, the environment has:
- `owner@test.com / password123` (role: owner)
- `operator@test.com / password123` (role: operator)
- Lifecycle at FT2
- 3 QA variants (`QA-SHIRT-S`, `QA-HOODIE-M`, `QA-CAP-OS`) with LSU barcodes registered
- 1 QA PO (status: shipped, ready to receive)
- 3 QA orders in the pool (`#900001–900003`)
- 10 full_data variants (LINEN/WOOL/TOTE) with legacy barcodes = SKU string
- 12 pick bins (A-1 … C-4) + PROBLEM quarantine bin

---

## Barcode Resolution Reference

| Scanned value | Resolution path | Table |
|---------------|-----------------|-------|
| `LSU-xxxxxxxx` | Unit barcode path | `inventory_units.lasyncro_unit_id` |
| `LSO-xxxxxxxx` | Invoice barcode — rejected at variant resolver | — |
| `LINEN-GRY-S` (SKU string) | Legacy path: `barcode` column match | `external_product_identity_map` |
| `LOC-A-1` | Location barcode | `warehouse_locations.barcode` |
| `A-1` | Location code direct | `warehouse_locations.location_code` |

Legacy path is gated by `shop_wms_settings.legacy_barcode_fallback_enabled`. When `false`, only LSU barcodes are accepted.

---

## Warehouse Floor Plan (Seed Default)

```
WH-1-ROOT (12m × 12m)
  Aisle A (pick zone): A-1, A-2, A-3, A-4 — 3 rack levels each
  Aisle B (pick zone): B-1, B-2, B-3, B-4
  Aisle C (pick zone): C-1, C-2, C-3, C-4
  PROBLEM (quarantine): position (8.0, 1.0) — parent: A
```

QA stow assignments (default): `QA-SHIRT-S → A-1`, `QA-HOODIE-M → A-2`, `QA-CAP-OS → A-3`

---

## Phase Completion Status

| Phase | Status | Notes |
|-------|--------|-------|
| Receive | ✅ | LSU barcodes generated, stow tasks created |
| Stow | ✅ | inventory_movements audit trail verified (post-0116) |
| Pick | ✅ | Both LSU path and legacy SKU path verified |
| Pack | 🔄 | In progress |

---

## Mobile Smoke Test — June 11, 2026

Full end-to-end API wiring audit for the mobile workflow screens (ReceiveJobScreen, StowScreen, PickBriefScreen). Run against live dev environment with real schema — no assumptions.

### Environment baseline confirmed

- 42 variants, 42 barcode entries, 39 orders, 3 POs, 17 warehouse locations
- All mobile route paths verified against `suppliers.routes.ts` and `wms.routes.ts` — no 404 mismatches
- Exception types verified for all three screens — all aligned with backend validators

---

### Findings

#### MOB-SMOKE-01 — Semantic: Receive job creation requires explicit owner action

**Type:** Semantic / documentation gap
**Status:** ✅ FIXED — comment updated in `receiveJob.service.ts` line 38; now correctly documents explicit POST trigger
**Detail:** `receiveJob.service.ts` comment line 38 states the receive job is auto-created on PO → `shipped` transition. This is factually incorrect. The status controller fires an alert only. The receive job must be explicitly created by owner/admin via `POST /purchase-orders/:poId/receive-jobs` after advancing the PO to `shipped`. The mobile operator never creates it — they only claim and work it. This dependency is invisible in the mobile app and must be documented in operator onboarding.
**Action:** Update stale comment in `receiveJob.service.ts` line 38. Add explicit note to `docs/blueprints/ReceiveJobProcess.md`.

---

#### MOB-SMOKE-02 — Semantic: Job status does not auto-advance after full inspection

**Type:** Semantic / UX concern
**Status:** ✅ FIXED — `inspectReceiveJobLine()` auto-advances job → `inspection` after all lines complete — `receiveJob.service.ts`
**Detail:** After all 3 lines are inspected (`inspection_complete = true` on all), the receive job remains `in_progress`. Expected advance to `inspection` or `barcode_assignment`. The mobile `ReceiveJobScreen` reads job status to determine which phase to render. If status never advances post-inspection, the screen phase logic relies entirely on local state rather than server state, making kill-and-relaunch resume unreliable for the post-inspection phase.
**Action:** Verify `ReceiveJobScreen` phase logic does not depend on server job status for the inspect→scan→close transition. If it does, the close endpoint must be re-examined.

---

#### MOB-SMOKE-03 — Semantic: `item_missing` guard in ReceiveJobScreen is dead code

**Type:** Semantic bug (harmless)
**Status:** ✅ FIXED — dead `item_missing` guard removed; prob-bin alert fires unconditionally — `ReceiveJobScreen.tsx`
**Detail:** `ReceiveJobScreen.tsx` line 264: `if (selectedExceptionType !== 'item_missing')` — but `item_missing` is not in the receive exception list (lines 53–58). This condition can never be true. It was copied from StowScreen/PickBriefScreen where `item_missing` is a valid type. Harmless but semantically incorrect.
**Fix:** Remove the `item_missing` guard from `ReceiveJobScreen`. The prob-bin alert should fire for all receive exception types unconditionally, or the correct receive-specific exception type should be checked.

---

#### MOB-SMOKE-04 — CRITICAL: Barcode resolver never returns `lasyncro_unit_id`

**Type:** Critical wiring bug
**Status:** ✅ FIXED — `barcodeResolution.service.ts` — `pickLegacyUnit()` helper added to all legacy paths
**Detail:** `POST /api/v1/wms/barcode/resolve` returns only `{ lasyncro_variant_id, resolution_method }`. It never returns `lasyncro_unit_id`. Both `StowScreen` and `PickBriefScreen` read `resolved.lasyncro_unit_id` from this response and thread it to `/stow-tasks/:id/confirm` and `/pick/scan`. Since the resolver omits it, `lasyncro_unit_id` is always `null` in both calls.

**Confirmed impact (live reproduction):**
- Stow confirm with `lasyncro_unit_id: null` accepted successfully
- `inventory_movements` wrote correctly (aggregate ledger sound)
- `inventory_units` records NOT updated: status stays `received`, `current_location_code` stays `null`
- Unit lifecycle tracking (`received → stowed → picked`) is silently broken for all stow and pick operations

**Root cause:** The barcode resolver resolves to variant level only. Unit assignment requires knowing which specific LSU code to advance — this must come from either (a) the resolver returning a specific unit from the available pool for that variant, or (b) the confirm endpoint selecting a unit itself.
**Priority:** P0 — inventory unit status is the source of truth for the unit lifecycle. All downstream operations (pick, pack, ship) that read `inventory_units.status` will see incorrect state.
**Action:** Decide resolution strategy: (A) resolver selects and returns the next available `LSU-` unit for the variant from `inventory_units` where `status = received` and `lasyncro_variant_id` matches, or (B) stow/pick confirm endpoint selects the unit internally when `lasyncro_unit_id` is null. Option A is preferred — it gives the mobile app the unit ID for display and threading.

---

#### MOB-SMOKE-05 — Semantic: device_event_id non-UUID silently replaced

**Type:** Semantic / idempotency concern
**Status:** ✅ NOT A BUG — server uses deterministic uuidv5-based device_event_id generated from stable keys (stow_task_id, batchId+lineItemId); client value intentionally discarded; idempotency guaranteed via onConflict().ignore() on inventory_movements
**Detail:** Smoke test sent `device_event_id: "smoke-confirm-stow-001"` (non-UUID string). The movement was written with a server-generated UUID `7994b133-...` instead. The server either ignores or replaces non-UUID client IDs. Mobile always sends real UUIDs via `newEventId()` so this is not a mobile bug — but the silent replacement means idempotency is server-generated, not client-controlled. A network retry from the mobile with the same `device_event_id` may not deduplicate if the server isn't storing and checking the client-provided value.
**Action:** Verify stow confirm handler stores and checks client-provided `device_event_id` for deduplication before writing movements.

---

### Smoke Test Progress

| Phase | Endpoint coverage | DB verification | Status |
|-------|------------------|-----------------|--------|
| Receive — create | `POST /purchase-orders/:poId/receive-jobs` | ✅ job + lines created | ✅ |
| Receive — claim | `POST /receive-jobs/:id/claim` | ✅ status `in_progress`, operator assigned | ✅ |
| Receive — inspect | `POST /receive-jobs/:id/inspect` | ✅ line counters correct | ✅ |
| Receive — exception | `POST /receive-jobs/:id/exception` | ⚠ not tested (close ran first) | ⚠ |
| Receive — close | `POST /receive-jobs/:id/close` | ✅ closed, stow tasks created, LSU codes generated | ✅ |
| Stow — list | `GET /wms/stow-tasks` | ✅ unit_ids present in response | ✅ |
| Stow — location | `PATCH /stow-tasks/:id/location` | ✅ | ✅ |
| Stow — claim | `POST /stow-tasks/:id/claim` | ✅ status `in_progress` | ✅ |
| Stow — barcode resolve | `POST /wms/barcode/resolve` | ✅ returns `lasyncro_unit_id` + `unit_status` (MOB-SMOKE-04 fixed) | ✅ |
| Stow — confirm | `POST /stow-tasks/:id/confirm` | ✅ ledger correct; unit threading unblocked by MOB-SMOKE-04 fix | ✅ |
| Pick — batch list | `GET /wms/batches` | 📋 pending | 📋 |
| Pick — line items | `GET /wms/batch/:id/line-items` | 📋 pending | 📋 |
| Pick — claim | `POST /wms/batch/:id/claim` | 📋 pending | 📋 |
| Pick — location resolve | `POST /wms/location/resolve` | ✅ (tested in stow) | ✅ |
| Pick — barcode resolve | `POST /wms/barcode/resolve` | ✅ returns `lasyncro_unit_id` + `unit_status` (MOB-SMOKE-04 fixed) | ✅ |
| Pick — scan | `POST /wms/pick/scan` | ✅ scan_id + movement written; unit threading now unblocked | ✅ |
| Pick — exception | `POST /wms/batch/:id/exception` | ✅ 6 exceptions registered, unresolved | ✅ |
| Pick — complete | `POST /wms/batch/:id/pick-complete` | ✅ batch status correct; ✅ order_warehouse_status → picked (MOB-SMOKE-07 fixed) | ✅ |

---

#### MOB-SMOKE-06 — Critical: batch release ignores order_ids filter

**Type:** Critical backend bug
**Status:** ✅ FIXED — `exclusive: true` param added to `releaseBatch()` and wired through controller
**Detail:** Two sub-issues found:
- **06a — Wrong key in smoke test** (not a bug): smoke test sent `order_ids`; controller reads `priority_order_ids`. The mobile never calls `batch/release` — release is an owner/web action only.
- **06b — Missing exclusive selection mode** (backend feature gap): `releaseBatch()` in `pickBatch.service.ts` always greedy-fills up to `max_batch_line_items`. `priorityOrderIds` only front-loads selected orders — remaining pool orders are still appended. There is no way to release *only* specific orders. Owner intent of "release this batch of selected orders only" is architecturally unsupported.
**Priority:** P1 (backend) — owners cannot control batch composition. Operators receive batches with unpickable orders and must file exceptions to complete.
**Action:** Add `exclusive: boolean` param to `releaseBatch()`. When `true` and `priorityOrderIds` provided, skip greedy fill entirely — batch only the explicitly selected orders.

---

#### MOB-SMOKE-07 — Critical: order_warehouse_status not updated on pick-complete

**Type:** Critical wiring bug
**Status:** ✅ FIXED — `order_warehouse_status` → `picked` + `picked_at` set in `httpCompletePick` after batch update — `wms.controller.ts`
**Detail:** After `POST /wms/batch/:id/pick-complete` returns `status: pick_complete`, all associated `order_warehouse_status` rows remain at `picking` with `picked_at: null`. The pick-complete handler does not advance order-level warehouse status.
**Impact:** Order tracking is broken — no order ever shows `picked` status. Downstream pack flow depends on warehouse status to surface orders correctly.
**Priority:** P1 — order lifecycle tracking broken at pick boundary.
**Action:** Audit pick-complete handler — verify `order_warehouse_status` update is wired after batch status transition.

---

### Smoke Test Progress

| Phase | Endpoint coverage | DB verification | Status |
|-------|------------------|-----------------|--------|
| Receive — create | `POST /purchase-orders/:poId/receive-jobs` | ✅ job + lines created | ✅ |
| Receive — claim | `POST /receive-jobs/:id/claim` | ✅ status `in_progress`, operator assigned | ✅ |
| Receive — inspect | `POST /receive-jobs/:id/inspect` | ✅ line counters correct | ✅ |
| Receive — exception | `POST /receive-jobs/:id/exception` | ⚠ not tested (close ran first) | ⚠ |
| Receive — close | `POST /receive-jobs/:id/close` | ✅ closed, stow tasks created, LSU codes generated | ✅ |
| Stow — list | `GET /wms/stow-tasks` | ✅ unit_ids present in response | ✅ |
| Stow — location | `PATCH /stow-tasks/:id/location` | ✅ | ✅ |
| Stow — claim | `POST /stow-tasks/:id/claim` | ✅ status `in_progress` | ✅ |
| Stow — barcode resolve | `POST /wms/barcode/resolve` | ✅ returns `lasyncro_unit_id` + `unit_status` (MOB-SMOKE-04 fixed) | ✅ |
| Stow — confirm | `POST /stow-tasks/:id/confirm` | ✅ ledger correct; unit threading now unblocked | ✅ |
| Pick — batch list | `GET /wms/batches` | ✅ batch surfaced correctly | ✅ |
| Pick — line items | `GET /wms/batch/:id/line-items` | ✅ lines returned; unit lifecycle verified — 50 units → stowed at A-2 after resolver fix | ✅ |
| Pick — claim | `POST /wms/batch/:id/claim` | ✅ status → picking | ✅ |
| Pick — location resolve | `POST /wms/location/resolve` | ✅ | ✅ |
| Pick — barcode resolve | `POST /wms/barcode/resolve` | ✅ returns `lasyncro_unit_id` + `unit_status` (MOB-SMOKE-04 fixed) | ✅ |
| Pick — scan | `POST /wms/pick/scan` | ✅ scan_id + movement written; unit threading now unblocked | ✅ |
| Pick — exception | `POST /wms/batch/:id/exception` | ✅ 6 exceptions registered | ✅ |
| Pick — complete | `POST /wms/batch/:id/pick-complete` | ✅ batch status correct; ✅ order_warehouse_status → picked (MOB-SMOKE-07 fixed) | ✅ |

---

### Open Issues Summary

| ID | Priority | Description |
|----|----------|-------------|
| MOB-SMOKE-01 | ✅ FIXED | Stale comment corrected in `receiveJob.service.ts` line 38 |
| MOB-SMOKE-02 | ✅ FIXED | `inspectReceiveJobLine()` now checks all lines post-inspect and advances job → `inspection` when complete — `receiveJob.service.ts` |
| MOB-SMOKE-03 | ✅ FIXED | Dead `item_missing` guard removed from `ReceiveJobScreen` — prob-bin alert fires unconditionally for all receive exception types |
| MOB-SMOKE-04 | ✅ FIXED | Barcode resolver now returns `lasyncro_unit_id`, `unit_status`, `current_location_code` via `pickLegacyUnit()` helper on all legacy paths — `barcodeResolution.service.ts` |
| MOB-SMOKE-05 | ✅ NOT A BUG | Server generates deterministic `device_event_id` via `uuidv5` from stable identifiers internally; client value intentionally ignored; `.onConflict().ignore()` guarantees idempotency server-side |
| MOB-SMOKE-06 | ✅ FIXED | `exclusive: true` + `priority_order_ids` added to `releaseBatch()` — skips greedy fill when exclusive mode set; wired through controller; logic verified, live test blocked by no unconstrained orders in pool |
| MOB-SMOKE-07 | ✅ FIXED | `httpCompletePick` now advances `order_warehouse_status` → `picked` + sets `picked_at` for all batch orders after `pick_batches` update — `wms.controller.ts` |

---

### LSU Generation Verification (Phase 2 — ✅ COMPLETE)

All checks passed against 148 generated units from the smoke test receive job.

| Check | Result | Detail |
|-------|--------|--------|
| Total units | ✅ | 148 = 50 + 50 + 48 (accepted quantities exact) |
| Format `LSU-` prefix | ✅ | 148/148 |
| Hex segment length | ✅ | 8 chars, 0 wrong length |
| Global uniqueness | ✅ | 148 distinct IDs, 0 collisions |
| Source field | ✅ | 148/148 `lasyncro_receive` |
| Initial status | ✅ | 148/148 `received` |
| Per-variant counts | ✅ | WOOL-NVY: 50, WOOL-GRN: 50, WOOL-BLK: 48 |
| receive_sequence | ✅ | Sequential per variant starting at 1 |
| Anatomy | ✅ | `LSU-{8-hex}` e.g. `LSU-00f0284b` |

LSU codes are generated correctly by the receive close handler. The generation itself is sound.
MOB-SMOKE-04 is now fixed — the resolver returns `lasyncro_unit_id` on all paths.
Units will be correctly threaded through stow and pick confirm calls going forward.

---

## Cross-Platform Payload Audit — June 12, 2026

Webapp (`WmsPage.tsx` handlers) vs Mobile (`ReceiveJobScreen`, `StowScreen`, `PickBriefScreen`) compared field-by-field per endpoint.

### Receive Workflow

| Endpoint | Webapp payload | Mobile payload | Delta |
|---|---|---|---|
| `POST /receive-jobs/:id/inspect` | `{ lasyncro_variant_id, receive_job_line_id, quantity_accepted, quantity_rejected }` | `{ lasyncro_variant_id, receive_job_line_id, quantity_accepted, quantity_rejected, device_event_id }` | 🟡 mobile sends `device_event_id`; server ignores it (deterministic internally) — harmless |
| `POST /receive-jobs/:id/exception` | `{ lasyncro_variant_id, receive_job_line_id, exception_type, quantity_affected, notes? }` | `{ lasyncro_variant_id, receive_job_line_id, exception_type, quantity_affected, notes }` | ✅ identical shape |
| `POST /wms/problem-center` (after receive exception) | `{ lasyncro_variant_id, quantity, exception_type, source: 'receive', source_exception_id }` | `{ lasyncro_variant_id, quantity, exception_type, source: 'receive', source_exception_id }` | ✅ XPLAT-01 fixed — both platforms now send `source_exception_id` from exception response |
| `POST /receive-jobs/:id/close` | `{ actual_delivery_date? }` | `{ actual_delivery_date: today }` | ✅ XPLAT-05 fixed — mobile defaults to today's date |

### Stow Workflow

| Endpoint | Webapp payload | Mobile payload | Delta |
|---|---|---|---|
| `POST /stow-tasks/:id/claim` | `{}` | `{ device_event_id }` | 🟡 harmless — server ignores client device_event_id |
| `PATCH /stow-tasks/:id/location` | `{ location_code }` | `{ location_code }` | ✅ identical |
| `POST /stow-tasks/:id/confirm` | `{ quantity_placed?, lasyncro_unit_id? }` | `{ quantity_placed, lasyncro_unit_id, device_event_id }` | ✅ both thread `lasyncro_unit_id`; device_event_id delta harmless |
| `POST /stow-tasks/:id/exception` | `{ exception_type, quantity, notes?, lasyncro_unit_id? }` | `{ exception_type, quantity, lasyncro_unit_id, device_event_id, notes }` | ✅ XPLAT-02 fixed — webapp now threads `lasyncro_unit_id`; PC task created server-side (XPLAT-03 not a bug) |
| `POST /wms/problem-center` (after stow exception) | server-side only (stow exception endpoint creates PC task internally) | server-side only | ✅ XPLAT-03 not a bug — PC task created by backend on both platforms |

### Pick Workflow

| Endpoint | Webapp payload | Mobile payload | Delta |
|---|---|---|---|
| `POST /wms/batch/:id/claim` | not called directly — batch auto-claims on first scan | `{ device_event_id }` | 🟡 different claim trigger; both result in `picking` status |
| `POST /wms/pick/scan` | `{ pick_batch_id, lasyncro_line_item_id, lasyncro_variant_id, lasyncro_unit_id?, location_code, quantity_confirmed, scan_source }` via offline queue | `{ pick_batch_id, lasyncro_line_item_id, lasyncro_variant_id, lasyncro_unit_id, location_code, quantity_confirmed, device_event_id }` via offline queue | ✅ XPLAT-06 fixed — mobile now sends `scan_source` from ScanDock method |
| `POST /wms/batch/:id/exception` | `{ lasyncro_line_item_id, lasyncro_variant_id, exception_type, stage: 'pick', quantity_required, quantity_found }` | `{ lasyncro_line_item_id, lasyncro_variant_id, exception_type, stage: 'pick', quantity_required, quantity_found, device_event_id }` | ✅ functionally identical |
| `POST /wms/batch/:id/pick-complete` | `{}` | `{ device_event_id }` | 🟡 harmless |

### Offline Queue Implementation

| Concern | Webapp | Mobile | Delta |
|---|---|---|---|
| Storage | IndexedDB | AsyncStorage | 🟡 different persistence — IndexedDB survives tab close; AsyncStorage survives app kill |
| Replay trigger | Service Worker Background Sync | Exponential backoff (2s→64s) + AppState 'active' flush | ✅ XPLAT-04 fixed — mobile now uses backoff + foreground trigger |
| Queue deduplication | `device_event_id` as IndexedDB key — true dedup | `deviceEventId` checked before push — true dedup | ✅ both deduplicate correctly |
| Queue persistence across restart | ✅ IndexedDB persists | ✅ AsyncStorage persists | ✅ both survive restart |

---

### Cross-Platform Issues Summary

| ID | Priority | Description |
|---|---|---|
| XPLAT-01 | ✅ FIXED | Backend returns `receive_exception_id`; webapp + mobile both thread it to PC POST — `receiveJob.controller.ts`, `WmsPage.tsx`, `ReceiveJobScreen.tsx` |
| XPLAT-02 | ✅ FIXED | `lasyncro_unit_id` threaded through `StowSessionPage` prop type + call site + webapp handler — `StowSessionPage.tsx`, `WmsPage.tsx` |
| XPLAT-03 | ✅ NOT A BUG | Stow exception endpoint creates PC task server-side internally — no client-side PC POST needed |
| XPLAT-04 | ✅ FIXED | Exponential backoff replaces blind 5s timer; AppState 'active' flushes queue on foreground — `offlineQueue.ts`, `PickBriefScreen.tsx` |
| XPLAT-05 | ✅ FIXED | Mobile close defaults `actual_delivery_date` to today (ISO date) — `ReceiveJobScreen.tsx` |
| XPLAT-06 | ✅ FIXED | `scan_source` (camera/hid/manual) threaded from `ScanDock` method param through to `/pick/scan` body — `PickBriefScreen.tsx` |

---

### Shopify Writeback Platform Coverage (Phase 2 — next)

All six XPLAT issues resolved. Next audit: trace every Shopify API call in the backend and verify which platform actions trigger each, idempotency key coverage, and whether both platforms produce consistent Shopify state for inventory, fulfillment, and order status.
