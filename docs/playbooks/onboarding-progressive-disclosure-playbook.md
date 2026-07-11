# LaSyncro — Onboarding & Progressive Disclosure Playbook

> **Status:** v1.0 — 2026-07-09
> **Author:** Product + Engineering session (ISS-RQ series)
> **Reading order:** Read `lifecycle_playbook.md` and `modules-ux-playbook.md` before this.
> **Purpose:** Canonical reference for all onboarding, activation checklist, spotlight coaching,
> and progressive-disclosure patterns. Every engineer touching first-run UX must read this first.

---

## 1. Philosophy

LaSyncro is PLG (product-led growth) — users self-register and must reach value without
a sales engineer. The aha moment is not understanding the UI. It is the morning brief
rendering with real signals from their real store.

Three principles drive every decision in this playbook:

1. **Never explain, make the user do.** One action at a time. Immediate visible payoff.
   Zero walls of text. (Duolingo pattern.)
2. **Activation is data-state, not click-tracking.** A checklist item is complete when
   the underlying data condition is true — not when the user clicked through a tour.
   (PostHog pattern.)
3. **Teach surfaces lazily, on first contact.** Spotlights fire once, on the surface
   they coach, anchored to the one primary action. They never return after dismissal.

---

## 2. The Three Layers

### Layer 1 — Activation Checklist (topnav popover)

**What it is:** A topnav icon (left of the bell) that opens a popover — same shell,
same tokens as the alerts popover in `TopnavbarContent.tsx`. Badge shows remaining
incomplete items in `--accent` orange. Disappears from nav entirely once all items
are green and the user dismisses.

**Design rationale:** The alerts popover is already a known mental model for the user.
Reusing the shell removes cognitive overhead. The checklist is a parallel track —
urgent signals in the bell, activation progress in the new icon — same zone, distinct
purpose.

**Trigger:** Rendered only while `lifecyclePhase === 'FT2_READY'` AND
`user_states.checklist:completed` is absent. After dismissal, the icon never reappears.

**Five items — all driven by real data state:**

| # | Label | Signal / condition | Source |
|---|---|---|---|
| 1 | Connect your store | `integration.connected === true` | readiness manifest |
| 2 | Complete first sync | `integration.syncCompleted === true` | readiness manifest |
| 3 | Fix missing product costs | `orderNexus.missingCostCount === 0` | readiness manifest |
| 4 | Release your first wave | `activation_audit_events WHERE event_type = 'wave_released'` | audit log |
| 5 | Export your first brief | `activation_audit_events WHERE event_type = 'brief_exported'` | audit log |

Items 1–3 are already computable from `GET /api/v1/onboarding/readiness` (the
`OnboardingReadinessService`). Items 4–5 require audit events to be emitted at the
success path of their respective endpoints (see §5).

**Persistence:** Dismissal writes `user_states` key `checklist:completed` → `"1"`.
Read on mount via `GET /api/v1/user-state`. This is a per-user, not per-shop, flag —
each owner/admin tracks their own dismissal.

**Popover anatomy:**

```
┌─────────────────────────────────────────┐
│ Getting started          2 of 5 done    │  ← header, ink / ink-4
├─────────────────────────────────────────┤
│ ✅  Connect your store                  │
│ ✅  Complete first sync                 │
│ ⬜  Fix missing product costs   Fix →  │  ← accent ghost pill CTA
│ ⬜  Release your first wave    Go →   │
│ ⬜  Export your first brief    Go →   │
├─────────────────────────────────────────┤
│              Dismiss checklist          │  ← only when all 5 green
└─────────────────────────────────────────┘
```

Rules:
- Incomplete items show a Tier 2 ghost pill CTA navigating to the relevant surface.
- Complete items show a green `✅` check (use `--confirm-ink` / `--confirm-ghost`
  per modules-ux-playbook §10 — this is a persisted state indicator, not an action).
- "Dismiss checklist" footer link only renders when all 5 items are complete.
- Never show partial completion as a percentage — use "N of 5 done" plain text.
- Icon in topnav: `ListChecks` from lucide-react. Badge: `--accent` orange, count of
  remaining incomplete items. When all complete, badge disappears; icon stays until dismissed.

