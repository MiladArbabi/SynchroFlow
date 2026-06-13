# LaSyncro — PostHog Analytics Playbook

**Last updated:** June 2026 (PostHog Sprint 1)
**Status:** Live on `www.lasyncro.com`, `app.lasyncro.com`, and `apps/marketing`
**Owner:** Engineering / Growth
**Location in repo:** `docs/playbooks/posthog_playbook.md`

---

## 1. Architecture Overview

LaSyncro runs a single PostHog project across three surfaces:

```
packages/landing-page   → PostHog snippet (vanilla JS, in <head>)
apps/marketing          → posthog-js/react via PostHogProvider.tsx (Next.js)
apps/frontend           → posthog-js npm via PostHogProvider (React SPA)
```

All three point to the **same project key** and the **same API host** (`https://t.lasyncro.com`), enabling cross-subdomain identity stitching for the full `www → register → dashboard` funnel.

### Reverse proxy
All PostHog traffic is routed through `https://t.lasyncro.com`. This prevents ad blockers from blocking analytics. The `ui_host` remains `https://app.posthog.com`.

### Project key
```
phc_kVdrQpoCzz5J7n9NzHW2gXHtwA6PC9gQJW294ajhpmrM
```
Stored as `VITE_PUBLIC_POSTHOG_KEY` in `apps/frontend/.env`.

---

## 2. Cross-Domain Identity (Critical)

### The fix — three options identical across all three surfaces

```js
cookie_domain: '.lasyncro.com',
cross_subdomain_cookie: true,
persistence: 'localStorage+cookie',
```

**INVARIANT:** These three options must be identical in:
- `packages/landing-page/index.html` — PostHog snippet `posthog.init()`
- `apps/marketing/components/PostHogProvider.tsx` — Next.js app init
- `apps/frontend/src/main.tsx` — React SPA init

Any drift between surfaces breaks funnel attribution silently.

---

## 3. Initialization

### Landing page (`packages/landing-page/index.html`)
Vanilla JS snippet in `<head>`. Localhost guard active.

```js
posthog.init('phc_kVdrQ...', {
  api_host: 'https://t.lasyncro.com',
  ui_host: 'https://app.posthog.com',
  autocapture: true,
  capture_pageview: true,
  cookie_domain: '.lasyncro.com',
  cross_subdomain_cookie: true,
  persistence: 'localStorage+cookie',
});
```

### Marketing app (`apps/marketing/components/PostHogProvider.tsx`)
Next.js, `posthog-js/react`. Route-aware pageview tracker built in via `PageViewTracker` component using `usePathname()`. Localhost guard active.

```ts
posthog.init(POSTHOG_KEY, {
  api_host: 'https://t.lasyncro.com',
  ui_host: 'https://app.posthog.com',
  autocapture: true,
  capture_pageview: false,       // manual via PageViewTracker
  capture_pageleave: true,
  cookie_domain: '.lasyncro.com',
  cross_subdomain_cookie: true,
  persistence: 'localStorage+cookie',
})
```

`getPageviewContext()` enriches every `$pageview` with `section` and `page_type`:
```
/           → { section: 'home',    page_type: 'home' }
/pricing    → { section: 'pricing', page_type: 'pricing' }
/about      → { section: 'about',   page_type: 'about' }
/blog       → { section: 'blog',    page_type: 'blog_index' }
/blog/*     → { section: 'blog',    page_type: 'blog_article' }
/compare    → { section: 'compare', page_type: 'compare_index' }
/compare/*  → { section: 'compare', page_type: 'compare_article' }
/glossary   → { section: 'glossary', page_type: 'glossary_index' }
/glossary/* → { section: 'glossary', page_type: 'glossary_entry' }
```

### App (`apps/frontend/src/main.tsx`)
npm package, React SPA.

