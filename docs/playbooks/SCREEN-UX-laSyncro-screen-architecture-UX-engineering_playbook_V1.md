# SCREEN-UX-ARCH-01 — LaSyncro Screen Architecture & UX Engineering Playbook V1

**Status:** Living engineering contract
**Version:** V1
**Last architecture update:** 2026-09-27
**Canonical scope:** LaSyncro operational screen architecture and UX normalization

This becomes the reference contract for the rest of the screen-by-screen sprint.

## 0. Playbook maintenance

Canonical path:
docs/playbooks/SCREEN-UX-laSyncro-screen-architecture-UX-engineering_playbook_V1.md

This is a living engineering contract.

Update this playbook whenever:
- an ownership boundary changes;
- a screen contract is locked or revised;
- a reusable UX rule is discovered;
- a screen receives or changes its spatial classification;
- attention ownership moves between a module and Ops Console;
- implementation intentionally deviates from the previously approved target;
- responsive or scroll behavior changes;
- local or production certification changes a screen's status;
- a component is reclassified as KEEP, REFINE, MOVE, MERGE, ON-DEMAND, or RETIRE.

Every future screen workshop must end with the corresponding playbook / registry update before implementation begins.

Do not allow screen-specific implementation to silently diverge from this playbook.

The objective is not to make every screen look like Overview. The objective is to make every screen participate correctly in one operational ecosystem:
Overview tells the whole-operation story. Ops Console manages attention, navigation, search and setup. Spatial views explain physical truth when location matters. Pulse communicates state, not tasks. Modules own execution. Local exceptions stay with the workflow that must resolve them.

## 1. Non-negotiable product ownership
Surface	Owns	Must not become
Ops Console	Global attention, global search, setup guidance, cross-module actionable work, notification/history surface	Another operational module
Overview	Whole-operation situational awareness	Execution dashboard or second Ops Console
Operations Pulse	Compact operational state/orientation	Task inbox or CTA collection
Live Spatial System	Physical/spatial truth and domain-specific spatial projections	Decorative warehouse graphic
Modules	Domain truth and execution	Independent global alert/navigation systems
Workflow-local exception UI	Exception that must be resolved in the current workflow	General alerts feed
Floor Planning	Canonical warehouse geometry/configuration	Operational monitoring dashboard
Global shell	Navigation, Ops Console, global search, sync/freshness, account/theme	Domain-specific workflow
Core distinction
STATE
"What is happening?"
→ may be shown in the relevant module.

ATTENTION
"What needs me?"
→ Ops Console owns this globally.

EXECUTION
"What do I do about it?"
→ owning module/workflow.

SPATIAL CONTEXT
"Where is this happening?"
→ shared spatial engine, only when useful.

## 2. Global UX contract
These capabilities are global and must not be independently reinvented by individual screens:
Top navigation
Ops Console
Cmd/Ctrl+K
Global Search
Attention state
Notifications/history
Setup guidance
Live/sync/freshness state
Account/theme controls
Ops Console remains available across operational screens.
Cmd/Ctrl+K means open/focus global search, never “toggle everything.”
The approved follow-up #1165 contract is:
Cmd/Ctrl+K, Console closed
→ open Console + focus search

Cmd/Ctrl+K, Console open
→ focus search

Escape + non-empty query/results
→ clear search, keep Console open

Escape + empty search
→ close Console

Escape elsewhere inside Console
→ close Console

### Shared visual-system reference

Overview is the PROD CERTIFIED visual reference for shared LaSyncro app/module
styling. This governs the shared visual language, not screen ownership,
information architecture, or layout.

The canonical styling contract is:
`docs/playbooks/modules-ux-playbook.md`

When normalizing a screen:

- reuse shared components and established design tokens before creating local styling;
- use the Overview/shared system as the reference for typography, color,
  surfaces/cards, borders, radii, spacing rhythm, CTA hierarchy,
  status/severity treatment, interaction states, and light/dark behavior;
- inspect the canonical shared/Overview implementation before approximating a
  local variant;
- do not copy Overview's layout, map dominance, information hierarchy, or
  screen composition unless the target screen contract independently requires it;
  this does not prohibit parity where the target screen contract explicitly
  calls for the same operational-screen composition — there, Overview's
  certified grammar is the reference (see Reusable operational-screen
  composition below);
- specialized workflow reference implementations may govern workflow behavior,
  but they inherit the shared visual system unless an explicit documented
  exception exists.

A new reusable visual pattern or intentional visual-system exception must be
recorded in the Modules UX Playbook. New or changed runtime tokens must remain
synchronized with the actual theme implementation.


### Reusable operational-screen composition

Operational screens should reuse the same interaction grammar when they solve
the same UX problem. Domain differentiation should come from truth, ownership
and workflow semantics rather than gratuitously different screen mechanics.

Canonical reusable behavior:

- the primary workspace remains stable when global shell surfaces open;
- a domain-specific Pulse/state rail may occupy the canonical secondary rail;
- when Ops Console opens, that domain rail withdraws completely rather than
  competing with global attention;
- Ops Console remains globally owned and must not be recreated inside modules;
- shared spatial screens reuse canonical geometry, interaction language,
  inspection treatment and workspace furniture where applicable;
- domain screens keep their own spatial projection and domain semantics.

The intended abstraction layers are:

1. app/global shell — Ops Console, global search, top navigation;
2. operational-screen shell — viewport composition and rail replacement;
3. shared spatial system — workspace frame, shared spatial engine and common
   interaction grammar;
4. domain projection — Orders, Inventory, Overview and other domain truth.

Extraction rule:
create a shared abstraction only when at least two real consumers demonstrate
the same stable contract. Do not create a universal operational dashboard or
move domain-specific decision logic into shared UI merely for visual reuse.

