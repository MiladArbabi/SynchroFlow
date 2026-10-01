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

Fresh-merchant / zero-operational-bin preview and creation-dialog empty-state
behavior — distinguishing a true zero-bin fresh install from "bins exist but
no suggestions" — is `RECOUNT-FRESH-NOBINS-40` (status: **VERIFIED**, see the
dedicated section near the end of this document). Not addressed here.

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

  Updated in `RECOUNT-CTA-33b`: the suggested-scope action is now `Select all
  suggested bins`, and bin selection is multi-select rather than single-bin —
  see below.

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
- GH-1201 — post-create entry:
  - a successful Owner/Admin create that is unassigned or assigned to the creator opens the created task's Brief immediately (task identity from the `201 { task }` response; the dispatch choice is the submitted `assigned_to`, which create does not return);
  - assigning another operator leaves the creator on ordinary Operations — the task is only dispatched to that operator;
  - creation and assignment never claim work; `Claim & Start Count` on the Brief is the explicit claim/start step, and every dispatched recount (ordinary or Opening Inventory) begins at its Brief;
  - the ordinary Brief URL is `/wms?countTaskId=<id>` only — `warehouseFocus=count` remains Opening Inventory protected-focus semantics;
  - `Leave count` on the Brief is non-mutating (no claim, count or close).

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

## Multi-location recount selection — RECOUNT-CTA-33b

`RECOUNT-CTA-33b` extends the `RECOUNT-CTA-33a` Reconcile-inventory dialog with independent multi-bin selection on the canonical warehouse/isometric canvas, replacing single-bin-only selection.

### Selection UX

- The dialog renders suggested recount bins on the same `IsometricCanvas` used elsewhere in Warehouse; see `overview-live-map-playbook.md` §6.13 for the underlying `onZoneClick` contract.
- Clicking a suggested bin toggles that bin independently. Any number of bins may be selected at once and stay highlighted; clicking a selected bin again deselects it.
- `Select all suggested bins` (renamed from `Check suggested bins`) selects every suggested bin. It is selection-only — it does not create a recount task and does not close the dialog.
- Creation remains a separate, explicit action: `Create count · N bin(s)`.

### Backend contract

`POST /api/v1/wms/recount-tasks` with:

```text
scope: "locations"
location_codes: string[]
```

- `location_codes` must be non-empty.
- Every entry must be a non-empty string.
- Duplicate entries are rejected.
- Empty, blank, and duplicate `location_codes` are all rejected with `400` and write zero rows (no task, no lines) — proven in `tests/integration/wms/recount-multi-location.test.ts`.
- On success, exactly one recount task is created, and only the explicitly selected `location_codes` become recount lines.

`recount_task_scope` (migration `20260826130000_0162_add_locations_recount_scope.ts`) adds the `locations` value alongside the existing `full`, `location`, `variant_set`, `suggested` scopes. Rollback is intentionally a no-op — PostgreSQL cannot safely drop an enum value in place.

### UI architecture

- Pure selection/canvas-mapping helpers live in `modules/wms/src/ui/pages/recountSelection.ts`, kept separate from the presentational WMS module.
- API ownership (issuing the create-count request) stays in `WmsOperationsPage`, not the WMS module.

### Verification

- Backend focused integration: `tests/integration/wms/recount-multi-location.test.ts` — 1 suite / 4 tests, run against a disposable `synchroflow_test_*` database.
- Frontend focused: `wms-recount-bin-selection.test.ts`, `wms-recount-bin-canvas.test.ts` — 2 suites / 4 tests.
- Live browser, light and dark mode: multi-select, independent deselect, select-all (selection-only, dialog stays open), explicit create, CTA copy.
- Selected-label contrast on a coloured/risk overlay and dark-mode bin visibility were live-browser verified — see `overview-live-map-playbook.md` §6.14. Not covered by an automated visual-regression check.

A follow-up, `WMS-CTA-CONSISTENCY-34`, will separately audit whether WMS CTAs use the canonical `var(--accent)`/`var(--accent-ink)` Tier-1 tokens and whether the blue ghost "Count" controls are correctly classified. Not addressed here.

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

