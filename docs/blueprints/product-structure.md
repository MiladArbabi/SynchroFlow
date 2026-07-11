# LaSyncro — Product Structure
>
> **Status:** Target structure v1 (2026-07-07) + Reconciliation pass v1.1 (2026-07-08).
> **Source:** Full-app screen audit (33 screens, 68 logged findings) workshopped against ICP → v1. AUDIT-mode codebase verification (53 issues, ISS-001–053) against live code/DB → v1.1 reconciliation (§10, §11, §8 corrections, §9 additions).
> **Purpose:** The canonical reference for IA, naming, routing, and the signal system. All refactors converge on this document.
> **Reading order for new contributors:** §1-9 = target design (v1, screen-audit-derived). §10-11 = ground truth (v1.1, code-verified) — read these BEFORE proposing any change to §4/§5, since several v1 assumptions (e.g. "delete /alerts") were corrected here. Where §1-9 and §10-11 conflict, §10-11 wins until §1-9 is explicitly updated.

---

## 1. ICP & Personas

**ICP:** SMB commerce operators running their own storage/warehouse fulfillment.

- Team: owner/admin(s) + 1–20 operators
- Revenue: $100K – $50M/year
- Pain: data fragmentation, data silos, spreadsheet chaos, daily firefighting
- Defining trait: **high SKU complexity** — every fragmentation pain is multiplied per SKU

**Core job-to-be-done:** *"Stop reconstructing my business every morning. Tell me what's true, what's burning, and what to do — in one place I can trust."*

### Personas

| Persona | Count | Mode | Needs | Surface |
|---|---|---|---|---|
| **Owner / Admin** | 1–3 | Decides | Money-truth, ranked priorities, one queue | Owner Console (web) |
| **Operator** | 1–20 | Executes | Scanner, task list, zero decisions | Floor (mobile + web scan station) |
| **Supervisor** | 0–3 (emerges ~$1M / 5+ ops) | Resolves | Exception triage between floor and owner | Problem Center + Warehouse Analytics |

### Scale gradient

Same skeleton at $100K and $50M — **progressive disclosure, not two products.**

- $100K: owner *is* the operator → Floor reachable from Console, supervisor surfaces quiet.
- $50M: shifts, multiple supervisors, multiple floors → role-based routing, Problem Center prominent.

---

## 2. Design Principles

1. **One signal spine.** Exactly one exception/decision/alert object in the system. Every queue, badge, and "needs attention" block is a *view* of it. Acting anywhere updates everywhere.
2. **One fact, one number.** Every money/stock figure traces to the event ledger. If two screens show different numbers for one concept, that is a P0 bug, not polish. Definitions live in the Vocabulary (§7).
3. **Persona lenses, not persona products.** Owner Console / Floor / Supervisor are role-routed views over one system. Scan actions never sit on decision pages; decisions never sit on scan surfaces.
4. **Consequence-ranked, always.** Every queue is ranked by commercial consequence ($ at stake). Ranking language is identical everywhere: *"Ranked by commercial consequence."*
5. **Trust is a surface.** Sync freshness, data coverage, and the audit trail are first-class UI (Data Trust) — the visible proof of the event-sourced ledger.
6. **Loops, not pages.** The three must-have loops (§6) are wired end-to-end. No step exits to a spreadsheet.

---

## 3. The Signal Spine

**One object:** `Signal`

```
Signal {
  severity:    critical | warning | info        // positives NEVER carry severity — no "all-clear" alerts
  category:    revenue-at-risk | stock-reorder | money-margin |
               supplier-inbound | warehouse-floor | data-trust | returns-recovery
  scope:       owner | supervisor | operator     // which lens surfaces it
  consequence: $ at stake (drives ranking; recommended qty/amount never 0 on a critical)
  lifecycle:   open → assigned → snoozed → resolved
               // resolved = auto when condition clears, or manual with reason
               // "Acknowledge" is removed as a concept — replaced by assign
  actions:     go-to (canonical deep link) | assign | snooze | resolve
}
```

**Views of the spine (there are no other exception systems):**