---

### Layer 2 — First-Visit Spotlights (anchored coach marks)

**What it is:** A small floating card that renders adjacent to a primary action on
first visit to a surface. A subtle vertical float animation draws the eye without
aggression. Dismissed per-surface, per-user, permanently.

**Design rationale:** Tooltips require hover — wrong for discovery on a new surface.
Banners (§15, modules-ux-playbook) are for deep-link context, not first-visit coaching.
Spotlights are a distinct, narrower pattern: they coach one action on one surface, once.

**Animation:** CSS keyframe, `translateY(0px) → translateY(-5px) → translateY(0px)`,
2s ease-in-out, infinite. Stops on hover (prevents motion distraction while reading).

```css
@keyframes lasyncro-spotlight-float {
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-5px); }
}
```

**Anatomy (260px wide):**

```
┌──────────────────────────────┐
│ ● 1 of 3                     │  ← micro-progress, 10px, ink-4
│ Release wave to floor        │  ← 13px, fontWeight 600, ink
│ Operators see it instantly   │  ← 12px, fontWeight 300, ink-3, lineHeight 1.5
│                    Got it ✕  │  ← accent ghost pill + X icon (lucide)
└──────────────────────────────┘
```

Token rules (follow modules-ux-playbook §1):
- Shell: `bgcolor: var(--surface)`, `border: 1px solid var(--rule)`, `borderRadius: 10px`
- Shadow: `boxShadow: var(--shadow-md)` (same as alerts popover)
- CTA "Got it": Tier 2 ghost pill per modules-ux-playbook §2
- Never hardcode hex. Never use `fontWeight: 700` on body copy.

**Persistence:** Dismissal calls `POST /api/v1/user-state/spotlight/:key/dismiss`
which writes `spotlight:dismissed:<key>` → `"1"` to `user_states`. Read on mount
via `GET /api/v1/user-state`. Once dismissed, the spotlight never reappears —
no "reset tour" affordance (adds confusion, rarely used).

**Spotlight registry — priority order for first build:**

| # | Key | Surface | Anchor | Copy |
|---|---|---|---|---|
| 1 | `order_flow_wave` | Order Flow | "Release wave to floor" button | "Select orders above, then release — operators pick and ship immediately." |
| 2 | `order_flow_blocked` | Order Flow / Blocked column | First blocked order card | "Fix the constraint here. The order moves to the pool automatically." |
| 3 | `demand_reorder` | Demand page | Reorder CTA | "Qty is pre-calculated from your sales velocity. Adjust if needed, then create the PO." |

**Rule:** Never stack more than one spotlight on a single surface at the same time.
If a surface has multiple spotlights (e.g. Order Flow has keys 1 and 2), show them
sequentially across visits — key 1 on first visit, key 2 on second visit (after key 1
is dismissed). Progress is tracked by checking which keys are already dismissed.

**Relationship to intent banner (modules-ux-playbook §15):**

| Pattern | Trigger | Persisted? | Purpose |
|---|---|---|---|
| Intent banner | `?urgency=` / `?constraint=` / `?context=` URL param | No (local useState) | Deep-link context — "why you're here" |
| Spotlight | First visit, no URL param required | Yes (user_states) | First-run coaching — "what to do here" |

They can coexist on the same surface. Intent banner renders at the top of content area.
Spotlight anchors to its specific action element. They do not conflict.

---

### Layer 3 — Teaching Empty States

**What it is:** Every empty state names what will appear there and what action causes
it to fill. No aspirational headlines (per product-structure.md §7 voice register rules
— aspirational sentences are for onboarding/empty states only, not operational surfaces).

**Pattern (consistent across all modules):**

```
[Icon — muted, ink-4]
Nothing here yet.
[One sentence: what fills this and how.]
[Optional: Tier 2 ghost pill CTA to the action that fills it]
```

**Examples:**

| Surface | Empty state copy |
|---|---|
| Order Flow — Order Pool | "No orders ready to release. Resolve blocked orders on the left to move them here." |
| Demand page | "No stockout risk detected. This updates automatically as your inventory changes." |
| Problem Center | "No open exceptions. Pick, pack, and receive exceptions from the floor appear here." |
| Business Pulse | "Sync completing. Revenue figures appear here once your first orders are processed." |

