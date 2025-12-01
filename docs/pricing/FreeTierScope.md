# 🆓 Free Tier Scope – LaSyncro / ACI Platform

**Plan ID:** `free`  
**Version:** v1.0  
**Last Updated:** 2025-12-01  

## 1. Purpose of This Document

This document defines the **exact scope** of the Free Tier:

- What data we ingest
- What features we expose in the UI
- Hard limits (history, usage, depth)
- What is explicitly **not** included and reserved for paid plans

This is the reference for:

- Product decisions
- Backend/entitlement enforcement
- Frontend feature-gating and UX
- Shopify listing / marketing copy (at a high level)

If something is **not** listed here as “Included”, treat it as **out of scope for Free Tier v1**.

---

## 2. Free Tier Positioning

**Goal:**  
Provide a **simple, trustworthy operations dashboard** that gives a Shopify merchant immediate value within minutes of connecting, without overwhelming them or giving away paid intelligence for free.

**Free tier is:**

- A **single-store, basic analytics + sync layer** for Shopify
- Focused on **recent performance** and **operational visibility**
- A low-friction entry into the LaSyncro / ACI ecosystem

**Free tier is NOT:**

- Profitability intelligence  
- Deep customer journey / Specter intelligence  
- Discount optimization  
- Full warehouse / operations control  
- Multi-platform / multi-store control center  

Those belong to paid modules (Orders Intelligence, Products Intelligence, Customers/Specter, Financial Intelligence, WMS Lite, etc.).

---

## 3. Eligibility & Tenant Model

### 3.1 Who can use the Free Tier?

- One Shopify store per LaSyncro account on the free plan
- Only merchants installing via:
  - Shopify App Store (embedded app), or  
  - Direct signup at `app.lasyncro.com` **linked** to a Shopify store

### 3.2 Technical Tenant Constraints

- **Store limit:** `1` active Shopify shop per `plan_id = 'free'`
- **User limit (initial):** up to `3` users per shop on free  
  (enough for owner + 1–2 staff; not enough for “enterprise usage”)

These limits must be enforced in the entitlements layer and respected by the UI (no “add more” UI without upgrade path).

---

## 4. Data Scope

### 4.1 Platforms

**Included in Free Tier v1:**

- ✅ **Shopify** (single store)

**Not included (Phase 2+):**

- ❌ Other e-commerce platforms (WooCommerce, Amazon, etc.)
- ❌ Accounting (QuickBooks, Xero, etc.)
- ❌ Payments (Stripe, PayPal, etc.)
- ❌ Marketing (GA4, Meta Ads, Klaviyo, etc.)

Free tier = **Shopify-only** data pipeline.

---

### 4.2 Data Types and Depth

#### 4.2.1 Orders

**Included:**

- Basic order header data:
  - `id`, `shopify_order_id`
  - `created_at`, `updated_at`, `closed_at`
  - `financial_status`, `fulfillment_status`
  - `total_price`, `subtotal_price`, `total_discounts`, `total_tax`
  - `currency`
- Lightweight customer reference:
  - `customer_id` (FK)
  - `customer_email` and/or `customer_name` (denormalized for UI convenience)
- Minimal line-item aggregation (optional):
  - `line_item_count` (number of line items per order)
  - Not full line item details in free UI; those are primarily for paid modules.

**Limits:**

- **Historical window:**  
  - Initial import: **last 90 days** of orders  
  - Ongoing sync: all new orders going forward
- **Retention:**  
  - For now, keep full 90-day rolling window available in UI.  
  - >90-day historical analytics reserved for paid plans.

**Excluded (reserved for paid modules):**

- Cost of goods (COGS), profit, true margin calculations  
- Advanced fulfillment timelines and SLA tracking  
- Returns/claims analytics  
- Detailed order attribution / multi-touch data  

---

#### 4.2.2 Products

**Included:**

- Basic product data sufficient for free-tier widgets:
  - `id`, `title`, `status`
  - `product_type`, `vendor`
  - Basic price (e.g., `variants[0].price` or canonical price field)
  - `created_at`
