# 🧩 Entitlements Documentation – As-Is Index

This directory contains **As-Is documentation** for the current SynchroFlow entitlements mechanism.

Entitlements are a **backend-granted access projection** consumed by the frontend to control:
- Routes
- Navigation
- Widgets

This README is an **index and orientation guide only**.
It does not define authority, contracts, or future behavior.

---

## 1. What Entitlements Are (As Implemented)

Entitlements describe **what a shop is allowed to access** at runtime.

They are represented as:

```ts
{
  shopId: number | null;
  modules: string[];
  flags: string[];
}
````

Entitlements:

* Are granted by the backend
* Are persisted in the database
* Are consumed declaratively by the frontend
* Do **not** represent billing, plans, or lifecycle state

---

## 2. Where Entitlements Come From

Backend:

* `shop_module_entitlements` table
* `EntitlementsService.getForUser(userId)`

Frontend:

* Fetched via `GET /api/v1/entitlements/me`
* Stored in `EntitlementsProvider`

Entitlements change only when backend data changes.

---

## 3. How Entitlements Are Used

Entitlements are consumed in **three places**:

### Routing

* Routes may declare `requiredModuleId` / `requiredFlagId`
* Enforcement via `ProtectedRoute`

### Navigation

* Navigation derives from filtered routes
* Hidden routes never appear in menus

### Widgets

* Widgets are filtered by `useWidgetRegistry`
* Gated by modules, flags, and frontend-only heuristics

Entitlements do **not** perform gating themselves.
They are **inputs** to frontend logic.

---

## 4. FT0 Default Entitlements (As-Is)

On first successful integration, the backend grants a small default set of entitlements.

These entitlements:

* Allow access to the core application shell
* Enable basic operational UI
* Do not imply readiness, success, or payment

Details are documented in:

* `ft0-entitlements.md`

---

## 5. What Entitlements Do NOT Do

Entitlements do **not**:

* Define lifecycle phases
* Prove payment
* Represent plans or tiers
* Enforce usage limits
* Decide business outcomes

Any document implying otherwise is out of scope.

---

## 6. Documentation Map

| File                  | Purpose                       |
| --------------------- | ----------------------------- |
| `overview.md`         | As-Is architectural overview  |
| `backend.md`          | Backend persistence & APIs    |
| `frontend.md`         | Frontend consumption & gating |
| `widget-gating.md`    | Widget registry filtering     |
| `ft0-entitlements.md` | Default entitlement snapshot  |
| `onboarding.md`       | As-Is developer wiring guide  |
| `README.md`           | This index                    |

---

## 7. Status

The entitlements system is:

* Implemented
* Stable
* Deterministic
* Fully test-covered

It is intentionally **limited in authority**.

---

## 🔒 As-Is Documentation Seal

This directory documents **only scan-verified, implemented behavior**.

Any change requires:

1. Code scans
2. Explicit diffs
3. A documented amendment

Forward-looking intent is intentionally excluded.

---