| View | Filter | Location |
|---|---|---|
| **Today queue** | scope=owner, all categories, ranked by consequence | Today page |
| **Module "Needs attention"** | scope=owner, category=module's | Top of each module |
| **Problem Center** | scope=supervisor (pick/pack/stow/receive exceptions) | Warehouse module |
| **Bell popover** | recent signals, compact | Global header |
| **Signal history** | lifecycle=resolved | Data Trust |

**Deleted:** Alerts as a hidden nav module (`/alerts` Inbox/Snoozed/Resolved/Rules). Rules → Settings › Notifications. Snoozed/Resolved → filters on the spine views.

**Counts:** header badge = open signals, scope=owner. "N decisions pending" on Today = the same number. They can never disagree because they query the same table.

---

## 4. Module Map & Routing

```
◱   Today          /today
🛍   Orders         /orders            · Queue | Flow | Outbound | detail: /orders/:id
📦   Inventory      /inventory         · Demand & Reorder | Catalog | Costs
🏭   Warehouse      /warehouse         · Operations | Floor Plan | Problem Center | Analytics
↩    Returns        /returns           · Recovery Queue | Items
🚚   Suppliers      /suppliers         · Purchase Orders | Suppliers | Sourcing
$    Finances       /finances          · Margin | Cash Flow
──────────────────────────────────────
🛡   Data Trust     /data-trust        · Sync Health | Coverage | Count Trust | Audit Trail
⚙   Settings       /settings          · Workspace | Warehouse | Data & Sync | Notifications | Team
```

### Routing convention (hard rules)

- Every sub-surface nests under its module: `/warehouse/floor-plan`, `/finances/cashflow`, `/inventory/demand`. **No sub-tab escapes its parent route.**
- Breadcrumb always shows full path: `Workspace / Warehouse / Floor Plan`.
- **Tab label = breadcrumb segment = page H1.** One name per surface, everywhere.
- Module landing tab is always named after its content (e.g. "Queue"), never the module name repeated.

### Key moves from current state

| Move | Kills findings |
|---|---|
| Overview → **Today** (the daily ritual: queue + pulse + Export Brief) | #53–55 |
| Alerts module dissolved into spine; Rules → Settings | #54, 63–65 |
| Problem Center: Returns → **Warehouse** | #16, 17 |
| Data Quality + Readiness + "Data trust" → one **Data Trust** module (promoted to nav) | #36, 62 |
| Supplier scorecard unified (on-time + fill + return-rate + suspect batch on ONE card); "Suppliers portal" → **Suppliers** | #37, 38 |
| Inventory leads with **Demand & Reorder**; "Intelligence" content folds into it and Today | #20, 45 |
| Wms/Warehouse/Warehouse floor → **Warehouse** everywhere | #1, 62 |
| Returns loses double tab row; Supplier Ratings content → Suppliers | #17 |

### Persona lenses

- **Role-based routing at login:** operator role → Floor; owner/admin → Today; supervisor → Today with Problem Center pinned.
- **Floor** = existing mobile app (Pick / Pack / Receive / Stow / Scan / Problem reporting) + web scan-station equivalents (current Pack Mode, Scan a Return). These leave the Console pages; owner-operators get a persistent **"Open Floor Station"** affordance instead.
- Supervisor surfaces render quietly for solo owners (collapsed, not hidden).

---

## 5. Module Specs (target state)

### ◱ Today `/today`

The 15-minute morning ritual. **This page IS the alert inbox.**

- Greeting + one-line state: *"N decisions pending — everything else is on track."*
- Signal queue (spine view, scope=owner), grouped Critical / Watch, ranked by consequence, `See N more` collapse.
- Business Pulse sidebar (canonical daily numbers).
- **Export Brief** → shareable owner's daily brief (retention + referral artifact).

### 🛍 Orders `/orders`

