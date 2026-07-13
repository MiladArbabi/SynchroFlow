# LaSyncro — Product Structure
>
> **Status:** Target structure v1 (2026-07-07) + Reconciliation pass v1.1 (2026-07-08) + Warehouse context contract v1.2 (2026-07-11) + Full-screen audit v2 register v1.3 (2026-07-11, §12).
> **Source:** Full-app screen audit (33 screens, 68 logged findings) workshopped against ICP → v1. AUDIT-mode codebase verification (53 issues, ISS-001–053) against live code/DB → v1.1 reconciliation (§10, §11, §8 corrections, §9 additions). Multi-warehouse schema and write-path implementation audit → v1.2 warehouse identity, routing, selection, settings, and tier contract.
> **Purpose:** The canonical reference for IA, naming, routing, warehouse context, and the signal system. All refactors converge on this document.
> **Reading order for new contributors:** §1–9 defines the target product design. §10–11 records code-verified ground truth and migration constraints. Read §10–11 before proposing changes to §4/§5. Where target and live implementation differ, the live-system sections describe the current constraint while the target sections define the intended destination.

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

- $100K: owner *is* the operator → Floor reachable from Console, one default warehouse selected automatically, supervisor surfaces quiet.
- $50M: shifts, multiple supervisors, multiple warehouses and floors → role-based routing, explicit warehouse context, Problem Center prominent.

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
🏭   Warehouse      /warehouse         · Warehouse selector → Operations | Floor Plan | Problem Center | Analytics
↩    Returns        /returns           · Recovery Queue | Items
🚚   Suppliers      /suppliers         · Purchase Orders | Suppliers | Sourcing
$    Finances       /finances          · Margin | Cash Flow
──────────────────────────────────────
🛡   Data Trust     /data-trust        · Sync Health | Coverage | Count Trust | Audit Trail
⚙   Settings       /settings          · Workspace | Warehouse | Data & Sync | Notifications | Team
```

### Routing convention (hard rules)

- Every sub-surface nests under its module: `/warehouse/:warehouseId/floor-plan`, `/finances/cashflow`, `/inventory/demand`. **No sub-tab escapes its parent route.**
- `warehouseId` is the stable warehouse UUID. Editable names and compatibility location codes are display values, never route identities.
- `/warehouse` is the module entry route. It resolves to the user's last valid warehouse selection, then the shop's active default warehouse.
- If neither selection can be resolved, `/warehouse` renders a clear warehouse-not-configured state. It must not silently select an arbitrary warehouse.
- Warehouse operational routes use:
  - `/warehouse/:warehouseId/operations`
  - `/warehouse/:warehouseId/floor-plan`
  - `/warehouse/:warehouseId/problem-center`
  - `/warehouse/:warehouseId/analytics`
- Breadcrumb always shows the display name while retaining the UUID route: `Workspace / Main warehouse / Floor Plan`.
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
- **Order detail** — `EntityDetailModal` on order click. Shows line items, customer, payment summary, pipeline status, timeline, constraints, pick exceptions, pack decisions, shipping address correction. ✅ 2026-07-11

### 📦 Inventory `/inventory`

- **Demand & Reorder** *(lead tab)* — stockout risk, coverage days, recommended reorder qty (**never 0 on critical**, #59). Entry point of the Reorder Loop (§6).
- **Catalog** — products/variants, sellable/blocked status (badge logic = sidebar logic, one source, kills #21), zero-stock triage.
- **Costs** — unit cost entry, CSV upload, coverage meter (feeds Data Trust + Finances).

### 🏭 Warehouse `/warehouse`

The Warehouse shell always operates within one explicit `warehouse_id` context.

- **Warehouse selector** — displays the editable warehouse `name`, stores the last valid selection, and changes every child tab and query together. UUIDs and root location codes are never shown as the primary label.
- **Operations** `/warehouse/:warehouseId/operations` — active batches and station status for the selected warehouse. Reads Orders' batch object rather than creating a second batch state.
- **Floor Plan** `/warehouse/:warehouseId/floor-plan` — Map | Setup | Barcodes for the selected warehouse. Owns physical zones, lanes, shelves, bins, coordinates, location barcodes, and capacity. Badge semantics remain unified: badges represent open problems; counts live in-page.
- **Problem Center** `/warehouse/:warehouseId/problem-center` — supervisor spine view scoped to the selected warehouse: short pick, damage, wrong item, stow failure, receive rejection. True-zero empty state ("No open exceptions"), not "no match for filters."
- **Analytics** `/warehouse/:warehouseId/analytics` — operator performance, stage velocity, and stuck-on-floor signals for the selected warehouse. Small-sample states remain n=1-aware and use the canonical pipeline vocabulary (§7).
- Every request must validate that the warehouse belongs to the authenticated shop. Once warehouse membership is introduced, the same resolution layer must also validate user access.
- Missing, inactive, or inaccessible warehouse IDs fail explicitly. APIs must not fall back to another warehouse behind the user's request.
- The active default warehouse is used only when the user enters through `/warehouse` without a valid remembered selection.

Warehouse management and floor topology are separate responsibilities:

- Warehouse identity, name, default status, activation, external-channel mapping, stations, printers, and warehouse-level defaults belong in **Settings › Warehouse**.
- Physical location hierarchy and floor layout belong in **Warehouse › Floor Plan**.

### ↩ Returns `/returns`

- **Recovery Queue** — spine view: unclaimed refunds, aging return jobs, high-return-rate SKUs. Ranked by consequence (aging expressed AS consequence).
- **Items** — return jobs → line detail with dispositions: **Restock | Reship | Contact customer | Refund | Write off** (Restock added — closes the "Fix in Returns" promise, #33, 47).
  Restock is condition-gated: available only when inspected condition permits resale. When gated, renders disabled with inline reason ("Unavailable — item marked damaged at receiving") — never hidden. Gate keys off operator's inspection condition, not customer-reported return reason (ISS-257, resolved 2026-07-12).
- Supplier return-rate → link to Suppliers, not a duplicate table (#38).

### 🚚 Suppliers `/suppliers`

- **Purchase Orders** — open POs, ETAs, receiving status (web inbound visibility). First-line item preview in collapsed row for at-a-glance identification. ✅ 2026-07-11
- **Suppliers** — unified scorecard: on-time, fill rate, **return rate, suspect batches** — one card per supplier. MOQ + lead-time inline nudges deep-link to Edit dialog. ✅ 2026-07-11
- **Sourcing** — three-tier supplier resolution (explicit preference → PO history scorecard → never-ordered assign flow), MOQ accumulation system, ranked recommendations with "Add to queue" + "Create PO" dual-path, onboarding spotlights. Step 2 of the Reorder Loop. ✅ 2026-07-11

Remaining: none. All gaps closed 2026-07-11.

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

Workspace · Warehouse · Data & Sync · Notifications · Team.

**Settings › Warehouse** owns:

- Create and rename warehouses
- Set the active default warehouse
- Activate or deactivate warehouses
- Manage external-channel location mappings
- Configure warehouse-level stations, printers, labels, and defaults

Renaming a warehouse changes only its user-facing `name`. It never changes `warehouse_id`, `root_location_code`, location codes, or operational references.

---

## 6. The Three Must-Have Loops

The product is a must-have when all three run end-to-end with no Excel step:

**Loop 1 — The 15-Minute Morning** *(daily · owner)*
`Open Today → ranked queue → act on top 3 → Export Brief`
Requires: spine unification, number reconciliation. *Currently ~80%.*

**Loop 2 — The Reorder Loop** *(weekly · owner · the Excel-killer for high-SKU merchants)*
`Stockout signal → Demand (recommended qty) → Sourcing (pick supplier) → PO → inbound ETA → received → sellable`
*Currently 100%. ✅ All gaps closed 2026-07-11.*

Completed 2026-07-11: three-tier supplier preference system (§7), MOQ accumulation system (§8),
never-ordered assign flow, preference CRUD, ranked recommendations, onboarding spotlights,
PO first-line preview, supplier MOQ/lead-time nudges, data quality filtering (ISS-SR-07).

Remaining gaps to reach 100%:

- **Gap 1 (✅ closed 2026-07-11):** Signal→queue wired — `?needed=N` from alert flows into accumulator. "Add to queue →" has loading + success flash states. Scorecard shows only populated fields; "No order history yet" when all null.
- **Gap 2 (✅ closed 2026-07-11):** PO send flow — copy-only `SendPoModal`, "Mark as sent" ghost button, `poSendFlow` spotlight wired end-to-end. Status never auto-transitions.
- **Gap 3 (✅ closed 2026-07-11):** "Lifetime POs" label corrected to "Received POs" — matches `total_pos` counter semantics.

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

**Queue segmentation control** (named exception to time-range control, ISS-215 resolved 2026-07-12): operational work-queue surfaces use a separate segmentation pill pattern — first pill is always the action state (e.g. "Needs action"), remaining pills are scope expanders, last pill is "All" (not "All time" — it is a scope, not a range). Rule: time-range control = analytics surfaces (Pulse sidebars, Analytics tabs, Margin); queue segmentation control = operational queues whose rows are actionable work items. Never both on one surface — if a screen needs both, it is two surfaces fused together and must be split.

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
   **EXPANDED 2026-07-11 (§12 audit v2):** 14 further cross-surface contradictions
   confirmed on live screens (ISS-201–204, 208, 217–219, 232, 238–241, 248, 253–254).
   Root cause per §12.3: surfaces aggregate from raw tables independently — adopt the
   morning-brief resolver's "never query raw tables" policy app-wide before fixing
   individual counts. This item is now workstream **W1**.
3. Routing + naming sweep per §4 conventions (~12 findings in one pass). **Confirmed exact sites, 2026-07-08 (§10.2):** `floor-planning` → `/floor-planning` (not `/wms/floor-planning`); `data-quality` → `/wms/readiness` (not`/inventory/*`); `cashflow` → `/cashflow` (not `/finances/cashflow`).
   **Outcome (2026-07-08):** split into three independent items on
   implementation — the three sites did

**P1 — must-have loops**
4. ~~Order detail page.~~ **✅ CLOSED 2026-07-11 (ISS-OD-01, ISS-OD-02):** Modal is primary order detail surface. `PackDecisionHistory` merged into `OrderDetailModalBody`. `OrderDetailPage.tsx` removed, route deleted.
5. Reorder Loop wiring (Demand → Sourcing → PO → inbound).
6. Persona routing + Floor split; Problem Center → Warehouse; Restock disposition in Returns.
7. Data Trust consolidation (+ audit trail v1: read-only ledger view).

**P2 — polish**
8. Vocabulary/format sweep (§7). 9. Pulse/CTA/time-pill pattern library. 10. Empty & n=1 states (#14, 31, 44). 11. Theme toggle → single control with explicit state (#66).

---

## 9. Open Questions (pressure-test before locking)

- **Warehouse access model:** warehouse identity and route context are locked, but user access is still shop-wide. Define warehouse membership, assignment, and supervisor/operator access before multi-warehouse isolation is considered complete.
- **External-channel location mapping:** decide whether one warehouse maps to exactly one Shopify location or whether a warehouse may contain multiple external fulfillment locations.
- **Remembered selection storage:** decide whether the user's last-selected warehouse belongs in server-side user state, local client state, or both. The fallback order is already locked: valid remembered selection → active default → not-configured state.
- **B2B / wholesale orders:** does Orders need order-type segmentation, or a separate surface?
- **Additional channels** (Amazon, retail POS): Data Trust sync-health is designed per-channel — confirm Orders/Inventory views are channel-aware.
- **Mobile owner experience:** Today is desktop-designed; owners check phones constantly. Mobile Today = P1 or P2?
- **Notifications delivery:** push toggle exists with no destination defined (#65) — mobile app push? email digest? Decide in Settings › Notifications spec.
- **Data Trust promotion — slot is free, unused (added 2026-07-08):** the 8th top-level nav slot freed by the Team relocation (§8 item 3a) is currently empty. §4/§5 propose Data Trust as its occupant, but that work has not started. Decide: promote now, or hold the slot for something else surfaced by §10 (e.g. a consolidated Warehouse entry if Floor Planning/Problem Center formally merge)?
- **Module-package consolidation plan — does not yet exist (added 2026-07-08, see §10.3):** §4's 7-module target presumes merges (`wms` + `floor-planning` + `problem-center` → Warehouse; `cashflow` + `finances` → Finances) that have only been actioned at the nav-routing level, never scoped as module-package work. Needs its own plan before §4 can be called complete.
- **`customers` and `fulfillment` modules — unaccounted for in §4 (added 2026-07-08):** both are live, registered modules with no corresponding entry in the target map. `customers` is confirmed deprecated (analytics/PostHog replacement, per `overview_pulse_and_signal_dedup_2026_06_20.md`) but still routed today — decide sunset timeline. `fulfillment`'s relationship to Orders/Warehouse is undetermined.
- ~~`problem_center_tasks` ↔ `alerts` FK hardening (added 2026-07-08, see §10.4)~~ **✅ RESOLVED (2026-07-08) — see §8 item 1.** Was not FK hardening alone: the audit found three separate, live bugs in this seam (wrong ID namespace, a fully alert-blind resolve path, and an unvalidated client-supplied ID), fixed and verified live via curl/psql. One related gap remains open — receive-exception resolution has no dedicated path — tracked as **GitHub #1039**.
- **Finances product refinement — blocks §8 item 3d and #1040 overlap (added 2026-07-08):** Cash Flow's current content (60-day projection, plan-a-stock-order) was judged during this session as not yet effectively resolving the ICP's core data-fragmentation/Excel-chaos pain. Finances, Cash Flow, and Margin are **frozen** pending a content/product pass — no further routing, nesting, or structural work should land on any of the three until that's decided. This blocks §8 item 3d (the `/cashflow` route nest) indefinitely, and should be resolved before revisiting whether Cash Flow deserves its own module at all vs folding into Finances/Margin.
- **Warehouse shell architecture — GitHub #1040 ✅ CLOSED (2026-07-13):** `WmsFT2Page.tsx` shell built — `ModuleTabBar` and `PlanGate` centralized, `WmsOperationsPage.tsx` extracted, `WmsAnalyticsPage.tsx` stripped of duplicate tab bar, `LifecycleRouteHost.tsx` collapsed to single `/wms/*` route. `WmsPage.tsx` deleted.

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

### 10.5 Warehouse identity foundation — implemented 2026-07-11

The backend now has a first-class warehouse identity boundary:

- `warehouses.warehouse_id` is the stable UUID primary key.
- `warehouses.name` is the editable user-facing label.
- `root_location_code` bridges the existing root location hierarchy during migration.
- One active default warehouse is bootstrapped during registration, Shopify installation, and development seeding.
- `warehouse_locations.warehouse_id` is mandatory.
- Parent and child locations are constrained to the same shop and warehouse.
- New child zones inherit `warehouse_id` from their parent.
- Root-level zone creation temporarily resolves the shop's active default warehouse.
- Authentication, Shopify-install bootstrap, seed paths, and floor-planning zone creation all write warehouse ownership explicitly.
- RLS remains shop-scoped. Warehouse-specific user permissions are not yet implemented.

Current compatibility constraints:

- Location codes remain unique across the shop, not only within a warehouse.
- Most warehouse readers still query by `shop_id + location_code`.
- The frontend has no warehouse selector or UUID-scoped query keys.
- Operational entities such as orders, pick batches, receive jobs, stow tasks, printers, and WMS settings are not yet consistently warehouse-scoped.
- `root_location_code` remains an internal compatibility bridge and must not become the user-facing warehouse identity.

The next contract layer is:

1. List warehouses available to the authenticated shop/user.
2. Rename a warehouse without changing its UUID or location hierarchy.
3. Resolve and persist selected warehouse context.
4. Scope Warehouse routes, API queries, and cache keys by `warehouse_id`.

---

## 11. Tier Gating Map (updated 2026-07-11)

> IA changes must preserve or deliberately redesign live monetization gates.
> Warehouse identity and selection are foundational context, while advanced
> floor design and additional warehouse capacity remain product capabilities.

| Gate | Scope | Tier required |
|---|---|---|
| `returns-resolution` (whole nav item) | Returns & Resolution | `core` |
| Warehouse list, selection, and rename | Existing warehouses available to the shop | Same tier as Warehouse access |
| Additional warehouse creation and activation | Multi-warehouse capability | `scale` |
| `floor-planning` (Warehouse child) | Floor Plan for the selected warehouse | `scale` |
| `demand` (Inventory child) | Demand & Reorder | `growth` |
| `finances` (whole nav item) | Finances | `growth` |

Warehouse tier contract:

- Every shop with Warehouse access can view, select, and rename its existing warehouse.
- Renaming the default warehouse is not an upsell boundary.
- Creating or activating additional warehouses requires Scale.
- Floor Plan retains its existing Scale gate.
- A user with access to only one warehouse does not need a prominent selector; the shell still carries that warehouse's UUID context internally.
- Once warehouse membership is implemented, selectors and APIs expose only warehouses the authenticated user may access.

Confirmed from `ShopSettingsPage.tsx` / Billing tab: live plan ordering is
`core → growth → scale`. The Warehouse shell must apply these gates to
capabilities, not to the existence of stable warehouse identity.

---

*Appendix: full 68-item findings log lives in the audit thread; item numbers referenced above (#N) map to that log.*

---

## 12. Full-Screen Audit v2 Register (2026-07-11 evening)

> **Status:** AUDIT — screenshot evidence only (33 screens, dev seed data). Items are NOT
> code-verified. Each item must be reproduced against live code/DB before Implementation
> Mode, per standard audit rules. Numbering: ISS-201–265 (200-series reserved for this audit).
>
> **Workstream tags:**
> **W1** number reconciliation (P0, §8 item 2) · **W2** warehouse contract (✅ #1040 closed 2026-07-13) ·
> **W3** vocabulary/format sweep (§7) · **W4** naming/route hygiene (§4) ·
> **W5** standalone quick fix · **K** known migration, logged for record ·
> **P1** loop spec gap (§5/§6) · **R** product ruling required · **V** verify before classifying

### 12.1 Register

| ID | WS | Screen(s) | Finding |
|---|---|---|---|
| ISS-201 | ✅ | Overview vs Orders | Intentional scope difference: Overview signal = is_shipping_sla_breached=true only (alerts.aggregator); Orders Critical = all aging orders past 48h watch floor (OrdersOperatorFacts, cap 20). Different views, not a contradiction. No code change needed (2026-07-13) |
| ISS-202 | ✅ | Overview vs Orders | "2 decisions pending" (revenue_at_risk alerts) vs "N constrained" (order_constraints) — semantically different layers, not a contradiction. Orders header relabelled to "N orders constrained" (2026-07-13) |
| ISS-203 | ✅ | Orders | Header "N constrained" vs Critical section "N SLA-breached" — two different operational signals, correctly distinct after ISS-202 label fix (2026-07-13) |
| ISS-204 | ✅ | Global header | Bell (all active alerts) vs greeting (revenue_at_risk alerts only) — intentional spine views, not a contradiction. Verified live: 4 active alerts, 2 revenue_at_risk (2026-07-13) |
| ISS-205 | W3 | Overview | One figure, three labels: $23,524 as "at stake" (greeting), "Blocked" (Pulse); separate "At risk $8,977" |
| ISS-206 | W3 | Order Flow | Fourth synonym: "$23,524.00 held" |
| ISS-207 | W3 | Overview/Orders | Currency mix on one screen: USD1,230 prefix style vs $3,800 symbol style (#27, cross-check #1041) |
| ISS-208 | ✅ | Orders vs Flow | Intentional: formatCurrency (2dp) for line-item detail vs formatCurrencyCompact (0dp) for aggregate KPIs. Two formatters, two contexts, both correct. Rule in formatCurrency.ts (2026-07-13) |
| ISS-209 | W4 | Orders/Outbound | Panel title drift: "Needs a decision" vs "Needs attention" — §3 canonical is "Needs attention" |
| ISS-210 | W3 | Outbound | "SHIPPING HEALTH" sidebar — all sidebars are "X Pulse" (#49) |
| ISS-211 | W4 | Orders | H1 "Orders" ≠ tab "Overview" ≠ breadcrumb; landing tab named module-adjacent not content ("Queue") |
| ISS-212 | W4 | Sidenav | Nav "Purchasing" — target name "Suppliers" |
| ISS-213 | K | Global | Sync trio still live: Live pill + CHANNELS LIVE + Just synced chips — one model, Data Trust owns (§8 item 7) |
| ISS-214 | W5 | Outbound | ✅ CLOSED 2026-07-11 — Export guidance now derives from the available report formats; Outbound correctly advertises CSV only. Frontend build and live UI verified. |
| ISS-215 | ✅ | Outbound | Queue segmentation control — sanctioned exception to canonical time-range control. Rule documented in §7. (resolved 2026-07-12) |
| ISS-216 | W4 | Demand | Route /demand escapes /inventory/demand — last known escapee in module |
| ISS-217 | ✅ | Intelligence vs Data Quality | Intentional scope difference: Data Quality counts active variants with no SKU (ProductsOperatorFacts); Intelligence counts variants with SKU but no bin assignment (ProductsWmsReadinessFacts). Different concepts, labels must differentiate (2026-07-13) |
| ISS-218 | ✅ | Intelligence vs Data Quality | Intentional scope difference: WmsReadiness counts SKU-having variants missing from inventory_unit_status; WarehouseBridge counts stocked variants with no bin location. Stock-aware vs SKU-aware. Labels must differentiate (2026-07-13) |
| ISS-219 | ✅ | Intelligence vs Catalog | Intentional granularity difference: Intelligence counts variants (SKUs); Catalog counts products. Delta = multi-variant products. No bug (2026-07-13) |
| ISS-220 | W3 | Catalog/Demand | Deprecated vocab live: "4 zero stock", "stockout risk" — canonical: Stocked out |
| ISS-221 | W3 | Catalog | "CATALOG HEALTH" sidebar (#49) |
| ISS-222 | W3 | Catalog vs Intelligence | "Sellable 2" vs "Ready to sell 2 of 32" — numbers agree, label drifts |
| ISS-223 | W3 | Catalog | Bare "Blocked 30" — must read "Blocked stock" (#22); collides with blocked revenue |
| ISS-224 | W3 | Intelligence | One number, two names on one screen: "non-moving stock" vs "Dead capital $29,527"; neither in glossary |
| ISS-225 | W3 | Intelligence | "$2,400 lost" — canonical term is Leaked (#42) |
| ISS-226 | W5 | Intelligence | "Cash Flow →" CTA on Inbound Pipeline — Finances frozen, deep-links redirected (ISS-110/111 escapee) |
| ISS-227 | W3 | Catalog | Time control: 6 overlapping options, rendered above H1 — canonical Today/7d/30d/90d/Custom below H1 (#29, #51) |
| ISS-228 | W3 | Costs | "$ 0,00" inputs — literal #27 violation; cross-check #1041 file list |
| ISS-229 | W5 | Demand | Rows show "Default Title"/"—" as identity — extend ISS-SR-07 title/SKU treatment |
| ISS-230 | P1 | Demand | No recommended reorder qty column at all on criticals — §5 requires it, never 0 (#59) |
| ISS-231 | W5 | Intelligence | "No SKU" rendered in title slot of action queue rows — product identity unrecoverable |
| ISS-232 | ✅ | Overview vs Costs | Intentional scope difference: Overview alert counts order-linked variants missing estimated_unit_cost (alerts.aggregator → order_revenue_units); Costs page counts all variants with unit_cost null/0 (variants table). Both correct — scoping unstated but not contradictory (2026-07-13) |
| ISS-233 | K | Inventory | Intelligence still lead tab — target: Demand & Reorder leads, Intelligence folds (#20, #45) |
| ISS-234 | K | Warehouse | Route fragmentation /wms + /floor-planning + /problem-center — #1040 shell prerequisite ✅ closed 2026-07-13; ISS-234 route nesting rides its own K migration |
| ISS-235 | ✅ | Floor Planning | WH-1-ROOT replaced by warehouses.name via join in /layout endpoint; WarehouseZone type extended with warehouse_name; canvas label uses name for type='warehouse' nodes. Verified live: "Main warehouse" (2026-07-13) |
| ISS-236 | W5 | Floor Planning Setup | Root warehouse row carries delete/hide affordances — data-loss risk; lifecycle belongs to Settings › Warehouse |
| ISS-237 | W2 | Floor Planning | Setup/Barcodes own warehouse-identity objects — v1.2 split: identity→Settings, topology→Floor Plan |
| ISS-238 | ✅ | Order Flow vs Operations | Intentional scope difference: Operations shows all non-complete batches; Order Flow counts only batches with assigned orders. Verified live: both return 0 with current seed data (2026-07-13) |
| ISS-239 | ✅ | Orders vs Wh Analytics | Different aggregation windows and sources by design — Orders reads live order-pool; Analytics reads historical snapshots. Audit was a timing artifact (2026-07-13) |
| ISS-240 | ✅ | Floor Planning | Intentional scope difference: header = all bins (12 pick + 1 problem = 13); Barcodes = all locations (13 bins + 3 lanes + 1 warehouse = 17). Correct by definition. Seed fix: PROBLEM bin corrected from quarantine → problem zone_type (2026-07-13) |
| ISS-241 | ✅ | Inventory Intelligence vs Floor Planning | Intentional scope difference: Intelligence shows pick-zone bins only (12); Floor Planning shows all bins (13). Both correct for their context (2026-07-13) |
| ISS-242 | W4 | Operations | H1 "Warehouse" = module name; tab/breadcrumb say Operations |
| ISS-243 | W4 | Floor Planning | Three H1s across tabs, two aspirational sentences on populated screens — register is empty-state-only (#15, #50) |
| ISS-244 | W3 | Wh Analytics | Time control 7d/30d/90d — missing Today/Custom, wrong position; third variant app-wide |
| ISS-245 | ✅ | Wh Analytics | Cast is a sanctioned feature — floor display token system (shop_display_tokens, /api/v1/wms/analytics/display-tokens). Broadcasts analytics to warehouse screens. No change needed. (resolved 2026-07-12) |
| ISS-246 | P1 | Wh Analytics | n=1-aware states inconsistent: dashes beside confident "11.3h avg turnaround" with no small-sample caveat |
| ISS-247 | W5 | Problem Center | ✅ CLOSED 2026-07-11 — True-zero now renders "No open exceptions"; filter-result copy remains for hidden existing tasks. API, DB, module build, and live UI verified. |
| ISS-248 | W1 | Problem Center | Type enum (Item Missing + Short Pick coexist) vs §3 spine categories — verify 1:1 mapping to alerts |
| ISS-249 | W5 | Operations | ✅ CLOSED 2026-07-11 — Pack Mode now asks operators to scan an item or invoice barcode instead of exposing the internal LSU prefix. Existing item, shipment, and return routing behavior is unchanged. |
| ISS-250 | K | Operations | Pack Mode on Console page — Floor split pending (Loop 3), placement logged |
| ISS-251 | W5 | Wh Analytics | "Add hourly costs in Team" — Team relocated to Settings 2026-07-08; stale pointer |
| ISS-252 | P1 | Returns | Queue "Ranked oldest-first" — must be consequence-ranked with canonical sentence (§2.4, §5) |
| ISS-253 | ✅ | Returns Pulse | Intentional: recovery_rate_pct = money-based (1515/3810 = 39.8%); jobs subtitle = count-based (3/8 = 37.5%). Two metrics, same query, both correct. Verified live (2026-07-13) |
| ISS-254 | ✅ | Returns Pulse | Genuine bug fixed: total_revenue_refunded was SUM(oru.line_total) — excluded 3 pending jobs with no line items ($1,410). Now uses SUM(re.total_refund_amount) per §7 canonical vocab. Verified live: $3,810 (2026-07-13) |
| ISS-255 | W3 | Returns | "Claim →" primary CTA — verb absent from §7 actions and dispositions |
| ISS-256 | K | Returns | "Scan a return" scan surface on Console decision page — Loop 3 placement, logged |
| ISS-257 | ✅ | Returns Items | Restock condition-gated by design — disabled with inline reason when inspected condition blocks resale. Rule in §5. (resolved 2026-07-12) |
| ISS-258 | W5 | Returns Items | "Initiate refund" offered on already-refunded line — suppress or relabel post-refund |
| ISS-259 | W4 | Returns Items | H1 "Returned items" ≠ tab "Items" |
| ISS-260 | K | Returns | Tabs Overview/Items/Supplier Ratings vs target Recovery Queue/Items; Ratings duplicates supplier table (#17, #38) |
| ISS-261 | W3 | Cross-module | Date formats ×4: 7/11/2026, 9 Jul 2026, Due 11 Jul, ~Jul 11 (#52) |
| ISS-262 | W3 | Open POs | "Receive Via WMS" — WMS jargon post-rename (#1, #62), mid-cap Via |
| ISS-263 | W3 | Open POs vs Intelligence | PO lifecycle vocab ×3: Created/On the way/Arrived vs "shipped" vs §7 Received/Stowed/Sellable |
| ISS-264 | V | Suppliers | Scorecard shows no §5 metrics and no "No order history yet" fallback — verify vs Gap 1 closure before classifying |

| ISS-265 | W3 | Returns | "Revenue Lost / Margin Lost" headers (Leaked, #42) + Default Title identity rows (ISS-SR-07 parity) |
| ISS-266 | W5 | Pack Session | ✅ CLOSED 2026-07-11 — Shipping-label generation failures now propagate into a truthful, non-blocking warning instead of reporting successful printing. Verified with no carrier configured: API returned explicit 500, backend logged the failure, and WMS module build passed. |
| ISS-267 | P0 | Pack → Outbound | 🧪 CARRIER VALIDATION PENDING — Live-verified through a legitimate seeded order: final item confirmation left the order packing; LSO changed it to packed and completed the pack batch; Outbound displayed the handoff queue; manual handoff changed packed → shipped, set fulfillment to fulfilled, removed the queue row, and added the order to the shipped ledger. Carrier-webhook transition is code/build verified but still requires a signed live webhook fixture before closure. |
| ISS-268 | ✅ | Floor Planning Map | Root box changed to height:100% flex column; map container flex:1 minHeight:0 — canvas fills viewport on load without scrolling (2026-07-13) |

### 12.2 Verified working (selected)

- RET-S4-04 **CLOSED by observation:** owner-decision queue renders on Items for a completed
  damaged-line job — condition badge, operator note, decision CTAs live.
- Sprint 1 Sourcing deliverables all visible in UI: spotlights, MOQ/lead-time nudges,
  assign-supplier flow, "No SKU" nudges, Sourcing Pulse. Gap 3 label ("Received POs") live.
- Reorder Loop traversable end-to-end on screen: stockout signal → Demand → Sourcing →
  PO → Inbound → Receive CTA.
- Breadcrumb rewrite holding everywhere, including escaped routes. `/inventory/data-quality`
  correctly nested. Ranking sentence verbatim on all Orders/Overview queues. Demand and
  Floor Planning tier badges match §11.
- Counts that DO agree: Blocked $23,524 and Collected $43,588 across Overview↔Orders;
  stocked-out 4 across three Inventory surfaces; PO 30 units·3 lines internal math;
  product-barcodes 29 agrees between Floor Planning and Data Quality.

### 12.3 Structural diagnosis (W1)

W1 audit finding (revised after Lane A + B): most contradictions were intentional scope
differences with inadequate labels — not raw-table policy violations. The `alerts`
spine policy remains correct for signals. A shared stats resolver is not required.
The one genuine shared-source violation (ISS-254) was a wrong aggregation function
in the Returns Pulse query, fixed in place. The actual W1 fix is label clarity (W3/W4):
each cross-surface number difference must either carry an explicit scope label or be
unified at the source — the audit confirmed which is which per item.

### 12.4 Rulings required before implementation

1. ISS-257 ✅ RESOLVED 2026-07-12 — Restock is condition-gated by design. Gate renders
   disabled with inline reason, never hidden. Rule documented in §5 Returns.
2. ISS-215 ✅ RESOLVED 2026-07-12 — Outbound's pills are a sanctioned queue segmentation
   control (operational work queue, not analytics time-range). Documented as named exception
   in §7 Formats.

### 12.5 Sequencing

W5 quick fixes → W1 (P0, with 12.3 architecture decision first) → W2 (already queued:
contract layer (✅ #1040 closed 2026-07-13); ISS-235 and ISS-237 remain) → W3+W4 combined sweep.
K items ride their existing migrations. V items enter Audit Mode before classification.