> **Mechanism superseded 2026-09-06 by `P0-A3-4`; the PRODUCT decision below is
> unchanged.** Counting is still Core+ — that reasoning stands and is not
> re-litigated. What changed is HOW it is enforced: all **13** recount routes moved
> from a raw `requireTier('core')` gate to the canonical capability
> **`inventory.core`** (module `products` + Core+). Read every
> "`requireTier('core')` boundary" below as "the `inventory.core` capability".
>
> `requireFt2` and every `requireAction('wms:recount:*')` RBAC check are unchanged
> — commercial entitlement and role permission remain separate, both-required axes.
> Canonical record: `monetization_billing_playbook.md` §34.

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

**Frontend entitlement parity — RECOUNT-TIER-UI-103, resolved 2026-08-25:**

`PLAN_FEATURES` now declares `'wms.recount': 'core'`, matching the
authoritative backend `requireTier('core')` boundary.

The frontend no longer waits for a failed recount request to discover
that the merchant is not entitled:

- `useWms()` derives entitlement with `can('wms.recount')`;
- the recount-task query is disabled when the merchant is not entitled;
- `recountLocked` is true immediately when entitlement is absent;
- `recountIsError` remains a secondary runtime lock for entitled
  merchants.

Starter merchants are not shown cached or fabricated recount task
counts. The Counting tally remains `—`, and Inventory checks presents
`Core · Upgrade to view` without exposing task names or counts.

The locked `Reconcile inventory` action remains clickable rather than
rendering as a dead disabled control. It carries a visible Core badge
and opens the canonical `UpgradePrompt`; the upgrade action routes to
`/settings/billing`. Core merchants retain the normal recount dialog
and task-list behaviour.

The backend Core-tier gate remains authoritative. Frontend gating is
presentation and request suppression, not a replacement for server
authorization.


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

The scan tally is persisted provisionally in `sessionStorage` from
`RECOUNT-TALLY-VOLATILE-127` onward; see the section below. The exact
"Leave count" contract (what it does and does not do) is documented in
`RECOUNT-LEAVE-SEMANTICS-138` further below.

## Scan tally durability — RECOUNT-TALLY-VOLATILE-127, 2026-08-25

### Provisional persistence contract

Two `sessionStorage` keys, both scoped by recount task id:

```text
recount-scan-tally-${recount_task_id}
recount-verified-location-${recount_task_id}
```

Written on scan and undo. Restored on remount or refresh, filtered to
lines that are still unresolved. Cleared on successful line count, on
skip, on advancing to another bin, and on recount completion.

**Component unmount alone does NOT clear either key.** Leaving a session
and returning restores the provisional tally. This is deliberate.

### Why the tally accumulates client-side

The recount line is write-once during operator counting: once
`counted_at` or `skip_reason` exists, a further count write is rejected.
A line therefore has exactly one write, so scans cannot be checkpointed
per scan and must accumulate provisionally until bin resolution.

### Trap — `theme.palette.text.disabled` is unassigned

`apps/frontend/src/themes/palette.ts` assigns `text.primary` and
`text.secondary` only. `text.disabled` is never assigned and falls
through to MUI's default, a fixed light-mode value applied in both
colour schemes.

Any glyph or label using `theme.palette.text.disabled` against
`background.paper` is invisible in dark mode and legible in light mode.
The two-step tracker's inactive node icon hit exactly this. The fix was
`var(--ink-3)`, which resolves per scheme through the theme's
`MuiCssBaseline` token injection.

Do not use `theme.palette.text.disabled` until the palette gap is closed
under `THEME-TEXT-DISABLED-MISSING-137`.

### Deliberate exclusions

- Leave-count messaging was not implemented. Slice 1A made the original
  warn-and-discard design incoherent, since leaving no longer discards.
  Current behaviour is silent persistence. Tracked as
  `RECOUNT-LEAVE-SEMANTICS-138`.
  **Resolved 2026-08-26** — see the `RECOUNT-LEAVE-SEMANTICS-138` section
  below: explicit reassurance copy was added, the exact non-destructive
  contract was made permanent regression coverage, and no warn-and-discard
  modal was introduced (there is nothing to discard).
- `PickSessionPage` carries the identical inactive-icon expression and
  the same latent dark-mode defect. Tracked as
  `PICK-TRACKER-INACTIVE-ICON-136`. Do not copy that node's colour
  handling as canonical.

### Verification

Tracker verified live in both colour schemes: inactive node icon legible
in dark mode, unchanged behaviour in light mode. Tally and verified
location confirmed to survive refresh; resolved-line tallies confirmed
not to return.

## Leave-count semantics — RECOUNT-LEAVE-SEMANTICS-138, 2026-08-26

