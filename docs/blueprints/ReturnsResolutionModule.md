# Returns & Resolution Center — Module Blueprint

**LaSyncro | Created June 2026 — Nav Restructure**
**Status:** New module grouping. Sub-surfaces are pre-existing, independently documented.

> This module did not exist before June 2026. It groups two previously
> separate destinations — Returns (was a child of Orders) and Problem
> Center (was a child of Inventory) — under one sidenav item, because both
> resolve to the same downstream action: a physical item gets discarded,
> written off, or re-enters stock. See §4 for the reasoning.

---

## 1. Module Structure

**Sidenav:** Top-level item `id: 'returns-resolution'`, title "Returns & Resolution", icon `RotateCcw`, order 40 (`navBootstrap.ts`)
**No `requiredModuleId` on the parent** — children enforce independently server-side (see §5). This is intentional, not an oversight.

**Children:**
| id | Title | Path |
|---|---|---|
| `order-issues` | Returns | `/returns` |
| `product-issues` | Product Issues | `/problem-center` |

**Top-level tab bar** (rendered on both `/returns` and `/problem-center`): `RETURNS_RESOLUTION_MODULE_TABS` — `apps/frontend/src/pages/ft2-pages/returnsResolutionModuleTabs.ts`

**Returns has a second-level tab bar** the Product Issues side doesn't: `RETURNS_SUB_TABS` (`returnsSubTabs.tsx`) — Overview · Items · Supplier Ratings. Two-level tab hierarchy, only on one side. Product Issues is a single page.

---

## 2. Sub-surface: Returns (`/returns`)

