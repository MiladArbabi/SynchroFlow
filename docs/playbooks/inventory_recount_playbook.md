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