"Leave count" is non-destructive navigation — not task release, and not a
discard.

### Why the old warn-and-discard concept doesn't apply

`RECOUNT-TALLY-VOLATILE-127`'s "Deliberate exclusions" (above) flagged that
its own persistence work already made the original "Leave and discard
unsaved scans?" design incoherent — leaving no longer discards anything, so
a warning built around discarding would be actively wrong, not merely
unnecessary. Direct audit confirmed no such warning exists anywhere in the
current source: no confirmation modal, no discard or unsaved-progress copy.

### The exact contract

Clicking "Leave count":

- calls the session's `onComplete()` callback with **zero arguments** —
  distinct from the successful-finish path, which calls
  `onComplete(task.label)`;
- calls no mutation callback — not `onCloseTask`, `onRecordCount`,
  `onSkipLine`, nor `onCreateFinding`;
- does not clear `recount-scan-tally-${recount_task_id}` or
  `recount-verified-location-${recount_task_id}` (the two keys
  `RECOUNT-TALLY-VOLATILE-127` established, above);
- does not release `claimed_by` and does not change task status — once
  claimed, the task remains claimed by that operator, exactly as before
  this issue;
- shows no confirmation/discard modal, by design. Since nothing destructive
  happens, gating the click behind a confirmation step would only slow the
  operator down for no protective benefit.

### Operator-facing reassurance

The session now shows **"Progress is saved automatically."** near "Leave
count" — `fontSize: 11`, `var(--ink-4)`, the same subordinate-caption
treatment already used elsewhere in this session (e.g. the finding dialog's
"Physically counted: X" line) — so it reads as explanatory, not as another
action competing with the workflow-commit CTAs. It does not gate or confirm
the click. The button label itself is unchanged: "Leave count".

### Re-entry / resume — unchanged

Re-entering the same task restores the persisted tally and verified
location exactly as `RECOUNT-TALLY-VOLATILE-127` describes (above), and
resumes at the task's first unresolved bin (`RECOUNT-RESUME-POSITION-72`) —
not necessarily the exact bin the operator was standing in when they left.
Persisting the *exact* last-active bin was deliberately left out of scope
for this issue.

### Boundary with RECOUNT-CLAIM-ABANDONED-131

This issue does not touch claim/release semantics. There is no
release/unclaim endpoint anywhere in the recount API, and Leave does not
call one. `RECOUNT-CLAIM-ABANDONED-131` (resolved — see below) added
owner/admin-initiated **reassignment**, not release; Leave still does not
call it, and the two remain independent actions.

### Verification

`tests/unit/ui/wms/RecountLeaveSemantics.test.tsx` — 4 focused contracts,
rendering `CountingSessionPage` directly with controlled props and
pre-seeded `sessionStorage`. RED baseline before implementation: 3 passed /
1 failed — only the reassurance-copy contract failed, since the
persistence/non-mutation/no-modal behaviour was already correct and this
suite now makes that permanent regression coverage rather than an
audit-only claim. GREEN after implementation: 4/4. Sibling
`WmsCtaTierConsistency` regression re-run alongside it: 25/25 (confirms the
new copy did not regress `WMS-CTA-CONSISTENCY-34`'s CTA-hierarchy guard for
this same button). `test:config`: frontend TEST_COUNT 100,
`UNOWNED=0`, `MULTI_OWNED=0`. `modules/wms` build and `git diff --check`
both passed.

Live-verified in both colour schemes: reassurance copy visible and
positioned near "Leave count", the button remains visually secondary,
and leave/re-entry preserves tally and verified location exactly as
before this issue.

## Reassignment recovery for abandoned claims — RECOUNT-CLAIM-ABANDONED-131, 2026-08-26

An explicit owner/admin recovery mechanism for a recount claimed by an
operator who is no longer working it — an abandoned tab, a departed shift, a
claim that should move to someone else. This is explicit reassignment, not
automatic release; there is still no path that reclaims a stale claim on its
own (see Deliberate exclusions below).

### Relationship to "Leave count"

Unchanged by this issue — see `RECOUNT-LEAVE-SEMANTICS-138` above. "Leave
count" exits the session, preserves progress, and does not release
`claimed_by`. It still does not call the reassignment endpoint below; the
two remain independent actions with independent triggers (operator choice
vs. owner/admin recovery).

### Endpoint

`POST /api/v1/wms/recount-tasks/:taskId/reassign`
Body: `{ "target_user_id": <number> }`

