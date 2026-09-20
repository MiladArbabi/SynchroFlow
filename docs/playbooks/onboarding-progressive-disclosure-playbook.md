# LaSyncro — Onboarding & Progressive Disclosure Playbook

> **Status:** v1.2 — 2026-09-18
> **Author:** Product + Engineering session (ISS-RQ series)
> **Reading order:** Read `lifecycle_playbook.md` and `modules-ux-playbook.md` before this.
> **Purpose:** Canonical reference for onboarding, Ops Console setup guidance, spotlight coaching,
> and progressive-disclosure patterns. Every engineer touching first-run UX must read this first.

---

## 1. Philosophy

LaSyncro is PLG (product-led growth) — users self-register and must reach value without
a sales engineer. The aha moment is not understanding the UI. It is the morning brief
rendering with real signals from their real store.

Three principles drive every decision in this playbook:

1. **Never explain, make the user do.** One action at a time. Immediate visible payoff.
   Zero walls of text. (Duolingo pattern.)
2. **Activation is data-state, not click-tracking.** A checklist item is complete when
   the underlying data condition is true — not when the user clicked through a tour.
   (PostHog pattern.)
3. **Teach surfaces lazily, on first contact.** Spotlights fire once, on the surface
   they coach, anchored to the one primary action. They never return after dismissal.

---

## 2. The Three Layers

### Layer 1 — Ops Console (persistent topnav attention surface)

**Status:** `OPS-CONSOLE-01` — **IMPLEMENTED / AUTOMATED VERIFIED / LIVE VERIFIED — 2026-09-10.**

**What it is:** The single topnav attention surface for the authenticated FT2
application. Its trigger opens a compact fixed right-side operational rail while
leaving the working surface visible on desktop.

The Ops Console replaces both legacy topnav surfaces:

- the Activation Checklist / "Getting started" popover;
- the Alerts bell / quick-alert popover.

It does **not** replace their authoritative data sources.

`/alerts` remains the advanced alert-management workspace for Inbox, Snoozed,
Resolved and Rules. The console provides a subordinate `Manage alerts →` path
to that workspace.

**Design rationale:** Setup work, operational alerts and future Decision Engine
interventions are all forms of "what needs my attention next". Splitting them
across adjacent topnav icons forced the merchant to understand system
architecture before acting. The Ops Console provides one attention entry point
while the destination modules remain the places where work is performed.

#### Information architecture

```text
OPS CONSOLE

OPEN | HISTORY

NOW
  current consequential operational attention

WAITING
  persisted interventions awaiting canonical verification
  [live — GET /api/v1/operations/waiting; see "WAITING V1 certification" below]

SETUP
  incomplete onboarding/configuration work

RECENT ALERTS
  recently closed alert-lifecycle records

ALERT HISTORY
  older closed alert-lifecycle records
```

`WAITING` must not render merely to complete the visual design. It becomes valid
only when a shop-wide authoritative intervention/verification source exists.

#### Setup contract

**PRE-APP onboarding vs. Ops Console SETUP.** Connecting Shopify and completing
the initial sync happen before the merchant can reach the authenticated
application shell — they are lifecycle prerequisites, not Ops Console SETUP
rows:

- `FT_MINUS_ONE` owns Shopify connection / reconnect through `ConnectStorePage`.
- `FT0` / `FT0_PREPARING` own initial sync through `SyncAnimationPage`.

Ops Console does not own or render either of those workflows. `useActivationChecklist`
remains the single frontend assembler and completion authority for the five
in-app setup rows below.

| # | Label | Authoritative condition | Action |
|---|---|---|---|
| 1 | Fix missing product costs | readiness `order-nexus / orderNexus.resolveMissingCosts` | `/inventory/catalog` |
| 2 | Map your warehouse zones | readiness `wms / map-zones` | `/floor-planning` |
| 3 | Print your first location barcode | readiness `wms / print-barcodes` | `/floor-planning?tab=barcodes` |
| 4 | Connect your shipping carrier | readiness `wms / connect-carrier` | `/settings/carriers` |
| 5 | Release your first batch | persisted `wave_released` activation event | `/orders/flow` |

The old `Export your first brief` checklist item is no longer part of the Layer
1 setup contract. Backend/platform readiness (`platform / connect-store`,
`platform / complete-sync`) still exists and remains valid for lifecycle/pre-app
consumers — those definitions were not removed, only excluded from this
Ops Console checklist assembler.

**Development readiness.** Normal development uses canonical onboarding
readiness. A synthetic platform connected/synced readiness override is
disabled by default and is available only when `NODE_ENV=development` AND
`DEV_READINESS_OVERRIDE_ENABLED=true`. Production must never enable the
synthetic readiness provider.

**Completion rule:** activation remains data-state, never click-tracking.
Opening a destination does not complete a setup item.

Incomplete items remain individually actionable. Completed items are visually
subordinate/collapsible. When all five are complete, the section collapses to a
compact `Setup complete · 5/5` state rather than rendering five permanent rows.

