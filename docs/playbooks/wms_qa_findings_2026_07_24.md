# WMS QA Findings — July 24, 2026 (Overview live-map OV-14 smoke test)

## Session Summary

Smoke-testing OV-14 (Overview live map — batch pick/pack phase on `IsometricCanvas`)
surfaced a flaky issue in the pick session completion flow. Not reproduced on
retry — logged here as a watch item rather than fixed blind, per audit-first
workflow. Root-cause candidate identified from code read; not yet confirmed
against an actual failed-request response body.

---

## Bugs Logged (Open Issues)

| Issue | Title | Priority | Status |
|-------|-------|----------|--------|
| WM-51 | Pick-complete errored once with partial-pick state after resuming a mid-session batch; did not reproduce on retry | Watch | Unconfirmed — see notes below |

### WM-51 detail

**Symptom (as reported):** After scanning an item, the pick session jumped straight
to the "Confirm Pick Complete" summary screen, and clicking through failed —
described as the app treating the batch as complete while only part of it (the
operator's words: "4/6") had actually been picked. User was unable to get back
into the session to finish the remaining lines. Did not reproduce on the next
attempt with the same batch.

**Suspected mechanism (unconfirmed):** `GET /api/v1/wms/batch/:batchId/line-items`
(`wms.controller.ts`, `httpGetBatchLineItems`) excludes already-confirmed lines via
`.whereNull('psl.scan_id')`. Every time `PickSessionPage` is (re)entered — including
resuming via "Continue picking →" after navigating away mid-batch — this endpoint
is called fresh and `lineItems.length` inside the session component reflects only
the *remaining* unconfirmed lines, not the batch's original `total_line_items`.
`advanceOrSummary()` in `PickSessionPage.tsx` correctly terminates against
whatever `lineItems.length` it was mounted with, so if the resumed set is small
(e.g. 1 remaining line), scanning it jumps straight to summary — which may be
correct behavior, not a bug, if that really was the last line. The open question
is why `POST /batch/:batchId/pick-complete` (`httpCompletePick`) would then reject
a genuinely-complete batch. That handler's `INCOMPLETE_PICK` guard compares
confirmed-scan-row count against `total_line_items` — both line-based, verified
consistent in code — so a clean completion should pass. No response body was
captured from the failing request, so the actual rejection reason is not
confirmed.

**What would confirm/deny this:** the response body of the failed
`POST /pick-complete` call (or whichever call 400/500'd) next time this
reproduces. If it's `INCOMPLETE_PICK:X/4`, the guard fired correctly, meaning
some line's scan never actually landed despite the UI advancing past it, and
the resume/refetch path is worth a closer look at the join fan-out risk in
`httpGetBatchLineItems` (`inventory_truth`/`inventory_units`/`warehouse_locations`
left-joins). If it's a different error entirely, this write-up is a dead end and
should be discarded in favor of whatever the real response shows.

**Action:** Not fixed. Watching for recurrence. Capture DevTools Network response
body if it happens again — see `wms_qa_findings_2026_06.md` for the established
pattern of logging QA findings from live smoke tests.