Overview parity rule:
when an operational screen solves the same UX problem as Overview, it mirrors
Overview's proven composition and interaction grammar as closely as domain
ownership allows — geometry, spacing, surface treatment, typography hierarchy,
CTA hierarchy, hover/focus behavior, selection/pinned behavior, transitions,
state animation, responsive choreography, loading/setup states and Ops Console
rail replacement. Domain differentiation comes from data, labels, projections,
contextual facts and workflow ownership, not from gratuitously different layout
or interaction mechanics. This applies only where the UX problem is the same;
it does not override the rule above against copying Overview's composition
into screens whose contract does not require it.

Reuse-first rule:
prefer the same existing component when it already owns the desired behavior —
especially `LiveMapTeaser` and `IsometricCanvas` — rather than visually
reproducing it locally.

Responsive operational-screen shell (`OperationalContextShell`):

- below `lg`: one-column composition;
- `lg`+: `minmax(0, 3fr) minmax(260px, 1fr)`;
- when Ops Console is open, the desktop secondary track stays reserved while
  the domain rail content withdraws, so the primary workspace does not reflow;
- below `lg`, a suppressed rail creates no empty stacked row or gap;
- below `lg`, the primary workspace precedes the domain rail;
- rail withdrawal is immediate — no fade, slide or width animation;
- at `lg`+, replacing the domain rail with Ops Console must not change the
  primary workspace's left, top or width.

Spatial inspection eligibility:

warehouse geometry ≠ domain inspection target.

A domain screen may restrict hover, selection and pinned inspection to the
locations for which it has truthful domain-specific facts. Non-inspectable
geometry may remain visible for orientation, but it must not imply hover,
selection or pinned interaction. The shared capability is optional
(`IsometricCanvas` `inspectableLocationCodes`): callers that pass no
eligibility set keep the historic inspect-all behaviour. Not every map must
restrict inspection.

Physical-location truth:

workflow activity ≠ known physical location.

An operator may be placed spatially only when there is actual physical-location
evidence. Do not infer an operator's position from the first zone, the nearest
zone, the workflow phase, parent/child geometry or a convenient renderer
target. Unknown location stays unknown; workflow and batch counts remain valid
without spatial placement.

Motion parity, operational border hierarchy and the token rule are recorded in
the Modules UX Playbook (Operational Screen Ecosystem Pattern — Overview →
Orders).


## 3. Screen archetypes
Every substantial screen gets one primary archetype.
Archetype	Primary question	Typical screens
Situational Awareness	What is happening across the operation?	Overview
Operational Context	What is happening in this domain and why?	Orders Overview, Inventory Intelligence
Execution Workspace	What work do I perform here?	Receive, Stow, Pick, Pack
Spatial Workspace	Where is something / how is physical space configured?	Floor Planning
Configuration / Administration	How is this capability configured?	Settings, integrations
A screen may consume capabilities from another archetype without changing its primary purpose.
Inventory Intelligence, for example, can remain an Operational Context screen while containing a strong Inventory spatial lens.

## 4. Spatial architecture
We now lock the spatial architecture as:
CANONICAL WAREHOUSE GEOMETRY
          ↓
SHARED SPATIAL ENGINE
          ↓
DOMAIN PROJECTION / LENS
          ↓
SCREEN PRESENTATION
We should not independently build:
OverviewMap
OrdersMap
InventoryMap
InboundMap
...
that eventually diverge.
Conceptually we want:
LiveWarehouseMap
  geometry
  lens
  overlays
  selection
  inspection
  navigation
with projections such as:
OverviewSpatialProjection
OrdersSpatialProjection
InventorySpatialProjection
InboundSpatialProjection
FulfillmentSpatialProjection
Same physical warehouse. Different operational story.

## 5. Spatial modes
Every screen receives exactly one spatial classification.
Mode	Meaning
PRIMARY	Spatial understanding/manipulation is central to the screen
CONTEXTUAL	Spatial information materially improves the primary workspace and deserves permanent space
ON-DEMAND	Useful for drill-down or selected entities but should not permanently consume viewport
NONE	Spatial representation adds insufficient value
Spatial value gate
A screen earns permanent spatial UI only if we can answer yes to most of these:
1. Does location materially affect the user's decision or execution?
2. Does the map reveal something substantially harder to understand in normal cards/tables?
3. Does seeing the spatial state enable a meaningfully different next action?
4. Can it coexist without weakening the primary workspace or scroll-free contract?
Otherwise:
NO MAP
Existing implementation is not justification.

## 6. Domain spatial stories
The same map must tell different stories depending on context.
Overview
Question:
Where is operational pressure across my warehouse?
Possible overlays:
receive pressure
stow pressure
pick pressure
pack activity
blocked/ready order pool
problem locations
active batches
Overview should remain broad and cross-domain.

Orders Overview
Spatial mode:
CONTEXTUAL — only if proven useful
Its spatial lens may show:
orders depending on specific pick zones
released-order workload concentration
batch concentration
inventory-location constraints affecting orders
fulfilment pressure by warehouse area
It should not merely reproduce the Overview warehouse picture.
If we cannot produce a meaningful Orders-specific story, demote/remove the permanent map.

Order Flow
Spatial mode:
ON-DEMAND
Order Flow already owns a strong workflow:
Blocked Orders
      ↓
Order Pool
      ↓
Fulfillment
That workspace gets the viewport.
Spatial context may appear for:
selected order
selected batch
required pick locations
inventory constraint
but not as a permanent competing pane.