- Aggregate usage:
  - Number of orders per product (last 30/90 days)
  - “Top products” by revenue/orders (within free-tier window)

**Limits:**

- No advanced inventory health metrics (days of cover, stockouts, etc.)
- No cost data or margin by product
- No multi-location inventory breakdown

All deeper inventory/health/margin intelligence belongs to **Products Intelligence Module (paid)**.

---

#### 4.2.3 Customers

**Included:**

- Basic identity:
  - `id`, `first_name`, `last_name`
  - `email` (when present)
  - `created_at`
- Aggregate stats per customer **for internal use**, not heavy UI:
  - `orders_count` (number of orders)
  - `total_spent` (Shopify field)
- Aggregate metrics used in dashboard:
  - New customers vs. returning (count, no deep segmentation)

**Limits:**

- No advanced RFM scoring
- No LTV modeling beyond `total_spent`
- No Specter intent/journey overlays in the free dashboard

Those appear in the **Customers/Specter paid module**.

---

#### 4.2.4 Financials & Costs

**Included:**

- Shopify’s own financial figures:
  - `total_price`, `total_tax`, `total_discounts`
- Basic derived metrics:
  - Revenue (gross)
  - Average order value (AOV)
  - Discount rate (% of revenue discounted)

**Explicitly NOT included in Free Tier:**

- External payment fees (Stripe, PayPal, etc.)
- Accounting data (QuickBooks, Xero)
- Overhead allocations
- True margin or profit calculations

All of that is **Financial Intelligence module (paid)**.

---

#### 4.2.5 Behavioral / Specter Data

For v1 Free Tier, **no Specter SDK UI module** is exposed.

You may choose to:

- **Either**: keep Specter SDK fully disabled on free tier  
- **Or**: use extremely limited tracking only for **aggregate anonymous metrics** (e.g., “sessions” or “active visitors”) without any per-session insights and without discount/nudge capabilities.

But the **Customers/Specter conversion intelligence UI** is a **paid module**.  
No advanced behavior analytics, no nudges, no discount logic in free tier.

---

## 5. Free Tier Feature Matrix

This is the **user-visible surface**. Anything not listed here is not part of free v1.

### 5.1 Onboarding & Connection

**Included:**

- Shopify app installation flow (embedded)
- Redirect to app.lasyncro.com (if needed) with secure auth
- First-time sync kickoff (Shopify orders/products/customers – within defined window)
- Simple setup checklist:
  - “Shop connected”
  - “Initial sync in progress / complete”

---

### 5.2 Dashboard & Widgets

**Dashboard route:** `/dashboard` (or equivalent main home)

**Widgets included in v1 Free Tier:**

1. **Sync Status / Connection Health**
   - Shows:
     - Connected store name
     - Last sync time
     - Sync status: `OK / In progress / Error`
   - If error: short description + link to troubleshooting/setup.

2. **Recent Performance Summary**
   - Time window (configurable, but default **last 7 days**; with toggle: 7 / 30 / 90)
   - Metrics:
     - Total revenue
     - Total orders
     - Average order value (AOV)
     - New vs returning customer count

3. **Recent Orders List**
   - Table with:
     - Order date
     - Order ID
     - Customer (name or email)
     - Total order value
     - Financial/fulfillment status
   - Pagination or infinite scroll, but scoped to recent period.

4. **Top Products (Basic)**
   - List/chart:
     - Top 5–10 products by revenue or order count over selected period
   - Columns:
     - Product name
     - Orders count
     - Revenue

**Optional (nice-to-have if time allows):**

**5.Basic Trends:**

- Simple line chart with:
  - Orders per day (last 30 days)
  - Revenue per day (last 30 days)

No advanced filters, segmentation, or comparison charts in free tier.

---

### 5.3 Settings & Account

**Included:**

- Basic settings screen:
  - View connected shop name & connection status
  - Manual “Resync data” button (if supported)
  - Plan label: `Free Tier`
