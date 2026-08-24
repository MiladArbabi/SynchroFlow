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

## Suggested-count preview tenant boundary — RECOUNT-PREVIEW-NOTENANT-123

`GET /api/v1/wms/recount-tasks/preview` is a read-only preview of suspect bins for count creation.

Invariant:

- `previewSuggestedBins()` accepts `Knex.Transaction`, never the shared Knex pool.
- The HTTP boundary must open a transaction and set `SET LOCAL "app.current_tenant"` before calling it.
- `inventory_truth`, `inventory_movements`, `warehouses`, and `warehouse_locations` are FORCE-RLS tables; preview reads outside that tenant frame are invalid.
- `warehouse_id` may be omitted and resolves through the existing default-warehouse rule.
- Preview classification is one reason per bin, severity ordered: `negative_on_hand` → `unlocated_sale` → `dormant`.
- Verification for RECOUNT-PREVIEW-NOTENANT-123 proved both previously-unreached branches (`negative_on_hand`, `dormant`) and confirmed `inventory_movements` remained unchanged during the rolled-back fixture.

## Reconcile inventory entry point — RECOUNT-CTA-33a

`RECOUNT-CTA-33a` adds the first merchant-facing entry point for creating inventory reconciliation work from Warehouse → Operations.

### Merchant-facing semantics

The top-level action is **Reconcile inventory**, not “Create count”.

The wording is intentional: the merchant goal is to reconcile physical warehouse stock against system inventory, not to understand that laSyncro creates an internal recount-task record.

Current terminology:

- Warehouse header CTA: `Reconcile inventory`
- Dialog title: `Reconcile inventory`
- Helper copy: `Count what’s physically in your warehouse and compare it with system stock.`
- Existing task family: `Inventory checks`
- WorkTally metric remains `COUNTING`
- Single-bin action: `Check this bin`
- Suggested-scope action: `Check suggested bins`

### Entry-point UX contract

- `Reconcile inventory` is a distinct Tier-1 action in the Warehouse page header.
- WorkTally is informational only; the `COUNTING` metric is not a hidden CTA.
- The action remains visible even when there are zero existing recount tasks.
- The create dialog loads suggested bins and team assignees.
- A merchant may:
  - select one bin → `scope: location`;
  - check all current suggestions → `scope: suggested`;
  - optionally assign a team member;
  - optionally add notes.
- The UI does not expose `variant_set` or `full`.
- The UI does not send `blind`; blind counting remains enforced by the server.
- `warehouse_id` is omitted and resolves through the backend default-warehouse rule.
- After a successful create, the existing recount-task query is refreshed.
- Creation does not auto-enter the counting session.

### Verification

Live browser verification confirmed:

- WorkTally remained display-only.
- `Reconcile inventory` was visible in the Warehouse header without scrolling.
- The reconciliation dialog loaded suggested bins, assignee, notes, and both approved actions.
- `Check this bin` enabled after selecting a bin.
- `Inventory checks` rendered as the task-family heading.
- Module rebuild passed.
- Frontend TypeScript remained at the pre-existing 19-error baseline with zero errors in the touched WMS surfaces.

The broader Operations-page consolidation is tracked separately as `WMS-OPS-QUEUE-125`. Recount-session compression and scan-derived quantity display are tracked separately as `RECOUNT-SESSION-UX-124`.

## Warehouse counting session — bin-batched execution

`RECOUNT-BINLIST-62`: the session groups lines by `location_code` and works one
bin at a time. Scan the bin once, then scan each item in it; every row carries
its own quantity input and its own skip action. The previous loop asked for the
bin barcode per line, so an operator at one bin with six SKUs confirmed that bin
six times.

Rules that must survive future edits:

- Grouping preserves first-appearance order. Lines arrive pre-sorted into walk
  order (`RECOUNT-WALKORDER-27`); re-sorting in the UI discards it.
- Progress counts bins as bins and lines as lines. Merchant copy says bin, not
  location — `location_code` remains the internal identifier.
- A scan never commits. Unlike stow, a count needs a quantity, so a scan only
  moves focus into that row's input. Enter saves and returns focus to the scan
  field.
- Neither gate displays its own answer. The bin and product inputs use generic
  placeholders (`RECOUNT-GATE-PREFILL-56`); showing the expected code or SKU
  turns verification into transcription.
- A resolved barcode matching nothing in the active bin is persisted as an
  `unexpected_item` finding (`RECOUNT-EXCEPTIONS-80`). It never becomes a
  variance-bearing recount line and never changes inventory directly. An item
  found in bin B that is on the books at bin A may be a relocation; treating it
  as surplus would inflate stock.
- Blind counting is unchanged: no expected quantity, variance, movement window,
  or contested state reaches this screen.

## Physical findings (RECOUNT-EXCEPTIONS-80)

Physical observations are persisted separately from quantitative count truth.

`inventory_recount_lines` remains authoritative for counted quantity:

- counted `0` means the operator checked and found the expected item absent;
- counted quantities are compared with the movement-adjusted expected quantity;
- missing/low/high stock is derived from that comparison, not reported as a
  separate blind-pass finding.

`inventory_recount_findings` records qualitative evidence:

- `unexpected_item`;
- `product_defect`;
- `packaging_defect`.

Every finding retains task, optional recount line, variant, location, quantity,
operator, timestamp, and optional notes. Defective-but-present units remain
included in `counted_quantity`; reporting a defect never subtracts them.

