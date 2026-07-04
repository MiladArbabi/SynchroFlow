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
| RET-SUP-01 | 🟡 P2, unblocked | Supplier linkage null — requires receive jobs completed via mobile `ReceiveJobScreen`. Confirmed 2026-07-04: `return_jobs`=0, `refund_executions`=0 on current dev DB — precondition never exercised, not a code defect. QA Test Supplier PO (arrived, 30 units, 3 lines) is ready to close this loop once a receive job is completed. |
| RET-REASON-01 | 🟡 P2, **rescoped** | Was: "map Shopify's refund reason during sync." Corrected 2026-07-04: Shopify's dedicated Return/RMA object is gated by Protected Customer Data approval (separate from OAuth scope grants — `read_returns` is present in the granted scope string, but PCD approval for the Return object query itself is unconfirmed/likely unapproved). Fix path is no longer "map Shopify's field" — it's building LaSyncro's own intake-time reason taxonomy, decoupled from Shopify entirely, with a first-class `unclaimed/undeliverable` category distinct from customer-return reasons. Not started. |
| RET-THEME-01 | 🟡 P2 | `ReturnsOverviewPage` still uses hardcoded hex in`useReturnsTheme()` — migration to CSS variables pending. Unchanged this pass. |
| RET-PCD-01 | 🟢 **downgraded, resolved** | Was flagged as suspected PCD block. Confirmed 2026-07-04: `shopify_app_installations` was empty (0 rows) — a `dev:full-reset`/seed cycle recreates `shops`/`orders` directly from seed data but never creates an installation row, which only a real OAuth handshake produces. Every Shopify webhook handler resolves shop via that table; with it empty, all inbound webhooks (refunds included) were unroutable. This is an environmental/OAuth gap, not a PCD gate — `domain_events` had zero refund-type events ever recorded, confirming the deficit starts at ingestion, upstream of any PCD question. Live OAuth re-establishment attempted this session; blocked separately by the app's production `application_url`/redirect URLs being registered for App Store review — deferred, tracked outside this doc. |

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
- RET-AUD-15 — every Shopify webhook handler is currently unroutable (empty `shopify_app_installations`); blocks live end-to-end verification of everything above. Verified instead via direct SQL simulation of the handler's write path (alert row) and clean TypeScript compilation (service layer) — logic confirmed sound, live webhook round-trip deferred.
- RET-AUD-22 — `handleAppUninstalled` is an empty stub (no-op); unrelated to Returns directly but surfaced during this session's OAuth investigation