Inventory Intelligence
Spatial mode:
CONTEXTUAL, potentially PRIMARY for some views
Inventory has intrinsically spatial questions:
Where is SKU X?
Where is unavailable stock expected?
Where is phantom inventory suspected?
Which locations are empty?
Which locations are over capacity?
Where is dead stock?
Which SKUs have stock but no valid pick face?
Where are inbound units awaiting stow?
Inventory therefore deserves a real domain spatial lens, not a copied Overview visualization.

Receive
Spatial mode:
CONTEXTUAL
Useful spatial concepts:
receiving dock
PO receipt location
staging area
stow destination pressure
Execution remains the Receive workflow.

Stow
Spatial mode:
PRIMARY / CONTEXTUAL
Physical destination is fundamental.

Pick
Spatial mode:
CONTEXTUAL
Location and route matter directly to execution.

Pack
Spatial mode:
NONE / ON-DEMAND
Pack is primarily station/task oriented.

Floor Planning
Spatial mode:
PRIMARY
Geometry is the product.

## 7. Attention ownership
This is one of the most important anti-duplication rules.
Workflow-local exception
Owned by the current module.
Examples:
Receive:
PO expects 20; operator scanned 18.

Pick:
assigned location cannot satisfy requested quantity.

Pack:
package validation prevents shipment.
These should appear directly where work is happening because they must be resolved there.
Cross-workflow attention
Owned by Ops Console.
Examples:
3 POs waiting to receive
27 orders past SLA
warehouse mapping incomplete
opening inventory reconciliation incomplete
8 orders require inventory attention
Modules may still display the underlying state, but should not create another actionable inbox.
Locked rule
Workflow-local exception
→ module owns it

Cross-workflow attention
→ Ops Console owns it

Domain aggregate/state
→ module may summarize it

Duplicate action queue
→ prohibited
This means existing generic surfaces such as:
NEEDS A DECISION
TODAY'S ACTIONS
WHAT NEEDS YOU
must be audited aggressively.
They may contain legitimate domain state, but many are likely historical mini-Ops-Consoles.

## 8. Pulse contract
Pulse is allowed when it materially improves orientation.
A Pulse:
summarizes
orients
communicates health/state
may navigate contextually
A Pulse does not:
become an action queue
duplicate Ops Console
own workflow remediation
contain arbitrary quick actions
Overview has the cross-domain Operations Pulse.
Modules may have compact domain-specific Pulse/state summaries only when they add useful orientation.
We should not automatically preserve existing Inventory Pulse, Today's Pulse, etc. Their semantics must pass the ownership audit.

## 9. Scroll-free contract

“Scroll-free” does not mean “all content everywhere must fit simultaneously.”

The canonical definition is:

The application document must not acquire accidental page-level scrolling at the certified viewport. The global shell remains stable and the primary workspace owns the available viewport.

Intentional screen-owned or workspace-owned internal scrolling is permitted when necessary to preserve usability, information hierarchy, legibility, or content density.

Responsive layouts do not have to preserve desktop geometry. A narrower viewport may stack or rearrange secondary surfaces rather than shrinking the primary surface below a useful size.

Preserve usability and information hierarchy before forcing simultaneous visibility of every region.

Target certification:
1440 × 720
1024 × 820

Document-level certification metric:
document.scrollingElement.scrollHeight - window.innerHeight <= 1

Canonical shape:
┌─────────────────────────────────────┐
│ Global shell                        │
├─────────────────────────────────────┤
│ Screen orientation                  │
├─────────────────────────────────────┤
│                                     │
│ PRIMARY WORKSPACE                   │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ internal scroll where required  │ │
│ └─────────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘

document-level accidental scroll = 0

Overview reference responsive behavior:

1440 × 720
→ Live Map + Operations Pulse remain side-by-side.
→ Live Map retains the dominant spatial role.

1024 × 820
→ Live Map remains large enough for useful spatial inspection and label legibility.
→ Operations Pulse may stack below the map.
→ Intentional workspace-owned scrolling is allowed where required.
→ Do not squeeze the map merely to preserve the wide-screen two-column geometry.

Certified Overview evidence:
1440 × 720 → scrollHeight=720, innerHeight=720, overflowPx=0, DOCUMENT_SCROLL_FREE=true
1024 × 820 → scrollHeight=820, innerHeight=820, overflowPx=0, DOCUMENT_SCROLL_FREE=true

Order Flow is a good example of the same rule: columns/lists may scroll internally while the application document itself remains viewport-owned.

## 10. Screen contract
Every screen gets a canonical record.
Template:
SCREEN
Canonical screen name

ROUTE
Current route

PRIMARY ARCHETYPE
Situational Awareness /
Operational Context /
Execution Workspace /
Spatial Workspace /
Configuration

PURPOSE
One sentence describing the user's job.

PRIMARY USER QUESTION
What question must this screen answer?

OWNS
Truth/workflows owned exclusively here.

REFERENCES
External domain truth shown contextually.

MUST NOT OWN
Capabilities owned elsewhere.

OPS CONSOLE
Required / special integration notes.

GLOBAL SEARCH
Normal shell behavior / exceptions.

PULSE
Yes / No / Conditional.
Exact reason.

SPATIAL MODE
PRIMARY / CONTEXTUAL / ON-DEMAND / NONE.

SPATIAL STORY
If applicable, what physical question does it answer?

PRIMARY WORKSPACE
What deserves the viewport?

LOCAL EXCEPTIONS
Which workflow-local exceptions belong here?

ATTENTION HANDOFF
What goes to Ops Console?

INTERNAL SCROLL
Which regions may intentionally scroll?

FIRST-VIEWPORT CONTRACT
What must remain visible?

CURRENT PROBLEMS
Known redundancy / layout / ownership issues.

TARGET COMPOSITION
Approved target screen structure.