`wms.carrierConfigured` represents configuration readiness, not live provider
verification. It is true only when the shop has at least one active supported
carrier configuration with the required persisted credential material:
Sendcloud requires both `public_key` and `private_key`; Shippo requires
`api_token`. The readiness check does not decrypt credentials or call the
carrier provider. Visiting `/settings/carriers` alone never completes the task.

The legacy per-user `checklist:completed` flag remains readable for backward
compatibility. It may suppress already-completed SETUP content, but it must
never hide the Ops Console itself. No replacement "Dismiss checklist" action or
new persistence mechanism is introduced.

#### Operational truth

`TopnavbarContent` remains the single shell-level owner of the canonical inbox
poll:

```text
useAlerts({ status: 'inbox' }, { enabled: isFt2, poll: true })
```

The inbox rows are passed into the Ops Console. The console must not create a
second inbox polling owner.

Resolved alerts may populate `RECENT ALERTS` / `ALERT HISTORY` only when the
backend provides authoritative `resolved_at` state. Alert resolution is an
**alert-lifecycle fact only** and is not evidence of a verified Decision Engine
outcome.

Accordingly:

- resolved alert rows use neutral `closed` state and glyph `·`;
- closed alerts never receive green / `✓` verified-outcome treatment;
- alert acknowledgement does not equal resolution;
- navigation does not equal intervention;
- navigation does not manufacture WAITING or VERIFIED state.

#### Status grammar

```text
○  available / setup required
!  attention required
→  actionable navigation
…  persisted intervention awaiting verification
✓  authoritative verified completion
×  failed
–  dismissed / expired
·  authoritative alert lifecycle closed
```

The meaning of `✓` depends on the source authority. For setup, a real readiness
condition may justify it. For Decision Engine outcomes, canonical verification
must justify it. A click alone never does.

#### Ranking and filtering

V1 has no merchant-controlled sorting.

Open operational rows preserve the canonical backend alert ranking. The broader
product ordering is:

```text
critical blocker
→ deadline / urgency
→ merchant priority where authoritative
→ recommended action
→ setup
→ waiting
→ recent history
```

V1 filtering is deliberately small:

```text
OPEN | HISTORY
```

Advanced alert filtering, snoozing, acknowledgement, resolution and Rules stay
on `/alerts`.

#### Responsive contract

- `xs`: full viewport-width console, pinned to both viewport edges;
- `sm+`: compact 340px right rail;
- no horizontal overflow;
- narrow operational rows may reflow their CTA onto a second compact line;
- CTA labels must remain fully visible and tappable;
- vertical scrolling belongs inside the console;
- the console is non-modal on desktop and must not add an invisible backdrop.

#### Verification evidence

Automated:

- Ops Console frontend contracts: **70 / 70 passed**;
- neighboring `TopnavbarContent`: **13 / 13 passed**;
- ownership: `UNOWNED=0`, `MULTI_OWNED=0`;
- frontend TSC remained at the pre-existing baseline:
  `486 total / 2 target`, with no normalized error-set delta;
- `git diff --check`: clean.

Live browser:

- dark desktop: passed;
- light desktop: passed;
- underlying application remained clickable while the rail was open;
- console persisted across route navigation;
- `Manage alerts →` reached `/alerts`;
- one topnav attention surface remained;
- 390px responsive full-width behavior passed after correction;
- CTA clipping and horizontal overflow were absent after correction.

The Ops Console is now the canonical Layer 1 attention surface. Do not
reintroduce separate onboarding or quick-alert topnav popovers.

#### 2026-09-11 surface recovery and address-resolution certification

The polished Ops Console surface contract was recovered and re-certified after
the runtime UI had regressed to an older flat representation.

The current contract is:

- `NOW` contains only explicitly actionable alert types with a valid destination;
- unknown or non-actionable alerts do not gain a CTA merely because a deep link exists;
- actionable NOW rows render as compact micro-cards;
- the initial NOW view is capped at five rows with `Show more / Show less`;
- `SETUP` remains secondary and collapsed;
- `HISTORY` remains visually neutral and separate from actionable work;
- vertical scrolling stays inside the console;
- reduced-motion users do not receive decorative movement.

Current action mappings include:

```text
customer          → Fix addresses     → /overview?resolution=address
inventory         → Resolve stockouts → /orders/flow?constraint=inventory
low_stock_reorder → Reorder now       → /demand?filter=critical
```

The customer action now opens the guided Address Resolution Session instead of
sending the merchant to the generic customer-constrained Order Flow view.

Live certification confirmed:

```text
OPEN
→ merchant saves corrected address
→ RECHECKING with visible pending feedback
→ canonical blocker clears
→ FIXED
→ resolved count increments
```

The count must never increment from mutation success alone.

Automated recovery coverage includes the Ops Console model and surface contracts,
Overview address-resolution wiring, commercial-access boundary, session-state
contract and existing Order Detail address treatment.

#### 2026-09-18 SETUP V1 production certification

Production Ops Console `SETUP` was directly observed rendering exactly the five
journeys defined in the §2 setup contract table above, in order:

