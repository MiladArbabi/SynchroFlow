# FT0 Onboarding — Reality-Based Specification (v1.0)

## 📌 Purpose

This document defines the **exact onboarding experience** that Lasyncro will ship for the Free Tier (FT0).  
It is grounded in the *current production-ready capabilities* of the platform, not future plans.

This is the **single source of truth** for onboarding behavior.

---

# 1. Entry Paths into Lasyncro

## 1.1 Shopify App Install (Primary Path)

User installs via Shopify → OAuth → redirected automatically to:

```
/dashboard?connect=success
```

### Required backend behavior

- Auto-create user (email from Shopify)
- Auto-create / resolve shop
- Store Shopify access token (encrypted)
- Grant FT0 entitlements:
  - core_dashboard
  - shopify_integration
  - specter_sdk_free
- Queue initial sync (already implemented)
- Redirect immediately to `/dashboard`

### Required frontend behavior

No signup screens. No partner-shopify page.

Dashboard onboarding begins immediately (see Section 2).

---

## 1.2 Web Signup (Secondary Path)

User signs up directly at app.lasyncro.com using email/password.

### Required backend behavior

- Assign FT0 entitlements
- Redirect to `/dashboard`

### Required frontend behavior

Dashboard loads → no integration exists → show:

```
<ConnectStoreBanner />
```

---

# 2. Dashboard as the Onboarding System

The dashboard *is* the onboarding.  
There are **no separate onboarding pages**.

The onboarding state machine is driven by the Shopify integration record:

- `sync_status`:  
  - `PENDING`  
  - `SYNCING_PRODUCTS`  
  - `SYNCING_ORDERS`  
  - `SYNCING_LINE_ITEMS`  
  - `SYNCING_INVENTORY`  
  - `SYNCING_SHOP`  
  - `COMPLETING`  
  - `COMPLETED`  
  - `COMPLETED_PARTIAL`  
  - `FAILED`
- `sync_progress_{current,total}`
- `sync_last_error`

The frontend derives three high-level dashboard states from this.

---

## 2.1 State A — No Integrations

```
if (!hasIntegrations)
  <ConnectStoreBanner />
```

This is the web-signup user's first screen.

- No widgets with real data.
- No skeletons rendered for FT0 widgets.
- Primary CTA: “Connect your Shopify store”.

---

2.2 State B — Sync In Progress

Triggered after Shopify OAuth completes and before we hit a terminal state.

“Sync in progress” means:

hasIntegrations === true &&
sync_status in [
  "PENDING",
  "SYNCING_PRODUCTS",
  "SYNCING_ORDERS",
  "SYNCING_LINE_ITEMS",
  "SYNCING_INVENTORY",
  "SYNCING_SHOP",
  "COMPLETING",
  "COMPLETED_PARTIAL" // partial but still treated as “syncing” in v1
]

Required frontend behavior:

<DataSyncingModal />
<SkeletonWidgets /> // FT0 dashboard skeletons only

Notes:

The user can still move around the UI.

No real widget data is shown yet for FT0.

COMPLETED_PARTIAL is treated as “still in onboarding” for v1, until we finalize the UX for partial data.

The modal closes when isFirstTimeSync === false, which currently maps to:

hasIntegrations && sync_status === "COMPLETED"

2.3 State C — Sync Complete (Full Data)

Triggered when /sync-status returns:

status === "COMPLETED"

Dashboard must render:

<OrdersPerMonthBanner />        // Only if segmentation not set
<SpecterOnboardingBanner />     // Only if entitlements allow & enabled
<WidgetLayoutWithRegistry />    // Real widgets

This is the only state where FT0 widgets render with live data.

2.4 State C' — Sync Complete (Partial Data, PCD Fallback)

If Shopify denies access to Protected Customer Data (orders/customers), the worker falls back to a non-PCD sync and marks:

status === "COMPLETED_PARTIAL"
sync_last_error === "PCD access required for orders and customers"

v1 behavior (current reality):

Code treats COMPLETED_PARTIAL as “in progress” for layout gating.

Dashboard uses skeletons + sync banner instead of fully “complete” state.

Widgets that depend only on products / inventory / shop may still have usable data, but we do not yet treat this as “onboarding finished”.

This is a deliberate v1 compromise.
A future FT0+ spec may:

Promote COMPLETED_PARTIAL to a proper “sync complete (limited data)” state.

Adjust widget registry expectations accordingly.

---

# 3. Micro-Step #1 — Orders Per Month Banner

### Purpose  

Segmentation → improves insights, analytics defaults, and experience scoring.

### Required behavior

Show **only once** if userState.orders_per_month_segment is NULL.

Selection options:

- 1–50  
- 51–200  
- 201–500  
- 501–1000  
- 1000+

### API

```
PATCH /api/v1/user-state/state
{
  "orders_per_month_segment": "51-200"
}
```

On success → hide permanently.

---

