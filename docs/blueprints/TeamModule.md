# Team Module — Audit Blueprint

**LaSyncro | Sprint 4 Audit | May 25, 2026**
**Status: Audited — Production-ready, minimal DS violations, RBAC ceiling noted**

---

## 1. Module Structure

**Route:** `/team` (single page, no sub-routes)
**Sidenav:** Standalone item — `id: 'team'`, `path: '/team'`
**No requiredModuleId** — team management is platform-level, available on all tiers
**No module package** — self-contained page component, correct architecture for this surface
**Route registration:** `LifecycleRouteHost.tsx` line 240 — `/team/*`

---

## 2. Backend — Confirmed Endpoints

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/api/v1/members` | ✅ Live | Returns `{members: [1 member on clean seed]}` |
| POST | `/api/v1/members` | ✅ Wired | Create member + send invite email |
| PATCH | `/api/v1/members/:userId/role` | ✅ Wired | Update member role |
| DELETE | `/api/v1/members/:userId` | ✅ Wired | Revoke access |
| GET | `/api/v1/members/:userId/performance` | ✅ Live | Operator performance metrics (all null on clean seed) |
| GET | `/api/v1/members/me/preferences` | ✅ Live | Self-service preferences (empty object on clean seed) |
| PATCH | `/api/v1/members/me/preferences` | ✅ Wired | Update preferences |
| PATCH | `/api/v1/members/me/currency` | ✅ Wired | Update display currency |
| GET | `/api/v1/operators/team` | ✅ Live | Returns operator list for task assignment |
| GET | `/api/v1/operators/availability` | ✅ Wired | Self-declared availability per week |
| POST | `/api/v1/operators/availability` | ✅ Wired | Upsert availability |
| GET | `/api/v1/operators/team-availability` | ✅ Wired | Full team availability view |
| GET | `/api/v1/settings/permissions` | ✅ Live | Returns action list |
| GET | `/api/v1/operators` | ❌ 404 | No root handler — use `/operators/team` instead |

### Operator performance response (clean seed)

```json
{
  "userId": 1,
  "metrics": {
    "pick_rate_uph": null,
    "pack_rate_uph": null,
    "stow_rate_uph": null,
    "batches_picked": 0,
    "batches_packed": 0,
    "receive_jobs_closed": 0,
    "dock_to_stock_hours": null
  }
}
```

---

## 3. Schema

| Table | Rows (shop_id=1) | Purpose |
|---|---|---|
| `shop_memberships` | 1 | Member records with role, currency, locale, notification_preferences (jsonb) |
| `shop_role_permissions` | 0 | Custom RBAC per shop — **empty, not used**. Permissions hardcoded via `requireAction()` middleware |
| `operator_availability` | 0 | Weekly availability declarations — empty on clean seed |
| `operator_task_log` | 0 | Per-operator task activity — empty on clean seed |
| `operator_audit_log` | 0 | Audit trail — empty on clean seed |
| `users` | seeded | User accounts |
| `user_sessions` | seeded | Active sessions |

### shop_memberships columns of note

- `display_currency` + `locale` — per-member currency preference (self-service)
- `notification_preferences` (jsonb) — extensible notification config
- `revoked_at` — soft-delete for access revocation

### RBAC state

`shop_role_permissions` is empty — permissions are entirely role-based via `requireAction()` middleware. Roles are fixed: `owner`, `admin`, `operator`. No custom per-shop permission overrides possible. This is correct for current scale but is a ceiling for enterprise customers needing custom RBAC.

---

## 4. Frontend — File Map

| File | Role |
|---|---|
| `apps/frontend/src/pages/ft2-pages/MembersPage.tsx` | Full page — member table, create modal, seat limit enforcement |
| `apps/frontend/src/pages/members/useMembers.ts` | Fetches members, exposes update/create mutations |
| `apps/frontend/src/api/members.ts` | Axios calls for member CRUD |

### What MembersPage implements

- Member table: Name, Email, Member Since, Role (with inline role selector for owner/admin)
- Seat usage bar: shows X of N used, warns at 80%, blocks at limit
- Seat limit enforcement: `TIER_SEAT_LIMIT` config drives limit per tier
- UpgradePrompt modal on seat limit hit
- Create member modal: email + name + role → invite email sent
- 403 handling: non-owner users see appropriate error
- Role write guard: `canWrite` = owner or admin only

### Design system violations

| Location | Violation | Rule |
|---|---|---|
| Line 136 | `fontWeight: 700` on "Team" page title | Max weight 500 |
| Line 155 | `border: '1px solid'` on seat usage container | Must be `0.5px solid` |
| Line 257 | `border: '1px solid'` on empty state container | Must be `0.5px solid` |
| Line 162 | `fontWeight: 600` on seat count label | Max weight 500 |
| No hardcoded hex | ✅ Clean | Best DS compliance of all modules |

---

## 5. Visual Audit

| Route | State | Notes |
|---|---|---|
| `/team` | ✅ Live | 1 member, seat bar (1 of 5), role chip + inline selector, Add Member CTA. Renders correctly. |

---

## 6. Known Issues

| ID | Priority | Description |
|---|---|---|
| TEAM-01 | P2 | `fontWeight: 700` on page title, `fontWeight: 600` on seat count |
| TEAM-02 | P2 | `border: '1px solid'` in seat usage container and empty state |
| TEAM-03 | P2 | `GET /api/v1/operators` returns 404 — correct path is `/operators/team`. Any code calling the root path will fail silently |
| TEAM-04 | P3 | `shop_role_permissions` empty — RBAC is hardcoded per role. No custom permission overrides possible per shop. Ceiling for enterprise use. |
| TEAM-05 | P3 | Operator performance metrics all null on clean seed — no empty state or "start using WMS to unlock performance data" messaging on the per-member performance view |
| TEAM-06 | P3 | `operator_availability` schema and endpoints exist but no availability UI surface in the webapp — mobile-only at present |

---

## 7. Workshop Verdict

**Keep. No cuts. Minimal work needed.**

Team is the simplest module in the app and correctly scoped. Seat limit enforcement, role management, and invite flow are all production-ready. The operator performance endpoint is built and wired — it will populate automatically as WMS activity accumulates.

**What needs work:**

1. DS cleanup — fontWeight and border violations (TEAM-01, TEAM-02) — 15 minute fix
2. `/operators` root path documentation correction (TEAM-03) — any hook calling the wrong path needs updating

**What is production-ready as-is:**

- Member CRUD with invite flow
- Seat limit enforcement with tier-gating
- Role management with write guard
- Operator performance endpoint (data populates with WMS usage)

**What's missing and worth considering for next sprint:**
Operator availability UI in webapp. The schema, endpoints, and mobile surface exist — the webapp has no availability calendar. For an SMB operator managing 1–20 warehouse staff, knowing who's available this week before releasing batches is operationally useful.

---

## 8. Crash Bug — Discovered During Audit

| ID | Priority | Description |
|---|---|---|
| TEAM-07 | ✅ Fixed | Server crash resolved — `u.name` → `trx.raw("CONCAT(u.first_name, ' ', u.last_name)")` in `httpGetTeamAvailability`. Consistent with `trx` usage pattern throughout file. |
EOF
echo "TEAM-07 logged."