1. Fix missing product costs
2. Map your warehouse zones
3. Print your first location barcode
4. Connect your shipping carrier
5. Release your first batch

Observed production state for the certifying shop:

| State | Rows |
|---|---|
| Remaining | Fix missing product costs · Print your first location barcode · Connect your shipping carrier |
| Completed | Map your warehouse zones · Release your first batch |

Certified:

- no `Setup status unavailable` row rendered;
- no `Connect your Shopify store` row rendered;
- no `Complete your first data sync` row rendered;
- Shopify connection and initial sync correctly remain PRE-APP lifecycle
  responsibilities (`FT_MINUS_ONE` / `FT0`, per the Setup contract section
  above) and are not rendered as Ops Console SETUP rows.

**SETUP V1 production certification: COMPLETE / GREEN.**

`NOW` rows were visible in production during this certification, but `NOW`
semantics were **not** certified by this SETUP slice and remain the next
separate product layer to certify. The five-row SETUP contract itself is
unchanged by this note.

#### 2026-09-18 — NOW V1 certification

This section documents the ratified `NOW` architecture, its LOCAL
verification evidence, and its subsequent production certification.

**NOW means:** merchant/operator intervention is required now, there is
canonical unresolved truth behind it, and there is a concrete remediation
destination.

**NOW does NOT mean:**

- ordinary workflow progression;
- setup debt;
- duplicate summary alerts;
- speculative/future alert families merely because they have a route.

**Alert-backed NOW V1 allowlist** (exact):

- `sla_breach`
- `inventory`
- `customer`
- `stockout_risk`
- `low_stock_reorder`
- `stock_protection`
- `wms_pick_exception`
- `wms_pack_exception`
- `wms_stow_exception`
- `wms_receive_exception`

Decision Feed remains a separate canonical `NOW` source. Phase-1
`review_return_resolution` rows are composed before alert-backed `NOW` rows.

**Ratified exclusions** (not `NOW` in V1):

- `operational`
- `revenue_at_risk`
- `missing_cogs`
- `reorder_warning`
- `wms_stow_pending`
- `wms_receive_arrived`
- `wms_batch_ready_to_pack`
- `wms_batch_ready_to_ship`
- `wms_batch_released` remains excluded as progress-only

**Boundaries:**

- `missing_cogs` remains represented by SETUP "Fix missing product costs" in
  V1, not duplicated into `NOW`;
- normal WMS queue/progression states do not consume `NOW` slots;
- unknown/new alert types fail closed;
- eligible alert-backed rows still require a real deep link/action;
- acknowledgement is not resolution;
- `NOW` visible limit remains 5; the count represents all actionable `NOW`
  rows, not only the visible five;
- `stock_protection` continues to trust backend-derived `alert.action`;
- `sla_breach` routes to `/orders/flow?urgency=sla_breach`.

**Verification evidence:**

- focused NOW V1 contract: 2 suites / 47 tests GREEN;
- neighbour regression: 5 suites / 157 tests GREEN,
  `NOW_V1_NEIGHBOUR_STATUS=0`;
- live local browser certification: `NOW` showed 8 valid rows from approved
  families; no `missing_cogs` NOW row; no `revenue_at_risk` NOW row; no
  `operational` NOW row; no normal WMS progression rows; SETUP remained
  separate with 3 remaining / 2 completed.

**Non-blocking follow-up observation:** Overview copy showed "5 decisions
pending" while Ops Console `NOW` showed 8. This is not treated as a NOW V1
blocker; it is flagged for a later Overview copy/semantics audit.

**Production certification:**

- deployment commit: `a01e6c83e61c097749b73425cb22ebc0722e697f`
  — `fix(ops-console): ratify now v1 policy`;
- CI: GREEN;
- deployment: GREEN;
- production browser certification, after hard reload: `NOW` count = 4.

Observed `NOW` rows:

- 19 orders past Fulfillment SLA
- Stock protection needs reorder
- 6 orders with address issues
- 3 orders out of stock

These correspond to approved NOW V1 families:

- `sla_breach`
- `stock_protection`
- `customer`
- `inventory`

Certified absent from `NOW`:

- `revenue_at_risk`
- `operational`
- `missing_cogs`
- normal WMS progression rows

SETUP remained separate:

| State | Rows |
|---|---|
| Remaining (3) | Fix missing product costs · Print your first location barcode · Connect your shipping carrier |
| Completed (2) | Map your warehouse zones · Release your first batch |

**Operational observation:** the first production view after deployment
still showed the previous `NOW` composition until the browser performed a
hard reload. After hard reload, the deployed NOW V1 composition rendered
correctly. Treat this as a stale cached frontend/AppLayout bundle
observation, not evidence of a NOW V1 semantic defect.

**NOW V1 production certification: COMPLETE / GREEN.**

#### 2026-09-20 — WAITING V1 certification

This section documents the ratified `WAITING` architecture, its correction
pass, its verification evidence, and its local runtime certification status.

**WAITING means:** a durable merchant/operator intervention has already
happened, the underlying problem is no longer asking for another decision,
and canonical domain truth says the result is still awaiting
verification/completion.

