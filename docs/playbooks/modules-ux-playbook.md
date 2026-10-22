# LaSyncro — Modules UX Playbook

> **Scope:** Webapp FT2 modules — all operator-facing surfaces. Auth pages (`apps/frontend/src/pages/authentication/*`) are a **brand surface**, governed by `docs/blueprints/auth_blueprint.md` — the font ban and layout rules below do not apply there.
> **Last updated:** 2026-09-28
> **2026-09-28 — Orders Overview (ORD-UX-02) production certified** (Fly v746) as the second consumer of the operational-context shell grammar. See §1 (Operational Screen Ecosystem Pattern) and the ORD-UX-02 entry.
> **2026-09-14 — WMS operator-session UX contract ratified using Receive as the reference implementation.** See §22 for focus-shell, Work Note, scanner-focus, reconciliation, typography, completion-evidence, and handoff rules that future Receive / Stow / Pick session work must preserve.
> **Inventory Intelligence — LOCAL CERTIFIED.** Shared `OperationalContextShell`, Inventory state rail and canonical live-map inspection; see §18 for the current contract.
> **2026-07-22 — Historical: Inventory Intelligence adopted the shared `PulseCard`.** The PULSE-02A layout is superseded by the certified Inventory contract in §18.
> **2026-07-17 — Catalog Status severity order gained a 4th tier.** "Not received" (SKU exists, no `inventory_truth` row — never received into warehouse) now ranks above Phantom as the highest severity: `not received > phantom > zero-stock > no-SKU > sellable`. Distinct from Zero stock (confirmed empty inventory row) — conflating the two sends operators to the wrong workflow (reorder vs. check receiving).
> **2026-06-21 — Suppliers Portal gained standalone supplier CRUD.** Suppliers were previously create-only inside the New-PO dialog; the portal's Suppliers list now supports add/edit/remove without a PO. Pattern: a single reusable `SupplierFormDialog` (mode `add` | `edit`) drives every supplier entry point for identical fields + validation; "Add supplier" uses the filled-accent CTA convention (per CTA-016); per-row Edit/Delete are outlined inline actions. Delete is a **soft-delete** (`active = false`) — `purchase_orders.supplier_id` is `ON DELETE RESTRICT`, so PO history is preserved and the supplier is hidden from new POs. Place record-management CRUD on the owning operational surface, not in Settings (which is for shop config, not records).
> **2026-06-20 — Catalog adopted the canonical triage + compact health-rail layout.** Catalog is the reference for a **full-width sortable column grid**: a shared `gridTemplateColumns` constant drives both header and rows (Product · Variants · On-hand · Available · Status · Action), with every header sortable using the `↑/↓` affordance. Avoid the legacy fixed stat-card grid for new module surfaces.

---

## 1. Design System Foundations

### Canonical Visual System Reference — Overview

Overview is the production-certified reference implementation for the shared
FT2 visual language across LaSyncro operational screens.

This means new and transformed screens should inherit the established system for:

- Plus Jakarta Sans typography and hierarchy;
- canonical color tokens rather than local hardcoded colors;
- page, surface and card treatments;
- borders and radius;
- spacing rhythm and alignment;
- CTA hierarchy and interaction styling;
- live severity/status treatment;
- hover, selected, disabled and confirmed states;
- responsive component behavior;
- light/dark parity.

Prefer shared components and existing canonical implementations over local
approximations.

Overview is a **visual-system reference, not a layout template to copy blindly**.
It is not copied across unrelated archetypes: a domain screen must still follow
its own screen-architecture contract for purpose, ownership, information
hierarchy, spatial mode and viewport composition. When another screen solves the
same UX problem and its approved architecture calls for the same operational
composition, Overview's certified composition and interaction grammar is the
reference (see Operational Screen Ecosystem Pattern — Overview → Orders).

Specialized reference implementations may still govern workflow-specific
behavior — for example Receive for operator-session behavior — but they inherit
this shared visual language unless this playbook explicitly documents an
exception.

When a screen introduces a genuinely reusable visual pattern or an intentional
exception, update this playbook rather than allowing the screen to become a
parallel local design system.


### Operational Screen Ecosystem Pattern — Overview → Orders

Overview is the production-certified interaction and visual reference when
another operational screen has the same UX problem.

Reuse includes, where applicable:

- the primary-workspace + canonical-right-rail composition;
- stable primary-workspace geometry while Ops Console opens;
- domain Pulse withdrawal while Ops Console occupies the attention rail;
- surface, border, radius and spacing treatment;
- warehouse/context badge placement;
- spatial workspace footer grammar;
- hover, selected and inspection interaction treatment;
- teaching/setup, teaser, loading and error states inside the same workspace;
- shared CTA and severity semantics.

The canonical rail rule is:

OPS CONSOLE CLOSED
→ primary workspace remains visible
→ domain Pulse/state rail occupies the secondary rail

OPS CONSOLE OPEN
→ primary workspace remains stable
→ domain Pulse/state rail withdraws completely
→ Ops Console owns the attention rail

The domain Pulse is orientation/state, never a duplicate global attention queue.

For Orders:

- the rail becomes Order Health rather than `Needs a decision`;
- legitimate order state remains Breached / Blocked / Picking / Fulfillable
  plus useful lifecycle/aging context;
- Ops Console owns actionable cross-workflow attention;
- Order Flow owns release planning and fulfilment execution;
- Orders spatial content remains an Orders-specific projection of canonical
  warehouse geometry.

Overview is still not copied blindly. Domain truth, spatial overlays, labels,
inspection facts, contextual navigation and workflow ownership remain local to
the owning domain.

Reusable implementation direction, proven incrementally through Orders:

- `OperationalContextShell` — primary workspace + canonical secondary rail;
- app-level Ops Console replacement wiring feeding that shell;
- `DomainPulseRail` semantics layered over the existing shared `PulseCard`;
- `SpatialWorkspaceFrame` for common spatial surface furniture;
- shared spatial inspection treatment when Overview + Orders demonstrate parity;
- existing shared `IsometricCanvas` remains the spatial engine;
- domain-specific spatial projection/adapters remain domain-owned.

Do not pre-build all abstractions before they are required by the Orders slice.
Extract only where real Overview + Orders duplication proves a stable contract.

#### Overview parity rule

When an operational screen solves the same UX problem as Overview, it mirrors
Overview's proven composition and interaction grammar as closely as domain
ownership allows. This includes geometry, spacing, surface treatment,
typography hierarchy, CTA hierarchy, hover/focus behavior, selection/pinned
behavior, transitions, state animation, responsive choreography,
loading/setup states and Ops Console rail replacement.

Domain differentiation comes from data, labels, projections, contextual facts
and workflow ownership — not gratuitously different layout or interaction
mechanics.

#### Reuse-first rule

Prefer the same existing component when it already owns the desired behavior —
especially `LiveMapTeaser` and `IsometricCanvas` — rather than visually
reproducing it locally.

#### Motion parity

Do not invent motion for Orders. Reuse Overview's motion only for the
corresponding state:

| State | Overview motion |
|---|---|
| Pulse/group row hover | `background-color` transition `0.12s` |
| Ops Console / domain rail replacement | immediate — no fade, slide or width animation |
| Spatial loading shimmer (where an equivalent loading state exists) | `1.6s ease-in-out` |
| Setup/teaching accent indicator (where an equivalent state exists) | `2.4s ease-in-out` |
| Warning footer indicator (where an equivalent warning state exists) | `2s ease-in-out` |

Static/healthy state does not pulse merely for visual activity — Overview's
footer indicator animates only while its warning state is present.

#### Operational border hierarchy

- Operational workspace, card and separator hairlines may use
  `0.5px solid var(--rule)` when matching the certified Overview composition.
- Interactive controls and inspection boundaries use the existing appropriate
  `1px` rule.
- Keyboard focus remains the stronger `2px solid var(--accent)` outline.
- Do not arbitrarily mix border weights.

#### Token rule

Do not copy raw hardcoded hex values from legacy/reference source into new
reusable Orders code when an established semantic CSS variable represents the
same role. Keep the visual/semantic role, expressed through canonical tokens.

#### Responsive operational shell

`OperationalContextShell` (shared UI) mirrors Overview's certified body grid:

- below `lg`: one-column composition;
- `lg`+: `gridTemplateColumns: 'minmax(0, 3fr) minmax(260px, 1fr)'`, `gap: 2.25`;
- when Ops Console is open, the desktop secondary track remains reserved while
  the domain rail content withdraws — the primary workspace does not reflow;
- below `lg`, a suppressed rail does not create an empty stacked row or gap;
- the shell is composition only: the caller passes `suppressRail`; the shell
  reads no Ops Console, config or domain state;
- below `lg`, the primary workspace precedes the domain rail.

Certified consumers: Overview (reference), Orders Overview (production
certified, Fly v746), and Inventory Intelligence (locally certified at
1440×720 and 1024×820; see §18). Orders uses the same shell and rail-replacement grammar;
its Order health rail content and semantics remain Orders-owned and are not a
global module rule.

#### Spatial inspection eligibility (configurable)

Warehouse geometry is not automatically a domain inspection target. A domain
screen may pass `IsometricCanvas` an optional `inspectableLocationCodes` set so
that only locations with truthful domain facts enter hover focus, selection and
pinned inspection; other geometry still renders for orientation without
implying interaction. This is configurable, not globally mandatory — callers
that pass no set keep the historic inspect-all behaviour. Orders passes the set
of locations that have an Orders LocationPulse.

#### Physical-location truth (shared data-truth principle)

Workflow activity is not a known physical location. Operators are placed on a
spatial surface only from actual location evidence — never inferred from the
first or nearest zone, the workflow phase, parent/child geometry or a
convenient renderer target. Unknown location stays unknown; workflow and batch
counts remain valid without placement. Current data-contract reality: pack
scans carry no location, so live spatial projections do not currently place
packers.

Ownership boundaries above are unchanged: Ops Console owns global attention,
Order Flow owns release planning and execution, and Orders owns order-domain
state and inspection.


### FT2 Triage + Pulse Layout

Canonical operational-screen layout — primary workspace + secondary Pulse/state
rail — matching Overview's certified body grid (implemented by the shared
`OperationalContextShell`):

```tsx
<Box
  sx={{
    display: 'grid',
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(260px, 1fr)' },
    gap: 2.25,
    alignItems: 'stretch',
    minWidth: 0,
  }}
>
  <Box sx={{ minWidth: 0 }}>{primary}</Box>
  <Box sx={{ minWidth: 0 }}>
    <PulseCard title="..." rows={rows} />
  </Box>
</Box>
```

#### Rules

- Below `lg`: one column (`minmax(0, 1fr)`); primary and rail stack full-width.
- `lg`+: `minmax(0, 3fr) minmax(260px, 1fr)` with `gap: 2.25`.
- The primary track uses `minWidth: 0` so wide content cannot force overflow.
- When the rail is withdrawn (e.g. Ops Console open), the desktop secondary
  track stays reserved and only the rail content withdraws — the primary
  workspace does not reflow.
- Below `lg`, a suppressed rail creates no empty stacked row or extra gap.
- Use `alignItems: 'stretch'` so stacked children fill the available width.
- `PulseCard` owns its card shell; callers own only responsive sizing.
- Overview is the reference implementation for this layout.