```tsx
posthog.init(posthogKey, {
  api_host: posthogHost,           // https://t.lasyncro.com
  capture_pageview: false,         // PostHogPageView.tsx handles this
  capture_exceptions: true,
  autocapture: false,              // explicit events only
  cookie_domain: '.lasyncro.com',
  cross_subdomain_cookie: true,
  persistence: 'localStorage+cookie',
});
```

`PostHogPageView.tsx` is mounted inside `BrowserRouter` and fires `$pageview` on every React Router navigation.

---

## 4. Naming Conventions

Two naming conventions are in use. **Never mix them.**

| Surface | Convention | Examples |
|---|---|---|
| `packages/landing-page` | `underscore` | `hero_signup_clicked`, `pricing_plan_cta_clicked` |
| `apps/marketing` | `underscore` | `compare_page_viewed`, `blog_article_completed` |
| `apps/frontend` | `dot.notation` | `auth.login.success`, `module.visited` |
| Backend (posthog-node) | `underscore` | `trial_started`, `paywall_hit` |

---

## 5. Event Register

### 5a. Landing page events (`packages/landing-page`) — vanilla JS, inline onclick

| Event | Props | Notes |
|---|---|---|
| `nav_login_clicked` | `location: 'header'` | Nav — Log in |
| `nav_signup_clicked` | `location: 'header'` | Nav — Start free |
| `hero_signup_clicked` | `location: 'hero'` | Hero CTA |
| `section_signup_clicked` | `location: 'cta_section'` | Mid-page CTA section |
| `section_login_clicked` | `location: 'cta_section'` | Mid-page login link |
| `footer_signup_clicked` | `location: 'footer_cta'` | Footer CTA |

### 5b. Marketing app events (`apps/marketing`) — via PostHog React hooks

| Event | Props | Component | Notes |
|---|---|---|---|
| `pricing_plan_cta_clicked` | `plan`, `cta_label` | `PricingPlanCTA.tsx` | Fires on every plan CTA click |
| `compare_page_viewed` | `competitor` | `CompareArticleTracker.tsx` | Fires on mount of each compare article |
| `compare_cta_clicked` | `location`, `cta_label` | `CompareCTA.tsx` | Bottom CTA on compare index |
| `blog_article_viewed` | `article_slug`, `category`, `estimated_read_min` | `BlogArticleTracker.tsx` | Fires on mount |
| `blog_article_completed` | `article_slug`, `scroll_depth_pct` | `BlogArticleTracker.tsx` | Fires at 80% scroll via IntersectionObserver |
| `blog_cta_clicked` | `variant`, `cta_label`, `location` | `ArticleCTA.tsx` | Inline and full CTA variants |
| `about_cta_clicked` | `cta_label` | `AboutCTAs.tsx` | get_early_access \| read_blog |

**Deferred:**
- `pricing_toggle_changed` — annual/monthly toggle not yet built
- `newsletter_submitted` — email collection sprint pending

### 5c. App events (`apps/frontend`) — dot.notation, via `useUiEvents()` adapter

#### Auth
| Event | Props | Call site |
|---|---|---|
| `auth.signup.success` | `user_id`, `shop_id` | `AuthRegister.tsx` |
| `auth.signup.failed` | — | `AuthRegister.tsx` |
| `auth.login.success` | `user_id`, `shop_id`, `tier` | `AuthLogin.tsx` |
| `auth.login.failed` | — | `AuthLogin.tsx` |

#### Integration (Shopify OAuth)
| Event | Props | Call site |
|---|---|---|
| `integration.connect.started` | — | OAuth entry |
| `integration.connect.redirected` | — | Before OAuth redirect — measures pre-OAuth drop-off |
| `integration.connect.failed` | — | OAuth failure |
| `integration.connect.back` | — | User pressed back |
| `integration.connect.cancelled` | — | User cancelled |
| `integration.platform.selected` | — | Platform selection |

#### Upgrade prompts
| Event | Props | Notes |
|---|---|---|
| `upgrade_prompt.shown` | `tier`, `feature` | |
| `upgrade_prompt.dismissed` | — | |
| `upgrade_prompt.clicked` | `tier`, `feature` | |