**Rule:** True-zero empty states say "No X" not "No X found" — "found" implies a failed
search, not an empty system. Problem Center's empty state must say "No open exceptions"
not "No results match your filters" (see product-structure.md §5, Problem Center).

---

## 3. Data Architecture

### 3.1 Persistence — `user_states` table

All onboarding state is stored in the existing `user_states` table (key/value per user,
unique constraint on `user_id + key`).

**Key namespace convention:**

| Prefix | Purpose | Example |
|---|---|---|
| `checklist:` | Checklist-level flags | `checklist:completed` → `"1"` |
| `spotlight:dismissed:` | Per-spotlight dismissal | `spotlight:dismissed:order_flow_wave` → `"1"` |

No schema changes needed. The `user_states_user_id_key_unique` constraint guarantees
idempotent upserts — write the same key twice, second write is a no-op (use
`ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`).

### 3.2 Audit events — `activation_audit_events` table

Two new event types must be emitted at the success path of their endpoints:

| Event type | Emitted by | Endpoint |
|---|---|---|
| `wave_released` | `httpReleaseBatch` in `wms.controller.ts` | `POST /api/v1/wms/batch/release` |
| `brief_exported` | `exportBrief` in `exports.controller.ts` | `POST /api/v1/exports/brief` |

Payload schema (both events):

```json
{
  "schema": "activation_audit.v1",
  "event": "<event_type>",
  "occurredAt": "<ISO timestamp>"
}
```

Emit after the success response is committed — never before, never inside the
transaction that does the primary work. Fire-and-forget with `console.error` on failure
(audit event failure must never block the primary action).

### 3.3 Checklist data endpoint

The checklist popover reads from two sources combined in one hook:

1. `GET /api/v1/user-state` — for `checklist:completed` dismissal flag.
2. `GET /api/v1/onboarding/readiness` — for items 1–3 signal states.
3. `GET /api/v1/user-state/activation-events` — NEW, lightweight endpoint returning
   booleans for `wave_released` and `brief_exported` from `activation_audit_events`.

The frontend hook `useActivationChecklist` assembles these into the five-item array.
It is the single consumer — do not inline this logic in the component.

---

## 4. API Contracts

### 4.1 Spotlight dismiss endpoint (NEW)

```
POST /api/v1/user-state/spotlight/:key/dismiss
Auth: Bearer token (authenticateToken)
Params: key — spotlight registry key (e.g. "order_flow_wave")
Body: none
Response 200: { dismissed: true, key: "<key>" }
Response 400: { error: "Invalid spotlight key" } — if key not in registry
```

Implementation: single upsert to `user_states` with key
`spotlight:dismissed:<key>`. Validate key against a server-side registry constant
(same keys as §2 spotlight registry) before writing — reject unknown keys with 400.

### 4.2 Activation events check endpoint (NEW)

```
GET /api/v1/user-state/activation-events
Auth: Bearer token (authenticateToken)
Response 200: {
  wave_released: boolean,
  brief_exported: boolean
}
```

Implementation: two `EXISTS` queries against `activation_audit_events` filtered by
`shop_id` and `event_type`. Returns booleans only — no timestamps, no counts.

---

## 5. Implementation Plan

> **Status: T1–T9 shipped 2026-07-10.** T10 (empty states sweep) is the only remaining open task.

Tasks are atomic and must be executed in this order. Do not batch.