CERTIFICATION
1440×720
1024×820
behavioral
visual
keyboard
Ops Console integration
production

STATUS
AUDIT
WORKSHOP
TARGET LOCKED
IMPLEMENTING
LOCAL CERTIFIED
PROD CERTIFIED

## 11. Engineering process for every screen
The engineering screen should guide the team through this exact lifecycle:
MAIN SYNC + CLEANLINESS
        ↓
CURRENT SCREEN INVENTORY
        ↓
PURPOSE + ARCHETYPE
        ↓
OWNERSHIP AUDIT
        ↓
SPATIAL VALUE TEST
        ↓
ATTENTION / OPS CONSOLE AUDIT
        ↓
SCROLL / VIEWPORT AUDIT
        ↓
WORKSHOP ONLY IF OWNERSHIP IS UNCLEAR
        ↓
TARGET SCREEN CONTRACT
        ↓
TEST STRATEGY
        ↓
IMPLEMENTATION
        ↓
TARGETED REGRESSION
        ↓
LOCAL BEHAVIORAL CERTIFICATION
        ↓
LOCAL VISUAL CERTIFICATION
        ↓
PRODUCTION CERTIFICATION
        ↓
SCREEN LOCKED
A screen should never jump directly from “looks bad” to implementation.

## 12. Component disposition during audit
Every significant existing component gets one disposition:
Disposition	Meaning
KEEP	Correct owner, useful, already aligned
REFINE	Correct owner but presentation/behavior needs adjustment
MOVE	Useful information, wrong surface
MERGE	Duplicates another surface and should consolidate
ON-DEMAND	Valuable but should not permanently occupy viewport
RETIRE	No longer fits the architecture
This should be visible in the Engineering UX Registry.

## 13. Engineering UX Registry
Recommended internal route:
/engineering/ux
This should not appear in merchant navigation.
Its job is not to preview pretty screens.
It is the canonical engineering control surface for screen architecture.
Registry overview
Top section:
SCREEN ARCHITECTURE

Registry summary counts must be derived from the actual screen records. Do not hard-code illustrative counts into the canonical registry.

Recommended summary metrics:
- PROD CERTIFIED
- LOCAL CERTIFIED
- IMPLEMENTING
- TARGET LOCKED
- WORKSHOP
- AUDIT / NEEDS AUDIT
- OWNERSHIP CONFLICT

Then the registry:
Screen	Route	Archetype	Spatial	Pulse	Ops Console	Scroll	Status
Overview  /overview  Awareness  PRIMARY  Cross-domain  Global  PASS at 1440×720 + 1024×820  PROD CERTIFIED / reference
Orders Overview	/orders	Context	CONTEXTUAL	Order health	Global	PASS at 1440×720 + 1024×820	PROD CERTIFIED
Orders Outbound	/orders/outbound	Operational Context	NONE	NO	Global / canonical rail replacement	PASS at 1440×720 + 1024×820	PROD CERTIFIED
Order Flow	/orders/flow	Execution/context	ON-DEMAND	No?	Global	Candidate	Needs audit
Inventory Intelligence	/inventory	Operational Context	CONTEXTUAL	Inventory state	Global	PASS at 1440×720 + 1024×820	LOCAL CERTIFIED
WMS	/wms	Execution	Conditional	likely no	Global	Audit	Needs audit
Receive	…	Execution	CONTEXTUAL	No	Global	Audit	Needs audit
Stow	…	Execution	PRIMARY/CTX	No	Global	Audit	Needs audit
Pick	…	Execution	CONTEXTUAL	No	Global	Audit	Needs audit
Pack	…	Execution	NONE/OD	No	Global	Audit	Needs audit
Floor Planning	/floor-planning	Spatial	PRIMARY	No	Global	Audit	Needs audit
Question marks mean decision not yet certified, not implementation uncertainty.

## 14. Registry screen detail
Selecting a row should open a detail workspace with four columns/sections.
CURRENT
What exists now:
Map
Needs a Decision
Today's Pulse
Export
tabs
tables
CTAs
banners
alerts
etc.
Each gets its disposition.
OWNERSHIP
Owns
References
Ops Console handoffs
Local exceptions
Forbidden duplicates
TARGET
Example:
Orders Overview

Orientation
↓
Order-domain state
↓
Orders spatial lens only if value gate passes
↓
order-domain workspace/drilldowns

NO local task inbox
NO duplicate global alerts
NO generic warehouse map
CERTIFICATION
□ source contract
□ targeted tests
□ Ops Console coexistence
□ keyboard
□ 1440×720
□ 1024×820
□ dark
□ light
□ local runtime
□ production

## 15. Initial screen audit priorities
The rollout order should now be:
OVERVIEW
Slice D scroll-free responsive contract ✅
↓
Final consolidated Overview certification + docs
↓
Build Screen Architecture Registry V1
↓
ORDERS
↓
ORDER FLOW
↓
INVENTORY
↓
WMS
↓
RECEIVE / STOW / PICK / PACK
↓
INBOUND / SUPPLIERS / PO
↓
FLOOR PLANNING
↓
remaining screens
Orders and Inventory should be the first post-Overview audits because together they test our two hardest architectural questions:
Orders: When does a spatial view not deserve permanent space?
Inventory: How does a domain spatial lens become more useful than the generic Overview map?
If those two contracts work, we will have a strong pattern for the remainder of the application.

## 16. Current Overview registry record
We can already register Overview:
SCREEN
Overview

ROUTE
/overview

ARCHETYPE
Situational Awareness

PURPOSE
Provide immediate whole-operation orientation.

OWNS
Cross-domain operational state
Whole-warehouse spatial context
Operations Pulse

REFERENCES
Orders
Fulfillment
Inventory
Inbound