Reassignable only from `claimed` or `counting`. `manual_review` and
`committed` are rejected — those states are past the point where an
ownership transfer is the applicable recovery.

### Authorization — two independent checks on the ACTING user

1. Route-level `requireAction('wms:recount:reassign')` (`wms.routes.ts`),
   restricted to `owner`/`admin` (`require-action.middleware.ts`) — this
   resolves through the shop-configurable `isActionAllowed` permission map,
   which a shop could in principle misconfigure.
2. `httpReassignRecountTask` (`inventoryRecount.controller.ts`)
   additionally reads the trusted JWT `shop_roles` claim directly and
   requires `owner`/`admin` there too, independent of shop config — the
   same pattern `httpListRecountTasks` already uses for its `privileged`
   computation, for the same reason: ownership/variance authority must not
   be gateable by a client-influenced permission row.

Both checks gate the requester. Neither validates the TARGET — middleware
can only inspect the requesting user.

### Target validation (`reassignRecountTask`, `inventoryRecount.service.ts`)

The target must:

- have active membership in the same shop (`shop_memberships`,
  `revoked_at IS NULL` — the same predicate `GET /operators/team` already
  uses, not a new activity flag);
- be permitted to count — `isActionAllowed(shopId, 'wms:recount:count',
  membership.role)` run against the target's role, reusing the identical
  check `requireAction` runs for the acting user, not a parallel permission
  model.

### Atomicity and progress preservation

One transaction, one `UPDATE` — not release-then-claim. A two-step version
would leave a window where the task is unclaimed and any operator could
grab it ahead of the intended target.

Written: `claimed_by`, `assigned_to`, `claimed_at` (now), `claim_generation`
(fresh `gen_random_uuid()`), `updated_at`.

Untouched: `status`, resolved counts, skips, findings, unresolved lines —
reassignment moves ownership only, never task progress.

### `claim_generation`

Migration `20260826180000_0163_add_claim_generation_to_recount_tasks.ts`
adds a nullable UUID column to `inventory_recount_tasks`. Additive, no
backfill — every pre-existing row keeps `claim_generation = NULL`; only a
claim or a reassignment writes a value going forward, matching the
0158/0162 precedent of non-destructive additive columns.
`claimRecountTask` also stamps a fresh `claim_generation` on the initial
claim, not only on reassignment.

**Why.** `RECOUNT-TALLY-VOLATILE-127`'s provisional `sessionStorage` keys
were scoped by task id alone. A reassigned claimant's browser would
otherwise restore the PREVIOUS claimant's leftover scan tally under that
same key. `claim_generation` makes that impossible by construction — the
frontend keys storage by task **and** generation:

    recount-scan-tally-${taskId}-${claimGeneration}
    recount-verified-location-${taskId}-${claimGeneration}

(`CountingSessionPage.tsx` — `scanTallyStorageKey` /
`verifiedLocationStorageKey`). `claimGeneration` is deliberately not
derived from `claimed_at`: WORKSHOP required an opaque generation id,
independent of any timestamp-formatting concern in a storage key.

**Legacy compatibility.** A task claimed before this column existed
(`claim_generation === null`) keys under the literal segment `legacy`
instead of a UUID. `migrateLegacyStorageKey` copies the old task-only key
(`recount-scan-tally-${taskId}`, no suffix) into the new `-legacy` key
once, then deletes the old key — safe only because, before reassignment
existed, a claimed task could only ever have had one claim generation
across its lifetime (claim only ever starts from `dispatched`; no
release/reassign path existed to produce a second one), so the old
task-only key and the task's legacy generation are provably the same data.
The moment that task is claimed again or reassigned, `claim_generation`
becomes a real UUID and this migration path is never consulted again for
it. A UUID generation never reads a task-only legacy key.

### Old-claimant rejection and the concurrency contract

`recordCount`, `skipLine`, `createFinding`, and `closeCount` all read
`claimed_by` inside the same row-locked (`forUpdate`) transaction boundary
`reassignRecountTask` uses, and reject once `claimed_by` no longer matches
the caller.

This is a required invariant, not merely an implementation note:
reassignment and every recount-owned mutation serialize on the same
`inventory_recount_tasks` row lock. Verified sequence:

1. A reassignment transaction acquires the row lock and updates ownership.
2. An old-claimant mutation (count/skip/finding/close) begins concurrently
   and blocks on the same row.
