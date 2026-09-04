# Google Analytics Playbook

**Last updated:** 2026-09-04
**Measurement ID:** `G-1H3XLN9MN2`

## Purpose

GA4 is LaSyncro's acquisition and website/app traffic analytics layer.

Use GA4 for:
- acquisition channels
- organic/search traffic
- referral traffic
- campaign attribution
- landing-page performance
- page-view and conversion analysis

PostHog remains the primary product-behaviour analytics system.

## Production surfaces

GA4 is wired across:

| Surface | Runtime | GA4 |
|---|---|---|
| `www.lasyncro.com/` | static landing page | enabled after consent |
| `www.lasyncro.com/*` | Next.js marketing app | enabled after consent |
| `lasyncro.com/*` | public production host | enabled after consent |
| `app.lasyncro.com/*` | React SPA | enabled after consent |
| localhost/dev/test/preview | non-production | disabled |

## Production isolation

GA4 must fail closed outside approved production environments.

App:
- production Vite mode required
- hostname must be exactly `app.lasyncro.com`

Marketing:
- `NODE_ENV=production`
- hostname must be exactly `www.lasyncro.com` or `lasyncro.com`

Static landing page:
- hostname must be exactly `www.lasyncro.com` or `lasyncro.com`

No unconditional external GA4 script tag is permitted.

## Consent model

GA4 is not loaded until the user explicitly allows Google Analytics.

Shared consent cookie:

```text
lasyncro_analytics_consent

Possible values:

granted
denied

Cookie scope:

Domain=.lasyncro.com
Path=/
SameSite=Lax
Secure
Max-Age=31536000

This allows the user's GA4 choice to follow them between:

www.lasyncro.com
app.lasyncro.com

This implementation is explicit opt-in loading. It is not Google Consent Mode.

Page-view strategy

Automatic GA4 page views are disabled:

send_page_view: false

LaSyncro emits explicit page_view events.

Static homepage

One page view is sent after GA4 consent is granted.

Next.js marketing app

A page view is emitted:

on initial route
on pathname changes
on search-parameter changes
React application

A page view is emitted:

on initial route
on React Router pathname changes
on search-parameter changes

Payload includes:

page_location
page_path
page_title
Source files
apps/frontend/src/analytics/googleAnalytics.ts
apps/frontend/src/analytics/GoogleAnalyticsPageView.tsx
apps/frontend/src/analytics/AnalyticsConsentBanner.tsx
apps/frontend/src/main.tsx

apps/marketing/components/GoogleAnalyticsProvider.tsx
apps/marketing/app/layout.tsx

packages/landing-page/index.html
Regression contracts
tests/contract/analytics-production-isolation.contract.test.ts
tests/contract/google-analytics-wiring.contract.test.ts

AN-GA-01 verification:

Marketing production build: PASS
Analytics contracts: 11/11 PASS
git diff --check: PASS

The full frontend build currently has a separate pre-existing TypeScript baseline of 19 errors outside AN-GA-01. No AN-GA-01 source file appeared in that failure set.

Boundaries

AN-GA-01 only establishes reliable GA4 loading and page-view collection.

Not included yet:

conversion/business event taxonomy
signup or trial conversion events
ecommerce/revenue events
UTM redesign
cross-channel attribution improvements
GA4 dashboards
GSC integration
PostHog event redesign
Google Consent Mode
