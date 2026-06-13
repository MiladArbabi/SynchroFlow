# LaSyncro — PostHog Analytics Playbook

**Last updated:** June 2026  
**Status:** Live on both `www.lasyncro.com` and `app.lasyncro.com`  
**Owner:** Engineering / Growth  
**Location in repo:** `docs/playbooks/posthog_playbook.md`

---

## 1. Architecture Overview

LaSyncro runs a single PostHog project across two subdomains:

```
www.lasyncro.com   → PostHog snippet (vanilla JS, in <head>)
app.lasyncro.com   → PostHog npm package (posthog-js@^1.283.x, React)
```

Both point to the **same project key** and the **same API host** (`https://t.lasyncro.com`), enabling cross-subdomain identity stitching for the full `www → register → dashboard` funnel.

### Reverse proxy
All PostHog traffic is routed through `https://t.lasyncro.com` — a reverse proxy in front of `https://app.posthog.com`. This prevents ad blockers from blocking analytics and keeps event volume clean. The `ui_host` is still `https://app.posthog.com` so the PostHog dashboard works correctly.

### Project key
```
phc_kVdrQpoCzz5J7n9NzHW2gXHtwA6PC9gQJW294ajhpmrM
```
Stored as `VITE_PUBLIC_POSTHOG_KEY` in `apps/frontend/.env`. The landing page uses it inline in the snippet.

---

## 2. Cross-Domain Identity (Critical)

### The problem
Without cross-domain config, PostHog scopes its identity cookie to the specific subdomain. A user visiting `www.lasyncro.com` gets `distinct_id = anon_abc`. When they click "Start free" and land on `app.lasyncro.com`, PostHog assigns a new `distinct_id = anon_xyz`. The entire `www → register → signup` funnel is invisible — every signup looks like direct organic traffic.

### The fix — three options that must be identical on both sides

```js
cookie_domain: '.lasyncro.com',       // cookie readable by all subdomains
cross_subdomain_cookie: true,          // explicitly enables cross-subdomain sharing
persistence: 'localStorage+cookie',   // localStorage for SPA speed, cookie for cross-subdomain handoff
```

**INVARIANT:** These three options must be **identical** in both:
- `packages/landing-page/index.html` (PostHog snippet `posthog.init()`)
- `apps/frontend/src/main.tsx` (PostHog npm `posthog.init()`)

Any drift between the two breaks funnel attribution silently. Check both files if funnel attribution looks broken.

### TypeScript note
`cookie_domain` and `cross_subdomain_cookie` are valid PostHog v1 runtime options but are absent from the TypeScript type definitions in `posthog-js@1.373.4`. They are applied via a spread cast in `main.tsx`:

```tsx
...({
  cookie_domain: '.lasyncro.com',
  cross_subdomain_cookie: true,
  persistence: 'localStorage+cookie',
} as unknown as object),
```

Do not remove this — it is intentional and required.

---

## 3. Initialization

### Landing page (`www.lasyncro.com`)
Location: `packages/landing-page/index.html` — inline snippet in `<head>`.

```js
posthog.init('phc_kVdrQ...', {
  api_host: 'https://t.lasyncro.com',
  ui_host: 'https://app.posthog.com',
  autocapture: true,          // enabled on marketing page — broad click/form capture
  capture_pageview: true,     // enabled — single-page, one view per visit
  cookie_domain: '.lasyncro.com',
  cross_subdomain_cookie: true,
  persistence: 'localStorage+cookie',
});
```

Localhost guard: PostHog is disabled on `localhost` and `127.0.0.1` to prevent dev traffic pollution.

### App (`app.lasyncro.com`)
Location: `apps/frontend/src/main.tsx` — npm package, single source of truth.

```tsx
posthog.init(posthogKey, {
  api_host: posthogHost,      // https://t.lasyncro.com via VITE_PUBLIC_POSTHOG_HOST
  capture_pageview: false,    // disabled — SPA manages its own pageviews manually
  capture_exceptions: true,   // error tracking enabled
  autocapture: false,         // disabled — explicit events only, no noise
  cookie_domain: '.lasyncro.com',
  cross_subdomain_cookie: true,
  persistence: 'localStorage+cookie',
});
```

Key differences from landing page: `autocapture: false` (explicit events only), `capture_pageview: false` (React Router controls this).

