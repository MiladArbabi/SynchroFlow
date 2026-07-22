# LaSyncro — Modules UX Playbook

> **Scope:** Webapp FT2 modules — all operator-facing surfaces. Auth pages (`apps/frontend/src/pages/authentication/*`) are a **brand surface**, governed by `docs/blueprints/auth_blueprint.md` — the font ban and layout rules below do not apply there.
> **Last updated:** 2026-07-17
> **2026-07-17 — Catalog Status severity order gained a 4th tier.** "Not received" (SKU exists, no `inventory_truth` row — never received into warehouse) now ranks above Phantom as the highest severity: `not received > phantom > zero-stock > no-SKU > sellable`. Distinct from Zero stock (confirmed empty inventory row) — conflating the two sent operators to the wrong workflow (reorder vs. check receiving). Also: the `Orders/Inbound` pattern referenced in the entry below is deprecated — receiving now lives under WMS Operations (`/wms`).
> **2026-06-21 — Suppliers Portal gained standalone supplier CRUD.** Suppliers were previously create-only inside the New-PO dialog; the portal's Suppliers list now supports add/edit/remove without a PO. Pattern: a single reusable `SupplierFormDialog` (mode `add` | `edit`) drives every supplier entry point for identical fields + validation; "Add supplier" uses the filled-accent CTA convention (per CTA-016); per-row Edit/Delete are outlined inline actions. Delete is a **soft-delete** (`active = false`) — `purchase_orders.supplier_id` is `ON DELETE RESTRICT`, so PO history is preserved and the supplier is hidden from new POs. Place record-management CRUD on the owning operational surface, not in Settings (which is for shop config, not records).
> **2026-06-20 — Inventory/Catalog adopted the canonical triage + pulse layout** (decision card + `PulseRow` rail, matching Orders/Inbound). Catalog is now the reference for a **full-width sortable column grid**: a shared `gridTemplateColumns` constant drives both header and rows (Product · Variants · On-hand · Available · Status · Action), every header sortable with the `↑/↓` affordance, and a severity-ranked Status sort (phantom > zero-stock > no-SKU > sellable). Avoid the legacy fixed stat-card grid for new module surfaces.

---

## 1. Design System Foundations

### FT2 Triage + Pulse Layout

Canonical triage + pulse layout:

```tsx
<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'start' }}>
```

Decision card:

```tsx
<Box sx={{ flex: '1 0 300px', minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>
```

Pulse card:

```tsx
<Box sx={{ flex: '0 0 300px', bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '18px 20px' }}>
```

## Rules

Use flex with wrapping, not fixed two-column grid.
Decision card must not shrink below 300px.
Pulse rail is fixed at 300px.
When both cards no longer fit side by side, the pulse card wraps below.
Decision card then takes the full available row width.
Card shell uses bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px'.
Pulse card padding is p: '18px 20px'.
Orders Overview is the source of truth for this layout.

### FT2 Page Scroll Rule
Main module pages should prefer page-level vertical scroll over nested card/list scroll.
Rules:

- Do not give primary lists their own `overflowY: 'auto'` unless explicitly required.
- Avoid parent `height: '100%'` + `overflow: 'hidden'` clamps when the list should extend the page.
- Drawer, modal, and side-panel bodies may keep internal scroll.
- Table/list cards may keep `overflow: 'hidden'` for rounded corners, but the row container should not own vertical scroll.