MUST NOT OWN
Workflow execution
Global action queue
Setup execution
Second alert inbox

OPS CONSOLE
Global attention/action owner.
When open, Operations Pulse withdraws.

PULSE
YES
Cross-domain Operations Pulse:
Orders
Fulfillment
Inventory
Inbound

SPATIAL MODE
PRIMARY

SPATIAL STORY
Where operational pressure exists across the warehouse.

PRIMARY WORKSPACE
Live warehouse map + Operations Pulse.

INTERNAL SCROLL
No accidental document-level scrolling at certified viewports.
Workspace-owned scrolling is allowed at narrower layouts where required to preserve map legibility.

RESPONSIVE CONTRACT
1440 × 720:
Live Map + Operations Pulse side-by-side.
Document overflow = 0.

1024 × 820:
Live Map remains legible.
Operations Pulse may stack below.
Workspace-owned scrolling permitted.
Document overflow = 0.

CERTIFIED VIEWPORT EVIDENCE
1440 × 720 → DOCUMENT_SCROLL_FREE=true, overflowPx=0
1024 × 820 → DOCUMENT_SCROLL_FREE=true, overflowPx=0

STATUS
Slice A ✅
Slice B ✅
Slice C ✅
Slice D ✅
Slice E ✅
Slice F ✅

FINAL CERTIFICATION
Source SHA: 6d63893d34ac438b31b912cd9a54261cfe438a8d
Targeted regression: 7 suites / 227 tests PASS
Local behavioral certification: PASS
Local visual certification: PASS
Production release: Fly v743
Production health: PASS
Production browser certification: PASS
Overview is the PROD CERTIFIED reference screen for the screen-by-screen UX normalization sprint.

## 17. Orders Overview registry record

SCREEN
Orders Overview

ROUTE
/orders

PRIMARY ARCHETYPE
Operational Context

PURPOSE
Understand order health, constraints, lifecycle and fulfilment state without becoming a second Ops Console or Order Flow.

PRIMARY USER QUESTION
What is happening to my orders, why, and where is fulfilment pressure?

OWNS
Order health
Constraint state
SLA / aging state
Order lifecycle context
Commercial consequence
Individual order inspection
Order-domain spatial pressure

REFERENCES
Canonical warehouse geometry through the shared spatial engine
Order-linked fulfilment activity
Batch / picking activity where relevant to order context
Inventory-location constraints affecting orders
Order Flow state where contextual navigation is useful

MUST NOT OWN
Global attention inbox
Cross-module actionable queue
Release planning
Release execution
Priority mutation
Whole-operation warehouse awareness
Cross-module setup/remediation

OPS CONSOLE
Global attention remains owned by Ops Console.
Orders may show the underlying order-domain state, severity and commercial consequence.
Orders must not create a competing actionable attention inbox.
The duplicate is removed architecturally rather than conditionally hidden when Ops Console opens.

GLOBAL SEARCH
Normal global-shell Cmd/Ctrl+K behavior.
No Orders-specific replacement or override.

PULSE
YES — as a compact domain-specific state summary named Order health.
It may summarize Breached, Blocked, Picking, Fulfillable and useful aging/risk state.
It must not become an action queue or claim cumulative metrics are today's activity.
The legacy "Today's pulse" naming is retired.

SPATIAL MODE
CONTEXTUAL

SPATIAL STORY
Where is order-related fulfilment pressure physically concentrated?

The Orders lens may use real order/batch activity projected onto canonical warehouse geometry.
It must not reproduce the generic Overview warehouse story.
It must not invent inventory occupancy or fabricated locations.

SPATIAL INSPECTION
Orders passes the shared optional inspection-eligibility set: only locations
with a truthful Orders LocationPulse are hover/select/pin targets. Orders-silent
bins remain plain geometry for orientation — no dimming, hover plate, selected
outline, pinned plate or pinned action.

OPERATOR PLACEMENT
Operators are placed only from physical-location evidence (a picker's latest
confirmed scan location). Unscanned pickers are not anchored to a first or
nearest zone; their batches still count.

CURRENT PACKER LIMITATION
The current data model has no truthful packer station/location field (pack
scans carry no location), so the current live spatial projection does not
place packers. This is present data-contract reality, not permanent product
doctrine; packer placement becomes valid once real location evidence exists.

PRIMARY WORKSPACE
Contextual Orders spatial workspace (live map, teaser, loading, error or
floor-setup state in one stable slot; live frame min-height 520px; footer with
"Open order flow →")

DOMAIN RAIL
Order health — Breached / Blocked / Picking / Fulfillable, Constraints & aging,
Checking / Verifying / Just resolved lifecycle state, "View order flow →".
State and orientation only: not a task queue, global attention, release
planning or priority mutation.

LOCAL EXCEPTIONS
Orders Overview does not own workflow remediation.
It may expose order-domain constraint truth and inspection context.
Resolution remains with the workflow that actually owns the required action.

ATTENTION HANDOFF
Cross-workflow actionable attention goes to Ops Console.
Orders retains the domain state behind that attention without duplicating the global action queue.

INTERNAL SCROLL
No accidental document-level scrolling at certified viewports.
Workspace-owned internal scrolling is allowed where required to preserve information hierarchy and spatial legibility.

OPERATIONAL SHELL (shared `OperationalContextShell`)
lg+, Ops Console closed:
[PRIMARY WORKSPACE][DOMAIN RAIL — Order health]

lg+, Ops Console open:
[PRIMARY WORKSPACE][OPS CONSOLE]
Order health withdraws; the primary workspace left, top and width do not change.

below lg:
single column — primary spatial workspace first, Order health below it when
Ops Console is closed; Order health suppressed cleanly (no empty row or gap)
when Ops Console is open.

