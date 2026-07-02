# LaSyncro — CTA Deep-Link & Cascade Playbook

> **Scope:** The cross-module deep-link contract — how a signal (alert, decision card, CTA) becomes a working navigation to a *specific, pre-filtered* destination. Owns the alert-type → param → destination table, the constraint/urgency filter dimensions on Order Flow, the SLA-priority release ordering, and the entity-precision gap.
> **Companion docs:** `docs/playbooks/modules-ux-playbook.md` (CTA visual tiers/colors), `docs/playbooks/overview-module-playbook.md` (Overview's data pipeline + AL-01 trigger rules — see its 2026-06-28 correction, §2 there, before trusting the alert_type table), `docs/playbooks/order-flow-implementation-playbook.md` (Order Flow's product fundamentals + backend release model), `docs/blueprints/constraint_system_blueprint.md` (`order_constraints` schema truth).
> **Created:** 2026-06-27. **Major revision:** 2026-06-28, after discovering `operational`'s true meaning and shipping the full Phase 2/3 wiring.
> **Status legend:** ✅ done & verified · 🔴 open · 🟡 open, lower priority · 🔵 design decided, not yet implemented

---

## 1. The Principle

Stated once already in the codebase (`useMorningBriefSnapshot.ts`):

> **Deep links are backend-generated. The frontend never constructs them.**

Most bugs in this doc's history were violations of this principle — a component hand-writing a path instead of using the one the backend sends. One still-open violation remains: **CASH-01** below.

---

## 2. Architecture
alerts table (AL-01 aggregator, apps/backend/src/services/alerts/alerts.aggregator.ts

— the canonical source; see §3 for what each alert_type actually means)

│

▼

DEEP_LINK_MAP (overviewMorningBrief.resolver.ts)

│

▼

signal.deepLink (string, e.g. "/orders/flow?constraint=inventory&urgency=sla_breach")

│

▼

onNavigate(signal.deepLink) — TriageRow, BusinessPulse, etc.

│

▼

Destination page reads useSearchParams() and filters

`aha.controller.ts` is a confirmed-separate pipeline (own header: *"all signals derived from existing snapshots"*) — does not read `alerts` or this map. Not a duplicate to reconcile.

---

## 3. Canonical alert_type → deep link table (corrected, ground-truth verified against `alerts.aggregator.ts` directly — 2026-06-28)

| `alert_type` | Severity | Real trigger (verified against aggregator source) | deepLink | Dimension |
|---|---|---|---|---|
| `sla_breach` | critical | `order_age_snapshot.is_shipping_sla_breached` — paid, unfulfilled, `age_since_paid ≥ fulfillment_sla_hours×3600` (default 24h) | `/orders/flow?urgency=sla_breach` | **urgency** |
| `operational` | critical | **Unresolved pick exception** (item missing, short pick, product/packaging defect, wrong item) — see `operationalConstraintEvaluator.ts`. Has nothing to do with age or time. | `/orders/flow?constraint=operational` | **constraint** |
| `inventory` | warning | Active `inventory` constraint — no sellable bin-type stock | `/orders/flow?constraint=inventory` | **constraint** |
| `customer` | warning | Active `customer` constraint — address problem | `/orders/flow?constraint=customer` | **constraint** |
| `revenue_at_risk` | warning/critical | `at_risk_revenue` from `orders_operational_control_snapshot`, summed across all constraint types | `/orders/flow` (no param — sum across types, not isolable to one) | none |
| `missing_cogs` | warning | Active order has a variant with `unit_cost=0`/null | `/inventory/catalog` (no param — see §6, Catalog has no cost-completeness concept to filter on) | none |
| `stockout_risk` | critical | `reorder_urgency === 'critical'` in `demandIntelligence.service.ts` — confirmed exact match, same source | `/demand?filter=critical` | category (page shows this by default already) |
| `wms_*` (7 types) | — | — | `/wms?filter=...` | **mismatch, still open — OV-07** |

### ⚠️ History of getting `operational` wrong — read before touching this alert_type again

Got this wrong **twice** before landing on the truth above:

1. **First belief:** `operational`'s deepLink slug `aging_72h` was just a typo colliding with Aha's genuine `aging_72h_plus` metric (`sla.metrics.ts`). Fixed by renaming to `fulfillment_sla_breach`, treating it as a 24h-SLA urgency concept — this matched `overview-module-playbook.md`'s AL-01 table at the time.
2. **Second, ground-truth check (2026-06-28):** read `operationalConstraintEvaluator.ts` and `alerts.aggregator.ts` directly. Neither has anything to do with age. The evaluator's own comment is explicit: *"IMPORTANT — NOT SLA... Operational is a PHYSICAL-blocker signal, orthogonal to age"* — written after a prior bug where someone *had* conflated the two and produced duplicate signals. `operational` = unresolved pick exception, full stop. It belongs in the **constraint** dimension, same bucket as `inventory`/`customer`, not anywhere near urgency.

**Lesson:** `overview-module-playbook.md`'s AL-01 table was stale (described pre-fix behavior its own §7 said had been corrected, but the table itself was never updated to match). Corrected there 2026-06-28 — see that doc's own §10. **Always verify alert_type meaning against `alerts.aggregator.ts` directly, never against a derived description, however authoritative-looking.**

**Net effect:** there is only **one** real urgency dimension on Order Flow (`sla_breach`). `aging_72h_plus` (Aha's, absolute ≥72h) remains a separate, unconnected metric — no filter mechanism exists for it on Order Flow, and nothing currently requires one.

---

## 4. Issue Register

| ID | Status | Description |
|---|---|---|
| OV-01 | ✅ FIXED | `/orders/flow` now reads `constraint` and `urgency` from URL — see §5. |
| OV-02 | ✅ FIXED | Dead `onResolveAll` prop removed. |
| OV-03 | ✅ FIXED (reframed) | Was never a missing-`useSearchParams` problem — `FinancesIntelligencePage`'s own CTA already sends operators to Catalog for this signal. Resolver corrected to match (`/inventory/catalog`, no param). |
| OV-04 | ✅ FIXED | Overview's "View order flow →" points at `/orders/flow`. |
| OV-05 | ✅ FIXED | `/cash-flow` → `/cashflow` typo. |
| OV-06 | ✅ FIXED | `?focus=` → `?filter=` standardization (superseded — `revenue_at_risk` no longer uses Cashflow at all, see below). |
| OV-07 | 🟡 OPEN | WMS alerts need entity-level params; `alerts.aggregator.ts` doesn't carry them. Blocked on ENTITY-01. |
| OV-08 | ✅ FIXED (reframed) | Was never a duplicate — `aha.controller.ts` is a separate, correct pipeline. No fix needed there. |
| ORD-01 | ✅ **CLOSED (2026-07-02)** | Re-verified live — `OrdersModuleFT2.tsx` line 824 already calls `navigate('/orders/flow')`. Doc status was stale; fix landed at some point without this table being updated. Closing out during the Order Flow module CTA audit kickoff. See `entity-detail-modal-playbook.md` §2 for ORD-02 (removed) and ORD-03 (the real entity-modal trigger work), found in the same file during the Orders modal investigation. |
| AHA-01 | 🟡 OPEN, parked | `aha.controller.ts` Signal 3 "Revenue concentration" → `/orders?filter=revenue_concentration`, fully orphaned, different feature surface (customer analytics). |
| **CASH-01** | 🟡 **CONFIRMED, DEFERRED (2026-07-02)** | `CashFlowModuleFT2.tsx`'s `atRiskRevenue` chip hardcodes `href="/orders?filter=blocked"` — a frontend-constructed link, violating §1's core principle. Doubly stale: wrong route (`/orders`, not `/orders/flow`) and wrong param shape (`filter=blocked` isn't read by anything — Order Flow reads `constraint`/`urgency`). Re-confirmed live, bug still present. **Explicit product decision: not fixing now** — Cashflow module's future is uncertain (possible deprecation), not worth investing in a link fix that may be deleted entirely. Revisit if/when Cashflow's roadmap is confirmed. |
| PHANTOM-01 | 🔴 OPEN | Phantom stock computed/scored/has a working CTA in `ProductsCatalogPage.tsx`, never reaches `alerts`. |
| ENTITY-01 | 🔴 OPEN, foundational — **reframed 2026-06-28** | Originally framed as "build entity-aware alerts from scratch." **Wrong** — `demandIntelligence.service.ts` and `resolve_inventory_block.handler.ts` already correctly populate `entity_id`/`entity_type` (`'variant'`, real variant ID) on `stockout_risk` alerts. The real task is bringing `alerts.aggregator.ts` (AL-01's constraint/SLA/revenue/cogs alerts) up to the standard already met elsewhere in this codebase — not inventing the pattern. |
| **CATALOG-GAP** | 🔴 **NEW, OPEN, future feature, not urgent** | `ProductsCatalogPage.tsx` / `ProductsOperatorFacts.service.ts` has no cost-completeness tracking at all — only `phantom`/`zeroStock`/`noSku`/`sellable` exist as states. `missing_cogs`'s "Fix in Catalog" CTA (on both Overview and Finances Intelligence) lands on Catalog with nothing to filter into. Not broken — just a real future feature (a `missingCost` status + filter) if this signal is ever expected to be actionable from Catalog directly rather than via Finances' own existing margin breakdown. |

---

## 5. Order Flow filter dimensions — ✅ IMPLEMENTED (Phase 2, 2026-06-28)

`OrderFlowPage.tsx` reads two independent URL params via `useSearchParams`:

| Param | Values | Mechanism |
|---|---|---|
| `constraint` | `inventory` \| `customer` \| `operational` | Auto-expands the matching `blockedByReason` accordion section on mount |
| `urgency` | `sla_breach` | Filters both Blocked and Pool columns to `order.is_shipping_sla_breached === true` |

Deliberately **not** reusing `bucketByCpt`/`CptBucket` (`overdue`/`today`/`ahead`) for `urgency` — confirmed that logic is a degenerate fallback (fires on missing/zero capacity data, not actual lateness) layered with the real SLA flag for *display* purposes only. The URL filter uses the real `is_shipping_sla_breached` field directly, so a deep link shows exactly what the alert claimed — no silent inclusion of unrelated orders via a stale capacity reading.

**Known scoping gap, not yet addressed:** header summary figures (`blockedCount`, `heldRevenue`) still show true unfiltered totals when a filter is active, and there's no visible chip indicating a deep-link filter is live (unlike the existing `cptFilter` pill). Violates the "truth over optimistic UX" principle from `order-flow-implementation-playbook.md` — logged, not yet fixed.

---

## 6. SLA-priority release ordering — ✅ IMPLEMENTED (2026-06-28)

Separate from the filter work above — this changes which orders **physically release first** in a batch, per product requirement: *"prioritize orders about to breach SLA, or older, so the next batch picks them up first."*

**Confirmed existing mechanism, reused rather than reinvented:** `pickBatch.service.ts` already had `is_priority_flagged DESC, order_created_at ASC` as its fill order — manual flags already preceded everything else. Added `is_shipping_sla_breached DESC` as a second sort key, between priority-flag and age:
ORDER BY is_priority_flagged DESC, is_shipping_sla_breached DESC, order_created_at ASC

Applied identically in **two places** that both needed it independently — they were never sharing logic:
- `apps/backend/src/services/wms/pickBatch.service.ts` (`eligibleOrders` — decides actual release order)
- `apps/backend/src/api/wms/wms.controller.ts` `httpGetOrderPool` (`GET /api/v1/wms/order-pool` — decides what the operator *sees*)

Both joined via the same `DISTINCT ON ... aggregate_version DESC` CTE pattern already established in `sla.metrics.ts` (`order_age_snapshot` is append-only/versioned — a naive join would multiply rows and corrupt the greedy-fill loop).

**Manual flag always outranks automatic SLA-breach status** — deliberate design choice, not a default: a human's explicit flag should never be silently overridden by a heuristic.

`PoolOrder` type (`useOrderPool.ts`) extended with `is_shipping_sla_breached: boolean | null` (nullable — `LEFT JOIN`, an order with no snapshot row yet is "unknown," not "false"). `OrderFlowPage.tsx` pool rows now show an "SLA breached" badge (`var(--accent)`, same token as the existing "Priority" badge — this file's playbook grants no hardcoded-severity-color exception, unlike `OrdersModuleFT2.tsx`).

**Not touched, by design:** the existing `hours > 48` ad hoc red-clock coloring on pool rows stays as-is — a sixth, still-uncatalogued age threshold, reconciling it is a separate future decision.

---

## 7. Procedure — adding a new alert's deep link correctly

1. **Read the alert_type's real trigger directly in `alerts.aggregator.ts` (or the relevant emitter) — never trust a derived table, comment, or prior doc's description without checking the source.** This playbook itself got `operational` wrong twice by trusting derived descriptions.
2. Add real `entity_id`/`entity_type` at emission if the entity is known — `demandIntelligence.service.ts` is the working reference pattern.
3. Add the entry to `DEEP_LINK_MAP` in `overviewMorningBrief.resolver.ts`.
4. **Before assuming the destination page can filter, check whether the destination even has the concept the alert describes** — `CashFlowModuleFT2`, `FinancesIntelligencePage`, and `ProductsCatalogPage` all turned out to have *no* matching concept for their original alert types; the fix was redirecting to the page's own existing CTA destination, not adding a filter.
5. If the destination does have a real list, confirm the param values match its actual data model (e.g. real DB enum), not an alert-taxonomy name that sounds similar.
6. Update §3's table in the same commit.

---

## 8. Phase plan — current state (2026-06-28)

- **Phase 0** ✅ — Resolver typos, dead prop, OV-04.
- **Phase 1** ✅ — Resolved into "fix the naming collision," then fully corrected again after ground-truth check (§3). `operational` now correctly in the constraint dimension.
- **Phase 2** ✅ — `OrderFlowPage` constraint/urgency params (§5) + SLA-priority release ordering (§6), including the badge.
- **Phase 3** ✅ (with corrections) — Cashflow/Demand/Finances audited. Demand confirmed already correct as-is. Cashflow and Finances/Catalog turned out to be **wrong-destination bugs**, not missing-filter bugs — fixed by redirecting deep links to match each page's own existing CTA precedent, not by adding `useSearchParams` to pages with nothing to filter.
- **Phase 4** 🔴 — Promote phantom stock into `alerts` (PHANTOM-01).
- **Phase 5** 🔴 — ENTITY-01, reframed as "match the existing standard," not greenfield.

**Newly surfaced, not yet scheduled:** CATALOG-GAP (future feature). CASH-01 confirmed still present but deliberately deferred pending Cashflow module roadmap decision (2026-07-02). ORD-01 closed 2026-07-02 — re-verified, already fixed.

Parked, separate track: Alerts-in-sidenav placement (Option A/B/C).

---

## 9. Order Flow module — CTA/UX audit kickoff (2026-07-02)

Opened as the next module audit after Orders module CTAs closed out (see `entity-detail-modal-playbook.md` §2.9 for that work). First findings, unrelated to the deep-link contract itself but caught in the same pass:

| ID | Status | Description |
|---|---|---|
| OF-01 | ✅ FIXED | Order Pool table headers (`Order/Value`, `SKUs`, `Units`, `Age`) were static `<Typography>` with zero sort capability — no `sortField`/`sortDir` state existed at all. Added, following `modules-ux-playbook.md` §6's canonical Column Sorting Pattern exactly. Deliberately excludes `is_priority_flagged`/`is_shipping_sla_breached` from sortable fields — those are fixed release-order flags (`pickBatch.service.ts`'s `is_priority_flagged DESC, is_shipping_sla_breached DESC, order_created_at ASC`, §6 above), not operator-resortable data; exposed as filter toggles instead. |
| OF-02 | ✅ FIXED | Added in-table Priority/SLA-breached filter chips. Deliberately **additive**, not a replacement for the existing `cptFilter` — that's a cross-link mechanism driven by clicking a pool-matrix cell elsewhere on the page (§5 above), a different interaction class from an in-table operator toggle. Both filters compose (AND'd together) in `filteredPool`. |
| OF-03 | ✅ FIXED | Zero pagination previously — `visiblePool.map()` rendered every filtered order unbounded. Added `page`/`perPage` state + `poolTotalPages` derivation, compact Prev/Next footer (page-size selector intentionally omitted — column too narrow for §6's full 10/25/50/100 chip row, and pool volume is realistically smaller than e.g. Catalog's product list). Footer only renders when `poolTotalPages > 1`. |
| — | note | `ReleaseQueuePage.tsx` shares the same `useOrderPool`/`PoolOrder` data shape and has the **identical** gap (confirmed via grep — no sort/pagination state there either). Not fixed as part of this pass — flagged for a future consistency pass, this file (`OrderFlowPage.tsx`) is now the reference implementation if/when that happens. |

**Terminology fix, same pass:** "Lines" column renamed to "SKUs" — `line_item_count` is standard WMS jargon (1 line = 1 distinct product/variant row) but not self-evident outside that context. "Units" (total quantity, `SUM(oli.quantity)`) kept as-is — "Items" was considered and rejected as a replacement since it's ambiguous with SKUs' own meaning, while "Units" unambiguously means physical pick quantity. Internal `sortField` key remains `'lines'` — only the display label changed.

**Continued (2026-07-02, same session) — Blocked Orders UX:**

| ID | Status | Description |
|---|---|---|
| OF-05 | ✅ FIXED | Blocked Orders category groups had no reveal-more control — either fully visible (unbounded) or fully hidden per category, no in-between. Added the canonical `modules-ux-playbook.md` reveal pattern. **`TRIAGE_PREVIEW_LIMIT` updated app-wide from 4 → 3** (explicit product decision, 2026-07-02) — `modules-ux-playbook.md` itself updated to reflect the new standard; any other surface using the old constant should be reconciled to 3 when next touched. |
| OF-06 | ✅ FIXED | Blocked Orders categories previously defaulted to fully collapsed on page load (`expandedReasons` = empty `Set`, except a deep-linked `?constraint=` param) — flagged live as leaving significant dead space on the card. Now defaults to all-expanded; safe against runaway height because OF-05's reveal cap (3) bounds each category regardless of expand state. `constraintParam`'s special-case auto-expand logic is no longer needed (superseded — everything's already expanded) and was removed. |
| OF-04-DUP | 🟢 CONFIRMED LIVE, VISIBLE CONSEQUENCE OF #1035 | With categories now expanded by default, OF-04's duplicate-card bug (order `#16953881428338` rendering twice) is now immediately visible on page load rather than requiring a manual expand — makes fixing #1035 more urgent, doesn't change its root cause or fix plan. |

**Not yet started — the bigger question, workshopped but not built (2026-07-02):** Blocked-order cards are still fully inert — no `onClick`, no path from "here's why this order is blocked" to actually resolving it. Explicit product framing: an "Open in Shopify" escape-hatch CTA was considered and deliberately scoped as **secondary-only, never primary** — sending operators out of the app to fix a common block type undermines the core retention thesis (LaSyncro as the single workbench vs. another tab in an already-fragmented SMB toolchain). Real opportunity identified: `resolve_customer_block.handler.ts`'s own header documents it as an intentional manual-action placeholder ("no system-side execution... Prevent execution failure, Maintain lifecycle consistency") — not a stub, a deliberate acknowledgment that a human must act. Since `orders.shipping_*` (name/address1/2/city/zip/phone/province/countryCode) is already flowing into the Order Detail modal as of today's earlier work, an in-app "edit shipping address" form is a real, scoped, buildable resolution path for `customer`/`incomplete_address` blocks specifically — reusing the existing entity-modal infrastructure rather than a new surface. Not started; blocked on #1035 being fixed first so the click-through isn't built against duplicated data.

**Audit continues** — next: confirm whether the known §5 scoping gap (header totals not reflecting active deep-link filters, no visible filter-active chip) still reproduces, since it was logged but not fixed as of the 2026-06-28 revision.