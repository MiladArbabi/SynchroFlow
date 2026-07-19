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
- Sign in: eyebrow "SIGN IN" · h "Welcome back. *Let's sync up.*" ·
  sub "Enter your credentials to open today's brief." · labeled fields
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
- lsCell — grid-backdrop variant only: randomly placed 44px cells flare
  orange (opacity .25 → 1 → .25 within first 14% of a 9s cycle), each with
  a randomized animation-delay; cell positions/opacity/delay generated in
  component state on mount, not hardcoded.
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
│       ├── LoginPage.tsx                ← /login — dynamic import of jwt/AuthLogin
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

---

## Pending / Next Steps

| Issue | Description |
|---|---|
| #978 | Add "Open Gmail/email" shortcut on check-inbox screen — open |
| #979 | Self-serve account deletion + Shopify store disconnection — open |
| #983 | SyncAnimationPage visual elevation to match Brief preview target design — open |
| #983 | SyncAnimationPage visual elevation to match Brief preview target design — open |
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

## FT0 Sync Animation (SyncAnimationPage)

### Location

`apps/frontend/src/activation/SyncAnimationPage.tsx`
`apps/frontend/src/activation/hooks/useSyncStepMachine.ts`
`apps/frontend/src/activation/hooks/useSyncStatus.ts`

### Architecture

- `useSyncStatus` — polls `/api/v1/integrations/sync-status` every 2s
- `useSyncStepMachine` — imperative timer loop drives phase walking, isolated from React render cycle
- Phase order: CONNECTING → IMPORTING_PRODUCTS → IMPORTING_ORDERS → PROCESSING → FINALIZING → DONE

### Timing (minimum per phase)

| Phase | Duration |
|---|---|
| CONNECTING | 2500ms |
| IMPORTING_PRODUCTS | 1800ms |
| IMPORTING_ORDERS | 8000ms |
| PROCESSING | 5000ms |
| FINALIZING | 3000ms |

### Key decisions

- Timer loop uses refs not state — poll re-renders never cancel pending timers
- `highestTargetIndex` tracks furthest backend phase seen — never regresses
- Product count uses `progress.current` as proxy when DB variants table lags projections
- Orders step shows pulse indicator — total count not known upfront
- Progress bar driven by UI step index (20% per step) — not backend percentage
- Right panel removed — skeletons without real data erode trust (#985 tracks real data reveal)

### Nav during FT0

- Only logo + "Sync in progress" pill visible
- Trial banner, alerts bell, color mode toggles gated to `isFt2 = phase === 'FT2_READY'`
- Gating in `TopnavbarContent.tsx` via `useShopLifecycle()`
- Trial banner also gated in `AppLayout/index.tsx` via `isSidenavAllowed`

### Pending

- #985 — populate right panel with real brief items on COMPLETED

---

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