FIRST-VIEWPORT CONTRACT
At 1440 × 720:
- the Orders spatial workspace is the dominant primary track;
- Order health occupies the canonical right rail;
- secondary utilities remain de-emphasized;
- no local global-attention inbox;
- no accidental document scroll.

At 1024 × 820:
- single column, spatial workspace first, Order health below;
- no second-column geometry;
- intentional workspace-owned scrolling is allowed;
- no accidental document scroll.

PRE-NORMALIZATION PROBLEMS (historical — resolved by the certified implementation)
"Needs a decision" behaves too much like a mini Ops Console.
"Today's pulse" mixes useful domain state with semantically incorrect cumulative metrics.
Prioritization mutates Order Flow release planning and is owned by the wrong surface.
Export receives excessive first-viewport prominence.
The legacy no-map fallback changes Orders into a different triage-first architecture.

COMPONENT DISPOSITIONS
Orders-specific live map
→ KEEP / REFINE as CONTEXTUAL Orders spatial lens

"Needs a decision"
→ RETIRE current actionable-inbox composition
→ MERGE legitimate underlying state into Orders domain context

Checking operational state
→ KEEP / REFINE

Verifying
→ KEEP / REFINE

Just resolved
→ KEEP / REFINE

"Today's pulse"
→ REFINE / RENAME to Order health
→ remove misleading today-vs-cumulative semantics

Critical order inspection
→ KEEP
→ secondary / on-demand detail

Watch / aging state
→ KEEP STATE / REFINE presentation

Individual order inspection
→ KEEP

Prioritize
→ REMOVED from Orders Overview (Order Flow owns priority)

Bulk prioritize
→ REMOVED from Orders Overview (Order Flow owns priority)

View order flow
→ KEEP as contextual navigation

Export
→ KEEP as secondary utility / DE-EMPHASIZE

Legacy triage-first no-map fallback
→ RETIRED — one composition for every input; no triage-first variant

CURRENT COMPOSITION
ORDERS header — domain orientation + secondary utilities
↓
OPERATIONAL SHELL
[Orders spatial workspace][Order health | Ops Console]

NO local global-attention inbox
NO release-priority mutation
NO generic warehouse map
NO duplicate Overview workspace
NO duplicate Order Flow workspace

CERTIFICATION
Local certification (2026-09-28): PASS
Production certification: PASS
Production release: Fly v746
Deployed main SHA: 1f4cf55a4420af42b1eb08d6bd1f4b1370d2c739

Certified at 1440 × 720 (desktop) and 1024 × 820 (below-lg):
Light / dark: PASS
Ops Console closed / open (rail replacement): PASS
Primary workspace geometric stability: PASS
Document / horizontal overflow ≤ 1: PASS
Projection-health banner ("Data is not updating") absent: PASS
Silent-bin hover/select (Orders-silent bins stay plain geometry): PRODUCTION PASS

Active-location hover/select: AUTOMATED PASS / PRODUCTION BROWSER NOT OBSERVED / NON-BLOCKING
No truthfully located active picker existed during certification, and none was
manufactured. Once one naturally exists, the expected browser path is:
hover → shared map dimming/focus → transient Orders contextual plate;
click → persistent selected outline → pinned contextual plate → "Open order flow →";
close → selection clears → map returns to neutral state.

STATUS
PROD CERTIFIED

WORKSHOP
Phase 3 approved 2026-09-27.

IMPLEMENTATION
Complete — shared OperationalContextShell, Order health rail, optional
IsometricCanvas inspection eligibility, evidence-only operator placement.


## 18. Certified Inventory Intelligence contract — LOCAL CERTIFIED

Supersedes the former Inventory hypothesis, candidate overlays and pending
ownership audit in this section. This records local certification only.

**Screen:** `/inventory` · **Archetype:** Operational Context.

**JTBD:** “What inventory do I physically have, where is it, what is actually
available, and where is inventory truth uncertain?”

**Orientation:** “Physical stock, availability and inventory truth by location”.

**Composition and ownership:** `OperationalContextShell` owns the spatial
primary workspace and contextual **Inventory state** secondary rail. The rail
contains exactly **On hand · Available · Reserved · Not received · Phantom ·
No valid pick location**. It provides state/orientation, not a task queue.
Ops Console owns global/actionable cross-workflow attention; execution remains
in owning workflows. No duplicate mini Ops Console. **Needs a decision, Margin
at risk, Inbound, Dead capital, Stocked out** and the legacy **Inventory Pulse**
task-queue treatment are retired from this surface.

**Responsive contract:** `lg`+ uses canonical shell geometry
`minmax(0, 3fr) minmax(260px, 1fr)`, not an Inventory-only fixed 280px rail.
Below `lg`, primary comes first and Inventory state stacks below it. Opening
Ops Console withdraws the domain rail at `lg`+ while the canonical secondary
track remains reserved; below `lg`, Inventory state is fully suppressed with
no blank row or gap. The app owns necessary below-`lg` content scrolling.

**Shared map interaction:** Overview defines the canonical grammar;
Inventory changes the data through shared `LocationPulse` + `IsometricCanvas`,
not a separate popup/modal/map system. Hover provides minimal orientation;
click/select persists inspection through the same pulse. Shared `IsometricBox`
accent/dashed selection and geometry focus + pulse provide accessible focus,
without a browser rectangular focus box. Enter / Space select; Escape clears.
Inventory map inspection is read-only, with no Receive/Stow/Recount/order
mutation action.

- Hover: location identity, On hand, Available, SKU count.
- Selected/pinned: location identity/type, On hand, Available, Reserved;
  exceptional Truth only when not Confirmed; compact full SKU list with
  per-SKU On hand · Available · Reserved. All SKUs remain available through
  internal scrolling, without repeated prose or a CTA.
