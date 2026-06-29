# LaSyncro — Product Structure

> **Created:** 2026-06-29. Ground truth pulled directly from `apps/frontend/src/runtime/navBootstrap.ts` — this file did not exist before tonight; the nav structure had only ever been discussed in conversation, never written down. An earlier conversational recap of this structure (Suppliers → "Open POs, Receiving") was wrong on two points once checked against source — this doc is sourced from `navBootstrap.ts` directly, not from memory.

## Top-level structure (8 items, in `order`)

Overview                                                          /overview
Orders            → Overview, Order Flow, Outbound                /orders
Warehouse         → Operations, Floor Planning*, Analytics        /wms
Returns & Resolution → Returns, Product Issues                    /returns
Inventory         → Intelligence, Catalog, Demand†, Costs, Data Quality  /inventory
Purchasing        → Open Pos, Suppliers                           /suppliers-portal
Finances          → Finances, Cash Flow, Margin                   /finances
Team                                                               /team
\* `requiredTier: 'scale'` — gated. † `requiredTier: 'growth'` — gated.

## Known structural issues (confirmed, not yet fixed in code)

- **Duplicate `id: 'suppliers'`** — used for both the Purchasing parent (`id: 'suppliers', title: 'Purchasing'`) and its own child (`id: 'suppliers', title: 'Suppliers'`). To be fixed alongside the Purchasing third-tab addition (see below) — explicitly bundled by decision, not yet executed.
- **Casing inconsistency** — child `title: 'Open Pos'` (lowercase) vs. the in-page tab's `label: 'Open POs'` (correct) vs. the page header. Not yet reconciled across all three.
- **Cross-module path** — Inventory's "Data Quality" child points to `/wms/readiness`, inside Warehouse's URL space rather than Inventory's. Not confirmed broken, just structurally unusual — flagged for awareness.
- **Breadcrumb depth/labeling bugs** — see `modules-ux-playbook.md`; root cause traced to URL-segment-based generation rather than reading this nav tree, which is why children whose path doesn't share their parent's prefix (Floor Planning, Product Issues) lose their parent crumb entirely.

## 2026-06-29 — Purchasing reopened

Product Structure was treated as locked at the start of tonight's session. It was explicitly reopened when a third Purchasing submodule was added in the UI (working name "Sourcing" — **not yet finalized**), to house a new supplier-recommendation surface for reordering. Direction and supporting facts are in `docs/playbooks/sourcing-recommendation-playbook.md`; the recommendation algorithm itself is not yet designed. Routing plumbing (new tab entry, new route, new sidenav child, the duplicate-id and casing fixes above) is confirmed mechanical but not yet implemented.

## Breadcrumb bug — confirmed root cause, 2026-06-29

`TopnavbarContent.tsx` builds breadcrumbs purely from `location.pathname.split("/")`, capitalizing each raw URL segment — it never imports or reads `navBootstrap.ts`. This explains every observed symptom:
- Wrong labels: registered titles (`"Order Flow"`) are ignored in favor of the raw segment (`"flow"` → `"Flow"`).
- Missing parent crumbs: depth comes from how many `/`-separated segments the *URL* has, not from the nav tree's parent/child structure — so a child whose path doesn't share its parent's URL prefix (Floor Planning, Product Issues) loses its parent crumb entirely.
- The literal `"Workspace"` segment is a hardcoded `<Typography>`, coincidentally matching `registerNavGroup`'s label with no actual binding to it.

**Real fix:** replace the URL-split logic with a lookup against the registered nav tree (need to see what `registerNav.ts` exposes), resolving the current path to its nav item and walking its parent chain for both correct titles and correct depth. Not a one-line fix — not yet scheduled.

## 2026-06-29 — Purchasing third tab shipped and verified

Duplicate `id: 'suppliers'` and `'Open Pos'` casing fixed in `navBootstrap.ts`. Third child "Sourcing" added, routed to `/suppliers-portal/sourcing`, rendering a placeholder view pending the recommendation engine. Verified live in browser: all three tabs (Open POs, Suppliers, Sourcing) present in sidenav and tab bar, navigate correctly, no regression to the first two. Tab name "Sourcing" is now final, not a placeholder.
