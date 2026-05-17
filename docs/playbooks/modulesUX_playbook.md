# LaSyncro UX Playbook
**Version 1.0 — May 2026**
**Status: Living document — update with every new module shipped**

---

## Purpose

This playbook is the single source of truth for UX decisions across laSyncro's web and mobile app. Every engineer building or modifying a module must read this before writing a line of UI code. It exists to ensure the product feels like one system, not a collection of disconnected screens.

The rules here are not suggestions. Deviations require a product review.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Design Tokens](#2-design-tokens)
3. [Typography](#3-typography)
4. [Layout & Spacing](#4-layout--spacing)
5. [Navigation](#5-navigation)
6. [Component Library](#6-component-library)
7. [Severity System](#7-severity-system)
8. [Loading & Skeleton States](#8-loading--skeleton-states)
9. [Module Anatomy](#9-module-anatomy)
10. [Dark & Light Mode](#10-dark--light-mode)
11. [Module Register](#11-module-register)
12. [Engineering Rules](#12-engineering-rules)

---

## 1. Design Philosophy

LaSyncro is a command centre for merchants. Every screen answers one question: **what needs my attention and what do I do about it?**

Three principles govern every UX decision:

**Minimum viable cognitive load.** Every element on screen must earn its place. If removing it doesn't break comprehension, remove it. Operators make real decisions using this product under time pressure.

**Commercial consequence first.** Issues are always ranked by financial impact, not by time or type. The most expensive problem is always at the top. This is non-negotiable across all modules.

**Action over information.** Every data point must have a next step. A number without a CTA is decoration. A signal without a deep link is noise.

---

## 2. Design Tokens

All tokens are defined in `apps/frontend/src/themes/palette.ts` and `apps/frontend/src/themes/index.tsx`. **Never hardcode hex values anywhere in the codebase.** Use the CSS variables below exclusively.

### Color tokens

| Token | Usage |
|---|---|
| `var(--bg)` | Page / outlet background — darkest layer |
| `var(--bg-2)` | Secondary surface, column headers, inset backgrounds |
| `var(--bg-3)` | Tertiary surface, hover states on `--bg-2` |
| `var(--surface)` | Cards, panels, modals — elevated above page |
| `var(--ink)` | Primary text |
| `var(--ink-2)` | Strong secondary text |
| `var(--ink-3)` | Muted text, secondary labels |
| `var(--ink-4)` | Placeholder text, disabled, section labels |
| `var(--rule)` | Borders, dividers |
| `var(--rule-2)` | Stronger dividers |
| `var(--accent)` | Brand orange — `#FF6B2B` — CTAs, active nav, active breadcrumb |
| `var(--accent-ghost)` | Subtle accent fill — active nav background |
| `var(--accent-border)` | Accent border for badges |

### Semantic signal colors (MUI palette — never use raw hex)

| Role | Token |
|---|---|
| Critical / error | `theme.palette.error.main` |
| Attention / warning | `theme.palette.warning.main` |
| On track / success | `theme.palette.success.main` |
| Interactive / info | `theme.palette.primary.main` |

### Surface elevation hierarchy

```
var(--bg)          ← page background
  └── var(--surface)   ← cards, panels
        └── var(--bg-2)    ← table headers, inset areas
              └── var(--bg-3)    ← deeper insets, hover
```

Never place a `--surface` element directly on another `--surface` without a `var(--rule)` border between them.

### Dark mode alpha values

Group header backgrounds must use mode-aware alpha. Use the pattern:
```typescript
bgcolor: theme.palette.mode === 'dark'
  ? alpha(theme.palette.error.main, 0.18)
  : alpha(theme.palette.error.main, 0.06)
```

Never use a single alpha value for both modes — 0.06 is invisible in dark mode.

---

## 3. Typography

### Scale

| Role | Font | Size | Weight | Usage |
|---|---|---|---|---|
| `display` | DM Serif Display | 36–40px | 400 | Page greeting h1 — Overview only |
| `page-sub` | System sans | 13–14px | 400 | Greeting subline with revenue stake |
| `stat-value` | System sans | 28px | 500 | KPI numbers in stat cards |
| `stat-unit` | System sans | 14px | 400 | "orders" suffix on stat numbers |
| `label-caps` | System sans | 10px / 500 / 0.08em tracking | 500 | Stat card labels, table headers, section names |
| `body-strong` | System sans | 13px | 500 | Issue titles, money values, active nav |
| `body` | System sans | 13px | 400 | Descriptions, secondary content |
| `caption` | System sans | 11px | 400 | Age values, module tags, timestamps |
| `nav-item` | System sans | 13px | 400 (500 active) | Sidebar nav items |

### Rules

- **Never ALL CAPS for section labels.** Use `label-caps` style (10px / 500 / 0.08em letter-spacing) with sentence case internally but `textTransform: 'uppercase'` in CSS only.
- **Serif display font is exclusive to the Overview greeting.** No other module uses `DM Serif Display`.
- **Font import:** `DM Serif Display` is loaded via Google Fonts in `apps/frontend/index.html`. Do not import it again elsewhere.
- Never use `fontWeight: 700` or `fontWeight: 800` anywhere in the app — maximum is `600` for headings, `500` for labels.

---

## 4. Layout & Spacing

### App shell dimensions

| Constant | Value | Location |
|---|---|---|
| Topnav height | 48px | `AppLayout/index.tsx` |
| Sidebar expanded | 180px | `SIDENAV_WIDTH_EXPANDED` |
| Sidebar compact | 56px | `SIDENAV_WIDTH_COMPACT` |
| Page padding | `32px 40px` (desktop) | Applied per module |
| Card border radius | 10px | All card containers |
| Badge border radius | 4px | Severity badges |

### Spacing grid

All spacing uses multiples of 4px. Use MUI's `sx` prop with numeric values (MUI `1` = `8px`):

```
4px   → xs gaps, badge padding
8px   → internal card gaps, icon margins
12px  → between grid items
16px  → between sections within a card
24px  → between major page sections
32px  → page padding vertical
40px  → page padding horizontal
```

### Page structure

Every FT2 module page follows this structure:
```
<page padding 32px 40px>
  <header section>        ← no card, sits on --bg directly
  <primary data section>  ← --surface card with border
  <secondary section>     ← --surface card with border
  <tertiary section>      ← --surface card with border (if needed)
</page>
```

Never wrap the entire page in a single card. Each section is its own elevated surface.

---

## 5. Navigation

### Structure

Single `WORKSPACE` group. 8 top-level items. **Never add a top-level item without product review.**

| # | Label | Path | Children |
|---|---|---|---|
| 1 | Overview | `/overview` | — |
| 2 | Orders | `/orders` | Fulfillment Queue, Returns |
| 3 | Warehouse | `/wms` | Floor Planning, Analytics |
| 4 | Demand | `/demand` | — |
| 5 | Inventory | `/products` | Catalog, Costs, WMS Readiness, Problem Center |
| 6 | Suppliers | `/suppliers-portal` | — |
| 7 | Finances | `/cashflow` | Cash Flow, Finances, Margin |
| 8 | Team | `/members` | — |

### Modes

**Expanded (180px):** Icon + label. Click parent with children → inline accordion opens below. Click again → collapses. One accordion open at a time.

**Compact (56px):** Icons only. Hover parent with children → floating popover appears to the right at cursor height. Click child → navigates and dismisses popover.

Toggle: chevron handlebar on the right edge of the sidebar at 50% height. `EXPANDED ↔ COMPACT` only. There is no `CLOSED` state.

### Active state

```typescript
color: 'var(--accent)',
bgcolor: 'var(--accent-ghost)',
borderLeft: '2px solid var(--accent)',
fontWeight: 600,
```

### Tier gating

Items requiring a higher tier show an upgrade badge inline. They are **never hidden** — always visible but `disabled: true`. Clicking opens the `UpgradePrompt` modal.

### Sync Status block

Rendered at the bottom of the sidebar in expanded mode only. Shows:

- Green dot + "All channels live" (when FT2 ready)
- Amber dot + "Syncing..." (when syncing)

Source: `isFt2Ready` prop from `AppLayout`. Replace with real channel health API when Channels module is built.

### Top navigation bar

Full-width across the top of the viewport. Contains left to right:

- Logo (light: `logo.png`, dark: `logo-dark.png`) — switches via `useColorScheme`
- Breadcrumb: `⌂ / Workspace / <ActiveModule>` — active segment in `var(--accent)`
- Right: Alerts bell with badge, light/dark toggle, user avatar

**No gear/settings icon in the top bar.** Settings is a future nav item.

---

## 6. Component Library

All reusable components live in their module's `src/ui/` or in `packages/shared`. Never build one-off components without first checking if a shared one exists.

### StatCard

KPI metric tile. Used in 4-card rows on overview-type pages.

```
Props: label, value, unit?, subtext, variant?('danger'|'default'), onClick?
```

Structure:

- Label: `label-caps` style, above the number
- Value: 28px / 500 weight
- Unit: 14px / 400 weight, inline after value
- Subtext: 11px / `var(--ink-3)`, below value
- Container: `--surface` bg, `var(--rule)` border, 10px radius, 14px 16px padding

Danger variant: value color uses `theme.palette.error.main`.

Skeleton: label stays visible, value replaced with shimmer block (60×28px), subtext with shimmer (100×12px).

### SeverityBadge

3-tier severity indicator. Used in The Brief table and notification surfaces.

| Tier | Label | Dot color | Background alpha |
|---|---|---|---|
| Critical | Critical | `error.main` | 0.12 (light) / 0.18 (dark) |
| Attention | Attention | `warning.main` | 0.12 (light) / 0.18 (dark) |
| On Track | On Track | `success.main` | 0.12 (light) / 0.18 (dark) |

Never use raw red/amber/green text without this badge wrapper.

### BriefTable (The Brief)

Severity-grouped issue table. The primary action surface on the Overview module. Will be extended to other modules.

Columns: `Severity | Issue (title + sub) | £ at risk | Age | Snooze | Action`

Grid: `110px 1fr 80px 48px 80px 96px`

Group rows: colored background (mode-aware alpha), uppercase label, item count right-aligned.

Action buttons: Critical → "Review ›" (orange filled). Attention → "Open ›" (ghost). On Track → no action button.

Snooze: ghost text button. Defers to tomorrow. Snooze logic is per-signal on the backend.

Column header row: `var(--bg-3)` background, `var(--rule)` border top and bottom.

### PageActions

Top-right of content area, aligned with the page header. Always a ghost + primary button pair.

```
"Export brief"   ← ghost button (transparent bg, var(--rule) border)
"Resolve all →"  ← primary button (var(--accent) bg, white text)
```

Position: `position: absolute` or flex `ml: auto` inside the header row. Never inside a card.

### BreadcrumbBar

```
⌂ / Workspace / <ActiveModule>
```

- Home icon: `<Home size={14} />` from lucide-react, links to `/`
- "Workspace": static text, `var(--ink-3)`
- Active segment: `var(--accent)`, `fontWeight: 500`, not a link

### SyncStatusBar

Sidebar bottom. Expanded mode only.

```
SYNC STATUS          ← label-caps
● All channels live  ← green dot + body text
Last sync 2 min ago  ← caption, var(--ink-4)
```

---

## 7. Severity System

LaSyncro uses a strict 3-tier severity system across all modules. Priority maps to tier as follows:

| Priority (backend) | Tier | Color | Group label |
|---|---|---|---|
| 1–2 | Critical | `error.main` | Critical — Act today |
| 3–4 | Attention | `warning.main` | Attention — Review this week |
| 5 | On Track | `success.main` | On track — No action needed |

This mapping lives in `OverviewModuleFT2.tsx` and must be replicated identically in any module that surfaces severity-ranked issues.

**Never invent new severity tiers.** If a signal doesn't map cleanly to one of these three, escalate to product.

---

## 8. Loading & Skeleton States

Every module must implement a skeleton state. No module may show a blank screen, a spinner, or raw `—` dashes during data load.

### Rules

- **Skeleton on every data surface.** Stat cards, table rows, and list items each have a skeleton variant.
- **Labels stay visible during skeleton.** Only the value and subtext are replaced with shimmer blocks.
- **Date header shows `SYNCING…`** instead of `LIVE` while data is loading.
- **The Brief shows 5 shimmer rows** at the correct grid column widths.
- **Skeleton animation:** CSS `@keyframes` shimmer from `var(--bg-2)` to `var(--bg-3)` and back. Duration: 1.5s, infinite.

### Trust-gated state

When `morningBrief === null` (trust not yet established — first sync incomplete):

- Replace greeting with "Setting things up"
- Replace summary with "Your brief will appear once your first sync completes."
- Hide stat cards and The Brief entirely
- Show footer: "Waiting for data sync"

---

## 9. Module Anatomy

Every FT2 module follows this structure. Deviations require product sign-off.

### File structure

```
modules/<module-name>/
  src/ui/
    pages/
      <Module>FT2.tsx       ← UI component (no fetching, no hooks)
    index.ts                ← exports
  package.json
  tsconfig.json

apps/frontend/src/pages/
  <module>/
    use<Module>Ft2Snapshot.ts    ← React Query data hook
    use<Module>Ft2Adapter.ts     ← maps raw snapshot to module props
  ft2-pages/
    <Module>FT2Page.tsx          ← page component (wires hooks → module)
```

### Module rules

**No fetching inside modules.** Modules are pure UI components. All data arrives via props. All hooks live in `apps/frontend/src/pages/`.

**No cross-module imports.** A module cannot import from `apps/frontend` or from another module. Shared primitives go in `packages/shared` or `@lasyncro/ui-ft2`.

**No hardcoded colors.** Use `theme.palette.*` or CSS variables exclusively. See §2.

**No hardcoded currency symbols.** Always use `Intl.NumberFormat` with the `currency` prop passed from the page.

**Props contract is data-only.** The `DataProps` interface contains only data — no callbacks, no navigation functions. Callbacks are in the separate `Props` type that extends `DataProps`.

### Page component rules

Every `*FT2Page.tsx` must:

1. Declare loading state with `if (!snapshot.isSuccess) return null` — never render a broken shell
2. Pass `currency` from `useEntitlements().displayCurrency`
3. Pass `userName` from `useAuth().user?.first_name`
4. Never render `<FT2DateRangeBar>` on the Overview page
5. Never render alert banners that duplicate content already in stat cards or The Brief

---

## 10. Dark & Light Mode

The app ships with full dark and light mode support. Every component must work correctly in both.

### Rules

- **Always use CSS variables or `theme.palette.*`.** Never use `colorScheme === 'dark'` to toggle colors except for alpha values where the contrast ratio genuinely differs between modes (see §2).
- **Typography uses CSS variable references**, not resolved palette values. Resolved values are captured at theme build time and don't update on scheme switch.
- **Logo assets:** `logo.png` (light mode), `logo-dark.png` (dark mode), `favicon.png` (light compact), `favicon_dark.png` (dark compact). Switch via `mode` from `useColorScheme()`.
- **Test both modes before shipping.** Every PR touching UI must include a visual check in both light and dark.

### Known palette values

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#FAFAF8` | `#0D1526` |
| `--bg-2` | `#F3F2EF` | approx `#111B2E` |
| `--surface` | `#FFFFFF` | `#152032` |
| `--accent` | `#FF6B2B` | `#FF6B2B` (same) |
| `--ink` | `#0F0E0D` | `#E5E7EB` |
| `--ink-3` | `#6B7280` | approx `#6B7280` |
| `--rule` | `#E8E6E0` | `#1F2937` |

---

## 11. Module Register

This section documents the UX status of every module. Update when a module ships or is audited.

### Overview

| Property | Value |
|---|---|
| Route | `/overview` |
| Module package | `@lasyncro/overview` |
| Page component | `apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx` |
| UI module | `modules/overview/src/ui/pages/OverviewModuleFT2.tsx` |
| UX audit status | ✅ Complete — May 2026 |
| Known deferred | OVR-18: Stockout watchlist (needs `/api/v1/modules/demand/stockout-watchlist`) |

**Sections:**

1. Header — greeting (DM Serif Display, 36px), date + LIVE badge, page actions
2. Stat cards — 4-card row: Revenue at Risk · Orders Blocked · Ready to Ship · SLA Breached
3. The Brief — severity-grouped table ranked by commercial consequence

**Data sources:**

- `useOrdersFt2Snapshot` → `operationalControl` → pulse data
- `useMorningBriefSnapshot` → signals (owner/admin only)
- `useAuth` → `user.first_name` → greeting name
- `useEntitlements` → `displayCurrency` → currency formatting

---

### Orders

| Property | Value |
|---|---|
| Route | `/orders` |
| Sub-routes | `/fulfillment` (Fulfillment Queue), `/returns` |
| UX audit status | 🔴 Not audited |

---

### Warehouse

| Property | Value |
|---|---|
| Route | `/wms` |
| Sub-routes | `/floor-planning`, `/wms/analytics` |
| UX audit status | 🔴 Not audited |

---

### Demand

| Property | Value |
|---|---|
| Route | `/demand` |
| Tier gate | Growth |
| UX audit status | 🔴 Not audited |

---

### Inventory

| Property | Value |
|---|---|
| Route | `/products` |
| Sub-routes | `/products/catalog`, `/products/costs`, `/products/wms-readiness`, `/problem-center` |
| UX audit status | 🔴 Not audited |

---

### Suppliers

| Property | Value |
|---|---|
| Route | `/suppliers-portal` |
| UX audit status | 🔴 Not audited |

---

### Finances

| Property | Value |
|---|---|
| Route | `/cashflow` (parent) |
| Sub-routes | `/cashflow`, `/finances`, `/finances/margin` |
| Tier gate | Growth |
| UX audit status | 🔴 Not audited |

---

### Team

| Property | Value |
|---|---|
| Route | `/members` |
| Page component | `apps/frontend/src/pages/ft2-pages/MembersPage.tsx` |
| UX audit status | 🟡 Page exists, not audited against design system |

---

## 12. Engineering Rules

These rules are absolute. No exceptions without a documented product decision.

### Before touching any UI

1. Read this playbook in full.
2. Run `npx tsc --noEmit` to confirm a clean baseline.
3. Audit the current state of the component before proposing changes.
4. Never change more than one issue at a time.

### Code standards

- **No hardcoded hex values.** Use CSS variables or `theme.palette.*` exclusively.
- **No inline `style={}` props.** Use MUI `sx` prop only.
- **No `!important`.** If you need it, the specificity model is wrong.
- **No `console.log` in production code.** Use `console.info` with a tagged prefix like `[SIDENAV][INIT]` and gate behind `process.env.LOG_LEVEL === 'debug'`.
- **No cross-module imports.** Modules are isolated packages. Shared code goes in `packages/shared` or `@lasyncro/ui-ft2`.
- **Rebuild modules after every change.** Run `npm run build -w modules/<name>` before testing in the browser. The dev server uses compiled `dist/` output.

### Adding a new module

Follow this checklist in order:

1. Create `modules/<name>/src/ui/pages/<Name>ModuleFT2.tsx` — UI only, no hooks
2. Create `apps/frontend/src/pages/<name>/use<Name>Ft2Snapshot.ts` — React Query hook
3. Create `apps/frontend/src/pages/<name>/use<Name>Ft2Adapter.ts` — maps snapshot to props
4. Create `apps/frontend/src/pages/ft2-pages/<Name>FT2Page.tsx` — wires hooks to module
5. Register route in `apps/frontend/src/App.tsx` (or equivalent router file)
6. Register nav item in `apps/frontend/src/runtime/navBootstrap.ts`
7. Add module to this playbook's Module Register (§11)
8. Run `npx tsc --noEmit` — must be clean
9. Visual check in both light and dark mode

### Updating this document

This document lives at the root of the repository. Update it when:

- A new module is audited or shipped
- A design token is added or changed
- A new reusable component is built
- A navigation item is added, removed, or restructured
- A severity or trust rule changes

Every update must include the version date at the top of the file.

---

*LaSyncro UX Playbook — maintained by the product engineering team.*
*Last updated: May 2026*