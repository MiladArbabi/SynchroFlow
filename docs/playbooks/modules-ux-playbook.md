# LaSyncro — Modules UX Playbook

> **Scope:** Webapp FT2 modules — all operator-facing surfaces.
> **Last updated:** 2026-05-28
> **Sprint:** CTA Consistency Audit & Standardisation

---

## 1. Design System Foundations

### Typography

- Headlines: `Instrument Serif`
- Body / UI: `DM Sans`

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

- Borders: always `0.5px` — never `1px`
- `fontWeight`: max `600` for CTAs, max `500` for body — never `700`
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
| `fontWeight: 700` | Max is `600` per design system |

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
| ORD-01 | 🟡 | `modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx` | 624 | `View all orders →` navigates to `/orders` root — needs wiring to full order list |

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

## 6. For Future Engineers

### Adding a new CTA

1. Identify tier: primary action → filled accent, navigation → ghost pill.
2. Use `<Box>` — never `<Typography>` for clickable elements.
3. For MUI `<Button>`, always add `sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}`.
4. Never hardcode colors. Use `var(--accent)` or `theme.palette.common.white`.
5. `borderRadius` is always `'6px'`. `fontWeight` max `600`.
6. Run `npm run build -w <module>` after every change to confirm type safety.

### Auditing a new module

```zsh
grep -rn "textDecoration: 'underline'" modules/<name>/src/ --include="*.tsx"
grep -rn "variant=\"contained\"" modules/<name>/src/ --include="*.tsx" | grep -v "sx.*accent"
grep -rn "color: '#" modules/<name>/src/ --include="*.tsx"
```