**Board Layout Exception (2026-07-21, OF-12):** Multi-column board layouts (e.g. Order Flow's Blocked / Pool / Fulfillment lanes) may give each column independent `overflowY: 'auto'` scroll, and their shared parent may use `height: '100%'` to bound row height for `alignItems: 'stretch'`. A board's purpose is simultaneous visibility across lanes — forcing page-level scroll on a board scrolls all lanes out of view together to reach one lane's overflow, defeating the layout. This exception applies only to genuine multi-column board pages, not single-list module pages, which remain governed by the base rule above.

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

- Show a maximum of 4 visible decisions per decision group.
- If a group has more than 4 items, render a centered `See X more` control below the first 4.
- Clicking `See X more` expands the remaining items with MUI `<Collapse timeout={180} unmountOnExit>`.
- Expanded state must provide `Show less` and collapse the hidden items.
- Apply this pattern to decision categories such as `Critical — act today` and `Watch`.
- Do not discard hidden items with `.slice(0, 4)` at the source level.
- Keep the full source array, then derive:
  - `visibleItems = items.slice(0, TRIAGE_PREVIEW_LIMIT)`
  - `hiddenItems = items.slice(TRIAGE_PREVIEW_LIMIT)`
- Use `TRIAGE_PREVIEW_LIMIT = 3`.
- `Everything else` may remain a separate collapsed/on-track group, but should not be treated as an urgent decision category.

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

```css
--accent:        #FF6B2B   /* primary CTA fill — NEVER changes between modes */
--accent-hover:  #FF8C5A
--accent-ghost:  rgba(255,107,43,0.12)
--accent-border: rgba(255,107,43,0.25)
--bg:            #FAFAF8   /* light */ / #151D29 /* dark */
--bg-2:          #F3F2EF   /* light */ / #1C2740 /* dark — WARNING: identical to --surface in dark mode, see §11 */
--bg-3:          #E8E6E0   /* light */ / #243050 /* dark */
--surface:       #FFFFFF   /* light */ / #1C2740 /* dark */
--ink:           #0F0E0D   /* light */ / #F0EEE8 /* dark */
--ink-3:         #6B7280   /* light */ / #8B8F9A /* dark */
--rule:          #E8E6E0   /* light */ / rgba(255,255,255,0.08) /* dark */
```

### Hard Rules

- Card/module borders: `1px solid var(--rule)`
- CTA ghost borders: `0.5px solid var(--accent)` or `0.5px solid var(--accent-border)`
- Page/module headlines may use `fontWeight: 700`
- Body copy uses `fontWeight: 300`
- Section/card titles usually use `fontWeight: 500`
- Metric values and CTAs use `fontWeight: 600`
- Never hardcode hex colors in components — always use tokens or `theme.palette.*`
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
    bgcolor: 'var(--accent)', color: theme.palette.common.white,
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
    color: 'var(--accent)', border: '0.5px solid var(--accent)',
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
            color: i + 1 === page ? '#fff' : 'var(--ink-3)',
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
4. Never hardcode colors. Use `var(--accent)` or `theme.palette.common.white`.
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
`OrdersModuleFT2.tsx`) once an order's priority flag is confirmed
persisted (`isPriorityFlagged === true`), replacing the filled-orange
default state.

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

**Why this exists:** two components (`OrderCapBanner`, `UsageMeter`) each
had their own copy-pasted 80%-cutoff logic before this change, with no
shared source — a recipe for silent drift where "approaching the limit"
means something different on different screens. Extracted once, consumed
by both the loud banner variant and the quiet inline meter variant.

**Pattern — two presentations, one data source:**

- **Loud (banner):** appears inline on the relevant page only when
  `level !== 'ok'`, dismissed by not rendering rather than a close button.
  First use: `OrderCapBanner.tsx` (ingestion cap, single threshold `[0.8]`,
  unchanged legacy behavior), `ShippedOrderCapBanner.tsx` (shipped/pack
  cap, two-stage `[0.75, 0.9]`, new 2026-07-14).
- **Quiet (meter):** always visible on the Billing usage panel, progress
  bar fills proportionally, color shifts via the same `level` value.
  `UsageMeter` in `BillingSettings.tsx`, upgraded to 3-stage this session.

**Scoping rule — banners are page-scoped, not global.** `OrderCapBanner`
was already scoped to `OrdersFT2Page.tsx` only, not Overview or other
modules. `ShippedOrderCapBanner` follows the same convention deliberately
— cap warnings belong on the page where the capped activity happens, not
broadcast everywhere. Don't mount cap banners globally; each one is
relevant to a specific workflow.

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
| Sourcing Pulse | `modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx` | ✅ Migrated 2026-07-22 |
| Business Pulse (Overview) | `modules/overview/src/ui/pages/OverviewModuleFT2.tsx` | Not started |
| Today's Pulse (Orders) | `modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx` | Not started |
| Shipping Health (Outbound) | `apps/frontend/src/pages/ft2-pages/OrdersOutboundPage.tsx` | Not started |