- Shared hover and ordinary pinned defaults remain 228px. The optional shared
  `IsometricCanvas` capability `pinnedPulseWidth?: number` lets Inventory opt
  into 288px for dense SKU inspection; it is not a global width requirement
  or an Inventory-specific card. Pinned inspection remains viewport bounded
  and internally scrollable.
- Only positioned physical locations carrying canonical Inventory inspection
  truth are inspectable. ROOT is not inspectable; missing occupancy/truth is
  not rendered as confirmed empty.

**Inventory truth:** On hand is physical truth; Reserved is released-order
reservation truth; Available is independently stored/clamped available truth.
Sellable = Available; Committed is deprecated / zero. Missing truth rows do
not mean zero; Not received differs from confirmed zero stock. Shopify initial
stock is not physical warehouse truth. Receive / Reconcile establish truth,
Stow relocates truth, and Pick / Ship consume truth.

**Commercial access:** The existing `inventory.live_map` access decision
remains authoritative: denied means no geometry fetch + `LiveMapTeaser`;
allowed uses floor planning, operational-floor eligibility and occupancy.

**Local certification evidence supplied for this closeout:**

- 1440×720: PASS. 1024×820: PASS.
- At 1024×820, primary and Inventory state stack in one column; the rail is
  reachable through the app-owned scroll surface. Ops Console suppresses it
  completely, with no reserved blank gap; primary horizontal geometry stays
  stable. Document horizontal overflow = 0; document vertical overflow = 0.
- Local behavioral acceptance: PASS. Local visual acceptance: PASS.
- Cumulative frontend Inventory/map regression: 11 suites / 85 tests PASS.
  Backend Inventory integration: PASS via `backend-integration` +
  `with-test-db.js`. Shared and backend typechecks: PASS. Frontend touched-source
  errors: 0; frontend-wide baseline: 19 unrelated errors. `git diff --check`: PASS.
- `F1_INVENTORY_PULSE_CONTENT=LOCKED`, `F2_LIVE_MAP_VISUAL_ALIGNMENT=LOCKED`,
  `E2_PINNED_VIEWPORT_BOUNDING=LOCKED`,
  `INVENTORY_UX_CUMULATIVE_REGRESSION=PASS`,
  `INVENTORY_1440x720_CERTIFICATION=PASS`,
  `INVENTORY_1024x820_CERTIFICATION=PASS`.

These are local results, not production certification or deployment evidence.

## 18A. Orders Outbound registry record — PROD CERTIFIED

SCREEN
Orders Outbound

ROUTE
/orders/outbound

PRIMARY ARCHETYPE
Operational Context

PURPOSE
Understand what has physically shipped, whether shipment tracking/carrier
truth is complete, and inspect outbound shipment state.

PRIMARY USER QUESTION
What has shipped, what tracking/carrier truth is missing or exceptional,
and what outbound state needs review?

PRIMARY WORKSPACE
Shipped Orders ledger

DOMAIN RAIL
Shipping State

SPATIAL MODE
NONE

PULSE
NO

ATTENTION OWNERSHIP
No local actionable inbox. Cross-workflow actionable attention remains
Ops Console-owned. Outbound may expose domain state and contextual filtering.
"Review missing tracking" is navigation/filtering into the ledger, not
remediation ownership.

OPS CONSOLE
Uses canonical OperationalContextShell rail replacement:
- lg+ Shipping State withdraws;
- the secondary track remains reserved;
- primary geometry remains stable;
- below lg the rail is fully suppressed with no blank stacked gap.

CANONICAL DATA
GET /api/v1/orders/outbound

MEMBERSHIP
Physical shipment truth only:
order_warehouse_status.status='shipped'
AND shipped_at IS NOT NULL

Generic Shopify fulfillment alone does not establish Outbound membership.

FILTER MODEL
Independent filters:
- state: All / Needs action / Missing tracking / In transit / Delivered;
- period: This week / This month / All time;
- search: order number / SKU / customer.

Server owns pagination, sort and filtering.

PERIOD
Calendar periods in shop timezone using shipped_at.

SHIPPING STATE RAIL
Period-scoped backend summary:
- Shipped orders;
- With tracking;
- Missing tracking;
- Tracking coverage;
- Avg time to ship;
- Carrier setup.

Known zero is distinct from unavailable/unknown.
No Value shipped aggregate: multiple order currencies may exist and no
truthful single-currency aggregate is currently established.

TRACKING / CARRIER TRUTH
Tracking replaces legacy "Proof".
Physical carrier uses provider_carrier_code when known.
shippo/sendcloud are providers and are not presented as physical carriers.
Live status preserves announced / in_transit / out_for_delivery / delivered /
exception / returned / unknown.
Stalled context does not erase the underlying carrier state.
No fabricated "Not sent" or "No carrier".

CURRENCY
Per-row actual order currency.

ORDER DETAIL
Canonical EntityDetailModal + OrderDetailModalBody.

EXPORT
Shared ExportDrawer report id:
orders-outbound

Canonical export:
POST /api/v1/exports/orders/outbound

Uses the same physical-shipment membership and latest tracking truth as the
screen. Required export truth includes:
- external_order_id;
- shipped_at;
- total_price;
- currency;
- tracking_number;
- carrier;
- live_status.

External identity selection is deterministic:
earliest external_order_identity_map row by eim.id ASC.

SCROLL / VIEWPORT
At 1440×720:
- [Shipped Orders][Shipping State];
- equal top edges and equal bottom edges;
- ledger rows scroll internally;
- filters/header/pagination remain fixed;
- no accidental document vertical/horizontal overflow;
- Ops Console replacement leaves primary geometry unchanged.

