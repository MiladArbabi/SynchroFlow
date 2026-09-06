# Returns & Resolution Center — Module Blueprint

**LaSyncro | Created June 2026 — Nav Restructure**
**Status:** New module grouping. Sub-surfaces are pre-existing, independently documented.

> This module did not exist before June 2026. It groups two previously
> separate destinations — Returns (was a child of Orders) and Problem
> Center (was a child of Inventory) — under one sidenav item, because both
> resolve to the same downstream action: a physical item gets discarded,
> written off, or re-enters stock. See §4 for the reasoning.

> **Commercial access is NOT owned by this blueprint.** Since
> `COMMERCIAL-ACCESS-ARCH-01` P0-A3-3 (2026-09-05), the canonical Returns
> commercial model — the `returns.intake` (Starter+, module `wms`) /
> `returns.core` (Core+) / `returns.analysis` (Growth+) capability ladder, the
> standard-plan matrix, route classification, navigation and direct-route
> authority — lives in
> **`docs/playbooks/monetization_billing_playbook.md` §32 "### P0-A3-3"**.
> That section is authoritative; the commercial notes in §2 and §5 below point
> back to it. Everything else here (workflow, schema, resolution cascade,
> session logs) remains this document's own.

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

**Backend** (`/api/v1/modules/returns/*`).

> **Superseded 2026-09-05 by `COMMERCIAL-ACCESS-ARCH-01` P0-A3-3.** This table
> previously listed a raw tier (`core` / `growth`) per route. Those raw tiers are
> gone: all **12** active Returns routes now resolve a **canonical capability**
> through `requireCapability()`, and `requireTier` is no longer imported by
> `returns.routes.ts` at all. Canonical commercial policy for Returns lives in
> **`docs/playbooks/monetization_billing_playbook.md` §32 "### P0-A3-3"** — that
> section, not this blueprint, is authoritative for the commercial model.

| Endpoint | Capability (commercial axis) | Action (role/permission axis) |
|---|---|---|
| `GET /` | `returns.core` — Core+ | `returns:read` |
| `GET /correlation` | `returns.analysis` — Growth+ | `returns:read` |
| `GET /settings` | `returns.core` — Core+ | `returns:read` |
| `PATCH /settings` | `returns.core` — Core+ | `returns:decision:write` |
| `GET /items` | `returns.core` — Core+ | `returns:read` |
| `PATCH /items/:id/decision` | `returns.core` — Core+ | `returns:decision:write` |
| `GET /jobs` | `returns.intake` — Starter+ | `returns:read` |
| `POST /jobs` | `returns.intake` — Starter+ | `returns:job:create` |
| `GET /jobs/:id` | `returns.intake` — Starter+ | `returns:read` |
| `POST /jobs/:id/lines` | `returns.intake` — Starter+ | `returns:job:process` |
| `PATCH /jobs/:id/lines/:lineId` | `returns.intake` — Starter+ | `returns:job:process` |
| `POST /jobs/:id/complete` | `returns.intake` — Starter+ | `returns:job:complete` |

**The two columns are separate axes and neither replaces the other.**
`requireCapability` answers *"is this tenant entitled to the capability"*;
`requireAction` answers *"is this user permitted the action"*. Existing
`requireAction` authorization is unchanged by P0-A3-3 and is ordered after the
commercial gate:

    authenticateToken → requireFt2 → requireCapability(...) → requireAction(...) → handler

**Why the job routes are Starter+.** `returns.intake` is declared on module
**`wms`**, not on `returns` — physical return receiving is warehouse *execution*,
and Starter already holds `wms`. A Starter merchant can therefore physically
receive and process a returned order through the warehouse flow **without**
gaining the Returns management module (Overview / Items / resolution), which
stays Core+ behind `returns.core`. Supplier/batch analytics stay Growth+ behind
`returns.analysis`, and Scale inherits everything.

