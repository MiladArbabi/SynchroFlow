# PC-TIER-GATE-01 — Problem Center see-and-clear at Starter

**Date:** 2026-08-13
**Severity:** P0
**Files:** `apps/backend/src/api/wms/wms.routes.ts`
**Migration:** none

---

## Defect

Cancelling an order that has been partly picked raises a `problem_center_tasks`
row from `cancellationUnwind.service.ts`, which runs inside the projection
worker. The worker has no HTTP entitlement middleware, so that write is
ungated.

Every problem-center route was gated at `core`:

GET /problem-center/pick-exceptions core
POST /problem-center/pick-exceptions/:id/resolve core
POST /problem-center/:taskId/resolve core
POST /problem-center core
GET /problem-center core
GET /problem-center/:taskId/replacement core


The actions that generate the row are `starter`:

POST /wms/batch/release starter
POST /wms/pick/scan starter


So is the recovery path that clears it:

POST /stow-tasks starter
POST /stow-tasks/:taskId/claim starter
POST /stow-tasks/:taskId/confirm starter


A Starter tenant could therefore generate a problem task through entitled
actions but could neither list it nor resolve it. The physical unit stayed
stranded in PROBLEM, its `reservation_release` already written, with no stow
task creatable to recover it — silent inventory loss with no operator surface.

This is the same class of circular tier dependency as the PLG restructure
that moved WMS/barcodes to Starter because the live map required zones only
creatable with a Scale-tier tool.

## Evidence

POST /api/v1/wms/problem-center/558f6dbe-.../resolve
{"error":"TIER_INSUFFICIENT","required":"core","current":"starter"}

GET /api/v1/wms/problem-center → 403
GET /api/v1/wms/stow-tasks → 200


Problem task `558f6dbe-0a00-4dff-94f7-c56ba4dfed7b` (PROB-1-0001), raised by
the INV-BLOCK-10b cancellation run, was unreachable to its own tenant.

## Change

Two routes dropped from `core` to `starter`:

- `GET  /problem-center`            — a tenant must be able to SEE work the
                                      system generated on its behalf
- `POST /problem-center/:taskId/resolve` — and be able to clear it

Left at `core` deliberately:

- `POST /problem-center`                       discretionary creation
- `GET  /problem-center/pick-exceptions`       exception analytics
- `POST /problem-center/pick-exceptions/:id/resolve`
- `GET  /problem-center/:taskId/replacement`   replacement sourcing

Resolving without listing would have been an API-only fix — the merchant
surface would have stayed broken. The see-and-clear pair moves together.

`requireAction` is untouched; role-level permission still applies
independently of tier.

## Tier ladder

`starter(0) < core(1) < growth(2) < scale(3)` — `TIER_ORDER` in
`require-entitlement.middleware.ts` remains authoritative. Route files declare
tiers; the hierarchy is never re-implemented at the call site.

## Verification

| Route | Before | After |
|---|---|---|
| `GET /problem-center` | 403 | 200, returns PROB-1-0001 |
| `POST /problem-center/:taskId/resolve` | 403 | 200 `{"resolved":true}` |
| `GET /problem-center/pick-exceptions` | 403 | 403 (control) |
| `POST /problem-center` | 403 | 403 (control) |
| `GET /problem-center/:taskId/replacement` | 403 | 403 (control) |
| `GET /stow-tasks` | 200 | 200 (control) |

`npx tsc -p apps/backend/tsconfig.json --noEmit` passed.

Downstream effect: resolving with `re_stow` created stow task
`ee67152e-2797-4515-aa42-5caeb1f16f33`, `trigger=order_cancelled_mid_pick`,
quantity 1 — the first execution of that trigger in the system's history. No
inventory movement was written at resolution, per INV-PC-01.

## Implementation note

The first attempt at the `GET /problem-center` edit matched the adjacent
`POST /problem-center` block, which shares the same path string, and replaced
`httpCreateProblemTask` instead. That produced a duplicate `GET` registration
and removed manual problem-task creation entirely. Caught by a structural grep
before verification; reverted in the same cycle. When two routes share a path
and differ only by verb, disambiguate the edit on the handler name, not the
path.

## Related

- `INV-BLOCK-10b` — this gate blocked its Stage 4 recovery proof
- `INV-PC-01` — inventory consequence belongs to resolution, not task creation