| # | Status | Task | Files | Unblocks |
|---|---|---|---|---|
| T1 | ✅ | Emit `wave_released` audit event | `apps/backend/src/api/wms/wms.controller.ts` | Checklist item 4 |
| T2 | ✅ | Emit `brief_exported` audit event | `apps/backend/src/api/exports/exports.controller.ts` | Checklist item 5 |
| T3 | ✅ | `POST /user-state/spotlight/:key/dismiss` endpoint | `user-state.routes.ts`, `user-state.controller.ts`, `UserStateService` | Layer 2 |
| T4 | ✅ | `GET /user-state/activation-events` endpoint | same files as T3 | Checklist items 4–5 |
| T5 | ✅ | `useActivationChecklist` hook | `apps/frontend/src/hooks/useActivationChecklist.ts` | T6 |
| T6 | ✅ | Checklist popover + topnav icon | `TopnavbarContent.tsx` + new `ActivationChecklist.tsx` | Layer 1 |
| T7 | ✅ | `useSpotlight(key)` hook | `apps/frontend/src/hooks/useSpotlight.ts` | T8 |
| T8 | ✅ | `<SpotlightCoachMark>` component | `apps/frontend/src/components/SpotlightCoachMark.tsx` | T9 |
| T9 | ✅ | Wire spotlight to Order Flow | `apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx` | Layer 2 live |
| T10 | 🔴 | Teaching empty states sweep | All module pages (copy only, no logic) | Layer 3 |

### Implementation notes (2026-07-10)

**RLS tenant context is required for all `activation_audit_events` reads and writes.**
The table is protected by row-level security. Every insert and select must wrap in a
transaction with `SET LOCAL "app.current_tenant" = '<shopId>'` before touching the table,
or the query will be silently blocked (insert: `42501` RLS violation; select: returns 0 rows).
Pattern used in T1, T2, T4:

```typescript
await db.transaction(async (trx) => {
  await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
  await trx('activation_audit_events').insert({ ... });
});
```

**`getActivationEvents` cast pattern.** Knex's `.transaction()` return type is
`void | T[]` — always cast the result explicitly:
```typescript
const rows = (await db.transaction(async (trx) => { ... })) as { event_type: string }[];
```

**Order Flow ISS-OP-01/ISS-OP-02 additions (2026-07-10):** alongside T9, Order Flow gained
a contextual wave builder (action bar appears on selection, hidden when nothing selected)
and client-side order search wired into the existing `filteredPool` → `sortedPool` →
`visiblePool` chain. See modules-ux-playbook.md §16 for the pattern.

---

## 6. Rules for Future Engineers

1. **New checklist item:** add a signal to `readiness.manifest.ts` OR a new
   `activation_audit_events` event type. Never track completion via click events or
   localStorage.

2. **New spotlight:** add to the registry in §2 (this doc) AND in the server-side
   registry constant used by `POST /user-state/spotlight/:key/dismiss`. Unknown keys
   must be rejected — registry is the contract.

3. **Spotlight on a new surface:** check whether a spotlight for that surface already
   exists in the registry before adding one. Maximum one visible spotlight per surface
   per visit. If the surface needs two spotlights, they are sequential across visits.

4. **Never use localStorage for onboarding state.** `user_states` is the store.
   LocalStorage is not synced across devices and is cleared on browser data reset —
   wrong for activation state that should persist across sessions.

5. **Audit events are fire-and-forget.** Wrap every emit in try/catch. Log failures
   with `console.error`. Never let audit event failure block the primary user action.

6. **Checklist is owner/admin only.** Operators do not see the checklist icon.
   Gate on `shopRole === 'owner' || shopRole === 'admin'` in `TopnavbarContent.tsx`.

7. **Spotlight animation must respect `prefers-reduced-motion`.** Add:
   ```css
   @media (prefers-reduced-motion: reduce) {
     animation: none;
   }
   ```
   to the float keyframe wrapper.

8. **Empty state copy follows the voice register in product-structure.md §7.**
   Operational surfaces: plain nouns, no aspirational headlines. "Nothing here yet."
   is correct. "Build your pipeline." is not.

---

## 7. What This Does NOT Cover

- **Push notifications / email digests:** notifications delivery channel is an open
  question (product-structure.md §9). Do not wire notification dispatch to onboarding
  events until that decision is made.
- **Multi-user onboarding:** checklist and spotlights are per-user. If two admins share
  a shop, each has their own dismissal state. There is no "team onboarding" concept yet.
- **Mobile (iOS/Android):** this playbook covers the webapp only. Mobile onboarding is
  a separate surface with its own scan-first workflow (see `wms_mobile_workflow_playbook.md`).
