# LaSyncro — CTA Deep-Link & Cascade Playbook

> **Scope:** The cross-module deep-link contract — how a signal (alert, decision card, CTA) becomes a working navigation to a *specific, pre-filtered* destination. Owns the shared `DEEP_LINK_MAP`, the alert-type → param → destination table, the urgency/constraint filter dimensions, and the entity-precision gap.
> **Companion docs:** `docs/playbooks/modules-ux-playbook.md` (CTA visual tiers/colors — this doc does not duplicate that), `docs/playbooks/overview-module-playbook.md` (Overview's data pipeline + AL-01 trigger rules — this doc consumes that table, doesn't redefine it), `docs/blueprints/constraint_system_blueprint.md` (`order_constraints` schema truth).
> **Created:** 2026-06-27, from a full audit of Overview's outbound CTAs and every destination they target.
> **Status legend:** ✅ done & verified · 🔴 open · 🟡 open, lower priority · 🔵 design decided, not yet implemented

---

## 1. The Principle

Stated once already in the codebase (`useMorningBriefSnapshot.ts`), and this doc exists to make it actually true everywhere:

> **Deep links are backend-generated. The frontend never constructs them.**

Two violations of this principle are what caused most of tonight's findings — not missing features, but components quietly hand-writing a path instead of using the one the backend already sends.

---

## 2. Architecture (current + planned)

alerts table (AL-01 aggregator — see overview-module-playbook.md §2 for full trigger rules)

│

▼

DEEP_LINK_MAP   lives in overviewMorningBrief.resolver.ts
     │            ✅ aha.controller.ts is a SEPARATE pipeline, does not consume this map
     │               (confirmed 2026-06-27 — see §3, was misregistered as OV-08 duplication)
     │            🔵 OPTIONAL: extract to its own module for hygiene if a real second
     │               consumer ever appears — not currently blocking on anything

▼

signal.deepLink (string, e.g. "/orders/flow?constraint=inventory&urgency=overdue")

│

▼

Frontend onNavigate(signal.deepLink) — TriageRow, BusinessPulse, etc.

│

▼

Destination page reads useSearchParams() and actually filters

🔴 Most destinations don't do this yet — see §4

---

## 3. Canonical alert_type → deep link table

Cross-referencing AL-01's verified trigger rules (`overview-module-playbook.md` §2) against the current `DEEP_LINK_MAP`. This is the **corrected** version — see §5 for what's wrong with the current code.

| `alert_type` (AL-01 canonical) | Severity | Trigger | Current deepLink (as of pre-Phase-2) | Correct destination | Filter dimension |
|---|---|---|---|---|---|
| `sla_breach` | critical | shipping/delivery SLA breach (age snapshot) | `/orders?filter=sla_breached` | `/orders/flow` | **urgency** — maps onto existing `CptBucket.overdue` (see `blockedBucket()` in `OrderFlowPage.tsx`) |
| `operational` | critical | paid + unfulfilled + `age_since_paid ≥ fulfillment_sla_hours×3600` (default **24h**) | `/orders?filter=aging_72h` ⚠️ | `/orders/flow` | **urgency** — likely also `overdue`, see open question below |
| `inventory` | warning | no sellable bin-type stock for variant | `/orders?filter=out_of_stock` | `/orders/flow` | **constraint** — `constraint_type='inventory'` accordion section |
| `customer` | warning | active customer constraint | `/orders?filter=address_issue` | `/orders/flow` | **constraint** — `constraint_type='customer'` accordion section |
| `revenue_at_risk` | warning | from `orders_operational_control_snapshot` | `/cashflow?filter=constrained` ✅ (Phase 0 fixed) | `/cashflow` | none yet — page doesn't read params |
| `missing_cogs` | warning | active order has variant with `unit_cost=0`/null | `/finances?filter=missing_cogs` ✅ (Phase 0 fixed) | `/finances` | none yet — page doesn't read params |
| `stockout_risk` (demand) | — | — | `/demand?filter=critical` | `/demand` | none yet — page doesn't read params |
| `wms_*` (7 types) | — | — | `/wms?filter=...` | `/wms` | **mismatch** — see §6, `WmsPage.tsx` reads entity-ID params, not category filters |

