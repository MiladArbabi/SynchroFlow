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
Orders Overview	/orders	Context	CONTEXTUAL?	Audit	Global	Audit	Needs audit
Order Flow	/orders/flow	Execution/context	ON-DEMAND	No?	Global	Candidate	Needs audit
Inventory Intelligence	/inventory	Context	CONTEXTUAL	Audit	Global	Audit	Needs audit
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

## 17. Current Orders hypothesis
Not yet certified, but this is the starting hypothesis for its audit:
SCREEN
Orders Overview

ARCHETYPE
Operational Context

PURPOSE
Understand overall order health, constraints and fulfilment state.

SPATIAL MODE
CONTEXTUAL — MUST PROVE VALUE

POSSIBLE SPATIAL STORY
Where order-related fulfilment workload is physically concentrated.

CURRENT RISKS
Generic warehouse map may duplicate Overview.
"Needs a Decision" may duplicate Ops Console.
"Today's Pulse" may overlap Overview/Pulse.
Export may consume unnecessary first-viewport attention.

NEXT
Inventory audit before changing implementation.
This is a hypothesis, not yet a locked target.

## 18. Current Inventory hypothesis
SCREEN
Inventory Intelligence

ARCHETYPE
Operational Context

PURPOSE
Understand inventory truth, availability, quality and physical distribution.

SPATIAL MODE
CONTEXTUAL / candidate for strong domain lens

SPATIAL STORY
Where inventory physically exists and where inventory problems are concentrated.

POSSIBLE OVERLAYS
SKU locations
occupancy
stockout
phantom
missing pick face
dead stock
inbound awaiting stow

CURRENT RISKS
"Needs a Decision" may duplicate Ops Console.
"Inventory Pulse" requires ownership review.
Current map may not yet tell enough Inventory-specific truth.

NEXT
Formal audit later.

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