| Tab | Path | Notes |
|---|---|---|
| Overview | `/returns` | *(renamed from "Intelligence" June 2026 — consistency with other modules' first-tab convention)* |
| Items | `/returns/items` | |
| Supplier Ratings | `/returns/suppliers` | *(renamed from "Suppliers" June 2026 — this is a return-rate scorecard + suspect-batch detector correlating defects to supplier/batch, NOT a duplicate of Purchasing's supplier directory. Confirmed via code audit: sourced from `GET /api/v1/modules/returns/correlation`, distinct from Purchasing's `GET /api/v1/suppliers`.)* |

**Backend** (`/api/v1/modules/returns/*`, confirmed via route audit):
| Endpoint | Tier/action |
|---|---|
| `GET /` | `core`, `returns:read` |
| `GET /correlation` | `growth`, `returns:read` |
| `GET /jobs` | `core`, `returns:read` |
| `POST /jobs` | `core`, `returns:job:create` |
| `PATCH /jobs/:id/lines/:lineId` | `core`, `returns:job:process` |
| `POST /jobs/:id/complete` | `core`, `returns:job:complete` |
| `GET /items` | `core`, `returns:read` |
| `PATCH /items/:id/decision` | `core`, `returns:decision:write` |

**Known issues** *(migrated from `OrdersModule.md`, June 2026 — Returns left that module's ownership; updated 2026-07-04 audit/implementation pass)*:
| ID | Priority | Description |
|---|---|---|
| RET-SUP-01 | ✅ **ACTIVATED, 2026-07-06 — UI-confirmed 2026-07-07** | Confirmed live via `GET /api/v1/modules/returns/correlation` — `LINEN-GRY-S` row returned real `supplier_name: "laSyncro"`, `receive_job_id`, `batch_received_at`, and correct `return_rate_pct: 33.3` (1 returned / 3 received). First confirmed non-null result in this chain's history. Verified against real receive→stow→pick→pack→return data (see §8), not simulated. Three other test variants in the same response correctly show `null` supplier/receive fields — confirms the query's fallback behavior is also correct, not just its happy path. **2026-07-07:** same result independently confirmed via screenshot of the live Supplier Ratings UI (Overview/Items/Supplier Ratings tabs) — "1 suspect batch detected" banner firing correctly off the ≥15%/1.5× threshold, matching the API payload exactly. |
| RET-REASON-01 | ✅ **RESOLVED, 2026-07-07** | Own intake-time reason taxonomy built and wired, per the rescoped 2026-07-04 direction. `return_reason`/`return_notes` (on `refund_executions`, migration 0008 — dormant schema, unused since creation) now has a real write path: captured at job **completion**, not creation — a deliberate design decision (§9) since the operator has maximum context (every line assessed, any enclosed note read) only by that point, and Reamaze/support-platform context is unavailable to us entirely, making the operator's on-screen input the sole record. `undelivered_reason` (Type B, carrier-caused) already had its own cleaner, separate enum — correctly never conflated with customer-declared reasons. **Known gap, not yet fixed (see §9):** reason is silently dropped if a scan-intake job (no refund yet) completes before its refund links — nowhere to persist until `refunds.create.ts`'s reconciliation extends to backfill it. |
| RET-THEME-01 | 🟢 **mostly resolved 2026-07-05** | `useReturnsTheme()` migrated from hardcoded hex to CSS var tokens (`var(--surface)`, `var(--rule)`, etc.) during the Sprint 2 triage+pulse redesign — see §7. **Explicit exception retained:** `rateHigh`/`rateMid`/`rateOk` severity colors stay literal hex (`#DC2626`/`#F59E0B`/`#22C55E`) — no `--severity-*` tokens exist yet anywhere in the design system, matching the precedent already set in `FinancesIntelligencePage.tsx`'s `SignalRow`. `rateHigh` changed from `#EF4444` → `#DC2626` this session — the original red was visually indistinguishable from `--accent` orange on the dark theme at small sizes. |
| RT2-04 | 🔴 **OPEN, blocking** | No web surface exists for owners to view, claim, or reassign unclaimed return jobs. `/returns/items` is scoped to items *already processed* and awaiting an owner decision — structurally different from the unclaimed-job queue. Confirmed via code: `ReturnsItemsPage.tsx` has zero references to job-listing/unclaimed logic. This blocks giving RT2-03's "Needs attention" orphan rows a working CTA — per `cta-deeplink-playbook.md` §7's own procedure ("check whether the destination even has the concept the alert describes" before wiring a link), the CTA was deliberately left off rather than pointed at a wrong destination. **Next planned work — see §7.** |
| RT2-05 | 🔵 **BACKLOG, cross-module** | Pulse-card visual pattern (composition bar + legend + trend delta) differs across Overview, Orders, Finances, and Returns. Returns is now the best/most consistent implementation (§7) but the pattern was never backported to the other three. Deliberately deferred — not Returns-scoped. |
| RET-PCD-01 | 🟢 **resolved, durably** | Was flagged as suspected PCD block; downgraded to an environmental/OAuth gap (see original note below); now durably fixed. Root cause: `shopify_app_installations.shop_id` has `ON DELETE CASCADE` from `shops` — every `dev:full-reset` deletes `shops` in its cleanup step, silently cascading away the installation row without ever referencing that table by name (hence it was invisible to a straightforward grep). Fixed 2026-07-04 in `dev_seed.ts` (`full_data` mode): a placeholder row is now (re)created on every seed run, using `encrypt()` so it's genuinely decryptable by every webhook handler's `decrypt(row.access_token, 'shopify.webhook.registration')` call — a bare placeholder string would have thrown on the first real webhook instead of the previous silent "no row" skip. **Explicit limitation, not a bug:** this placeholder token is real ciphertext but decrypts to a fake string — it unblocks webhook *shop-resolution* (refunds, order events, carrier tracking all now route correctly), but any code path that makes an actual outbound call to Shopify's API still requires a genuine OAuth handshake, which cannot be scripted from a seed file. Delivery path itself (webhooks reaching localhost at all) solved separately via Shopify's legacy per-store webhook config (Settings → Notifications → Webhooks) pointed at an ngrok tunnel — deliberately not via the app's own registered OAuth subscriptions, to avoid touching the production app's URLs while it's under Shopify App Store review. Original diagnosis retained below for the audit trail: |
| WEB-RETURN-02 | 🔴 **OPEN** | `refunds.create.ts`'s reconciliation guard (§8) links a late-arriving refund to an existing scan-intake job, but does not backfill `return_reason`/`return_notes` onto the newly-linked `refund_execution` if the job already completed with a reason captured pre-refund. Confirmed empirically via curl smoke test 2026-07-07 — reason sent, job completed successfully, `return_reason` column remained null since `lasyncro_refund_execution_id` was null at completion time. Not yet fixed. |

---

## 2.5 Schema — `return_jobs` [LIVE, confirmed]

**Migration:** `apps/backend/migrations/20260212162717_0008_refund_executions_sovereign.ts` — bundled inside the refund-executions migration, not its own file. *(Worth knowing if searching by filename later — there is no `*return*` migration file; this is why a name-based search misses it.)*

One row per physical return event. Two origins, different required FK:

| Column | Type | Notes |
|---|---|---|
| `return_job_id` | uuid PK | `gen_random_uuid()` |
| `shop_id` | int FK → `shops`, CASCADE | RLS enforced (`return_jobs_tenant_isolation`) |
| `origin` | enum `return_job_origin_type` | `customer_return` \| `undelivered_return` |
| `lasyncro_refund_execution_id` | uuid, nullable, FK → `refund_executions`, SET NULL | Required for `customer_return`; null at creation for `undelivered_return` |
| `lasyncro_order_id` | uuid, **not nullable**, FK → `orders`, CASCADE | Denormalized for direct order-blocking without joining through refund |
| `status` | string(50), default `pending` | `pending → in_progress → awaiting_decision → complete` |
| `undelivered_reason` | enum `undelivered_reason_type`, nullable | `undelivered_return` only — `wrong_address \| not_claimed \| customs \| carrier_error \| other` |
| `owner_decision` | enum `return_owner_decision_type`, nullable | `reship \| contact_customer \| initiate_refund \| write_off` |
| `decision_notes`, `decision_by`, `decision_at` | text / int (no FK*) / timestamptz | *No FK on `decision_by`/`claimed_by` — `users` table created in migration `0010`, after this one |
| `claimed_by`, `claimed_at` | int (no FK*), timestamptz | Operator who claimed the job on mobile — NULL for carrier-webhook-created jobs (see `source` below) |
| `completed_at`, `notes`, `created_at`, `updated_at` | timestamptz / text/ timestamptz ×2 | |
| `source` | varchar(20), default `'operator'` | **Added migration 0122 (2026-07-04).** `'operator'` \| `'carrier_webhook'`. Distinguishes mobile-scan-created jobs from ones auto-created by a carrier RTS/`returned` tracking event. |
| `triggering_parcel_tracking_event_id` | uuid, nullable, FK → `parcel_tracking_events`, SET NULL | **Added migration 0122.** Traces a `carrier_webhook`-sourced job back to the exact scan event that created it. NULL for all `operator`-sourced jobs. Deliberately not added retroactively to migration 0008 — `parcel_tracking_events` didn't exist until migration 0118 (June/July), so the FK had to land as a later migration to preserve fresh-migrate ordering. |

**Constraints:** unique on `lasyncro_refund_execution_id` (`return_jobs_refund_execution_unique`) — prevents duplicate processing jobs per refund. No app-level unique for `undelivered_return`; service layer checks for an existing active job before creating one, regardless of `source`.

**RLS fix, 2026-07-04:** `return_jobs_tenant_isolation` originally had `USING` only, no `WITH CHECK` (migration 0008) — a real gap, since this table carries write-off and refund-linkage data. Fixed in the base migration; pen-tested (`sf_app`, mismatched `shop_id` vs `app.current_tenant`) — cross-tenant INSERT now correctly rejected with `new row violates row-level security policy`.

**Carrier-triggered creation, 2026-07-04:** `createReturnJobFromCarrierEvent()` (new function in `returnJobs.service.ts`, alongside `createUndeliveredReturnJob()`) creates a `return_jobs` row with `origin: 'undelivered_return'`, `source: 'carrier_webhook'`, `claimed_by: null`. Deliberately a separate function, not a parameter on the operator path — `CreateUndeliveredReturnJobInput.operatorId` stays required (`number`) for every genuinely operator-triggered call site. Accepts an optional external `trx` (the `qb = trx ?? db` pattern already used elsewhere in the codebase, e.g. `FinancesFacts.service.ts`) rather than always opening its own `withTenant()` transaction — required because both `sendcloud.tracking.handler.ts` and `shippo.tracking.handler.ts` call it from inside their own already-open transaction; nesting a second `withTenant()` call would open a second pooled connection with no atomicity between the two.

Required a related fix: `operator_audit_log.operator_id` (migration 0010) and `WriteAuditLogInput.operatorId` were both `NOT NULL`/`number` — too strict for a system-triggered action with no human operator. Both widened to nullable/`number | null`, with the change scoped narrowly (see migration 0010's inline comment) so every existing operator-facing call site is unaffected.

**Related, extended (not newly created) by this migration:** `refund_execution_line_items` gains `item_condition`, `quantity_received`, `condition_notes`, `processed_by`, `processed_at` — these are the per-line-item resolution fields `processReturnLine()` writes to.

**Further extended, 2026-07-07 (§9):** `lasyncro_refund_execution_id` relaxed from `NOT NULL` to nullable (new migration, mirrors `return_jobs`' existing nullable-FK pattern) — required for `createManualReturnLine()`, which creates a line item for a scan-intake job with no refund yet on file. New columns: `return_job_id` (uuid, nullable, FK → `return_jobs`, CASCADE — the only link back to anything when no refund exists) and `source` (varchar(50), default `'refund_webhook'`, values `'refund_webhook'` \| `'scan_intake_manual'`). `refunded_amount` also relaxed to nullable for the same reason — a manually-created line has no refund amount to derive from yet.

### Resolution cascade (confirmed from `returnJobs.service.ts`, not inferred)

| `item_condition` | Cascade |
|---|---|
| `resellable` | `createStowTask()` called directly — inventory restored once stow completes |
| `repackable` | Inserts into `problem_center_tasks` (`source: 'returns'`, `exception_type: 'repackaging_required'`) — **this is the actual code link between the two sub-surfaces**, not just a shared nav parent |
| `damaged` / `unsellable` | Job → `awaiting_decision`; alert fires for owner |

| Shortfall (received < refunded qty) | Inserts `problem_center_tasks` row, `exception_type: 'return_shortfall'` — second direct Returns → Product Issues code link |

| Owner decision | Cascade |
|---|---|
| `reship` | Resolves the `returned_undelivered` order constraint, job → `complete` |
| `write_off` | For each damaged/unsellable line: inserts `inventory_movements` with `movement_type: 'write_off_return'`, `quantity_delta` negative, `reference_type: 'return_job'` — job → `complete` |

**This confirms §4's design rationale with code, not just intent** — `repackable` and shortfall handling don't just *conceptually* belong with Product Issues, they *write into the same table* (`problem_center_tasks`) at runtime. The two sub-surfaces are operationally linked, not just co-located in nav.

---

## 3. Sub-surface: Product Issues (`/problem-center`)

**Canonical spec: `docs/blueprints/ProblemCenter.md`.** That document owns the data model, exception taxonomy, resolution cascade, and full `INV-PC-*` issue series — not duplicated here. Only the nav-facing change is noted: sidenav label changed **"Problem Center" → "Product Issues"** (June 2026); route, IDs, and all backend paths remain `/problem-center` / `wms.problem-center.*` unchanged.

*(Suggested follow-up, not done in this edit: a short pointer banner at the top of `ProblemCenter.md` noting the sidenav rename, same pattern used in `SuppliersModule.md` §1.)*

---

## 4. Why these two are paired (design rationale)

Not "order-side vs. product-side" — both genuinely have that, but it's not the unifying test. The actual dividing line, established during the June 2026 IA workshop:

**Does resolving this require a physical warehouse action (stow, restock, discard, write-off), or a data/catalog fix (assign a SKU, assign a bin, reconcile a count)?**

Physical → here. Data → Inventory's Data Quality tab. This is why Problem Center's pick/pack/stow/receive exceptions and Returns' restock decisions sit together, while SKU/bin/count-mismatch issues correctly live elsewhere despite superficially "feeling" similar.

---

## 5. Gating architecture

Parent nav item carries no `requiredModuleId` because its two children depend on genuinely different backend modules (`returns:*` actions vs. `wms:read`), and `NavItem.children[]` only supports `requiredTier`, not per-child module gating (confirmed limitation, `registerNav.ts`). Verified safe before applying: both children's backend routes independently enforce `authenticateToken → requireFt2 → requireTier → requireAction` regardless of nav visibility — the nav layer controls a sidenav link, not an access boundary.

---

## 6. Session Log — 2026-07-04 (Returns finalization audit + implementation)

Full audit register (55 findings, RET-AUD-01 through RET-AUD-55) not reproduced here — see the AUDIT-mode session transcript. Returns-scoped outcomes:

**Resolved this session:**

- RET-AUD-06/10 → `return_jobs.source` + `triggering_parcel_tracking_event_id` (migration 0122)
- RET-AUD-46 → `return_jobs_tenant_isolation` missing `WITH CHECK` (migration 0008 fix, pen-tested)
- RET-AUD-08/52/53 → carrier fault-attribution: `carrier_status_map.fault_category` (migration 0123); Sendcloud handler was missing its `returned` branch entirely (Shippo had it, Sendcloud didn't — a real divergence between the two carrier handlers, not a documented feature gap); both now behave identically and surface fault category in the alert message
- Service layer → `createReturnJobFromCarrierEvent()`, wired into both handlers' `returned` branch — a carrier RTS event now creates an actual `return_jobs` row (`source: 'carrier_webhook'`), not just an `alerts` row as before
- RET-AUD-02 → closed by correction, not new code: `return_jobs` already had no `po_id` dependency (unlike `receive_jobs`) — the "no PO-less job type exists" claim in the WM-40 carrier-integration.md writeup was based on checking `receive_jobs` only and overlooking `return_jobs`

**Still open:**

- RET-REASON-01 (rescoped, see §2 table above) — not started
- RET-AUD-03 — WM-41 carrier analytics aggregation (return rate by carrier/SKU); out of scope for this module, tracked in `carrier-integration.md`
- RET-AUD-22 — `handleAppUninstalled` is an empty stub (no-op); unrelated to Returns directly but surfaced during this session's OAuth investigation

**Resolved in follow-up session, same day (2026-07-04, OAuth/PCD unblock):**

- RET-AUD-15 — was "every Shopify webhook handler unroutable." Root cause traced to `dev_seed.ts` never recreating `shopify_app_installations` after a reset (see RET-PCD-01 above for full detail). Fixed durably in the seed file itself — this table now self-heals on every `dev:full-data` seed run, so this class of failure should not recur. Webhook *delivery* to localhost solved separately via Shopify's legacy per-store webhook feature + ngrok, avoiding any change to the production app's registration mid-App-Store-review.
- Live end-to-end verification of the RET-AUD-52 carrier-return logic (previously only SQL-simulated) is now actually possible for the first time — pending an actual test run.

---

## 7. Session Log — 2026-07-05 (Returns Sprint 2 — reconciliation loop foundation)

Full audit register (RT2-AUD-01 through RT2-AUD-27) captured in the session transcript; key outcomes below.

**Root finding, foundational:** confirmed via code trace (`handleRefundCreated.ts` → `returnJobs.service.ts`) that **no refund webhook ever auto-created a `return_jobs` row** — `createCustomerReturnJob`/`createUndeliveredReturnJob` existed only as operator-invoked API endpoints. Every refund was a silent, permanent orphan unless a human manually opened a job. This is the actual reason the module's core "reconciliation loop" thesis (§4, physical vs. data-fix framing) was unenforced in practice — RT-AUD-24's `shopify_app_installations` cascade bug (§6) meant this had likely never been tested with live traffic either.

**Resolved this session:**

- **RT2-01** — Auto-spawn a `return_jobs` row (`status: 'unclaimed'`, `claimed_by: null`, `source: 'system_auto'`) directly inside the projection handler `refunds.create.ts`, immediately after the `refund_executions` insert — not via the operator-facing service function, which assumes a human `operatorId` and opens its own `withTenant()` transaction (would have nested incorrectly inside the projection engine's own `trx`). Idempotent via the pre-existing `return_jobs_refund_execution_unique` constraint + deterministic sha1-derived `return_job_id` (same pattern as this file's existing `refund_execution_id`/`refund_line_item_id` generation) + `.onConflict().ignore()`. Verified live across three separate DB resets — jobs auto-spawn correctly every time.
- **New `source` value** — `'system_auto'` added alongside existing `'operator'`/`'carrier_webhook'` (migration 0122). Backfill script (`apps/backend/src/scripts/backfill-return-jobs.ts`, `source: 'backfill_rt2_01'`) written for any refund predating this fix in a real environment — not needed on dev (fresh seeds have no orphans), kept in-repo for production use.
- **RT2-AUD-21/22 — duplicate `inventory_movements` from webhook replay.** `handleRefundCreated.ts`'s `refund_return` movement insert used `randomUUID()` as `reference_id` with no idempotency guard — a genuine webhook replay (2 movements, 105ms apart, identical `occurred_at`) produced a 200% restock rate. Fixed: deterministic sha1 `reference_id` (from `refund_id:variant_id:quantity`) + new migration adding `UNIQUE (shop_id, reference_type, reference_id)` on `inventory_movements` + `.onConflict().ignore()`. Existing bad data corrected via a **compensating `reconciliation_correction` entry**, not a delete — `inventory_movements` is enforced append-only by a DB trigger (`prevent_inventory_movements_mutation`), confirmed the hard way after a `DELETE` was rejected. **Same pattern confirmed present in `handleInventoryLevelUpdate.ts`** (two `reconciliation_correction` rows, 300μs apart, same replay signature) — not fixed this session, logged as RT2-AUD-26 below.
- **RT2-AUD-17** — Returns Overview subtitle read `total_units_returned` but labeled it "Total refunds," disagreeing with the correct stat box below it (`total_refunds`). Frontend-only bug, backend was always correct. Fixed + improved to show both numbers.
- **RT2-AUD-18** — Restock rate uncapped, could exceed 100% (a logical impossibility — can't restock more than was returned) whenever duplicate movements existed. Fixed with `Math.min(100, ...)` at both the shop-level and per-variant calculation — two separate occurrences in `returnsIntelligence.service.ts`, both needed the same fix independently.
- **RT2-03 — Orphan aging, full stack:**
  - New columns `returns_aging_warning_hours` (default 48) / `returns_aging_critical_hours` (default 168) added directly to the base `shop_operational_settings` migration (`0067`) rather than a new patch migration — deliberate choice; the live dev DB's checksum-drift error on this approach was resolved via `dev:full-reset`, not by patching the checksum table directly (checksums hash file contents, not DB state — a live `ALTER TABLE` can never satisfy a file-content checksum).
  - `getOrphanedReturnJobs(shopId)` — Type A orphans only (refunded, zero line items processed), joined against the shop's configured thresholds, oldest-first. Type B (item arrived, no refund on file) explicitly **not built** — no intake path exists today for a return with no `refund_execution` to attach to; that's Phase 2's tiered-matching-pipeline territory (§ referenced in the earlier PS-Returns-Sprint-1 roadmap), not retrofit here.
  - `GET/PATCH /api/v1/modules/returns/settings` — new controller, mirrors `cashflow.settings.controller.ts`'s exact pattern (same table, same insert-or-merge shape), gated `requireAction('returns:decision:write')` on the PATCH (reusing the existing owner-only permission rather than inventing a new one).
  - Settings UI — new "Returns Aging" card on Shop Settings → General, sibling to the existing Fulfillment SLA card, same `SettingsCard`/`SaveButton` shell, with client-side cross-field validation (critical > warning) mirroring the backend's own check.
  - **Full page redesign** — `ReturnsOverviewPage.tsx` restructured from a flat stat-grid into the canonical FT2 triage+pulse layout (`modules-ux-playbook.md` §1), using a locally-defined `SignalRow` (mirrors `FinancesIntelligencePage.tsx`'s exactly) for the "Needs attention" card, and a new `CompositionBar` component for the Pulse rail (restocked-vs-pending), modeled on Overview's Business Pulse — confirmed during this session to be the strongest existing pulse-card implementation, now matched rather than left inconsistent (see RT2-05 above).
  - `useReturnsTheme()` migrated to CSS var tokens as part of the same rewrite (RET-THEME-01, resolved above).

**Still open, ordered as next work (session-end decision, 2026-07-05):**

1. **RT2-04** — Build the missing web action surface for unclaimed return jobs (likely `/returns/jobs` or an extended `/returns/items`), so RT2-03's orphan signals get a real CTA per the deep-link playbook's "resolve or navigate to where resolution happens" principle — currently CTA-less by deliberate choice, not oversight.
2. **Phase 1, completed properly** — the refund **sequencing policy engine** (hold-for-receipt / refund-on-carrier-scan / refund-on-request + value-threshold override) from the original Sprint 1 roadmap was never built this session; only the detection/orphan half was. Real architectural finding: Shopify refunds are typically already executed by the time our webhook fires — a true "hold-for-receipt" gate requires laSyncro to **originate** refunds via its own UI calling Shopify's refund API, not just react to `refunds/create` after the fact. Scoped as A1 (detection-only policy violations, smaller, buildable now) vs. A2 (true refund-initiation gate, larger, contingent on RT2-04's action-surface existing first).
3. **RT2-05** — cross-module pulse-card unification (Orders, Finances, Overview) — explicitly deferred, not urgent.
4. **RT2-AUD-26** — same webhook-replay duplicate-movement pattern likely present in other Shopify handlers beyond `handleRefundCreated.ts`/`handleInventoryLevelUpdate.ts`; never generalized into a full audit across all handlers under `apps/backend/src/api/shopify/handlers/`.
5. **RET-SUP-01** (carried from §6, still unresolved) — supplier/batch correlation query is live and correct but has never returned a non-null result; needs a real receive job closed against the QA Test Supplier PO to activate.

---

## 8. Session Log — 2026-07-06 (WEB-RETURN-01 — physical return intake)

Full workshop + build, closing the biggest gap identified in §7: no web
surface existed for the physical side of a return arriving at the
warehouse. Landed as a free-scan intake pattern, mirroring pack's own
free-scan UX (WEB-PACK-02) rather than inventing a task-queue/batch
concept — a returned parcel is worked one at a time, not batched.

**Design, confirmed against real usage pattern:**
Operator opens a parcel, finds the invoice (LSO-) and/or the original
unit barcode (LSU-) still attached, scans whichever is present. Both
resolve to the same order via two different paths:

- LSO- → direct lookup against `orders.wms_barcode`
- LSU- → `pick_scan_log.lasyncro_unit_id` → `order_line_items` join
  (inventory_units carries no direct order linkage — the pick-time
  scan log is the only durable bridge)

**New endpoint:** `POST /api/v1/wms/returns/scan` (`wms:returns:scan`,
owner/admin/operator) — `resolveReturnScan()` +
`resolveOrCreateReturnJobForScan()` in `returnJobs.service.ts`. Three
outcomes on one scan, no separate claim step:

1. No return_job exists for the order → create one, immediately
   claimed by the scanning operator, `source: 'scan_intake'`,
   `lasyncro_refund_execution_id: NULL` — the parcel physically
   arrived with no refund yet on file. This is genuinely new: the
   first return-job creation path that doesn't originate from a
   refund event.
2. A `pending` job exists → claim it for the scanning operator.
3. A job already `in_progress`/`awaiting_decision` exists → return
   as-is, flag `claimedByOther` if held by someone else (no silent
   reassignment).

**Reconciliation guard (RT2-01 extended):** `refunds.create.ts` now
checks for an existing refund-less job on the order *before* creating
a new one — a refund webhook arriving after a scan-created job links
to it via `lasyncro_refund_execution_id` UPDATE, rather than spawning
a duplicate. Closes the loop the other direction.

**Verified live, full chain, real data (not seed/simulated):**
receive (PO → inspect → barcode-assign, generating real LSU-) → stow
(debit/credit movements) → manual test order insert (Shopify has no
API-side existence for dev_seed's local-only product catalog, so a
real Shopify order couldn't reference these variants — confirmed via
code read of `dev_seed.ts`'s product-seeding block) → release → pick
(writes `pick_scan_log`, the LSU→order bridge) → pack (generates real
LSO via `wms_barcode`, invoice PDF, shipping label) → both LSO- and
LSU- scans against `/wms/returns/scan` correctly resolved to the same
order and the same job (second scan found the first scan's job rather
than duplicating).

**Two unrelated bugs found and fixed during this verification, both
affecting the RT2-AUD-22 constraint added in §7:**

- **Multi-variant receive-close** broke immediately in production use
  — `inventory_movements_shop_ref_unique` was `(shop_id,
  reference_type, reference_id)` only; a receive job closing N variant
  lines legitimately writes N movements sharing one `reference_id`,
  all rejected as false duplicates. Fixed: added `lasyncro_variant_id`
  to the constraint.
- **Stow confirm** then broke on the *same* constraint for a different
  reason — a stow task's debit (source root) and credit (destination
  bin) movements share `reference_id` AND `lasyncro_variant_id` (same
  unit, same task), differing only by `location_code`. Fixed: added
  `location_code` too. Final tuple: `(shop_id, reference_type,
  reference_id, lasyncro_variant_id, location_code)`.
- Both fixes applied directly to the base migration (`0037`, per this
  codebase's standing "fix base migrations, no patch files in active
  development" rule) rather than as additional patch migrations —
  `stow.service.ts`'s own `onConflict(['device_event_id'])` clauses
  were untouched and didn't need editing; the failure was a *second*,
  separate unique constraint firing underneath, unrelated to that
  clause's own conflict target.

**Backlog, logged not fixed:**

| ID | Status | Description |
|---|---|---|
| WMS-PACK-VIZ-01 | 🔵 OPEN | Pack mode's free-scan panel shows no task/order identification before the first scan — operator scans blind. Stow's task cards (listing expected LSU- codes) are the reference pattern to mirror. |

**Still open, unchanged from §7:** RT2-05 (pulse-card unification),
RT2-AUD-26 (webhook-replay audit beyond the two handlers touched),
RET-SUP-01 (supplier correlation activation — now genuinely
unblockable, since a real receive job finally exists against a real
PO in this environment; not yet exercised).

---

## 9. Session Log — 2026-07-07 (Recovery rate, orphan completeness, reason capture, WMS fold-in)

Closed the remaining Phase 1 gaps from §7 (recovery rate, Type B orphans,
reason taxonomy) and resolved the redundant-scan-surface problem WEB-RETURN-01
(§8) introduced by launching alongside WMS's existing pack free-scan.

**Recovery rate (headline KPI, money-based):** `SUM(refund_amount WHERE
job.status = 'complete') / SUM(refund_amount)` across all `return_jobs` with a
known refund link, Type A and Type B alike. Deliberately money-based over
job-count-based — a $10 return and a $2,000 return are not equally
significant to margin. Scoped only to jobs with a refund on file; jobs with
none aren't "unrecovered," they're simply not money-tracked yet, which is
correct, not a gap. Replaces "$X lost to returns" as the Overview headline;
margin lost moves to a secondary `PulseStat`.

**Type B orphans — closed the gap flagged in §7.** `getOrphanedReturnJobs()`
previously inner-joined `refund_executions`, silently excluding every
`undelivered_return` job by construction (their refund FK is null until/if a
refund is ever issued) — meaning a stale RTS package could age indefinitely
with zero visibility. Rewritten as two separate queries (Type A ages off
`hours_since_refund`, Type B off `created_at`) unioned together. Also closed
the sub-threshold question left open in the code as an unresolved comment
(§7): jobs below the warning threshold are no longer dropped, they're
returned with `severity: 'ok'` and collapsed by default in the UI.

**Reason taxonomy — write path finally built (RET-REASON-01, resolved above).**
Captured at job **completion**, not creation or per-line — a deliberate
design decision after clarifying what `return_reason` actually represents:
why the *customer* returned the item, assigned by the *operator's* judgment
at physical intake (enclosed note, visible damage, or `other` + required
free text), since Shopify's Return object is deliberately never relied upon
(§2, PCD gating) and support-platform context (Reamaze etc.) is entirely
unavailable to us. Completion-time capture gives the operator maximum
context — every line assessed, any note read — before committing to one
answer. Known gap: silently dropped if a scan-intake job completes before
its refund links (WEB-RETURN-02, new row in §2).

**Redundant scan surface, identified and corrected.** WEB-RETURN-01 (§8)
shipped its own standalone `/returns/scan` entry point and session route —
reasonable in isolation, but redundant against WMS operations' existing
unified free-scan surface (`WmsModuleFT2`'s `activeSession` discriminated
union: `pick` \| `pack` \| `receive` \| `stow`), which already auto-detects
session type per scan rather than requiring the operator to pick a screen
first. Corrected by folding return detection into `httpPackFreeScan` itself:

- **LSU- path:** `unit.status === 'shipped'` (previously a hard
  `already_packed` error) now resolves the unit's order and calls
  `resolveOrCreateReturnJobForScan()` instead of erroring.
- **LSO- path:** `batch_not_packing` (no active packing batch) now checks
  `order_warehouse_status.status` — if `shipped`/`partially_shipped`, same
  fall-through to return-job resolution rather than a dead-end error.
- `PackFreeScanApiResponse` gains a `{ type: 'return', ... }` case;
  `WmsModuleFT2`'s `ActiveSession` gains a matching `{ type: 'return' }` case,
  rendering `ReturnSessionPage` exactly like `stow`/`pack` do, exiting via the
  same `exitSession` → scan-ready state, not a navigation to `/returns`.
- **Retired:** `POST /wms/returns/scan` (`httpReturnScan`), `resolveReturnScan`
  (both fully dead — confirmed zero remaining callers before deletion),
  `ReturnScanEntryPage.tsx`, the `/returns/scan` and `/returns/session/:id`
  routes. The Overview page's "Scan a return" CTA now points at `/wms`.
- **Module boundary correction:** `ReturnSessionPage` was initially written
  with hooks/axios calls directly (`apps/frontend/src/pages/ft2-pages/`
  pattern) — violated `modules/wms`'s hard compile boundary (`tsconfig.json`'s
  `rootDir`/`include` scope apps' pages out entirely, not just convention).
  Rebuilt as a pure presentational component living in
  `modules/wms/src/ui/pages/`, matching `PackSessionPage`/`StowSessionPage`
  exactly — all data access threaded down as props from `WmsPage.tsx`, which
  owns every `axiosInstance` call.

**Manual line creation (`createManualReturnLine`) — new capability, closes a
real hole in scan-intake.** A scan-intake job (`lasyncro_refund_execution_id:
NULL`) has zero line items until a refund links — meaning an operator
physically holding a returned item, scanning it, would previously have
nothing to assess against. New function resolves the scanned product barcode
via the existing `barcodeResolution.service.ts` (reused, not duplicated),
matches it against `order_revenue_units` for that order, and inserts a line
with `source: 'scan_intake_manual'`. Known edge case, not solved: throws if
no matching `order_revenue_units` row exists for the variant/order pair
(e.g. item added post-order) — surfaces as a 404, no fallback UI built yet.

**Two real bugs found via live smoke test (SQL + curl), both fixed same
session — recorded because they were genuine defects in shipped code, not
hypotheticals:**

1. **Missing cascade on manual lines.** `createManualReturnLine` wrote
   `item_condition` but never invoked the resellable→stow /
   repackable→Problem-Center / damaged→`awaiting_decision` cascade —
   `processReturnLine`'s cascade logic lived only inside that function.
   A manually-added "resellable" line was marked fine on paper but never
   actually queued to restock — a real violation of the module's own
   "no orphans" thesis (§4), caught by verifying `stow_tasks` directly
   rather than trusting the API's 200 response. Fixed by extracting the
   cascade into a shared `applyReturnLineCascade()`, called by both
   `processReturnLine` and `createManualReturnLine`.
2. **Missing job-status gate on manual line-add.** Unlike
   `processReturnLine` (`['pending','in_progress'].includes(job.status)`),
   `createManualReturnLine` had no status check at all — confirmed via
   curl that a line could be added to an already-`complete` job, silently
   re-triggering a stow task without the job ever reflecting that it had
   reopened. Fixed with the same gate, same error message pattern
   (`'not processable'`), and the controller's error-to-HTTP-status mapping
   updated to return `409` for it (previously fell through to a generic
   `500` — also a real gap, not just the missing gate itself).
3. Also closed while touching this code: `createManualReturnLine`'s job
   lookup was missing `shop_id` in its `where()` — no tenant scoping on
   that particular query. Minor, fixed alongside the status gate.
4. **Missing route entirely, caught first.** `POST
   /jobs/:id/lines` (the manual-add endpoint) was designed at the service
   layer and called from the frontend hook, but the controller handler and
   route registration were never actually written — a 404 on first curl
   attempt. This is the first defect the smoke test caught, before either
   of the two above.

**Verified live, full chain (SQL + curl, not simulated):** shipped order
(`LSO-TBX4U68U`) with no active packing batch → LSO- scan correctly resolved
to `type: 'return'` (not the old `batch_not_packing` error) → job fetch →
manual line add against a real unit on that order → cascade fired
(`stow_tasks` row confirmed via direct query) → job completion → reason
correctly dropped per the known WEB-RETURN-02 gap → manual-add against the
now-complete job correctly rejected `409` after the gate fix.

**Still open, ordered:**

1. **WEB-RETURN-02** — reason silently drops when a scan-intake job
   completes before its refund links. Needs `refunds.create.ts`'s existing
   reconciliation guard (§8) extended to also backfill `return_reason`/
   `return_notes` onto the linked `refund_execution`, not just
   `lasyncro_refund_execution_id` itself.
2. **Mobile has zero returns UI.** Entire session's build (§8 and §9) is
   web-only, per explicit priority — mobile's `ScannerScreen.tsx` is a
   read-only lookup surface (its own header comment: "no session, no
   workflow state"), not a workflow-scan entry point; folding returns into
   mobile would need its own equivalent of this session's WMS fold-in,
   not a port of the web code.
3. **RT2-04** (carried from §7, still unaddressed) — no web surface for
   owners to view/claim/reassign unclaimed jobs generally, distinct from
   the orphan aging list.
4. **RT2-05, RT2-AUD-26, WMS-PACK-VIZ-01** (carried from §7/§8, unchanged).