#### Product adoption
| Event | Props | Call site |
|---|---|---|
| `module.visited` | `module` (overview\|inventory\|fulfillment\|finances\|suppliers\|warehouse) | `ModuleContentHost.tsx` |
| `feature.paywall_hit` | `feature`, `current_plan`, `required_tier` | `PaywallSurface.tsx` |
| `team.invite_sent` | `invite_count`, `workspace_operator_total` | `MembersPage.tsx` |

**Deferred — needs dedicated sprint:**
- `onboarding.step_completed` / `onboarding.completed` — FT1 checklist is outdated, needs full onboarding sprint
- `aha_modal.viewed` — fires when aha moment modal appears post-OAuth sync
- `aha_modal.unlocked` — fires when user clicks "Unlock Insights →"
- `ft2.activated` — fires when user lands on FT2 overview for first time
- `inventory.first_viewed` — aha moment definition needed
- `scan.first_completed` — needs full WMS/LSU/LSO workflow workshop

### 5d. Backend events (`posthog-node` in `utils/analytics.ts`) — PH-03 ✅

| Event | Trigger |
|---|---|
| `trial_started` | Trial begins |
| `trial_expired` | Trial ends without conversion |
| `trial_reminder_sent` | Reminder email dispatched |
| `paywall_hit` | Entitlement middleware blocks feature |
| `subscription_activated` | First paid subscription |
| `subscription_upgraded` | Plan upgrade |
| `subscription_cancelled` | Cancellation |
| `payment_failed` | Stripe webhook |

---

## 6. Event Architecture (App)

All app events flow through a single adapter — **never call `posthog.capture()` directly.**

```
Product code
  → useUiEvents().emit(eventName, payload)   [apps/frontend/src/analytics/useUiEvents.ts]
  → sendEvent(event, payload)                [apps/frontend/src/analytics/adapter.ts]
  → posthog.capture(event, { ...payload, source: 'frontend_app', ts: Date.now() })
```

### Adding a new event
1. Add the event name to `UiEventName` union in `useUiEvents.ts`
2. Call `emit('your.event.name', { prop: value })` in the component
3. Never call `posthog.capture()` directly

---

## 7. Identity Model

### Unit of revenue = shop, not user

```ts
// identifyUser() — adapter.ts
posthog.identify(userId.toString(), {
  shop_id: shopId ?? null,
  plan: meta?.plan ?? null,
  trial_ends_at: meta?.trial_ends_at ?? null,
  created_at: meta?.created_at ?? null,
});

// groupByShop() — adapter.ts
posthog.group('shop', shopId.toString());
```

Called at three sites:
- `AuthContext.tsx` — session hydration (JWT decode)
- `AuthLogin.tsx` — after successful login
- `AuthRegister.tsx` — after successful registration

`plan`, `trial_ends_at`, and `created_at` come from JWT claims (enriched on backend).

### Distinct ID flow
```
www.lasyncro.com visit        → anon distinct_id set in .lasyncro.com cookie
apps/marketing page visit     → same cookie → same distinct_id
Click "Start free"            → app.lasyncro.com reads same cookie → same distinct_id
auth.signup.success fires     → posthog.identify(user_id) → anon_id aliased to user_id
All future events             → attributed to user_id
```

---

## 8. FT1 → FT2 Flow (Aha Moment)

The activation funnel visible in the app:

```
1. User enters Shopify store domain → clicks "Connect Shopify →"
   → integration.connect.started
   → integration.connect.redirected (before OAuth redirect)

2. OAuth completes → 5-step sync runs:
   Step 1: Connecting to Shopify (auth + permissions)
   Step 2: Reading catalogue (products + variants → inventory ledger)
   Step 3: Mapping orders (order history + fulfilment records)
   Step 4: Calculating margin per order (risk scoring + restock projection)
   Step 5: Building Morning Brief (operational intelligence layer)

3. Aha modal appears at /overview:
   "LaSyncro found this in your store" — shows real store data:
   variants tracked, avg days of stock, top mover
   → aha_modal.viewed [PENDING]

4. User clicks "Unlock Insights →"
   → aha_modal.unlocked [PENDING]
   → FT1 → FT2 promotion triggered

5. User lands on FT2 overview — The Brief, live issues, revenue at risk
   → ft2.activated [PENDING]
```

**FT1 definition:** OAuth connected, sync complete, readiness = false. User is in holding state seeing the aha modal.
**FT2 definition:** User has clicked "Unlock Insights" — readiness = true. Full product visible.

The aha modal events (`aha_modal.viewed`, `aha_modal.unlocked`, `ft2.activated`) are the highest-value events in the entire funnel. They close the loop between acquisition and activation. **Instrument in the onboarding sprint.**

---

## 9. UTM Attribution

All CTAs on `www.lasyncro.com` include UTM parameters:

| CTA location | `utm_source` | `utm_medium` | `utm_content` |
|---|---|---|---|
| Nav — Log in | `marketing_site` | `nav` | `login` |
| Nav — Start free | `marketing_site` | `nav` | `start_free` |
| Hero | `marketing_site` | `hero` | `start_free` |
| CTA section — Start free | `marketing_site` | `cta_section` | `start_free` |
| CTA section — Log in | `marketing_site` | `cta_section` | `login` |
| Footer CTA | `marketing_site` | `footer_cta` | `start_free` |

PostHog captures UTM params automatically from the URL on `$pageview`. `PostHogPageView.tsx` fires on every route change in the SPA — UTM capture is active.

---

## 10. Key Funnels

### Acquisition funnel
```
www.lasyncro.com or apps/marketing visit ($pageview)
  → nav_signup_clicked / hero_signup_clicked / section_signup_clicked
     / pricing_plan_cta_clicked / compare_cta_clicked / blog_cta_clicked
  → app.lasyncro.com/register loaded
  → auth.signup.success
  → integration.connect.started
  → integration.connect.redirected
  → [5-step sync]
  → aha_modal.viewed     [PENDING]
  → aha_modal.unlocked   [PENDING]
  → ft2.activated        [PENDING]
```

### Trial conversion funnel
```
trial_started (day 0)                    [backend]
  → feature.paywall_hit (which feature)  [frontend]
  → paywall_hit                          [backend]
  → upgrade_prompt.shown
  → upgrade_prompt.clicked
  → subscription_activated               [backend]
```

### Module adoption funnel
```
ft2.activated
  → module.visited (which modules, in what order)
  → team.invite_sent (stickiness — team expansion)
```

---

## 11. Pending Improvements

| ID | Priority | Description |
|---|---|---|
| PH-04 | P2 | Enable `shop` group type in PostHog dashboard — group analytics config |
| PH-06 | P3 | Session recording for `/register` and `/login` flows |
| PH-07 | P3 | Feature flags — A/B testing pricing copy, CTA wording |
| PH-09 | P1 | `aha_modal.viewed` + `aha_modal.unlocked` + `ft2.activated` — onboarding sprint |
| PH-10 | P1 | Full onboarding sprint — redefine FT1 checklist, wire `onboarding.step_completed` / `onboarding.completed` |
| PH-11 | P2 | `inventory.first_viewed` — define aha moment (which page/state = "sees inventory for first time") |
| PH-12 | P2 | `scan.first_completed` — WMS/LSU/LSO workflow workshop needed before instrumentation |
| PH-13 | P2 | `newsletter_submitted` — email collection sprint (ArticleCTA email input, API route, Resend) |
| PH-14 | P3 | `pricing_toggle_changed` — instrument once annual/monthly toggle is built |
| PH-15 | P3 | `groupByShop()` — pass shop properties (name, plan, created_at) to PostHog group call |