- User account:
  - Change email/password (if not fully Shopify SSO)
  - Logout

**Not included:**

- Complex role management / RBAC
- Multi-store configuration
- Webhook configuration UI
- Billing configuration (for now – only upgrade hooks/links)

---

### 5.4 Entitlements / Plan Gating

Free Tier must be backed by a **minimal entitlement set** in line with `EntitlementsEngineContract`.

Proposed starter Entitlements for `plan_id = 'free'`:

```ts
plan_id = 'free'

entitlements = [
  // Platforms
  'platform.shopify.read',

  // Data domains
  'data.orders.read.basic',
  'data.products.read.basic',
  'data.customers.read.basic',

  // Analytics
  'analytics.core.dashboard.view',
  'analytics.core.widgets.sync-status',
  'analytics.core.widgets.recent-performance',
  'analytics.core.widgets.recent-orders',
  'analytics.core.widgets.top-products',

  // Limits
  'limit.history.orders.90d',
  'limit.history.products.90d',
  'limit.history.customers.90d',
  'limit.shops.1',
  'limit.users.3',
]
````

All modules outside this list **must check entitlements** and:

- Return 403 / “plan not allowed” in API
- Render as locked/upsell in UI (no hidden 500s)

---

## 6. Out-of-Scope for Free Tier v1

To avoid scope creep, explicitly out:

- Customers/Specter dashboards and behavioral intelligence
- Discount engines, nudges, or cart recovery
- Financial Intelligence (profit, cash flow, overhead allocation)
- WMS Lite (warehouse, fulfillment workflows, pick/pack logic)
- Echo Hub (collaboration/tasking)
- Cross-platform adapters (GA4, Klaviyo, Stripe, etc.)
- Multi-store or multi-platform operations

These belong to **paid modules and higher bundles** (Essentials, Growth, Operations).

---

## 7. UX / Upgrade Hooks (Without Full Billing Yet)

Free tier still needs to hint at growth:

- On any locked feature (e.g., Specter tab, Margin tab, deep inventory), show:

  - A non-functional but clear “Upgrade to unlock” state
  - A CTA: “Talk to us” or “Join waitlist” for now
- Track clicks on upgrade CTAs to learn demand before full billing implementation.

But: **no fake buttons**. Do not show features that don’t exist at all.

---

## 8. Alignment with Existing Documentation

This Free Tier Scope must be kept aligned with:

- `docs/auth-permissions-contract/Auth-and-PermissionsContract.md`

  - Auth flows and permission checks
- `docs/entitlements-engine-contract/EntitlementsEngineContract.md`

  - Entitlement structure and enforcement patterns
- `docs/eventing-backbone-contract/EventBackboneContract.md`

  - Which events are actually emitted in free tier
- `docs/data-persistence-and-state-management/Data-Persistence-and-State-Management-Guide.md`

  - How free-tier data is stored, cached, and persisted
- `docs/pricing/v1/PricingTiers.md`

  - Plan naming and future upgrade paths
- `docs/shopify-packaging/ShopifyPackaging.md`

  - App listing promises vs. actual behavior

If any of those contracts conflict with this scope, **this document should drive Free Tier v1**, and the other docs must be updated to reflect reality.

---

## 9. Success Criteria for Free Tier v1 Launch

Free tier is considered **ready to launch** when:

1. A merchant can:

   - Install via Shopify
   - Land in the app
   - See their last 7–90 days of orders, revenue, and top products
   - Understand whether sync is working
   - Navigate without hitting broken / placeholder modules

2. There are **no 500s / crash paths** for:

   - Dashboard
   - Settings
   - Sync flows

3. Every visible feature is either:

   - Working and backed by real data **or**
   - Clearly marked as “Upgrade to unlock” and not clickable into a dead end.

4. Production deployment paths for:

   - `app.lasyncro.com`
   - Shopify embedded app
   - Background sync jobs

   are **documented and repeatable** (see `deployment-and-ops/v1.0_overview.md`).