**Boundary:**

```text
NOW      = I still need you to do something.
WAITING  = You already did it. We are waiting for the result to become
           canonically true.
HISTORY  = The result became canonically complete.
```

**V1 treatments** (exact, no others):

- `address_correction`
- `inventory_reorder_intent`

**Valid treatment/constraint pairings** (exact):

| Treatment | constraintType | blockType |
|---|---|---|
| `address_correction` | `customer` | `incomplete_address` |
| `inventory_reorder_intent` | `inventory` | `oversell` |

Any other pairing — either V1 treatment against an `operational` constraint,
or crossed with the other treatment's constraint type — fails closed: it is
never `WAITING`, and it must never suppress `NOW`.

**Current-state projection (correction pass).** `decision_interventions`
remains append-only provenance; canonical per-order intervention readers
(`readOrderInterventionOutcomes`) remain undeduplicated. The shop-wide
`WAITING` surface is a separate CURRENT STATE projection built on top of that
provenance: it renders at most ONE row per current constraint episode. When
multiple valid `pending_verification` interventions exist against the same
still-active episode, the latest `occurredAt` wins; `interventionId` is the
deterministic tie-break on an exact timestamp tie.

**NOW reconciliation** (per exact constraint episode, never per whole
shop/order/type):

```text
pending_verification    → WAITING;     exact current episode excluded from NOW
verified_resolved       → not WAITING; HISTORY later
unknown/stale/re-raised → not WAITING; must NOT suppress NOW
```

**API / frontend ownership.** `GET /api/v1/operations/waiting` — the backend
owns lifecycle classification, pairing eligibility, presentation copy, and
routing; the frontend is projection-only (renders the backend feed verbatim,
with no local re-derivation of copy, route, or business meaning). Locked
routes:

```text
address_correction         → /overview?resolution=address
inventory_reorder_intent   → /orders/flow?constraint=inventory
```

`WAITING` does NOT contribute to the Ops Console attention badge — `NOW` =
needs attention, `WAITING` = already acted / no attention count.

**Verification evidence:**

- backend WAITING integration contract: **15 / 15 GREEN**;
- canonical outcome unit: **2 / 2 GREEN**;
- frontend WAITING/model/surface: **148 / 148 GREEN**;
- Decision Feed / Ops Console neighbour regression: **169 / 169 GREEN**;
- address + inventory outcome attribution: **11 / 11 GREEN**;
- address writer neighbours: **19 / 19 GREEN**;
- backend bounded TypeScript: **0 errors**;
- WAITING frontend files (`opsConsoleModel.ts`, `OpsConsole.tsx`,
  `useWaiting.ts`): **0 TypeScript errors**.

One inventory-treatment neighbour test (`INV-TREAT-01-08`) has a confirmed
pre-existing failure, traced to `orders.decision-by-order.controller.ts` (no
import path to any WAITING-touched file; both the test and the controller
were already dirty before WAITING work began). It is unrelated to WAITING
correctness and is not caused by it.

**Local runtime status (pre-deploy): RUNTIME-SMOKE-CERTIFIED WITH FIXTURE LIMITATION.**

Observed locally:

- local API, worker, and Vite UI booted successfully;
- `GET /api/v1/operations/waiting` unauthenticated returned `401` as expected;
- the real Ops Console loaded successfully;
- real database/customer `NOW` state matched the UI: 3 address-issue orders;
- real inventory `NOW` state matched current constraint data;
- the address-correction flow was inspected through the actual UI;
- stockout treatments were inspected through the actual UI and behaved
  according to canonical purchasing context — existing committed inbound
  surfaced "Review incoming stock"; no supplier surfaced "Find a supplier";
- no merchant action was forced merely to manufacture a `WAITING` row.

**Caveat:** the dev fixture data contained no naturally actionable inventory
case that could create a durable `inventory_reorder_intent` while leaving the
underlying constraint pending long enough to observe a manual `NOW → WAITING`
transition. Address correction is capable of resolving the customer
constraint immediately, which also makes it unsuitable as a guaranteed
durable `WAITING` demonstration. **No live visual `NOW → WAITING` transition
was observed** — this remains open for a future certification pass with
purpose-built fixture data.

**Non-blocking follow-up observation (UX, not a WAITING V1 correctness
blocker):** Ops Console resolution journeys could be more contextually
connected to the Overview live map, Orders Overview / Order Flow, Inventory
Intelligence, and onboarding spotlight/contextual guidance. This is
enhancement scope, not designed or implemented here.

**Unrelated observation (DevEx, not mixed into WAITING correctness):** a
separate GitHub issue already tracks local build/startup artifact and
resource problems (stale `tsbuildinfo` / missing `dist` behavior, and
deprecated/paused module startup cost). Not addressed here.

**Production certification:** GREEN on 2026-09-20 after deployment of commit `96575bea` (`feat(ops-console): add waiting v1`). Production Ops Console loaded successfully, NOW and SETUP remained healthy, and `GET /api/v1/operations/waiting` returned successfully. No production WAITING transition was manufactured solely for certification.

