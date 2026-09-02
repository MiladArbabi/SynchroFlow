# LaSyncro — Auth & Identity Blueprint

**Last updated: May 2026**  
**Status: Core flow complete — email verification live — account deletion pending**  
**Issues: #978 (Gmail shortcut) · #979 (Account deletion)**

---

## Overview

LaSyncro uses a custom JWT-based auth system with email/password registration, Shopify OAuth integration, and email verification. There is no third-party auth provider (no Auth0, Firebase, Supabase). All token issuance is owned by a single internal service.

---

## Target Design — Auth v2 (2026-07-19, supersedes A1/A2 centered-card)

Source of truth: `LaSyncro Auth.dc.html` (Claude Design bundle). Auth is a brand
surface (see modules-ux-playbook scope carve-out) — landing-page treatment, not
FT2 module treatment.

Layout
- Split screen: left brand panel `flex: 0 0 44%`, right form column centered,
  form `max-width: 400px`.
- Surface is ALWAYS dark `#151D29` (--space-1) in both color schemes — auth does
  not follow prefers-color-scheme. AuthWrapper1 uses --space-1, not --bg.
- Left panel: subtle 44px grid overlay + orange radial glow, logo top-left,
  eyebrow "THE OPERATIONAL BRAIN" (accent, blinking dot), serif hero
  "One real-time picture, finally synced up." (accent italic on last phrase),
  subcopy, morning-brief mock card, stats footer (99.4% pick accuracy ·
  91.2h spreadsheet work removed / mo).
- Mobile/no-panel variant: centered form over grid backdrop (design's
  showGridBackdrop state); existing SocialProofTicker retained bottom.

Typography — Plus Jakarta Sans throughout (decision 2026-07-19)
- Display: 700, headings 36px/1.15, accent-colored italic em (matches current
  LoginPage headline treatment).
- Body/UI: 300 body, 500 labels/CTAs.
- Micro-labels: 11px, 500, uppercase, letter-spacing 0.08em, --ink-3.

Per-state copy
- Sign in (final copy, decision 2026-07-19 — no eyebrow): h "Hello. *Let's
  sync up.*" · sub "Sign in to continue to today's brief." · labeled fields
  (EMAIL, PASSWORD with inline "Forgot password?" right of label) ·
  CTA "Sign in →" · trust line "No credit card · Connects to Shopify in
  60 seconds · Cancel anytime" below divider.
- Register: stepper 1 Account / 2 Connect store · h "Create your account.
  *60 seconds.*" · sub "You'll connect Shopify in the next step. We never
  store your password." · First/Last name grid, WORK EMAIL, PASSWORD with
  3-segment strength meter + label, terms checkbox.
- Connect store: h "Connect once." — BUT Shopify 2.3.1 interim notice flow
  is retained until App Store approval; only heading/typography update now.

Field anatomy
- Uppercase micro-label above input; leading icon; input bg
  rgba(255,255,255,0.04), border rgba(255,255,255,0.14), radius 8px,
  focus border --accent.
- CTA: filled --accent, text --accent-ink, radius 8px, hover --accent-hover
  + translateY(-1px).

Animations (subtle, CSS-only where possible)
- lsBlink — brand-panel eyebrow dot: 2.4s ease-in-out infinite,
  50% keyframe { opacity: .4; transform: scale(.75) }.
