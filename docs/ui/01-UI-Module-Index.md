---
module: ui-module-index
owner: frontend-platform
reviewers:
  - product
  - backend
status: active
version: 1.0.0
---

# UI Module Index — LaSyncro

## Purpose

This document is the **authoritative inventory** of all UI modules in LaSyncro.

It lists:

- Exposed user-facing routes
- Owning module
- High-level screens
- Entitlement requirements (if any)
- Links to the module UI blueprint

It is **descriptive, not prescriptive**.  
All behavioral rules are defined in the routing, host API, and lifecycle contracts.

---

## Scope

Frontend only.

This document:

- Does **not** describe routing mechanics
- Does **not** describe rendering
- Does **not** describe entitlement enforcement logic

Those are covered by:

- `05-UI-Routing-Contract.md`
- `08-UI-Host-API-Contract.md`
- `09-UI-Module-Lifecycle-Contract.md`

---

## How to use this file

- Treat this as the **single source of truth for “what UI modules exist”**
- Every new module must be added here
- Every route listed here **must** exist in runtime registration
- Detailed behavior lives in the per-module blueprint

---

## UI Modules

> Routes listed here are **public entry points**.  
> Actual rendering occurs via `ModuleHost`.

---

### Dashboard

- **Module:** core-dashboard
- **Route(s):** `/dashboard`
- **Primary screens:** Dashboard landing, widget grid, onboarding skeleton
- **Entitlement:** none (always available)
- **Owner:** frontend-platform
- **Blueprint:** `docs/ui/04-Module-UI-Blueprints/dashboard-ui.md`

---

### Analytics

- **Module:** analytics
- **Route(s):** `/analytics`
- **Primary screens:** Overview, cohort explorer, reports
- **Entitlement:** `analytics` module
- **Owner:** analytics-team
- **Blueprint:** `docs/ui/04-Module-UI-Blueprints/analytics-ui.md`

---

### Finances

- **Module:** finances
- **Route(s):** `/finances`
- **Primary screens:** Cash flow, P&L, invoices
- **Entitlement:** `finances` module
- **Owner:** finance-product
- **Blueprint:** `docs/ui/04-Module-UI-Blueprints/finances-ui.md`

---

### Orders (Order Nexus)

- **Module:** order-nexus
- **Route(s):** `/orders`, `/orders/:id`
- **Primary screens:** Orders list, order timeline, Order360
- **Entitlement:** `order-nexus` module
- **Owner:** order-nexus team
- **Blueprint:** `docs/ui/04-Module-UI-Blueprints/order-nexus-ui.md`

---

### Products (SKU-OS)

- **Module:** sku-os
- **Route(s):** `/products`, `/products/:id`
- **Primary screens:** SKU list, product details
- **Entitlement:** sku-os (if gated)
- **Owner:** sku-os team
- **Blueprint:** `docs/ui/04-Module-UI-Blueprints/sku-os-ui.md`

---

### Customers (Specter)

- **Module:** specter
- **Route(s):** `/customers`, `/customers/:id`
- **Primary screens:** Customer list, Customer360, insights
- **Entitlement:** specter (if gated)
- **Owner:** customer-intel team
- **Blueprint:** `docs/ui/04-Module-UI-Blueprints/customers-ui.md`

---

### Echo Hub

- **Module:** echo-hub
- **Route(s):** `/echo-hub`
- **Primary screens:** Inbox, action center, integrations
- **Entitlement:** none (currently ungated)
- **Owner:** comms team
- **Blueprint:** `docs/ui/04-Module-UI-Blueprints/echo-hub-ui.md`

---

### Account Settings

- **Module:** account-settings
- **Route(s):** `/account/settings`
- **Primary screens:** Profile, integrations, configuration panels
- **Entitlement:** none
- **Owner:** platform-settings
- **Blueprint:** `docs/ui/04-Module-UI-Blueprints/account-settings-ui.md`

---

### Authentication

- **Module:** auth
- **Route(s):** `/login`, `/register`
- **Primary screens:** Login, registration, recovery
- **Entitlement:** public
- **Owner:** auth team
- **Blueprint:** `docs/ui/04-Module-UI-Blueprints/auth-ui.md`

---

## Cross-cutting UI Infrastructure (Non-modules)

These are **not modules** but shared platform systems.

- **Component Library**  
  `docs/ui/02-Component-Library-Contract.md`

- **Design Tokens & Theme**  
  `docs/ui/03-Design-Tokens-Contract.md`

- **Routing & Entitlements**  
  `docs/ui/05-UI-Routing-Contract.md`

- **Host API**  
  `docs/ui/08-UI-Host-API-Contract.md`

---

## Acceptance criteria

- [ ] Every route listed here exists at runtime
- [ ] Every module has a blueprint
- [ ] Entitlement names match backend payloads exactly
- [ ] No references to removed or imaginary documents

---

## Revision log

- v1.0.0 — aligned with runtime module architecture, ModuleHost rendering model, and normative host API
