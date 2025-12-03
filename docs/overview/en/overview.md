# 🧭 SynchroFlow – Platform Overview (Updated for Entitlements v2)

This document provides a high-level overview of the SynchroFlow platform: the architecture, core modules, data pipelines, and now the **entitlement model** powering free-tier and premium feature gating.

---

# 1. What SynchroFlow Is

SynchroFlow is an operational intelligence platform for Shopify merchants.
It unifies:

* Order ingestion & canonicalization
* Product ingestion & normalization
* Profitability computation
* Inventory & SKU intelligence
* Customer intelligence
* Analytics & dashboards
* Workflow automation

Every module works together through a consistent CNS (Commerce Neural System) architecture.

---

# 2. High-Level Architecture

```
                   Shopify / External Sources
                              │
                              ▼
                 ┌────────────────────────┐
                 │  Canonical Ingestion   │
                 │  (orders + products)   │
                 └───────────┬────────────┘
                             │
           ┌─────────────────┼──────────────────┐
           ▼                 ▼                  ▼
   OrderNexus           SKU-OS              Specter
   Profitability        Inventory Health    Customer Intelligence
   Engine               Engine              Engine

           └─────────────────┬──────────────────┘
                             │
                             ▼
                     InsightCore (Analytics)

                             │
                             ▼
                     SynchroFlow Frontend
                    (Dashboard + Widgets)
```

Modules communicate through standardized events, canonical models, and analytics feeds.

---

# 3. Canonical Layer (FT0-Ready)

SynchroFlow implements a **stable, test-covered canonical ingestion pipeline**:

* Canonical Orders
* Canonical Order Line Items
* Canonical Products
* Mapping rules (with nested paths, arrays, literals, strict required fields)
* Full workers + queues
* Idempotent ingestion

This allows you to build new modules without re-implementing ingestion.

---

# 4. Free-Tier Architecture

Free tier (FT0) includes:

* Shopify OAuth
* Canonical ingestion
* Dashboard
* Basic widgets
* Orders / Products / Customers pages
* Data syncing pipeline
* Entitlements foundation
* Basic analytics ingestion (InsightCore)
* No paid modules unlocked

---

# 5. Entitlements (NEW – v2)

Entitlements are **the capability system** for SynchroFlow.

Each shop can have:

* **modules: string[]**
* **flags: string[]**

Example:

```json
{
  "shopId": 123,
  "modules": ["analytics", "finances"],
  "flags": ["beta-top-products"]
}
```

Entitlements are returned from:

```
GET /api/v1/entitlements/me
```

They influence the entire product:

### 5.1 Route-level gating

Each route may declare:

```ts
requiredModuleId?: string;
requiredFlagId?: string;
```

If a shop does not have the required module/flag:

* The route is hidden in the Sidenav
* The user cannot navigate to it
* Attempting to deep-link redirects to `/dashboard`

### 5.2 Navigation gating (Sidenav)

`SidenavContent → MenuList` filters visible items based on allowed routes.

### 5.3 Widget gating

Each widget in the registry can declare:

```ts
requiredModuleId?: string;
requiredFlagId?: string;
requiresPaidPlan?: boolean;
```

Widgets not allowed for the shop are not rendered.

All gating flows through one model:

```
modules[] + flags[] → capability
```

---

# 6. Modules & Pages (FT0 vs Premium)

The following modules power premium features:

| Module ID            | Unlocks                             |
| -------------------- | ----------------------------------- |
| `analytics`          | Analytics dashboard + charts        |
| `finances`           | Finances page, deeper profitability |
| `advanced-analytics` | Premium widget bundle               |
| `echo-hub` (future)  | Advanced workflow automation        |

FT0 users only receive the default modules:

```
core-dashboard
core-orders
core-products
core-customers
```

Everything else is gated.

---

# 7. Frontend Architecture Overview

```
AuthProvider → EntitlementsProvider → IntegrationProvider → AppLayout
                             │
                             ▼
      ┌──────────────────────────────────────────────────┐
      │ Consumers of entitlement model:                  │
      │                                                  │
      │ • ProtectedRoute (route access gating)           │
      │ • SidenavContent/MenuList (nav item gating)      │
      │ • useWidgetRegistry (widget visibility)          │
      └──────────────────────────────────────────────────┘
```

Entitlements are fully reactive:

* When Shopify connect completes → entitlements reload
* When module grants change → entitlements reload
* UI updates instantly

---

# 8. What’s Included in FT0

**Pages**

* Dashboard
* Orders
* Order Details
* Products
* Product Details
* Customers
* Customer Details
* Echo Hub (optional, ungated for now)
* Account Settings

**Widgets**

* Cash Flow
* Inventory Alerts
* Order Metrics
* Top Products
* Sales By Traffic Source

**Not Included**

* Analytics
* Finances
* Advanced Analytics widget
* Any feature with a required module/flag

---

# 9. Summary

Entitlements now power the entire frontend in a unified, predictable way:

* Route access
* Menu visibility
* Widget visibility

The system is modular, tested, and aligned with backend module IDs.
You can now introduce new paid features simply by:

1. Adding a module to backend
2. Returning it via `/entitlements/me`
3. Adding `requiredModuleId` to routes/widgets
4. Frontend updates automatically

---