- **FT0/FT1 phases:** this playbook covers FT2-active users only. Pre-FT2 onboarding
  (AhaMomentPage, lifecycle gates) is fully documented in `lifecycle_playbook.md`.

---

---
*Adjacent docs: `lifecycle_playbook.md` (activation phases), `modules-ux-playbook.md`
(§15 intent banner pattern), `product-structure.md` (§5 module specs, §7 vocabulary).*

---

## 17. Sourcing Module Spotlights — 2026-07-11

> **Surface:** `/suppliers-portal/sourcing`
> **Component:** `SpotlightCoachMark` (now in `modules/shared/src/ui/` — portable,
> no app-layer dependencies)
> **Hook:** `useSpotlight(key)` in `apps/frontend/src/hooks/useSpotlight.ts`
> **Wired in:** `apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx`
> **Rendered in:** `PurchasingSourcingView` in `modules/suppliers-portal`

Three spotlights cover the three distinct states a new user encounters on the
Sourcing surface, in the order they naturally appear. Each fires once, dismisses
permanently via `user_states`, and never returns.

### Spotlight 1 — `sourcing_never_ordered`

| Field | Value |
|---|---|
| Key | `sourcing_never_ordered` |
| Trigger | `!activeVariantId && neverOrderedCount > 0` |
| Anchor | Inline, inside the Never Ordered Before section, above the variant rows |
| Step | 1 of 3 |
| Title | These products have no supplier yet |
| Body | Assign a supplier to each one — so when stock runs low, you already know who to order from. |
| Teaches | The Never Ordered group is an action queue. "Assign a supplier →" is the primary action. |

### Spotlight 2 — `sourcing_alert_triggered`

| Field | Value |
|---|---|
| Key | `sourcing_alert_triggered` |
| Trigger | `activeVariantId && !isLoadingRecs && goodMatches.length > 0` |
| Anchor | Inline, above the first ranked recommendation row |
| Step | 2 of 3 |
| Title | Your best supplier, ranked automatically |
| Body | Rankings are based on delivery speed, order accuracy, and quality from your real orders. Order now, or add to queue to combine with other products before sending. |
| Teaches | The ranked list is data-driven. Two paths exist: immediate PO or queue for accumulation. |

### Spotlight 3 — `sourcing_accumulator`

| Field | Value |
|---|---|
| Key | `sourcing_accumulator` |
| Trigger | `reorderRequests.length > 0` |
| Anchor | Inline, inside the Pending Reorders section, above the supplier rows |
| Step | 3 of 3 |
| Title | Building up your order before sending |
| Body | Products queue here by supplier. Once you've added enough to meet their minimum order, Create PO lights up. You can always send early if you need to. |
| Teaches | The accumulator is a staging area, not a dead end. MOQ progress is visible. Merchant controls when to convert. |

### Props pattern (for future Sourcing-adjacent spotlights)

Spotlights on module surfaces cannot call `useSpotlight()` directly —
the hook lives in `apps/frontend/src/` and the module boundary blocks that import.
Resolution is always at page level:

```typescript
// SuppliersPortalPage.tsx
const spotlightNeverOrdered = useSpotlight('sourcing_never_ordered');

// passed into module via sharedProps:
spotlights: {
  neverOrdered: { isDismissed: spotlightNeverOrdered.isDismissed, dismiss: spotlightNeverOrdered.dismiss },
  ...
}
```

The module receives spotlight state as plain props and renders
`<SpotlightCoachMark isDismissed={...} onDismiss={...} />` — purely presentational,
zero business logic in the module. This is the canonical pattern for all future
module-level spotlights.

### Moving `SpotlightCoachMark` to shared

`SpotlightCoachMark` was originally app-local
(`apps/frontend/src/components/SpotlightCoachMark.tsx`). It was moved to
`modules/shared/src/ui/SpotlightCoachMark.tsx` on 2026-07-11 to make it
importable from any module. The original file in `apps/frontend/src/components/`
remains for the Order Flow spotlight — it uses `useAppTheme()` internally
and has not been migrated. Do not remove it until Order Flow is refactored
to use the shared version with the controlled `isDismissed` / `onDismiss` props pattern.
