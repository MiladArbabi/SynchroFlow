# LaSyncro — PostHog Analytics Playbook

**Last updated:** September 4, 2026 (AN-ENV-01)
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

### 5a. Public landing/checklist events (`packages/landing-page`) — consent-aware vanilla JS

| Event | Props | Surface | Notes |
|---|---|---|---|
| `launch_notify_clicked` | `location: nav|body` | Homepage | User opens the launch/waitlist path |
| `waitlist_signup` | `source` | Homepage + checklist | Fires only after successful waitlist API confirmation |
| `shopify_install_clicked` | `location: nav|body` | Homepage | Conditional Shopify install CTA |
| `checklist_answer` | — | `/checklist` | Checklist interaction |
| `checklist_complete` | — | `/checklist` | Checklist completion |

`waitlist_signup` is shared across homepage and checklist; `source` distinguishes the surface.

Raw email is submitted only to the application waitlist endpoint. Email is not included in the PostHog event payload.

### 5b. Marketing app events (`apps/marketing`) — via `captureMarketingEvent()` boundary

| Event | Props | Component | Notes |
|---|---|---|---|
| `pricing_plan_cta_clicked` | `plan`, `cta_label` | `PricingPlanCTA.tsx` | Fires on every plan CTA click |
| `compare_page_viewed` | `competitor` | `CompareArticleTracker.tsx` | Fires on mount of each compare article |
| `compare_cta_clicked` | `location`, `cta_label` | `CompareCTA.tsx` | Bottom CTA on compare index |
| `blog_article_viewed` | `article_slug`, `category`, `estimated_read_min` | `BlogArticleTracker.tsx` | Fires on mount |
| `blog_article_completed` | `article_slug`, `scroll_depth_pct` | `BlogArticleTracker.tsx` | Fires at 80% scroll via IntersectionObserver |
| `blog_cta_clicked` | `variant`, `cta_label`, `location` | `ArticleCTA.tsx` | Inline and full CTA variants |
| `about_cta_clicked` | `cta_label` | `AboutCTAs.tsx` | get_early_access \| read_blog |

Passive marketing trackers subscribe to analytics readiness. If a visitor grants analytics consent after the initial render, eligible page/article view tracking reruns after PostHog becomes ready.

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
| `upgrade_prompt.see_plans` | — | Explicit See plans action |

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
| `subscription_upgraded` | Stripe update where `TIER_ORDER[new] > TIER_ORDER[previous]` |
| `subscription_cancelled` | Canonical Shopify/Stripe cancellation event |
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

### Consent first

PostHog is not initialized on browser surfaces until the shared analytics consent cookie is `granted`.

Cookie:

```text
lasyncro_analytics_consent=granted|denied
Domain=.lasyncro.com
```

This allows one consent choice to apply across `www.lasyncro.com`, `lasyncro.com`, and `app.lasyncro.com`.

### Anonymous → user → shop

After consent is granted:

```text
www.lasyncro.com
  → PostHog initializes
  → anonymous distinct_id created in shared .lasyncro.com persistence

app.lasyncro.com
  → same PostHog project + shared cross-subdomain persistence
  → anonymous identity continues

login / registration / session hydration
  → identifyUser(user_id, shop_id, metadata)
  → groupByShop(shop_id)
```

`identifyUser()` and `groupByShop()` are called from:

- `AuthContext.tsx` — session hydration
- `AuthLogin.tsx` — successful login
- `AuthRegister.tsx` — successful registration

If authentication becomes available before PostHog is ready, the app adapter retains the pending user/shop identity and replays it after the `lasyncro:posthog-ready` event.

### Logout

`AuthContext.logout()` calls `resetAnalyticsIdentity()`.

The reset:

1. clears any pending identity/shop state immediately;
2. calls `posthog.reset()` when PostHog is consented and ready.

This prevents activity from a later anonymous or different-user session being attributed to the previous user.

### Backend identity

Backend events intentionally use:

```text
distinct_id = shop_<shopId>
$groups.shop = <shopId>
```

Backend events therefore join frontend behavior at the **shop group** level, not through the frontend user's person-level `distinct_id`.

`PH-04` remains pending: the `shop` group type must be configured in PostHog for group-level analysis.

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

Production isolation remains enforced by `AN-ENV-01`.

Browser PostHog now has two gates:

1. the surface must be an approved production runtime/hostname;
2. `lasyncro_analytics_consent` must equal `granted`.

Production requirements:

- `app.lasyncro.com` — production Vite runtime + exact production hostname + consent; Fly must inject `VITE_PUBLIC_POSTHOG_KEY` and `VITE_PUBLIC_POSTHOG_HOST` at Docker build time.
- `www.lasyncro.com` / `lasyncro.com` — production marketing/landing host + consent.
- `/checklist` — production public host + consent.
- localhost, `127.0.0.1`, previews, staging, CI and E2E hosts — production PostHog disabled.
- Backend PostHog — `NODE_ENV=production`, `ANALYTICS_PRODUCTION_ENABLED=true`, and `POSTHOG_API_KEY`.

The app exposes PostHog readiness through:

```text
window.__LASYNCRO_POSTHOG_READY__
lasyncro:posthog-ready
```

Static public pages expose their enabled state through:

```text
window.__LASYNCRO_ANALYTICS_ENABLED__
```

Development `__FUNNEL_TRACE__` remains local-only and is never emitted remotely.

## 13. Pitfalls