---

## 12. Dev Environment

PostHog is **disabled on localhost** on the landing page and marketing app. In the app, PostHog initialises everywhere but `import.meta.env.DEV` enables `__FUNNEL_TRACE__`:

```js
window.__FUNNEL_TRACE__  // inspect in browser console during dev
```

Quick reference:
```ts
// Emit an event (correct way — app only)
const { emit } = useUiEvents();
emit('module.visited', { module: 'inventory' });

// Verify PostHog is initialised
window.posthog?.get_distinct_id()

// Check cross-domain cookie is set
document.cookie  // look for ph_ prefixed cookie with domain=.lasyncro.com
```

---

## 13. Pitfalls

1. **Different API hosts breaks session stitching** — all three surfaces must use `https://t.lasyncro.com`
2. **Missing cross-domain options creates phantom users** — `cookie_domain` + `cross_subdomain_cookie` + `persistence` must be present on all three surfaces
3. **Calling `posthog.capture()` directly in the app bypasses the adapter** — always use `useUiEvents().emit()`
4. **`useEffect` dependency arrays must include `emit`** — TypeScript / ESLint will warn; always follow the suggestion
5. **Marketing app components that call PostHog must be `'use client'`** — server components cannot use hooks
6. **Never use `email` as a PostHog identify property without consent** — GDPR applies to EU merchants; use `user_id` and `shop_id` only unless explicit consent obtained

---

## 14. Completed Issues Log

| Date | Issue / Task | Resolution |
|---|---|---|
| Jun 2026 | `www` and `app` using different API hosts | Aligned both to `https://t.lasyncro.com` |
| Jun 2026 | No cross-domain cookie config — signup funnel attribution broken | Added `cookie_domain`, `cross_subdomain_cookie`, `persistence` to both inits |
| Jun 2026 | `cookie_domain` missing from PostHog TS types | Cast via `as unknown as object` in `main.tsx` |
| Jun 2026 | `identifyUser()` thin — only `shop_id` passed | Enriched with `plan`, `trial_ends_at`, `created_at` from JWT claims across all three call sites |
| Jun 2026 | `auth.login.success` missing `tier` in payload (PH-08) | Added `tier: user.plan` to event payload in `AuthLogin.tsx` |
| Jun 2026 | `apps/marketing` PostHogProvider missing cross-domain options | Added all three cross-domain options — `apps/marketing` was silently creating phantom users |
| Jun 2026 | Zero events on marketing pages (`/pricing`, `/compare/*`, `/blog/*`, `/about`) | Instrumented all pages — `PricingPlanCTA`, `CompareArticleTracker`, `CompareCTA`, `BlogArticleTracker`, `ArticleCTA`, `AboutCTAs` |
| Jun 2026 | `WaitlistCTA.tsx` deprecated — stale `#waitlist` href | Deleted; replaced with `ArticleCTA.tsx` in `ArticleLayout.tsx` |
| Jun 2026 | `#waitlist` href and `waitlist_section` UTM refs throughout landing page and marketing app | All replaced with `https://app.lasyncro.com` and `cta_section` |
| Jun 2026 | No app-side adoption events | Added `module.visited` (`ModuleContentHost.tsx`), `feature.paywall_hit` (`PaywallSurface.tsx`), `team.invite_sent` (`MembersPage.tsx`) |
| Jun 2026 | PH-05 listed as pending despite PH-02 being done | PH-05 closed — `PostHogPageView.tsx` confirmed mounted in router, covers the same requirement |
| Jun 2026 | Section 5 note contradicting PH-01 ✅ status | Note was stale — PH-01 confirmed done via grep; Section 5 updated |
| Jun 2026 | posthog-node backend events (PH-03) | `trial_started`, `trial_expired`, `trial_reminder_sent`, `paywall_hit`, `subscription_activated`, `subscription_upgraded`, `subscription_cancelled`, `payment_failed` — all live |