3. The reassignment commits.
4. The old-claimant transaction wakes, re-reads `claimed_by` under its own
   lock, observes the new owner, and is rejected. Its mutation does not
   commit.

A stale open tab belonging to the old claimant additionally shows a
stable client-side message: *"This count was reassigned. Your session is
no longer active."* (`CountingSessionPage.tsx`).

### Audit

Reassignment writes `recount_reassign` (`operatorAudit.service.ts` —
`AuditActionType`), recording `previous_claimant`, `new_claimant`,
`previous_claim_generation`, and `new_claim_generation`.

### Deliberate exclusions

- No TTL, stale-claim timeout, heartbeat, cron, or background worker
  release. Recovery is explicit owner/admin action only.
- No release-on-Leave was introduced by this issue. "Leave count" still
  does not release `claimed_by` — see the Leave-count boundary note above.

### Verification

Backend integration — `tests/integration/wms/recount-reassignment.test.ts`:
21/21 PASS. Frontend focused —
`tests/unit/ui/wms/RecountReassignAffordance.test.tsx` and
`tests/unit/ui/wms/RecountLeaveSemantics.test.tsx` (extended for this
issue), plus `tests/unit/helpers/auth.ts`: 45/45 PASS. `test:config`
ownership: `backend-legacy` 128, `backend-integration` 17, `contract` 4,
`frontend` 101, `UNOWNED=0`, `MULTI_OWNED=0`. `modules/wms` build PASS,
backend `tsc --noEmit` PASS, `git diff --check` PASS.

Live browser: reassignment recovery flow exercised and accepted. A later
local DB reset/full-seed removed the temporary seeded data used for that
run; this does not invalidate the completed verification evidence.

## Fresh/reviewer-shaped bin-availability contract — RECOUNT-FRESH-NOBINS-40, 2026-08-27

**Status: CLOSED — committed and pushed as `307c205a`
("fix(wms): handle fresh zero-bin recount onboarding").**

The Reconcile Inventory creation dialog previously collapsed two distinct
merchant states into the identical "No suggested bins right now." copy: a
merchant with zero warehouse bins configured at all, and a merchant with
bins already configured but nothing currently needing reconciliation. A
fresh/reviewer-shaped tenant landed in the first state with no visible path
forward.

### Availability classification

`classifyRecountBinAvailability(gridLocations, previewBins)`
(`modules/wms/src/ui/pages/recountSelection.ts`) now resolves one of four
states:

- `unknown` — the warehouse-grid query has not resolved yet
  (`gridLocations === undefined`), regardless of preview-bin count.
  **Must never be presented as "zero bins configured."** The component
  renders nothing in this state rather than guessing.
- `no_bins_configured` — grid resolved, zero `type='bin'` locations exist.
  The root warehouse location itself does **not** count as a bin; an
  unpositioned `type='bin'` row (no parent, not yet placed on the floor)
  **does** count as a configured bin.
- `no_suggestions` — grid resolved, at least one `type='bin'` location
  exists, but the preview returned zero suggested bins.
- `suggestions_available` — the preview returned at least one bin. This
  takes priority even if the grid query has not resolved yet.

### Zero-bin onboarding contract (`no_bins_configured`)

Shown in `RecountEmptyState`:

- "Set up your warehouse bins before creating an inventory count."
  (`Alert severity="info"`);
- supporting copy: recounts check physical storage locations, not products
  in the abstract;
- a Tier-1 "Set up bins" CTA (`WMS_TIER1_ACTION_SX`).

Clicking "Set up bins" navigates to exactly
`/floor-planning?tab=setup&view=canvas` (see Navigation regression below).
Create Count remains unavailable — there is nothing to select.

### Bins-exist / zero-suggestions contract (`no_suggestions`)

Shown: "No bins currently need reconciliation." Neither the onboarding
copy nor the "Set up bins" CTA renders. Create Count remains unavailable
under current suggested-bin-only creation behavior — a merchant with
configured bins but no active suggestion still cannot manually target an
arbitrary bin from this dialog (tracked separately, see Parked issues
below).

### Suggestions-exist behavior — unchanged

`suggestions_available` preserves existing `RECOUNT-CTA-33b` behavior:
suggested-bin isometric/canvas view, independent per-bin selection, Select
all suggested bins, Create Count enabling after selection, and real
count-task creation.

### Fresh/reviewer-shaped live verification