### ✅ RESOLVED — `operational` → `aging_72h` naming collision (was OV-08)

Originally flagged as "OV-08: duplicate hardcoded copy in `aha.controller.ts`." That framing was **wrong** — corrected 2026-06-27. `aha.controller.ts`'s Signal 4 ("Fulfilment gap") is a completely separate, standalone signal pipeline (its own header: *"all signals derived from existing snapshots"*) that queries `orders_operational_control_snapshot.aging_72h_plus` **directly** — a genuine, correctly-named absolute-age-≥72h metric. It was never reading `DEEP_LINK_MAP` or `alert_type` at all. There was no duplicate to extract.

The actual bug was a **naming collision**: the resolver's `operational` alert_type (AL-01's 24h fulfillment-SLA rule) happened to reuse the literal string `aging_72h` for its filter slug — an unrelated number that just sounded similar. Fixed by renaming the resolver's slug only, to `fulfillment_sla_breach`. `aha.controller.ts`'s `/orders?filter=aging_72h` was correct all along and was **not** touched.

**Still open, deferred to Phase 2:** there are now three distinct order-aging concepts that may each need their own urgency bucket on `/orders/flow`:

1. `sla_breach` → capacity-relative `overdue` (existing `CptBucket`, UI already built)
2. `operational` (24h fulfillment SLA, now `fulfillment_sla_breach`) → bucket still undecided
3. `aging_72h_plus` (Aha's, absolute ≥72h) → no filter mechanism exists for this on Order Flow yet; data (`age_since_creation_seconds`) is already present on blocked orders, so this is a design decision, not a missing-data problem

---

## 4. Issue Register

| ID | Status | Description |
|---|---|---|
| OV-01 | 🔴 OPEN | `/orders/flow` (`OrderFlowPage.tsx`) doesn't read any URL params yet — `cptFilter` is click-state only. Needs `useSearchParams` for both `constraint` and `urgency`. |
| OV-02 | ✅ FIXED | `onResolveAll` was a fully dead prop (zero consuming UI) — removed from `OverviewModuleFT2.tsx` and `OverviewFT2Page.tsx`. |
| OV-03 | 🔴 OPEN | `FinancesIntelligencePage.tsx` has zero param-reading capability. |
| OV-04 | ✅ FIXED | Overview's "View order flow →" now points at `/orders/flow` instead of bare `/orders`. |
| OV-05 | ✅ FIXED | `DEEP_LINK_MAP` typo `/cash-flow` → `/cashflow` corrected. |
| OV-06 | ✅ FIXED | `?focus=missing_cogs` standardized to `?filter=missing_cogs`. |
| OV-07 | 🟡 OPEN | `WmsPage.tsx` already has working deep-link support, but for **entity IDs** (`stowTaskId`, `batchId`, etc.), not the category filters (`?filter=stow_pending`) that `DEEP_LINK_MAP` emits for the 7 `wms_*` alert types. Two contracts, don't speak to each other. Likely resolved by Phase 5 (entity_id), not before. |
| OV-08 | ✅ FIXED (reframed) | Was misregistered as a duplicate emitter. Actually a naming collision between two unrelated metrics sharing one string — see §3. Resolved by renaming the resolver's `operational` slug to `fulfillment_sla_breach`; `aha.controller.ts` required no change. |
| AHA-01 | 🟡 OPEN, parked | `aha.controller.ts` Signal 3 ("Revenue concentration") emits `deepLink: '/orders?filter=revenue_concentration'` — orphaned, not in any constraint/urgency dimension, not in `DEEP_LINK_MAP`. Different feature surface (customer concentration analytics), not a time/urgency concept — park separately from the Order Flow filter work. |
| ORD-01 | 🟡 OPEN (pre-existing, tracked since 2026-05-28 in `modules-ux-playbook.md`) | `OrdersModuleFT2.tsx` line ~624, "View all orders →" navigates to bare `/orders` — same root cause as OV-04/OV-01: there is no order list at `/orders` (it's an executive-summary surface by design). Needs to point at `/orders/flow`. |
| PHANTOM-01 | 🔴 OPEN | Phantom stock (`on_hand < 0`, sold without recorded receiving) is correctly computed, severity-scored, and has a working in-module CTA (`ProductsCatalogPage.tsx` → `/orders/inbound`) — but never reaches `alerts`. Invisible to morning brief / Overview entirely. |
| ENTITY-01 | 🔴 OPEN, foundational | `alerts.aggregator.ts` writes `entity_id: null`, `entity_type: 'shop'` on every alert emission site, with no exception found. No alert can ever deep-link to a specific order/batch/SKU until this changes — only to a filtered category list. |

---

## 5. Two filter dimensions on `/orders/flow` — design

`OrderFlowPage.tsx` already has the machinery for both; neither is wired to the URL yet.

| Param | Values | Existing mechanism to reuse |
|---|---|---|
| `constraint` | `inventory` \| `customer` \| `operational` | `blockedByReason` grouping — auto-expand the matching accordion section (`expandedReasons` state) on mount |
| `urgency` | `overdue` (possibly also a distinct value for AL-01's `operational`, pending the open question in §3) | `blockedBucket()` — already collapses `is_shipping_sla_breached` into `'overdue'` for badges; promote to an actual filter predicate |

Both params are independent and can combine (e.g. `?constraint=inventory&urgency=overdue` — inventory-blocked orders that are also SLA-breached).

---

## 6. Known gaps (bigger than a wiring fix)

- **`OV-07`** — WMS alerts need entity-level params (`stowTaskId`, `batchId`...), but `alerts.aggregator.ts` doesn't carry entity references (see `ENTITY-01`). Can't fully resolve OV-07 until ENTITY-01 is addressed.
- **`ENTITY-01`** — the ceiling on this entire system. Every alert is shop-level today (`entity_type: 'shop'`, `entity_id: null`), regardless of type. Category-filtered lists are the practical limit until this changes.
- **`PHANTOM-01`** — also has no `entity_id`-equivalent today; even once wired into alerts, it can only point at "go check receiving," not a specific SKU, unless `ProductsOperatorFacts.service.ts` is extended with a `phantomProducts` detail array (same shape as its existing `noSkuProducts`).

---

## 7. Procedure — adding a new alert's deep link correctly

1. Add the `alert_type` to AL-01's aggregator with real `entity_id`/`entity_type` if at all possible — don't perpetuate the `null`/`'shop'` pattern if the entity is known at write time.
2. Add the entry to the **shared** `DEEP_LINK_MAP` (post-Phase-1: `apps/backend/src/services/alerts/deepLinkMap.ts`) — never hardcode a path in a controller or a frontend component.
3. Pick real filter param names that match what the destination page already reads (check first — don't invent a new query-param convention per alert type).
4. Confirm the destination page actually has `useSearchParams` wired for that param — if not, that's a second piece of work, not assumed-free.
5. Verify the param values match the actual destination data model (e.g. `constraint_type`'s real enum), not an alert-taxonomy name that sounds similar but isn't the same field.
6. Update §3's table in this doc in the same commit.

---

## 8. Phase plan (sequencing, as of 2026-06-27)

- **Phase 0** ✅ — Resolver typos, dead prop, OV-04. Done.
- **Phase 1** ✅ — Revised from "extract DEEP_LINK_MAP" (no second consumer existed — see §3) to "fix the `operational`/`aging_72h` naming collision." Done — slug renamed to `fulfillment_sla_breach`. Extracting `DEEP_LINK_MAP` to a shared module remains an optional hygiene improvement, not currently blocking on anything — revisit only if a real second consumer appears.
- **Phase 2** 🔴 — `OrderFlowPage` reads `constraint` + `urgency` from URL (§5); resolve the 3-way urgency bucket design (`overdue` / `fulfillment_sla_breach` / `aging_72h_plus`, see §3); point all 4 order alert types + ORD-01 at `/orders/flow`.
- **Phase 3** 🔴 — Wire `useSearchParams` into `CashFlowPage`, `DemandPage`, `FinancesIntelligencePage`.
- **Phase 4** 🔴 — Promote phantom stock into `alerts` (PHANTOM-01).
- **Phase 5** 🔴 — `ENTITY-01` — populate real `entity_id`/`entity_type` on alert emission.

Parked, separate track: Alerts-in-sidenav placement (Option A/B/C — bell icon vs. 9th nav item vs. fold into Overview). Revisit once Phase 4–5 make the signal layer richer.
