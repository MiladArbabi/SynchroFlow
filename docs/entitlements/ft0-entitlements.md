# 🆓 FT0 Default Entitlements – As-Is Snapshot

This document describes the **default entitlements granted at FT0**, exactly as implemented today.

It is a **descriptive snapshot**, not a tier definition, contract, or capability guarantee.

## Scope (As-Is Only)

This document covers:

- Which entitlements are granted by default at FT0
- How those entitlements affect frontend access (routes, widgets, navigation)
- How additional entitlements expand access

This document explicitly does **not** define:

- Lifecycle phases or readiness
- Billing, plans, or payment proof
- Upgrade systems or commercial policy
- Usage limits or quotas
- Future modules or features

---

## 1. What FT0 Means in Practice

**FT0** refers to the point at which a shop has:

- Successfully connected an integration (e.g. Shopify)
- Received the **default entitlement grant** from the backend

FT0 is **not** a billing tier and **not** a lifecycle authority.  
It is simply the first moment at which entitlements exist for a shop.

---

## 2. Default FT0 Entitlement Grant (Backend)

Upon initial Shopify installation or first-time shop creation, the backend grants a small, explicit set of entitlements.

### Granted Entitlements (Exact `module_key` Values)



core_dashboard
shopify_integration
specter_sdk_free
order-nexus



These rows are inserted into:



shop_module_entitlements

`

using `EntitlementsService.grantDefaultFreeTierForShop(shopId)`.

### Flags

No flags are granted by default at FT0.

---

## 3. What These Entitlements Enable (Access Projection)

The presence of the FT0 entitlement bundle allows the frontend to:

- Render the core dashboard shell
- Display operational surfaces backed by `order-nexus`
- Run ingestion and synchronization flows via `shopify_integration`
- Render widgets and UI that do **not** declare restricted module or flag requirements

Entitlements do **not** guarantee:

- Data completeness
- Readiness
- Analytics correctness
- Business insight quality

Those concerns are handled elsewhere in the system.

---

## 4. Route Access Under Default Entitlements

Route visibility is determined by **frontend gating logic** using entitlements.

Under the default FT0 entitlement set:

- Routes that do **not** declare `requiredModuleId` are visible
- Routes that declare a missing `requiredModuleId` are hidden
- Deep-link attempts to gated routes are redirected by `ProtectedRoute`

This behavior is **reactive**, not declarative.  
The list of visible routes is an outcome of gating logic, not a contract.

---

## 5. Widget Rendering Under Default Entitlements

Widgets render if they:

- Do **not** declare a required module or flag
- Are not filtered out by frontend-only heuristics

### Important Clarification

⚠️ `requiresPaidPlan` is a **frontend-only UX heuristic**.  
It is **not backed by billing, entitlements, or lifecycle truth**.

Widgets filtered by `requiresPaidPlan` are hidden purely by frontend logic and must not be interpreted as paid or premium enforcement.

---

## 6. Observed User Experience Under Default Entitlements

This section is **descriptive only**.

User experience at FT0 is influenced by:

- Integration state
- Sync progress
- Lifecycle readiness
- Entitlements (access projection)

Entitlements alone do **not** explain:

- Empty states
- Loading behavior
- Checklists
- Readiness indicators

Those behaviors are governed by other systems.

---

## 7. Adding Additional Module Entitlements

Expanding access is done by **adding new entitlement rows**.

Example:

sql
INSERT INTO shop_module_entitlements (shop_id, module_key, flag_key)
VALUES (123, 'analytics', NULL);
`

Once present:

* `/api/v1/entitlements/me` includes the new `module_key`
* Frontend routing, navigation, and widgets react automatically
* No code changes are required

This operation does **not** imply billing, payment, or plan validation.

---

## 8. Tests Covering FT0 Entitlements

Current tests validate:

* Default entitlement grants on install
* Entitlement loading and normalization
* Route, navigation, and widget gating behavior

These tests ensure deterministic behavior of **access projection**, not business outcomes.

---

## 9. Summary

* FT0 is the moment when **default entitlements exist**
* Entitlements are **access projections**, not capabilities or tiers
* The FT0 entitlement bundle is intentionally small and explicit
* Additional access is granted only by adding entitlements
* Lifecycle, billing, and readiness remain separate concerns

---

## 🔒 As-Is Snapshot Seal

This document reflects **scan-verified, implemented behavior only**.

Any change requires:

1. Code scans
2. Explicit diffs
3. A documented amendment

Forward-looking intent is intentionally excluded.

---