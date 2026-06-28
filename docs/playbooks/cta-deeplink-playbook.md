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
| ORD-01 | 🔴 **STILL OPEN** | `OrdersModuleFT2.tsx` "View all orders →" still points at bare `/orders`. Same fix as OV-04 (→ `/orders/flow`), never actually applied — tracked but not yet done. See `entity-detail-modal-playbook.md` §2 for ORD-02 (removed) and ORD-03 (the real entity-modal trigger work), found in the same file during the Orders modal investigation. |
| AHA-01 | 🟡 OPEN, parked | `aha.controller.ts` Signal 3 "Revenue concentration" → `/orders?filter=revenue_concentration`, fully orphaned, different feature surface (customer analytics). |
| **CASH-01** | 🔴 **NEW, OPEN** | `CashFlowModuleFT2.tsx`'s `atRiskRevenue` chip hardcodes `href="/orders?filter=blocked"` — a frontend-constructed link, violating §1's core principle. Doubly stale now: wrong route (`/orders`, not `/orders/flow`) and wrong param shape (`filter=blocked` isn't read by anything — Order Flow reads `constraint`/`urgency`). Same class of bug as OV-02/OV-04 (frontend hand-writing a path), found but not yet fixed. |
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

**Newly surfaced, not yet scheduled:** CASH-01 (hardcoded stale link), ORD-01 (still genuinely unfixed despite being tracked since 2026-05-28), CATALOG-GAP (future feature).

Parked, separate track: Alerts-in-sidenav placement (Option A/B/C).