At 1024×820:
- single column, primary first, Shipping State below;
- app/workspace-owned scrolling allowed;
- Ops Console suppresses the rail with no blank gap;
- no horizontal overflow.

LOCAL CERTIFICATION
Evidence supplied for this documentation gate:
- Slice A architecture tests: PASS;
- Slice B backend read-model tests: 9/9 PASS;
- Slice C filter-model tests: 8/8 PASS;
- Slice D truth-model tests: 19/19 PASS;
- Slice E Outbound automated matrix: 40/40 PASS;
- Slice E neighbor regression: 48/48 PASS;
- Slice E browser: 1440×720 dark/light PASS; 1024×820 dark/light PASS;
  Ops Console open/closed PASS; equal-height desktop PASS;
  internal ledger scroll PASS;
- Slice F export contract: 8/8 PASS;
- export commercial/access regressions: PASS;
- backend typecheck: PASS;
- frontend touched-source errors: 0; pre-existing global baseline unchanged.

PRODUCTION CERTIFICATION
Production evidence supplied for this documentation gate, for the exact
deployed SHA:
b931816015019afe6782f1ca2dc1898c80853c56

Commit: feat(orders): rebuild outbound around shipment truth
CI — UI modules #477: PASS
CI / RLS Security Boundary #288: PASS
Fly Deploy #1577: PASS
Fly deployment completed successfully.

Production route: /orders/outbound
Production UI: PASS
Production runtime: PASS
Production zero-state: PASS
Production API: PASS
Production export: PASS
Production visual/browser smoke: PASS

PRODUCTION UI / INTERACTION EVIDENCE
Observed successfully in production:
- Outbound route loads;
- Shipped Orders primary present;
- Shipping State rail present;
- Ops Console open suppresses Shipping State rail;
- no blank secondary gap remains when Ops Console is open;
- dark mode and light mode;
- collapsed sidenav and expanded sidenav;
- Outbound ExportDrawer scope.

The exact 1440×720 numerical DOM geometry measurement was explicitly waived
during production certification. No numeric production geometry evidence is
claimed. Local certification remains applicable for equal desktop primary/rail
geometry, scroll containment, 1024×820 behavior, 1440×720 behavior and
Ops Console primary stability.

PRODUCTION API EVIDENCE
GET /api/v1/orders/outbound
Initial expired access-token request: 401 TOKEN_EXPIRED, refreshable=true.
Normal refresh/retry path: 200 OK.
No persistent 4xx/5xx and no request loop observed.
Successful response contained orders, total, page, limit, state, period,
and summary.

Observed zero-state summary:
- shipped_count = 0;
- with_tracking_count = 0;
- missing_tracking_count = 0;
- tracking_coverage_pct = null;
- avg_time_to_ship_hours = null.

PRODUCTION EXPORT EVIDENCE
POST /api/v1/exports/orders/outbound
HTTP 200; Content-Type text/csv.
Attachment filename: lasyncro-outbound-orders-2026-10-04.csv
Observed CSV headers, in order:
order_id, external_order_id, shipped_at, total_price, currency,
tracking_number, carrier, live_status, channel, sku_count, shipping_country.

The generic POST /api/v1/exports/orders was NOT used by the Outbound report.
Production ExportDrawer description observed:
"Physically shipped orders with ship date, tracking, carrier, and live status."

PRODUCTION ROW-LEVEL LIMITATION — NON-BLOCKING
The production certification shop had 0 physically shipped Outbound orders.
REAL_SHIPPED_ROW_PROD_EVIDENCE=NOT AVAILABLE

No populated shipped-order row, real production tracking_number, carrier or
live_status values, per-row currency rendering, or populated Order Detail
from an Outbound row was demonstrated in production. These behaviors are
covered by automated/local certification; populated production Outbound-row
evidence remains unavailable. This is a NON-BLOCKING certification limitation.

STATUS
PROD CERTIFIED

PROD CERTIFIED does NOT mean every deferred product limitation is solved.

DEFERRED / KNOWN LIMITATIONS
Recorded without remediation in this documentation gate:
- partially_shipped representation;
- shipped→cancelled historical Outbound membership;
- Shopify-side tracking ingestion;
- multi-parcel representation beyond the latest tracking row;
- truthful cross-currency aggregate "Value shipped";
- broader Ops Console admission policy for carrier alerts;
- pagination footer may need future condensation at very large page counts.

## 19. Enforcement rule for engineers
The registry should display this prominently:
Do not preserve a component because it already exists. Do not add a component because another screen has one. Add or retain it only because the screen's purpose and ownership contract require it.
And specifically for maps:
Same spatial engine does not mean same spatial story.
And for Ops Console:
Every screen participates in the global attention model. No screen creates a competing global action system.
And for responsive design:
Scroll-free means zero accidental document-level scrolling at certified viewports, not artificially removing every scrollbar.
Intentional workspace-owned scrolling is permitted.
Responsive layouts may change composition to preserve the primary surface's usefulness and legibility.

## 20. Definition of Done for a normalized screen
A screen is not considered normalized until all of these are true:
Purpose is explicit
Primary archetype is explicit
Ownership boundaries are explicit
Ops Console integration is explicit
Local exceptions are explicit
Spatial mode is explicit
Pulse decision is explicit
Duplicate surfaces are removed
Primary workspace owns the viewport
Document-level scroll contract passes
Intentional internal/workspace scrolling is explicitly owned and justified where present
1440×720 passes
1024×820 passes
Keyboard behavior passes
Dark/light pass
Targeted regression passes
Production certification passes
Registry status = PROD CERTIFIED
