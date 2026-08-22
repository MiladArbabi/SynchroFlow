# Inventory Recount Playbook

## Skipping a line (RECOUNT-COUNTZERO-34)

An operator who cannot physically count a bin records a skip rather than a
quantity. Before this existed, `closeCount` rejected any line with a NULL
`counted_quantity`, so the only way to close a task was to enter `0` — and `0`
passes `commitRecount`'s guards, writing phantom shrinkage into
`inventory_movements`.

**Endpoint.** `POST /api/v1/wms/recount-tasks/:taskId/lines/:lineId/skip`
Body: `{ "skip_reason": "...", "notes": "..." }`
Permission `wms:recount:count` — deliberately the same action as counting. A
skip is the same operator, same session, resolving the same line; a separate
action key would add a `MISCONFIGURED_ACTION` surface for zero access-control
difference.

**Reasons** (`recount_skip_reason`, migration 0158):
`bin_inaccessible`, `stock_in_motion`, `bin_not_found`, `other`.
`other` requires `notes` — an unexplained skip is not actionable.

**Invariants.**
1. A skip NEVER writes `counted_quantity` or `variance`. `commitRecount`
   filters on `counted_quantity NOT NULL`, so a skipped line can never become a
   `reconciliation_correction`.
2. `closeCount` treats a line as resolved when `counted_quantity IS NOT NULL OR
   skip_reason IS NOT NULL`.
3. Any skipped line forces `manual_review`, even when every counted line
   matched. The sweep was incomplete; the owner must see the obstruction.
   Verified: 9 lines at variance 0 plus 1 skip returned `manual_review`, not
   `committed`.
4. Counting a previously-skipped line clears `skip_reason`/`skipped_by`/
   `skipped_at`. Left set, it would force `manual_review` forever on a line
   that was in fact resolved.
5. `skip_reason` and `skipped_at` are exposed on the blind operator payload —
   they carry no information about `expected_quantity`.

**Why not `recount_variance_reason`.** That enum answers "why did counted differ
from expected", which presumes a count happened. A skip means no count exists.

**UI note.** The reason must be a tap, not free text. Typing on a warehouse
device is friction, and friction is what produces a fabricated `0`.

`expected_quantity` is snapshotted at task creation and never re-read
(`inventoryRecount.service.ts` — `createRecountTask`). Anything that moves the
bin before the operator counts it — a pick, a sale, a stow — would otherwise
surface as variance, and `commitRecount` writes variance into
`inventory_movements` as a `reconciliation_correction`. The units would be
debited twice: once by the real movement, once as fabricated shrinkage.

`recordCount` computes `window_delta = SUM(quantity_delta)` over
`inventory_movements` for the line's variant + location, from `window_from` to
now. Columns added in migration 0159: `window_delta`, `window_from`,
`window_computed_at`.

**Invariants**

1. Variance is `counted_quantity - (expected_quantity + window_delta)`, never
   `counted_quantity - expected_quantity`. Any new count path that reads only
   `expected_quantity` reintroduces the double-debit.
2. `quantity_delta` is PRE-SIGNED at the ledger layer
   (`rebuildInventoryProjection.ts`), so the window is a plain `SUM` — never a
   `CASE` on `movement_type`.
3. The window is frozen at count time, not recomputed on read. A value that
   shifts on every page load cannot justify a ledger write.
4. `NULL window_delta` means never checked (counted before 0159, or skipped).
   `0` means checked and nothing moved. Only a computed non-zero value is
   contested — `closeCount` tests `window_delta !== null && !== 0`.
5. A contested line forces `manual_review` even when every variance is 0. Same
   precedent as a skip under RECOUNT-COUNTZERO-34: the arithmetic nets out, but
   nothing proves the movement and the count did not overlap on the same
   physical units.
6. `window_from` is its own column, not `created_at`. `reviewLine('recount')`
   copies `expected_quantity` from the original line, so the replacement's
   window must open where that snapshot was taken. The `select` in `reviewLine`
   must include `window_from` and `created_at` or the insert writes NULL and
   silently reopens the window.

## Blind counting on the count endpoint (RECOUNT-BLIND-39)

`POST /api/v1/wms/recount-tasks/:taskId/lines/:lineId/count` returns
`{ recount_line_id, recorded: true }` and nothing else.

**Invariant**

1. The response must never carry `variance`, `window_delta`, or `contested`.
   `expected = counted - variance` is one subtraction, and blind counting is
   server-enforced everywhere else on this surface — `getOperatorLines`
   withholds `expected_quantity`. `recordCount` returns those fields for the
   service layer; the controller acknowledges the write only.
## HTTP error mapping

`recountErrorStatus()` (`apps/backend/src/api/wms/inventoryRecount.controller.ts`) maps
service error messages to HTTP status by substring. Business-state rejections belong on
the 409 list; anything unmatched falls through to 500 and gets an
"Inventory recount close failed:" prefix, which misreports an ordinary client condition
as a server fault.

`RECOUNT-CLOSE-HTTP-47`: the unresolved-lines rejection was reworded from
"not yet counted" to "not yet resolved" under `RECOUNT-COUNTZERO-34` (when skip became a
valid resolution) without updating the mapper, so premature close returned 500. Both
spellings now map to 409.

**Rule:** rewording a `[RECOUNT_*]` throw and updating `recountErrorStatus()` are one
change, never two. Closing a task still requires every line counted or explicitly
skipped — this was only ever an HTTP classification defect.