A real reviewer-shaped tenant was created through `POST /api/v1/auth/register`
(shop_id=2, user_id=3, owner) — real login-capable owner, one warehouse, one
root `warehouse_locations` row (`WH-2-ROOT`), zero bins, no Shopify
connection, implicit `FT_MINUS_ONE` (see `lifecycle_playbook.md` §2a for why
that is not a persisted row). The offline fixture pattern from
`lifecycle_playbook.md` §8 was then used — a canonical encrypted
`integrations` row (`sync_status=COMPLETED`), followed by
`seed_fresh_install.cli.ts` run exactly once (3 products, 5 orders,
inventory rooted at `WH-2-ROOT`, zero bins preserved).

Lifecycle progressed through the real ladder — implicit `FT_MINUS_ONE` →
first `orders/create` → `FT0` → `lifecycle/first_insight_delivered` →
`ft0.completed` → `FT1` → user-confirmed "Unlock Insights" → `FT2` — with DB
state verified at both FT1 and FT2: `user_lifecycle_snapshot.user_id=3`
correctly anchored to the founding owner at each phase, `ft0_state`/
`system_readiness_state`/`ft2_state` present, 5 orders, zero bins, `WH-2-ROOT`
only throughout.

The Reconcile Inventory dialog rendered the `no_bins_configured` state
correctly on this tenant.

### Navigation regression discovered and fixed during live verify

The "Set up bins" CTA rendered correctly but was a live no-op — clicking it
left the URL and rendered page unchanged. Root cause: `WmsOperationsPage`
imported `navigate` from the internal `runtime` module
(`apps/frontend/src/runtime/registerRoute.ts`), whose `navigate()` is a
"fallback only" helper that calls raw `window.history.pushState`/
`replaceState` directly — it never notifies the React Router tree
(`<BrowserRouter>`/`<Routes>`), so the rendered page never actually swaps.

Fixed to use React Router's `useNavigate()` (the app-wide convention — 60+
call sites; the actual working precedent for this exact destination is
`OverviewFT2Page.tsx`, not the previously-assumed `ProductsWmsReadinessPage.tsx`,
which carries the same `runtime.navigate` defect — see Parked issues below).
`handleSetupBinsClick` now calls
`navigate('/floor-planning?tab=setup&view=canvas')` — the exact destination
required, landing on Floor Planning's Setup tab in canvas view, not a bare
`/floor-planning`.

A new page-level behavioral regression test,
`tests/unit/ui/wms/WmsOperationsPage.floorPlanningNav.test.tsx`, mounts
`WmsOperationsPage` under a real `MemoryRouter`/`Routes` pair and asserts an
actual rendered-route swap plus exact query parameters (`tab=setup`,
`view=canvas`) — not merely that the callback was invoked. The existing
`RecountFreshNoBins.test.tsx` renders `RecountEmptyState` in isolation and
only proves callback invocation; it could not have caught this defect, and
that limitation is now documented in the new test file itself. RED (against
the unfixed `runtime.navigate` implementation) reproduced the exact live
symptom — WMS page content stayed on screen, no route swap. GREEN after the
fix.

### Verification

- New navigation regression: 1/1 PASS.
- Existing recount frontend suites re-run unmodified: `RecountFreshNoBins`,
  `wms-recount-bin-canvas`, `wms-recount-bin-selection` — 16/16 PASS.
- `test:config`: `backend-legacy` 128, `backend-integration` 17, `contract`
  4, `frontend` 103, `UNOWNED=0`, `MULTI_OWNED=0`.
- `modules/wms` build: PASS. `git diff --check`: PASS.
- Frontend-wide `tsc`: 19 pre-existing baseline errors, 0 in this issue's
  touched surfaces — the baseline is not this issue's failure.
- Full live-browser click-through, both color schemes, all three
  availability states — see the matrix below.

### Live-browser verification matrix

**State A — zero bins (`no_bins_configured`).** PASS, light and dark.
Verified: onboarding copy rendered; supporting explanation rendered;
Tier-1 "Set Up Bins" rendered; healthy-state copy absent; Create Count
unavailable; clicking "Set Up Bins" navigated to exactly
`/floor-planning?tab=setup&view=canvas`; Floor Planning actually rendered
— Setup tab, Canvas view.

**State B — bins configured / zero suggestions (`no_suggestions`).** PASS,
light and dark. Verified: "No bins currently need reconciliation." shown;
no "Set Up Bins" CTA; no fresh-install onboarding copy; Create Count
unavailable; no manual non-suggested-bin selection introduced (that
remains `RECOUNT-MANUAL-NONSUGGESTED-41`, parked below).

