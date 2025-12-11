---

module: ui-module-index
owner: frontend-platform
reviewers:

* product
* backend
  status: draft
  version: 0.1.0

---

# UI Module Index — LaSyncro

**Purpose:**
A concise, single-page index of all frontend UI modules for LaSyncro. This document maps each UI module to its primary screens, route(s), entitlements (if any), owners, high-level responsibilities, and link to the per-module UI blueprint (stub).

**Scope:**
This is a frontend-only document. It contains no backend implementation details — only the consumer expectations (routes, screens, entitlement keys) and links to backend contract documents. All backend references must be cited in the module's blueprint.

---

## How to use this file

* This file is the canonical inventory for frontend work. Before opening a UI PR for a module, update the module entry to mark progress and link the module blueprint file.
* Each module blueprint must follow the `docs/ui/04-Module-UI-Blueprints` template and include the YAML frontmatter shown here.

---

## Module entries

> NOTE: entries below are derived from the frontend scans (routes, pages, modules). Keep this file minimal — the per-module blueprints will contain detailed UI contracts.

### Dashboard

* **Route(s):** `/dashboard`
* **Primary screens:** Dashboard landing, customizable widget grid, onboarding skeleton
* **Entitlement:** none (core experience)
* **Owner:** frontend-platform (assign specific team/person)
* **Short description:** The primary landing surface that aggregates widgets, proactive insights, and quick actions.
* **Blueprint path:** `docs/ui/04-Module-UI-Blueprints/dashboard-ui.md` (stub)

### Analytics

* **Route(s):** `/analytics`
* **Primary screens:** Analytics overview, cohort explorer, report builder
* **Entitlement:** `analytics` (frontend enforces via `routes.tsx` requiredModuleId)
* **Owner:** analytics-team
* **Short description:** Secondary module for cross-platform analytics — gated behind analytics entitlement.
* **Blueprint path:** `docs/ui/04-Module-UI-Blueprints/analytics-ui.md`

### Finances

* **Route(s):** `/finances`
* **Primary screens:** Cash flow, P&L overview, invoices
* **Entitlement:** `finances`
* **Owner:** finance-product
* **Short description:** Financial dashboards and tools; requires entitlement gating and secure data handling.
* **Blueprint path:** `docs/ui/04-Module-UI-Blueprints/finances-ui.md`

### Orders / Order Details

* **Route(s):** `/orders`, `/orders/:id`
* **Primary screens:** Orders list, order timeline, order detail (Order360)
* **Entitlement:** core (no module gating shown in routes)
* **Owner:** order-nexus frontend
* **Short description:** Operational order management with deep order detail and action recommendations.
* **Blueprint path:** `docs/ui/04-Module-UI-Blueprints/order-nexus-ui.md`

### Products / Product Details

* **Route(s):** `/products`, `/products/:id`
* **Primary screens:** SKU list, product 360
* **Entitlement:** core
* **Owner:** sku-os frontend
* **Short description:** Product catalog management, variants, and product intelligence hooks.
* **Blueprint path:** `docs/ui/04-Module-UI-Blueprints/sku-os-ui.md`

### Customers / Customer Details

* **Route(s):** `/customers`, `/customers/:id`
* **Primary screens:** Customer list, Customer360, RFM insights
* **Entitlement:** core
* **Owner:** specter / customer-intel frontend
* **Short description:** Customer profiles, segmentation, and actionable insights.
* **Blueprint path:** `docs/ui/04-Module-UI-Blueprints/customers-ui.md`

### Echo Hub (Inbox)

* **Route(s):** `/echo-hub`
* **Primary screens:** Messages, action center, integrations
* **Entitlement:** optional (can be gated later; route file notes)
* **Owner:** comms/echo-team
* **Short description:** In-app messaging and action center for platform notifications and user communication.
* **Blueprint path:** `docs/ui/04-Module-UI-Blueprints/echo-hub-ui.md`

### Account Settings

* **Route(s):** `/account/settings`
* **Primary screens:** Profile, integrations, Specter config tab (exists in code)
* **Entitlement:** none
* **Owner:** platform-settings
* **Short description:** User, account, and module configuration panels. Includes Specter config panel and other module settings.
* **Blueprint path:** `docs/ui/04-Module-UI-Blueprints/account-settings-ui.md`

### Authentication (Login / Register)

* **Route(s):** `/login`, `/register`
* **Primary screens:** Login, registration, password reset
* **Entitlement:** public
* **Owner:** auth
* **Short description:** Authentication flows used across LaSyncro multi-app linking.
* **Blueprint path:** `docs/ui/04-Module-UI-Blueprints/auth-ui.md`

---

## Cross-cutting UI modules (shared components / infra)

These are not product modules but shared areas the UI depends on and must be treated as first-class citizens.

* **Theme & Design System** — owner: design-system. Path: `docs/ui/03-Theme-and-Design-Tokens.md`.
* **Component Library** — owner: frontend-ui. Path: `docs/ui/02-Component-Library-Contract.md`.
* **Entitlements (frontend enforcement)** — owner: frontend-platform. Path: `docs/ui/05-Entitlements-Frontend-Contract.md`.
* **Onboarding (FT0)** — owner: growth/product. Path: `docs/ui/06-Onboarding-FT0-UX-Spec.md`.
* **Ops Console / Insights (Kore / Specter)** — owner: ops/insights. Path: `docs/ui/04-Module-UI-Blueprints/insights-ui.md`.

---

## Missing blueprints / next actions

1. Create the per-module blueprint stubs listed above (place under `docs/ui/04-Module-UI-Blueprints/`).
2. For each blueprint we must include the `Referenced backend contracts` section and link to docs in `docs/blueprints-and-contracts/` (you will run scans and paste the exact filenames). Example: `order-nexus-contract.md`, `specter-contract.md`.
3. Assign explicit OWNER and REVIEWER for each module.

---

## Acceptance checklist for this index

* [ ] Every module entry has an OWNER and a linked blueprint file.
* [ ] Blueprint stubs created for the list above.
* [ ] Each blueprint references backend contract doc(s) (exact filenames).
* [ ] UI owners confirm the module list and update any missing route or screen.

---

## Revision log

* v0.1.0 — created (derived from frontend `routes.tsx`, `pages` list, and `modules/` scan).