### Environment variables (app)
```
VITE_PUBLIC_POSTHOG_KEY=phc_kVdrQ...        # in apps/frontend/.env
VITE_PUBLIC_POSTHOG_HOST=https://t.lasyncro.com  # in apps/frontend/.env
```

Both are build-time injected via Vite. They are not runtime secrets — the key is intentionally public.

---

## 4. Event Architecture

### Analytics layer
All events in the app flow through a single adapter — never call `posthog.capture()` directly in product code.

```
Product code
  → useUiEvents().emit(eventName, payload)   [apps/frontend/src/analytics/useUiEvents.ts]
  → sendEvent(event, payload)                [apps/frontend/src/analytics/adapter.ts]
  → posthog.capture(event, { ...payload, source: 'frontend_app', ts: Date.now() })
```

This architecture prevents vendor lock-in — swap PostHog for any other provider by editing `adapter.ts` only.

### Event naming convention
All events use dot-notation namespaced by domain:

```
auth.login.success
auth.login.failed
auth.signup.success
auth.signup.failed
integration.connect.started
integration.connect.redirected
integration.connect.failed
upgrade_prompt.shown
upgrade_prompt.clicked
```

Landing page events use underscore convention (vanilla JS, no adapter):
```
nav_login_clicked
nav_signup_clicked
hero_signup_clicked
section_signup_clicked
footer_signup_clicked
```

### Adding a new event
1. Add the event name to `UiEventName` union type in `useUiEvents.ts`
2. Call `emit('your.event.name', { prop: value })` in the component
3. Never call `posthog.capture()` directly — always go through `emit()`

---

## 5. Identity Model

### Unit of revenue = shop, not user
PostHog `identify()` is called with `user_id` at login/signup. Group analytics must be configured by `shop_id` — your MRR, churn, and conversion metrics are per-shop, not per-human.

```ts
// At login (in AuthLogin.tsx)
posthog.identify(user.id.toString(), {
  email: user.email,          // PII — only include if PostHog project has EU data residency or consent
  shop_id: user.shop_id,
});

// Group the session by shop
posthog.group('shop', shop_id.toString(), {
  name: shop.name,
  plan: shop.tier,
});
```

Note: `posthog.identify()` is currently called via the `auth.login.success` event. Full `identify()` + `group()` calls are a pending improvement (see Section 8).

### Distinct ID flow
```
www.lasyncro.com visit      → anon distinct_id set in .lasyncro.com cookie
Click "Start free"          → app.lasyncro.com reads same cookie → same distinct_id
auth.signup.success fires   → posthog.identify(user_id) → anon_id aliased to user_id
All future events           → attributed to user_id
```

This is the correct flow. If you see two separate anonymous users for one signup journey, the cross-domain cookie config has drifted.

---

## 6. UTM Attribution

All CTAs on `www.lasyncro.com` include UTM parameters:

| CTA location | `utm_source` | `utm_medium` | `utm_content` |
|---|---|---|---|
| Nav — Log in | `marketing_site` | `nav` | `login` |
| Nav — Start free | `marketing_site` | `nav` | `start_free` |
| Hero | `marketing_site` | `hero` | `start_free` |
| Waitlist section | `marketing_site` | `waitlist_section` | `start_free` / `login` |
| Footer CTA | `marketing_site` | `footer_cta` | `start_free` |

PostHog automatically captures UTM parameters from the URL on `app.lasyncro.com` and attaches them to all subsequent events in the session. No manual instrumentation needed for UTM capture — it is built into PostHog's pageview and session logic.

For this to work: `capture_pageview` must fire on the first load of `app.lasyncro.com`. Currently `capture_pageview: false` in `main.tsx` — a manual `posthog.capture('$pageview')` must be fired after React Router mounts. This is a pending improvement (see Section 8).

---

## 7. Key Funnels to Monitor

### Acquisition funnel
```
marketing_site visit
  → nav_signup_clicked / hero_signup_clicked / section_signup_clicked / footer_signup_clicked
  → app.lasyncro.com/register loaded
  → auth.signup.success
  → integration.connect.started
  → integration.connect.redirected (Shopify OAuth)
  → first_sync_completed (backend event)
  → overview first viewed
```

### Trial conversion funnel
```
trial_started (day 0)
  → paywall_hit (which feature, which tier)
  → upgrade_prompt.shown
  → upgrade_prompt.clicked
  → subscription_created
```