**State C — suggestions available (`suggestions_available`).** PASS.
Verified on the rich `owner@test.com` tenant: suggested-bin canvas
rendered; individual selection worked; Select All Suggested Bins worked;
Create Count enabled after valid selection; real inventory-count task
creation succeeded.

### Parked follow-up issues (not implemented here)

- `RECOUNT-MANUAL-NONSUGGESTED-41` — a merchant with configured bins but no
  active suggestion still cannot manually target an arbitrary bin from this
  dialog.
- `RECOUNT-ROOT-CREATE-GUARD-42` — guard behavior for count creation against
  the root warehouse location itself.
- `WMS-READINESS-NAV-44` — `ProductsWmsReadinessPage.tsx` uses the same
  Router-less `runtime.navigate` fallback at two call sites and likely
  carries the identical no-op route-swap defect.

## External Shopify fulfillment reconciliation — P1D, 2026-09-16

### Trigger and authority boundary

A genuine post-baseline Shopify fulfillment may be valid commerce truth while
still lacking enough trustworthy LaSyncro evidence to identify one internal
bin that physically supplied the unit.

When the physical resolver reports an ambiguous internal location:

- commerce fulfillment truth is allowed to advance;
- LaSyncro MUST NOT guess a bin;
- LaSyncro MUST NOT write a `fulfillment_removal`;
- one durable `inventory_reconciliation_conflicts` incident is opened;
- the incident owns one reconciliation Problem Center task and one active
  `inventory_reconciliation_conflict` alert.

A Shopify fulfillment previously written by LaSyncro and identified by the
stored Shopify fulfillment ID is an echo, not a second physical action, and
does not enter this reconciliation path.

### Targeted physical reconciliation

The reconciliation incident may request one linked blind recount through
`requestFulfillmentReconciliationRecount()`.

The request:

- is idempotently linked through `recount_task_id`;
- targets real, active candidate bins only;
- requires the candidate bins to belong to one warehouse;
- creates the canonical recount with `scope='locations'`;
- does not resolve the parent reconciliation incident.

The recount remains blind. Expected quantities are system evidence and are
not exposed to the counting operator.

### Resolution lifecycle

There are two terminal evidence outcomes.

**Verified current truth**

If every active recount line is counted, no line is skipped or contested, and
all variances are zero, `closeCount()` commits the recount. The recount HTTP
controller then finalizes the linked reconciliation in the same database
transaction as:

`physical_recount_verified`

**Corrected current truth**

A non-zero variance sends the recount to `manual_review`. An accepted variance
must carry a `variance_reason`. `commitRecount()` remains the sole inventory
writer and creates the canonical `reconciliation_correction` movement for each
accepted non-zero variance. After that commit, the recount HTTP controller
finalizes the linked reconciliation in the same transaction as:

`physical_recount_corrected`

The reconciliation finalizer itself writes no inventory movement.

### Accounting and historical-attribution invariant

Physical reconciliation verifies or repairs **current physical truth**. It
does not prove which bin historically supplied the earlier Shopify
fulfillment.

Therefore:

- `resolution_location_code` remains null;
- the accepted recount correction is the ledger repair;
- no additional `fulfillment_removal` may be manufactured after recount;
- a count must never cause the Shopify fulfillment to debit inventory a
  second time.

This preserves the distinction between a valid external commerce event and
the later physical evidence used to restore trustworthy warehouse state.

### Ordinary recount compatibility

The terminal orchestration lives at the recount HTTP boundary rather than
inside `inventoryRecount.service.ts`. This avoids a circular dependency between
generic recount logic and fulfillment reconciliation.

For a normal recount with no linked reconciliation conflict,
`finalizeFulfillmentReconciliationRecount()` is a no-op. Existing recount
behavior and response shapes remain unchanged.

### Permanent verification

Certified on 2026-09-16:

- fulfillment reconciliation integration contracts: 7/7 PASS;
- ordinary recount neighbour contracts: 25/25 PASS across multi-location and
  reassignment suites;
- backend TypeScript build: PASS;
- `git diff --check`: PASS.

The permanent regression suite covers durable conflict creation, idempotent
recount linkage, complete physical-evidence finalization, corrected-inventory
accounting, zero `fulfillment_removal`, and both real HTTP terminal paths.