**Known issues** *(migrated from `OrdersModule.md`, June 2026 — Returns left that module's ownership; updated 2026-07-04 audit/implementation pass)*:
| ID | Priority | Description |
|---|---|---|
| RET-SUP-01 | ✅ **ACTIVATED, 2026-07-06 — UI-confirmed 2026-07-07** | Confirmed live via `GET /api/v1/modules/returns/correlation` — `LINEN-GRY-S` row returned real `supplier_name: "laSyncro"`, `receive_job_id`, `batch_received_at`, and correct `return_rate_pct: 33.3` (1 returned / 3 received). First confirmed non-null result in this chain's history. Verified against real receive→stow→pick→pack→return data (see §8), not simulated. Three other test variants in the same response correctly show `null` supplier/receive fields — confirms the query's fallback behavior is also correct, not just its happy path. **2026-07-07:** same result independently confirmed via screenshot of the live Supplier Ratings UI (Overview/Items/Supplier Ratings tabs) — "1 suspect batch detected" banner firing correctly off the ≥15%/1.5× threshold, matching the API payload exactly. |
| RET-REASON-01 | ✅ **RESOLVED, 2026-07-07** | Own intake-time reason taxonomy built and wired, per the rescoped 2026-07-04 direction. `return_reason`/`return_notes` (on `refund_executions`, migration 0008 — dormant schema, unused since creation) now has a real write path: captured at job **completion**, not creation — a deliberate design decision (§9) since the operator has maximum context (every line assessed, any enclosed note read) only by that point, and Reamaze/support-platform context is unavailable to us entirely, making the operator's on-screen input the sole record. `undelivered_reason` (Type B, carrier-caused) already had its own cleaner, separate enum — correctly never conflated with customer-declared reasons. **Known gap, not yet fixed (see §9):** reason is silently dropped if a scan-intake job (no refund yet) completes before its refund links — nowhere to persist until `refunds.create.ts`'s reconciliation extends to backfill it. |
| RET-THEME-01 | 🟢 **mostly resolved 2026-07-05** | `useReturnsTheme()` migrated from hardcoded hex to CSS var tokens (`var(--surface)`, `var(--rule)`, etc.) during the Sprint 2 triage+pulse redesign — see §7. **Explicit exception retained:** `rateHigh`/`rateMid`/`rateOk` severity colors stay literal hex (`#DC2626`/`#F59E0B`/`#22C55E`) — no `--severity-*` tokens exist yet anywhere in the design system, matching the precedent already set in `FinancesIntelligencePage.tsx`'s `SignalRow`. `rateHigh` changed from `#EF4444` → `#DC2626` this session — the original red was visually indistinguishable from `--accent` orange on the dark theme at small sizes. |
| RT2-04 | 🔴 **OPEN, blocking** | No web surface exists for owners to view, claim, or reassign unclaimed return jobs. `/returns/items` is scoped to items *already processed* and awaiting an owner decision — structurally different from the unclaimed-job queue. Confirmed via code: `ReturnsItemsPage.tsx` has zero references to job-listing/unclaimed logic. This blocks giving RT2-03's "Needs attention" orphan rows a working CTA — per `cta-deeplink-playbook.md` §7's own procedure ("check whether the destination even has the concept the alert describes" before wiring a link), the CTA was deliberately left off rather than pointed at a wrong destination. **Next planned work — see §7.** |
| RT2-05 | 🔵 **BACKLOG, cross-module** | Pulse-card visual pattern (composition bar + legend + trend delta) differs across Overview, Orders, Finances, and Returns. Returns is now the best/most consistent implementation (§7) but the pattern was never backported to the other three. Deliberately deferred — not Returns-scoped. |
| RET-PCD-01 | 🟢 **resolved, durably** | Was flagged as suspected PCD block; downgraded to an environmental/OAuth gap (see original note below); now durably fixed. Root cause: `shopify_app_installations.shop_id` has `ON DELETE CASCADE` from `shops` — every `dev:full-reset` deletes `shops` in its cleanup step, silently cascading away the installation row without ever referencing that table by name (hence it was invisible to a straightforward grep). Fixed 2026-07-04 in `dev_seed.ts` (`full_data` mode): a placeholder row is now (re)created on every seed run, using `encrypt()` so it's genuinely decryptable by every webhook handler's `decrypt(row.access_token, 'shopify.webhook.registration')` call — a bare placeholder string would have thrown on the first real webhook instead of the previous silent "no row" skip. **Explicit limitation, not a bug:** this placeholder token is real ciphertext but decrypts to a fake string — it unblocks webhook *shop-resolution* (refunds, order events, carrier tracking all now route correctly), but any code path that makes an actual outbound call to Shopify's API still requires a genuine OAuth handshake, which cannot be scripted from a seed file. Delivery path itself (webhooks reaching localhost at all) solved separately via Shopify's legacy per-store webhook config (Settings → Notifications → Webhooks) pointed at an ngrok tunnel — deliberately not via the app's own registered OAuth subscriptions, to avoid touching the production app's URLs while it's under Shopify App Store review. Original diagnosis retained below for the audit trail: |
| WEB-RETURN-02 | ✅ **RESOLVED, 2026-07-07** | Was three bugs, not one: (1) reconciliation guard excluded `complete` jobs from its lookup, so a scan-intake job completing before its refund arrived caused a **phantom duplicate** `return_jobs` row (zero lines) instead of linking the real one; (2) `return_reason` only ever lived on `refund_executions`, so a job completing pre-refund had nowhere to persist it at all; (3) the line-item loop ran before reconciliation, so it could insert a duplicate line for a revenue unit already covered by a manual scan-intake line. All three fixed: `return_reason`/`return_notes` added directly to `return_jobs` (§2.5); status filter removed from the reconciliation lookup; function reordered so line-items reconcile against manual lines instead of duplicating. Verified live via simulated `domain_events` replay — see §10. |

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
| `repackable` | Requires the configured `shop_wms_settings.problem_bin_location`, then inserts into `problem_center_tasks` (`source: 'returns'`, `exception_type: 'repackaging_required'`). If the setting is missing, the transaction fails closed instead of generating a synthetic problem-bin location. |
| `damaged` / `unsellable` | Job → `awaiting_decision`; alert fires for owner |

| Shortfall (received < refunded qty) | Inserts `problem_center_tasks` row, `exception_type: 'return_shortfall'` — second direct Returns → Product Issues code link |

| Owner decision | Cascade |
|---|---|
| `reship` | Resolves the `returned_undelivered` order constraint, job → `complete` |
| `write_off` | For each damaged/unsellable line: requires the configured problem-bin location, then inserts `inventory_movements` with `movement_type: 'write_off_return'` and negative `quantity_delta`. Missing problem-bin configuration fails closed instead of writing a movement against a synthetic location. |

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

> **Superseded 2026-09-05 by `COMMERCIAL-ACCESS-ARCH-01` P0-A3-3** (canonical
> section: `monetization_billing_playbook.md` §32 "### P0-A3-3"). Three claims
> above are now stale, and one architectural principle has changed.
>
> **1. Nav no longer uses raw `requiredTier`.** `NavItem` supports per-entry
> `capabilityId`, so the Returns nav and sub-tabs each declare their own
> canonical capability rather than inheriting a tier from the parent:
>
> | Surface | capabilityId |
> |---|---|
> | Returns parent (nav) | `returns.core` |
> | Overview | `returns.core` |
> | Items | `returns.core` |
> | Supplier Ratings | `returns.analysis` |
>
> **2. The backend chain is now capability-based**, not tier-based:
> `authenticateToken → requireFt2 → requireCapability(...) → requireAction(...)`.
> See §2 for the per-route mapping.
>
> **3. "The nav layer controls a sidenav link, not an access boundary" is still
> true — and is exactly why the nav is no longer the only frontend gate.**
> `ReturnsFT2Page` now wraps the Returns management subtree in
> `<CommercialGate capabilityId="returns.core">`, so `/returns`,
> `/returns/items` and `/returns/suppliers` entered by **direct URL** resolve the
> same AccessDecision as a nav/tab click. Before P0-A3-3 the page mounted
> `ModuleTabBar` + `<Routes>` with no gate at all, so a direct URL bypassed the
> commercial decision entirely and the child pages began acquiring protected data
> on mount. `returns.intake` is deliberately **not** gated by that subtree — it
> stays reachable through the WMS flow, which is what lets Starter receive
> physical returns without the Returns management module.
>
> **Premium data acquisition is gated, not merely hidden.**
> `useReturnsCorrelation(enabled = true)` gained an `enabled` seam; Returns
> Overview and Supplier Ratings both pass
> `isResolved && decide('returns.analysis').allowed`, so a denied or unresolved
> tenant never fetches `GET /api/v1/modules/returns/correlation`. Premium data is
> not fetched and then blurred. Core Returns content remains fully visible to
> Core users under a `returns.analysis` denial.
>
> Returns-specific legacy commercial authority is retired: no
> `PlanGate feature="returns.analysis"` on either Returns page, no raw
> `requiredTier` in the Returns nav item or sub-tabs, no `requireTier` in
> `returns.routes.ts`, and no page-private duplicate correlation hook in
> `ReturnsSuppliersPage`. This retirement is **Returns-scoped only** — `PlanGate`
> and `usePlanEntitlement` remain in legitimate use by other, unmigrated modules.

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

---

## 10. Session Log — 2026-07-07, continued (Line-level decisions, seed data, WEB-RETURN-02)

Second half of the same-day session (§9 covered the morning's fold-in and
recovery-rate work). This half: a design correction to owner decisions, a
reusable seed dataset, a migration cleanup pass, and closing WEB-RETURN-02.

**Owner decisions moved from job-level to line-level — real bug, not a
preference change.** `write_off`'s cascade (§2.5, originally) looped over
*every* damaged/unsellable line on the whole order when a decision was made
on any one of them — a multi-line order with one line needing `reship` and
another needing `write_off` would have incorrectly written off both the
moment either decision was confirmed. Caught by design review before it hit
data, not by a test failure. Fixed:

- `owner_decision`, `decision_notes`, `decision_by`, `decision_at` added to
  `refund_execution_line_items` (folded into base migration 0008, per this
  file's original design). `return_jobs`' own copies of these columns are
  now legacy/summary-only — mobile's job-list view still reads them, but
  nothing writes to them anymore.

  > **⚠️ THIS IS THE `RETURNS-SCHEMA-DRIFT-01` DEFECT (2026-09-05).** Folding
  > these four columns into `0008` was **not sufficient for production**.
  > `0008` had already run in prod (batch 1, 2026-06-18), so Knex had it
  > recorded as complete and never re-ran it — the amendment reached fresh
  > installs and dev only. Production was left without `return_job_id`,
  > `owner_decision`, `decision_notes`, `decision_by` or `decision_at` on
  > `refund_execution_line_items`, while still carrying the legacy job-level
  > fields on `return_jobs`. `listItemsAwaitingDecision()` selects three of
  > those columns and joins the fourth, so the Returns items surface was
  > **down in production, not degraded**. Repaired forward by
  > `20260828120000_0165_repair_refund_execution_line_item_decision_columns`
  > (§12). The line-level vs job-level semantics described above are
  > unchanged and correct — only the delivery mechanism was wrong.
- New `setLineOwnerDecision()` — cascade scoped to exactly the one line
  passed in. Job auto-completes only once every damaged/unsellable line on
  it has a decision, checked via a live count query after each line
  decision, not on the first one made.
- `PATCH /items/:id/decision`'s `:id` now means the line item, not the job.
- `listItemsAwaitingDecision()` reworked to return order-level groups
  (`{ return_job_id, lines: [...] }`) rather than a flat per-line list —
  necessary since a job can now have mixed state (one line decided,
  one still pending) and the old flat shape couldn't represent that.
- Frontend (`ReturnsItemsPage.tsx`) rebuilt: order cards in the list view,
  `EntityDetailModal` (shared shell, matching Orders' pattern) on click,
  one decision row per line inside.

**Two live bugs found via this rework, both real, both fixed:**

1. **`inventory_movement_sign_check` was missing `write_off_return`
   entirely** — a pre-existing schema gap dating to migration 0037 (Feb
   2026), never caught before because no write-off had ever actually been
   attempted through the live API until this session (every prior
   verification was DB-state inspection after direct SQL seeding). Traced
   further: two *later* migrations (0080, April — fixing
   `reconciliation_correction`'s sign; 0116, June — adding
   `location_transfer`) each dropped and recreated this constraint, and
   both times silently omitted `write_off_return` from the rewrite,
   compounding the same regression twice. Fixed by merging all three
   migrations' intent into 0037 directly (per this codebase's "fix base
   migrations" convention) — 0080 and 0116 deleted as separate files.
   `location_transfer` also moved into the enum's initial `CREATE TYPE`
   list, eliminating 0116's `ALTER TYPE ADD VALUE` / `transaction: false`
   workaround entirely, since the value now exists at creation. Verified
   live: write-off through the UI now produces a correct negative
   `quantity_delta` row with `reference_type: 'return_line_item'`
   (line-scoped, confirming the new per-line cascade path, not a fallback
   to the old job-scoped one).
2. **Decision modal stayed open, fully empty, after the last line on a job
   was decided.** The job disappears from `listItemsAwaitingDecision`'s
   results the moment it's no longer `awaiting_decision`, but
   `selectedJobId` state wasn't cleared — `selectedGroup` resolved to
   `undefined` while the modal's `entityId` prop was still set. Fixed with
   a `useEffect` that closes the modal once its selected job drops out of
   the list (guarded on `!isLoading` to avoid a flash-close mid-refetch).

**Migration consolidation, broader than the returns-decisions change
above.** Per explicit preference — always fix base migrations, never leave
patch files in active development — three additional patch migrations were
folded back in while touching this schema:

> **⚠️ SUPERSEDED AS A PRACTICE, 2026-09-05 — `RETURNS-SCHEMA-DRIFT-01`.**
> "Always fix base migrations, never leave patch files" is safe ONLY for a
> migration that has never shipped. The moment production has recorded a
> migration as applied, Knex will never re-run it, and any later amendment to
> that file silently diverges prod from canonical — which is exactly what
> happened to `0008` here. The authoritative rule and the full incident record
> live in `docs/playbooks/migration_drift_playbook.md` (§1, §5, and the
> 2026-09-05 `RETURNS-SCHEMA-DRIFT-01` entry). The consolidation history below
> is preserved as the record of what was done and why; it is **not** a pattern
> to repeat against already-applied migrations.

- `0122` (`return_jobs` carrier linkage: `source` column, FK to
  `parcel_tracking_events`) → `source` merged into 0008; the FK itself
  genuinely can't merge (predates `parcel_tracking_events`, created in
  0118) — landed as one small, clearly-labeled migration
  (`0118a_return_jobs_carrier_event_fk`) rather than left as a
  same-named continuation of the old numbering.
- `0123` (`carrier_status_map.fault_category`) → merged into 0118
  (`carrier_status_map`'s actual owning migration — 0123 had incorrectly
  targeted 0008 in spirit, since it's a carrier-integration concern, not
  a returns one).
- `0124` (scan-intake nullable FK relaxation on
  `refund_execution_line_items`) → merged into 0008 directly.

Net: five separate migration files (0122, 0123, 0124, 0080, 0116) reduced
to zero new files plus one unavoidable small one, with 0008/0037/0118 each
now reflecting their true, current, final shape rather than requiring a
reader to trace forward through several later patches to understand what a
table actually looks like today.

**Seed data — `seed_returns_test_data.sql`, wired into `dev:full-seed`.**
Built to give the Returns UI real, varied test data (orphan aging buckets
at all three severities, damaged/repackable/resellable/unsellable
conditions, Type A and Type B jobs, a multi-line mixed-decision scenario)
without manual re-seeding after every reset. Went through two real
failures before landing correctly, both informative:

- **First version hardcoded UUIDs** captured from one live snapshot of the
  dev DB — broke immediately on the next `db:reset`, since `orders`,
  `variants`, etc. all get fresh UUIDs every reset. Rewritten to resolve
  everything dynamically by `external_order_id` + `sku`.
- **Second version still broke** — `dev_seed.ts` doesn't just regenerate
  UUIDs, it generates entirely different SKU strings and order numbers
  per run (`APP-82994-8018` etc., not stable business-like names).
  Neither `external_order_id` nor `sku` is a stable anchor across resets
  in this seed mode. Final version picks N distinct order/line-item pairs
  by **position** (a temp table, `ROW_NUMBER()` over a stable sort) rather
  than by identity — genuinely reset-safe, verified via a full
  `npm run dev:full-seed` pass end-to-end.
- The multi-line scenario (#12) is opportunistic by design — it only
  creates a real two-line test case when that run's dataset happens to
  contain an order with 2+ lines; safely no-ops (`INSERT 0 0`) otherwise,
  confirmed both ways across different resets.

**WEB-RETURN-02, closed — see §2's updated row above for the fix summary.**
Verified live via a constructed test: a `return_jobs` row seeded directly
to match exactly what the app produces (`source: 'scan_intake'`,
`status: 'complete'`, `return_reason: 'changed_mind'`, no refund linked),
then a real `domain_events` row of type `refunds/create` inserted and
processed through an actual `npm run rebuild` pass — not a mocked call,
the real projection replay pipeline. Confirmed after: exactly one
`return_jobs` row for the order (no phantom duplicate), correctly linked
to a real `refund_executions` row, `return_reason` present on both tables.

**Still open, unchanged:** mobile returns UI does not exist — the entire
free-scan fold-in (§9) and line-level decision rework (this section) are
web-only, per the explicit web-first priority set earlier this session.
No other open items remain from this session's original register.

---

## 11. Session Log — 2026-09-02 (ORD-DECISION-01 — returned-package closed loop)

`ORD-DECISION-01` closed the end-to-end handling gap for carrier-returned
packages. Internal state remains `returned_undelivered`; merchant-facing
language is deliberately simpler:

- issue: **Package returned**
- explanation: **The carrier returned this package before delivery.**
- warehouse action: **Process return**
- owner action: **Review return**

The returned-package workflow now reuses the existing Returns/WMS surfaces
instead of introducing another resolution system.

### Creation and constraint identity

Both supported undelivered-return creation paths
(`createUndeliveredReturnJob()` and `createReturnJobFromCarrierEvent()`) create
or preserve an active operational `returned_undelivered` order constraint whose
`target_id` is the exact `return_job_id`.

`order_constraints` remains projection-writer guarded. The Returns service uses
the sanctioned transaction-local `synchroflow.projection = 'true'` mechanism
when creating/resolving this constraint; no global bypass was introduced.

The order decision API now returns the active constraint's `target_id` and an
authoritative `target_status` read from `return_jobs.status`.

### Decision/action semantics

The neutral machine action for this subtype is `open_return_job`.

`returned_undelivered` is explicitly excluded from the generic
`resolve_operational_block` execution path. It cannot be dismissed using a
generic **Mark as resolved** action, and unknown named operational subtypes are
not silently collapsed onto that generic action.

Routing is state-aware:

- `pending` / `in_progress`
  → **Process return**
  → `/wms?returnJobId=<return_job_id>`
  → the existing `ReturnSessionPage`
- `awaiting_decision`
  → **Review return**
  → `/returns/items?returnJobId=<return_job_id>`
  → the existing `ReturnsItemsPage` owner-decision modal
- `complete`
  → no returned-package CTA; an active `returned_undelivered` constraint
  against a complete return job is an invariant violation.

The returned-package CTA is derived from the active constraint plus its
`target_id`/`target_status`; it no longer depends on `open_return_job` winning
the single Decision Engine ranking. This matters because a returned package can
legitimately coexist with inventory, SLA, or other operational constraints.
Existing customer-constraint suppression remains unchanged.

### Undelivered returns in owner decisions

`listItemsAwaitingDecision()` now supports two explicit linkage paths which are
normalized into the same `ReturnDecisionGroup` contract:

1. `customer_return`
   → existing `refund_executions` linkage;
2. `undelivered_return`
   → direct `refund_execution_line_items.return_job_id` linkage.

An undelivered return therefore does **not** receive a synthetic/fake refund
execution merely to appear in the owner-decision UI.

Damaged/unsellable undelivered-return lines can move to
`awaiting_decision`, appear in the existing Returned Items workflow, and use
the same line-level owner decisions already defined by this module.

A legitimate undelivered `reship` resolution clears the linked
`returned_undelivered` constraint (`is_active = false`, `resolved_at` set) in
addition to progressing the return lifecycle.

### Orders Critical grouping

The Orders Overview **Package returned** group is now sourced from active
constrained-order truth:

`constraint_type = 'operational'`
and
`block_type = 'returned_undelivered'`

It is no longer derived only from the SLA-breached aging population. A package
therefore does not need an unrelated `order_age_snapshot` or shipping-SLA
breach to become visible.

Shipping-SLA grouping remains sourced from the existing aging/SLA path.

When the same order is both SLA-breached and package-returned, it is deduplicated
and shown once under **Package returned** rather than duplicated across Critical
groups.

### Development verification fixtures

`seed_returns_test_data.sql` remains wired into `dev:full-seed`, but the
Process-return browser fixture no longer relies on the older positional
candidate strategy described in §10.

The browser verification fixture owns a deterministic non-terminal order:

- external order: `900099`
- marker: `FIXTURE:BROWSER-VERIFY:PROCESS_RETURN`
- origin: `undelivered_return`
- status: `pending`
- active `returned_undelivered` constraint
- no synthetic Decision Engine row

Its order/return/fulfillment/constraint identifiers are deterministic
seed-owned UUIDs. This removes dependence on randomized development order
identity and projection timing.

The Review-return fixture remains an `undelivered_return` job in
`awaiting_decision` with a damaged processed line and marker
`FIXTURE:BROWSER-VERIFY:REVIEW_RETURN`.

### Regression and verification evidence

Permanent regression coverage added/extended for this work includes:

- returned-undelivered creation and linked constraint identity;
- generic-resolution bypass prevention;
- authoritative `target_id` / `target_status`;
- legitimate lifecycle resolution and Critical disappearance;
- unknown operational subtype safety;
- `undelivered_return` owner-decision listing without a refund execution;
- exact WMS and Returns deep-link routing;
- returned-package CTA independence from Decision Engine election;
- customer-constraint suppression;
- complete-state CTA suppression;
- constrained-only Package-returned grouping;
- returned-package versus SLA deduplication/precedence;
- live `OrdersFT2Page` constrained-order wiring.

Targeted backend integration suite: **10/10 passed**.

Targeted returned-package Orders grouping/wiring suites: **5/5 passed**.

Targeted returned-package Order detail modal suite: **10/10 passed**.

Touched backend, WMS, and Order Nexus TypeScript surfaces report zero target
errors. The frontend project retains its known pre-existing TypeScript baseline
outside these touched surfaces.

Live-browser verification on the deterministic development fixtures confirmed:

- Order `#900099`
  → **Package returned**
  → **Process return**
  → exact existing WMS `ReturnSessionPage`;
- Order `#900016`
  → **Package returned**
  → **Review return**
  → exact existing Returned Items owner-decision modal.

Lifecycle clearing after legitimate resolution is additionally protected by the
backend integration contract; the browser verification above focused on the
two user-facing routing branches.

**ORD-DECISION-01: CLOSED.**

---

## 12. Session Log — 2026-09-05 (`RETURNS-SCHEMA-DRIFT-01` — production schema drift on `refund_execution_line_items`)

**Canonical drift policy lives in `docs/playbooks/migration_drift_playbook.md`**
(§1, §5, and the 2026-09-05 `RETURNS-SCHEMA-DRIFT-01` incident entry). This
section records the Returns-specific facts only.

### Root cause

Historical migration `20260212162717_0008_refund_executions_sovereign` ran in
production on 2026-06-18 (batch 1) and was **later amended in source** to add
line-level decision columns (§10). Knex had already recorded `0008` as complete
and therefore never re-applied it, so the post-run additions reached fresh
installs and dev but never production.

`0008` remains the canonical **historical baseline** and was NOT edited by this
repair. Its own DRIFT WARNING is authoritative: amending an already-applied
migration cannot reach production, and a forward migration is the only correct
mechanism.

### Confirmed production drift

`refund_execution_line_items` was missing all five of:

| Column | Canonical shape |
|---|---|
| `return_job_id` | `uuid`, nullable |
| `owner_decision` | `return_owner_decision_type`, nullable |
| `decision_notes` | `text`, nullable |
| `decision_by` | `integer`, nullable |
| `decision_at` | `timestamptz`, nullable |

...together with the single-column index on `return_job_id` and the FK
`refund_execution_line_items.return_job_id -> return_jobs.return_job_id
ON DELETE CASCADE`. Production still carried the LEGACY job-level decision
fields on `return_jobs`.

**Impact:** `listItemsAwaitingDecision()` selects `reli.owner_decision`,
`reli.decision_notes` and `reli.decision_at` and joins `reli.return_job_id`, so
on the drifted shape the query cannot execute at all — the Returns items surface
was **down in production, not degraded**.

### Line-level vs legacy job-level decision semantics

Unchanged by this repair, and the reason the backfill is deliberately narrow:

- **Line-level** (`refund_execution_line_items.owner_decision` and siblings) —
  one disposition per returned unit. This is where the web app writes, and what
  `setLineOwnerDecision()` scopes its cascade to (§10).
- **Job-level** (`return_jobs.owner_decision` and siblings) — a legacy per-job
  summary, still read by mobile's job-list view, written by nothing current.

They are different semantics, not two copies of one value. Copying job-level
values down onto lines would fabricate a per-unit disposition no operator ever
made — on **every** line of a multi-line job — which is precisely the bug
line-level decisions were introduced to fix. The repair therefore **never**
copies them; restored line-level columns start NULL unless already populated.

### Forward repair — `0165`

`apps/backend/migrations/20260828120000_0165_repair_refund_execution_line_item_decision_columns.ts`,
carrying the stable marker `RETURNS-SCHEMA-DRIFT-01` (the regression suite
locates it by that marker, never by number).

- conditionally restores the five canonical columns (`ADD COLUMN IF NOT EXISTS`);
- safe on fresh/current canonical databases — FK and index presence are decided
  by inspecting `pg_constraint` / `pg_index` **structurally**, not by constraint
  name, so a correct FK under a different name is never duplicated;
- structurally ensures exactly one canonical FK
  `refund_execution_line_items(return_job_id) -> return_jobs(return_job_id) ON DELETE CASCADE`,
  and refuses to proceed if an *incompatible* FK occupies that relationship
  rather than silently replacing an unknown production structure;
- structurally ensures a usable single-column `return_job_id` index;
- **deterministic backfill only**, through
  `reli.lasyncro_refund_execution_id = rj.lasyncro_refund_execution_id`;
- zero matches → stays NULL; an existing non-null `return_job_id` is preserved;
- **ambiguity fails closed** — detected before any write, then throws and aborts
  the transaction. No timestamp/order/revenue-unit heuristic, no `LIMIT 1`;
- validates the resulting structure at the end of `up()` and throws rather than
  leaving a half-repaired schema.

**Ambiguity is presently unreachable, and the guard stays anyway.** Canonical
schema carries `return_jobs_refund_execution_unique` (UNIQUE on
`return_jobs.lasyncro_refund_execution_id`, `0008`), so one refund execution can
never map to more than one return job. The fail-closed branch exists for the case
where that invariant is ever weakened or itself drifts.

**`down()` is intentionally non-destructive (a no-op).** These five columns, the
index and the FK are canonical `0008` structures that `0165` only *restores* —
they are not feature-owned temporary additions it introduced, so they are not its
to remove. Dropping them on rollback would re-create this incident and destroy
line-level decision data and backfilled links written after the repair. A faked
destructive inverse would be actively dangerous, so none was written.

### Verification evidence

Permanent regression contract:
`tests/integration/returns/returns-schema-drift-01.test.ts`

- targeted: **11 / 11 PASS**
- combined with `tests/integration/returns/returned-undelivered-contract.test.ts`:
  **21 / 21 PASS** (neighbouring Returns suite unaffected)

Contracts proven: production-shaped drift reproduction; repair restores all five
columns with correct types and nullability; exactly one canonical CASCADE FK; one
usable single-column index; deterministic backfill; unmatched row remains NULL;
existing link preserved; job-level owner decision NOT copied to line level;
canonical/fresh-schema rerun safe (no duplicate column/FK/index, data unchanged);
non-destructive `down()`; and the original `listItemsAwaitingDecision` read path
executing after repair — including the real exported service function, not only a
hand-written query.

Each scenario runs inside a rolled-back transaction against the disposable
integration database, so the shared test DB is byte-identical afterwards.
Disposable DB: created → migrated → runtime OK → dropped, `ORPHAN_COUNT=0`. The
development database was never used or mutated.

Backend TypeScript: PASS, after local ignored package-resolution shadows were
aligned to the current worktree packages. Those shadows are
**verification-environment only and are NOT shipped product changes**.

### Lifecycle

    RETURNS-SCHEMA-DRIFT-01
    - AUDIT: CLOSED / PASS
    - WORKSHOP: CLOSED / PASS
    - TEST STRATEGY: CLOSED / PASS
    - IMPLEMENTATION: CLOSED / PASS
    - AUTOMATED VERIFY: CLOSED / PASS
    - DOC: CLOSED / PASS
    - COMMIT / PUSH / CI / DEPLOY / PRODUCTION CERTIFICATION: PENDING

**Production is still running the drifted shape.** `0165` is implemented and
locally verified; it has not been committed, deployed, or rehearsed against
`prod_scratch` per the drift playbook §4. Do not read this section as a claim
that the production schema is repaired.

> **Superseded 2026-09-06.** `0165` has since shipped — its backend production
> repair and certification stand, and the five decision columns are present in
> production. The paragraph above is retained as the record of this slice at DOC
> time; it is no longer current.
>
> One item remains open for -01: its **visual** Returns certification still needs
> reviewer seed data, and that seed cannot load until `RETURNS-SCHEMA-DRIFT-02`
> (§13) is deployed and the production schema is certified. -01's backend repair
> is NOT waiting on anything; only the visual pass is.

---

## 13. Session Log — 2026-09-06 (`RETURNS-SCHEMA-DRIFT-02` — scan-intake shape drift on `refund_execution_line_items`)

**Canonical drift policy lives in `docs/playbooks/migration_drift_playbook.md`**
(§1, §5, and the 2026-09-06 `RETURNS-SCHEMA-DRIFT-02` incident entry). This
section records the Returns-specific facts only.

### Distinct from RETURNS-SCHEMA-DRIFT-01

Same table, same root cause, **different columns**. -01 (§12, migration `0165`)
restored the five missing line-level *decision* columns. -02 is the *scan-intake*
shape: nullability, defaults, and one absent provenance column. The two do not
overlap, and -02 does not revisit anything -01 repaired.

### Root cause

`20260212162717_0008_refund_executions_sovereign` was amended after production
had already applied it. Knex had it recorded as complete and never re-ran it, so
production retained an older `refund_execution_line_items` shape while canonical
`0008` had moved on to the scan-intake/runtime semantics. `0008` and `0165` were
both left untouched — amending an already-applied migration cannot reach
production.

### Confirmed production drift, before repair

| Column | Production | Canonical `0008` |
|---|---|---|
| `lasyncro_refund_execution_id` | `uuid NOT NULL` | `uuid NULL` |
| `refunded_amount` | `numeric(14,2) NOT NULL` | `numeric(14,2) NULL` |
| `created_at` | `timestamptz NULL`, no default | `timestamptz NOT NULL DEFAULT now()` |
| `source` | **absent** | `varchar(50) NOT NULL DEFAULT 'refund_webhook'` |

**Impact:** this is the scan-intake shape. `createManualReturnLine()` writes a
line for a return job that has no refund yet — `lasyncro_refund_execution_id` and
`refunded_amount` are NULL *by design*, and `source` distinguishes
`'scan_intake_manual'` from `'refund_webhook'`. On the production shape that
insert cannot succeed at all.

### Already correct, and deliberately untouched

The PK; the execution-id, revenue-unit and `return_job_id` indexes; the
execution/revenue-unit unique constraint; all three FKs; RLS enabled **and**
forced; `refund_execution_line_items_tenant_isolation_policy`; and the five
decision columns already repaired by -01 / `0165`. The repair drops or recreates
none of them.

### Production data-risk audit

`refund_execution_line_items` row count **0** · `refunded_amount` precision/scale
**14/2** · RLS enabled **true** · FORCE RLS **true** · tenant policy **present**.
The zero row count is both what allowed production's NOT NULL tightening in the
first place and what makes adding `source` with a default safe.

### How it surfaced

`seed_returns_test_data.sql`, being loaded to produce reviewer seed data, failed
on the missing `source` column. The seed transaction aborted and the final
`COMMIT` resolved to `ROLLBACK`. **No production seed data persisted and the
failed seed changed nothing in production** — it revealed the drift, it did not
cause or mutate it.

### Forward repair — `0166`

`apps/backend/migrations/20260906120000_0166_repair_refund_execution_line_item_scan_intake_columns.ts`,
marker `RETURNS-SCHEMA-DRIFT-02`.

- validates live column types **before** any `ALTER` (`uuid`, `numeric(14,2)`,
  `timestamptz`) and fails closed rather than coercing or recreating a column;
- `DROP NOT NULL` on `lasyncro_refund_execution_id` and `refunded_amount`;
- `created_at` — fails closed if any existing row is NULL (timestamps are never
  invented), then `SET DEFAULT now()` and `SET NOT NULL`;
- `source` — absent + zero rows ⇒ add `varchar(50) NOT NULL DEFAULT 'refund_webhook'`;
  absent + existing rows ⇒ **fail closed**, rather than fabricating
  `'refund_webhook'` provenance for lines that may have been scan-intake;
  already present ⇒ validate `varchar(50)` compatibility, then converge default
  and nullability only;
- preserves all unrelated indexes, constraints, FKs, RLS state and policies;
- validates the final canonical shape; idempotent (drifted → repaired,
  canonical → no-op, `up()` twice safe);
- `down()` intentionally **non-destructive / no-op** — these are canonical `0008`
  structures `0166` only restored, and reverting them would reintroduce a
  known-invalid production schema.

### Regression contract

`tests/integration/returns/returns-schema-drift-02.test.ts` permanently proves:
exact production drift → canonical repair; scan-intake runtime insert semantics
(NULL execution id and amount accepted, `source` resolving to `'refund_webhook'`,
`created_at` non-null); canonical fresh-DB no-op; `up()` idempotency;
preservation of indexes/constraints/FKs/RLS/policy; and non-destructive `down()`.

**Locator correction applied to BOTH drift suites.** They now locate their repair
migration solely by unique stable issue marker. The previous "repair must be
newer than every unmarked migration" heuristic was removed because any later
legitimate migration invalidated older repair tests — `0166` demonstrated this
against the -01 suite. Ordering is now deterministic display only, never
eligibility.

### Verification

Combined targeted Returns suite — **3 suites passed, 31 tests passed, 0 failed**
(`returns-schema-drift-01`, `returns-schema-drift-02`,
`returned-undelivered-contract`). Disposable DB
CREATED → MIGRATING → MIGRATED → RUNTIME_OK → DROPPED, `ORPHAN_COUNT=0`. The
development database was never used or mutated. `git diff --check` PASS.

### Lifecycle

    RETURNS-SCHEMA-DRIFT-02
    - AUDIT: CLOSED / PASS
    - WORKSHOP: CLOSED / PASS
    - TEST STRATEGY: CLOSED / PASS
    - RED: CLOSED / PROVEN
    - IMPLEMENTATION: CLOSED / PASS
    - AUTOMATED VERIFY: CLOSED / PASS
    - DOC: CURRENT
    - COMMIT / PUSH / CI / DEPLOY / PRODUCTION CERTIFICATION: PENDING

**`0166` is not committed, pushed or deployed, and the production schema is NOT
repaired for these four properties yet.** Do not read this section as a claim
that it is.

**Sequencing note.** -01's reviewer-seed / visual Returns certification must be
retried only AFTER `0166` is deployed and the production schema is certified —
`seed_returns_test_data.sql` cannot load until `source` exists in production.
