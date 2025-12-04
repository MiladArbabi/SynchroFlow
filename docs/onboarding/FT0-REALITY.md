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

Three states exist:

---

## 2.1 State A — No Integrations

```
if (!hasIntegrations)
  <ConnectStoreBanner />
```

This is the web-signup user's first screen.

---

## 2.2 State B — Sync In Progress

Triggered after Shopify OAuth completes.

Frontend must show:

```
<DataSyncingModal />
<SkeletonWidgets />
```

User can still interact with the UI.  
The modal closes automatically when integration sync completes.

---

## 2.3 State C — Sync Complete

Triggered when `/sync-status` returns `"COMPLETED"`.

Dashboard must render:

```
<OrdersPerMonthBanner />        // Only if segmentation not set
<SpecterOnboardingBanner />     // Only if entitlements allow & enabled
<WidgetLayoutWithRegistry />    // Real widgets
```

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

# 7. Gated Navigation (Cross-Sell Behavior)

The sidebar must **always show**:

- Analytics
- Finances

Even if user lacks entitlements.

### When user clicks a locked route

Show:

```
<LockedFeaturePage />
```

NOT a redirect to `/dashboard`.

Backend must return:

```
403 { error: "NOT_ENTITLED", requiredModule: "finances" }
```

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

# 10. FT0 Acceptance Criteria

FT0 onboarding is considered **DELIVERED** when:

1. Shopify install → Dashboard in <5 seconds  
2. Sync begins automatically  
3. DataSyncingModal displays sync progress  
4. OrdersPerMonthBanner completes segmentation  
5. SpecterBanner behaves correctly  
6. Locked routes show upgrade modal, not redirect  
7. Widgets load real Shopify data  
8. No broken paths, no placeholder features exposed  

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
