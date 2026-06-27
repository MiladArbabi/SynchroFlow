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

**Known issues** *(migrated from `OrdersModule.md`, June 2026 — Returns left that module's ownership)*:
| ID | Priority | Description |
|---|---|---|
| RET-SUP-01 | 🟡 P2 | Supplier linkage null — requires receive jobs completed via mobile `ReceiveJobScreen` |
| RET-REASON-01 | 🟡 P2 | `by_reason` always null — Shopify refund reason not mapped during sync |
| RET-THEME-01 | 🟡 P2 | `ReturnsOverviewPage` still uses hardcoded hex in `useReturnsTheme()` — migration to CSS variables pending |
| RET-PCD-01 | 🔴 P1, suspected | All screenshots this session show "0 Total refunds, $0 Total Margin Loss" on `/returns`. Hypothesis (unconfirmed): app is currently PCD-unapproved (`scripts/diagnose-pcd-access.ts` reports `BLOCKED`), which gates the broader Orders/Customers/Refunds sync this module's data depends on — Returns has no PCD checkpoint of its own, it's downstream of one. Needs verification against actual sync logs before treating as root cause. |

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
| `claimed_by`, `claimed_at` | int (no FK*), timestamptz | Operator who claimed the job on mobile |
| `completed_at`, `notes`, `created_at`, `updated_at` | timestamptz / text / timestamptz ×2 | |

**Constraints:** unique on `lasyncro_refund_execution_id` (`return_jobs_refund_execution_unique`) — prevents duplicate processing jobs per refund. No app-level unique for `undelivered_return`; service layer checks for an existing active job before creating one.

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

## 6. Open, unresolved from this session

| ID | Description |
|---|---|
| — | Schema detail for `returns` tables (jobs/items) not yet audited in this doc — only field names inferable from `CorrelationRow` type and route names. Flag for a dedicated pass if this doc needs to match `ProblemCenter.md`'s level of schema detail. |