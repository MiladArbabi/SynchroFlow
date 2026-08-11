# STOW-LSU-01 — Scanned stow of received units

**Date:** 2026-08-11 · **File:** `apps/backend/src/services/wms/stow.service.ts`

## Symptom
UI stow confirm returns HTTP 409 "Stow source location could not be resolved"
on any freshly received unit. API confirm (no LSU in body) succeeds.

## Root cause
`confirmStow`'s scanned-unit branch resolved the debit source from
`inventory_units.current_location_code` and threw when NULL. That column is
written *by stow confirm itself* (`:389/413/435/453`) and nulled by pick
("unit left the shelf", `pickScan.service.ts:518`). A unit at
`status='received'` has therefore never had one. The field the LSU path
reads is the field the LSU path writes — the first stow of any received
unit was impossible.

Invisible because the operator UI always scans an LSU while curl-based
testing omitted it and took the ROOT fallback. Same class as the fixture
lesson: the UI path and the API path diverge, and only the UI path is real.

## Fix
Fall back to `WH-{shopId}-ROOT` when `current_location_code` is NULL **and**
`status='received'` — the location `closeReceiveJob` credited. Still throws
for genuinely unlocatable units (picked, mid-flight). Mirrors branch 4e,
which already FIFO-resolves `status='received'` units on the no-LSU path.

## Load-bearing semantic
`current_location_code = NULL` means "not on a shelf", not "unknown".
`wms.controller.ts:4491` (`whereNotNull` + groupBy) and `:277`
(`FILTER status='stowed'`) depend on it. Do NOT backfill ROOT at receive —
`status` is what distinguishes received from stowed.

## Verification
Task `74ea423a…`, 10 QA Cap, ROOT → B-3 via UI scan:
`[STOW_LOCATION_TRANSFER] from: 'WH-1-ROOT'` → HTTP 200. Ledger conserved
(−10 ROOT, +10 B-3). 10 units flipped to `stowed` at B-3.
