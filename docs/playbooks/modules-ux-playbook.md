# LaSyncro — Modules UX Playbook

> **Scope:** Webapp FT2 modules — all operator-facing surfaces.
> **Last updated:** 2026-06-21
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
- Use `TRIAGE_PREVIEW_LIMIT = 4`.
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
- Avoid `monospace` unless a documented exception exists for scanner/barcode/technical-code readability.

### Color Tokens

```css
--accent:        #FF6B2B   /* primary CTA fill — NEVER changes between modes */
--accent-hover:  #FF8C5A
--accent-ghost:  rgba(255,107,43,0.12)
--accent-border: rgba(255,107,43,0.25)
--bg:            #FAFAF8   /* light */ / #151D29 /* dark */
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