- **Queue** — SLA breaches + at-risk orders (spine view), Today's pipeline pulse.
- **Flow** — order pool, batching, fulfillment stages. **Single owner of batch state**; Warehouse Operations reads the same object (kills #3, 5, 6).
- **Outbound** — shipping health, tracking coverage, carrier setup.
- **Order detail `/orders/:id`** — *(NEW, required)* timeline from the ledger: placed → picked (by whom) → packed → shipped → tracking → delivered/returned. Answers the #1 firefight: "where is order X."

### 📦 Inventory `/inventory`

- **Demand & Reorder** *(lead tab)* — stockout risk, coverage days, recommended reorder qty (**never 0 on critical**, #59). Entry point of the Reorder Loop (§6).
- **Catalog** — products/variants, sellable/blocked status (badge logic = sidebar logic, one source, kills #21), zero-stock triage.
- **Costs** — unit cost entry, CSV upload, coverage meter (feeds Data Trust + Finances).

### 🏭 Warehouse `/warehouse`

- **Operations** — active batches, station status. Reads Orders' batch object.
- **Floor Plan** — Map | Setup | Barcodes (badge semantics unified: badges = open problems, counts live in-page, kills #8, 9).
- **Problem Center** — supervisor spine view: short pick, damage, wrong item, stow failure, receive rejection. True-zero empty state ("No open exceptions"), not "no match for filters" (#31).
- **Analytics** — operator performance, stage velocity, stuck-on-floor. n=1-aware empty/small states (#14, 44). One pipeline vocabulary (§7).

### ↩ Returns `/returns`

- **Recovery Queue** — spine view: unclaimed refunds, aging return jobs, high-return-rate SKUs. Ranked by consequence (aging expressed AS consequence).
- **Items** — return jobs → line detail with dispositions: **Restock | Reship | Contact customer | Refund | Write off** (Restock added — closes the "Fix in Returns" promise, #33, 47).
- Supplier return-rate → link to Suppliers, not a duplicate table (#38).

### 🚚 Suppliers `/suppliers`

- **Purchase Orders** — open POs, ETAs, receiving status (web inbound visibility). First-line item preview in collapsed row for at-a-glance identification. ✅ 2026-07-11
- **Suppliers** — unified scorecard: on-time, fill rate, **return rate, suspect batches** — one card per supplier. MOQ + lead-time inline nudges deep-link to Edit dialog. ✅ 2026-07-11
- **Sourcing** — three-tier supplier resolution (explicit preference → PO history scorecard → never-ordered assign flow), MOQ accumulation system, ranked recommendations with "Add to queue" + "Create PO" dual-path, onboarding spotlights. Step 2 of the Reorder Loop. ✅ 2026-07-11

Remaining: PO send flow (Gap 2), signal→accumulator wiring (Gap 1), `total_pos` label fix (Gap 3).

### $ Finances `/finances`

- **Margin** *(lead)* — "Where is profit leaking?" Cost knowledge, leakage, negative-margin orders. Period labels explicit on every figure (kills #43).
- **Cash Flow** `/finances/cashflow` — position, PO commitments, 60-day projection, plan-a-stock-order what-if.
- All CTAs route to real surfaces: "Fix costs" → Inventory › Costs (not "Catalog", not "Products") (#47, 56).

### 🛡 Data Trust `/data-trust` *(promoted — the trust engine)*

- **Sync Health** — per-channel freshness. Replaces the Syncing pill / Online pills / "last synced 6h" trio with one model: `Live | Synced Xm ago | Stale | Error` (#7, 12).
- **Coverage** — costs %, barcodes, bin locations, carrier labels, supplier links. Doubles as **onboarding/activation spine**: week one = drive these to green.
- **Count Trust** — cycle counts, mismatches, phantom inventory.
- **Audit Trail** — the ledger, visible: "stock for SKU X changed at 14:02 — receive job #841 — Operator Dev." The moat, on screen.

### ⚙ Settings `/settings`

Workspace · Warehouse (locations, stations, label printing) · Data & Sync (channels, credentials) · Notifications (alert rules, push/email, per-role) · Team (seats, roles — moves in from nav).

---

## 6. The Three Must-Have Loops

The product is a must-have when all three run end-to-end with no Excel step:

**Loop 1 — The 15-Minute Morning** *(daily · owner)*
`Open Today → ranked queue → act on top 3 → Export Brief`
Requires: spine unification, number reconciliation. *Currently ~80%.*

**Loop 2 — The Reorder Loop** *(weekly · owner · the Excel-killer for high-SKU merchants)*
`Stockout signal → Demand (recommended qty) → Sourcing (pick supplier) → PO → inbound ETA → received → sellable`
One guided flow replacing today's four disconnected entry points (#45, 56). *Currently ~85%.*

Completed 2026-07-11: three-tier supplier preference system (§7), MOQ accumulation system (§8),
never-ordered assign flow, preference CRUD, ranked recommendations, onboarding spotlights,
PO first-line preview, supplier MOQ/lead-time nudges, data quality filtering (ISS-SR-07).

Remaining gaps to reach 100%:
- **Gap 1 (🔴):** Signal→queue not wired — `stockout_risk` alert `needed` qty doesn't auto-fill accumulator. Merchant must visit Sourcing manually.
- **Gap 2 (🔴):** PO send not wired — "Mark as sent" tracks state but merchant re-types PO into email/WhatsApp to actually send it. The Excel re-entry problem lives here.
- **Gap 3 (🟡):** "Lifetime POs: 0" while "6 open POs" badge shows — `total_pos` only counts received POs, label is misleading. Data trust issue.

**Loop 3 — The Floor Loop** *(hourly · operator + supervisor)*
`Task assigned → scan-execute → exception? → Problem Center → supervisor resolves → owner never interrupted`
Requires: persona routing, Problem Center relocation. *Currently ~70%.*

**Substrate for all three:** Data Trust + Vocabulary (§7).

---

## 7. Canonical Vocabulary

**Money glossary** (enforced in every label, tooltip on first use):

| Term | Definition |
|---|---|
| **Refunded** | Cash returned to customers |
| **Recovered** | Value regained via restock/reship |
| **Leaked** | Refunded − Recovered (the true loss) |
| **Blocked** | Revenue held by an operational condition |
| **At risk** | Predicted leakage if no action taken |

*(So "$3,810 refunded / $1,410 recovered / $2,400 leaked" is one story, not three contradictions — #23, 42.)*

**Stock:** `Stocked out` (was: zero stock / stockout risk — pick one, use everywhere). `Blocked stock` always says *stock* to disambiguate from blocked revenue (#22).

**Pipeline (one vocabulary):** `Released → Picking → Packing → Shipped` (+ `Received → Stowed → Sellable` inbound) (#5).

**Actions:** Reorder = **"Create PO"** everywhere (#28, 56). Signal actions = Go to / Assign / Snooze / Resolve.

**Sidebars:** all named **"X Pulse"** (no "Health") (#49).

**Formats:** one currency system (symbol + locale decimals — no "USD260" vs "$600" vs "0,00" mix, #27); one date format app-wide + ISO only in inputs with a hint (#52); one time-range control: `Today | 7d | 30d | 90d | Custom`, fixed position below H1 (#29, 51).

**Voice registers (three, fixed):**

- Module pages → plain nouns ("Orders", "Margin")
- Today → greeting + state sentence
- Money & Trust surfaces → owner-monologue questions ("Where is profit leaking?")
- Aspirational sentence headlines ("Build your warehouse.") → onboarding/empty states only (#15, 50).

---

## 8. Migration Notes (current → target)

**P0 — trust-critical**

1. ~~Signal spine: one table, one lifecycle... Delete `/alerts` module.~~
   **CORRECTED 2026-07-08 (see §10.4):** `alerts` IS the signal spine —
   shipped, working (ALR-01–13, closed sprint 2026-05-30). Do NOT delete.
   Remaining gap: `acknowledge` verb vs this doc's originally-proposed
   `assign` — reconcile terminology, not architecture. Also open:
   `problem_center_tasks` → `alerts` link is convention-coupled on
   `entity_id`, not FK-enforced (§10.4) — hardening candidate.
   **✅ HARDENED (2026-07-08):** the `entity_id` coupling risk flagged above
   was real — audited end-to-end and fixed across three linked bugs, all
   live-verified via curl/psql, not just build-checked:
   - **ISS-030:** `problem_center_tasks` resolve → alert deactivation used
     the wrong ID namespace for pick/receive sources (exception-record id
     vs parent batch/job id). Fixed with a resolve-time join through
     `pick_exceptions`/`receive_exceptions`. Verified for stow/returns/
     manual-endpoint paths.
   - **ISS-065:** the *dedicated* web pick-exception resolve endpoint
     (`httpResolveException`, separate from `problem_center_tasks`
     entirely) had **zero** alert-clearing logic — alerts were orphaned
     permanently, not just mismatched. Fixed + verified live (raised a
     real exception, resolved it, confirmed `alerts.is_active` flipped).
   - **ISS-054:** the generic task-creation endpoint (`httpCreateProblemTask`)
     accepted a client-supplied `source_exception_id` with zero validation
     — confirmed to be the **primary** creation path for 5+ web/mobile call
     sites, not a rare manual fallback. Now validates the source enum and
     verifies the exception row exists and belongs to the shop before insert.
   - **Deferred, not yet fixed:** receive-exception resolution has no
     dedicated endpoint at all (mirrors pick's gap before ISS-065, but
     unresolved) — tracked as GitHub issue **#1039**, scope corrected
     mid-audit once ISS-054's fix revealed a mobile-only creation path
     (`ReceiveJobScreen.tsx`) that may partially close the gap, pending
     live verification.
2. Number reconciliation: Sellable badge vs sidebar (#21); margin period labeling (#43); refunded/leaked split (#42); $3,800-vs-$4k rounding rule (#60); "reorder 0 units" (#59); "$0/wk lost" criticals (#25); "+48% vs prior" on first period (#44).
3. Routing + naming sweep per §4 conventions (~12 findings in one pass). **Confirmed exact sites, 2026-07-08 (§10.2):** `floor-planning` → `/floor-planning` (not `/wms/floor-planning`); `data-quality` → `/wms/readiness` (not`/inventory/*`); `cashflow` → `/cashflow` (not `/finances/cashflow`).
   **Outcome (2026-07-08):** split into three independent items on
   implementation — the three sites did

**P1 — must-have loops**
4. Order detail page.
5. Reorder Loop wiring (Demand → Sourcing → PO → inbound).
6. Persona routing + Floor split; Problem Center → Warehouse; Restock disposition in Returns.
7. Data Trust consolidation (+ audit trail v1: read-only ledger view).

**P2 — polish**
8. Vocabulary/format sweep (§7). 9. Pulse/CTA/time-pill pattern library. 10. Empty & n=1 states (#14, 31, 44). 11. Theme toggle → single control with explicit state (#66).

---

## 9. Open Questions (pressure-test before locking)

- **Multi-warehouse** at the $50M end: Warehouse module assumes one floor — does `/warehouse` become `/warehouse/:location`? Decide before Floor Planrefactor.
- **B2B / wholesale orders:** does Orders need order-type segmentation, ora separate surface?
- **Additional channels** (Amazon, retail POS): Data Trust sync-health is designed per-channel — confirm Orders/Inventory views are channel-aware.
- **Mobile owner experience:** Today is desktop-designed; owners check phones constantly. Mobile Today = P1 or P2?
- **Notifications delivery:** push toggle exists with no destination defined (#65) — mobile app push? email digest? Decide in Settings › Notifications spec.
- **Data Trust promotion — slot is free, unused (added 2026-07-08):** the 8th top-level nav slot freed by the Team relocation (§8 item 3a) is currently empty. §4/§5 propose Data Trust as its occupant, but that work has not started. Decide: promote now, or hold the slot for something else surfaced by §10 (e.g. a consolidated Warehouse entry if Floor Planning/Problem Center formally merge)?
- **Module-package consolidation plan — does not yet exist (added 2026-07-08, see §10.3):** §4's 7-module target presumes merges (`wms`+`floor-planning`+`problem-center` → Warehouse; `cashflow`+`finances` → Finances) that have only been actioned at the nav-routing level, never scoped as module-package work. Needs its own plan before §4 can be called complete.
- **`customers` and `fulfillment` modules — unaccounted for in §4 (added 2026-07-08):** both are live, registered modules with no corresponding entry in the target map. `customers` is confirmed deprecated (analytics/PostHog replacement, per `overview_pulse_and_signal_dedup_2026_06_20.md`) but still routed today — decide sunset timeline. `fulfillment`'s relationship to Orders/Warehouse is undetermined.
- ~~`problem_center_tasks` ↔ `alerts` FK hardening (added 2026-07-08, see §10.4)~~ **✅ RESOLVED (2026-07-08) — see §8 item 1.** Was not FK hardening alone: the audit found three separate, live bugs in this seam (wrong ID namespace, a fully alert-blind resolve path, and an unvalidated client-supplied ID), fixed and verified live via curl/psql. One related gap remains open — receive-exception resolution has no dedicated path — tracked as **GitHub #1039**.
- **Finances product refinement — blocks §8 item 3d and #1040 overlap (added 2026-07-08):** Cash Flow's current content (60-day projection, plan-a-stock-order) was judged during this session as not yet effectively resolving the ICP's core data-fragmentation/Excel-chaos pain. Finances, Cash Flow, and Margin are **frozen** pending a content/product pass — no further routing, nesting, or structural work should land on any of the three until that's decided. This blocks §8 item 3d (the `/cashflow` route nest) indefinitely, and should be resolved before revisiting whether Cash Flow deserves its own module at all vs folding into Finances/Margin.
- **Warehouse shell architecture — GitHub #1040 (added 2026-07-08, see §8 item 3c, §10.3):** confirms the module-package-consolidation open question above is not hypothetical — Warehouse/WMS concretely lacks the shell-page pattern that Products and Finances already have, discovered while attempting the `/floor-planning` route nest. #1040 scopes the fix (new `WmsFT2Page.tsx` shell, mirroring `ProductsFT2Page.tsx`) but is deferred as its own unit of work.

---

## 10. Live System Inventory (added 2026-07-08, IMPLEMENTATION-mode audit)

> This section reconciles §4's target module map against what is actually
> registered in code. It does not replace §4 — §4 remains the target.
> This documents the gap and the real constraints any migration toward
> that target must respect. Source: `apps/frontend/src/runtime/navBootstrap.ts`
> (single source of truth for nav/IA) and `modules/*/src/ui/ModuleEntry.tsx`
> (federated module registry via `vite-plugin-lasyncro-modules.ts`).

### 10.1 Nav is hard-capped at 8 top-level items

`navBootstrap.ts` enforces (by comment convention, not code): *"Max 8
top-level items. Product sign-off required to add more."* Any promotion of
a new top-level item (e.g. Data Trust, §4/§5) requires freeing a slot first.

**Current 8** (post 2026-07-08 Team relocation): `overview, orders,
warehouse, returns-resolution, inventory, purchasing, finances` — **7
occupied, 1 free.** `team` was removed from top-level nav and relocated
into Settings as a tab (see §8 migration log). This is the first
completed step toward §4's target map — the freed slot is available for
Data Trust promotion but **not yet used.**

### 10.2 Live nav tree vs §4 target (as of 2026-07-08)

| Nav id | Title | Path | Module gate | Children |
|---|---|---|---|---|
| `overview` | Overview | `/overview` | `overview` | — |
| `orders` | Orders | `/orders` | `order-nexus` | Overview, Order Flow, Outbound |
| `warehouse` | Warehouse | `/wms` | `wms-lite` | Operations, Floor Planning*, Analytics |
| `returns-resolution` | Returns & Resolution | `/returns` | none (children gate independently) | Returns, Product Issues |
| `inventory` | Inventory | `/inventory` | `products` | Intelligence, Catalog, Demand*, Costs, Data Quality |
| `purchasing` | Purchasing | `/suppliers-portal` | `suppliers-portal` | Open POs, Suppliers, Sourcing |
| `finances` | Finances | `/finances` | `cashflow` | Finances, Cash Flow, Margin |
| ~~`team`~~ | ~~Team~~ | ~~`/team`~~ | — | *relocated to Settings tab, 2026-07-08* |

\* tier-gated — see §11.

**Confirmed alias/naming drift** (predates this audit, not newly introduced):

- Nav id `warehouse` → path `/wms` → module id `wms-lite` → display "Warehouse." Four names, one concept.
- `returns-resolution`'s children mix Returns (`/returns`) and Product Issues (`/problem-center`) under one parent, gated by *different* server-side module keys (`returns:*`, `wms:read`) — this is the misfiling §4/§5 already targets fixing (Problem Center → Warehouse). Confirmed in code comment referencing prior tracked issues **#38/#39** (already in this doc, §5 and §4 respectively — not new numbers, cross-referenced from live code).
- Three routes escape their parent nesting, contradicting §4's routing convention: `floor-planning` child path = `/floor-planning` (not `/wms/floor-planning`); `data-quality`

### 10.3 Federated modules vs nav items — not 1:1

Nav items are declared centrally in `navBootstrap.ts`. Modules are
**independently registered packages** (`modules/*/src/ui/ModuleEntry.tsx`,
scanned by `vite-plugin-lasyncro-modules.ts`), each exporting only
`{id, name, version}` — no route/nav data. **14 modules are currently
registered:**
customers · wms · products · fulfillment · cashflow · suppliers-portal ·
alerts · order-nexus · problem-center · returns · floor-planning ·
finances · demand · overview

Several of these are *not* independent top-level nav destinations — they
are mounted as nav children (`demand`, `floor-planning`, `cashflow`,
`problem-center` all confirmed to have no stray/dormant nav registration
of their own — clean). But §4's 7-module *target* map presumes a
consolidation (e.g. `wms` + `floor-planning` + `problem-center` → one
"Warehouse" module; `cashflow` + `finances` → one "Finances" module) that
**has not been scoped as package-level work.** §8's migration notes are
nav/route-level only. A module-package consolidation plan is a
prerequisite for §4 to be fully realized, not just a nav relabel.

`customers` and `fulfillment` are registered modules with **no
corresponding entry in §4's target map at all** — `customers` is
confirmed deprecated in favor of analytics/PostHog (per
`overview_pulse_and_signal_dedup_2026_06_20.md` §1.1) but is still a live
routed module today. `fulfillment`'s relationship to Orders/Warehouse is
undetermined — needs scoping before §4 can be called complete.

### 10.4 The signal spine — already closer to §3 than assumed

§3 proposes a single `Signal` object. Live architecture already has this,
under the name `alerts` (migration `0079_create_alerts_table.ts`,
`AlertsModule.md`, sprint ALR-01–13, **shipped and closed 2026-05-30**):
consequence taxonomy (§3's `category`), commercial-consequence severity
(§3's `severity`), audience scoping (§3's `scope`), and a lifecycle
already at acknowledge/snooze/resolve — one verb short of §3's proposed
assign/snooze/resolve (`acknowledge` vs `assign`, open gap, not yet
reconciled).

**Confirmed NOT duplicate systems** (§3 implies these should collapse
into one spine — audit found they are legitimately different altitudes,
not redundant):

- `decisions` table — order-execution-scoped only (recommended fix +
  constraint-staleness check for one order), consumed by
  execute/constrained/decision-by-order controllers. Never read by the
  brief/alerts layer. Correctly one layer *below* the spine, not beside it.
- `overviewMorningBrief.resolver.ts` (Today's queue) reads **exclusively**
  from `alerts` — confirmed via explicit code policy comment: *"Never
  query raw tables here — always read from `alerts`."* §3's "Today queue
  is a view of the spine" is **already true**, not aspirational.

**Confirmed real gap** (§3-relevant, not yet fixed): `problem_center_tasks`
→ `alerts` linkage is convention-based (`alerts.entity_id =
problem_center_tasks.source_exception_id`), not FK-enforced. A drift
between the two services' ID assignment would silently orphan or
mis-clear alerts. Candidate for a follow-up implementation task.

---

## 11. Tier Gating Map (added 2026-07-08 — absent from original doc)

> §4/§5 propose IA changes with zero mention of tier gating, which is a
> live monetization mechanism in `navBootstrap.ts`. Any module
> consolidation, rename, or promotion **must preserve or deliberately
> redesign** this map — it is not cosmetic.

| Gate | Scope | Tier required |
|---|---|---|
| `returns-resolution` (whole nav item) | Returns & Resolution | `core` |
| `floor-planning` (Warehouse child) | Floor Plan | `scale` |
| `demand` (Inventory child) | Demand & Reorder | `growth` |
| `finances` (whole nav item) | Finances | `growth` |

Confirmed from `ShopSettingsPage.tsx` / Billing tab: live plan tiers are
**Growth ($349/mo shown as upgrade target from current plan) and Scale**,
consistent with `core → growth → scale` ordering above. §5's Data Trust
spec (Coverage as "onboarding/activation spine") and §4's proposed
Warehouse consolidation (folding Floor Plan in) should state explicitly
which tier gates apply post-consolidation — currently unstated.

---

*Appendix: full 68-item findings log lives in the audit thread; item numbers referenced above (#N) map to that log.*