- lsCell — AuthGridBackdrop (final, C3' 2026-07-19): 8 FIXED edge-hugging
  cells (44px grid coords hardcoded in component); pulse timing randomized
  per mount — delay 0–16s, duration 14–20s jitter, peak opacity 0.55
  (deliberately calmer than design source's 9s/1.0 sequential circuit).
  Grid mask INVERTED vs design source: transparent center (form area stays
  clean), visible toward edges — radial ellipse 62%/55% at 50%/45%,
  transparent 42% → black 82%. Glow relocated to top (50% 8%, 0.04).
  Deployed on Login, Register, ConnectStore via <AuthGridBackdrop />;
  AuthWrapper1 gained position: relative as its anchor.
- CTA hover: translateY(-1px) + --accent-hover, transition 0.15s.
- Respect prefers-reduced-motion: disable lsCell and lsBlink via media query.

Deltas tracked: A1–A7, A9–A10 (audit 2026-07-19). A8 (on-accent contrast)
already shipped — design's #151D29-on-accent equals --accent-ink intent.

---

## Architecture

### Stack

- **Backend:** Express + PostgreSQL (Knex) + bcrypt + jsonwebtoken + Resend (email)
- **Frontend:** React + MUI v7 + Formik + Yup + AuthContext
- **Token storage:** Access token in-memory (`authStore.ts`) + localStorage fallback. Refresh token in HttpOnly cookie.
- **RLS:** PostgreSQL Row Level Security enforced via `sf_app` role. Registration uses `systemDb` (`sf_user`, BYPASSRLS=true) because no tenant context exists yet.

### Key files

```tsx

Backend
├── apps/backend/src/api/auth/
│   ├── auth.controller.ts       ← registerUser, loginUser, refreshToken, logoutUser, verifyEmail, resendVerificationEmail
│   ├── auth.routes.ts           ← route wiring + authenticateToken middleware
│   └── token.service.ts        ← SINGLE authority for JWT issuance — never bypass
├── apps/backend/src/services/email/
│   └── email.service.ts        ← sendVerificationEmail, sendOperatorInviteEmail, sendTrialReminderEmail etc.
├── packages/backend-core/src/
│   ├── db.ts                   ← db (sf_app, RLS enforced) + systemDb (sf_user, BYPASSRLS)
│   └── middleware/auth.middleware.ts  ← authenticateToken — sets req.user.userId (camelCase)

Frontend
├── apps/frontend/src/
│   ├── contexts/AuthContext.tsx          ← AuthProvider, useAuth hook, OAuth handoff handler
│   ├── utils/authStore.ts               ← in-memory token store + localStorage fallback
│   ├── utils/route-guard/AuthGuard.jsx  ← redirects unauthenticated to /login
│   └── pages/authentication/
│       ├── LoginPage.tsx                ← /login — static import of jwt/AuthLogin (AUTH-LOGOUT-HANG-01; see Pitfall #8)
│       ├── RegisterPage.tsx             ← /register — dynamic import of jwt/AuthRegister
│       ├── ForgotPasswordPage.tsx       ← /forgot-password
│       ├── CheckInboxPage.tsx           ← /check-inbox — post-registration verification wait
│       ├── VerifyEmailPage.tsx          ← /verify-email — token handler, redirects to /connect-store
│       ├── ConnectStorePage.tsx         ← /connect-store — step 2 of registration
│       ├── OAuthButtons.tsx             ← Shopify + Google buttons (shared across login/register)
│       ├── AuthPageChrome.tsx           ← SystemStatusPill + SocialProofTicker (shared)
│       ├── AuthWrapper1.tsx             ← page background wrapper (uses var(--bg))
│       └── AuthCardWrapper.tsx          ← card with border/shadow (uses var(--surface))
│       └── jwt/
│           ├── AuthLogin.tsx            ← email/password sign-in form + Formik
│           └── AuthRegister.tsx         ← registration form + Formik + terms validation

```

---

## Registration Flow (Happy Path)

```tsx

/register
  → AuthRegister.tsx fills: firstName, lastName, workEmail, password, agreed (terms)
  → POST /api/v1/auth/register
      ↓ systemDb transaction (sf_user — BYPASSRLS required)
        1. INSERT shops
        2. INSERT warehouse_locations (root)
        3. INSERT users
        4. INSERT shop_memberships (role: owner)
        5. LifecycleProjectionService.projectForMembership()
        6. INSERT shop_subscriptions (14-day Growth trial)
        7. EntitlementsService.applyFromCommercialGrant()
      ↓ issueAuthTokens() — access + refresh tokens
      ↓ systemDb UPDATE users SET email_verification_token, email_verification_expires_at
      ↓ sendVerificationEmail() — non-fatal, fire-and-forget
  ← { user: publicUser, accessToken }
  → auth.login(user, accessToken) — stored in AuthContext + authStore + localStorage
  → navigate('/check-inbox')

/check-inbox
  → Shows email address, 30-min expiry notice, Resend + Change address buttons
  → POST /api/v1/auth/resend-verification (requires Bearer token, rate-limited 1/min)

[User clicks email link]
/verify-email?token=<hex>
  → VerifyEmailPage.tsx calls GET /api/v1/auth/verify-email?token=<hex>
  → Backend: validates token, checks expiry, sets email_verified_at, clears token fields
  ← { message: 'Email verified successfully.' }
  → navigate('/connect-store?verified=true')

/connect-store?verified=true
  → Shows green "Email verified" banner
  → User enters Shopify store name → GET /api/v1/integrations/oauth/initiate?platform=shopify&shop=<name>
  → Redirects to Shopify OAuth
  → Shopify redirects back → GET /api/v1/integrations/oauth/callback/shopify
  → SyncAnimationPage → /overview (FT1 or FT2 depending on lifecycle)

```

---

## Sign-In Flow

```tsx

/login
  → POST /api/v1/auth/login { email, password }
  → bcrypt.compare → requireShopContextForUser → issueAuthTokens
  ← { accessToken, refreshToken, user }
  → auth.login() → navigate(role === 'operator' ? '/wms' : '/')

```

---

## Token System

### Access token

- JWT signed with `JWT_SECRET`
- Expires: **15 minutes** (900s)
- Payload: `user_id`, `shop_id`, `shop_roles`, `tier`, `scopes`, `session_id`, `token_version`
- Stored: in-memory (`authStore.ts`) + localStorage fallback
- On expiry: silently refreshed by Axios interceptor — user is never interrupted

### Refresh token

- JWT signed with `JWT_REFRESH_SECRET`
- Expires: **7 days**
- Stored: HttpOnly cookie (`refreshToken`) — never accessible to JS
- DB record: `refresh_tokens` table with `token_hash`, `session_id`, `token_version`, `revoked_at`
- Rotation: old token revoked on each refresh, new token issued
- Security: IP drift + UA drift logged (audit events), replay detection via `revoked_at`
- Sliding window: every refresh resets the 7-day clock — active users stay logged in indefinitely

### Silent refresh flow

Access token expires (15m)

→ Axios response interceptor catches 401

→ Single-flight silentRefresh() called (concurrent 401s queue, not fan-out)

→ POST /api/v1/auth/refresh_token (sends HttpOnly cookie automatically)

→ Success: new accessToken returned

→ authStore.setToken() + axios default header updated

→ notifyTokenRefreshed() → AuthContext.setAccessToken() (React state synced)

→ Original request retried with new token

→ Failure (revoked/expired cookie): hardLogout() → /login

Key files:

- `apps/frontend/src/api/axiosConfig.ts` — interceptor + silentRefresh()
- `apps/frontend/src/utils/authStore.ts` — token store + refresh notification bridge
- `apps/frontend/src/contexts/AuthContext.tsx` — wires bridge via setOnTokenRefreshed()
- `apps/backend/src/api/auth/auth.controller.ts` — refreshToken handler
- `apps/backend/src/api/auth/auth.routes.ts` — POST /api/v1/auth/refresh_token

### Token issuance — SINGLE AUTHORITY

```tsx

token.service.ts → issueAuthTokens()

```tsx
**Never** issue tokens anywhere else. Any change here must be reflected in auth middleware tests.

---

## Email Verification

### Schema (users table)

```sql
email_verified_at             TIMESTAMP WITH TIME ZONE  nullable
email_verification_token      VARCHAR(128)              nullable — cleared on verify
email_verification_expires_at TIMESTAMP WITH TIME ZONE  nullable — 30 min window
```

### Endpoints

```ts
GET  /api/v1/auth/verify-email?token=<hex>    — public, no auth required
POST /api/v1/auth/resend-verification         — requires Bearer token, rate-limited 1/min/user
```

### Important

- Verification is **non-blocking** — user gets access token immediately on register
- Email delivery failure is **non-fatal** — registration succeeds regardless
- Token update uses `systemDb` (not `db`) — sf_app cannot update users without tenant context

---

## Database & RLS

### Critical rule

`sf_app` (runtime role) has **`rolbypassrls = false`**. `sf_user` (migration role) has **`rolbypassrls = true`**.

Any pre-tenant operation (registration, email verification token writes) **must use `systemDb`**, not `db`.

```typescript
// ✅ CORRECT — pre-tenant write
await systemDb('users').where({ id: userId }).update({ email_verification_token: token });

// ❌ WRONG — will fail with RLS violation
await db('users').where({ id: userId }).update({ email_verification_token: token });
```

### RLS policies on key tables

| Table | INSERT | SELECT | UPDATE | DELETE |
|---|---|---|---|---|
| shops | open (anyone) | tenant-isolated | tenant-isolated | tenant-isolated |
| users | open | tenant-isolated | tenant-isolated | tenant-isolated |
| shop_memberships | tenant-isolated | tenant-isolated | — | — |
| warehouse_locations | tenant-isolated (ALL) | — | — | — |

---

## OAuth (Shopify)

### Current state

- **Shopify OAuth**: fully implemented end-to-end
- **Google OAuth**: backend returns `{"error":"Unsupported platform"}` — UI shows disabled button with "Coming soon" tooltip
- OAuth initiate endpoint **requires auth token** — it is not a public endpoint

### Flow

```ts
ConnectStorePage → GET /api/v1/integrations/oauth/initiate?platform=shopify&shop=<name>
  (requires Authorization: Bearer <accessToken>)
→ Redirects to https://<shop>.myshopify.com/admin/oauth/authorize
→ Shopify redirects to GET /api/v1/integrations/oauth/callback/shopify
→ SyncAnimationPage (FT0 lifecycle)
→ /overview (FT1/FT2)
```

---

## Frontend Auth State

### AuthContext

```typescript
{
  isLoggedIn: boolean
  isLoading: boolean      // true during initial hydration
  user: PublicUser | null
  accessToken: string | null
  login(user, accessToken): void
  logout(): void
  setAccessToken(token): void
}
```

### OAuth handoff (URL → state)

When Shopify OAuth completes, backend redirects to:

```tsx
/?token=<jwt>&connect=success
```

`AuthContext` detects `connect=success` + `token` params on mount, decodes JWT payload, sets auth state, cleans URL via `history.replaceState`.

### Token persistence

```tsx
authStore.ts
  setToken()   → inMemoryAccessToken + localStorage.accessToken
  getToken()   → inMemoryAccessToken ?? localStorage.accessToken
  clearToken() → both cleared
```

---

## Design System (Auth Pages)

### Font
**Plus Jakarta Sans** — everywhere, auth included (decision 2026-07-19: Auth v2
adopts the design bundle's layout/copy/colors, NOT its typefaces). Design-spec
serif headings map to Plus Jakarta Sans 700; body maps to 300/500 weights.

### Color tokens (CSS vars — set in themes/index.tsx)

```tsx
--accent        #FF6B2B  (CTA buttons, links, highlights)
--accent-hover  #FF8C5A
--accent-ghost  rgba(255,107,43,0.12)
--bg            page background
--bg-2          secondary background
--surface       card/panel surface
--ink           primary text
--ink-2         secondary text
--ink-3         caption/metadata
--ink-4         placeholder/hint
--rule          default border  (dark: rgba(255,255,255,0.08))
--rule-2        stronger border
```

### Auth-specific rules

- All CTA buttons: `sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent-hover)' } }}`
- **Never** use `color="secondary"` on buttons — renders MUI amber (#F59E0B), not LaSyncro orange
- Card: `<MainCard border boxShadow sx={{ bgcolor: 'var(--surface)', borderColor: 'var(--rule) !important' }}>`
- Page wrapper: `<AuthWrapper1>` — sets `backgroundColor: 'var(--bg)'`
- Input fields: use `<FormControl>` + `<OutlinedInput placeholder="...">` — NOT `CustomFormControl` (it breaks `startAdornment` via `legend { display: none }`)

### Shared auth chrome components

```tsx
AuthPageChrome.tsx
  <SystemStatusPill />   — top-right nav, static "All systems green"
  <SocialProofTicker />  — bottom fixed bar, scrolling metrics
```

---

## Pitfalls & Lessons Learned

### 1. RLS blocks pre-tenant writes

**Problem:** `SET LOCAL row_security = off` has no effect for non-superuser roles.  
**Fix:** Use `systemDb` for all operations before a shop/tenant exists.

### 2. CustomFormControl breaks input icons

**Problem:** `CustomFormControl` sets `legend { display: none }` and `fieldset { top: 0 }` — removes the MUI notch, causing `startAdornment` icons to overlap floating labels.  
**Fix:** Use standard `<FormControl>` + `placeholder` instead of floating `InputLabel`.

### 3. OAuth initiate requires auth token

**Problem:** `/api/v1/integrations/oauth/initiate` has `authenticateToken` middleware — cannot be called from the sign-in page (user has no token yet).  
**Fix:** "Continue with Shopify" on sign-in redirects to `/register`. OAuth connect happens post-registration when user has a token.

### 4. Dynamic import flash on register page

**Problem:** `AuthRegisterComponent` starts as `null` causing brief white flash before component loads.  
**Fix:** Show `<CircularProgress>` while `AuthRegisterComponent` is null.

### 5. Register response shape mismatch

**Problem:** Frontend analytics read `response.data.id` but backend returns `{ user: publicUser }`.  
**Fix:** `response.data.user.id`

### 6. Verify-email was mapped to CheckInboxPage

**Problem:** `/verify-email` route rendered `CheckInboxPage` — clicking the email link just showed the inbox screen again.  
**Fix:** Dedicated `VerifyEmailPage` that calls the backend, shows status, then navigates to `/connect-store`.

### 7. Backend redirect vs SPA

**Problem:** Backend `res.redirect()` on verify-email doesn't work for axios calls in a SPA.  
**Fix:** Return JSON `{ message: '...' }` — frontend handles navigation.

### 8. Logout hang — LoginPage lazy-loaded its only auth form (AUTH-LOGOUT-HANG-01)

**Problem:** `LoginPage.tsx` had copied pitfall #4's pattern — `import('./jwt/AuthLogin')` into `AuthLoginComponent` state, rendering `<CircularProgress>` while `null` and only `console.error`-ing on import rejection. Explicit in-app logout does a client-side `navigate('/login')` (no document reload), so the current module graph stays live. If that lazy chunk could not load — its hashed asset superseded by a deployment, or any transient module-load failure — `AuthLoginComponent` stayed `null` forever and `/login` was stranded on the spinner; only a manual browser reload (fresh document + current asset graph) recovered. Auth state and logout routing were both already correct.

**Fix:** `LoginPage.tsx` statically imports the only live form — `import AuthLogin from './jwt/AuthLogin'` — and renders `<AuthLogin posthog={posthog} />` directly. Removed the LoginPage-only lazy machinery: `authLoginImports`, `AuthLoginComponent` state, the dynamic-import effect, and the `CircularProgress` loader branch. In the production build `AuthLogin` is now eagerly reachable with `LoginPage` — no separate lazy chunk is emitted or fetched.

**Invariants this locks in:**

- *Logout UX:* explicit in-app logout must reach a usable unauthenticated `/login` state **without a document reload**.
- *Login recovery:* the only live login form must not sit behind a late lazy-module boundary that can strand the unauthenticated recovery route. Pitfall #4's lazy-import pattern is acceptable on `/register` (not a recovery route); it must not be used for the login form.

**Not changed:** `AuthContext.logout()` state (`isLoggedIn=false`, `isLoading=false`, `user=null`, `accessToken=null`) and its token/user persistence clearing; the best-effort `POST /api/v1/auth/logout` → `AuthContext.logout()` → `navigate('/login')` wiring in both logout controls; Shopify/OAuth and lifecycle behavior. No global `vite:preloadError` handler and no automatic `window.location.reload()` were added — general stale-lazy-chunk recovery is a separate, unimplemented concern.

**Regression:** `tests/unit/ui/auth/LoginPage.test.tsx` — the form is present on the first synchronous commit, no loader spinner occupies the form slot, and the AUTH-017 logged-in redirect still fires. RED against the pre-fix lazy architecture, GREEN after the static import.

**Verification (2026-09-02):** focused LoginPage suite 3/3; `AuthContext` suite 4/4; `npm run test:config` UNOWNED=0 / MULTI_OWNED=0; `NODE_ENV=production` frontend Vite build PASS with no separate `AuthLogin` lazy chunk emitted; Milad UI certification PASS (post-logout `/login` form usable immediately, no manual reload, no spinner).

---

## Pending / Next Steps

| Issue | Description |
|---|---|
| #978 | Add "Open Gmail/email" shortcut on check-inbox screen — open |
| #979 | Self-serve account deletion + Shopify store disconnection — open |
| #983 | ✅ SyncAnimationPage visual elevation superseded and completed by SHOP-REVIEW-SYNC-ANIMATION-THEME-07 — certified 2026-09-01 |
| AUTH-017 | ✅ Logged-in users redirected away from /login → returnTo or /overview |
| Silent refresh | ✅ Axios interceptor silently refreshes expired access tokens — no forced logout during active workflows |
| returnTo guard | ✅ ProtectedRoute saves intended destination before redirect; AuthLogin + hardLogout both honour it |
| AuthGuard `/login` | ✅ Fixed relative `navigate('login')` → absolute `navigate('/login')` |

## Completed since initial audit

| Item | Resolution |
|---|---|
| Forgot password | ✅ `POST /api/v1/auth/forgot-password` — enumeration-safe, rate-limited, Resend delivery |
| Password reset | ✅ `POST /api/v1/auth/reset-password` + `ResetPasswordPage` at `/reset-password?token=<hex>` |
| Cross-tab verification (#982) | ✅ BroadcastChannel('lasyncro_auth') — VerifyEmailPage broadcasts, CheckInboxPage listens |
| Email templates (#981) | ✅ Shared `emailHtml()` wrapper — logo-light.png, #FF6B2B accent, Plus Jakarta Sans |
| Continue button overlap (#980) | ✅ pb: 100px on all auth page wrappers |
| Floor-planning Vite race | ✅ Pre-build in dev-ui script + added to build:modules |
| AhaMomentPage visual elevation (#984) | ✅ Floating status pill with timestamp, gated divider, accent left-border on first card, revenue impact banner, layout height fix |
| Auth logo color scheme fix | ✅ AuthLogo component — logo-dark.png for dark, logo.png for light — applied across all 7 auth pages |
| Logout hang (AUTH-LOGOUT-HANG-01) | ✅ Explicit in-app logout reaches a usable `/login` without a document reload — `LoginPage` statically imports its only auth form (no lazy boundary on the recovery route); see Pitfall #8. Regression: `tests/unit/ui/auth/LoginPage.test.tsx` |

## Email System

### Shared wrapper

All transactional emails use `emailHtml(content)` in `email.service.ts`:

- Background: `#FAFAF8` (LaSyncro light bg token)
- Logo: `https://www.lasyncro.com/logo-light.png` (light-background compatible)
- Accent: `#FF6B2B` (LaSyncro orange)
- Font: Plus Jakarta Sans (consistent with app + marketing)
- Card: white `#FFFFFF` with `#E8E6E0` border, 12px border-radius

### Adding a new email template

1. Add `SendXxxParams` interface
2. Export `sendXxxEmail(params)` function  
3. Wrap html with `emailHtml(\`...\`)`
4. Call fire-and-forget with `.catch()` for non-fatal emails
5. Use `systemDb` if sending during pre-tenant operations

## FT0 First-Activation Experience

### Location

Primary runtime:

- `apps/frontend/src/activation/SyncAnimationPage.tsx`
- `apps/frontend/src/activation/SyncAnimationExperience.tsx`
- `apps/frontend/src/activation/hooks/useSyncStatus.ts`
- `apps/frontend/src/activation/hooks/useFirstRunSyncExperience.ts`
- `apps/frontend/src/activation/hooks/useWorkflowStory.ts`
- `apps/frontend/src/activation/hooks/useDisplayProgress.ts`
- `apps/frontend/src/activation/components/SyncProgressPanel.tsx`
- `apps/frontend/src/activation/components/SyncCompletionChip.tsx`

Development-only deterministic preview:

- `apps/frontend/src/activation/ActivationExperiencePreview.tsx`
- `apps/frontend/src/activation/activationPreviewFixtures.ts`
- `/dev/activation-preview`

These are gated by `import.meta.env.DEV` and compile-time eliminated from
production bundles. The build boundary that guarantees this (production
frontend builds run with production `NODE_ENV`) is documented in
`docs/playbooks/production_deploy_gotchas.md`.

### Authority model

The post-OAuth experience deliberately has three independent clocks:

1. **Real sync clock** — backend `/api/v1/integrations/sync-status`; authoritative for sync success/failure.
2. **Story clock** — frontend seven-scene workflow film; explains how LaSyncro works while sync proceeds.
3. **Experience buffer** — frontend minimum dwell / post-sync resolve timing; prevents a fast sync from flashing through onboarding.

The story never drives lifecycle and displayed progress never drives lifecycle.

`LifecycleProvider` remains authoritative for routing. `SyncAnimationPage` does not directly navigate around lifecycle state.

`useSyncStatus` polls `/api/v1/integrations/sync-status` every 2 seconds.

### Seven-scene workflow story

| Scene | Label | Duration | Merchant-facing story |
|---|---|---:|---|
| 1 | PLAN | 3000ms | Create the PO. Know what stock is coming. |
| 2 | RECEIVE | 3200ms | Receive against the PO. |
| 3 | BARCODE | 3200ms | Give each product a LaSyncro barcode. Queue it for put away. |
| 4 | PUT AWAY | 4200ms | Place each barcoded product in the correct bin. |
| 5 | PICK | 4000ms | Release orders. Pick their items and move them to pack. |
| 6 | PACK | 3400ms | Verify each order. Pack it and create the shipping label. |
| 7 | SHIP | 3800ms | Move packed orders to the shipping dock. Load the truck and send them out. |

Canonical story duration is approximately 24.8 seconds.

The warehouse is one persistent spatial world across all seven scenes. Scene changes alter actors and operational state rather than replacing the warehouse.

### First-run timing contract

| Constant | Value | Purpose |
|---|---:|---|
| `MIN_FIRST_RUN_DWELL_MS` | 9000ms | Minimum first-run experience before completion may resolve |
| `MAX_POST_SYNC_RESOLVE_MS` | 1800ms | Upper bound after real sync completes while waiting for a natural story settle point |
| `COMPLETION_TRANSITION_MS` | 900ms | Completion handoff transition |
| `VERY_LONG_THRESHOLD_MS` | 45000ms | Threshold for very-long-sync reassurance |

Fast sync therefore does not immediately eject the merchant from the experience.

Long sync proceeds through Scene 7 and then settles into ambient state. It must never restart Scene 1.

Failure interrupts the story immediately.

### Displayed progress

The progress bar is an **experience projection**, not the raw backend percentage.

Canonical targets:

| State | Display target |
|---|---:|
| Initial | 8% |
| Scene 1 | 30% |
| Scene 2 | 60% |
| Scene 3 | 82% |
| Scene 4 | 88% |
| Scene 5 | 91% |
| Scene 6 | 93% |
| Scene 7 | 95% |
| Ambient | 95% |
| Completion eligible | 100% |

Rules:

- displayed progress is monotonic;
- it advances smoothly with the story;
- it never exceeds 95% before completion eligibility;
- backend `COMPLETED` alone does not make the UI jump immediately to 100%;
- real sync completion remains required before 100% is allowed;
- reduced-motion mode steps between targets rather than requiring continuous animation.

### Sync-complete handoff

The former centered blocking completion overlay was removed.

When real sync is complete and the experience is eligible to resolve:

- the progress projection may reach 100%;
- a small non-blocking lower-right **Sync complete** chip appears;
- the warehouse remains fully visible;
- there is no backdrop or screen dimming;
- **Enter workspace** is available as an optional CTA;
- no click is required — normal automatic completion still proceeds;
- clicking **Enter workspace** only accelerates the remaining presentation resolve;
- the CTA does not fabricate sync completion, write lifecycle state, or bypass lifecycle routing.

### Visual and motion rules

- Orange is action/UI accent, not a movement-direction color.
- Green is reserved for confirmed completion.
- No Brand Pulse treatment.
- No full-screen completion modal.
- No visible developer diagnostics in the merchant experience.
- Dark/light modes are intentional.
- Reduced motion renders representative settled states without weakening lifecycle contracts.
- Reviewer laptop target `1024×820` must remain scroll-free.

### Navigation during activation

During FT0 / first activation, navigation remains intentionally constrained.

Lifecycle state controls when the application leaves the activation experience. Once backend lifecycle advances beyond FT0, `LifecycleProvider` exposes the next lifecycle/application surface.

### Verification — 2026-09-01

`SHOP-REVIEW-SYNC-ANIMATION-THEME-07` is locally certified:

- focused activation Jest: **70/70 PASS**;
- canonical user-state matrix M1–M34: **34/34 PASS**;
- reviewer viewport `1024×820`: no horizontal or vertical overflow;
- real Shopify authorization-code OAuth reconnect completed against `development-store-15820042357.myshopify.com`;
- real Shopify sync completed;
- all 10 canonical OAuth scopes persisted, including `read_locations` and `write_inventory`;
- lifecycle advanced through first activation to FT2;
- OAuth state rows were consumed;
- hard refresh did not replay first activation;
- fresh local/incognito re-entry did not replay first activation;
- progress projection and non-blocking completion chip were visually approved in both deterministic preview and real provider flow.

This real-provider certification proves the reconnect OAuth / token-exchange / real-sync path. It does not replace a separate signed App-Store fresh-install HMAC certification.


## Environment Variables Required

```bash
# Auth
JWT_SECRET=...
JWT_REFRESH_SECRET=...

# Shopify OAuth
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_WEBHOOK_SECRET=...
SHOPIFY_API_VERSION=2024-01

# Email (Resend)
RESEND_API_KEY=...
RESEND_FROM_EMAIL=noreply@lasyncro.com

# URLs
FRONTEND_URL=http://localhost:5173   # used in verification email link
APP_BASE_URL=https://...ngrok...     # used for Shopify OAuth redirect URI
```

---

## Testing

```bash
# Register + verify flow
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@test.com","firstName":"Test","lastName":"User","password":"Password123!"}'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@test.com","password":"Password123!"}'

# Verify email (token from DB)
curl "http://localhost:3000/api/v1/auth/verify-email?token=<token>"

# Resend verification (requires Bearer token)
curl -X POST http://localhost:3000/api/v1/auth/resend-verification \
  -H "Authorization: Bearer <accessToken>"

# Dev token (non-production only)
curl http://localhost:3000/api/v1/auth/dev-token
```

---

## Screens Reference

| Route | File | Target design |
|---|---|---|
| `/login` | `LoginPage.tsx` + `jwt/AuthLogin.tsx` | A1 |
| `/register` | `RegisterPage.tsx` + `jwt/AuthRegister.tsx` | A2 |
| `/connect-store` | `ConnectStorePage.tsx` | A3 |
| `/forgot-password` | `ForgotPasswordPage.tsx` | A4 |
| `/check-inbox` | `CheckInboxPage.tsx` | A5 |
| `/verify-email` | `VerifyEmailPage.tsx` | — (token handler) |
| `/reset-password` | `ResetPasswordPage.tsx` | — (not in original target designs) |

Implementation log
- C1 (2026-07-19): AuthWrapper1 converted to always-dark scope boundary —
  locally re-declares scheme-scoped tokens (--bg/--surface/--ink*/--rule*/
  --accent-ghost/--accent-border) to dark values, so every auth child renders
  dark regardless of app color scheme. Cast via CSSProperties (custom-property
  keys). AuthLogo pinned to /logo-dark.png on auth (scheme hook removed;
  reintroduce via forceDark prop if reused elsewhere). Keep the token block in
  sync with themes/index.tsx dark block.

  - C3' (2026-07-19): AuthGridBackdrop.tsx shipped (reusable, aria-hidden,
  pointer-events none, prefers-reduced-motion → static). Brand panel (A4)
  closed won't-do — backdrop-only direction chosen.
  