1. **Different PostHog API hosts break identity continuity** — browser surfaces use `https://t.lasyncro.com`.
2. **Missing cross-subdomain persistence creates fragmented anonymous identities** — keep `cookie_domain`, `cross_subdomain_cookie`, and `persistence` aligned.
3. **Production hostname is not enough** — browser PostHog must also wait for analytics consent.
4. **Do not call `posthog.capture()` directly from app product components** — use `useUiEvents().emit()`.
5. **Marketing custom events use `captureMarketingEvent()`** — this is the central consent-aware marketing capture boundary.
6. **Passive marketing view events must depend on analytics readiness** — otherwise a visitor granting consent after initial render can lose the view event.
7. **Logout must reset PostHog identity** — otherwise a shared browser can retain the previous user's attribution.
8. **Do not put raw email into behavior analytics events** — waitlist email belongs in the application API payload, not PostHog.
9. **Frontend and backend do not share the same person `distinct_id`** — backend lifecycle events join frontend behavior through the `shop` group.
10. **A Stripe subscription update is not automatically an upgrade** — emit `subscription_upgraded` only when canonical tier rank increases.

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
| Sep 2026 | AN-PH-01 PostHog wiring + data-quality hardening | Unified consent gating; added app readiness/pending identity replay; reset identity on logout; removed checklist email from PostHog; removed RouteLogger production noise; enforced typed app event path; normalized subscription cancellation/upgrade semantics; added homepage conversions; fixed delayed-consent passive marketing tracking; added regression contracts |

---

## AN-PH-01 — PostHog Wiring & Data Quality Hardening

**Completed:** September 4, 2026

### Invariants

1. Browser PostHog initializes only on approved production surfaces after analytics consent is granted.
2. App product events use the typed `useUiEvents().emit()` path.
3. Marketing custom events use the consent-aware `captureMarketingEvent()` boundary.
4. Raw waitlist email is never included in PostHog event properties.
5. Authenticated identity is replayed if authentication precedes PostHog readiness.
6. Logout clears pending identity and resets PostHog.
7. Backend lifecycle analytics remain shop-grouped.
8. Subscription cancellation uses one canonical event name.
9. `subscription_upgraded` means an actual upward tier transition.
10. Homepage launch, waitlist and Shopify-install conversion intents are explicitly instrumented.

### Regression contracts

- `tests/contract/posthog-app-consent-timing.contract.test.ts`
- `tests/contract/posthog-consent.contract.test.ts`
- `tests/contract/posthog-homepage-conversions.contract.test.ts`
- `tests/contract/posthog-fly-build-env.contract.test.ts`
- `tests/contract/posthog-identity-lifecycle.contract.test.ts`
- `tests/contract/posthog-marketing-consent-timing.contract.test.ts`
- `tests/contract/posthog-marketing-passive-consent.contract.test.ts`
- `tests/contract/posthog-no-pii.contract.test.ts`
- `tests/contract/posthog-route-noise.contract.test.ts`
- `tests/contract/posthog-subscription-taxonomy.contract.test.ts`
- `tests/contract/posthog-typed-events.contract.test.ts`
- `tests/contract/analytics-consent-ux.contract.test.ts`

### Verification

- AN-PH-01 targeted contracts: **29/29 passed**.
- Production correction regression surface: **13 suites / 37 tests passed**.
- Production certification exposed a missing Fly build-time PostHog key: `app.lasyncro.com` had consent granted but `__LASYNCRO_POSTHOG_READY__ = false` and logged `Missing API key`.
- Corrected by declaring Docker build args and supplying `VITE_PUBLIC_POSTHOG_KEY` plus `VITE_PUBLIC_POSTHOG_HOST` through `fly.toml [build.args]`; Vite embeds these values into the production SPA bundle.
- Marketing production build: **passed** using Next webpack build path in the temporary worktree.
- Frontend TypeScript: **21 errors current / 21 errors clean HEAD**, identical pre-existing baseline; zero analytics-scope errors.
- Backend build: AN-PH-01 `TIER_ORDER` resolution verified; remaining **2 errors** reproduced identically on clean HEAD.
- Full contract suite in temporary worktree: **310 passed / 3 environment failures**; the same 3 `frontend-production-build-env` failures reproduced on clean HEAD because Vite resolves through the external worktree `node_modules` symlink.

---

## AN-ENV-01 — Production Analytics Isolation

**Completed:** September 4, 2026

### Invariant

Development, localhost, test, preview, staging and CI activity must never enter the production GA4 or PostHog datasets.

### Enforcement

| Surface | Production requirement |
|---|---|
| `apps/frontend` GA4 | hostname = `app.lasyncro.com` |
| `apps/frontend` PostHog | Vite mode = `production` AND hostname = `app.lasyncro.com` |
| `apps/marketing` PostHog | production runtime AND hostname = `www.lasyncro.com` or `lasyncro.com` |
| `packages/landing-page` PostHog | hostname = `www.lasyncro.com` or `lasyncro.com` |
| `/checklist` PostHog | hostname = `www.lasyncro.com` or `lasyncro.com` |
| backend PostHog | `NODE_ENV=production` + `ANALYTICS_PRODUCTION_ENABLED=true` + API key |

Backend production explicitly carries `ANALYTICS_PRODUCTION_ENABLED=true` in Fly secrets.

### Permanent regression contract

`tests/contract/analytics-production-isolation.contract.test.ts`

Covers:

1. production frontend allowed;
2. localhost/dev rejected;
3. preview hosts rejected;
4. backend production gate;
5. missing backend key rejected;
6. GA4 host gating;
7. public marketing host allowlist;
8. checklist custom-event gating.

Verification on September 4, 2026:

- targeted contract: **5/5 PASS**
- `git diff --check`: **PASS**
- Fly machine: **1/1 health check passing**
- production backend `/health`: `{"status":"ok"}`