# 4. Micro-Step #2 — Email Verification Banner (Optional FT1)

Not required for FT0.  
If implemented, must be:

- Non-blocking  
- Dismissible  
- Trigger resend email endpoint  
- Not prevent dashboard usage  

---

# 5. FT0 Widgets (Only Those That Exist Today)

Required widgets for FT0 (already implemented):

- **DashboardPulse**
- **Inventory Health**
- **Top Products**
- **Sales by Traffic Source**

Widgets **must** show safe, empty, or loading states—never throw errors.

No advanced insight widgets appear in FT0.

---

# 6. Specter Banner Behavior

Specter onboarding banner appears only when:

- `specter_sdk_free` entitlement is present
- `enableOnboardingNudges === true`
- Sync is complete

### Configure → Always open Account Settings → Specter tab  

### Dismiss → Save

```
{ enableOnboardingNudges: false }
```

and hide permanently.

---

# 7. Gated Navigation (FT0 Behavior)

Navigation visibility and route access are controlled by entitlements:

- FT0 modules (see `ft0-entitlements.md`):
  - "core-dashboard"
  - "core-orders"
  - "core-products"
  - "core-customers"
- Premium modules (not granted in FT0):
  - "analytics"
  - "finances"
  - "advanced-analytics"
  - "sku-os"
  - "echo-hub" (future)

## 7.1 Sidebar Behavior

The sidebar must **always show** routes that the user’s entitlements allow:

- `/dashboard`
- `/orders`
- `/products`
- `/customers`
- `/echo-hub` (basic)

Routes that require locked modules (e.g., `/analytics`, `/finances`) are **not shown** in the FT0 sidenav.

## 7.2 Route Protection

If a user manually navigates to a locked route (e.g., typing `/finances`):

- `ProtectedRoute` detects missing entitlements.
- **Behavior in v1 FT0:**
  - Redirect user back to `/dashboard`.
  - No premium page is rendered.
  - No “upgrade page” is shown yet.

Backend APIs for premium features must still enforce:

```json
403 { "error": "NOT_ENTITLED", "requiredModule": "<module-id>" }
but most FT0 users will be blocked client-side by ProtectedRoute.

7.3 Deferred Upgrade UX
Any rich “LockedFeaturePage” or contextual upgrade CTA is deferred to FT1+.

FT0 reality:

No dedicated upgrade page.

No complex upsell flows.

Safety first: FT0 users should never see broken or half-implemented premium pages.

---

# 8. Email Sequence (Minimal FT0 Version)

### Email 1 — Welcome (Triggered after integration created)

- Subject: “Welcome to Lasyncro — Your data is now syncing”
- Contains:
  - What’s happening
  - Estimated sync completion time
  - Link to `/dashboard`

### Email 2 — Sync Complete (Triggered by worker)

- Subject: “Your Lasyncro dashboard is ready”
- Contains:
  - Confirmation of sync completion
  - CTA to visit dashboard
  - One simple next step (Orders-per-month banner)

No onboarding manager persona. No complex sequences.

---

# 9. Backend Implementation Contract (FT0 Must-Haves)

### OAuth callback

- Auto-create user from Shopify
- Store token
- Grant FT0 entitlements
- Queue sync
- Redirect → `/dashboard?connect=success`

### Sync worker

- Must send real-time status
- Must update integration table reliably

### User-state service

- Must store segmentation value

### No new database tables for onboarding

---

# 10. FT0 Acceptance Criteria (Reality)

FT0 onboarding is considered **DELIVERED** when:

1. Shopify install → Dashboard in \<5 seconds.
2. Sync begins automatically and is visible via `DataSyncingModal` and/or `SyncProgressBanner`.
3. `sync_status` transitions through the expected states and is persisted in `integrations`.
4. `COMPLETED` state:
   - Closes the syncing modal.
   - Renders FT0 widgets with real Shopify data.
5. OrdersPerMonthBanner completes segmentation when `orders_per_month_segment` is null.
6. Specter banner appears only when:
   - `specter_sdk_free` entitlement is present
   - onboarding nudges are enabled
   - sync is fully complete (`COMPLETED`).
7. Premium routes (`/analytics`, `/finances`) are:
   - Hidden from FT0 sidenav
   - Redirected back to `/dashboard` if accessed directly.
8. Widgets never throw; they show loading / empty / error-safe states instead.

**Explicit non-goals for FT0 v1:**

- No dedicated upgrade page for locked routes.
- No multi-step onboarding SPA.
- No guaranteed email sequence (welcome + sync-complete) until implemented and tested.

---

# 11. Deferred to FT1+

Items not in FT0 but planned for later:

- Business profile setup  
- Notification preferences  
- Multi-platform onboarding  
- Goal-setting wizard  
- Shipping & logistics onboarding  
- Predictive analytics & cash flow  
- Full Specter performance dashboard  
- Multi-step onboarding SPA  

These features **must never be referenced** by FT0 UI.

---