**WAITING V1 status: PRODUCTION-CERTIFIED — 2026-09-20.**

---

### Layer 2 — First-Visit Spotlights (anchored coach marks)

**What it is:** A small floating card that renders adjacent to a primary action on
first visit to a surface. A subtle vertical float animation draws the eye without
aggression. Dismissed per-surface, per-user, permanently.

**Design rationale:** Tooltips require hover — wrong for discovery on a new surface.
Banners (§15, modules-ux-playbook) are for deep-link context, not first-visit coaching.
Spotlights are a distinct, narrower pattern: they coach one action on one surface, once.

**Animation:** CSS keyframe, `translateY(0px) → translateY(-5px) → translateY(0px)`,
2s ease-in-out, infinite. Stops on hover (prevents motion distraction while reading).

```css
@keyframes lasyncro-spotlight-float {
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-5px); }
}
```

**Anatomy (260px wide):**

```
┌──────────────────────────────┐
│ ● 1 of 3                     │  ← micro-progress, 10px, ink-4
│ Release wave to floor        │  ← 13px, fontWeight 600, ink
│ Operators see it instantly   │  ← 12px, fontWeight 300, ink-3, lineHeight 1.5
│                    Got it ✕  │  ← accent ghost pill + X icon (lucide)
└──────────────────────────────┘
```

Token rules (follow modules-ux-playbook §1):
- Shell: `bgcolor: var(--surface)`, `border: 1px solid var(--rule)`, `borderRadius: 10px`
- Shadow: `boxShadow: var(--shadow-md)` (same as alerts popover)
- CTA "Got it": Tier 2 ghost pill per modules-ux-playbook §2
- Never hardcode hex. Never use `fontWeight: 700` on body copy.

**Persistence:** Dismissal calls `POST /api/v1/user-state/spotlight/:key/dismiss`
which writes `spotlight:dismissed:<key>` → `"1"` to `user_states`. Read on mount
via `GET /api/v1/user-state`. Once dismissed, the spotlight never reappears —
no "reset tour" affordance (adds confusion, rarely used).
**Silent failure modes.** `useSpotlight` hides the mark optimistically and rolls back
on error, so a failed dismissal looks like "Got it does nothing / the mark returns".
Two causes, both server-side and both invisible in the UI:
1. Key absent from `VALID_SPOTLIGHT_KEYS` → 400.
2. Missing RLS tenant context on the `user_states` read or write → 500 on write
   (42501), or `{}` on read while the rows exist (see Implementation notes).

**Spotlight registry — priority order for first build:**

| # | Key | Status | Surface | Anchor | Copy |
|---|---|---|---|---|---|
| 1 | `order_flow_wave` | live | Order Flow | Fulfillment panel (pool phase) | "Select orders to release" / "Ready when you are" — see Multi-step arcs below |
| 2 | `order_flow_batch` | live | Order Flow | Fulfillment panel (floor phase) | "Your wave is on the floor — track each batch through picking and packing." |
| 3 | `order_flow_blocked` | registered, not built | Order Flow / Blocked | First blocked order card | "Fix the constraint here. The order moves to the pool automatically." |
| 4 | `demand_reorder` | registered, not built | Demand | Reorder CTA | "Qty is pre-calculated from your sales velocity. Adjust if needed, then create the PO." |
| 5 | `sourcing_never_ordered` | live | Suppliers Portal / Sourcing | "Never ordered before" section (1 of 3) | "These products have no supplier yet — assign one so you know who to order from." |
| 6 | `sourcing_alert_triggered` | live | Suppliers Portal / Sourcing | Ranked supplier options, on alert select (2 of 3) | "Your best supplier, ranked automatically." |
| 7 | `sourcing_accumulator` | live | Suppliers Portal / Sourcing | Reorder queue section (3 of 3) | "Building up your order before sending." |
| 8 | `po_send_flow` | live | Suppliers Portal / Open POs | Above PO list, when a draft PO exists | "Ready to order? Copy and send to your supplier." |

This table is the contract; a key missing from it or from `VALID_SPOTLIGHT_KEYS` is a
defect (see Silent failure modes below).

**Known gaps (registered):** keys 5–7 form a 3-step arc but each renders on an
independent condition with no phase coordination — steps can co-display, violating the
stacking rule above, and the arc is click-chain-shaped rather than a phase function
(ONB-SUP1). Key 8 passes `step={1} totalSteps={1}`, rendering a meaningless "1 of 1"
label (ONB-SUP2).

**Rule:** Never stack more than one spotlight on a single surface at the same time.
If a surface has multiple spotlights (e.g. Order Flow has keys 1 and 2), show them
sequentially across visits — key 1 on first visit, key 2 on second visit (after key 1
is dismissed). Progress is tracked by checking which keys are already dismissed.

**Multi-step arcs.** The stacking rule above covers *unrelated* spotlights on one
surface (sequential across visits). A multi-step arc is different: one teaching
narrative whose beats follow the user through a task on a single visit.