Some existing FT2 screens still use an earlier flex composition with a fixed
300px Pulse rail. Do not use it as the model for new or normalized operational
screens.

### FT2 Page / Workspace Scroll Rule

The current Screen Architecture Playbook is authoritative for viewport ownership.

For screens with a certified operational workspace:

- accidental document-level vertical scrolling is not allowed at certified viewports;
- target `document.documentElement.scrollHeight - window.innerHeight <= 1`;
- use intentional workspace-owned scrolling when content must exceed the available workspace;
- preserve the primary task or primary spatial/context surface instead of allowing the document itself to drift;
- drawers, modals and side panels may own their own internal scroll;
- simple list/detail screens may use normal page flow when their approved screen contract does not require a bounded operational workspace.

Do not introduce nested scrolling merely to force content into a viewport. Scroll ownership must follow the approved screen architecture.

**Board Layout Exception (2026-08-14, OF-12 / OF-UX-01):** Multi-column operational boards (for example Order Flow's Blocked / Order Pool / Fulfillment lanes) must remain bounded to the available viewport height. The shared board container owns the remaining page height with `flex: 1`, `minHeight: 0`, and overflow containment; each lane may then own independent `overflowY: 'auto'` scrolling. The tallest lane must never increase whole-page height or scroll the other lanes out of view. This exception applies only to genuine multi-column board pages, not single-list module pages, which remain governed by the base FT2 Page Scroll Rule above.

### Orders Outbound Pattern

Outbound is the post-pack control page for shipped orders.

Purpose:

- Show what shipped.
- Show what is missing tracking or carrier setup.
- Help the merchant fix shipping issues before customers ask.
- Avoid technical audit language.

Plain-language naming rules:

- Use `Shipped orders`, not `Shipment proof ledger`.
- Use `Needs attention`, not `Outbound exceptions`.
- Use `Shipping health`, not `Shipment coverage`.
- Use `Proof`, not `Shipment proof`.
- Use `Tracking`, not `Customer tracking` when space is tight.
- Use `Set up →` for missing carrier setup, not plain `Missing` when the value is clickable.

Layout rules:

- Use the same FT2 decision + pulse pattern:
  - Decision card: `flex: '1 0 300px'`
  - Pulse card: `flex: { xs: '1 0 300px', lg: '0 0 300px' }`
- Pulse cards must fill the available row when they wrap below the decision card.
- Do not leave dead empty space to the right of a wrapped pulse card.
- Full-width tables/lists must not use the decision-card flex behavior.

Shipped orders filters:

- Filters may sit directly under the `Shipped orders` section title.
- Do not add explanatory subcopy unless the filter behavior is unclear.
- Keep filter labels short:
  - `Needs action`
  - `This week`
  - `This month`
  - `All time`

Responsive table rules:

- Use shorter column labels on constrained widths.
- Prefer `Shipped` over `Fulfilled` in user-facing table headers.
- Prefer `Tracking` over `Customer tracking` in table headers.
- Use responsive `gridTemplateColumns` for shipped-order rows and headers so columns do not overlap.

### FT2 Decision Group Reveal Pattern

Decision groups must not render unbounded lists by default.

Rules:

- Show a maximum of 3 visible decisions per decision group.
- If a group has more than 3 items, render a centered `See X more` control below the first 3.
- Clicking `See X more` expands the remaining items with MUI `<Collapse timeout={180} unmountOnExit>`.
- Expanded state must provide `Show less` and collapse the hidden items.
- Apply this pattern to decision categories such as `Critical — act today` and `Watch`.
- Do not discard hidden items with `.slice(0, 3)` at the source level.
- Keep the full source array, then derive:
  - `visibleItems = items.slice(0, TRIAGE_PREVIEW_LIMIT)`
  - `hiddenItems = items.slice(TRIAGE_PREVIEW_LIMIT)`
- Use `TRIAGE_PREVIEW_LIMIT = 3`.
- `Everything else` may remain a separate collapsed/on-track group, but should not be treated as an urgent decision category.

**Order Flow Blocked Orders exception (2026-08-14, OF-UX-02):**

Blocked Orders is an operational exception queue, so category reveal follows a stricter hierarchy than generic decision groups:

- Use a **single-open accordion**: exactly one non-empty blocker category is expanded at a time.
- Order blocker categories by the first occurrence of each category in the backend-ranked constrained-order response. Do not impose a separate frontend category priority.
- On normal entry, expand the category containing the highest-ranked blocked order.
- A valid `?constraint=<type>` deep link may override that initial category selection.
- Apply any urgency filter first; then derive category ordering and the initially expanded group from the filtered backend-ranked result.
- An order with multiple active blockers appears **once**, under its elected primary blocker category.
- Secondary blockers remain visible on that card using their real operator-facing names, e.g. `Also blocked by: Out of Stock`.
- Do not replace named secondary blockers with opaque counts such as `+1 more`.
- Keep the standard `TRIAGE_PREVIEW_LIMIT = 3` and `See X more` behavior within the currently expanded category.
- Primary-blocker election and category ordering are separate concerns: backend blocker election determines which category owns one order; backend result ranking determines which category receives visual priority.

Canonical reveal control:

```tsx
<Box
  onClick={() => setExpanded(v => !v)}
  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 2.5, py: 1.125, borderTop: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }}
>
  <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
    {expanded ? 'Show less' : `See ${hiddenItems.length} more`}
  </Typography>
  {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
</Box>
```

- App font: `Plus Jakarta Sans`
- All app/module UI inherits the global app font.
- Do not set `fontFamily` inside FT2 module components.
- Do not use `Instrument Serif`, `DM Sans`, `DM Serif Display`, `DM Mono`, `var(--serif)`, or decorative serif fonts.
- No exceptions: auth pages (brand surface, see Scope) follow the layout rules of the auth blueprint but use Plus Jakarta Sans like everything else (decision 2026-07-19).
- Avoid `monospace` unless a documented exception exists for scanner/barcode/technical-code readability.

### Color Tokens

Single source of truth: `apps/frontend/src/themes/tokens.ts` (mirrored in
`docs/color-pallet/index.md`). The MUI palette is generated from the same file,
so `theme.palette.primary` **is** `--accent`.

```css
--accent:        #FF6B2B   /* primary CTA fill — NEVER changes between modes */
--accent-hover:  #FF8C5A
--accent-ink:    #10151E   /* text ON an accent fill */
--accent-text:   #B93D0A   /* light */ / #FF6B2B /* dark — accent-coloured text */
--accent-ghost:  #FFF0E8   /* light */ / rgba(255,107,43,0.12) /* dark */
--accent-border: #FFDCCA   /* light */ / rgba(255,107,43,0.25) /* dark */
--bg:            #FAFAF8   /* light */ / #151D29 /* dark */
--bg-2:          #F3F2EF   /* light */ / #18202F /* dark — distinct from --surface since §23 */
--bg-3:          #E8E6E0   /* light */ / #243050 /* dark */
--surface:       #FFFFFF   /* light */ / #1C2740 /* dark */
--ink:           #0F0E0D   /* light */ / #F0EEE8 /* dark */
--ink-3:         #545A66   /* light */ / #A8ACB5 /* dark */
--ink-4:         #656B78   /* light */ / #979CA7 /* dark */
--rule:          #E8E6E0   /* light */ / rgba(255,255,255,0.08) /* dark */
```

### Hard Rules

- Card/module borders: `1px solid var(--rule)`
- CTA ghost borders: `0.5px solid var(--accent)` or `0.5px solid var(--accent-border)`
- Page/module headlines may use `fontWeight: 700`
- Body copy uses `fontWeight: 300`
- Section/card titles usually use `fontWeight: 500`
- Metric values and CTAs use `fontWeight: 600`
- Never hardcode hex colors in components — always use tokens or
  `theme.palette.*`, but only palette keys that `buildPalette()` actually
  assigns (see §20 — an unassigned key is not safe)
- Never use `color="secondary"` on MUI Buttons — renders MUI amber, not LaSyncro orange
- Clickable elements: always `<Box>` — never `<Typography>` (semantic correctness)

---

## 2. CTA Hierarchy & Anatomy

LaSyncro uses a strict two-tier CTA system across all modules.

### Tier 1 — Primary Action (Filled Accent Pill)

Used for: resolving issues, triggering workflows, committing actions.

```tsx
<Box
  onClick={handler}
  sx={{
    display: 'inline-flex', alignItems: 'center',
    px: 1.25, py: 0.5,
    fontSize: 11, fontWeight: 600,
    bgcolor: 'var(--accent)', color: 'var(--accent-ink)',
    borderRadius: '6px', cursor: 'pointer',
    '&:hover': { opacity: 0.88 },
  }}
>
  Label →
</Box>
```

For MUI Button contexts (modals, forms, larger surfaces):

```tsx
<Button
  variant="contained"
  sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
>
  Label
</Button>
```

**Examples:** `Resolve →`, `Review ›`, `Receive →`, `Restock →`, `Chase →`,
`Release Batch`, `Add Member`, `New PO`, `Go to module →`

---

### Tier 2 — Secondary Nav (Ghost Pill)

Used for: navigating to related surfaces, secondary contextual links, toggles.

```tsx
<Box
  onClick={handler}
  sx={{
    display: 'inline-flex', alignItems: 'center',
    px: 1.25, py: 0.5,
    fontSize: 11, fontWeight: 500,
    color: 'var(--accent-text)', border: '0.5px solid var(--accent)',
    borderRadius: '6px', cursor: 'pointer',
    '&:hover': { opacity: 0.75 },
  }}
>
  Label →
</Box>
```

For uppercase small labels (stat card CTAs):

```tsx
sx={{
  px: 1, py: 0.375,
  fontSize: 10, fontWeight: 500,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  /* rest same as above */
}}
```

**Examples:** `View all orders →`, `Fix in Catalog →`, `See Demand →`,
`View Inbound →`, `Cash Flow →`, `Show pick map`, `View in Warehouse →`

---

### What is NEVER acceptable

| Pattern | Why |
|---|---|
| `<Typography onClick={...} sx={{ '&:hover': { textDecoration: 'underline' } }}>` | Semantic violation + visually inconsistent |
| `color: '#6366F1'` or any hardcoded hex on CTAs | Wrong brand color, breaks dark mode |
| `<Button variant="contained">` with no `sx` accent override | Renders MUI default blue |
| `<Button variant="outlined" color="success">` for receive actions | Wrong color, inconsistent |
| `borderRadius: '5px'` | Must be `'6px'` across all CTAs |
| `fontWeight: 700` on body copy, captions, rows, or CTAs | `700` is reserved for page/module headlines only |

---

## 3. Decision Guide — Which Tier?

```
Does this CTA commit an action or resolve an issue?
  YES → Tier 1 (filled accent)
  NO  → Does it navigate to a related surface?
    YES → Tier 2 (ghost pill)
    NO  → Is it an inline micro-action in a table cell (e.g. Edit)?
      YES → Plain accent text, no pill (exception)
```

---

## 4. Full CTA Issue Register — Sprint 2026-05-28

| ID | Status | File | Line | Description |
|---|---|---|---|---|
| CTA-001 | ✅ | `modules/overview/src/ui/pages/OverviewModuleFT2.tsx` | 448 | `color: '#fff'` hardcoded → `theme.palette.common.white` |
| CTA-002 | ✅ | `modules/overview/src/ui/pages/OverviewModuleFT2.tsx` | 448 | `borderRadius: '5px'` → `'6px'` |
| CTA-003 | ✅ | `modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx` | 797 | `Resolve →` ghost/outlined → filled accent |
| CTA-004 | ✅ | `modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx` | 626 | `View all orders →` bare Typography → ghost pill |
| CTA-005 | ✅ | `modules/products/src/ui/pages/ProductsModuleFT2.tsx` | 342 | `Receive →` bare Typography → filled accent |
| CTA-006 | ✅ | `modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx` | 745 | `Receive via WMS` outlined success → filled accent |
| CTA-007 | ✅ | `apps/frontend/src/pages/ft2-pages/FinancesIntelligencePage.tsx` | 88, 184 | Hardcoded `#6366F1` → `var(--accent)` + Typography → Box |
| CTA-008 | ✅ | `modules/demand/src/ui/pages/DemandModuleFT2.tsx` | 122 | `OrderCTA` outlined → filled accent |
| CTA-009 | ✅ | `apps/frontend/src/pages/ft2-pages/ProductsCatalogPage.tsx` | 226 | `Reorder →` bare Typography → filled accent |
| CTA-010 | ✅ | `apps/frontend/src/pages/ft2-pages/ProductsWmsReadinessPage.tsx` | 87, 105 | `Fix in Catalog →` / `Stow in Warehouse →` text-links → ghost pills |
| CTA-011 | ✅ | `modules/problem-center/src/ui/pages/ProblemCenterModuleFT2.tsx` | 313 | `Resolve →` text-link → filled accent |
| CTA-012 | ✅ | `apps/frontend/src/pages/ft2-pages/AlertsPage.tsx` | 133 | `Go to module` Typography primary → filled accent Box |
| CTA-013 | ✅ | `apps/frontend/src/pages/ft2-pages/OrdersInboundPage.tsx` | 370 | `Create first PO →` text-link → filled accent |
| CTA-014 | ✅ | `modules/wms/src/ui/pages/WmsModuleFT2.tsx` | 225 | `Show pick map` text-link → ghost pill |
| CTA-015 | ✅ | `modules/demand/src/ui/pages/DemandModuleFT2.tsx` | 319 | `View in Warehouse →` anchor tag → ghost pill Box |
| CTA-016 | ✅ | `apps/frontend/src/pages/ft2-pages/MembersPage.tsx` | 142 | `Add Member` MUI blue → filled accent |
| CTA-017 | ✅ | `modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx` | 863 | `New PO` MUI blue → filled accent |
| CTA-018 | ✅ | `apps/frontend/src/pages/ft2-pages/ReleaseQueuePage.tsx` | 192 | `Release Batch` MUI blue → filled accent |
| CTA-019 | ✅ | `modules/cashflow/src/ui/pages/CashFlowModuleFT2.tsx` | 293 | `Plan a new order` plain outlined → ghost pill with accent border |
| CTA-020 | ✅ | `modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx` | Suppliers header | `Add Supplier` filled accent (per CTA-016) |
| CTA-021 | ✅ | `modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx` | SupplierAccordion | `Edit` / `Delete` outlined inline actions (Delete = error color, soft-delete) |
| ORD-01 | 🟡 | `modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx` | 624 | `View all orders →` navigates to `/orders` root — root cause and fix tracked in `docs/playbooks/cta-deeplink-playbook.md` (same issue class as OV-01/OV-04: `/orders` is an executive-summary surface by design, no order list lives there — destination should be `/orders/flow`) |

---

## 5. Modules Audited

| Module | Path | Status |
|---|---|---|
| Overview | `modules/overview` | ✅ Clean |
| Orders (all sub-tabs) | `modules/order-nexus`, `apps/frontend/src/pages/ft2-pages/Orders*` | ✅ Clean |
| Inventory / Products | `modules/products`, `apps/frontend/src/pages/ft2-pages/Products*` | ✅ Clean |
| Demand | `modules/demand` | ✅ Clean |
| Finances / CashFlow | `modules/cashflow`, `modules/finances`, `apps/frontend/src/pages/ft2-pages/Finances*` | ✅ Clean |
| Suppliers Portal | `modules/suppliers-portal` | ✅ Clean |
| WMS | `modules/wms` | ✅ Clean |
| Problem Center | `modules/problem-center` | ✅ Clean |
| Alerts | `apps/frontend/src/pages/ft2-pages/AlertsPage.tsx` | ✅ Clean |
| Team / Members | `apps/frontend/src/pages/ft2-pages/MembersPage.tsx` | ✅ Clean |
| Floor Planning | `modules/floor-planning` | ✅ Clean (Edit inline action intentionally excluded) |

---

## 6. Pagination Standards

### Canonical Pattern

All paginated lists share one implementation pattern. Default 10 rows, user-selectable 10/25/50/100.

```tsx
// State
const [page, setPage] = useState(1);
const [perPage, setPerPage] = useState(10);

// Derived
const totalPages = Math.ceil(items.length / perPage);
const paged = items.slice((page - 1) * perPage, page * perPage);
```

### Footer Structure

```tsx
{items.length > 0 && (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    px: 2, py: 1, bgcolor: 'var(--bg)', borderTop: '0.5px solid var(--rule)' }}>

    {/* LEFT: count + page size selector */}
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
        {((page - 1) * perPage) + 1}–{Math.min(page * perPage, items.length)} of {items.length}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        {[10, 25, 50, 100].map(n => (
          <Box key={n} onClick={() => { setPerPage(n); setPage(1); }}
            sx={{ px: 1, py: 0.25, fontSize: 10, border: '0.5px solid',
              borderColor: n === perPage ? 'var(--accent)' : 'var(--rule)',
              borderRadius: '4px',
              bgcolor: n === perPage ? 'var(--accent-ghost)' : 'var(--surface)',
              color: n === perPage ? 'var(--accent)' : 'var(--ink-4)',
              cursor: 'pointer', fontWeight: n === perPage ? 600 : 400 }}>
            {n}
          </Box>
        ))}
      </Box>
    </Box>

    {/* RIGHT: prev / page numbers / next — hidden when single page */}
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {totalPages > 1 && <Box onClick={() => page > 1 && setPage(p => p - 1)}
        sx={{ px: 1.5, py: 0.5, borderRadius: '6px',
          cursor: page > 1 ? 'pointer' : 'not-allowed',
          border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
          fontSize: 12, color: page > 1 ? 'var(--ink-3)' : 'var(--ink-4)',
          opacity: page > 1 ? 1 : 0.4 }}>← Prev</Box>}
      {totalPages > 1 && Array.from({ length: totalPages }, (_, i) => (
        <Box key={i} onClick={() => setPage(i + 1)}
          sx={{ px: 1.5, py: 0.5, fontSize: 11, border: '0.5px solid',
            borderColor: i + 1 === page ? 'var(--accent)' : 'var(--rule)',
            borderRadius: '6px',
            bgcolor: i + 1 === page ? 'var(--accent)' : 'var(--surface)',
            color: i + 1 === page ? 'var(--accent-ink)' : 'var(--ink-3)',
            cursor: 'pointer', fontWeight: i + 1 === page ? 600 : 400 }}>
          {i + 1}
        </Box>
      ))}
      {totalPages > 1 && <Box onClick={() => page < totalPages && setPage(p => p + 1)}
        sx={{ px: 1.5, py: 0.5, borderRadius: '6px',
          cursor: page < totalPages ? 'pointer' : 'not-allowed',
          border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
          fontSize: 12, color: page < totalPages ? 'var(--ink-3)' : 'var(--ink-4)',
          opacity: page < totalPages ? 1 : 0.4 }}>Next →</Box>}
    </Box>
  </Box>
)}
```

### Column Sorting Pattern

```tsx
type SortField = 'field_a' | 'field_b';
type SortDir = 'asc' | 'desc';
const [sortField, setSortField] = useState<SortField>('field_a');
const [sortDir, setSortDir] = useState<SortDir>('asc');

const handleSort = (field: SortField) => {
  if (sortField === field) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
  else { setSortField(field); setSortDir('asc'); }
  setPage(1); // always reset to page 1 on sort change
};

// Sortable column header
<Box onClick={() => field && handleSort(field)}
  sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: field ? 'pointer' : 'default' }}>
  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: field && sortField === field ? 'var(--accent)' : 'var(--ink-4)' }}>
    {label}
  </Typography>
  {field && sortField === field && (
    <Typography sx={{ fontSize: 9, color: 'var(--accent)' }}>
      {sortDir === 'asc' ? '↑' : '↓'}
    </Typography>
  )}
</Box>
```

### Rules

- Always reset `page` to `1` on sort, filter, or `perPage` change
- Never use `const PER_PAGE = N` — always `useState(10)`
- Footer always renders when `items.length > 0` — page size selector must persist even when all items fit on one page
- Page number buttons only render when `totalPages > 1`
- Active page: `bgcolor: var(--accent)`, `color: #fff` — never `primary.main`
- Active page size chip: `bgcolor: var(--accent-ghost)`, `color: var(--accent)`, `borderColor: var(--accent)`
- Server-paginated lists (e.g. Outbound): pass `perPage` as `limit` param in query key and URL

### Surfaces Standardised — Sprint 2026-05-28

| Surface | File | perPage | Sort | Images |
|---|---|---|---|---|
| Finances / Margin (By Order) | `modules/finances/src/ui/pages/FinancesModuleFT2.tsx` | ✅ | ✅ | N/A |
| Finances / Margin (By SKU) | `modules/finances/src/ui/pages/FinancesModuleFT2.tsx` | ✅ | ✅ | ✅ |
| Inventory / Catalog | `apps/frontend/src/pages/ft2-pages/ProductsCatalogPage.tsx` | ✅ | ✅ | ✅ |
| Orders / Outbound | `apps/frontend/src/pages/ft2-pages/OrdersOutboundPage.tsx` | ✅ | ✅ | N/A |
| Problem Center | `modules/problem-center/src/ui/pages/ProblemCenterModuleFT2.tsx` | ✅ | ✅ | N/A |

---

## 7. For Future Engineers

### Adding a new CTA

1. Identify tier: primary action → filled accent, navigation → ghost pill.
2. Use `<Box>` — never `<Typography>` for clickable elements.
3. For MUI `<Button>`, always add `sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}`.
4. Never hardcode colors. Use tokens: `var(--accent)` fill + `var(--accent-ink)` text, `var(--accent-text)` for accent-coloured text.
5. CTA `borderRadius` is always `'6px'`. Use `fontWeight: 600` for CTA emphasis. Page/module headlines may use `700`.
6. Run `npm run build -w <module>` after every change to confirm type safety.

### Auditing a new module

```zsh
grep -rn "textDecoration: 'underline'" modules/<name>/src/ --include="*.tsx"
grep -rn "variant=\"contained\"" modules/<name>/src/ --include="*.tsx" | grep -v "sx.*accent"
grep -rn "color: '#" modules/<name>/src/ --include="*.tsx"
```

---

## 8. Color Token Correction — 2026-06-29

**`--accent-ink: #10151E`** added. WCAG contrast against `--accent` (#FF6B2B), computed directly from the hex values:

- White text: 2.84:1 — **fails AA** (needs 4.5:1 at this text size)
- `#10151E`: 6.44:1 — passes AA comfortably

The Tier 1 spec's code example (§2) showing `color: theme.palette.common.white` is **wrong** and should read `color: 'var(--accent-ink)'`. The 7+ files already hardcoding `#10151E` independently (`WmsPage.tsx`, `FulfillmentQueuePage.tsx` ×2, `WmsAnalyticsPage.tsx`, `ReleaseQueuePage.tsx`, `BlockedOrdersPage.tsx`, `OrdersOutboundPage.tsx` ×2) were right by repeated convention; the doc's example was stale. CTA-001 (which moved a button toward white) should be re-verified — possible readability regression, not yet confirmed either way.

**Manual edit needed** (one-line, in §2's Tier 1 code block):

```diff
- bgcolor: 'var(--accent)', color: theme.palette.common.white,
+ bgcolor: 'var(--accent)', color: 'var(--accent-ink)',
```

**Manual edit needed** (Color Tokens list, after `--accent-border`):

```css
--accent-ink:    #10151E   /* on-accent text — 6.44:1 vs --accent; white fails at 2.84:1 */
```

## 9. New Issue Register Entries — 2026-06-29

| ID | Status | File | Line | Description |
|---|---|---|---|---|
| CTA-022 | 🔴 OPEN | `modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx` | 324, 357 | `borderRadius: '8px'` → `'6px'`. Also relabeling `Release →` → `Prioritize` and fixing `color: '#10151E'` → `var(--accent-ink)` in the same pass — see `cta-deeplink-playbook.md` RELEASE-CASCADE-01. |
| CTA-023 | 🔴 OPEN, sweep | 7 files (see §8 list above) | — | Migrate hardcoded `#10151E` → `var(--accent-ink)` once the token exists. |

**Caveat on §5 Modules Audited:** Orders is marked "✅ Clean" but CTA-022 was found after that audit closed — status should not be trusted as exhaustive without re-verification.

## 10. Confirm-Ghost Exception — 2026-06-30

**New tokens, light + dark** (`apps/frontend/src/themes/index.tsx`):

```css
--confirm-ghost:   #E8F5E9                    /* light */ / rgba(76,175,80,0.12)  /* dark */
--confirm-border:  #A5D6A7                    /* light */ / rgba(76,175,80,0.35) /* dark */
--confirm-ink:     #2E7D32                    /* light */ / #66BB6A              /* dark */
```

**Scope:** confirmed/persisted state ONLY — never an actionable CTA.
First and currently only use: `PrioritizeButton` (Orders module,
`OrdersModuleFT2.tsx`) after an order's priority flag is confirmed.
`Prioritized ✓` is a brief confirmation state, not a permanent row state:
once the existing movement hold expires, the order leaves **Needs a decision**.
This applies to both Critical and Watch — successfully prioritized work no
longer requires a decision and belongs in Order Flow instead.

**Why this is a deliberate, documented exception, not drift:** §1's
Hard Rules and §2's CTA Hierarchy are orange-accent-only by design —
CTA-006 explicitly rejected green (`outlined color="success"`) for the
Suppliers "Receive via WMS" action. That rule still holds for
**actionable** CTAs. This exception applies narrowly to a *state*
indicator (something already happened, nothing left to click) — a
different semantic category, anchored to the existing
`--ft2-infoblock-diff-up` green already used elsewhere for positive
deltas, not an arbitrary new color choice.

**Pattern, for the next engineer reaching for this:**

```tsx
sx={{
  color: showConfirmed ? 'var(--confirm-ink)' : 'var(--accent-ink)',
  bgcolor: showConfirmed ? 'var(--confirm-ghost)' : 'var(--accent)',
  border: showConfirmed ? '1px solid var(--confirm-border)' : 'none',
  cursor: showConfirmed ? 'default' : 'pointer',
}}
```

**Rule going forward:** before reusing `--confirm-*` anywhere, confirm
the element is a true persisted-state indicator (disabled, no further
action possible) — not a hover/active CTA state, not a toggle. If it's
still clickable or reversible, it stays orange per §2.

## 11. `--bg-2` vs `--surface` Collision in Dark Mode — 2026-07-02

**The gotcha:** `--bg-2` and `--surface` share the **identical hex value in dark mode** (`#1C2740` == `#1C2740`, confirmed live via `themes/index.tsx`). In light mode they're correctly distinct (`--bg-2: #F3F2EF` vs `--surface: #FFFFFF`). This means any component styled with `bgcolor: 'var(--bg-2)'` sitting against a `var(--surface)` parent will render **visually identical in dark mode only** — a bug that's invisible in light-mode QA and only shows up for dark-mode users.

**Where this bit us:** `EntityDetailModal.tsx`'s header/footer were styled `--bg-2` to frame the `--surface`-toned body (per the Order Detail modal redesign, 2026-07-02) — worked correctly in light mode, showed zero visual distinction in dark mode. Flagged live via screenshot.

**The fix — use `--bg-3` instead, not a new token.** `--bg-3` (`#243050` dark / `#E8E6E0` light) is already established elsewhere for exactly this "frame distinct from `--surface`" purpose — see `ModuleTabBar.tsx`'s `active ? 'var(--surface)' : 'var(--bg-3)'` tab treatment, and `OrderDetailPage.tsx`'s bordered footer. Reuse it rather than inventing `--surface-2` or similar.

**Rule going forward:** `--bg-2` is a **hover-state / page-background-context** token only (confirmed via full-codebase audit — every one of its ~60 existing usages is either a `&:hover` state or a panel against `var(--bg)`, never against `var(--surface)`). If you need a shade that reads as distinct **from `var(--surface)` specifically**, reach for `--bg-3`, not `--bg-2`. Before introducing any new background token, check both light AND dark hex values for accidental collisions with tokens it will be paired against — don't assume parity across modes.

## 12. Bulk Backfill Action — Orders Outbound, WM-40 — 2026-07-03

**New pattern:** bulk commit action with inline confirm-then-result flow, no modal — extends the existing `Collapse`-based reveal pattern (§1, FT2 Decision Group Reveal) to a two-state panel: confirmation view → result view, same `Collapse` instance, state swapped via a local `backfillResult` flag rather than two separate collapses.

**Tier correction caught during audit:** initial implementation styled the "Backfill labels" trigger as a muted gray control and used `color: 'white'` on the filled "Confirm" button — both violations of already-documented rules (§3 decision guide; §8's white-on-accent contrast correction). Fixed to `bgcolor: var(--accent)` / `color: var(--accent-ink)` on both, matching Tier 1 exactly. Recorded here so the same mistake isn't repeated when this pattern is copied to another bulk-action surface.

**Rule going forward:** any button that triggers a bulk write (label generation, bulk status change, bulk export-and-mutate) is Tier 1 by the existing decision guide — do not default to a neutral/muted style for bulk actions just because they affect multiple rows. Multiplicity doesn't change the tier; committing an action does.

**Grouped decision pattern — Orders Overview, 2026-08-19:** when multiple `Needs a decision` rows share the same resolution path, default to one issue group rather than repeating the same decision CTA per order. The group summary carries the affected order count, aggregate value at stake, and oldest urgency; the underlying orders remain available through an explicit title/chevron reveal. Grouping changes presentation only — factual Pulse counts remain order-level metrics.

A group-level bulk CTA is allowed only when every included row can safely receive the same mutation. Keep inspection and mutation separate: the title/chevron reveals orders; the bulk CTA starts the write flow. When the CTA opens a confirmation rather than committing immediately, use copy such as `Prioritize all…` so the intermediate step is predictable.

When the group is expanded, visually separate the bulk operation from per-order actions. Move the bulk CTA into a dedicated contextual strip (`var(--accent-ghost)`) labelled `Bulk action`, with scope copy such as `Apply to all N orders`; keep the actual bulk commit control Tier 1 (`var(--accent)` / `var(--accent-ink)`). Individual row CTAs remain on the normal surface below. Do not invent a bulk action for heterogeneous fixes such as customer addresses or stock constraints merely to reduce row count.

| ID | Status | File | Line | Description |
|---|---|---|---|---|
| CTA-024 | ✅ | `apps/frontend/src/pages/ft2-pages/OrdersOutboundPage.tsx` | ~420, ~445 | Bulk backfill trigger + confirm button — initially muted gray / `white` text, corrected to Tier 1 filled accent + `var(--accent-ink)` |
And update §6's "Surfaces Standardised" table isn't affected (pagination unchanged), but §5's Modules Audited row for Orders should get a footnote matching the existing CTA-022 caveat pattern — append after the table:

**Caveat, 2026-07-03:** Orders / Outbound gained a new bulk-action CTA(backfill labels, CTA-024) after the §5 "✅ Clean" audit closed — same caveat class as CTA-022 in §9. Audit status reflects a point in time, not an ongoing guarantee.

## 13. Outbound module audit fixes — 2026-07-04

**ISS-04 — "Review orders →" no-op on default filter state.** Wired
correctly (`onClick={() => setLedgerFilter('needs_action')}`), but
`ledgerFilter` already defaults to `'needs_action'` on page load — so
for a first-visit operator (the exact audience this CTA exists for),
clicking it set state to the value it was already at. React bails on
the no-op update; no re-render, no scroll, no visible feedback — the
button *looked* dead despite correct underlying logic. Not a logic bug,
a missing-feedback bug. Fixed: added a `ledgerRef` + `scrollIntoView`
call alongside the existing `setLedgerFilter`, so the click always
visibly does something (scrolls to the "Shipped orders" section) even
when the filter value itself doesn't change.

**ISS-06 — "Backfill labels" trigger gave no expand/collapse
affordance.** The two-step confirm-then-result panel (§12 above) is the
correct, intentional pattern for this bulk-write action — not removed.
The actual gap: the trigger button carried the same visual weight as a
direct-action button, so clicking it and having the confirm panel
appear below the fold read as "nothing happened," not as "revealed."
Fixed minimally: added `<ChevronDown />`/`<ChevronUp />` (already
imported in this file, same icons used elsewhere for the canonical
reveal-more pattern, §1) to the trigger, flipping based on
`backfillExpanded` state. No layout change, no removed friction — same
interaction, now visually legible as expand/collapse rather than a
no-op-looking button.

## 14. Unified Free-Scan Session Pattern — Returns fold-in, 2026-07-07

**The problem this corrects:** Returns processing (WEB-RETURN-01, see
`ReturnsResolutionModule.md` §8) initially shipped as its own standalone
scan entry point and session route (`/returns/scan`, `/returns/session/:id`)
— reasonable in isolation, but redundant against WMS operations' existing
unified free-scan surface, which already auto-detects session type from a
single scan rather than making the operator choose a screen first.

**The existing pattern, now confirmed canonical:** `WmsModuleFT2`'s
`activeSession` is a discriminated union (`pick` | `pack` | `receive` |
`stow`), resolved from one scan box (`handlePackFreeScan`) on the WMS
operations home page. The operator never picks a mode — they scan whatever
they're holding, and the backend response's `type` field decides which
session renders. Returns now joins this union as a fourth case rather than
living outside it: an already-shipped unit or order scanned there resolves
to `{ type: 'return', returnJobId }` instead of the old hard error
(`already_packed` / `batch_not_packing`), and `ReturnSessionPage` renders
exactly like `StowSessionPage`/`PackSessionPage` do, exiting via the same
`exitSession()` back to scan-ready state — not a navigation elsewhere.

**Rule going forward:** before adding a new scan-driven workflow anywhere in
WMS operations, check whether it can extend `activeSession`'s union rather
than shipping a separate entry route. A new standalone scan screen is the
wrong default whenever WMS operations' free-scan surface already exists and
the new workflow shares the same LSO-/LSU- barcode vocabulary — one scan box,
one set of muscle memory, decided by backend response type rather than a
picker the operator has to navigate first.

**Module boundary, worth restating for any future session-type addition:**
session page components under `modules/wms/src/ui/pages/` must stay purely
presentational — no hooks, no `axiosInstance` calls directly. `modules/wms`'s
`tsconfig.json` scopes `rootDir`/`include` to `src/ui/**/*` only, a hard
compile boundary, not a convention — a module-side file cannot import from
`apps/frontend/src/pages/`. All data access is threaded down as props from
the owning app-side page (`WmsPage.tsx` for WMS), which alone owns the actual
API calls. `ReturnSessionPage` was initially written violating this (calling
its data hooks directly) and had to be rebuilt presentational-only once the
build failure surfaced it — check this before writing any new module-side
session component, not after.

## 15. Intent Banner Pattern — deep-link context bridge, ISS-RQ-05, 2026-07-09.

When a page is reached via a signal deep-link (?urgency= or ?constraint=), render a dismissible banner that names what the user is seeing and states the one action that resolves the alert. Condition on the URL param, dismiss via local useState (no persistence). Follows §1 card shell tokens. First use: OrderFlowPage.tsx.

## 16. Contextual Action Bar Pattern — selection-triggered wave builder, ISS-OP-01/02, 2026-07-10

**The problem this corrects:** a primary action (Release wave to floor) was permanently
rendered at the bottom of a long scrollable list. Users had to scroll past all orders to
reach it, and it had no spatial relationship to the orders it acted on.

**The pattern — show the action bar only when it has earned its place:**

When nothing is selected: hide the action bar entirely. Show a `SpotlightCoachMark`
at the top of the list coaching the user to select. The list takes full column height.

When 1+ items are selected: render a compact action bar pinned between the filter row
and the order list. It shows selection count, line items, units, an inline operator
dropdown, and a context-aware CTA label:

- 0 selected → `Release all N` (releases entire pool)
- N selected → `Release N order(s)` (releases subset)

The bar uses `bgcolor: var(--accent-ghost)` when orders are selected to signal "ready
to act" without being as heavy as a filled button.

**Search + pagination on the same surface:** when a list can grow unbounded, add a
search input directly below the filter pills (not in a separate header section) and
wire it into the existing filter chain (`filteredPool` in Order Flow). Always reset
`page` to 1 on search change. Never create a parallel pagination system — wire into
the existing `sortedPool → visiblePool` chain instead.

**Rule going forward:** any list with a primary bulk action (release, assign, export)
should use this pattern rather than a fixed bottom panel. The action bar appears when
selections exist; the list owns the space otherwise. First and canonical use:
`OrderFlowPage.tsx` Order Pool column.

**Spotlight coexistence:** the `SpotlightCoachMark` component renders inline (not
`position: absolute`) when used inside a contextual action bar. It sits above the
order list, coaches selection, and disappears once dismissed. After dismissal the
space collapses — no empty placeholder.

## 17. Shared Cap Status Pattern — useCapStatus(), 2026-07-14

**New hook:** `apps/frontend/src/hooks/useCapStatus.ts` — single source of
truth for any usage-vs-cap threshold logic. Takes `used`, `cap`, and an
array of ascending fraction thresholds (e.g. `[0.75, 0.9]`), returns
`{ pct, level }` where `level` is `'ok' | 'warn' | 'urgent' | 'blocked'`.

**Why this exists:** usage-vs-cap presentation needs one threshold helper so
"approaching the limit" cannot silently drift between screens. `useCapStatus()`
remains the shared helper for legitimate processed-order and usage-meter UI.

**Pattern — presentations share threshold semantics, not commercial ownership:**

- **Loud (banner):** `ShippedOrderCapBanner.tsx` presents the
  merchant-facing processed-order allowance on the workflow surface where it
  matters.
- **Quiet (meter):** `UsageMeter` in `BillingSettings.tsx` presents the same
  processed-order usage model in Billing.
- **Retired by FINAL-RECON-01C (2026-09-15):** `OrderCapBanner.tsx` and the
  frontend `TIER_MONTHLY_ORDER_CAP` table were removed. `ingested_orders`
  remains internal telemetry only and must never be presented as a merchant
  ingestion allowance or blocking condition.

**Scoping rule — commercial warnings are page-scoped, not global.**
`ShippedOrderCapBanner` belongs on the page where warehouse-processed usage
happens. Do not introduce a replacement ingestion-cap banner; Shopify order
truth is always ingested.

**CTA hierarchy applied per §2:** in `ShippedOrderCapBanner`, "Enable
pay-per-order" commits an action → Tier 1 filled accent. "Upgrade plan"
navigates to Billing → Tier 2 ghost pill. Same decision-guide logic as
every other CTA in the app — cap banners are not a special case.

**Known gap:** "Enable pay-per-order" currently routes to `/settings/billing`
as a placeholder — the real flow (creating a Stripe Customer for a
previously-card-free Starter shop, so `reportShippedOrderOverage()`'s
existing `stripe_customer_id` check starts passing) is not yet built.
Update this destination when that flow ships.

**Terminology note:** `shipped_orders` in the database and API means
*pack-complete*, not carrier-confirmed shipment — see
`wms.controller.ts` `httpPackComplete`. Any new UI surfacing this number
should say "packed," matching `ShippedOrderCapBanner`'s copy, not
"shipped," to stay accurate until/unless the underlying trigger point
changes.

## 18. Pulse Severity Tokens — critical / warning / good, 2026-07-22

**The problem this corrects:** no severity color tokens existed for live
risk metrics (as opposed to `--confirm-*`, §10, which is scoped narrowly to
*persisted state*, and `--ft2-infoblock-diff-up`, which is scoped to
*positive deltas*). In their absence, `#E5484D` was hardcoded independently
at 60+ call sites across the app, converging into a de facto standard
without ever being named — the same drift pattern §8 formalized for
`#10151E`. `#D9A23B` and `#EAB308` also both circulated as "amber," doing
two different jobs (status-dot amber vs. severity-tier amber) without a
documented boundary between them.

**New tokens** (`apps/frontend/src/themes/index.tsx`):

```css
--critical-ink: #E5484D   /* light + dark, matches 60+ existing call sites */
--warning-ink:  #EAB308   /* already existed, undocumented until now */
--good-ink:     #2E7D32   /* light */ / #4CAF7A   /* dark */
```

**Scope:** live risk/status metrics only — pulse cards, severity bands,
decision-row indicators. Distinct from:

- `--confirm-*` (§10) — persisted/disabled state only, never a live metric
- `--ft2-infoblock-diff-up` — day-over-day delta framing specifically

**Amber disambiguation, resolved:** `--warning-ink` (#EAB308) is canonical
for severity-tier warning going forward (pulse cards, decision rows). Existing
`#D9A23B` call sites (age/urgency coloring in `BlockedOrdersPage`,
`OrdersInboundPage`, `WmsAnalyticsPage`) are pre-existing and out of scope
for this change — not migrated as part of PULSE-01. Flag for a future sweep
if full convergence is wanted, same pattern as CTA-023's deferred `#10151E`
migration.

**Rule going forward:** severity color in any live-metric context (not
persisted state, not delta) uses `--critical-ink` / `--warning-ink` /
`--good-ink`. Do not hardcode `#E5484D`, `#EAB308`, `#4CAF7A`, or `#2E7D32`
directly in new components — reference the token.

**PulseCard rollout status:**

| Surface | File | Status |
|---|---|---|
| Business Pulse (Overview, both layouts) | `modules/overview/src/ui/pages/OverviewModuleFT2.tsx` | ✅ Migrated 2026-07-22 |
| Today's Pulse (Orders Overview) | `modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx` | ✅ Migrated 2026-07-22 |
| Shipping Health (Outbound) | `apps/frontend/src/pages/ft2-pages/OrdersOutboundPage.tsx` | ✅ Migrated 2026-07-22 |
| Sourcing Pulse | `modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx` | ✅ Migrated 2026-07-22 |
| Inventory Pulse (Inventory Intelligence; historical) | `modules/products/src/ui/pages/ProductsModuleFT2.tsx` | Migrated 2026-07-22; superseded by Inventory state below |

**Wrap-behavior consistency audit, 2026-07-22 — all five migrated surfaces use Overview's reference layout: breakpoint-based direction/wrapping plus `alignItems: 'stretch'`.**

**PULSE-02A — Inventory Intelligence (historical):** Six operator-summary metrics mapped into the shared severity model; superseded below.

**2026-09-09 — INV-UX-01 (historical; superseded by the certified contract below).** This replaced the earlier Inventory Intelligence parent layout with Live Intelligence:

- left: the Inventory live-map slot, `flex: 1 1 0`
- right: a fixed `280px` Inventory Intelligence rail
- the rail combines grouped **Needs a decision** summaries with the shared `Inventory pulse`
- parent-level SKU, PO and return detail lists are not rendered in this branch
- detailed records remain in their owning workflow/tab rather than being reproduced on Intelligence
- only the first three decision groups are previewed; additional groups use bounded reveal
- Core receives the same information architecture with a synthetic premium map teaser
- Growth/Scale receive the real warehouse map
- the previous Action Queue + Inbound Pipeline + Return Leakage layout remains only as a compatibility fallback when no `mapContent` is supplied

The historical parent-screen rule was: **status → problem → consequence → action**,
with non-spatial commercial/product problems in the decision/Pulse rail.

**Inventory Intelligence — current locally certified contract.** Supersedes
PULSE-02A and INV-UX-01's fixed 280px rail, decision/Pulse composition and
parent-screen rule above for `/inventory`.

- Operational Context screen using `OperationalContextShell`: spatial workspace
  primary; **Inventory state** contextual rail with exactly **On hand,
  Available, Reserved, Not received, Phantom, No valid pick location**.
  State/orientation only; Ops Console owns global/actionable attention and
  execution stays in owning workflows. No mini Ops Console. Needs a decision,
  Margin at risk, Inbound, Dead capital, Stocked out and legacy Inventory Pulse
  task-queue treatment are retired from this surface.
- `lg`+: canonical `minmax(0, 3fr) minmax(260px, 1fr)` geometry. Below `lg`:
  one column, primary first, Inventory state below through app-owned scrolling.
  Ops Console open withdraws the `lg`+ domain rail within canonical shell/console
  geometry; below `lg`, it suppresses the rail completely without a blank row
  or gap.
- Overview's shared `LocationPulse` + `IsometricCanvas` interaction grammar:
  minimal hover, persistent click/select inspection, shared `IsometricBox`
  accent/dashed selection and accessible geometry focus + pulse (no browser
  rectangular focus box); Enter / Space select, Escape clears. No separate
  Inventory popup/modal system and no map mutation actions.
- Hover shows identity, On hand, Available and SKU count. Pinned inspection
  shows identity/type, On hand, Available, Reserved, exceptional Truth only
  when not Confirmed, and the complete compact SKU list with per-SKU
  On hand · Available · Reserved; internal scrolling, no repeated prose or CTA.
- Hover and ordinary shared pinned defaults remain **228px**. Inventory opts
  into **288px** using optional shared `pinnedPulseWidth?: number`; this is a
  presentation capability, not a new global default or Inventory-specific card.
  Pinned inspection remains viewport bounded and internally scrollable.
- Only positioned physical locations with canonical Inventory inspection truth
  are inspectable; ROOT is excluded and missing truth is not confirmed empty.
  Existing commercial access remains authoritative: denied → no geometry
  fetch + `LiveMapTeaser`; allowed → floor planning + operational floor + occupancy.
- Local certification: **1440×720 PASS; 1024×820 PASS**. At 1024×820, the stacked
  rail is reachable through the app-owned scroll surface; Ops Console fully
  suppresses it, leaves no blank gap and preserves primary horizontal geometry.
  Document horizontal and vertical overflow were both **0**. Local behavioral
  and visual acceptance PASS; no production certification is claimed.

Full Inventory truth semantics and supplied regression/locked-slice evidence:
[Screen UX playbook §18](SCREEN-UX-laSyncro-screen-architecture-UX-engineering_playbook_V1.md#18-certified-inventory-intelligence-contract--local-certified).

**2026-09-10 — ORD-UX-01**

The canonical Orders Overview landing pattern is Live Intelligence:

- left: Orders live-map slot, `flex: 1 1 0`
- right: fixed `280px` Orders rail
- the rail combines grouped **Needs a decision** summaries with **Today's pulse**
- the live-map Pulse is intentionally compact: title + **Breached / Blocked / Picking / Fulfillable** rows only
- the redundant headline, cumulative footer note and footer CTA are omitted in the live-map branch so the rail does not unnecessarily determine excessive page height
- individual order rows and expanded critical/watch lists do not render on the landing-map branch
- a single concrete decision group may open the canonical `EntityDetailModal`
- broader issue groups route to `/orders/flow`
- bulk priority mutation remains in Order Flow
- Starter/Core receive a synthetic premium map teaser
- Growth/Scale receive the real Orders live map
- denied users acquire neither real floor geometry nor Orders live activity
- no inventory occupancy or invented order/bin attribution is used on the Orders map
- the old triage-first Orders layout remains a compatibility fallback when `mapContent` is absent
- spatial truth belongs on the map; non-spatial order/commercial issues stay in the decision/Pulse rail

All essential Orders landing content fits visibly in the first viewport. Residual ~64px vertical overflow at the tested desktop viewport is intentionally **DEFERRED** as non-blocking polish. The scroll-free requirement is **not fully closed/clean**; residual scroll is not resolved.

**2026-09-27 — ORD-UX-02 — Orders Overview normalization — PROD CERTIFIED**

Status: **PROD CERTIFIED.** Local certification PASS (2026-09-28); production
certification PASS — Fly release v746, deployed main SHA
`1f4cf55a4420af42b1eb08d6bd1f4b1370d2c739`.

Certified at 1440 × 720 and 1024 × 820: light/dark, Ops Console closed/open
(rail replacement), primary-workspace geometric stability, document/horizontal
overflow ≤ 1, projection-health banner absent, silent-bin hover/select
(production PASS).

Active-location hover/select: **AUTOMATED PASS / PRODUCTION BROWSER NOT
OBSERVED / NON-BLOCKING.** No truthfully located active picker existed during
certification and none was manufactured; the positive browser path (hover →
dimming + transient plate; click → selected outline + pinned plate +
"Open order flow →"; close → neutral) remains to be observed naturally.

This supersedes `ORD-UX-01` as the current Orders Overview UX contract.
`ORD-UX-01` above is historical: it records the pre-normalization composition,
including its triage-first no-map fallback, which is now retired.

The contract keeps Orders as an **Operational Context** screen:

- primary question:
  **What is happening to my orders, why, and where is fulfilment pressure?**
- shared styling follows the canonical Overview/shared visual system;
- Orders reuses Overview's proven operational-screen composition and interaction grammar where the same UX problem exists, while keeping Orders-specific domain truth and spatial semantics;
- the actionable `Needs a decision` landing rail is retired as a local
  attention inbox;
- legitimate underlying order state, constraint severity, age and commercial
  consequence remain available as Orders-domain context;
- `Today's pulse` is replaced by truthful compact **Order health** state;
- Order health may summarize Breached, Blocked, Picking, Fulfillable and useful
  aging/risk state;
- cumulative fulfilled/revenue-to-date metrics must not be presented as
  "today";
- the Orders warehouse projection remains **CONTEXTUAL**, answering where
  order-related fulfilment pressure is physically concentrated;
- the map uses canonical warehouse geometry and a real Orders projection, not
  an independent or generic Overview map;
- individual order and constraint inspection remains in Orders as secondary /
  on-demand detail;
- priority mutations, including bulk prioritization, belong to Order Flow;
- `View order flow` remains valid contextual navigation;
- Export remains available but is a secondary utility rather than a headline
  action;
- the triage-first no-map layout is retired — one composition renders for every
  input.

Certified responsive behaviour (shared `OperationalContextShell`):

- `1440 × 720`: `[Orders spatial workspace][Order health]`; with Ops Console
  open, `[Orders spatial workspace][Ops Console]` — Order health withdraws and
  the primary workspace does not shift, resize or animate;
- `1024 × 820`: single column — spatial workspace first, Order health below;
  with Ops Console open, Order health is suppressed with no empty row or gap;
- no accidental document-level overflow at either certified viewport;
- intentional workspace-owned scrolling is allowed where required.

Spatial truth on Orders: inspection is limited to locations with a truthful
Orders LocationPulse (Orders-silent bins stay plain geometry), and operators
appear only where physical-location evidence exists — packers are not
currently placed (see §1, Physical-location truth).

Global ownership remains:

- Ops Console → cross-workflow/global attention;
- Orders Overview → order-domain truth and inspection;
- Order Flow → release planning and fulfilment execution.

Do not reintroduce the historical `ORD-UX-01` layout. Changes must follow
ORD-UX-02 and the current Screen Architecture Playbook.


**2026-09-10 — OV-UX-02 — Overview Live Intelligence teaser parity**

Starter/Core Overview now uses the canonical Live Intelligence layout:

`[ synthetic LiveMapTeaser ][ Needs a decision + Business pulse 280px ]`

- The shared synthetic `LiveMapTeaser` occupies the `mapContent` slot beside the real decision and Business pulse rail.
- The old large triage-first landing body is no longer the normal denied-tier Overview experience.
- Growth/Scale continue to receive the existing real Overview operational map.
- `overview.live_map` remains Growth+; commercial policy and backend were not changed.
- Canonical `AccessDecision` remains authority; `requiredTier` is sourced from `liveMapDecision.requiredTier`.
- The Upgrade CTA routes to `/settings/billing`.
- Denied tenants do not acquire real floor geometry, occupancy, idle-alert map data, problem-center map data or WMS live activity.
- The synthetic teaser never contains blurred real merchant data.
- The bespoke Overview `LiveMapUpgradeTeaser` and separate `upgradeTeaser` path were retired.
- `OverviewModuleFT2` preserves its triage-first compatibility fallback when another consumer supplies no `mapContent`.

Verification record (supplied for this documentation slice):

- overview commercial UI: 6/6 PASS
- `OverviewModuleFT2`: 2/2 PASS
- `overview.live_map` commercial contract: 8/8 PASS
- `git diff --check`: PASS
- Core live browser: teaser in map slot PASS; real decision + Business pulse rail PASS; old triage body absent PASS; billing CTA PASS; premium acquisition boundary PASS.
- Growth local browser: real Overview map ultimately renders correctly PASS; teaser absent PASS.

**OV-UX-02 — CLOSED / PRODUCTION CERTIFIED**

Production evidence (supplied for this documentation slice):

- Growth/Scale: the real Overview live warehouse map rendered in production; the synthetic teaser was absent; the Needs a decision + Business pulse rail was present.
- Core: the shared synthetic/blurred Overview live-map teaser rendered in the canonical map slot; real Needs a decision + Business pulse remained visible.
- Core: the required tier correctly displayed as Growth and the CTA correctly displayed **Upgrade to Growth**.
- Core: no request to `/api/v1/floor-planning/layout` and no request to `/api/v1/wms/live-activity`.
- Core: the teaser CTA navigated successfully to `/settings/billing`.

Loading the frontend JS bundle containing `useWmsLiveActivity` is not equivalent to acquiring `/api/v1/wms/live-activity` data. `/api/v1/layouts/dashboard` is unrelated to premium floor-map acquisition.

**BILL-UX-01 — Billing typography consistency**

Status: **DEFERRED / OPEN**

Problem: `/settings/billing` typography and hierarchy are visually inconsistent with the canonical FT2/app typography system.

Requirement: audit and align headings, labels, body copy, card hierarchy, weights, sizing and spacing with the shared app design language. No implementation in this slice.

**BILL-UX-02 — Plan transition CTA semantics**

Status: **IMPLEMENTED / LOCALLY VERIFIED — production certification pending**

Problem: plan CTA wording must reflect the direction of the plan transition.

Contract:

- Lower → higher tier: “Upgrade to <Tier>”.
- Higher → lower tier: “Downgrade to <Tier>”.
- Current tier: non-action/current-plan treatment.
- Never render “Upgrade to Core” or “Upgrade to Starter” when the current plan is Growth/Scale.
- CTA semantics derive from the canonical `TIER_ORDER` in `@lasyncro/commercial-policy`, not ad-hoc local tier ranking.
- `RecommendedUpgrade` remains upgrade-only and unchanged.
- Billing-provider behavior is unchanged: Shopify continues to use hosted Managed Pricing and Stripe continues to use the existing checkout flow.

Implementation:

- `BillingSettings.tsx` now derives each non-current plan-card CTA from the current tier and canonical tier ordering.
- Lower targets render `Downgrade to <Tier>`.
- Higher targets render `Upgrade to <Tier>`.
- Current-plan and `Redirecting…` states are preserved.
- No Starter plan card was added in this slice.

Verification:

- Focused BillingSettings CTA regression: **3/3 PASS**.
- Targeted TypeScript touched-surface check: **0 target errors**; one unrelated existing `api-types` resolution error remains in `AuthContext.tsx`.
- `git diff --check`: **PASS**.
- Growth live-browser verification on the implementation worktree:
  - Core → `Downgrade to Core`
  - Growth → `Current plan`
  - Scale → `Upgrade to Scale`
  - no `Upgrade to Core`
  - **PASS**
- Production certification remains pending.

**MAP-TIER-01 — DEFERRED / UNRESOLVED DEVELOPMENT-ONLY OBSERVATION**

- During local Core → Growth tier changes, Overview/Orders/Inventory have several times temporarily lost access to floor-map data.
- Observed states include Overview FL-503 and Orders/Inventory “Map your warehouse floor first”.
- All three maps later recover without rebuilding warehouse geometry, sometimes after ~15–20 minutes.
- This indicates no demonstrated warehouse-data loss.
- Root cause has NOT been established.
- It has NOT been reproduced in production.
- MAP-TIER-01 remains unresolved and is not marked fixed.
- If production reproduces it, reopen as a priority shared map/runtime defect.

**2026-07-22 — Runtime token gap caught late.** `--critical-ink` and
`--good-ink` were added to `docs/color-pallet/index.md` correctly but
initially missed from `apps/frontend/src/themes/index.tsx` — the actual
MUI theme object the app reads at runtime. `npm run build -w modules/shared`
passed cleanly throughout, because a shared component only type-checks
that it emits a `var(--token)` string; it can't verify the token resolves
to anything at runtime. The gap surfaced only via screenshot (Blocked
rendering as plain ink instead of red) — caught before merge, but this is
a rule going forward: any new CSS custom property needs `apps/frontend/src/themes/index.tsx`
updated in the same change as `color-pallet/index.md`, not just the docs
file, and verification requires a rendered screenshot, not just a green
build.

**2026-07-22 — Pulse card wrap-fill rule made explicit, applies to every PulseCard call site.**
Every `<PulseCard>` usage must be wrapped in a sizing `Box` with
`flex: { xs: '1 0 300px', lg: '0 0 300px' }, minWidth: 0` — never a flat
`flex: '0 0 300px'` (pins to 300px even when wrapped alone onto its own
row, leaving dead space beside it — found in Orders' Today's Pulse,
PULSE-01 migration) and never bare with no wrapper at all (falls back to
browser-default content-sizing — found in Sourcing Pulse, same migration).
`PulseCard` itself is deliberately width-agnostic — it never sets its own
`flex` — sizing is always the caller's responsibility via this wrapper.
Reference implementation: Overview's MergedPulseCard/BusinessPulse call
sites and OrdersOutboundPage.tsx's Shipping Health wrapper, both already
correct.

**2026-07-22 — Triage+pulse outer container must use breakpoint-based wrap, not content-based.**
`flexWrap: 'wrap'` alone (no breakpoint object) causes the primary
(decision/left) card to visually squeeze down toward its flex-basis floor
before the pulse card finally wraps — found in Orders, Outbound, and
Sourcing, all pre-dating this fix. Canonical pattern, matching Overview's
TRIAGE layout (the original correct implementation):
```tsx
sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, flexWrap: { xs: 'nowrap', lg: 'wrap' }, gap: 2.25, alignItems: 'stretch' }}
```
Primary/decision card: `flex: { xs: '1 1 auto', lg: '1 1 0' }` (grows to
fill remaining space at desktop width, full-width when stacked). Pulse
card: `flex: { xs: '1 0 300px', lg: '0 0 300px' }` per the wrap-fill rule
above. Below `lg`, layout jumps directly to full-width stacked columns —
no squeeze zone in between.

Also required on the same container: `alignItems: 'stretch'`, not `'start'`.
In column mode (`xs`, stacked), flex-basis governs height, not width — width
comes from cross-axis alignment. `alignItems: 'start'` lets children shrink
to intrinsic content width, leaving dead space beside them when stacked;
`'stretch'` fills the row. Found missing in Orders, Outbound, and Sourcing
(all set `'start'`); Overview's TRIAGE layout was correct from the start.

> **Supersession note (2026-09-28)** — applies to the two 2026-07-22 geometry
> entries above (Pulse card wrap-fill; Triage+pulse outer container). They
> record the historical layout contract at that time. For new or normalized
> operational-context screens they are superseded by the 2026-09-28 certified
> operational-screen composition: `xs: minmax(0, 1fr)`,
> `lg`+: `minmax(0, 3fr) minmax(260px, 1fr)`, `gap: 2.25` (see §1, FT2
> Triage + Pulse Layout). Existing screens with explicit screen-specific
> contracts are not implicitly migrated by this note. For matching
> operational-screen UX problems, Overview's current certified implementation —
> not its historical Triage/BusinessPulse generation — is the reference.

## 19. Historical committed-`dist` drift — BUILD-DIST-STALE-101, 2026-08-23

**Historical trap:** before BUILD-02, dependent applications could resolve
workspace package exports through generated `dist` while those generated
outputs were committed to Git. Source could therefore change while a
dependent application still consumed stale generated JavaScript or
declarations. DEPLOY-FAILURES-87 exposed the same class of problem in backend
builds.

**Current architecture — BUILD-02, closed 2026-09-18 via #1140:**
`modules/*/dist` and `packages/*/dist` are generated-only, ignored, and must
not be committed. Source, configuration, and tests are authoritative.

Package exports may still resolve through `dist`, so the owning workspace must
be built before dependent runtime or type verification. Use `npm run build:deps`
for the repository dependency build, or the owning workspace build when
validating one package/module in isolation.

**Rule going forward:** never stage generated workspace `dist`. If a dependent
application cannot resolve a package after a source change, rebuild the owning
workspace/dependency graph rather than restoring or committing generated
output.


## 20. An unassigned palette key is not a safe default — THEME-TEXT-DISABLED-MISSING-137, 2026-08-25

`apps/frontend/src/themes/palette.ts` assigned `text.primary` and
`text.secondary` but never `text.disabled`. Meanwhile 27 call sites across 12
files referenced it.

### Why the omission breaks dark mode specifically

`themes/index.tsx` supplies palettes through MUI's `colorSchemes` API — each
scheme gets its own independent `buildPalette()` output:

```ts
colorSchemes: {
  light: { palette: buildPalette(ThemeMode.LIGHT) },
  dark:  { palette: buildPalette(ThemeMode.DARK)  },
}
```

A key omitted from `buildPalette()` never passes through its `isDark` branch, so
both schemes fall back to the same MUI default. That default is not
scheme-aware: it rendered near-black, which is legible on light surfaces and
invisible on `--surface` / `background.paper` in dark mode.

**Rule: every palette key a call site uses must be explicitly assigned in
`buildPalette()`, with both branches of `isDark`.** An omitted key is not "the
MUI default" — it is a value that will look correct in one scheme and broken in
the other, and no amount of call-site patching fixes the class.

### Blast radius, for future reference

27 references in 12 files, in three syntactic forms that all resolve to the same
palette lookup:

```text
theme.palette.text.disabled   6   lucide `color` prop
'text.disabled'              14   MUI sx string
color="text.disabled"         7   JSX prop
```

Grepping only one form undercounts. Search the dotted path, not a single syntax.

### Doctrine note

`palette.ts:40-41` states: *"One surface + one text color per mode. No grey
scales. No ambiguity."* `text.disabled` was defined anyway
(`isDark ? '#6B7280' : '#94A3B8'`). The reasoning: 27 sites already reference it,
so this closes a gap rather than opening a new tier. The doctrine still holds
against inventing *new* greys ad hoc.

### Verification

Live-verified in both colour schemes on three surfaces covering all three
syntactic forms: `PickSessionPage` step tracker (7 refs, lucide form),
Overview live map via `WarehouseGrid` (JSX prop form), and Settings → Billing
(4 refs, sx form). `apps/frontend` tsc held at its 19-error baseline with zero
errors in the touched file.

The remaining nine files were **accepted by inspection, not live-verified**:
`Ft1ChecklistShell`, `PostTrialInterstitial`, `MembersPage`, `WelcomePage`,
`CountingSessionPage`, `StowSessionPage`, `BinCell`,
`SuppliersPortalModuleFT2`, `FloorPlanningModuleFT2`.

Closes `PICK-TRACKER-INACTIVE-ICON-136` (the canonical `PickSessionPage:669`
inactive-node icon carried the same latent defect).

## 21. WMS CTA tier standardization — WMS-CTA-CONSISTENCY-34, 2026-08-26

Applies the existing §2 Tier-1/Tier-2 CTA doctrine to WMS Operations
(`WmsModuleFT2.tsx`, `CountingSessionPage.tsx`), where several
workflow-commit buttons had never adopted it and fell through to MUI's
default `palette.primary` (structural blue) — the exact "NEVER acceptable"
pattern §2 already lists: `<Button variant="contained">` with no `sx`
accent override renders MUI default blue.

### Tier 1 corrected

`background: var(--accent)` / `text: var(--accent-ink)` applied to:

- `WmsModuleFT2`: Start count, Continue count
- `CountingSessionPage`: Confirm bin, Next Bin, Done With This Bin, Finish
  Count, Record finding, Skip item, None here

`None here` commits a zero-count resolution — not a dismissal — so it is
Tier 1 despite previously being styled as a plain text link. `Start
count`/`Continue` open a counting session whose mount effect auto-claims the
task server-side on a first-time start; the click is a real workflow-state
trigger, not mere navigation, even though the button's own handler only sets
local view state.

### Tier 2 stays neutral, not raw MUI blue

The finding-type toggle (Product defect / Packaging defect) and skip-reason
options are selections, not commits — the commit is a separate, adjacent
button (Record finding / Skip item). They previously used
`variant={selected ? 'contained' : 'outlined'}` with no color override,
which also fell through to MUI primary blue. Corrected to a neutral
treatment built entirely from existing tokens: `var(--ink)` / `var(--rule)`
idle (matching the existing suggested-bins select-all ghost pattern),
`var(--surface)` / `var(--rule-2)` selected (the same neutral
elevated-surface/stronger-border pair already used for active/selected
state elsewhere, e.g. the module tab bar's active tab). No new token was
introduced.

### Scope stayed WMS-local

`palette.ts`'s `primary.main` is structural blue, and its own header states
it is "the SINGLE SOURCE OF TRUTH for color" — directly in tension with this
doc's §2 Tier-1 orange-accent doctrine. That tension is **not** resolved by
this issue; only the specific WMS call sites were corrected to use the
tokens this doc already specifies. `palette.ts`, any global `MuiButton`
override, and backend/API behavior were not touched — the app-wide question
of which system governs remains open.

### Token hygiene — closes the WMS portion of CTA-023

The pick-batch CTA family in `WmsModuleFT2.tsx` hardcoded `#10151E` instead
of `var(--accent-ink)` (same value, so the fix changed no rendered pixel).
This is the same defect class §8/§9 already track as **CTA-023** ("migrate
hardcoded `#10151E` → `var(--accent-ink)` ... once the token exists"); this
issue closes the WMS occurrence found during its own audit. The other files
in that sweep (`FulfillmentQueuePage.tsx` ×2, `WmsAnalyticsPage.tsx`,
`ReleaseQueuePage.tsx`, `BlockedOrdersPage.tsx`, `OrdersOutboundPage.tsx`
×2) were not touched, and CTA-023 remains open until they are.

### Verification

Focused frontend regression: `tests/unit/ui/wms/WmsCtaTierConsistency.test.tsx`,
21/21 passing (RED baseline before implementation: 14 failed / 7 passed, on
exactly the buttons and toggles listed above). `test:config`, the WMS
build, and `git diff --check` all passed. Contrast itself was **live-browser
verified in both light and dark mode**, not covered by an automated
pixel/color-computation check — dark accent-ink text on the filled orange
buttons is the intended, doctrine-correct result (§8), not a defect to "fix"
toward white.

## 22. WMS operator-session UX contract — Receive reference implementation, 2026-09-14

Receive is the first fully reconciled implementation of the operator-session
system that Receive, Stow, Pick, Pack, Count, and future floor workflows should
converge toward. The goal is not to make several scanner screens merely look
similar; they must feel like one continuous warehouse operating system from
brief → execution → completion → handoff.

This section governs operator-facing session UX. §14 continues to govern session
routing/module architecture, and §21 continues to govern CTA tier semantics.

### Session change process

Consequential session UX changes follow this sequence:

1. audit the existing end-to-end session;
2. workshop wireframes separately;
3. approve the design direction from those wireframes;
4. implement;
5. automate the regression contract;
6. live-browser verify the real workflow;
7. obtain UX approval;
8. only then update this playbook.

Do not document speculative session UX before the implementation and live flow
have been approved.

### Session Focus Shell

Once an operator enters an active warehouse session, reduce unrelated navigation
and decision surface.

Required behavior:

- hide normal module navigation, global search, and unrelated alerts while the
  workflow is active;
- keep a compact operational header with workflow identity, progress, Exit,
  and connectivity/operator state where useful;
- remain inside the focus shell through completion summary and handoff;
- do not return to the general WMS surface merely because the last scan or count
  has completed.

The shell exists to reduce accidental navigation and protect scanner-driven
muscle memory.

### Persistent Work Note / action identity

Every workflow state must keep the operator's current action identifiable. Treat
the Work Note as the digital equivalent of the note a warehouse lead would hand
to an operator.

At minimum expose, when applicable:

- Action
- Reference
- Item / variant
- Quantity / progress
- Source or destination
- Physical identity
- Next

The Work Note persists through brief, active execution, reconciliation, label
hold, review, and handoff. State changes may change `Action` and `Next`; they
must not erase the identity of the work being performed.

For completed Receive work the Work Note additionally carries:

- `STATUS` → `CLOSED`
- `CLOSED AT` → canonical system close timestamp
- `ACTUAL DELIVERY` → business delivery date

`actual_delivery_date` and `closed_at` are different facts. Actual delivery is
supplier/receiving truth. `closed_at` is audit evidence for when LaSyncro
completed the Receive workflow. Never substitute one for the other and never
invent a client-side close timestamp.

### Typography inside operator sessions

Human-facing language stays in the app's normal Plus Jakarta Sans typography.

Monospace is a deliberate exception only for machine/state facts where fixed
character shapes improve operational recognition, including:

- LSU / LSP / LSO identities;
- SKU and barcode values;
- bin/location codes;
- operational references;
- quantities/progress where the value functions as machine/state evidence.

Do not expand monospace into instructional copy, headings, labels, or general
body text merely to create a terminal aesthetic.

### Scanner-focus state machine

Scanner focus is a workflow state, not a generic autofocus behavior.

Canonical states:

- `SCAN_READY` — scanner input owns focus and automatically regains it after a
  successful scan;
- `SCAN_PROCESSING` — duplicate input is blocked while the previous scan is
  being processed;
- `SCAN_ERROR` — show the recoverable reason, then restore scanner focus;
- `HUMAN_DECISION_REQUIRED` — release scanner focus; do not autofocus a
  consequential CTA;
- `COUNT_READY` — no hidden scanner capture or scanner autofocus;
- `HOLD` — no scanner capture and no trailing-Enter confirmation;
- `SUMMARY` / handoff — no scanner capture.

An operator who needs to scan-scan-scan should continue without touching a
mouse. The moment judgement, reconciliation, or acknowledgement is required,
scanner ownership must stop intentionally.

### Visual hierarchy and symmetry

Active sessions use a three-zone hierarchy:

1. operational facts / progress;
2. the current interaction;
3. consequential action(s).

Keep the primary task in the visual center. Product imagery is contextual and
quiet, not the dominant interaction surface.

Peer controls must have intentional symmetry:

- matching dimensions;
- matching padding/radius;
- matching spacing rhythm;
- aligned columns;
- consistent chip/status treatment;
- consistent CTA hierarchy.

Do not leave one peer action as a loose text block while another is a structured
control.

### CTA semantics inside sessions

§21 remains authoritative:

- consequential state changes and persisted writes use Tier 1 orange accent;
- selections, toggles, and treatment choices remain neutral Tier 2;
- MUI default structural blue is not a WMS interaction state.

Examples:

- `Finish Count`, `Add to reconciliation`, `Finish Line`, label acknowledgement,
  and workflow close are consequential;
- Count/Scan treatment selection and reconciliation-reason selection are neutral
  choices until separately committed.

### Receive count and reconciliation accounting

During active Count or Scan, the operator records **correct sellable units
only**. Do not expose a general `Report Problem` action during ordinary counting.

The primary exit from active counting is `Finish Count`.

At Finish Count:

- `SELLABLE == EXPECTED` → normal completion / label-hold path;
- `SELLABLE < EXPECTED` → explicit reconciliation;
- `SELLABLE > EXPECTED` → explicit over-delivery decision.

Reconciliation exposes three primary facts:

- `EXPECTED`
- `SELLABLE`
- `TO ACCOUNT FOR`

Shortfall completion invariant:

```text
SELLABLE + ACCOUNTED SHORTFALL = EXPECTED
```

Exact completion invariant:

```text
SELLABLE = EXPECTED
```

Over-delivery invariant:

```text
SELLABLE > EXPECTED
→ explicit over-delivery approval required
```

`Missing item` is available only after a shortfall has been established.
Multiple reconciliation allocations may be added until `TO ACCOUNT FOR` reaches
zero.

Canonical shortfall-consuming reasons include:

- Damaged Unit
- Wrong Product
- Wrong Variant
- Missing Item

Barcode mismatch does not consume inventory shortfall.

`quantity_rejected` is not a synonym for missing stock. It remains a legacy /
compatibility quantity for physically present units that were not accepted.
Missing units create canonical Receive problem/accounting records without
inventing an inventory write-off for stock that was never physically present.

Receive problems continue through the canonical Receive exception → Problem
Center path. Do not create a local-only problem system inside the session.

### Reconciliation interaction rules

The reconciliation action area uses:

- factual counters at the top;
- neutral reason selection;
- neutral quantity stepper;
- Tier-1 `Add to reconciliation` because it persists an accounting allocation;
- visible allocation history;
- `Accounted x/y` and remaining quantity;
- Tier-1 `Finish Line` only after `TO ACCOUNT FOR == 0`.

When nothing remains to account for, do not continue displaying instructions
such as "Account for the remaining 0 units." `Next` must advance semantically to
the actual next operator action.

### Label hold

Barcode-less accepted units do not advance merely because inspection completed.

The label hold must be established **before** asynchronous LSU label generation
begins so the session cannot race into Review while printing is in flight.

The operator must explicitly acknowledge that all generated LSU labels are
physically attached before the line/session may continue.

Refresh/re-entry must restore the canonical label-hold state.

### Review and Receive close

Receive cannot close without an explicit Actual delivery date.

Do not silently default this field to "today." The date is a business fact and
must come from the operator.

Successful close persists the Receive close first, refreshes canonical server
truth, and only then enters the completion handoff.

A refreshed or reopened Receive job with canonical `closed_at` must restore
directly into the completion handoff. It must not fall back into Review or expose
`Close Receive` again.

### Completion handoff

Canonical Receive completion language:

> Received units are now available for Stow.

Use operational outcome language. Never explain backend/API implementation
details to the warehouse operator.

The completion surface must not fabricate downstream facts that the current API
does not know. For example, do not invent:

- a Stow task count;
- a bin/location;
- a Stow-ready timestamp;
- any other downstream assignment not yet created.

The Work Note carries the audit seal (`STATUS CLOSED`, canonical `CLOSED AT`,
`ACTUAL DELIVERY`) while `Next` identifies the operational continuation:
`move stock to stow`.

### Data seam for canonical completion evidence

The session component stays presentational per §14.

Canonical completion evidence flows:

```text
Receive API
→ WmsOperationsPage
→ pending Receive session
→ WmsModuleFT2 activeSession
→ ReceiveSessionPage
```

API snake_case fields are deliberately normalized at the app/session boundary:

```text
closed_at            → closedAt
actual_delivery_date → actualDeliveryDate
```

Do not drop these fields when refreshing or reconstructing a Receive session.
A completed session must remain auditable across navigation and browser refresh.

### Verification — Receive reference implementation

Approved 2026-09-14 after:

- full Receive frontend regression: 50/50 passing;
- WMS Operations deep-link regression: 2/2 passing;
- `@lasyncro/wms` build passing;
- scoped `git diff --check` passing;
- live localhost verification of closed-session refresh/re-entry;
- live verification of canonical close timestamp and Actual delivery evidence;
- live verification of the operator-facing Stow handoff language.

The broader `apps/frontend` TypeScript project remains blocked by unrelated
pre-existing repository errors outside this Receive/WMS change. No reported
TypeScript error from that run was in the touched Receive/WMS files.

## 23. Design-system consistency pass — 2026-10-22

**One source of truth.** `apps/frontend/src/themes/tokens.ts` now holds every
colour. `themes/index.tsx` emits the CSS variables from it and
`themes/palette.ts` builds the MUI palette from it, so the old split — MUI blue
primary vs orange CTAs, slate `#F1F5F9` vs paper `#FAFAF8`, three different
dark navies — is gone. `theme.palette.primary` is the accent (with
`--accent-ink` contrast text); `secondary` is neutral ink, so a stray
`color="secondary"` can no longer render amber. FT2 `--ft2-*` variables and
`AuthWrapper1`'s forced-dark block are generated from the same tokens.

**Contrast.** New text-safe tokens, each ≥ 4.5:1 on bg / bg-2 / surface in
both modes:

- `--accent-text` — accent-coloured text (Tier 2 ghost pills, links). The
  pill *border* stays `--accent`.
- `--critical-text`, `--warning-text` — severity text; `--critical-ink` /
  `--warning-ink` remain for dots, bars and fills.
- `--ink-3` and `--ink-4` re-valued (light `#545A66` / `#656B78`, dark
  `#A8ACB5` / `#979CA7`); `--ink-4` previously failed AA in both modes.

**§11 resolved.** Dark `--bg-2` is now `#18202F` (between `--bg` and
`--surface`), so `bg-2` panels no longer vanish on `surface` in dark mode.

**Sweeps.** White-on-accent → `--accent-ink` (20 sites, incl. pagination and
filter pills); `color: 'var(--accent)'` text → `--accent-text` (174 sites);
hardcoded `#E5484D` / `#D9A23B` / `#EAB308` / `#4CAF7A` → severity tokens;
`color="secondary"` buttons → correct tier; Instrument Serif / `var(--serif)` /
`var(--sans)` / DM Mono overrides removed; non-6px accent CTAs → `6px`;
local palettes in `AhaMomentPage`, `FinancesIntelligencePage` and
`AuthWrapper1` now reference tokens; `decisionTokens` resolve to CSS vars.

**Known exceptions left in place:** SVG/Recharts `fill`/`stroke="#FF6B2B"`
(mode-invariant accent), categorical printer-role colours in
`ShopSettingsWarehousePage`, `activationMotionTokens.completion` (animated
value), and `_themes-vars.module.scss` (password-strength colours).
