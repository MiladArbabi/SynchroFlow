# LaSyncro — Product Structure

> **Status:** Target structure v1 — agreed 2026-07-07
> **Source:** Full-app screen audit (33 screens, 68 logged findings) workshopped against ICP.
> **Purpose:** The canonical reference for IA, naming, routing, and the signal system. All refactors converge on this document.

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
- **Purchase Orders** — open POs, ETAs, receiving status (web inbound visibility — NEW).
- **Suppliers** — unified scorecard: on-time, fill rate, **return rate, suspect batches** — one card per supplier.
- **Sourcing** — assign suppliers, ranked options for stockouts. Step 2 of the Reorder Loop.

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
One guided flow replacing today's four disconnected entry points (#45, 56). *Currently ~50%.*

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
1. Signal spine: one table, one lifecycle; rewire Today queue + bell + module blocks + Problem Center as views. Delete `/alerts` module.
2. Number reconciliation: Sellable badge vs sidebar (#21); margin period labeling (#43); refunded/leaked split (#42); $3,800-vs-$4k rounding rule (#60); "reorder 0 units" (#59); "$0/wk lost" criticals (#25); "+48% vs prior" on first period (#44).
3. Routing + naming sweep per §4 conventions (~12 findings in one pass).

**P1 — must-have loops**
4. Order detail page.
5. Reorder Loop wiring (Demand → Sourcing → PO → inbound).
6. Persona routing + Floor split; Problem Center → Warehouse; Restock disposition in Returns.
7. Data Trust consolidation (+ audit trail v1: read-only ledger view).

**P2 — polish**
8. Vocabulary/format sweep (§7). 9. Pulse/CTA/time-pill pattern library. 10. Empty & n=1 states (#14, 31, 44). 11. Theme toggle → single control with explicit state (#66).

---

## 9. Open Questions (pressure-test before locking)

- **Multi-warehouse** at the $50M end: Warehouse module assumes one floor — does `/warehouse` become `/warehouse/:location`? Decide before Floor Plan refactor.
- **B2B / wholesale orders:** does Orders need order-type segmentation, or a separate surface?
- **Additional channels** (Amazon, retail POS): Data Trust sync-health is designed per-channel — confirm Orders/Inventory views are channel-aware.
- **Mobile owner experience:** Today is desktop-designed; owners check phones constantly. Mobile Today = P1 or P2?
- **Notifications delivery:** push toggle exists with no destination defined (#65) — mobile app push? email digest? Decide in Settings › Notifications spec.

---

*Appendix: full 68-item findings log lives in the audit thread; item numbers referenced above (#N) map to that log.*