Rules for arcs:
- **One persistent slot.** Render a single `<SpotlightCoachMark>` whose props are
  derived from app state. Never conditionally render two marks — the swap must be a
  content change in place, not unmount/remount.
- **Phase function, not click-chain.** Steps advance because the user's state changed
  (selection made, batch created), never because they clicked "Got it". A step that
  disappears when the user complies with it reads as the app snatching the
  instructions away mid-task.
- **One key per step**, so dismissing early kills only that beat; later beats still
  surface once their phase is reached.

Worked example — Order Flow fulfillment arc (`OrderFlowPage.tsx`, `fulfillmentCoach`):

| Phase | Condition | Label | Key |
|---|---|---|---|
| Pool, nothing selected | `batches.length === 0 && selected.size === 0` | 1 of 2 · Select orders to release | `order_flow_wave` |
| Pool, orders selected | `batches.length === 0 && selected.size > 0` | 1 of 2 · Ready when you are | `order_flow_wave` |
| Floor | `batches.length > 0` | 2 of 2 · Your wave is on the floor | `order_flow_batch` |

**Relationship to intent banner (modules-ux-playbook §15):**

| Pattern | Trigger | Persisted? | Purpose |
|---|---|---|---|
| Intent banner | `?urgency=` / `?constraint=` / `?context=` URL param | No (local useState) | Deep-link context — "why you're here" |
| Spotlight | First visit, no URL param required | Yes (user_states) | First-run coaching — "what to do here" |

They can coexist on the same surface. Intent banner renders at the top of content area.
Spotlight anchors to its specific action element. They do not conflict.

---

### Layer 3 — Teaching Empty States

**What it is:** Every empty state names what will appear there and what action causes
it to fill. No aspirational headlines (per product-structure.md §7 voice register rules
— aspirational sentences are for onboarding/empty states only, not operational surfaces).

**Pattern (consistent across all modules):**

```
[Icon — muted, ink-4]
Nothing here yet.
[One sentence: what fills this and how.]
[Optional: Tier 2 ghost pill CTA to the action that fills it]
```

**Examples:**

| Surface | Empty state copy |
|---|---|
| Order Flow — Order Pool | "No orders ready to release. Resolve blocked orders on the left to move them here." |
| Demand page | "No stockout risk detected. This updates automatically as your inventory changes." |
| Problem Center | "No open exceptions. Pick, pack, and receive exceptions from the floor appear here." |
| Business Pulse | "Sync completing. Revenue figures appear here once your first orders are processed." |

**Rule:** True-zero empty states say "No X" not "No X found" — "found" implies a failed
search, not an empty system. Problem Center's empty state must say "No open exceptions"
not "No results match your filters" (see product-structure.md §5, Problem Center).

---

## 3. Data Architecture

### 3.1 Persistence — `user_states` table

All onboarding state is stored in the existing `user_states` table (key/value per user,
unique constraint on `user_id + key`).

**Key namespace convention:**

| Prefix | Purpose | Example |
|---|---|---|
| `checklist:` | Checklist-level flags | `checklist:completed` → `"1"` |
| `spotlight:dismissed:` | Per-spotlight dismissal | `spotlight:dismissed:order_flow_wave` → `"1"` |

No schema changes needed. The `user_states_user_id_key_unique` constraint guarantees
idempotent upserts — write the same key twice, second write is a no-op (use
`ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`).

### 3.2 Audit events — `activation_audit_events` table

Two new event types must be emitted at the success path of their endpoints:

| Event type | Emitted by | Endpoint |
|---|---|---|
| `wave_released` | `httpReleaseBatch` in `wms.controller.ts` | `POST /api/v1/wms/batch/release` |
| `brief_exported` | `exportBrief` in `exports.controller.ts` | `POST /api/v1/exports/brief` |

Payload schema (both events):

```json
{
  "schema": "activation_audit.v1",
  "event": "<event_type>",
  "occurredAt": "<ISO timestamp>"
}
```

Emit after the success response is committed — never before, never inside the
transaction that does the primary work. Fire-and-forget with `console.error` on failure
(audit event failure must never block the primary action).

### 3.3 Checklist data endpoint

The checklist popover reads from two sources combined in one hook:

1. `GET /api/v1/user-state` — for `checklist:completed` dismissal flag.
2. `GET /api/v1/onboarding/readiness` — for items 1–3 signal states.
3. `GET /api/v1/user-state/activation-events` — NEW, lightweight endpoint returning
   booleans for `wave_released` and `brief_exported` from `activation_audit_events`.

The frontend hook `useActivationChecklist` assembles these into the five-item array.
It is the single consumer — do not inline this logic in the component.

---

## 4. API Contracts

### 4.1 Spotlight dismiss endpoint (NEW)

```
POST /api/v1/user-state/spotlight/:key/dismiss
Auth: Bearer token (authenticateToken)
Params: key — spotlight registry key (e.g. "order_flow_wave")
Body: none
Response 200: { dismissed: true, key: "<key>" }
Response 400: { error: "Invalid spotlight key" } — if key not in registry
```