Endpoints:

    GET  /api/v1/wms/recount-tasks/:taskId/findings
      wms:recount:read

    POST /api/v1/wms/recount-tasks/:taskId/findings
      wms:recount:count

The POST requires a client-generated `client_event_id`. Migration 0161 adds a
tenant-scoped unique partial index on `(shop_id, client_event_id)`. Replaying
the same event and payload returns the original finding; reusing the same event
ID with a different payload returns HTTP 409. A genuinely new observation gets
a new event ID.

### Finding invariants

1. A valid unexpected-item scan is persisted instead of discarded.
2. An unexpected item never becomes a recount variance line.
3. Defective-but-present stock remains part of the physical count.
4. Creating a finding never writes `inventory_movements` or changes
   `inventory_truth`.
5. Finding provenance includes operator, task, variant, location, quantity, and
   time.
6. Blind counting still exposes no expected quantity or variance information.

### Recount escalation ownership

Escalating a reviewed variance creates a Problem Center task with:

    source = 'count'
    exception_type = 'recount_variance'
    source_exception_id = recount_line_id

Once handed off, Problem Center is the sole correction owner for that line.
`commitRecount()` excludes recount lines already referenced by a
`problem_center_tasks` row with `source='count'`, preventing the same variance
from becoming both a recount reconciliation correction and a later Problem
Center stock adjustment.

Verified on 2026-08-23:

- previously failing escalation returned HTTP 200 and created one open
  `recount_variance` Problem Center task;
- the escalated line was excluded from recount commit eligibility;
- unexpected-item and defect findings persisted through the Warehouse UI;
- defect reporting left the counted quantity unchanged;
- finding creation produced zero reconciliation-correction movements;
- identical `client_event_id` replay returned the same finding and one DB row;
- conflicting reuse of the same event ID returned HTTP 409;
- invalid finding/line relationships returned HTTP 400 rather than 500.

## Counting is a Core+ capability — RECOUNT-TIER-CONFLICT-97, 2026-08-23

`POST /recount-tasks` and `GET /recount-tasks` are gated
`requireTier('core')`, one tier above every other WMS route in
`wms.routes.ts` (all `starter`) and above all five `wms.*` keys in the
frontend PLAN_FEATURES registry, which carry a comment stating WMS is
free on Starter and not a tier wall.

**This is deliberate, not an oversight.** Recorded so it is not
re-litigated:

- The Starter exemption covers *execution* — pick, pack, stow, receive.
  Those move units already accounted for. Counting does not move units;
  it challenges the ledger and terminates in a reconciliation
  correction. Different class of operation.
- Every export route is `requireTier('core')`. A Starter merchant who
  counted and found a discrepancy could not export the sheet to
  reconcile against. The workflow only becomes whole at Core.
- It shipped this way and is live in production. Lowering to Starter is
  a giveaway, cheap to do later; raising is expensive to reverse.

**Consequence — RECOUNT-TIER-UI-103, still open after RECOUNT-CTA-33a:**
`PLAN_FEATURES` still has no `'wms.recount'` key, so explicit
plan/entitlement presentation gating is not implemented.

`RECOUNT-CTA-33a` partially mitigates this by deriving `recountLocked`
from the recount-task query error state: when that query fails, the
reconciliation CTA is disabled. This prevents a known-failed recount
surface from remaining actionable, but it is not equivalent to an
explicit tier gate because any recount query error produces the same
locked state.

Add `'wms.recount': 'core'` and gate presentation on that entitlement
to resolve `RECOUNT-TIER-UI-103`. The backend Core-tier gate remains
authoritative.


## Scan-derived counting session — RECOUNT-SESSION-UX-124 / RECOUNT-LEAVE-AFFORDANCE-134, 2026-08-24

The operator counting surface is a single working flow. The former
brief, summary, and complete presentation phases were removed; the
active session moves between location and bin work only.

**Blind counting remains load-bearing.** Expected system quantity is
not shown to the operator. A design that presents expected and scanned
quantities side by side would turn the workflow into a sighted count
and violates the recount contract.

Counting now uses the pre-existing `unit_scan` recount method. This was
already supported by the backend enum alongside `bin_quantity`; the
frontend had simply never wired it and previously hardcoded
`bin_quantity`.

Scans accumulate in a client-side tally for the active bin. A recount
line is write-once during operator counting, so the client must not
POST once per scan. Each unresolved line is written exactly once when
the bin is resolved:

- scanned units resolve with `count_method: 'unit_scan'`;
- "None here" resolves the line with counted quantity `0`;
- "Can't count" skips the line and leaves `counted_quantity` NULL.

Skipped lines therefore cannot become reconciliation corrections.

The server remains the accountability boundary. Closing a count refuses
unresolved lines; any non-zero variance enters manual review; accepting
a variance requires `variance_reason`; and `commitRecount()` is the
recount path that writes the resulting `reconciliation_correction` to
`inventory_movements`.

"Leave count" is an exit, not successful completion. It returns the
operator to Operations without emitting the completed-count
acknowledgement.

**Interactive-colour rule:** text actions must remain visually
distinguishable from static muted text. Do not apply a muted static-text
colour token to an actionable text button merely because its position
suggests interactivity. `RECOUNT-LEAVE-AFFORDANCE-134` was resolved by
removing its explicit muted colour override and inheriting the same
interactive treatment as "None here" and "Can't count".

The scan tally remains intentionally volatile until bin resolution.
Durability and warning behaviour on leaving with unsaved scans remain
tracked separately as `RECOUNT-TALLY-VOLATILE-127`.