### WMS activation funnel
```
pick_session_started
  → first barcode scanned
  → first order shipped
  → wms daily active (7-day retention)
```

---

## 8. Pending Improvements

| ID | Priority | Description |
|---|---|---|
| PH-01 | P1 | ✅ Done | `identifyUser()` + `groupByShop()` called at login, signup, and session hydration — Jun 2026 |
| PH-02 | P1 | ✅ Done | `PostHogPageView.tsx` component fires `$pageview` on every React Router navigation — Jun 2026 |
| PH-03 | P2 | Server-side events for monetization: `trial_started`, `paywall_hit`, `subscription_created`, `overage_incurred` — fire from backend on state change, not UI |
| PH-04 | P2 | PostHog group analytics config — enable `shop` group type in PostHog dashboard and wire `posthog.group()` calls |
| PH-05 | P2 | Pageview tracking in SPA — wire React Router `useLocation` to fire `$pageview` on every route change |
| PH-06 | P3 | Session recording config — enable for `/register` and `/login` flows to diagnose drop-off |
| PH-07 | P3 | Feature flags — use PostHog feature flags for A/B testing pricing copy, CTA wording |
| PH-08 | P3 | `auth.login.success` event should include `shop_id` and `tier` in payload |

---

## 9. Dev Environment

PostHog is **disabled** on localhost on the landing page:
```js
if (window.location.hostname !== 'localhost' && ...) {
  posthog.init(...)
}
```

In the app, PostHog initializes everywhere but `import.meta.env.DEV` enables `__FUNNEL_TRACE__` — a window-level array that logs every event for local debugging:
```js
window.__FUNNEL_TRACE__  // inspect in browser console during dev
```

---

## 10. Pitfalls

**1. Different API hosts on www vs app breaks session stitching**
Both must use `https://t.lasyncro.com`. If `app.posthog.com` is used on either side, events go through different ingestion paths and PostHog cannot stitch sessions. This was the state before June 2026 — fixed by aligning `VITE_PUBLIC_POSTHOG_HOST`.

**2. Missing cross-domain options creates phantom users**
Every signup will appear as a new anonymous user with no `www` attribution. The fix (cookie_domain + cross_subdomain_cookie + persistence) must be present on both sides. Check both files if funnel looks broken.

**3. `capture_pageview: false` means UTM params need manual capture**
PostHog attaches UTM params to the session when it captures a pageview. With `capture_pageview: false` in the app, the UTM params from the CTA link (`?utm_source=marketing_site&...`) are in the URL but may not be captured. Fix: fire `posthog.capture('$pageview')` in the React Router effect (PH-02).

**4. Calling `posthog.capture()` directly bypasses the adapter**
All events must go through `useUiEvents().emit()` → `adapter.sendEvent()`. Direct calls break the funnel trace, bypass the guard, and make vendor migration harder.

**5. Never use `email` as a PostHog identify property without consent**
PostHog stores identify properties. If GDPR applies (EU merchants), either get explicit consent before identifying with email, or omit email from identify calls entirely and use only `user_id` and `shop_id`.

---

## 11. Quick Reference

```ts
// Emit an event (correct way)
const { emit } = useUiEvents();
emit('upgrade_prompt.shown', { tier: 'core', feature: 'cash_flow' });

// Check funnel trace in browser console (dev only)
window.__FUNNEL_TRACE__

// Verify PostHog is initialized
window.posthog?.get_distinct_id()

// Check cross-domain cookie is set
document.cookie  // look for ph_ prefixed cookie with domain=.lasyncro.com
```

---

## 12. Completed Issues Log

| Date | Issue | Fix |
|---|---|---|
| Jun 2026 | `www` and `app` using different API hosts — session stitching broken | Aligned both to `https://t.lasyncro.com` |
| Jun 2026 | No cross-domain cookie config — signup funnel attribution broken | Added `cookie_domain`, `cross_subdomain_cookie`, `persistence` to both inits |
| Jun 2026 | `cookie_domain` missing from PostHog TS types | Cast via `as unknown as object` in `main.tsx` |
| Jun 2026 | No identity calls at login/signup/hydration (PH-01) | `identifyUser()` + `groupByShop()` in `adapter.ts`, called from `AuthLogin`, `AuthRegister`, `AuthContext` |
| Jun 2026 | No pageview tracking in SPA (PH-02) | `PostHogPageView.tsx` mounted inside `BrowserRouter` — fires on every route change |