Implementation: single upsert to `user_states` with key
`spotlight:dismissed:<key>`. Validate key against a server-side registry constant
(same keys as §2 spotlight registry) before writing — reject unknown keys with 400.

### 4.2 Activation events check endpoint (NEW)

```ts
GET /api/v1/user-state/activation-events
Auth: Bearer token (authenticateToken)
Response 200: {
  wave_released: boolean,
  brief_exported: boolean
}
```

Implementation: two `EXISTS` queries against `activation_audit_events` filtered by
`shop_id` and `event_type`. Returns booleans only — no timestamps, no counts.

---

## 5. Implementation Plan

> **Status: T1–T9 shipped 2026-07-10.** T10 (empty states sweep) is the only remaining open task.

Tasks are atomic and must be executed in this order. Do not batch.

| # | Status | Task | Files | Unblocks |
|---|---|---|---|---|
| T1 | ✅ | Emit `wave_released` audit event | `apps/backend/src/api/wms/wms.controller.ts` | Checklist item 4 |
| T2 | ✅ | Emit `brief_exported` audit event | `apps/backend/src/api/exports/exports.controller.ts` | Checklist item 5 |
| T3 | ✅ | `POST /user-state/spotlight/:key/dismiss` endpoint | `user-state.routes.ts`, `user-state.controller.ts`, `UserStateService` | Layer 2 |
| T4 | ✅ | `GET /user-state/activation-events` endpoint | same files as T3 | Checklist items 4–5 |
| T5 | ✅ | `useActivationChecklist` hook | `apps/frontend/src/hooks/useActivationChecklist.ts` | T6 |
| T6 | ✅ | Checklist popover + topnav icon | `TopnavbarContent.tsx` + new `ActivationChecklist.tsx` | Layer 1 |
| T7 | ✅ | `useSpotlight(key)` hook | `apps/frontend/src/hooks/useSpotlight.ts` | T8 |
| T8 | ✅ | `<SpotlightCoachMark>` component | `apps/frontend/src/components/SpotlightCoachMark.tsx` | T9 |
| T9 | ✅ | Wire spotlight to Order Flow | `apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx` | Layer 2 live |
| T10 | 🔴 | Teaching empty states sweep | All module pages (copy only, no logic) | Layer 3 |

### Implementation notes (2026-07-26)

**RLS tenant context is required for all `activation_audit_events` AND `user_states`
reads and writes.** Both tables have FORCED row-level security. `user_states` carries
every checklist and spotlight flag, so the same transaction + `SET LOCAL` wrapper
applies to `dismissSpotlight`, `getOnboardingFlags`, `dismissChecklist`, and every
other method touching that table. Interpolate the tenant id as `${Number(shopId)}` —
`SET LOCAL` cannot take a bound parameter.
**RLS tenant context is required for all `activation_audit_events` reads and writes.**
The table is protected by row-level security. Every insert and select must wrap in a
transaction with `SET LOCAL "app.current_tenant" = '<shopId>'` before touching the table,
or the query will be silently blocked (insert: `42501` RLS violation; select: returns 0 rows).
Pattern used in T1, T2, T4:

```typescript
await db.transaction(async (trx) => {
  await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
  await trx('activation_audit_events').insert({ ... });
});
```

**`getActivationEvents` cast pattern.** Knex's `.transaction()` return type is
`void | T[]` — always cast the result explicitly:
```typescript
const rows = (await db.transaction(async (trx) => { ... })) as { event_type: string }[];
```

**Order Flow ISS-OP-01/ISS-OP-02 additions (2026-07-10):** alongside T9, Order Flow gained
a contextual wave builder (action bar appears on selection, hidden when nothing selected)
and client-side order search wired into the existing `filteredPool` → `sortedPool` →
`visiblePool` chain. See modules-ux-playbook.md §16 for the pattern.

---

## 6. Rules for Future Engineers

1. **New checklist item:** add a signal to `readiness.manifest.ts` OR a new
   `activation_audit_events` event type. Never track completion via click events or
   localStorage.

2. **New spotlight:** add to the registry in §2 (this doc) AND in the server-side
   registry constant used by `POST /user-state/spotlight/:key/dismiss`. Unknown keys
   must be rejected — registry is the contract.

3. **Spotlight on a new surface:** check whether a spotlight for that surface already
   exists in the registry before adding one. Maximum one visible spotlight per surface
   per visit. If the surface needs two spotlights, they are sequential across visits.

4. **Never use localStorage for onboarding state.** `user_states` is the store.
   LocalStorage is not synced across devices and is cleared on browser data reset —
   wrong for activation state that should persist across sessions.

5. **Audit events are fire-and-forget.** Wrap every emit in try/catch. Log failures
   with `console.error`. Never let audit event failure block the primary user action.

6. **Checklist is owner/admin only.** Operators do not see the checklist icon.
   Gate on `shopRole === 'owner' || shopRole === 'admin'` in `TopnavbarContent.tsx`.

7. **Spotlight animation must respect `prefers-reduced-motion`.** Add:
   ```css
   @media (prefers-reduced-motion: reduce) {
     animation: none;
   }
   ```
   to the float keyframe wrapper.

8. **Empty state copy follows the voice register in product-structure.md §7.**
   Operational surfaces: plain nouns, no aspirational headlines. "Nothing here yet."
   is correct. "Build your pipeline." is not.

---

## 7. What This Does NOT Cover

- **Push notifications / email digests:** notifications delivery channel is an open
  question (product-structure.md §9). Do not wire notification dispatch to onboarding
  events until that decision is made.
- **Multi-user onboarding:** checklist and spotlights are per-user. If two admins share
  a shop, each has their own dismissal state. There is no "team onboarding" concept yet.
- **Mobile (iOS/Android):** this playbook covers the webapp only. Mobile onboarding is
  a separate surface with its own scan-first workflow (see `wms_mobile_workflow_playbook.md`).
- **FT0/FT1 phases:** this playbook covers FT2-active users only. Pre-FT2 onboarding
  (AhaMomentPage, lifecycle gates) is fully documented in `lifecycle_playbook.md`.

---

---
*Adjacent docs: `lifecycle_playbook.md` (activation phases), `modules-ux-playbook.md`
(§15 intent banner pattern), `product-structure.md` (§5 module specs, §7 vocabulary).*

---

## 17. Sourcing Module Spotlights — 2026-07-11

> **Surface:** `/suppliers-portal/sourcing`
> **Component:** `SpotlightCoachMark` (now in `modules/shared/src/ui/` — portable,
> no app-layer dependencies)
> **Hook:** `useSpotlight(key)` in `apps/frontend/src/hooks/useSpotlight.ts`
> **Wired in:** `apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx`
> **Rendered in:** `PurchasingSourcingView` in `modules/suppliers-portal`

Three spotlights cover the three distinct states a new user encounters on the
Sourcing surface, in the order they naturally appear. Each fires once, dismisses
permanently via `user_states`, and never returns.

### Spotlight 1 — `sourcing_never_ordered`

| Field | Value |
|---|---|
| Key | `sourcing_never_ordered` |
| Trigger | `!activeVariantId && neverOrderedCount > 0` |
| Anchor | Inline, inside the Never Ordered Before section, above the variant rows |
| Step | 1 of 3 |
| Title | These products have no supplier yet |
| Body | Assign a supplier to each one — so when stock runs low, you already know who to order from. |
| Teaches | The Never Ordered group is an action queue. "Assign a supplier →" is the primary action. |

### Spotlight 2 — `sourcing_alert_triggered`

| Field | Value |
|---|---|
| Key | `sourcing_alert_triggered` |
| Trigger | `activeVariantId && !isLoadingRecs && goodMatches.length > 0` |
| Anchor | Inline, above the first ranked recommendation row |
| Step | 2 of 3 |
| Title | Your best supplier, ranked automatically |
| Body | Rankings are based on delivery speed, order accuracy, and quality from your real orders. Order now, or add to queue to combine with other products before sending. |
| Teaches | The ranked list is data-driven. Two paths exist: immediate PO or queue for accumulation. |

### Spotlight 3 — `sourcing_accumulator`

| Field | Value |
|---|---|
| Key | `sourcing_accumulator` |
| Trigger | `reorderRequests.length > 0` |
| Anchor | Inline, inside the Pending Reorders section, above the supplier rows |
| Step | 3 of 3 |
| Title | Building up your order before sending |
| Body | Products queue here by supplier. Once you've added enough to meet their minimum order, Create PO lights up. You can always send early if you need to. |
| Teaches | The accumulator is a staging area, not a dead end. MOQ progress is visible. Merchant controls when to convert. |

### Props pattern (for future Sourcing-adjacent spotlights)

Spotlights on module surfaces cannot call `useSpotlight()` directly —
the hook lives in `apps/frontend/src/` and the module boundary blocks that import.
Resolution is always at page level:

```typescript
// SuppliersPortalPage.tsx
const spotlightNeverOrdered = useSpotlight('sourcing_never_ordered');

// passed into module via sharedProps:
spotlights: {
  neverOrdered: { isDismissed: spotlightNeverOrdered.isDismissed, dismiss: spotlightNeverOrdered.dismiss },
  ...
}
```

The module receives spotlight state as plain props and renders
`<SpotlightCoachMark isDismissed={...} onDismiss={...} />` — purely presentational,
zero business logic in the module. This is the canonical pattern for all future
module-level spotlights.

### Moving `SpotlightCoachMark` to shared

`SpotlightCoachMark` was originally app-local
(`apps/frontend/src/components/SpotlightCoachMark.tsx`). It was moved to
`modules/shared/src/ui/SpotlightCoachMark.tsx` on 2026-07-11 to make it
importable from any module. The original file in `apps/frontend/src/components/`
remains for the Order Flow spotlight — it uses `useAppTheme()` internally
and has not been migrated. Do not remove it until Order Flow is refactored
to use the shared version with the controlled `isDismissed` / `onDismiss` props pattern.
